pub mod soul_manager;
pub mod skill_dispatcher;

use crate::agent::core::{ByokSettings, PersonaConfig};
use crate::agent::llm_client;
use serde_json::Value;

pub async fn run_harness_loop(
    byok: &ByokSettings,
    persona: &PersonaConfig,
    user_prompt: &str,
    app_handle: Option<tauri::AppHandle>
) -> Result<String, String> {
    let soul_manager = soul_manager::SoulManager::new(None);
    let skill_dispatcher = skill_dispatcher::SkillDispatcher::new(None);

    let system_prompt = soul_manager.format_system_prompt(&persona.system_prompt)?;
    let tools_schema = skill_dispatcher.load_tools_schema(persona);

    // Histórico de mensagens do loop
    let mut messages = vec![
        serde_json::json!({ "role": "system", "content": system_prompt }),
        serde_json::json!({ "role": "user", "content": user_prompt }),
    ];

    let max_iterations = 5;
    let mut current_iteration = 0;

    while current_iteration < max_iterations {
        log::info!("[Harness] Iteração {}/{}", current_iteration + 1, max_iterations);
        
        // Dispara inferência via LLM Client refatorado
        let response = llm_client::execute_chat_completion_with_tools(
            byok, 
            &messages, 
            tools_schema.clone(), 
            persona.temperature, 
            400
        ).await?;

        // Adiciona a resposta do assistente ao histórico
        messages.push(response.message.clone());

        let mut executed_any_tool = false;

        if let Some(tool_calls) = response.tool_calls {
            if !tool_calls.is_empty() {
                executed_any_tool = true;
                for tool_call in tool_calls {
                    let tool_name = tool_call["function"]["name"].as_str().unwrap_or("");
                    let params_str = tool_call["function"]["arguments"].as_str().unwrap_or("{}");
                    
                    let params: Value = serde_json::from_str(params_str)
                        .unwrap_or_else(|_| serde_json::json!({}));

                    log::info!("[Harness] LLM requisitou ferramenta: {} com args: {}", tool_name, params_str);

                    let result = match skill_dispatcher.dispatch(tool_name, &params, persona, app_handle.clone()).await {
                        Ok(res) => {
                            log::info!("[Harness] 🔧 Ferramenta '{}' executada com sucesso. ({} bytes retornados)", tool_name, res.len());
                            log::debug!("[Harness] Resultado da ferramenta: {}", res);
                            res
                        },
                        Err(e) => {
                            log::error!("[Harness] ❌ Erro na ferramenta '{}': {}", tool_name, e);
                            format!("Erro ao executar ferramenta: {}", e)
                        }
                    };

                    messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": tool_call["id"],
                        "content": result
                    }));
                }
            }
        }

        if !executed_any_tool {
            let content = response.message["content"].as_str().unwrap_or("").to_string();
            
            // Tenta achar ferramentas alucinadas no formato texto cru: web_search {"query": "..."}
            let re = regex::Regex::new(r"(?P<tool>web_search|execute_command|show_popup)\s*(?P<json>\{.*?\})").unwrap();
            
            if let Some(caps) = re.captures(&content) {
                executed_any_tool = true;
                let tool_name = caps.name("tool").unwrap().as_str();
                let params_str = caps.name("json").unwrap().as_str();
                
                let params: Value = serde_json::from_str(params_str)
                    .unwrap_or_else(|_| serde_json::json!({}));

                log::info!("[Harness Fallback] LLM alucinou ferramenta no texto: {} com args: {}", tool_name, params_str);

                let result = match skill_dispatcher.dispatch(tool_name, &params, persona, app_handle.clone()).await {
                    Ok(res) => res,
                    Err(e) => format!("Erro: {}", e),
                };

                // Para simular a resposta, inserimos como user para o modelo aberto processar
                messages.push(serde_json::json!({
                    "role": "user",
                    "content": format!("Resultado da ferramenta {}: {}", tool_name, result)
                }));
            } else {
                // Nenhuma ferramenta nativa nem alucinada foi achada. Termina o loop.
                log::info!("[Harness] 🏁 Harness finalizado. Resposta gerada: {} caracteres.", content.len());
                return Ok(content);
            }
        }

        current_iteration += 1;
    }

    log::warn!("[Harness] ⚠️ Aviso: Harness estourou o limite de {} iterações de chamadas de ferramentas.", max_iterations);
    Err("Harness estourou o limite de iterações de chamadas de ferramentas.".to_string())
}
