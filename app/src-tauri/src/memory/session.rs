use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// ID global da sessão ativa nesta execução do app.
pub static SESSION_ID: Lazy<Arc<Mutex<String>>> =
    Lazy::new(|| Arc::new(Mutex::new(String::new())));

/// Retorna o ID da sessão ativa. Retorna string vazia se ainda não inicializado.
pub fn get_current_session_id() -> String {
    SESSION_ID.lock().map(|s| s.clone()).unwrap_or_default()
}

/// Cria uma nova sessão no banco de dados e armazena o ID globalmente.
/// Deve ser chamada uma única vez no boot do app, após `init_db`.
pub fn init_session(conn: &Connection, persona_name: &str) -> Result<String, rusqlite::Error> {
    let session_id = Uuid::new_v4().to_string();
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO sessions (id, created_at, active_persona) VALUES (?1, ?2, ?3)",
        params![session_id, created_at, persona_name],
    )?;

    // Persiste globalmente
    if let Ok(mut lock) = SESSION_ID.lock() {
        *lock = session_id.clone();
    }

    log::info!("[Session] ✅ Nova sessão criada: {} (persona: {})", session_id, persona_name);
    Ok(session_id)
}

/// Atualiza o nome da persona ativa na sessão corrente (chamado quando o usuário troca de persona).
pub fn update_session_persona(conn: &Connection, persona_name: &str) {
    let session_id = get_current_session_id();
    if session_id.is_empty() {
        return;
    }
    let _ = conn.execute(
        "UPDATE sessions SET active_persona = ?1 WHERE id = ?2",
        params![persona_name, session_id],
    );
    log::info!("[Session] Persona da sessão atualizada para: {}", persona_name);
}
