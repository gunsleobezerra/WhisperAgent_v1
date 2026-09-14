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
  Terminal,
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
  FileText,
} from 'lucide-react';
import { PopupSystem } from './PopupSystem';
import { getStoredPersonas, getStoredActivePersonaId, cleanPersonaName, DEFAULT_PERSONAS } from '../types/persona';
import { getStoredPopupSettings, PopupSettingsConfig } from '../utils/popupSettings';
import { playPopupSound } from '../utils/audioNotification';
import { MarkdownViewer } from './MarkdownViewer';
import {
  getStoredOverlayDisplaySettings,
  OverlayDisplaySettings,
  isWordKeyword,
  PORTUGUESE_STOPWORDS,
} from '../utils/overlayDisplaySettings';

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
  id: string;
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

/**
 * Algoritmo de Fixação Progressiva de Prefixo (Prefix Stability):
 * Mantém as palavras anteriores travadas e soma as novas palavras conforme chegam,
 * impedindo que a frase inteira fique pulando ou mudando de sentido.
 */
function mergeStreamingText(existing: string, incoming: string): string {
  const cleanExisting = existing.trim();
  const cleanIncoming = incoming.trim();

  if (!cleanExisting) return cleanIncoming;
  if (!cleanIncoming) return cleanExisting;

  // 1. Se o novo texto é idêntico ou já está contido no existente, ignora
  if (cleanExisting.toLowerCase().includes(cleanIncoming.toLowerCase())) {
    return cleanExisting;
  }

  // 2. Se o novo texto é continuação direta do existente (começa com o existente)
  if (cleanIncoming.toLowerCase().startsWith(cleanExisting.toLowerCase())) {
    return cleanIncoming;
  }

  // 3. Procura sobreposição de sufixo do existente com prefixo do incoming (overlap)
  const existingWords = cleanExisting.split(/\s+/);
  const incomingWords = cleanIncoming.split(/\s+/);

  const maxCheck = Math.min(existingWords.length, incomingWords.length);
  for (let len = maxCheck; len >= 1; len--) {
    const existingSlice = existingWords.slice(-len).map((w) => w.toLowerCase()).join(' ');
    const incomingSlice = incomingWords.slice(0, len).map((w) => w.toLowerCase()).join(' ');

    if (existingSlice === incomingSlice) {
      const newWords = incomingWords.slice(len);
      if (newWords.length === 0) return cleanExisting;
      return `${cleanExisting} ${newWords.join(' ')}`;
    }
  }

  // 4. Se o incoming é uma frase nova ou mais longa e coerente, atualiza para ela
  if (incomingWords.length >= existingWords.length) {
    return cleanIncoming;
  }

  return cleanExisting;
}

