import { useEffect, useState, useRef } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import {
  Eraser,
  Pause,
  Play,
  Settings,
  X,
  Sparkles,
  Mic,
  Bot,
  ShieldCheck,
  Code2,
  Gamepad2,
  Copy,
  Check,
  RotateCcw,
} from 'lucide-react';
import { PopupSystem } from './PopupSystem';
import { getStoredPersonas, getStoredActivePersonaId, cleanPersonaName, DEFAULT_PERSONAS } from '../types/persona';
import { getStoredPopupSettings, PopupSettingsConfig } from '../utils/popupSettings';
import { playPopupSound } from '../utils/audioNotification';
import { MarkdownViewer } from './MarkdownViewer';

interface LlmActionTriggered {
  action_id: string;
  persona_id: string;
  action_type: string;
  content: string;
  requires_interaction: boolean;
}

type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

interface AudioDevice {
  id: string;
  name: string;
  is_loopback: boolean;
  default: boolean;
}

interface TranscriptionUpdate {
  mode: string;
  text: string;
  is_final: boolean;
  segment_id?: string;
}

interface TranscriptionCorrected {
  segment_id: string;
  text: string;
  original_text: string;
}

interface DownloadEvent {
  status: string;   // 'downloading' | 'ready' | 'error'
  progress: number; // 0-100
  message: string;
}

interface TranscriptionSegment {
  id: string;
  text: string;
  isCorrected?: boolean;
}

function renderPersonaIcon(id: string) {
  switch (id) {
    case 'concise_assistant':
      return <Bot size={13} />;
    case 'fact_checker':
      return <ShieldCheck size={13} />;
    case 'pair_dev':
      return <Code2 size={13} />;
    case 'game_tactician':
      return <Gamepad2 size={13} />;
    default:
      return <Sparkles size={13} />;
  }
}

