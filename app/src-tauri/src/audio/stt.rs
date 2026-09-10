use tauri::AppHandle;
use serde::Serialize;
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};

#[derive(Serialize)]
pub struct InitWhisperSuccess {
    pub status: String,
    pub model_path: String,
}

#[derive(Serialize)]
pub struct InitWhisperError {
    pub error: String,
    pub message: String,
}

#[derive(Serialize, Clone)]
pub struct TranscriptionResultEvent {
    pub text: String,
    pub is_final: bool,
    pub confidence_score: f64,
}

use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;

static CURRENT_MODEL: Lazy<Arc<Mutex<String>>> = Lazy::new(|| Arc::new(Mutex::new("tiny-q5_1".to_string())));

static WHISPER_CTX: Lazy<Arc<Mutex<Option<WhisperContext>>>> = Lazy::new(|| {
    let tiny_q5_path = super::setup::model_path_for("tiny-q5_1");
    let base_q5_path = super::setup::model_path_for("base-q5_1");
    let tiny_path = super::setup::model_path_for("tiny");
    let base_path = super::setup::model_path_for("base");

    let (chosen_model, model_path) = if tiny_q5_path.exists() {
        ("tiny-q5_1", tiny_q5_path)
    } else if base_q5_path.exists() {
        ("base-q5_1", base_q5_path)
    } else if tiny_path.exists() {
        ("tiny", tiny_path)
    } else if base_path.exists() {
        ("base", base_path)
    } else {
        ("tiny-q5_1", tiny_q5_path)
    };

    *CURRENT_MODEL.lock().unwrap() = chosen_model.to_string();

    log::info!("[Whisper STT] Tentando carregar modelo Whisper ({}) com aceleração GPU/CUDA...", chosen_model);
    let mut gpu_params = WhisperContextParameters::default();
    gpu_params.use_gpu(true);

    let ctx = match WhisperContext::new_with_params(model_path.as_path(), gpu_params) {
        Ok(c) => {
            log::info!("[Whisper STT] ✓ Modelo Whisper ({}) carregado com sucesso (GPU/CUDA acelerado)!", chosen_model);
            Some(c)
        }
        Err(err) => {
            log::warn!("[Whisper STT] GPU/CUDA indisponível ({:?}). Fazendo fallback automático para CPU...", err);
            let mut cpu_params = WhisperContextParameters::default();
            cpu_params.use_gpu(false);
            match WhisperContext::new_with_params(model_path.as_path(), cpu_params) {
                Ok(c) => {
                    log::info!("[Whisper STT] ✓ Modelo Whisper ({}) carregado em modo CPU!", chosen_model);
                    Some(c)
                }
                Err(e) => {
                    log::error!("[Whisper STT] Falha ao carregar modelo Whisper tanto em GPU quanto em CPU: {:?}", e);
                    None
                }
            }
        }
    };
    Arc::new(Mutex::new(ctx))
});

pub fn preload_model() {
    drop(WHISPER_CTX.lock().unwrap());
}

pub fn load_context_for_model(model_name: &str) -> Result<(), String> {
    let path = super::setup::model_path_for(model_name);
    if !path.exists() {
        return Err(format!("Arquivo do modelo {:?} não encontrado.", path));
    }
    log::info!("[Whisper STT] Recarregando motor com modelo: {} (tentando GPU/CUDA)", model_name);
    let mut gpu_params = WhisperContextParameters::default();
    gpu_params.use_gpu(true);

    let new_ctx = match WhisperContext::new_with_params(path.as_path(), gpu_params) {
        Ok(c) => {
            log::info!("[Whisper STT] ✓ Motor Whisper atualizado com sucesso: {} (aceleração GPU/CUDA ativa)", model_name);
            c
        }
        Err(err) => {
            log::warn!("[Whisper STT] GPU indisponível ({:?}), alternando para CPU...", err);
            let mut cpu_params = WhisperContextParameters::default();
            cpu_params.use_gpu(false);
            WhisperContext::new_with_params(path.as_path(), cpu_params)
                .map_err(|e| format!("Falha ao carregar modelo {} na GPU e CPU: {:?}", model_name, e))?
        }
    };

    let mut lock = WHISPER_CTX.lock().unwrap();
    *lock = Some(new_ctx);
    let mut model_lock = CURRENT_MODEL.lock().unwrap();
    *model_lock = model_name.to_string();

    Ok(())
}

