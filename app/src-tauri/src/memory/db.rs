use rusqlite::{params, Connection, Result, OpenFlags};
use std::time::Duration;
use std::thread::sleep;
use crate::memory::ring_buffer::HotRingBufferType;

pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            active_persona TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events_summary (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            summary TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_facts (
            id TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            fact TEXT NOT NULL,
            relevance_score INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS embeddings (
            id TEXT PRIMARY KEY,
            chunk_id TEXT NOT NULL,
            chunk_type TEXT NOT NULL,
            vector BLOB NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON embeddings(chunk_id);
        CREATE INDEX IF NOT EXISTS idx_summary_session ON events_summary(session_id, created_at DESC);
        "
    )?;
    Ok(())
}

pub fn save_summary(conn: &mut Connection, summary_id: &str, session_id: &str, created_at: i64, summary: &str) -> bool {
    let mut attempts = 0;
    let backoffs = [100, 500, 2000];

    loop {
        let tx_result = conn.transaction();
        let tx = match tx_result {
            Ok(t) => t,
            Err(e) => {
                if e.to_string().contains("SQLITE_BUSY") || e.to_string().contains("database is locked") {
                    if attempts < 3 {
                        sleep(Duration::from_millis(backoffs[attempts]));
                        attempts += 1;
                        continue;
                    } else {
                        log::warn!("[Memory DB] SQLITE_BUSY, summary descartado");
                        return false;
                    }
                }
                log::error!("[Memory DB] Falha ao iniciar transação: {}", e);
                return false;
            }
        };

        let res = tx.execute(
            "INSERT INTO events_summary (id, session_id, created_at, summary) VALUES (?1, ?2, ?3, ?4)",
            params![summary_id, session_id, created_at, summary],
        );

        match res {
            Ok(_) => {
                let _ = tx.commit();
                return true;
            }
            Err(e) => {
                if let rusqlite::Error::SqliteFailure(err, _) = e {
                    if err.code == rusqlite::ffi::ErrorCode::ConstraintViolation {
                        log::error!("[Memory DB] Summary órfão, violação de constraint");
                        return false;
                    } else if err.code == rusqlite::ffi::ErrorCode::DatabaseBusy {
                        if attempts < 3 {
                            sleep(Duration::from_millis(backoffs[attempts]));
                            attempts += 1;
                            continue;
                        } else {
                            log::warn!("[Memory DB] SQLITE_BUSY, summary descartado");
                            return false;
                        }
                    }
                }
                log::error!("[Memory DB] Falha ao inserir summary: {}", e);
                return false;
            }
        }
    }
}

/// Salva um vetor de embedding para um chunk (summary ou fact).
pub fn save_embedding(conn: &mut Connection, embedding_id: &str, chunk_id: &str, chunk_type: &str, vector: &[f32], created_at: i64) -> bool {
    // Serializa f32 slice para bytes (little-endian)
    let bytes: Vec<u8> = vector.iter().flat_map(|f| f.to_le_bytes()).collect();

    let res = conn.execute(
        "INSERT OR REPLACE INTO embeddings (id, chunk_id, chunk_type, vector, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![embedding_id, chunk_id, chunk_type, bytes, created_at],
    );

    match res {
        Ok(_) => true,
        Err(e) => {
            log::error!("[Memory DB] Falha ao salvar embedding: {}", e);
            false
        }
    }
}

/// Retorna todos os embeddings e seus textos para busca semântica (RAG).
pub fn get_all_embeddings_with_text(db_path: &str) -> Vec<(String, Vec<f32>, String)> {
    let conn = match Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(e) => {
            log::error!("[Memory DB] Falha ao abrir DB para RAG: {}", e);
            return vec![];
        }
    };

    let mut stmt = match conn.prepare(
        "SELECT e.chunk_id, e.vector, s.summary
         FROM embeddings e
         JOIN events_summary s ON e.chunk_id = s.id
         WHERE e.chunk_type = 'summary'
         ORDER BY s.created_at DESC
         LIMIT 200"
    ) {
        Ok(s) => s,
        Err(e) => {
            log::error!("[Memory DB] Falha ao preparar query RAG: {}", e);
            return vec![];
        }
    };

    let rows = stmt.query_map([], |row| {
        let chunk_id: String = row.get(0)?;
        let blob: Vec<u8> = row.get(1)?;
        let text: String = row.get(2)?;

        // Deserializa bytes → Vec<f32>
        let vector: Vec<f32> = blob
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();

        Ok((chunk_id, vector, text))
    });

    match rows {
        Ok(r) => r.filter_map(|x| x.ok()).collect(),
        Err(e) => {
            log::error!("[Memory DB] Erro ao iterar rows RAG: {}", e);
            vec![]
        }
    }
}

pub fn build_agent_context(db_path: &str, session_id: &str, hot_buffer: HotRingBufferType) -> String {
    let mut active_persona = String::new();
    let mut events_summary_concatenated = String::new();

    let conn_result = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY);

    match conn_result {
        Ok(conn) => {
            // Obter persona
            if let Ok(persona) = conn.query_row(
                "SELECT active_persona FROM sessions WHERE id = ?1",
                params![session_id],
                |row| row.get::<_, String>(0)
            ) {
                active_persona = persona;
            }

            // Obter últimos 50 summaries cronológicos
            if let Ok(mut stmt) = conn.prepare("SELECT summary FROM events_summary WHERE session_id = ?1 ORDER BY created_at DESC LIMIT 50") {
                if let Ok(rows) = stmt.query_map(params![session_id], |row| row.get::<_, String>(0)) {
                    let mut summaries: Vec<String> = rows.filter_map(Result::ok).collect();
                    summaries.reverse();
                    events_summary_concatenated = summaries.join("\n");
                }
            }
        },
        Err(e) => {
            log::warn!("[Memory DB] Falha ao ler memory.sqlite3: {}", e);
            active_persona = "UNKNOWN".to_string();
        }
    }

    if active_persona.is_empty() {
        active_persona = "UNKNOWN".to_string();
    }

    let hot_ring_buffer_concatenated = {
        let queue = match hot_buffer.lock() {
            Ok(guard) => guard,
            Err(_) => panic!("FATAL: RingBuffer Mutex poisoned"),
        };
        let texts: Vec<String> = queue.iter().map(|seg| seg.text.clone()).collect();
        texts.join(" ")
    };

    format!(
        "[PERSONA ACTIVE]: {}\n\
        [CONTEXTO CONSOLIDADO DA SESSÃO]:\n\
        {}\n\
        \n\
        [ÚLTIMOS 60 SEGUNDOS (FALA AO VIVO)]:\n\
        {}",
        active_persona, events_summary_concatenated, hot_ring_buffer_concatenated
    )
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct SummaryRecord {
    pub id: String,
    pub session_id: String,
    pub created_at: i64,
    pub summary: String,
}

/// Retorna todos os sumários consolidados da sessão ordenados por criação ascendente (cronológica).
pub fn get_session_summaries(conn: &Connection, session_id: &str) -> Result<Vec<SummaryRecord>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, created_at, summary FROM events_summary WHERE session_id = ?1 ORDER BY created_at ASC"
    )?;

    let rows = stmt.query_map(params![session_id], |row| {
        Ok(SummaryRecord {
            id: row.get(0)?,
            session_id: row.get(1)?,
            created_at: row.get(2)?,
            summary: row.get(3)?,
        })
    })?;

    let mut list = Vec::new();
    for item in rows {
        if let Ok(rec) = item {
            list.push(rec);
        }
    }
    Ok(list)
}

