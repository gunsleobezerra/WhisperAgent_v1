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
/// Intervalo máximo entre sumarizações (segundos). Garante que o buffer
/// sempre seja resumido mesmo em conversas pausadas.
const SUMMARIZE_INTERVAL_SECS: u64 = 45;

/// Mínimo de caracteres acumulados para disparar sumarização precoce.
const MIN_CHARS_TO_SUMMARIZE: usize = 60;

/// Canal para enviar IDs de summaries recém-criados ao EmbeddingWorker.
pub type SummaryEventSender = UnboundedSender<(String, String)>; // (summary_id, summary_text)

/// Worker assíncrono que recebe segmentos expirados do HotRingBuffer via `std::sync::mpsc`,
/// acumula o texto e, quando o gatilho temporal/tamanho disparar, sumariza via LLM
/// e persiste no SQLite.
use std::sync::RwLock;
use tauri::Emitter;

pub fn rolling_summarizer_worker(
    rx: Receiver<AudioSegment>,
    db_path: String,
    byok_arc: Arc<RwLock<ByokSettings>>,
    embedding_tx: SummaryEventSender,
    app_handle: Option<tauri::AppHandle>,
) {
    log::info!("[Summarizer] 🔄 Worker iniciado. Intervalo máximo: {}s, Min chars: {}", SUMMARIZE_INTERVAL_SECS, MIN_CHARS_TO_SUMMARIZE);

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
        // 1. Coleta segmentos que chegam via canal
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
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Durante silêncio, drena segmentos que já têm mais de 35s de idade no buffer global
                let drained = crate::memory::ring_buffer::drain_expired_global_ring_buffer(35_000);
                for seg in drained {
                    if !seg.text.trim().is_empty() {
                        if !accumulated_text.is_empty() {
                            accumulated_text.push(' ');
                        }
                        accumulated_text.push_str(seg.text.trim());
                    }
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                log::warn!("[Summarizer] Canal desconectado. Encerrando worker.");
                break;
            }
        }

        // 2. Avalia gatilho de sumarização
        let elapsed = last_summarized_at.elapsed().unwrap_or_default().as_secs();
        let should_summarize = (accumulated_text.len() >= MIN_CHARS_TO_SUMMARIZE && elapsed >= 15)
            || (elapsed >= SUMMARIZE_INTERVAL_SECS && !accumulated_text.trim().is_empty());

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

        // Usa modelo leve para sumarização ou fallback resiliente se a LLM falhar
        let summary_result = rt.block_on(summarize_text(&byok, &text_to_summarize));
        let summary = match summary_result {
            Ok(s) => s,
            Err(err) => {
                log::warn!("[Summarizer] Falha na chamada LLM ({}), usando síntese estruturada de fallback", err);
                format_fallback_summary(&text_to_summarize)
            }
        };

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
                    let _ = embedding_tx.send((summary_id.clone(), summary.clone()));

                    // Notifica o frontend (Janela de Sumário / UI)
                    if let Some(ref handle) = app_handle {
                        let _ = handle.emit("memory://summary-generated", serde_json::json!({
                            "id": summary_id,
                            "session_id": session_id,
                            "created_at": created_at,
                            "summary": summary
                        }));
                    }
                }
            }
            Err(e) => {
                log::error!("[Summarizer] Falha ao abrir DB para salvar summary: {}", e);
            }
        }
    }
}

/// Síntese estruturada direta para garantir que o usuário NUNCA fique com a tela vazia,
/// mesmo sem chave de API ou sem internet configurada.
fn format_fallback_summary(text: &str) -> String {
    let clean = text.trim();
    if clean.is_empty() {
        return "Nenhum ponto relevante registrado.".to_string();
    }

    let sentences: Vec<&str> = clean
        .split(|c| c == '.' || c == '?' || c == '!' || c == '\n')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && s.len() > 5)
        .collect();

    if sentences.is_empty() {
        return clean.chars().take(250).collect::<String>();
    }

    // Apenas junta as sentenças com pontos finais para um texto fluido
    sentences.join(". ") + "."
}

async fn summarize_text(byok: &ByokSettings, text: &str) -> Result<String, String> {
    // Se não há API configurada, utiliza o formatador local instantâneo
    if byok.endpoint.trim().is_empty() {
        return Ok(format_fallback_summary(text));
    }

    let system_prompt = "Você é um arquivista de memória de IA altamente qualificado. \
Sua função é ler blocos fragmentados de transcrição de áudio e anotações do sistema, e \
reescrevê-los em um único parágrafo de texto corrido (prosa), que seja coeso, fluido e extremamente claro. \
REGRAS: \
(1) NÃO use bullet points ou listas. Escreva um parágrafo narrativo contínuo. \
(2) Extraia a verdadeira essência, decisões importantes, intenções do usuário e tópicos discutidos. \
(3) Preserve estritamente nomes próprios, números, datas, termos técnicos e comandos exatos. \
(4) Escreva sempre em Português do Brasil (PT-BR) de forma direta e objetiva, sem floreios, sem introduções (ex: 'O usuário disse que...') e sem conclusões genéricas. \
(5) O texto final deve servir como uma memória perfeita de longo prazo para um agente autônomo ler no futuro.";

    let user_prompt = format!("Transcrição:\n{}", text);

    execute_chat_completion(byok, system_prompt, &user_prompt, 0.3, 300).await
}
