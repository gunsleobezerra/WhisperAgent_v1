use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

fn get_mcp_config_path(app: &AppHandle) -> PathBuf {
    let app_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    app_dir.join(".agents").join("mcp_servers.json")
}

#[tauri::command]
pub fn get_mcp_servers(app: AppHandle) -> Result<Vec<McpServerConfig>, String> {
    let path = get_mcp_config_path(&app);
    if !path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let servers: Vec<McpServerConfig> = serde_json::from_str(&content).unwrap_or_default();
    Ok(servers)
}

#[tauri::command]
pub fn save_mcp_server(app: AppHandle, server: McpServerConfig) -> Result<(), String> {
    let mut servers = get_mcp_servers(app.clone())?;
    
    if let Some(pos) = servers.iter().position(|s| s.id == server.id) {
        servers[pos] = server;
    } else {
        servers.push(server);
    }
    
    let path = get_mcp_config_path(&app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    
    let json = serde_json::to_string_pretty(&servers).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn delete_mcp_server(app: AppHandle, id: String) -> Result<(), String> {
    let mut servers = get_mcp_servers(app.clone())?;
    servers.retain(|s| s.id != id);
    
    let path = get_mcp_config_path(&app);
    let json = serde_json::to_string_pretty(&servers).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}
