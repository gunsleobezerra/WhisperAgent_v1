use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Debug)]
pub struct ToolInvocationRequest {
    pub invocation_id: String,
    pub raw_invocation: String,
    pub format: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ToolInvocationResponse {
    pub tool_name: String,
    pub parameters: Value,
    pub requires_human_approval: bool,
}

#[tauri::command]
pub fn process_tool_invocation(_req: ToolInvocationRequest) -> Result<ToolInvocationResponse, String> {
    // Validação de formato (json ou xml) e schema
    Ok(ToolInvocationResponse {
        tool_name: "dummy_tool".to_string(),
        parameters: serde_json::json!({}),
        requires_human_approval: true,
    })
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ToolApprovalRequest {
    pub invocation_id: String,
    pub decision: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ToolApprovalResponse {
    pub status: String,
    pub llm_resumed: bool,
}

#[tauri::command]
pub fn resolve_tool_approval(req: ToolApprovalRequest) -> Result<ToolApprovalResponse, String> {
    // Resolve "approve" ou "deny"
    let status = match req.decision.as_str() {
        "approve" => "resolved",
        "deny" => "resolved",
        _ => return Err("Error_Invalid_Invocation".to_string()),
    };

    Ok(ToolApprovalResponse {
        status: status.to_string(),
        llm_resumed: true,
    })
}
