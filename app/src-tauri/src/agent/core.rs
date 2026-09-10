use std::sync::{Arc, RwLock};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::memory::{db::build_agent_context, rag::rag_query, session::get_current_session_id};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PersonaConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub trigger_mode: String,
    pub hotword: String,
    pub enabled_tools: Vec<String>,
    pub temperature: f32,
    pub is_preset: bool,
}

impl Default for PersonaConfig {
    fn default() -> Self {
        Self {
            id: "concise_assistant".to_string(),
            name: "Assistente Conciso".to_string(),
            description: "Responde dúvidas e pedidos diretamente com foco em rapidez e objetividade.".to_string(),
            system_prompt: "Você é um assistente pessoal ultra conciso exibido em um HUD flutuante no Windows. Sua missão é responder à fala transcrita do usuário com o máximo de precisão e brevidade possível (máximo de 2 a 3 frases curtas). O popup e o overlay suportam renderização de Markdown completo (negrito, listas, blocos de código). Nunca enrole, não use saudações longas e responda sempre em Português do Brasil.".to_string(),
            trigger_mode: "hotword".to_string(),
            hotword: "copiloto".to_string(),
            enabled_tools: vec!["popup".to_string(), "clipboard".to_string()],
            temperature: 0.5,
            is_preset: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ByokSettings {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
}

impl Default for ByokSettings {
    fn default() -> Self {
        Self {
            endpoint: "".to_string(),
            api_key: "".to_string(),
            model: "geral".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LlmActionTriggered {
    pub action_id: String,
    pub persona_id: String,
    pub action_type: String,
    pub content: String,
    pub requires_interaction: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct TranscriptionCorrectedEvent {
    pub segment_id: String,
    pub text: String,
    pub original_text: String,
}

pub static ACTIVE_PERSONA: Lazy<Arc<RwLock<PersonaConfig>>> =
    Lazy::new(|| Arc::new(RwLock::new(PersonaConfig::default())));

pub static BYOK_SETTINGS: Lazy<Arc<RwLock<ByokSettings>>> =
    Lazy::new(|| Arc::new(RwLock::new(ByokSettings::default())));

pub static LLM_CORRECTION_ENABLED: Lazy<Arc<RwLock<bool>>> =
    Lazy::new(|| Arc::new(RwLock::new(true)));

pub static MIN_CHARS_TO_TRIGGER: Lazy<Arc<RwLock<usize>>> =
    Lazy::new(|| Arc::new(RwLock::new(20)));

pub static POPUPS_ENABLED: Lazy<Arc<RwLock<bool>>> =
    Lazy::new(|| Arc::new(RwLock::new(true)));

pub fn set_popups_enabled(enabled: bool) {
    if let Ok(mut lock) = POPUPS_ENABLED.write() {
        *lock = enabled;
        log::info!("[Agent Core] Popups/Notificações da persona: {}", if enabled { "ATIVADOS" } else { "DESATIVADOS" });
    }
}

pub fn is_popups_enabled() -> bool {
    POPUPS_ENABLED.read().map(|v| *v).unwrap_or(true)
}

/// Caminho para o arquivo SQLite de memória. Populado no boot pelo lib.rs.
pub static MEMORY_DB_PATH: Lazy<Arc<RwLock<String>>> =
    Lazy::new(|| Arc::new(RwLock::new(String::new())));

/// Referência ao HotRingBuffer compartilhada com o agente. Populado no boot.
pub static HOT_BUFFER_REF: Lazy<Arc<RwLock<Option<crate::memory::ring_buffer::HotRingBufferType>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

/// Buffer acumulador de segmentos de fala para a persona.
/// Os segmentos vão sendo concatenados até que o total atinja MIN_CHARS_TO_TRIGGER.
pub static PERSONA_TEXT_BUFFER: Lazy<Arc<RwLock<String>>> =
    Lazy::new(|| Arc::new(RwLock::new(String::new())));

pub fn set_min_chars_to_trigger(n: usize) {
    if let Ok(mut lock) = MIN_CHARS_TO_TRIGGER.write() {
        *lock = n.max(1);
        log::info!("[Agent Core] Mínimo de caracteres para disparo da persona: {}", *lock);
    }
    // Limpa o buffer ao mudar o threshold
    if let Ok(mut buf) = PERSONA_TEXT_BUFFER.write() {
        buf.clear();
    }
}

pub fn get_min_chars_to_trigger() -> usize {
    MIN_CHARS_TO_TRIGGER.read().map(|v| *v).unwrap_or(20)
}

pub fn update_active_persona(persona: PersonaConfig) {
    if let Ok(mut lock) = ACTIVE_PERSONA.write() {
        log::info!("[Agent Core] Persona ativa atualizada para: {} ({})", persona.name, persona.id);
        *lock = persona;
    }
}

pub fn get_active_persona() -> PersonaConfig {
    ACTIVE_PERSONA.read().map(|p| p.clone()).unwrap_or_default()
}

pub fn update_byok_settings(endpoint: Option<String>, api_key: Option<String>, model: Option<String>) {
    if let Ok(mut lock) = BYOK_SETTINGS.write() {
        if let Some(ep) = endpoint {
            if !ep.trim().is_empty() {
                lock.endpoint = ep.trim().to_string();
            }
        }
        if let Some(key) = api_key {
            if !key.trim().is_empty() {
                lock.api_key = key.trim().to_string();
            }
        }
        if let Some(m) = model {
            if !m.trim().is_empty() {
                lock.model = m.trim().to_string();
            }
        }
        log::info!("[Agent Core] Configurações BYOK atualizadas: endpoint={}, model={}", lock.endpoint, lock.model);
    }
}

pub fn set_llm_correction_enabled(enabled: bool) {
    if let Ok(mut lock) = LLM_CORRECTION_ENABLED.write() {
        *lock = enabled;
        log::info!("[Agent Core] Correção de transcrição via LLM: {}", if enabled { "ATIVADA" } else { "DESATIVADA" });
    }
}

pub fn is_llm_correction_enabled() -> bool {
    LLM_CORRECTION_ENABLED.read().map(|v| *v).unwrap_or(true)
}

/// Avalia se a fala finalizada pelo Whisper deve disparar o agente da persona ativa e/ou a autocorreção via LLM
pub fn evaluate_transcription(app_handle: &AppHandle, raw_text: &str, segment_id: &str) {
    let clean = raw_text.trim();
    if clean.is_empty() {
        return;
    }

    let byok = BYOK_SETTINGS.read().map(|b| b.clone()).unwrap_or_default();

    // 1. Pós-processamento e Refinamento Gramatical via LLM (se ativado)
    if is_llm_correction_enabled() && clean.split_whitespace().count() >= 2 {
        let handle = app_handle.clone();
        let byok_clone = byok.clone();
        let seg_id = segment_id.to_string();
        let orig_text = clean.to_string();

        tauri::async_runtime::spawn(async move {
            match super::llm_client::execute_text_correction(&byok_clone, &orig_text).await {
                Ok(corrected) => {
                    let refined = corrected.trim();
                    if !refined.is_empty() && refined != orig_text {
                        if validate_transcription_fidelity(&orig_text, refined) {
                            log::info!("[Agent Core] ✨ Transcrição refinada pela IA ({seg_id}): \"{refined}\"");
                            let _ = handle.emit("stt_transcription_corrected", TranscriptionCorrectedEvent {
                                segment_id: seg_id,
                                text: refined.to_string(),
                                original_text: orig_text,
                            });
                        } else {
                            log::warn!(
                                "[Agent Core] ⚠️ Correção rejeitada por desvio de conteúdo ou alucinação! Original: \"{}\" | Sugestão IA: \"{}\"",
                                orig_text,
                                refined
                            );
                        }
                    }
                }
                Err(e) => {
                    log::warn!("[Agent Core] Falha na correção via LLM: {}", e);
                }
            }
        });
    }

    // 2. Acumulação de Texto e Avaliação de Gatilho da Persona Ativa
    let persona = get_active_persona();
    let min_chars = get_min_chars_to_trigger();

    // Acumula o segmento no buffer
    let accumulated = {
        let mut buf = match PERSONA_TEXT_BUFFER.write() {
            Ok(b) => b,
            Err(_) => return,
        };
        if !buf.is_empty() {
            buf.push(' ');
        }
        buf.push_str(clean);
        buf.clone()
    };

    log::info!(
        "[Agent Core] 📝 Buffer acumulado: {} chars / {} min | \"{}\"",
        accumulated.len(),
        min_chars,
        &accumulated.chars().take(80).collect::<String>()
    );

    // Descarta buffer excessivamente longo sem trigger (evita crescimento infinito)
    if accumulated.len() > 2000 {
        log::warn!("[Agent Core] Buffer excedeu 2000 chars sem disparo. Descartando.");
        if let Ok(mut buf) = PERSONA_TEXT_BUFFER.write() {
            buf.clear();
        }
        return;
    }

    // Ainda não atingiu o mínimo: continua acumulando
    if accumulated.len() < min_chars {
        return;
    }

    // Avalia a condição de trigger no buffer inteiro acumulado
    let lower_accumulated = accumulated.to_lowercase();
    let should_trigger = match persona.trigger_mode.as_str() {
        "hotword" => {
            let hw = persona.hotword.trim().to_lowercase();
            if hw.is_empty() { false } else { lower_accumulated.contains(&hw) }
        }
        "question_only" => {
            accumulated.ends_with('?')
                || lower_accumulated.contains("como ")
                || lower_accumulated.contains("qual ")
                || lower_accumulated.contains("quais ")
                || lower_accumulated.contains("quem ")
                || lower_accumulated.contains("onde ")
                || lower_accumulated.contains("por que ")
                || lower_accumulated.contains("porque ")
                || lower_accumulated.contains("quando ")
                || lower_accumulated.contains("o que ")
        }
        "always" => accumulated.split_whitespace().count() >= 3,
        _ => false,
    };

    if !should_trigger {
        // Em modo hotword/question: continua acumulando aguardando o trigger
        return;
    }

    // Trigger! Captura e limpa o buffer atomicamente
    let user_prompt = accumulated.clone();
    if let Ok(mut buf) = PERSONA_TEXT_BUFFER.write() {
        buf.clear();
    }

    log::info!(
        "[Agent Core] ⚡ Gatilho disparado para Persona '{}' com {} chars: \"{}\"",
        persona.name,
        user_prompt.len(),
        &user_prompt.chars().take(120).collect::<String>()
    );

    let handle = app_handle.clone();
    let persona_clone = persona.clone();

    tauri::async_runtime::spawn(async move {
        // --- Monta contexto de memória ---
        let db_path = MEMORY_DB_PATH.read().map(|p| p.clone()).unwrap_or_default();
        let session_id = get_current_session_id();

        // Obtém referência ao hot buffer (se disponível)
        let hot_buffer_opt = HOT_BUFFER_REF.read().ok().and_then(|r| r.clone());

        // Monta o bloco de contexto consolidado (persona + summaries + ring buffer)
        let memory_context = if !db_path.is_empty() && !session_id.is_empty() {
            if let Some(hot_buf) = hot_buffer_opt {
                build_agent_context(&db_path, &session_id, hot_buf)
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        // RAG: busca chunks mais relevantes da memória para a query atual
        let rag_section = if !db_path.is_empty() {
            let chunks = rag_query(&db_path, &user_prompt, 3);
            if chunks.is_empty() {
                String::new()
            } else {
                format!("\n[MEMÓRIA RELEVANTE - RAG]:\n{}", chunks.join("\n"))
            }
        } else {
            String::new()
        };

        // Monta prompt enriquecido com contexto de memória
        let enriched_prompt = if memory_context.is_empty() {
            user_prompt.clone()
        } else {
            format!(
                "{}{}\n\n[PERGUNTA/FALA ATUAL DO USUÁRIO]:\n{}",
                memory_context, rag_section, user_prompt
            )
        };

        log::info!(
            "[Agent Core] 🧠 Prompt enriquecido com memória ({} chars | RAG: {})",
            enriched_prompt.len(),
            if rag_section.is_empty() { "sem chunks" } else { "com chunks" }
        );

        match super::llm_client::execute_persona_completion(
            &byok,
            &persona_clone,
            &enriched_prompt,
        ).await {
            Ok(reply) => {
                let trimmed = reply.trim();
                if trimmed.is_empty()
                    || trimmed.eq_ignore_ascii_case("[silencio]")
                    || trimmed.eq_ignore_ascii_case("[silêncio]")
                    || trimmed.eq_ignore_ascii_case("silêncio")
                {
                    log::info!("[Agent Core] Resposta da persona foi silenciosa (sem popup).");
                    return;
                }

                if !is_popups_enabled() {
                    log::info!("[Agent Core] Popups desativados pelo usuário (Tray/Configurações). Resposta da persona suprimida.");
                    return;
                }

                let action_id = format!("act_{}", std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0));

                let event_payload = LlmActionTriggered {
                    action_id,
                    persona_id: persona_clone.id,
                    action_type: "popup".to_string(),
                    content: trimmed.to_string(),
                    requires_interaction: false,
                };

                log::info!("[Agent Core] Disparando popup para UI: {}", trimmed);
                let _ = handle.emit("llm_action_triggered", event_payload);
            }
            Err(e) => {
                log::error!("[Agent Core] Erro na execução da LLM: {}", e);
            }
        }
    });
}

/// Remove acentos e caracteres diacríticos comuns em Português
pub fn normalize_char(c: char) -> char {
    match c {
        'á' | 'à' | 'ã' | 'â' | 'ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'õ' | 'ô' | 'ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        _ => c,
    }
}

/// Normaliza uma palavra para minúsculas, sem acentos e sem pontuação
pub fn normalize_word(word: &str) -> String {
    word.chars()
        .flat_map(|c| c.to_lowercase())
        .map(normalize_char)
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// Distância Levenshtein entre duas strings
pub fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let (len_a, len_b) = (a_chars.len(), b_chars.len());

    if len_a == 0 {
        return len_b;
    }
    if len_b == 0 {
        return len_a;
    }

    let mut prev = (0..=len_b).collect::<Vec<usize>>();
    let mut curr = vec![0; len_b + 1];

    for i in 0..len_a {
        curr[0] = i + 1;
        for j in 0..len_b {
            let cost = if a_chars[i] == b_chars[j] { 0 } else { 1 };
            curr[j + 1] = std::cmp::min(
                std::cmp::min(curr[j] + 1, prev[j + 1] + 1),
                prev[j] + cost,
            );
        }
        prev.copy_from_slice(&curr);
    }

    prev[len_b]
}

/// Valida se a transcrição refinada pela IA mantém fielmente o conteúdo e vocabulário da fala original.
/// Rejeita respostas a perguntas, ordens executadas, formalizações excessivas ou alucinações.
pub fn validate_transcription_fidelity(orig: &str, refined: &str) -> bool {
    let orig_clean = orig.trim();
    let ref_clean = refined.trim();

    if orig_clean.is_empty() || ref_clean.is_empty() {
        return false;
    }

    // 1. Detecta recusas ou preâmbulos conversacionais comuns de chatbots
    let ref_lower = ref_clean.to_lowercase();
    let banned_starters = [
        "como um modelo",
        "como uma inteligência",
        "como uma ia",
        "desculpe",
        "sinto muito",
        "não posso",
        "claro, aqui",
        "aqui está",
        "com certeza",
        "olá! como posso",
    ];
    for starter in &banned_starters {
        if ref_lower.starts_with(starter) {
            return false;
        }
    }

    // 2. Extrai palavras normalizadas
    let orig_words: Vec<String> = orig_clean
        .split_whitespace()
        .map(normalize_word)
        .filter(|w| !w.is_empty())
        .collect();

    let ref_words: Vec<String> = ref_clean
        .split_whitespace()
        .map(normalize_word)
        .filter(|w| !w.is_empty())
        .collect();

    if orig_words.is_empty() || ref_words.is_empty() {
        return false;
    }

    let orig_count = orig_words.len();
    let ref_count = ref_words.len();

    // 3. Checagem de contagem de palavras (evita que respostas explicativas ou resumos sejam aceitos)
    if orig_count <= 2 {
        if ref_count > orig_count + 1 || ref_count < 1 {
            return false;
        }
    } else {
        let ratio = ref_count as f32 / orig_count as f32;
        if ratio < 0.60 || ratio > 1.40 {
            return false;
        }
        let diff = (ref_count as isize - orig_count as isize).abs() as usize;
        let max_allowed_diff = std::cmp::max(2, orig_count / 3);
        if diff > max_allowed_diff {
            return false;
        }
    }

    // 4. Checagem de proporção de caracteres
    let orig_len = orig_clean.chars().count();
    let ref_len = ref_clean.chars().count();
    if ref_len > (orig_len * 2) + 10 || (orig_len > 10 && ref_len < orig_len / 2) {
        return false;
    }

    // 5. Checagem de retenção do vocabulário original
    let mut matched_orig = 0;
    let mut used_refined = vec![false; ref_count];

    for orig_w in &orig_words {
        let mut found_idx = None;
        // Match exato após normalização de acentos/minúsculas
        for (j, ref_w) in ref_words.iter().enumerate() {
            if used_refined[j] {
                continue;
            }
            if orig_w == ref_w {
                found_idx = Some(j);
                break;
            }
        }
        // Match aproximado por distância de edição Levenshtein (para cobrir correções ortográficas)
        if found_idx.is_none() {
            for (j, ref_w) in ref_words.iter().enumerate() {
                if used_refined[j] {
                    continue;
                }
                let max_dist = if orig_w.len() <= 3 { 1 } else { 2 };
                if levenshtein_distance(orig_w, ref_w) <= max_dist {
                    found_idx = Some(j);
                    break;
                }
            }
        }

        if let Some(idx) = found_idx {
            used_refined[idx] = true;
            matched_orig += 1;
        }
    }

    let orig_match_ratio = matched_orig as f32 / orig_count as f32;
    if orig_match_ratio < 0.70 {
        return false;
    }

    // Valida também se a saída da IA não foi inundada com palavras novas
    let matched_ref = used_refined.iter().filter(|&&u| u).count();
    let ref_match_ratio = matched_ref as f32 / ref_count as f32;
    if ref_match_ratio < 0.65 {
        return false;
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_correction_punctuation_and_accents() {
        let orig = "como fazer bolo de chocolate";
        let refined = "Como fazer bolo de chocolate?";
        assert!(validate_transcription_fidelity(orig, refined));
    }

    #[test]
    fn test_valid_correction_colloquial_speech() {
        let orig = "a gente ta quase chegando la me espera";
        let refined = "A gente tá quase chegando lá, me espera.";
        assert!(validate_transcription_fidelity(orig, refined));
    }

    #[test]
    fn test_valid_correction_spelling_fix() {
        let orig = "eu axo que ele foi no xoping ontem a tarde";
        let refined = "Eu acho que ele foi no shopping ontem à tarde.";
        assert!(validate_transcription_fidelity(orig, refined));
    }

    #[test]
    fn test_reject_question_answered() {
        let orig = "como fazer bolo de cenoura";
        let refined = "Para fazer bolo de cenoura, você vai precisar de farinha, ovos, açúcar e cenouras raladas.";
        assert!(!validate_transcription_fidelity(orig, refined));
    }

    #[test]
    fn test_reject_command_executed() {
        let orig = "cria uma funcao em python para somar dois numeros";
        let refined = "def somar(a, b):\n    return a + b";
        assert!(!validate_transcription_fidelity(orig, refined));
    }

    #[test]
    fn test_reject_chatbot_preamble() {
        let orig = "ola tudo bem";
        let refined = "Claro, aqui está: Olá, tudo bem?";
        assert!(!validate_transcription_fidelity(orig, refined));
    }

    #[test]
    fn test_reject_excessive_rephrasing() {
        let orig = "a gente foi la no mercado e compramos comida";
        let refined = "Nós dirigimo-nos ao estabelecimento comercial onde adquirimos mantimentos.";
        assert!(!validate_transcription_fidelity(orig, refined));
    }
}

