use std::sync::Arc;
use std::sync::mpsc::Receiver;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use rusqlite::Connection;
use uuid::Uuid;
use tokio::sync::mpsc::UnboundedSender;

use crate::memory::ring_buffer::AudioSegment;
use crate::memory::db::save_summary;
use crate::memory::session::get_current_session_id;
use crate::agent::core::ByokSettings;
use crate::agent::llm_client::execute_chat_completion;

/// Intervalo máximo entre sumarizações (segundos). Garante que o buffer
/// sempre seja resumido mesmo se não houver silêncio.
const SUMMARIZE_INTERVAL_SECS: u64 = 120;

/// Mínimo de caracteres acumulados para disparar sumarização.
const MIN_CHARS_TO_SUMMARIZE: usize = 200;

/// Canal para enviar IDs de summaries recém-criados ao EmbeddingWorker.
pub type SummaryEventSender = UnboundedSender<(String, String)>; // (summary_id, summary_text)

/// Worker assíncrono que recebe segmentos expirados do HotRingBuffer via `std::sync::mpsc`,
/// acumula o texto e, quando o gatilho temporal/tamanho disparar, sumariza via LLM
/// e persiste no SQLite.
///
/// Deve ser chamado via `std::thread::spawn` (não `tokio::spawn`) pois usa um `mpsc::Receiver`
/// síncrono. Internamente cria um runtime Tokio para as chamadas async da LLM.
use std::sync::RwLock;

pub fn rolling_summarizer_worker(
    rx: Receiver<AudioSegment>,
    db_path: String,
    byok_arc: Arc<RwLock<ByokSettings>>,
    embedding_tx: SummaryEventSender,
) {
    log::info!("[Summarizer] 🔄 Worker iniciado. Intervalo máximo: {}s", SUMMARIZE_INTERVAL_SECS);

    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            log::error!("[Summarizer] Falha ao criar runtime Tokio: {}", e);
            return;
        }
    };

    let mut accumulated_text = String::new();
    let mut last_summarized_at = SystemTime::now();

    loop {
        // Coleta todos os segmentos disponíveis sem bloquear além de 1s
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(segment) => {
                if !segment.text.trim().is_empty() {
                    if !accumulated_text.is_empty() {
                        accumulated_text.push(' ');
                    }
                    accumulated_text.push_str(segment.text.trim());
                    log::info!(
                        "[Summarizer] 📝 Segmento acumulado ({} chars total): \"{}\"",
                        accumulated_text.len(),
                        &segment.text.chars().take(60).collect::<String>()
                    );
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {} // normal
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                log::warn!("[Summarizer] Canal desconectado. Encerrando worker.");
                break;
            }
        }

        // Verifica se deve disparar sumarização
        let elapsed = last_summarized_at.elapsed().unwrap_or_default().as_secs();
        let should_summarize = (accumulated_text.len() >= MIN_CHARS_TO_SUMMARIZE && elapsed >= 30)
            || elapsed >= SUMMARIZE_INTERVAL_SECS;

        if !should_summarize || accumulated_text.trim().is_empty() {
            continue;
        }

        let text_to_summarize = accumulated_text.trim().to_string();
        accumulated_text.clear();
        last_summarized_at = SystemTime::now();

        let session_id = get_current_session_id();
        if session_id.is_empty() {
            log::warn!("[Summarizer] Sessão ainda não inicializada, pulando sumarização.");
            continue;
        }

        // Clona BYOK para a chamada async
        let byok = match byok_arc.read() {
            Ok(b) => b.clone(),
            Err(_) => {
                log::error!("[Summarizer] Falha ao ler BYOK settings.");
                continue;
            }
        };

        // Usa modelo leve para sumarização (não impacta cota do modelo principal)
        let summary_result = rt.block_on(summarize_text(&byok, &text_to_summarize));

        match summary_result {
            Ok(summary) => {
                let summary_id = Uuid::new_v4().to_string();
                let created_at = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);

                // Abre conexão de escrita para o SQLite
                match Connection::open(&db_path) {
                    Ok(mut conn) => {
                        if save_summary(&mut conn, &summary_id, &session_id, created_at, &summary) {
                            log::info!(
                                "[Summarizer] ✅ Resumo salvo ({} chars): \"{}\"",
                                summary.len(),
                                &summary.chars().take(120).collect::<String>()
                            );
                            // Notifica o EmbeddingWorker
                            let _ = embedding_tx.send((summary_id, summary));
                        }
                    }
                    Err(e) => {
                        log::error!("[Summarizer] Falha ao abrir DB para salvar summary: {}", e);
                    }
                }
            }
            Err(e) => {
                log::error!("[Summarizer] Falha ao sumarizar via LLM: {}", e);
            }
        }
    }
}

async fn summarize_text(byok: &ByokSettings, text: &str) -> Result<String, String> {
    // Se não há API configurada, retorna o texto truncado como fallback
    if byok.endpoint.trim().is_empty() {
        let fallback = text.chars().take(300).collect::<String>();
        return Ok(fallback);
    }

    let system_prompt = "Você é um assistente de síntese de contexto. \
Recebe blocos de transcrição de áudio e extrai os fatos, tópicos e informações \
essenciais em bullet points concisos em Português do Brasil. \
REGRAS: \
(1) Máximo de 5 bullet points por bloco. \
(2) Preserve nomes próprios, números e termos técnicos exatamente. \
(3) Não adicione comentários, introduções ou conclusões. \
(4) Use formato: '- [fato ou tópico]'. \
(5) Se o texto for muito curto ou irrelevante, retorne apenas: '[sem fatos relevantes]'.";

    let user_prompt = format!("Transcrição:\n{}", text);

    execute_chat_completion(byok, system_prompt, &user_prompt, 0.3, 300).await
}