/// Executa a transcrição real do buffer de áudio capturado
pub fn transcribe_audio_buffer(audio_samples: &[f32], is_partial: bool) -> String {
    if audio_samples.is_empty() {
        return String::new();
    }

    let mut state = {
        let ctx_lock = WHISPER_CTX.lock().unwrap();
        let ctx = match ctx_lock.as_ref() {
            Some(c) => c,
            None => {
                log::error!("[Whisper STT] Contexto Whisper não carregado.");
                return String::new();
            }
        };

        match ctx.create_state() {
            Ok(s) => s,
            Err(_) => return String::new(),
        }
    }; // Lock liberado aqui! Múltiplas threads não disputam o contexto.

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("pt"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);

    // Para inferência em CPU, o ideal são de 4 a 6 threads para evitar contenção de cache L3 e context-switch
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(6) as i32;
    params.set_n_threads(threads);

    if is_partial {
        params.set_single_segment(true);
        params.set_no_speech_thold(0.6);
        params.set_no_context(true);
        params.set_max_tokens(32);
    } else {
        params.set_single_segment(false);
        params.set_no_speech_thold(0.5);
        params.set_initial_prompt("Transcrição de fala em português do Brasil, pontuação e acentuação.");
    }

    if state.full(params, audio_samples).is_err() {
        return String::new();
    }

    let mut result_text = String::new();
    let num_segments = state.full_n_segments();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            result_text.push_str(&segment.to_string());
            result_text.push(' ');
        }
    }

    result_text.trim().to_string()
}

#[tauri::command]
pub async fn set_whisper_model(
    app_handle: AppHandle,
    model_name: String,
) -> Result<String, String> {
    let lower = model_name.to_lowercase();
    let clean_name = if lower.contains("tiny") && lower.contains("q5") {
        "tiny-q5_1"
    } else if lower.contains("base") && lower.contains("q5") {
        "base-q5_1"
    } else if lower.contains("base") {
        "base"
    } else {
        "tiny"
    };

    let handle = app_handle.clone();
    let name_str = clean_name.to_string();

    tokio::task::spawn_blocking(move || {
        super::setup::download_model_if_needed(&handle, &name_str)
    })
    .await
    .map_err(|e| e.to_string())??;

    load_context_for_model(clean_name)?;

    Ok(clean_name.to_string())
}

#[tauri::command]
pub fn get_current_whisper_model() -> String {
    CURRENT_MODEL.lock().unwrap().clone()
}

#[tauri::command]
pub async fn init_whisper_engine(
    app_handle: AppHandle,
    model_type: String,
    _repo_id: String,
    _filename: String,
) -> Result<InitWhisperSuccess, InitWhisperError> {
    log::info!("[Whisper STT Backend] Inicializando motor Whisper ({})", model_type);
    let lower = model_type.to_lowercase();
    let chosen = if lower.contains("tiny") && lower.contains("q5") {
        "tiny-q5_1"
    } else if lower.contains("base") && lower.contains("q5") {
        "base-q5_1"
    } else if lower.contains("base") {
        "base"
    } else {
        "tiny"
    };

    let _ = set_whisper_model(app_handle, chosen.to_string()).await;
    let path = super::setup::model_path_for(chosen);

    Ok(InitWhisperSuccess {
        status: "ready".into(),
        model_path: path.to_string_lossy().into_owned(),
    })
}
