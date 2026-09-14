use serde_json::Value;
use std::process::Command;
use tauri::Emitter;

pub async fn execute(parameters: &Value, app_handle: Option<tauri::AppHandle>) -> Result<String, String> {
    let code = parameters.get("code")
        .and_then(|c| c.as_str())
        .ok_or("Parâmetro 'code' é obrigatório para execute_command.")?;
        
    let language = parameters.get("language")
        .and_then(|l| l.as_str())
        .unwrap_or("powershell");

    log::info!("[Skill: execute_command] Comando recebido ({}): {}", language, code);

    if let Some(app) = app_handle {
        let _ = app.emit("tool_running", serde_json::json!({
            "tool": "execute_command",
            "message": "Executando comando localmente..."
        }));
    }

    // O Human-in-the-Loop deve ser validado antes de chegar aqui, pelo Dispatcher.
    // Aqui assumimos que o dispatcher já bloqueou ou autorizou.

    let output = if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args(&["-Command", code])
            .output()
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(code)
            .output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            
            let mut result = String::new();
            if !stdout.trim().is_empty() {
                result.push_str(&format!("STDOUT:\n{}\n", stdout.trim()));
            }
            if !stderr.trim().is_empty() {
                result.push_str(&format!("STDERR:\n{}\n", stderr.trim()));
            }

            if result.is_empty() {
                result.push_str("Comando executado com sucesso (sem saída).");
            }
            
            Ok(result)
        }
        Err(e) => Err(format!("Falha ao iniciar o processo: {}", e)),
    }
}