export function LiveOverlay() {
  // Histórico acumulado de frases finalizadas na janela
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [livePartialText, setLivePartialText] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState('Inicializando...');
  const [isListening, setIsListening] = useState(false);
  const [modelDownload, setModelDownload] = useState<DownloadEvent | null>(null);
  const [debugInfo, setDebugInfo] = useState('');
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    return localStorage.getItem('active_source_id') || 'default';
  });
  const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
    const saved = localStorage.getItem('overlay_opacity');
    return saved ? Number(saved) : 85;
  });
  const [overlayFontSize, setOverlayFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('overlay_font_size');
    return saved ? Math.max(14, Math.min(36, Number(saved))) : 18;
  });
  const [isHovered, setIsHovered] = useState(false);
  const [isSelectFocused, setIsSelectFocused] = useState(false);
  const audioStartedRef = useRef(false);
  const textContainerRef = useRef<HTMLDivElement>(null);

  // Configurações de popups e ação embutida
  const [popupSettings, setPopupSettings] = useState<PopupSettingsConfig>(getStoredPopupSettings);
  const [inlineAction, setInlineAction] = useState<LlmActionTriggered | null>(null);
  const [inlineCopied, setInlineCopied] = useState(false);
  const inlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHandledActionId = useRef<string | null>(null);

  // Mantém a visualização focada no texto mais recente (auto-scroll suave para o final)
  useEffect(() => {
    if (textContainerRef.current) {
      textContainerRef.current.scrollTop = textContainerRef.current.scrollHeight;
    }
  }, [segments, livePartialText]);

  useEffect(() => {
    let unlistenFn = () => {};
    let unlistenDownload = () => {};
    let unlistenResize = () => {};
    let unlistenCorrected = () => {};
    let unlistenAudioSource = () => {};
    let unlistenOpacity = () => {};
    let unlistenFontSize = () => {};
    let unlistenSettingsSaved = () => {};

    // Carrega dispositivos de áudio disponíveis
    loadDevices();

    // Escuta evento de troca de dispositivo de áudio (ex: vindo da janela de Configurações)
    listen<{ deviceId: string }>('audio_source_changed', (event) => {
      if (event.payload?.deviceId) {
        setSelectedDeviceId(event.payload.deviceId);
      }
    }).then((f) => (unlistenAudioSource = f)).catch(() => {});

    // Escuta alteração em tempo real da opacidade do Overlay
    listen<{ opacity: number }>('whisper-overlay-opacity', (event) => {
      if (typeof event.payload?.opacity === 'number') {
        setOverlayOpacity(event.payload.opacity);
        localStorage.setItem('overlay_opacity', String(event.payload.opacity));
      }
    }).then((f) => (unlistenOpacity = f)).catch(() => {});

    // Escuta alteração em tempo real do tamanho da fonte do Overlay
    listen<{ fontSize: number }>('whisper-overlay-font-size', (event) => {
      if (typeof event.payload?.fontSize === 'number') {
        setOverlayFontSize(event.payload.fontSize);
        localStorage.setItem('overlay_font_size', String(event.payload.fontSize));
      }
    }).then((f) => (unlistenFontSize = f)).catch(() => {});

    // Escuta confirmação global de configurações salvas para atualizar persona/modelo/opacidade
    listen('whisper-settings-saved', () => {
      try {
        const allP = getStoredPersonas();
        const activeId = getStoredActivePersonaId();
        const activeP = allP.find((p) => p.id === activeId) || DEFAULT_PERSONAS[0];
        invoke('set_active_persona', { persona: activeP }).catch(() => {});

        const savedWhisperModel = localStorage.getItem('whisper_model');
        if (savedWhisperModel) {
          invoke('set_whisper_model', { modelName: savedWhisperModel }).catch(() => {});
        }

        const savedOpacity = localStorage.getItem('overlay_opacity');
        if (savedOpacity) {
          setOverlayOpacity(Number(savedOpacity));
        }

        const savedFontSize = localStorage.getItem('overlay_font_size');
        if (savedFontSize) {
          setOverlayFontSize(Number(savedFontSize));
        }
      } catch (e) {
        console.warn('Erro ao processar whisper-settings-saved no overlay:', e);
      }
    }).then((f) => (unlistenSettingsSaved = f)).catch(() => {});

    // Restaura tamanho salvo se existir
    try {
      const savedW = parseInt(localStorage.getItem('overlay_width') || '', 10);
      const savedH = parseInt(localStorage.getItem('overlay_height') || '', 10);
      if (savedW >= 320 && savedH >= 110) {
        const appWindow = getCurrentWindow();
        appWindow.setSize(new LogicalSize(savedW, savedH)).catch(() => {});
      }
    } catch (e) {
      console.warn('Erro ao restaurar tamanho do overlay:', e);
    }

    // Sincroniza configurações de IA (BYOK), Persona ativa, Modelo Whisper e Correção ao inicializar o overlay
    try {
      const savedEndpoint = localStorage.getItem('byok_endpoint');
      const savedKey = localStorage.getItem('byok_key');
      const savedModel = localStorage.getItem('byok_model');
      const savedCorrection = localStorage.getItem('llm_correction_enabled');
      const savedTranscriptionMode = localStorage.getItem('transcription_mode');
      const savedAudioMute = localStorage.getItem('audio_mute');
      const savedWhisperModel = localStorage.getItem('whisper_model');
      const isCorr = savedCorrection !== null ? savedCorrection === 'true' : true;

      invoke('update_settings_state', {
        audioMute: savedAudioMute === 'true',
        transcriptionMode: savedTranscriptionMode || 'whisper',
        selectedLlmId: savedModel,
        byokEndpoint: savedEndpoint,
        byokApiKey: savedKey,
        llmCorrectionEnabled: isCorr,
      }).catch(() => {});

      if (savedWhisperModel) {
        invoke('set_whisper_model', { modelName: savedWhisperModel }).catch(() => {});
      }

      const allP = getStoredPersonas();
      const activeId = getStoredActivePersonaId();
      const activeP = allP.find((p) => p.id === activeId) || DEFAULT_PERSONAS[0];
      invoke('set_active_persona', { persona: activeP }).catch(() => {});
    } catch (e) {
      console.warn('Erro ao sincronizar persona/BYOK inicial:', e);
    }

    // Escuta evento de redimensionamento da janela para persistir
    let resizeTimer: any;
    const handleWindowResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth >= 320 && window.innerHeight >= 110) {
          localStorage.setItem('overlay_width', String(window.innerWidth));
          localStorage.setItem('overlay_height', String(window.innerHeight));
        }
      }, 300);
    };
    window.addEventListener('resize', handleWindowResize);

    // Escuta evento de redimensionamento disparado pelas Configurações
    listen<{ width: number; height: number }>('whisper-overlay-resize', async (event) => {
      if (event.payload?.width && event.payload?.height) {
        try {
          const appWindow = getCurrentWindow();
          await appWindow.setSize(new LogicalSize(event.payload.width, event.payload.height));
          localStorage.setItem('overlay_width', String(event.payload.width));
          localStorage.setItem('overlay_height', String(event.payload.height));
        } catch (err) {
          console.warn('Erro ao ajustar tamanho via evento:', err);
        }
      }
    }).then((f) => (unlistenResize = f)).catch(() => {});

    // Listener do progresso de download do modelo Whisper (primeiro boot)
    listen<DownloadEvent>('whisper_model_download', (event) => {
      const d = event.payload;
      if (d.status === 'ready') {
        setModelDownload(null);
      } else {
        setModelDownload(d);
      }
    }).then((f) => (unlistenDownload = f)).catch(() => {});

    // Listener de refinamento / correção gramatical recebida da IA
    listen<TranscriptionCorrected>('stt_transcription_corrected', (event) => {
      try {
        const payload = event.payload;
        if (payload?.segment_id && payload?.text) {
          setSegments((prev) =>
            prev.map((seg) =>
              seg.id === payload.segment_id
                ? { ...seg, text: payload.text.trim(), isCorrected: true }
                : seg
            )
          );
        }
      } catch (e) {
        // silencia
      }
    }).then((f) => (unlistenCorrected = f)).catch(() => {});

    // Listener de atualizações do Whisper STT
    listen<TranscriptionUpdate>('stt_transcription_update', (event) => {
      try {
        const payload = event.payload;
        if (typeof payload.text === 'string') {
          if (payload.is_final) {
            const clean = payload.text.trim();
            if (clean && payload.mode !== 'info' && !clean.startsWith('Fonte conectada:')) {
              const segId = payload.segment_id || `seg_${Date.now()}`;
              setSegments((prev) => {
                const next = [...prev, { id: segId, text: clean, isCorrected: false }];
                // Mantém até 30 frases no buffer contínuo de rolagem
                return next.length > 30 ? next.slice(-30) : next;
              });
            }
            setLivePartialText('');
            setIsSpeaking(false);
          } else {
            // Palavras em formação ao vivo (streaming palavra por palavra)
            if (payload.text.trim() && payload.mode !== 'info' && !payload.text.trim().startsWith('Fonte conectada:')) {
              setLivePartialText(payload.text.trim());
            }
            setIsSpeaking(true);
          }
        }
      } catch (e) {
        // silencia
      }
    }).then((f) => (unlistenFn = f)).catch((e) => console.warn('Tauri IPC preview:', e));

    let unlistenPopupSettings = () => {};
    listen<PopupSettingsConfig>('whisper-popup-settings-changed', (event) => {
      if (event.payload) {
        setPopupSettings(event.payload);
      }
    }).then((f) => (unlistenPopupSettings = f)).catch(() => {});

    let unlistenLlmAction = () => {};
    listen<LlmActionTriggered>('llm_action_triggered', (event) => {
      const payload = event.payload;
      if (!payload || payload.action_type !== 'popup') return;

      // Evita processar a mesma ação repetidamente
      if (lastHandledActionId.current === payload.action_id) {
        return;
      }
      lastHandledActionId.current = payload.action_id;

      const currentSettings = getStoredPopupSettings();
      if (currentSettings.displayMode === 'inline') {
        setInlineAction(payload);
        setInlineCopied(false);
        if (currentSettings.soundEnabled) {
          playPopupSound(currentSettings.soundTone, currentSettings.soundVolume);
        }
        if (inlineTimerRef.current) clearTimeout(inlineTimerRef.current);
        if (!payload.requires_interaction) {
          const ms = (currentSettings.autoDismissSeconds || 10) * 1000;
          inlineTimerRef.current = setTimeout(() => {
            setInlineAction(null);
          }, ms);
        }
      } else if (currentSettings.displayMode === 'screen_corner') {
        if (currentSettings.soundEnabled) {
          playPopupSound(currentSettings.soundTone, currentSettings.soundVolume);
        }
        invoke('show_corner_popup', {
          action: payload,
          corner: currentSettings.screenCorner,
          width: 380,
          height: 190,
        }).catch((err) => console.warn('Falha ao exibir popup no canto:', err));
      }
    }).then((f) => (unlistenLlmAction = f)).catch(() => {});

    if (!audioStartedRef.current) {
      audioStartedRef.current = true;
      startAudio();
    }

    return () => {
      unlistenFn();
      unlistenDownload();
      unlistenResize();
      unlistenCorrected();
      unlistenAudioSource();
      unlistenOpacity();
      unlistenFontSize();
      unlistenSettingsSaved();
      unlistenPopupSettings();
      unlistenLlmAction();
      if (inlineTimerRef.current) clearTimeout(inlineTimerRef.current);
      window.removeEventListener('resize', handleWindowResize);
      clearTimeout(resizeTimer);
    };
  }, []);

  const handleInlineInteraction = async (result: 'accepted' | 'denied') => {
    if (!inlineAction) return;
    try {
      await invoke('submit_popup_interaction', {
        actionId: inlineAction.action_id,
        interactionResult: result,
      });
    } catch (e) {
      console.warn('Erro ao submeter interação inline:', e);
    }
    setInlineAction(null);
  };

  const handleInlineCopy = async () => {
    if (!inlineAction) return;
    try {
      await navigator.clipboard.writeText(inlineAction.content);
      setInlineCopied(true);
      setTimeout(() => setInlineCopied(false), 2000);
    } catch (e) {
      console.warn('Erro ao copiar:', e);
    }
  };

  const loadDevices = async () => {
    try {
      const devs = await invoke<AudioDevice[]>('get_available_audio_devices');
      setAudioDevices(devs);
      const saved = localStorage.getItem('active_source_id');
      if (saved && (saved === 'default' || devs.some((d) => d.id === saved))) {
        setSelectedDeviceId(saved);
      } else {
        const def = devs.find((d) => d.default && !d.is_loopback) || devs[0];
        if (def) {
          setSelectedDeviceId(def.id);
        }
      }
    } catch (err) {
      console.warn('Erro ao listar dispositivos no overlay:', err);
    }
  };

  const startAudio = async (deviceIdToUse?: string) => {
    try {
      setStatus('Conectando...');
      const savedSource = deviceIdToUse || localStorage.getItem('active_source_id') || 'default';
      setDebugInfo(`device: ${savedSource}`);
      await invoke('start_audio_capture', {
        deviceId: savedSource,
        sampleRate: 16000,
        channels: 1,
        format: 'f32',
      });
      setIsListening(true);
      setStatus('Pronto');
      setDebugInfo('');
    } catch (err: any) {
      const msg = err?.message || err?.error || JSON.stringify(err) || 'falha';
      setStatus(`Erro`);
      setDebugInfo(msg);
    }
  };

  const handleDeviceChange = async (newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    localStorage.setItem('active_source_id', newDeviceId);

    try {
      await invoke('update_settings_state', { activeSourceId: newDeviceId });
    } catch (e) {
      console.warn('Erro ao atualizar settings state:', e);
    }

    try {
      await emit('audio_source_changed', { deviceId: newDeviceId });
    } catch (e) {}

    try {
      setStatus('Conectando...');
      await invoke('start_audio_capture', {
        deviceId: newDeviceId,
        sampleRate: 16000,
        channels: 1,
        format: 'f32',
      });
      setIsListening(true);
      setStatus('Pronto');
      setDebugInfo('');
    } catch (err: any) {
      const msg = err?.message || err?.error || JSON.stringify(err) || 'falha';
      setStatus('Erro');
      setDebugInfo(msg);
      console.error('Erro ao trocar dispositivo de áudio:', err);
    }
  };

  const handleToggleTranscription = async () => {
    if (isListening) {
      try {
        await invoke('stop_audio_capture');
      } catch (err) {
        console.warn('Erro ao interromper transcrição:', err);
      }
      setIsListening(false);
      setIsSpeaking(false);
      setLivePartialText('');
      setStatus('Interrompido');
    } else {
      await startAudio();
    }
  };

  const handleClearHistory = () => {
    setSegments([]);
    setLivePartialText('');
  };

  const handleNewSession = async () => {
    try {
      setStatus('Nova sessão...');
      await invoke('create_new_session');
      setSegments([]);
      setLivePartialText('');
      setStatus('Sessão iniciada');
      setTimeout(() => {
        setStatus(isListening ? 'Pronto' : 'Interrompido');
      }, 1500);
    } catch (err: any) {
      console.error('Erro ao iniciar nova sessão:', err);
      setStatus('Erro sessão');
    }
  };

  const handleOpenSettings = async () => {
    try {
      await invoke('request_open_settings');
    } catch (err) {
      console.error('Erro ao invocar request_open_settings:', err);
    }
  };

  const handleClose = async () => {
    try {
      await invoke('hide_overlay');
    } catch (err) {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.hide();
      } catch (e2) {
        console.error('Erro ao fechar/ocultar:', e2);
      }
    }
  };

  const handleResizeMouseDown = (direction: ResizeDirection) => async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const appWindow = getCurrentWindow();
      await (appWindow as any).startDragging({ direction });
    } catch (err) {
      try {
        const appWindow = getCurrentWindow();
        await (appWindow as any).startResizeDragging(direction);
      } catch (e2) {
        console.warn('Redimensionamento nativo indisponível:', e2);
      }
    }
  };

  return (
    <div 
      className="overlay-wrapper"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div 
        className="overlay-main-card"
        style={{ opacity: overlayOpacity / 100 }}
      >
        {/* Barra de controle superior */}
      <div 
        style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '8px'
        }}
      >
        {/* Alça exclusiva de arrasto com status dinâmico */}
        <div 
          data-tauri-drag-region
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            cursor: 'grab',
            flexGrow: 1,
            userSelect: 'none'
          }}
        >
          <div
            data-tauri-drag-region
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
            }}
          >
            <img
              data-tauri-drag-region
              src="/logo.svg"
              alt="WhisperAgent"
              style={{
                height: '22px',
                width: 'auto',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
              }}
            />
            <img
              data-tauri-drag-region
              src="/nametext-logo.svg"
              alt="WhisperAgent"
              style={{
                height: '17px',
                width: 'auto',
                pointerEvents: 'none',
                opacity: 0.95,
              }}
            />
          </div>
          <span 
            data-tauri-drag-region 
            title={debugInfo || undefined}
            style={{
              fontSize: '11px',
              color: isSpeaking
                ? 'var(--text-primary, #ffffff)'
                : isListening
                ? 'var(--text-partial, #e4e4e7)'
                : 'var(--text-secondary, #a1a1aa)',
              textShadow: isSpeaking ? '0 0 8px rgba(255, 255, 255, 0.8)' : 'none',
              fontWeight: isSpeaking ? 600 : 400,
            }}
          >
            {isSpeaking ? '● Ouvindo voz...' : (isListening ? '○ Aguardando fala' : `○ ${status}`)}
          </span>
        </div>

        {/* Botões de ação */}
        <div className="overlay-actions-bar">
          <button 
            type="button"
            className="overlay-icon-btn"
            onClick={handleNewSession}
            title="Iniciar Nova Sessão (Resetar contexto da IA e memória recente)"
          >
            <RotateCcw size={13} />
          </button>
          <button 
            type="button"
            className="overlay-icon-btn"
            onClick={handleClearHistory}
            title="Limpar histórico de texto (Reiniciar janela)"
          >
            <Eraser size={13} />
          </button>
          <button 
            type="button"
            className={`overlay-icon-btn ${isListening ? 'pause' : 'resume'}`}
            onClick={handleToggleTranscription}
            title={isListening ? "Interromper transcrição" : "Retomar transcrição"}
          >
            {isListening ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button 
            type="button"
            className="overlay-icon-btn"
            onClick={handleOpenSettings}
            title="Configurações"
          >
            <Settings size={13} />
          </button>
          <button 
            type="button"
            className="overlay-icon-btn close"
            onClick={handleClose}
            title="Fechar"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Caixa de Texto / Histórico Acumulado / Progresso de Download */}
      <div 
        ref={textContainerRef}
        className="overlay-history-scroll"
        style={{ 
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          fontSize: `${overlayFontSize}px`, 
          lineHeight: '1.5', 
          color: 'var(--text-primary, #ffffff)', 
          fontWeight: 500,
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          wordBreak: 'break-word',
          paddingRight: '4px'
        }}
      >
        {modelDownload ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: modelDownload.status === 'error' ? 'var(--text-secondary, #a1a1aa)' : 'var(--text-primary, #ffffff)' }}>
              {modelDownload.message}
            </span>
            {modelDownload.status === 'downloading' && (
              <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                <div style={{
                  width: `${modelDownload.progress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #52525b, #ffffff)',
                  borderRadius: '4px',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            )}
          </div>
        ) : (
          (segments.length > 0 || livePartialText || (popupSettings.displayMode === 'inline' && inlineAction)) ? (
            <div className="overlay-segments-container">
              {segments.map((seg, idx) => (
                <span key={seg.id} className={`overlay-segment ${seg.isCorrected ? 'corrected' : ''}`}>
                  {seg.text}
                  {seg.isCorrected && (
                    <span className="corrected-badge" title="Refinado e pontuado por IA">
                      <Sparkles size={11} />
                    </span>
                  )}
                  {idx < segments.length - 1 || livePartialText ? ' ' : ''}
                </span>
              ))}
              {livePartialText && (
                <span className="overlay-live-partial">
                  {livePartialText}
                  <span className="cursor-blink">▍</span>
                </span>
              )}

              {/* Card de Ação Embutido no Fluxo de Texto */}
              {popupSettings.displayMode === 'inline' && inlineAction && (
                <div className={`inline-action-bubble persona-${inlineAction.persona_id}`}>
                  <div className="inline-action-header">
                    <div className="inline-action-badge">
                      {renderPersonaIcon(inlineAction.persona_id)}
                      <span>
                        {cleanPersonaName(
                          getStoredPersonas().find((p) => p.id === inlineAction.persona_id)?.name || 'Agente'
                        )}
                      </span>
                    </div>
                    <div className="inline-action-actions">
                      <button
                        type="button"
                        className="inline-action-btn"
                        onClick={handleInlineCopy}
                        title={inlineCopied ? 'Copiado!' : 'Copiar resposta'}
                      >
                        {inlineCopied ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                      <button
                        type="button"
                        className="inline-action-btn"
                        onClick={() => setInlineAction(null)}
                        title="Dispensar"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                  <MarkdownViewer
                    content={inlineAction.content}
                    className="inline-action-content"
                  />
                  {inlineAction.requires_interaction && (
                    <div className="inline-action-buttons">
                      <button
                        type="button"
                        className="popup-btn-accept"
                        onClick={() => handleInlineInteraction('accepted')}
                      >
                        <Check size={11} style={{ marginRight: '3px' }} /> Aceitar
                      </button>
                      <button
                        type="button"
                        className="popup-btn-deny"
                        onClick={() => handleInlineInteraction('denied')}
                      >
                        <X size={11} style={{ marginRight: '3px' }} /> Negar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <span style={{ color: 'var(--text-secondary, #a1a1aa)', fontStyle: 'italic', fontSize: `${Math.max(14, overlayFontSize - 2)}px` }}>
              Aguardando áudio / fala...
            </span>
          )
        )}
      </div>

      {/* Alças de Redimensionamento Invisíveis (8 direções) */}
      <div className="resize-handle n" onMouseDown={handleResizeMouseDown('North')} />
      <div className="resize-handle s" onMouseDown={handleResizeMouseDown('South')} />
      <div className="resize-handle e" onMouseDown={handleResizeMouseDown('East')} />
      <div className="resize-handle w" onMouseDown={handleResizeMouseDown('West')} />
      <div className="resize-handle nw" onMouseDown={handleResizeMouseDown('NorthWest')} />
      <div className="resize-handle ne" onMouseDown={handleResizeMouseDown('NorthEast')} />
      <div className="resize-handle sw" onMouseDown={handleResizeMouseDown('SouthWest')} />
      <div className="resize-handle se" onMouseDown={handleResizeMouseDown('SouthEast')} />

      {/* Grip visual no canto inferior direito */}
      <div 
        className="overlay-resize-grip" 
        onMouseDown={handleResizeMouseDown('SouthEast')}
        title="Arrastar para redimensionar"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <circle cx="8.5" cy="8.5" r="1.1" />
          <circle cx="5.5" cy="8.5" r="1.1" />
          <circle cx="8.5" cy="5.5" r="1.1" />
          <circle cx="2.5" cy="8.5" r="1.1" />
          <circle cx="5.5" cy="5.5" r="1.1" />
          <circle cx="8.5" cy="2.5" r="1.1" />
        </svg>
      </div>

        {popupSettings.displayMode === 'overlay' && <PopupSystem />}
      </div>

      {/* Seletor de dispositivo de áudio EMBAIXO DO OVERLAY */}
      <div className={`overlay-device-footer ${isHovered || isSelectFocused ? 'visible' : ''}`}>
        <Mic size={12} style={{ color: 'var(--text-secondary)', opacity: 0.8, flexShrink: 0 }} />
        <select
          className="overlay-device-select"
          value={selectedDeviceId}
          onChange={(e) => handleDeviceChange(e.target.value)}
          onFocus={() => {
            setIsSelectFocused(true);
            loadDevices();
          }}
          onBlur={() => setIsSelectFocused(false)}
          title="Dispositivo de áudio ativo"
        >
          <option value="default">Padrão do Sistema</option>
          {audioDevices.map((dev) => (
            <option key={dev.id} value={dev.id}>
              {dev.name} {dev.default ? '(Padrão)' : ''}
            </option>
          ))}
          {selectedDeviceId !== 'default' &&
            !audioDevices.some((d) => d.id === selectedDeviceId) && (
              <option value={selectedDeviceId}>
                {selectedDeviceId} (Atual)
              </option>
            )}
        </select>
      </div>
    </div>
  );
}
