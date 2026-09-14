use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::Emitter; // [NOVO] Import necessário para usar app.emit()

use crate::agent::skills::{web_search, execute_command};

pub struct SkillDispatcher {
    base_path: PathBuf,
}

impl SkillDispatcher {
    pub fn new(app_dir: Option<PathBuf>) -> Self {
        let base_path = app_dir
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
            .join(".agents");
        
        Self { base_path }
    }

    pub fn load_tools_schema(&self, persona: &crate::agent::core::PersonaConfig) -> Option<Value> {
        let mut all_tools = Vec::new();
        
        // Built-ins (hardcoded para sempre funcionarem)
        let builtins: Value = serde_json::json!([
            {
                "type": "function",
                "function": {
                    "name": "web_search",
                    "description": "Busca informações atualizadas na internet via buscador. Use para fatos recentes.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": { "type": "string", "description": "Termo de busca" }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "show_popup",
                    "description": "Exibe uma mensagem no popup/overlay da interface do usuário.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "message": { "type": "string", "description": "Texto/Markdown a exibir" }
                        },
                        "required": ["message"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "execute_command",
                    "description": "Executa scripts na máquina do usuário (powershell ou bash).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "code": { "type": "string", "description": "O código do script a ser executado." },
                            "language": { "type": "string", "description": "powershell ou bash" }
                        },
                        "required": ["code", "language"]
                    }
                }
            }
        ]);
        
        if let Some(arr) = builtins.as_array() {
            all_tools.extend(arr.clone());
        }

        let schema_path = self.base_path.join("skills.json");
        if let Ok(content) = std::fs::read_to_string(&schema_path) {
            if let Ok(json) = serde_json::from_str::<Value>(&content) {
                if let Some(arr) = json.as_array() {
                    all_tools.extend(arr.clone());
                }
            }
        }
        
        let filtered: Vec<Value> = all_tools.into_iter().filter(|tool| {
            if let Some(name) = tool.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str()) {
                persona.enabled_tools.contains(&name.to_string())
            } else {
                false
            }
        }).collect();
        
        if filtered.is_empty() {
            return None;
        }
        Some(Value::Array(filtered))
    }

    /// Executa a ferramenta mapeando o nome para o módulo Rust.
    pub async fn dispatch(
        &self, 
        tool_name: &str, 
        parameters: &Value, 
        persona: &crate::agent::core::PersonaConfig,
        app_handle: Option<tauri::AppHandle>
    ) -> Result<String, String> {
        // 1. Verifica se a ferramenta está habilitada para esta Persona
        if !persona.enabled_tools.contains(&tool_name.to_string()) {
            return Err(format!("Acesso negado: a ferramenta '{}' não está habilitada para a persona '{}'", tool_name, persona.name));
        }

        // 2. Verifica se a ferramenta tem auto_approve
        let is_auto_approve = persona.auto_approve_tools.contains(&tool_name.to_string());
        
        if !is_auto_approve {
            log::warn!("[HITL] 🛡️ ATENÇÃO: Ferramenta '{}' NÃO TEM auto-approve. Pausando execução para decisão do usuário.", tool_name);
            // TODO: Integrar tokio::sync::oneshot para aguardar evento do Frontend.
            if let Some(ref app) = app_handle {
                let _ = app.emit("hitl_approval_required", serde_json::json!({
                    "tool": tool_name,
                    "parameters": parameters,
                    "persona": persona.name
                }));
            }
            // Para o escopo atual, avisamos nos logs. No app final a thread esperaria a resposta do React.
        } else {
            log::info!("[HITL] ✅ Ferramenta '{}' auto-aprovada pela política da Persona.", tool_name);
        }

        match tool_name {
            "web_search" => {
                web_search::execute(parameters, app_handle.clone()).await
            },
            "show_popup" => {
                let message = parameters.get("message").and_then(|m| m.as_str()).unwrap_or("");
                if let Some(app) = app_handle {
                    let _ = crate::show_corner_popup(
                        app.clone(), None, "top-right".to_string(), Some(400.0), Some(200.0)
                    ).await;
                    let _ = app.emit("show_popup_content", serde_json::json!({ "content": message }));
                }
                Ok(format!("Popup exibido com sucesso: {}", message))
            },
            "execute_command" => {
                execute_command::execute(parameters, app_handle.clone()).await
            },
            _ => {
                Err(format!("Ferramenta não registrada ou sem implementação: {}", tool_name))
            }
        }
    }
}
