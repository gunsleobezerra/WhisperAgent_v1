use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;
use fastembed::{TextEmbedding, InitOptions, EmbeddingModel};
use tokio::sync::mpsc::UnboundedReceiver;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use rusqlite::Connection;

use crate::memory::db::{save_embedding, get_all_embeddings_with_text};

// ---------------------------------------------------------------------------
// Estado global do modelo de embedding
// ---------------------------------------------------------------------------

/// Modelo de embedding compartilhado entre threads.
/// Inicializado lazy na primeira chamada de `embed_text`.
static EMBEDDING_MODEL: Lazy<Arc<Mutex<Option<TextEmbedding>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

/// Inicializa (ou reutiliza) o modelo de embedding multilíngue.
/// O modelo é baixado automaticamente pelo fastembed (~120MB) na primeira execução
/// e cacheado em `~/.cache/huggingface/hub/`.
fn get_or_init_model() -> Result<(), String> {
    let mut lock = EMBEDDING_MODEL.lock().map_err(|e| e.to_string())?;
    if lock.is_some() {
        return Ok(());
    }

    log::info!("[RAG] 🔄 Inicializando modelo de embedding multilíngue (multilingual-e5-small)...");
    let model = TextEmbedding::try_new(
        InitOptions::new(EmbeddingModel::MultilingualE5Small)
    ).map_err(|e| format!("Falha ao carregar modelo de embedding: {}", e))?;

    *lock = Some(model);
    log::info!("[RAG] ✅ Modelo de embedding pronto.");
    Ok(())
}

/// Gera um vetor de embedding para o texto fornecido.
/// Retorna Vec<f32> com 384 dimensões (multilingual-e5-small).
pub fn embed_text(text: &str) -> Result<Vec<f32>, String> {
    get_or_init_model()?;

    let lock = EMBEDDING_MODEL.lock().map_err(|e| e.to_string())?;
    let model = lock.as_ref().ok_or("Modelo não inicializado")?;

    // fastembed espera um &[&str]
    let mut embeddings = model
        .embed(vec![text], None)
        .map_err(|e| format!("Falha ao gerar embedding: {}", e))?;

    embeddings.pop().ok_or_else(|| "Embedding vazio retornado".to_string())
}

// ---------------------------------------------------------------------------
// Similaridade coseno
// ---------------------------------------------------------------------------

/// Calcula a similaridade coseno entre dois vetores de mesma dimensão.
/// Retorna valor em [-1.0, 1.0]; quanto maior, mais similar.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot / (norm_a * norm_b)
}

// ---------------------------------------------------------------------------
// RAG Query
// ---------------------------------------------------------------------------

/// Busca os `top_k` chunks mais relevantes para a query, usando similaridade coseno.
/// Retorna os textos dos chunks em ordem decrescente de relevância.
pub fn rag_query(db_path: &str, query: &str, top_k: usize) -> Vec<String> {
    if query.trim().is_empty() || top_k == 0 {
        return vec![];
    }

    // Gera embedding da query
    let query_vec = match embed_text(query) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("[RAG] Falha ao embedar query: {}", e);
            return vec![];
        }
    };

    // Lê todos os embeddings do DB
    let candidates = get_all_embeddings_with_text(db_path);
    if candidates.is_empty() {
        log::info!("[RAG] Nenhum chunk armazenado ainda.");
        return vec![];
    }

    // Calcula scores e ordena
    let mut scored: Vec<(f32, String)> = candidates
        .into_iter()
        .map(|(_id, vec, text)| {
            let score = cosine_similarity(&query_vec, &vec);
            (score, text)
        })
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let results: Vec<String> = scored
        .into_iter()
        .take(top_k)
        .filter(|(score, _)| *score > 0.3) // descarta chunks pouco relevantes
        .map(|(score, text)| {
            log::info!("[RAG] Chunk selecionado (score={:.3}): \"{}\"", score, &text.chars().take(80).collect::<String>());
            text
        })
        .collect();

    log::info!("[RAG] {} chunk(s) relevantes encontrados para a query.", results.len());
    results
}

// ---------------------------------------------------------------------------
// Embedding Worker
// ---------------------------------------------------------------------------

/// Worker assíncrono que recebe pares (summary_id, summary_text) do Summarizer,
/// gera embeddings e persiste no SQLite.
///
/// Deve ser spawned via `std::thread::spawn` + runtime Tokio próprio,
/// assim como o rolling summarizer.
pub fn embedding_worker(
    mut rx: UnboundedReceiver<(String, String)>,
    db_path: String,
) {
    log::info!("[RAG] 🔄 Embedding worker iniciado.");

    // Inicializa o modelo de embedding antecipadamente em background
    if let Err(e) = get_or_init_model() {
        log::warn!("[RAG] Modelo de embedding não disponível: {}. RAG desativado.", e);
        return;
    }

    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            log::error!("[RAG] Falha ao criar runtime Tokio: {}", e);
            return;
        }
    };

    rt.block_on(async move {
        while let Some((summary_id, summary_text)) = rx.recv().await {
            log::info!("[RAG] 🧮 Gerando embedding para summary: {}", &summary_id);

            match embed_text(&summary_text) {
                Ok(vector) => {
                    let embedding_id = Uuid::new_v4().to_string();
                    let created_at = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);

                    match Connection::open(&db_path) {
                        Ok(mut conn) => {
                            if save_embedding(&mut conn, &embedding_id, &summary_id, "summary", &vector, created_at) {
                                log::info!("[RAG] ✅ Embedding salvo para summary {}", &summary_id);
                            }
                        }
                        Err(e) => log::error!("[RAG] Falha ao abrir DB para embedding: {}", e),
                    }
                }
                Err(e) => log::warn!("[RAG] Falha ao gerar embedding: {}", e),
            }
        }
        log::warn!("[RAG] Canal de embeddings fechado. Worker encerrando.");
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity_identical() {
        let v1 = vec![1.0, 2.0, 3.0];
        let v2 = vec![1.0, 2.0, 3.0];
        let sim = cosine_similarity(&v1, &v2);
        assert!((sim - 1.0).abs() < 1e-5);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let v1 = vec![1.0, 0.0];
        let v2 = vec![0.0, 1.0];
        let sim = cosine_similarity(&v1, &v2);
        assert!(sim.abs() < 1e-5);
    }

    #[test]
    fn test_cosine_similarity_opposite() {
        let v1 = vec![1.0, 2.0];
        let v2 = vec![-1.0, -2.0];
        let sim = cosine_similarity(&v1, &v2);
        assert!((sim - (-1.0)).abs() < 1e-5);
    }

    #[test]
    fn test_cosine_similarity_empty() {
        let v1: Vec<f32> = vec![];
        let v2: Vec<f32> = vec![];
        assert_eq!(cosine_similarity(&v1, &v2), 0.0);
    }
}