export function LiveOverlay() {
  // Histórico acumulado de frases finalizadas na janela
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [livePartialText, setLivePartialText] = useState<string>('');
  const [downloads, setDownloads] = useState<Record<string, DownloadEvent>>({});
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState('Inicializando...');
  const [isListening, setIsListening] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');
  const [whisperModel, setWhisperModel] = useState<string>(() => {
    return localStorage.getItem('whisper_model') || 'tiny-q5_1';
  });
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
  const [displaySettings, setDisplaySettings] = useState<OverlayDisplaySettings>(getStoredOverlayDisplaySettings);
  const [llmKeywordsMap, setLlmKeywordsMap] = useState<Record<string, Set<string>>>({});
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
          setWhisperModel(savedWhisperModel);
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
      const savedTranscriptionLanguage = localStorage.getItem('transcription_language');
      const savedAudioMute = localStorage.getItem('audio_mute');
      const savedWhisperModel = localStorage.getItem('whisper_model');
      const isCorr = savedCorrection !== null ? savedCorrection === 'true' : true;

      invoke('update_settings_state', {
        audioMute: savedAudioMute === 'true',
        transcriptionMode: savedTranscriptionMode || 'whisper',
        transcriptionLanguage: savedTranscriptionLanguage || 'pt',
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
      setDownloads(prev => {
        const next = { ...prev };
        if (d.status === 'ready') {
          delete next[d.id];
        } else {
          next[d.id] = d;
        }
        return next;
      });
    }).then((f) => (unlistenDownload = f)).catch(() => {});

    // Feedback visual quando uma ferramenta (como web_search) estiver executando em background
    listen<{ tool: string; message: string }>('tool_running', (event) => {
      setStatus(event.payload.message);
      setDebugInfo(`tool: ${event.payload.tool}`);
    }).catch(() => {});

    listen('tool_finished', () => {
      setStatus('Pronto');
      setDebugInfo('');
    }).catch(() => {});

    // Listener de refinamento / correção gramatical recebida da IA
    listen<TranscriptionCorrected>('stt_transcription_corrected', (event) => {
      try {
        const payload = event.payload;
        if (payload?.segment_id && payload?.text) {
          const trimmedText = payload.text.trim();
          setSegments((prev) =>
            prev.map((seg) =>
              seg.id === payload.segment_id
                ? { ...seg, text: trimmedText, isCorrected: true }
                : seg
            )
          );

          // Extração inteligente de palavras-chave da IA (substantivos e termos modificados/enfatizados)
          const words = trimmedText.split(/\s+/).map((w) => w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'<>]/g, '').toLowerCase());
          const significantWords = new Set<string>();
          for (const w of words) {
            if (w.length >= 4 && !PORTUGUESE_STOPWORDS.has(w)) {
              significantWords.add(w);
            }
          }
          if (significantWords.size > 0) {
            setLlmKeywordsMap((prev) => ({
              ...prev,
              [payload.segment_id]: significantWords,
            }));
          }
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
                // Previne duplicação de frases idênticas consecutivas (ex: bug de corte do buffer)
                const last = prev[prev.length - 1];
                if (last && (last.text.trim().toLowerCase() === clean.toLowerCase() || clean.toLowerCase().startsWith(last.text.trim().toLowerCase()))) {
                  // Se for uma versão mais completa da última frase, substitui ao invés de duplicar
                  return [...prev.slice(0, -1), { id: segId, text: clean, isCorrected: false }];
                }
                if (last && last.text.trim().toLowerCase().includes(clean.toLowerCase())) {
                  // Já continha esse texto, não duplica
                  return prev;
                }
                const next = [...prev, { id: segId, text: clean, isCorrected: false }];
                // Mantém até 30 frases no buffer contínuo de rolagem
                return next.length > 30 ? next.slice(-30) : next;
              });
            }
            setLivePartialText('');
            setIsSpeaking(false);
          } else {
            // Palavras em formação ao vivo com Fixação Progressiva de Prefixo:
            // Trava as palavras já confirmadas e só acrescenta o que estiver sendo falado a mais
            const cleanPartial = payload.text.trim();
            if (cleanPartial && payload.mode !== 'info' && !cleanPartial.startsWith('Fonte conectada:')) {
              setLivePartialText((prev) => mergeStreamingText(prev, cleanPartial));
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

    let unlistenDisplaySettings = () => {};
    listen<OverlayDisplaySettings>('whisper-overlay-display-settings-changed', (event) => {
      if (event.payload) {
        setDisplaySettings(event.payload);
      }
    }).then((f) => (unlistenDisplaySettings = f)).catch(() => {});

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
      if (currentSettings.popupEnabled === false) {
        return;
      }
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

    let unlistenTrayPopups = () => {};
    listen<{ enabled: boolean }>('tray-popups-toggled', (event) => {
      if (typeof event.payload?.enabled === 'boolean') {
        const cur = getStoredPopupSettings();
        const updated = { ...cur, popupEnabled: event.payload.enabled };
        setPopupSettings(updated);
        try {
          localStorage.setItem('whisper_agent_popup_settings', JSON.stringify(updated));
        } catch {}
      }
    }).then((f) => (unlistenTrayPopups = f)).catch(() => {});

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
      unlistenDisplaySettings();
      unlistenLlmAction();
      unlistenTrayPopups();
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

  const handleOpenLogs = async () => {
    try {
      await invoke('request_open_logs');
    } catch (err) {
      console.error('Erro ao abrir logs:', err);
    }
  };

  const handleOpenSettings = async () => {
    try {
      await invoke('request_open_settings');
    } catch (err) {
      console.error('Erro ao invocar request_open_settings:', err);
    }
  };

  const handleOpenSessionSummary = async () => {
    try {
      await invoke('request_open_session_summary');
    } catch (err) {
      console.error('Erro ao invocar request_open_session_summary:', err);
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
            {isSpeaking ? '🗣️ Ouvindo voz...' : (isListening ? '🎙️ Aguardando fala' : `🎙️ ${status}`)}
            <span style={{ marginLeft: '6px', opacity: 0.7, borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '6px' }}>
              {whisperModel.toUpperCase()}
            </span>
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
            onClick={handleOpenSessionSummary}
            title="Ver Sumário da Sessão & ID (Memória consolidada)"
          >
            <FileText size={13} />
          </button>
          <button 
            type="button"
            className="overlay-icon-btn"
            onClick={handleOpenLogs}
            title="Logs do Backend"
          >
            <Terminal size={13} />
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
        {Object.values(downloads).length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
            {Object.values(downloads).map(dl => (
              <div key={dl.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
                <span style={{ fontSize: '12px', color: dl.status === 'error' ? 'var(--text-secondary, #a1a1aa)' : 'var(--text-primary, #ffffff)' }}>
                  {dl.message}
                </span>
                {dl.status === 'downloading' && (
                  <div style={{ width: '100%', height: '3px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${dl.progress}%`,
                        background: 'var(--accent-color, #a855f7)',
                        transition: 'width 0.2s ease-out'
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          (segments.length > 0 || livePartialText || (popupSettings.displayMode === 'inline' && inlineAction)) ? (
            <div className="overlay-segments-container">
              {/* Frases finalizadas com controle de visibilidade (últimas N linhas para evitar confusão) */}
              {(displaySettings.maxLinesVisible > 0 
                ? segments.slice(-displaySettings.maxLinesVisible) 
                : segments
              ).map((seg, segIdx, visibleSegs) => {
                const isCurrent = segIdx === visibleSegs.length - 1 && !livePartialText;
                const words = seg.text.split(/\s+/).filter(Boolean);
                const segKeywords = llmKeywordsMap[seg.id];

                return (
                  <div 
                    key={seg.id} 
                    className={`overlay-segment-row ${isCurrent ? 'current' : 'faded'}`}
                  >
                    {words.map((w, wIdx) => {
                      const isKw = isWordKeyword(w, displaySettings, segKeywords);
                      const highlightClass = isKw ? `highlight-${displaySettings.highlightStyle}` : '';
                      const animClass = displaySettings.wordByWordAnimation ? 'word-enter' : '';
                      const hlColor = displaySettings.highlightColor || '#38bdf8';
                      const customStyle: React.CSSProperties | undefined = isKw ? {
                        color: displaySettings.highlightStyle === 'underline' ? undefined : hlColor,
                        textShadow: displaySettings.highlightStyle === 'underline' ? undefined : `0 0 10px ${hlColor}77`,
                        borderBottomColor: displaySettings.highlightStyle === 'underline' ? hlColor : undefined,
                        ['--custom-highlight-color' as any]: hlColor,
                      } : undefined;

                      return (
                        <span
                          key={`${seg.id}_${wIdx}`}
                          className={`overlay-word ${animClass} ${highlightClass}`}
                          style={customStyle}
                        >
                          {w}
                        </span>
                      );
                    })}
                  </div>
                );
              })}

              {/* Fala ao vivo em formação (streaming de palavras da frase atual) */}
              {livePartialText && (
                <div className="overlay-live-partial-container">
                  {livePartialText.split(/\s+/).filter(Boolean).map((w, wIdx, arr) => {
                    const isLastWord = wIdx === arr.length - 1;
                    const isKw = isWordKeyword(w, displaySettings);
                    const highlightClass = isKw ? `highlight-${displaySettings.highlightStyle}` : '';
                    const hlColor = displaySettings.highlightColor || '#38bdf8';
                    const customStyle: React.CSSProperties | undefined = isKw ? {
                      color: displaySettings.highlightStyle === 'underline' ? undefined : hlColor,
                      textShadow: displaySettings.highlightStyle === 'underline' ? undefined : `0 0 10px ${hlColor}77`,
                      borderBottomColor: displaySettings.highlightStyle === 'underline' ? hlColor : undefined,
                      ['--custom-highlight-color' as any]: hlColor,
                    } : undefined;

                    return (
                      <span
                        key={`live_${wIdx}_${w}`}
                        className={`overlay-word word-enter ${isLastWord ? 'active-speaking' : ''} ${highlightClass}`}
                        style={customStyle}
                      >
                        {w}
                      </span>
                    );
                  })}
                  <span className="cursor-blink">▍</span>
                </div>
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
