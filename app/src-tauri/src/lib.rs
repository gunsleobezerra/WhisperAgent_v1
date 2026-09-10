pub mod audio;
pub mod agent;
pub mod memory;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter,
    Manager,
};

use memory::{
    db::init_db,
    session::init_session,
    ring_buffer::{HotRingBuffer, AudioSegment},
    summarizer::rolling_summarizer_worker,
    rag::embedding_worker,
};
use agent::core::HOT_BUFFER_REF;


#[tauri::command]
async fn request_open_settings(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[Window Manager] >> Solicitada abertura da Janela de Configurações");
    if let Some(window) = app.get_webview_window("main") {
        log::info!("[Window Manager] Janela 'main' existente encontrada, exibindo...");
        let _ = window.set_shadow(false);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    } else {
        log::info!("[Window Manager] Criando nova janela 'main' de configurações...");
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            "main",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("WhisperAgent - Configurações")
        .inner_size(780.0, 560.0)
        .min_inner_size(680.0, 480.0)
        .resizable(true)
        .transparent(true)
        .always_on_top(true)
        .decorations(false)
        .shadow(false)
        .center();

        match builder.build() {
            Ok(w) => {
                log::info!("[Window Manager] ✓ Janela de configurações criada com sucesso.");
                let _ = w.set_focus();
            }
            Err(e) => {
                log::error!("[Window Manager] ❌ Falha ao criar janela de configurações: {}", e);
                return Err(format!("Erro ao criar janela: {}", e));
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn request_open_session_summary(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[Window Manager] >> Solicitada abertura da Janela de Sumário da Sessão");
    if let Some(window) = app.get_webview_window("session-summary") {
        log::info!("[Window Manager] Janela 'session-summary' existente encontrada, exibindo...");
        let _ = window.set_shadow(false);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    } else {
        log::info!("[Window Manager] Criando nova janela 'session-summary'...");
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            "session-summary",
            tauri::WebviewUrl::App("index.html?window=session-summary".into()),
        )
        .title("WhisperAgent - Sumário da Sessão")
        .inner_size(680.0, 560.0)
        .min_inner_size(480.0, 380.0)
        .resizable(true)
        .transparent(true)
        .always_on_top(true)
        .decorations(false)
        .shadow(false)
        .center();

        match builder.build() {
            Ok(w) => {
                log::info!("[Window Manager] ✓ Janela de sumário criada com sucesso.");
                let _ = w.set_focus();
            }
            Err(e) => {
                log::error!("[Window Manager] ❌ Falha ao criar janela de sumário: {}", e);
                return Err(format!("Erro ao criar janela de sumário: {}", e));
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn hide_session_summary(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[Window Manager] >> Fechando Janela de Sumário");
    if let Some(window) = app.get_webview_window("session-summary") {
        let _ = window.close();
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct CurrentSessionDetailsResponse {
    session_id: String,
    created_at: i64,
    active_persona: String,
    summaries: Vec<crate::memory::db::SummaryRecord>,
}

#[tauri::command]
fn get_current_session_details() -> Result<CurrentSessionDetailsResponse, String> {
    let session_id = crate::memory::session::get_current_session_id();
    let db_path = crate::agent::core::MEMORY_DB_PATH.read().map(|p| p.clone()).unwrap_or_default();
    
    if db_path.is_empty() || session_id.is_empty() {
        return Ok(CurrentSessionDetailsResponse {
            session_id,
            created_at: 0,
            active_persona: crate::agent::core::get_active_persona().name,
            summaries: vec![],
        });
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Erro ao abrir conexão com banco de dados: {}", e))?;

    let mut created_at = 0i64;
    let mut active_persona = crate::agent::core::get_active_persona().name;

    if let Ok(mut stmt) = conn.prepare("SELECT created_at, active_persona FROM sessions WHERE id = ?1") {
        if let Ok(row) = stmt.query_row(rusqlite::params![session_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        }) {
            created_at = row.0;
            active_persona = row.1;
        }
    }

    let summaries = crate::memory::db::get_session_summaries(&conn, &session_id)
        .unwrap_or_default();

    Ok(CurrentSessionDetailsResponse {
        session_id,
        created_at,
        active_persona,
        summaries,
    })
}

#[tauri::command]
async fn hide_settings(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[Window Manager] >> Fechando Janela de Configurações");
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
fn minimize_overlay(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[Window Manager] >> Minimizando Overlay");
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.minimize();
    }
    Ok(())
}

#[tauri::command]
fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[Window Manager] >> Ocultando Overlay");
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
fn get_active_persona() -> Result<crate::agent::core::PersonaConfig, String> {
    Ok(crate::agent::core::get_active_persona())
}

#[tauri::command]
fn set_active_persona(persona: crate::agent::core::PersonaConfig) -> Result<(), String> {
    let persona_name = persona.name.clone();
    crate::agent::core::update_active_persona(persona);
    let db_path = crate::agent::core::MEMORY_DB_PATH.read().map(|p| p.clone()).unwrap_or_default();
    if !db_path.is_empty() {
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            crate::memory::session::update_session_persona(&conn, &persona_name);
        }
    }
    Ok(())
}

#[tauri::command]
fn create_new_session() -> Result<String, String> {
    log::info!("[Session] >> Solicitada criação manual de nova sessão via UI...");
    let db_path = crate::agent::core::MEMORY_DB_PATH.read().map(|p| p.clone()).unwrap_or_default();
    if db_path.is_empty() {
        return Err("Caminho do banco de dados SQLite não inicializado".into());
    }

    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Erro ao abrir conexão com banco de dados: {}", e))?;

    let current_persona = crate::agent::core::get_active_persona();
    let new_id = crate::memory::session::init_session(&conn, &current_persona.name)
        .map_err(|e| format!("Erro ao criar nova sessão: {}", e))?;

    // Limpa o hot buffer em memória para começar novo contexto limpo
    crate::memory::ring_buffer::clear_global_ring_buffer();

    log::info!("[Session] ✅ Nova sessão criada com sucesso via botão: {}", new_id);
    Ok(new_id)
}

#[tauri::command]
async fn force_summarize_now(app: tauri::AppHandle) -> Result<crate::memory::db::SummaryRecord, String> {
    log::info!("[Summarizer] ⚡ Forçando consolidação de resumo imediata solicitada pelo usuário...");
    let session_id = crate::memory::session::get_current_session_id();
    let db_path = crate::agent::core::MEMORY_DB_PATH.read().map(|p| p.clone()).unwrap_or_default();
    
    if db_path.is_empty() || session_id.is_empty() {
        return Err("Sessão ou banco de dados não inicializados".into());
    }

    // Drena tudo que estiver acumulado no ring buffer recente
    let drained = crate::memory::ring_buffer::drain_all_global_ring_buffer();
    if drained.is_empty() {
        return Err("Não há áudio recente no buffer para resumir".into());
    }

    let texts: Vec<String> = drained.into_iter().map(|s| s.text).collect();
    let text_to_summarize = texts.join(" ");
    if text_to_summarize.trim().is_empty() {
        return Err("Buffer recente não contém texto significativo".into());
    }

    let byok = crate::agent::core::BYOK_SETTINGS.read().map(|b| b.clone()).unwrap_or_default();

    // Se tiver endpoint configurado tenta LLM, senão usa síntese de sentenças
    let summary_result = if !byok.endpoint.trim().is_empty() {
        let system_prompt = "Você é um assistente de síntese de contexto. \
Recebe blocos de transcrição de áudio e extrai os fatos, tópicos e informações \
essenciais em bullet points concisos em Português do Brasil. \
REGRAS: \
(1) Máximo de 4 bullet points por bloco. \
(2) Preserve nomes próprios, números e termos técnicos exatamente. \
(3) Não adicione comentários, introduções ou conclusões. \
(4) Use formato: '- [fato ou tópico]'. \
(5) Sintetize a essência do que foi falado.";

        let user_prompt = format!("Transcrição:\n{}", text_to_summarize);
        crate::agent::llm_client::execute_chat_completion(&byok, system_prompt, &user_prompt, 0.3, 300).await
    } else {
        Err("Sem endpoint BYOK configurado".into())
    };

    let summary = match summary_result {
        Ok(s) => s,
        Err(_) => {
            let clean = text_to_summarize.trim();
            let sentences: Vec<&str> = clean
                .split(|c| c == '.' || c == '?' || c == '!' || c == '\n')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty() && s.len() > 5)
                .collect();
            if sentences.is_empty() {
                format!("- {}", clean.chars().take(160).collect::<String>())
            } else {
                let mut b = Vec::new();
                for s in sentences.iter().take(4) {
                    b.push(format!("- {}", s));
                }
                b.join("\n")
            }
        }
    };

    let summary_id = uuid::Uuid::new_v4().to_string();
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let mut conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Erro ao abrir conexão com SQLite: {}", e))?;

    if !crate::memory::db::save_summary(&mut conn, &summary_id, &session_id, created_at, &summary) {
        return Err("Falha ao salvar sumário no banco de dados".into());
    }

    use tauri::Emitter;
    let _ = app.emit("memory://summary-generated", serde_json::json!({
        "id": summary_id,
        "session_id": session_id,
        "created_at": created_at,
        "summary": summary
    }));

    Ok(crate::memory::db::SummaryRecord {
        id: summary_id,
        session_id,
        created_at,
        summary,
    })
}


#[tauri::command]
fn submit_popup_interaction(action_id: String, interaction_result: String) -> Result<serde_json::Value, String> {
    log::info!("[Agent Core] Interação de popup recebida: action_id={}, result={}", action_id, interaction_result);
    Ok(serde_json::json!({ "status": "success" }))
}

#[tauri::command]
fn set_min_chars_to_trigger(min_chars: usize) -> Result<(), String> {
    crate::agent::core::set_min_chars_to_trigger(min_chars);
    Ok(())
}

static LAST_POPUP_ACTION: once_cell::sync::Lazy<std::sync::Arc<std::sync::Mutex<Option<crate::agent::core::LlmActionTriggered>>>> =
    once_cell::sync::Lazy::new(|| std::sync::Arc::new(std::sync::Mutex::new(None)));

#[tauri::command]
fn get_current_popup_action() -> Result<Option<crate::agent::core::LlmActionTriggered>, String> {
    let guard = LAST_POPUP_ACTION.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
async fn show_corner_popup(
    app: tauri::AppHandle,
    action: Option<crate::agent::core::LlmActionTriggered>,
    corner: String,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    log::info!("[Window Manager] >> Exibindo popup no canto: {}", corner);
    let w = width.unwrap_or(400.0);
    let margin = 20.0;
    let margin_bottom = 40.0; // Espaço para barra de tarefas do Windows

    if let Some(ref act) = action {
        if let Ok(mut guard) = LAST_POPUP_ACTION.lock() {
            *guard = Some(act.clone());
        }
    }

    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| {
            app.get_webview_window("overlay")
                .and_then(|w| w.current_monitor().ok().flatten())
        });

    let (target_x, target_y, win_w, win_h) = if let Some(m) = monitor {
        let scale_factor = m.scale_factor();
        let mon_size = m.size();
        let mon_pos = m.position();

        let sw = mon_size.width as f64 / scale_factor;
        let sh = mon_size.height as f64 / scale_factor;
        let sx = mon_pos.x as f64 / scale_factor;
        let sy = mon_pos.y as f64 / scale_factor;

        // Limite máximo de altura disponível na tela
        let max_screen_h = (sh - margin - margin_bottom).max(200.0);
        let actual_h = height.unwrap_or(max_screen_h).min(max_screen_h);

        let (tx, ty) = match corner.as_str() {
            "top-left" => (sx + margin, sy + margin),
            "bottom-left" => (sx + margin, sy + sh - actual_h - margin_bottom),
            "bottom-right" => (sx + sw - w - margin, sy + sh - actual_h - margin_bottom),
            _ => (sx + sw - w - margin, sy + margin), // "top-right" padrão
        };
        (tx, ty, w, actual_h)
    } else {
        log::warn!("[Window Manager] Monitor não detectado, usando posição padrão (topo direito)");
        (1000.0, 40.0, w, height.unwrap_or(800.0))
    };

    log::info!("[Window Manager] Coordenadas calculadas para popup: ({}, {}) [tamanho: {}x{}]", target_x, target_y, win_w, win_h);

    if let Some(popup_win) = app.get_webview_window("popup") {
        let _ = popup_win.set_size(tauri::LogicalSize::new(win_w, win_h));
        let _ = popup_win.set_position(tauri::LogicalPosition::new(target_x.round(), target_y.round()));
        let _ = popup_win.set_shadow(false);
        let _ = popup_win.show();
        let _ = popup_win.set_always_on_top(true);
        let _ = popup_win.unminimize();
        if action.is_some() {
            let _ = popup_win.set_focus();
        }

        if let Some(ref act) = action {
            let _ = popup_win.emit("show_popup_content", act.clone());
        }
    } else {
        log::info!("[Window Manager] Criando nova janela 'popup' posicionada diretamente em ({}, {})...", target_x, target_y);
        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            "popup",
            tauri::WebviewUrl::App("index.html?window=popup".into()),
        )
        .title("WhisperAgent - Notificação")
        .inner_size(win_w, win_h)
        .position(target_x.round(), target_y.round())
        .transparent(true)
        .always_on_top(true)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true);

        match builder.build() {
            Ok(popup_win) => {
                let _ = popup_win.set_shadow(false);
                let _ = popup_win.set_focus();
                // Aguarda o React montar e registrar os listeners antes de emitir o evento.
                // O fallback via get_current_popup_action() no useEffect também cobre esse caso.
                if let Some(act) = action.clone() {
                    let win_clone = popup_win.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                        log::info!("[Window Manager] Emitindo show_popup_content após delay de montagem React...");
                        let _ = win_clone.emit("show_popup_content", act);
                    });
                }
            }
            Err(e) => {
                log::error!("[Window Manager] ❌ Erro ao criar janela de popup: {}", e);
                return Err(format!("Erro ao criar janela de popup: {}", e));
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn hide_corner_popup(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[Window Manager] >> Fechando janela de popup");
    if let Ok(mut guard) = LAST_POPUP_ACTION.lock() {
        *guard = None;
    }
    if let Some(window) = app.get_webview_window("popup") {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
fn set_popups_enabled(enabled: bool) -> Result<(), String> {
    crate::agent::core::set_popups_enabled(enabled);
    Ok(())
}

#[tauri::command]
fn get_popups_enabled() -> Result<bool, String> {
    Ok(crate::agent::core::is_popups_enabled())
}

#[tauri::command]
fn open_browser_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    log::info!("[Window Manager] >> Abrindo link no navegador padrão do sistema: {}", trimmed);

    #[cfg(target_os = "windows")]
    {
        let final_url = if !trimmed.contains("://") && !trimmed.starts_with("mailto:") {
            format!("https://{}", trimmed)
        } else {
            trimmed.to_string()
        };

        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &final_url])
            .spawn()
            .map_err(|e| format!("Erro ao abrir navegador no Windows: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        opener::open_browser(trimmed).map_err(|e| format!("Erro ao abrir navegador: {}", e))
    }
}

#[tauri::command]
fn update_settings_state(
    audio_mute: Option<bool>,
    active_source_id: Option<String>,
    transcription_mode: Option<String>,
    _ui_theme: Option<String>,
    _overlay_opacity: Option<u32>,
    _overlay_monitor_id: Option<u32>,
    selected_llm_id: Option<String>,
    byok_endpoint: Option<String>,
    byok_api_key: Option<String>,
    llm_correction_enabled: Option<bool>,
) -> Result<String, String> {
    log::info!("[Settings Backend] >> Configurações atualizadas com sucesso!");
    if let Some(mute) = audio_mute {
        audio::capture::set_audio_mute(mute);
        log::info!("[Settings Backend] Mudo de áudio definido: {}", mute);
    }
    if let Some(src) = active_source_id {
        log::info!("[Settings Backend] Nova fonte de áudio definida: {}", src);
    }
    if let Some(mode) = transcription_mode {
        log::info!("[Settings Backend] Modo de transcrição definido: {}", mode);
    }
    if let Some(corr) = llm_correction_enabled {
        agent::core::set_llm_correction_enabled(corr);
    }
    agent::core::update_byok_settings(byok_endpoint, byok_api_key, selected_llm_id);
    Ok("Settings updated".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: std::path::PathBuf::from("."),
                        file_name: Some("whisper_agent".into()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            log::info!("[WhisperAgent Core] Backend inicializado com sucesso!");
            log::info!("[WhisperAgent Core] Registrando System Tray...");

            // Cria os itens do menu da System Tray
            let settings_item = MenuItem::with_id(app, "settings", "Configurações", true, None::<&str>)?;
            let toggle_overlay_item = MenuItem::with_id(app, "toggle_overlay", "Alternar Overlay", true, None::<&str>)?;
            let popups_initial_text = if crate::agent::core::is_popups_enabled() {
                "Desativar Popups"
            } else {
                "Ativar Popups"
            };
            let toggle_popups_item = MenuItem::with_id(app, "toggle_popups", popups_initial_text, true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&settings_item, &toggle_overlay_item, &toggle_popups_item, &quit_item])?;

            // Constrói o ícone na bandeja do Windows
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("WhisperAgent")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "settings" => {
                            log::info!("[Tray Event] Abrindo Janela de Configurações");
                            let handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = request_open_settings(handle).await;
                            });
                        }
                        "toggle_overlay" => {
                            log::info!("[Tray Event] Alternando visibilidade do Overlay");
                            if let Some(overlay) = app.get_webview_window("overlay") {
                                if overlay.is_visible().unwrap_or(false) {
                                    let _ = overlay.hide();
                                } else {
                                    let _ = overlay.show();
                                    let _ = overlay.set_focus();
                                }
                            }
                        }
                        "toggle_popups" => {
                            let new_state = !crate::agent::core::is_popups_enabled();
                            crate::agent::core::set_popups_enabled(new_state);
                            log::info!("[Tray Event] Alternando Popups para: {}", if new_state { "ATIVADO" } else { "DESATIVADO" });

                            let new_label = if new_state { "Desativar Popups" } else { "Ativar Popups" };
                            let _ = toggle_popups_item.set_text(new_label);

                            // Notifica o frontend para atualizar as telas de Configurações e Overlay
                            let _ = app.emit("tray-popups-toggled", serde_json::json!({ "enabled": new_state }));
                        }
                        "quit" => {
                            log::info!("[Tray Event] Encerrando WhisperAgent...");
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event {
                        log::info!("[Tray Click] Clique esquerdo no ícone da bandeja");
                        let handle = tray.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = request_open_settings(handle).await;
                        });
                    }
                })
                .build(app)?;

            log::info!("[WhisperAgent Core] System Tray pronta.");

            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.set_shadow(false);
            }

            // Baixa o modelo Whisper no primeiro boot (se necessário)
            audio::setup::ensure_model(app.handle().clone());
            audio::stt::preload_model();

            // --- INICIALIZAÇÃO DO MOTOR DE MEMÓRIA & SESSÕES & RAG ---
            let data_dir = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
            let agent_dir = data_dir.join("WhisperAgent");
            if let Err(e) = std::fs::create_dir_all(&agent_dir) {
                log::error!("[WhisperAgent Core] Erro ao criar diretório do app: {}", e);
            }
            let db_path_buf = agent_dir.join("memory.sqlite3");
            let db_path_str = db_path_buf.to_string_lossy().to_string();

            // Configura o caminho global para o DB
            if let Ok(mut lock) = crate::agent::core::MEMORY_DB_PATH.write() {
                *lock = db_path_str.clone();
            }

            match rusqlite::Connection::open(&db_path_buf) {
                Ok(conn) => {
                    if let Err(e) = init_db(&conn) {
                        log::error!("[WhisperAgent Core] ❌ Erro ao inicializar tabelas do SQLite: {}", e);
                    } else {
                        let current_persona = crate::agent::core::get_active_persona();
                        if let Err(e) = init_session(&conn, &current_persona.name) {
                            log::error!("[WhisperAgent Core] ❌ Erro ao iniciar sessão: {}", e);
                        }
                    }
                }
                Err(e) => {
                    log::error!("[WhisperAgent Core] ❌ Erro ao abrir banco de dados SQLite: {}", e);
                }
            }

            // Canal para segmentos expirados do Hot Ring Buffer (mpsc síncrono)
            let (expired_tx, expired_rx) = std::sync::mpsc::channel::<AudioSegment>();
            let ring_buffer = HotRingBuffer::new(expired_tx);

            // Compartilha o buffer com o agente
            if let Ok(mut lock) = HOT_BUFFER_REF.write() {
                *lock = Some(ring_buffer.get_buffer());
            }

            // Salva referência global do ring buffer para captura de áudio
            crate::memory::ring_buffer::set_global_ring_buffer(ring_buffer);

            // Canal assíncrono para eventos de novos summaries -> EmbeddingWorker (RAG)
            let (summary_tx, summary_rx) = tokio::sync::mpsc::unbounded_channel::<(String, String)>();

            // Worker 1: Rolling Summarizer
            let summarizer_db = db_path_str.clone();
            let byok_arc = crate::agent::core::BYOK_SETTINGS.clone();
            let app_handle_for_summarizer = app.handle().clone();
            std::thread::Builder::new()
                .name("whisper-rolling-summarizer".into())
                .spawn(move || {
                    rolling_summarizer_worker(expired_rx, summarizer_db, byok_arc, summary_tx, Some(app_handle_for_summarizer));
                })
                .expect("Falha ao spawnar thread do rolling summarizer");

            // Worker 2: Local Embeddings & RAG
            let rag_db = db_path_str.clone();
            std::thread::Builder::new()
                .name("whisper-embedding-worker".into())
                .spawn(move || {
                    embedding_worker(summary_rx, rag_db);
                })
                .expect("Falha ao spawnar thread do embedding worker");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            request_open_settings,
            hide_settings,
            request_open_session_summary,
            hide_session_summary,
            get_current_session_details,
            minimize_overlay,
            hide_overlay,
            update_settings_state,
            audio::capture::get_available_audio_devices,
            audio::capture::start_audio_capture,
            audio::capture::stop_audio_capture,
            audio::capture::get_last_captured_audio,
            audio::capture::get_audio_recording_stats,
            audio::capture::open_recordings_folder,
            audio::capture::set_vad_sensitivity,
            audio::capture::get_vad_sensitivity,
            audio::capture::set_audio_buffer_settings,
            audio::capture::get_audio_buffer_settings,
            audio::stt::init_whisper_engine,
            audio::stt::set_whisper_model,
            audio::stt::get_current_whisper_model,
            agent::llm_client::send_chat_completion_request,
            agent::llm_client::test_llm_connection_and_fetch_models,
            agent::tool_registry::process_tool_invocation,
            agent::tool_registry::resolve_tool_approval,
            get_active_persona,
            set_active_persona,
            create_new_session,
            force_summarize_now,
            submit_popup_interaction,
            show_corner_popup,
            hide_corner_popup,
            get_current_popup_action,
            set_min_chars_to_trigger,
            set_popups_enabled,
            get_popups_enabled,
            open_browser_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
