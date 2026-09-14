use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

pub struct ModelConfig {
    pub filename: &'static str,
    pub url: &'static str,
    pub size_bytes: u64,
}

pub fn get_model_config(name: &str) -> ModelConfig {
    let lower = name.to_lowercase();
    if lower.contains("tiny") && lower.contains("q5") {
        ModelConfig {
            filename: "ggml-tiny-q5_1.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin",
            size_bytes: 32_500_000, // ~31 MB
        }
    } else if lower.contains("base") && lower.contains("q5") {
        ModelConfig {
            filename: "ggml-base-q5_1.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin",
            size_bytes: 58_700_000, // ~57 MB
        }
    } else if lower.contains("tiny") {
        ModelConfig {
            filename: "ggml-tiny.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
            size_bytes: 77_700_000, // ~75 MB
        }
    } else if lower.contains("large") {
        ModelConfig {
            filename: "ggml-large-v3-q5_0.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin",
            size_bytes: 1_120_000_000, // ~1.1 GB
        }
    } else {
        ModelConfig {
            filename: "ggml-base.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
            size_bytes: 148_506_831, // ~148 MB
        }
    }
}

/// Retorna o caminho local de um modelo Whisper
pub fn model_path_for(name: &str) -> PathBuf {
    let cfg = get_model_config(name);
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut p = base.clone();
    p.push("WhisperAgent");
    p.push("models");
    p.push(cfg.filename);

    // Fallback: se o arquivo já existir no diretório legado WisperAgent, reutiliza-o
    if !p.exists() {
        let mut legacy_p = base;
        legacy_p.push("WisperAgent");
        legacy_p.push("models");
        legacy_p.push(cfg.filename);
        if legacy_p.exists() {
            return legacy_p;
        }
    }

    p
}

/// Caminho padrão (compatibilidade)
pub fn model_path() -> PathBuf {
    model_path_for("tiny")
}

/// Baixa o modelo caso não exista localmente (síncrono, para rodar em thread ou spawn_blocking)
pub fn download_model_if_needed(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let cfg = get_model_config(name);
    let path = model_path_for(name);

    if path.exists() && path.metadata().map(|m| m.len()).unwrap_or(0) > (cfg.size_bytes * 95 / 100) {
        log::info!("[Whisper Setup] Modelo '{}' já existe localmente: {:?}", cfg.filename, path);
        let _ = app.emit("whisper_model_download", DownloadEvent {
            id: name.to_string(),
            status: "ready".into(),
            progress: 100,
            message: format!("Modelo Whisper {} pronto!", name),
        });
        return Ok(path);
    }

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let friendly_size = format!("~{:.0} MB", cfg.size_bytes as f64 / (1024.0 * 1024.0));
    let _ = app.emit("whisper_model_download", DownloadEvent {
            id: name.to_string(),
        status: "downloading".into(),
        progress: 0,
        message: format!("Baixando Whisper {} ({})...", name.to_uppercase(), friendly_size),
    });

    log::info!("[Whisper Setup] Iniciando download de {} de {}", cfg.filename, cfg.url);

    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?
        .get(cfg.url)
        .send()
        .map_err(|e| {
            let _ = app.emit("whisper_model_download", DownloadEvent {
            id: name.to_string(),
                status: "error".into(),
                progress: 0,
                message: format!("Erro ao conectar para baixar modelo: {}", e),
            });
            e.to_string()
        })?;

    use std::io::{Read, Write};
    let mut file = std::fs::File::create(&path).map_err(|e| {
        let _ = app.emit("whisper_model_download", DownloadEvent {
            id: name.to_string(),
            status: "error".into(),
            progress: 0,
            message: format!("Erro ao criar arquivo: {}", e),
        });
        e.to_string()
    })?;

    let mut downloaded: u64 = 0;
    let mut last_reported_pct: i32 = -1;
    let mut buf = [0u8; 65536];
    let mut body = resp;

    loop {
        match body.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if file.write_all(&buf[..n]).is_err() {
                    break;
                }
                downloaded += n as u64;
                let pct = ((downloaded as f64 / cfg.size_bytes as f64) * 100.0) as i32;
                let pct = pct.min(99);

                if pct != last_reported_pct {
                    last_reported_pct = pct;
                    let downloaded_mb = downloaded as f64 / 1_048_576.0;
                    let total_mb = cfg.size_bytes as f64 / 1_048_576.0;
                    let _ = app.emit("whisper_model_download", DownloadEvent {
            id: name.to_string(),
                        status: "downloading".into(),
                        progress: pct as u32,
                        message: format!("Baixando Whisper {}... {}% ({:.1} MB / {:.1} MB)", name.to_uppercase(), pct, downloaded_mb, total_mb),
                    });
                }
            }
            Err(e) => {
                let _ = std::fs::remove_file(&path);
                return Err(format!("Falha no download: {}", e));
            }
        }
    }

    let final_size = path.metadata().map(|m| m.len()).unwrap_or(0);
    if final_size > (cfg.size_bytes / 2) {
        log::info!("[Whisper Setup] Download concluído com sucesso: {:?}", path);
        let _ = app.emit("whisper_model_download", DownloadEvent {
            id: name.to_string(),
            status: "ready".into(),
            progress: 100,
            message: format!("Modelo Whisper {} pronto!", name.to_uppercase()),
        });
        Ok(path)
    } else {
        let _ = std::fs::remove_file(&path);
        let _ = app.emit("whisper_model_download", DownloadEvent {
            id: name.to_string(),
            status: "error".into(),
            progress: 0,
            message: "Download incompleto. Tente novamente.".into(),
        });
        Err("Download incompleto".into())
    }
}

/// Verifica e baixa o modelo inicial (padrão Tiny para inicialização ultra rápida)
pub fn ensure_model(app: AppHandle) {
    std::thread::spawn(move || {
        let _ = download_model_if_needed(&app, "tiny");
    });
}

#[derive(Clone, serde::Serialize)]
pub struct DownloadEvent {
    pub id: String,
    pub status: String,
    pub progress: u32,
    pub message: String,
}
