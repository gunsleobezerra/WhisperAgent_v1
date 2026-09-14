use serde_json::Value;
use tauri::Emitter;

pub async fn execute(parameters: &Value, app_handle: Option<tauri::AppHandle>) -> Result<String, String> {
    let query = parameters.get("query")
        .and_then(|q| q.as_str())
        .ok_or("Parâmetro 'query' é obrigatório para web_search.")?;

    log::info!("[Skill: web_search] Iniciando busca para: {}", query);

    if let Some(app) = app_handle {
        let _ = app.emit("tool_running", serde_json::json!({
            "tool": "web_search",
            "message": format!("Pesquisando na web: \"{}\"...", query)
        }));
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = "https://www.bing.com/search";
    let res = client.get(url)
        .query(&[("q", query)])
        .send()
        .await
        .map_err(|e| format!("Falha na requisição web: {}", e))?;

    let html = res.text().await.unwrap_or_default();
    
    let mut main_content = html.as_str();
    if let Some(start) = main_content.find("<ol id=\"b_results\"") {
        if let Some(end) = main_content[start..].find("</ol>") {
            main_content = &main_content[start..start+end];
        } else {
            main_content = &main_content[start..];
        }
    }

    let clean_text = main_content.replace("<", " <").replace(">", "> ");
    let mut extracted = String::new();
    let mut in_tag = false;
    
    for c in clean_text.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            extracted.push(c);
        }
    }

    let mut lines = Vec::new();
    for line in extracted.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            lines.push(trimmed.to_string());
        }
    }

    // Apenas concatena um resumo para não estourar tokens
    let text = lines.join(" ");
    let snippet = if text.len() > 1500 {
        &text[..1500]
    } else {
        &text
    };

    Ok(format!("Resultados da busca para '{}':\n{}", query, snippet))
}
