use tauri::{AppHandle, Emitter};
use serde::Serialize;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;

#[derive(Serialize, Clone, Debug)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_loopback: bool,
    pub default: bool,
}

#[derive(Serialize)]
pub struct CaptureSuccess {
    pub status: String,
    pub active_device_id: String,
}

#[derive(Serialize)]
pub struct CaptureError {
    pub error: String,
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct TranscriptionUpdate {
    pub mode: String,
    pub text: String,
    pub is_final: bool,
    pub segment_id: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct AudioLevelEvent {
    pub rms: f32,
    pub peak: f32,
    pub is_speaking: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct AudioRecordingStats {
    pub duration_seconds: f32,
    pub sample_rate: u32,
    pub rms_level: f32,
    pub peak_level: f32,
    pub sample_count: usize,
    pub timestamp_ms: u128,
}

static RUNNING_FLAG: AtomicBool = AtomicBool::new(false);
static MUTED_FLAG: AtomicBool = AtomicBool::new(false);

// Limiar VAD padrão: 0.005 (ajustável pelo usuário na UI)
static VAD_SENSITIVITY: Lazy<Arc<Mutex<f32>>> = Lazy::new(|| Arc::new(Mutex::new(0.005)));

// Guarda o último segmento de áudio completo (16kHz mono) processado pelo Whisper
static LAST_CAPTURED_AUDIO: Lazy<Arc<Mutex<Option<(Vec<f32>, AudioRecordingStats)>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

pub fn set_audio_mute(muted: bool) {
    MUTED_FLAG.store(muted, Ordering::SeqCst);
}

#[tauri::command]
pub fn set_vad_sensitivity(sensitivity: f32) -> Result<(), String> {
    let clamped = sensitivity.clamp(0.001, 0.05);
    *VAD_SENSITIVITY.lock().unwrap() = clamped;
    log::info!("[Audio Backend] Sensibilidade VAD atualizada para: {}", clamped);
    Ok(())
}

#[tauri::command]
pub fn get_vad_sensitivity() -> f32 {
    *VAD_SENSITIVITY.lock().unwrap()
}

/// Diretório padrão onde gravações de áudio são salvas para diagnóstico
pub fn get_recordings_dir() -> std::path::PathBuf {
    let mut dir = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    dir.push("WhisperAgent");
    dir.push("recordings");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Gera um arquivo WAV padrão PCM 16-bit 16kHz mono a partir dos samples f32
pub fn create_wav_bytes(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let num_channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate: u32 = sample_rate * num_channels as u32 * (bits_per_sample / 8) as u32;
    let block_align: u16 = num_channels * (bits_per_sample / 8);
    let subchunk2_size: u32 = (samples.len() * 2) as u32;
    let chunk_size: u32 = 36 + subchunk2_size;

    let mut wav = Vec::with_capacity(44 + samples.len() * 2);

    // Header RIFF
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&chunk_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");

    // Subchunk "fmt "
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // Subchunk1Size = 16 para PCM
    wav.extend_from_slice(&1u16.to_le_bytes());  // AudioFormat = 1 (PCM linear)
    wav.extend_from_slice(&num_channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&bits_per_sample.to_le_bytes());

    // Subchunk "data"
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&subchunk2_size.to_le_bytes());

    // Conversão de f32 [-1.0, 1.0] para PCM i16
    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let sample_i16 = (clamped * 32767.0) as i16;
        wav.extend_from_slice(&sample_i16.to_le_bytes());
    }

    wav
}

/// Salva os bytes do WAV no disco
fn save_wav_to_disk(wav_bytes: &[u8], filename: &str) -> Option<std::path::PathBuf> {
    let dir = get_recordings_dir();
    let file_path = dir.join(filename);
    if let Err(e) = std::fs::write(&file_path, wav_bytes) {
        log::error!("[Audio Backend] Erro ao gravar WAV em {:?}: {}", file_path, e);
        None
    } else {
        log::info!("[Audio Backend] ✓ Arquivo de áudio gravado com sucesso: {:?}", file_path);
        Some(file_path)
    }
}

/// Retorna os bytes do último arquivo WAV capturado para reprodução no frontend
#[tauri::command]
pub fn get_last_captured_audio() -> Result<Vec<u8>, String> {
    let lock = LAST_CAPTURED_AUDIO.lock().unwrap();
    if let Some((ref samples, _)) = *lock {
        Ok(create_wav_bytes(samples, 16000))
    } else {
        let file_path = get_recordings_dir().join("last_whisper_input.wav");
        if file_path.exists() {
            std::fs::read(&file_path).map_err(|e| format!("Erro ao ler arquivo gravado: {}", e))
        } else {
            Err("Nenhum áudio foi capturado ainda. Fale no microfone para gravar.".into())
        }
    }
}

/// Retorna as estatísticas acústicas do último áudio gravado
#[tauri::command]
pub fn get_audio_recording_stats() -> Result<AudioRecordingStats, String> {
    let lock = LAST_CAPTURED_AUDIO.lock().unwrap();
    if let Some((_, ref stats)) = *lock {
        Ok(stats.clone())
    } else {
        Err("Nenhuma estatística disponível ainda.".into())
    }
}

/// Abre a pasta com as gravações no Windows Explorer
#[tauri::command]
pub fn open_recordings_folder() -> Result<(), String> {
    let dir = get_recordings_dir();
    let path_str = dir.to_string_lossy().to_string();
    log::info!("[Audio Backend] Abrindo pasta de gravações: {}", path_str);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Erro ao abrir pasta: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = opener::open_path(&path_str, None::<&str>);
    }

    Ok(())
}

/// Normaliza o volume do áudio de forma segura para otimizar a acurácia do Whisper
fn normalize_audio(samples: &mut [f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let mut max_peak = 0.0f32;
    let mut sum_sq = 0.0f32;
    for &s in samples.iter() {
        let abs = s.abs();
        if abs > max_peak {
            max_peak = abs;
        }
        sum_sq += s * s;
    }
    let rms = (sum_sq / samples.len() as f32).sqrt();

    // Se o sinal de entrada for fraco (pico menor que 0.45), aplica ganho dinâmico seguro
    if max_peak > 0.002 && max_peak < 0.45 {
        let target_peak = 0.70f32;
        let gain = (target_peak / max_peak).min(5.0); // Limite de 5x (+14 dB)
        for s in samples.iter_mut() {
            *s = (*s * gain).clamp(-1.0, 1.0);
        }
    }
    (rms, max_peak)
}

/// Lista TODOS os dispositivos de áudio do sistema (Microfones e Saídas/Loopback do PC)
#[tauri::command]
pub fn get_available_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let mut devices_list = Vec::new();

    let default_input_name = host.default_input_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();

    if let Ok(input_devices) = host.input_devices() {
        for dev in input_devices {
            if let Ok(name) = dev.name() {
                let is_def = name == default_input_name;
                devices_list.push(AudioDeviceInfo {
                    id: name.clone(),
                    name: name.clone(),
                    is_loopback: false,
                    default: is_def,
                });
            }
        }
    }

    let default_output_name = host.default_output_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();

    if let Ok(output_devices) = host.output_devices() {
        for dev in output_devices {
            if let Ok(name) = dev.name() {
                let is_def = name == default_output_name;
                devices_list.push(AudioDeviceInfo {
                    id: format!("loopback:{}", name),
                    name: format!("Som do Sistema: {}", name),
                    is_loopback: true,
                    default: is_def,
                });
            }
        }
    }

    Ok(devices_list)
}

/// Inicia ou troca a captura em qualquer fonte de áudio selecionada (Hot-swapping)
#[tauri::command]
pub async fn start_audio_capture(
    app_handle: AppHandle,
    device_id: String,
    _sample_rate: u32,
    _channels: u16,
    _format: String,
) -> Result<CaptureSuccess, CaptureError> {
    log::info!("[Audio Backend] >> Solicitada troca/início na fonte: {}", device_id);

    // 1. Sinaliza parada da thread anterior
    RUNNING_FLAG.store(false, Ordering::SeqCst);
    std::thread::sleep(std::time::Duration::from_millis(150));

    let host = cpal::default_host();
    let is_loopback = device_id.starts_with("loopback:");

    let device = if is_loopback {
        let clean_name = device_id.trim_start_matches("loopback:");
        host.output_devices()
            .ok()
            .and_then(|mut devs| devs.find(|d| d.name().map(|n| n == clean_name).unwrap_or(false)))
            .or_else(|| host.default_output_device())
    } else if device_id != "default" && !device_id.is_empty() {
        host.input_devices()
            .ok()
            .and_then(|mut devs| devs.find(|d| d.name().map(|n| n == device_id).unwrap_or(false)))
            .or_else(|| host.default_input_device())
    } else {
        host.default_input_device()
    };

    let device = match device {
        Some(d) => d,
        None => {
            log::error!("[Audio Backend] Dispositivo de áudio não encontrado!");
            return Err(CaptureError {
                error: "NO_DEVICE".into(),
                message: "Nenhum dispositivo encontrado.".into(),
            });
        }
    };

    let device_name = device.name().unwrap_or_else(|_| "Dispositivo de Áudio".into());
    log::info!("[Audio Backend] Dispositivo selecionado e ativo: {}", device_name);

    let default_config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            match device.default_output_config() {
                Ok(oc) => oc.into(),
                Err(_) => {
                    log::error!("[Audio Backend] Erro na configuração do dispositivo: {}", e);
                    return Err(CaptureError {
                        error: "CONFIG_ERROR".into(),
                        message: format!("Erro ao configurar áudio: {}", e),
                    });
                }
            }
        }
    };

    let stream_handle = app_handle.clone();
    let thread_device_name = device_name.clone();
    let num_channels = default_config.channels() as usize;
    let src_rate = default_config.sample_rate().0 as f32;

    RUNNING_FLAG.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        let err_fn = |err| {
            log::error!("[Audio Backend] Erro no stream CPAL: {}", err);
        };

        let mut speech_buffer: Vec<f32> = Vec::new();
        let mut pre_roll_buffer: std::collections::VecDeque<f32> = std::collections::VecDeque::new();
        let max_preroll_samples = (src_rate * 0.30) as usize; // ~300ms de pre-roll para não cortar início
        let silence_threshold_samples = (src_rate * 0.35) as usize; // ~350ms de silêncio para fechar sentença com baixa latência
        let min_speech_samples = (src_rate * 0.25) as usize; // Mínimo 250ms de áudio para acionar o Whisper

        let mut silence_samples = 0usize;
        let mut is_speaking = false;
        let mut samples_since_partial = 0usize;
        let mut last_level_emit = std::time::Instant::now();

        let is_transcribing = std::sync::Arc::new(AtomicBool::new(false));

        let channels = num_channels;
        let rate = src_rate;
        let callback_handle = stream_handle.clone();

        // Helper para resampling linear
        let resample_audio = move |samples: &[f32]| -> Vec<f32> {
            if samples.is_empty() {
                return Vec::new();
            }
            let target_rate = 16000.0f32;
            let ratio = rate / target_rate;
            let target_len = (samples.len() as f32 / ratio) as usize;
            let mut resampled = Vec::with_capacity(target_len);
            for i in 0..target_len {
                let src_idx = i as f32 * ratio;
                let idx0 = src_idx.floor() as usize;
                let idx1 = (idx0 + 1).min(samples.len() - 1);
                let frac = src_idx - idx0 as f32;
                if idx0 < samples.len() {
                    resampled.push(samples[idx0] + frac * (samples[idx1] - samples[idx0]));
                }
            }
            resampled
        };

        let stream = device.build_input_stream(
            &default_config.into(),
            move |data: &[f32], _: &_| {
                if !RUNNING_FLAG.load(Ordering::SeqCst) || MUTED_FLAG.load(Ordering::SeqCst) {
                    return;
                }

                // 1. Downmix para mono se for estéreo/multicanal
                let mono_data: Vec<f32> = if channels > 1 {
                    data.chunks(channels)
                        .map(|frame| {
                            let sum: f32 = frame.iter().sum();
                            sum / channels as f32
                        })
                        .collect()
                } else {
                    data.to_vec()
                };

                if mono_data.is_empty() {
                    return;
                }

                // 2. Calcular RMS energy e Peak para VAD e VU Meter
                let mut max_peak = 0.0f32;
                let mut sum_sq = 0.0f32;
                for &s in &mono_data {
                    let abs = s.abs();
                    if abs > max_peak {
                        max_peak = abs;
                    }
                    sum_sq += s * s;
                }
                let rms: f32 = (sum_sq / mono_data.len() as f32).sqrt();

                // Emite periodicamente (~80ms) o nível para o VU meter na janela de configurações
                if last_level_emit.elapsed().as_millis() >= 80 {
                    last_level_emit = std::time::Instant::now();
                    let _ = callback_handle.emit("audio_level_meter", AudioLevelEvent {
                        rms,
                        peak: max_peak,
                        is_speaking,
                    });
                }

                let current_threshold = *VAD_SENSITIVITY.lock().unwrap();

                // 3. Gerenciamento do VAD com buffer contínuo e pre-roll
                if !is_speaking {
                    // Mantém pre-roll circular enquanto está em silêncio
                    for &s in &mono_data {
                        pre_roll_buffer.push_back(s);
                    }
                    while pre_roll_buffer.len() > max_preroll_samples {
                        pre_roll_buffer.pop_front();
                    }

                    // Se ultrapassou o limiar, INICIA a fala
                    if rms > current_threshold {
                        is_speaking = true;
                        silence_samples = 0;
                        samples_since_partial = 0;
                        speech_buffer.clear();

                        // Incorpora o pre-roll para não perder o início da palavra
                        speech_buffer.extend(pre_roll_buffer.drain(..));
                        speech_buffer.extend_from_slice(&mono_data);
                    }
                } else {
                    // JÁ ESTÁ FALANDO: Sempre adiciona TODAS as amostras (preserva pausas naturais e consoantes)
                    speech_buffer.extend_from_slice(&mono_data);
                    samples_since_partial += mono_data.len();

                    if rms > current_threshold {
                        silence_samples = 0;
                    } else {
                        silence_samples += mono_data.len();
                    }

                    // A cada ~800ms de fala contínua, decodifica pequena fatia recente (~2s) para HUD ao vivo
                    let partial_trigger_samples = (rate * 0.8) as usize;
                    if samples_since_partial >= partial_trigger_samples && speech_buffer.len() >= partial_trigger_samples {
                        samples_since_partial = 0;

                        if !is_transcribing.swap(true, Ordering::SeqCst) {
                            // Envia no máximo os últimos 2.0 segundos (em vez de 6s) para decodificação ultra rápida em CPU
                            let max_partial_samples = (rate * 2.0) as usize;
                            let start_idx = if speech_buffer.len() > max_partial_samples {
                                speech_buffer.len() - max_partial_samples
                            } else {
                                0
                            };
                            let slice = speech_buffer[start_idx..].to_vec();
                            let mut resampled = resample_audio(&slice);
                            normalize_audio(&mut resampled);

                            let emit_handle = callback_handle.clone();
                            let busy_flag = is_transcribing.clone();

                            std::thread::spawn(move || {
                                let text = super::stt::transcribe_audio_buffer(&resampled, true);
                                busy_flag.store(false, Ordering::SeqCst);
                                let clean = text.trim();
                                if !clean.is_empty()
                                    && clean != "[música]"
                                    && clean != "[Música]"
                                    && clean != "( Música )"
                                    && clean != "..."
                                    && clean != ".."
                                    && clean != "."
                                {
                                    let _ = emit_handle.emit("stt_transcription_update", TranscriptionUpdate {
                                        mode: "live".into(),
                                        text: clean.to_string(),
                                        is_final: false,
                                        segment_id: None,
                                    });
                                }
                            });
                        }
                    }

                    // Prevenção de buffer infinito em áudios longos contínuos (>12 segundos)
                    let max_continuous_samples = (rate * 12.0) as usize;
                    if speech_buffer.len() > max_continuous_samples {
                        let continuous_slice = speech_buffer.clone();
                        let emit_handle = callback_handle.clone();

                        std::thread::spawn(move || {
                            let mut resampled = resample_audio(&continuous_slice);
                            let (final_rms, final_peak) = normalize_audio(&mut resampled);

                            let stats = AudioRecordingStats {
                                duration_seconds: resampled.len() as f32 / 16000.0,
                                sample_rate: 16000,
                                rms_level: final_rms,
                                peak_level: final_peak,
                                sample_count: resampled.len(),
                                timestamp_ms: std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .map(|d| d.as_millis())
                                    .unwrap_or(0),
                            };
                            let wav = create_wav_bytes(&resampled, 16000);
                            save_wav_to_disk(&wav, "last_whisper_input.wav");
                            *LAST_CAPTURED_AUDIO.lock().unwrap() = Some((resampled.clone(), stats.clone()));
                            let _ = emit_handle.emit("audio_capture_finalized", stats);

                            let text = super::stt::transcribe_audio_buffer(&resampled, false);
                            let clean = text.trim();
                            if !clean.is_empty() && clean != "..." {
                                let seg_id = format!("seg_{}", std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .map(|d| d.as_millis())
                                    .unwrap_or(0));
                                let _ = emit_handle.emit("stt_transcription_update", TranscriptionUpdate {
                                    mode: "whisper".into(),
                                    text: clean.to_string(),
                                    is_final: true,
                                    segment_id: Some(seg_id.clone()),
                                });
                                crate::agent::core::evaluate_transcription(&emit_handle, clean, &seg_id);
                            }
                        });

                        // Mantém sobreposição de 1.5s para continuidade
                        let overlap_samples = (rate * 1.5) as usize;
                        let keep_idx = speech_buffer.len() - overlap_samples;
                        speech_buffer = speech_buffer[keep_idx..].to_vec();
                        samples_since_partial = 0;
                        silence_samples = 0;
                    }

                    // Se atingiu o silêncio contínuo necessário para fechar a sentença (~550ms)
                    if silence_samples >= silence_threshold_samples {
                        is_speaking = false;
                        silence_samples = 0;
                        samples_since_partial = 0;

                        if speech_buffer.len() >= min_speech_samples {
                            // Deixa um pequeno tail natural de silêncio (~100ms) e apara excessos
                            let tail_samples = (rate * 0.10) as usize;
                            if speech_buffer.len() > silence_threshold_samples {
                                let trim_amount = silence_threshold_samples.saturating_sub(tail_samples);
                                speech_buffer.truncate(speech_buffer.len() - trim_amount);
                            }

                            // Mover todo o processamento pesado (resampling, normalização, gravação no disco, Whisper)
                            // para fora da thread de áudio CPAL do SO, evitando buffer overflow/dropouts no microfone!
                            let raw_samples = speech_buffer.clone();
                            let emit_handle = callback_handle.clone();

                            std::thread::spawn(move || {
                                let mut resampled = resample_audio(&raw_samples);
                                let (final_rms, final_peak) = normalize_audio(&mut resampled);

                                let stats = AudioRecordingStats {
                                    duration_seconds: resampled.len() as f32 / 16000.0,
                                    sample_rate: 16000,
                                    rms_level: final_rms,
                                    peak_level: final_peak,
                                    sample_count: resampled.len(),
                                    timestamp_ms: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .map(|d| d.as_millis())
                                        .unwrap_or(0),
                                };

                                let wav = create_wav_bytes(&resampled, 16000);
                                save_wav_to_disk(&wav, "last_whisper_input.wav");
                                *LAST_CAPTURED_AUDIO.lock().unwrap() = Some((resampled.clone(), stats.clone()));
                                let _ = emit_handle.emit("audio_capture_finalized", stats);

                                let text = super::stt::transcribe_audio_buffer(&resampled, false);

                                let clean = text.trim();
                                if !clean.is_empty()
                                    && clean != "[música]"
                                    && clean != "[Música]"
                                    && clean != "( Música )"
                                    && clean != "..."
                                    && clean != ".."
                                    && clean != "."
                                {
                                    let seg_id = format!("seg_{}", std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .map(|d| d.as_millis())
                                        .unwrap_or(0));
                                    let _ = emit_handle.emit("stt_transcription_update", TranscriptionUpdate {
                                        mode: "whisper".into(),
                                        text: clean.to_string(),
                                        is_final: true,
                                        segment_id: Some(seg_id.clone()),
                                    });
                                    let now_ms = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .map(|d| d.as_millis() as u64)
                                        .unwrap_or(0);
                                    crate::memory::ring_buffer::push_to_global_ring_buffer(
                                        crate::memory::ring_buffer::AudioSegment {
                                            id: seg_id.clone(),
                                            timestamp: now_ms,
                                            text: clean.to_string(),
                                            duration_ms: 0,
                                        }
                                    );
                                    crate::agent::core::evaluate_transcription(&emit_handle, &clean, &seg_id);
                                }
                            });
                        }

                        speech_buffer.clear();
                    }
                }
            },
            err_fn,
            None,
        );

        match stream {
            Ok(s) => {
                let _ = s.play();
                log::info!("[Audio Backend] ✓ Captura ATIVA com sucesso em: {}", thread_device_name);

                while RUNNING_FLAG.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                log::info!("[Audio Backend] Stream anterior desligado.");
            }
            Err(e) => {
                log::error!("[Audio Backend] Falha ao abrir stream de áudio: {}", e);
            }
        }
    });

    Ok(CaptureSuccess {
        status: "capturing".into(),
        active_device_id: device_name,
    })
}

/// Interrompe a captura de áudio ativa imediatamente
#[tauri::command]
pub fn stop_audio_capture() -> Result<(), String> {
    log::info!("[Audio Backend] >> Solicitada parada da captura de áudio");
    RUNNING_FLAG.store(false, Ordering::SeqCst);
    Ok(())
}
