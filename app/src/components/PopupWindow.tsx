import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Check, Copy, X, Bot, ShieldCheck, Code2, Gamepad2, Sparkles } from 'lucide-react';
import { getStoredPersonas, cleanPersonaName } from '../types/persona';
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

export function PopupWindow() {
  const [popup, setPopup] = useState<LlmActionTriggered | null>(null);
  const [copied, setCopied] = useState(false);
  const [, setSettings] = useState<PopupSettingsConfig>(getStoredPopupSettings);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActionIdRef = useRef<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Redimensiona a janela dinamicamente para se adequar ao tamanho exato do texto
  useLayoutEffect(() => {
    if (!popup) return;

    const measureAndResize = () => {
      if (!cardRef.current) return;
      const neededHeight = cardRef.current.scrollHeight + 20;
      const clampedHeight = Math.min(520, Math.max(95, Math.ceil(neededHeight)));
      const width = 380;

      const currentSettings = getStoredPopupSettings();
      invoke('show_corner_popup', {
        corner: currentSettings.screenCorner || 'top-right',
        width,
        height: clampedHeight,
      }).catch(() => {});
    };

    measureAndResize();

    const ro = new ResizeObserver(() => {
      measureAndResize();
    });

    if (cardRef.current) {
      ro.observe(cardRef.current);
    }

    const t = setTimeout(measureAndResize, 50);

    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [popup?.content, popup?.action_id]);

  const handleAction = (payload: LlmActionTriggered | null) => {
    if (!payload) return;
    if (payload.action_type && payload.action_type !== 'popup') return;

    const isNew = lastActionIdRef.current !== payload.action_id;
    lastActionIdRef.current = payload.action_id;

    setPopup(payload);
    setCopied(false);

    if (isNew) {
      const currentSettings = getStoredPopupSettings();
      if (currentSettings.soundEnabled) {
        playPopupSound(currentSettings.soundTone, currentSettings.soundVolume);
      }
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    if (!payload.requires_interaction) {
      const currentSettings = getStoredPopupSettings();
      const timeoutMs = (currentSettings.autoDismissSeconds || 10) * 1000;
      timerRef.current = setTimeout(() => {
        dismissPopup();
      }, timeoutMs);
    }
  };

  useEffect(() => {
    // Busca a ação mais recente persistida no backend (garante exibição imediata caso o evento tenha sido disparado antes da montagem)
    invoke<LlmActionTriggered | null>('get_current_popup_action')
      .then((savedAction) => {
        if (savedAction) {
          handleAction(savedAction);
        }
      })
      .catch(() => {});

    // Sincroniza configurações de popups
    let unlistenSettings = () => {};
    listen<PopupSettingsConfig>('whisper-popup-settings-changed', (event) => {
      if (event.payload) {
        setSettings(event.payload);
      }
    })
      .then((f) => (unlistenSettings = f))
      .catch(() => {});

    // Escuta evento show_popup_content direcionado exclusivamente à janela de popup pelo Rust backend
    let unlistenPopupContent = () => {};
    listen<LlmActionTriggered>('show_popup_content', (event) => {
      if (event.payload) {
        handleAction(event.payload);
      }
    })
      .then((f) => (unlistenPopupContent = f))
      .catch(() => {});

    // Escuta evento global de ação disparada pelo LLM como redundância
    let unlistenLlmAction = () => {};
    listen<LlmActionTriggered>('llm_action_triggered', (event) => {
      if (event.payload) {
        handleAction(event.payload);
      }
    })
      .then((f) => (unlistenLlmAction = f))
      .catch(() => {});

    return () => {
      unlistenSettings();
      unlistenPopupContent();
      unlistenLlmAction();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const dismissPopup = async () => {
    setPopup(null);
    lastActionIdRef.current = null;
    try {
      await invoke('hide_corner_popup');
    } catch {
      // Ignora erro fora do Tauri
    }
  };

  const handleInteractionStrict = async (result: 'accepted' | 'denied') => {
    if (!popup) return;
    try {
      await invoke('submit_popup_interaction', {
        actionId: popup.action_id,
        interactionResult: result,
      });
    } catch (e) {
      console.warn('Erro ao submeter interação:', e);
    }
    await dismissPopup();
  };

  const handleCopy = async () => {
    if (!popup) return;
    try {
      await navigator.clipboard.writeText(popup.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Falha ao copiar:', e);
    }
  };

  if (!popup) {
    return (
      <div className="popup-window-empty" />
    );
  }

  const allPersonas = getStoredPersonas();
  const persona = allPersonas.find((p) => p.id === popup.persona_id);
  const personaName = cleanPersonaName(persona?.name || 'Agente');

  return (
    <div className="popup-window-wrapper">
      <div ref={cardRef} className={`popup-card persona-${popup.persona_id} standalone-popup`}>
        {/* Cabeçalho do Popup */}
        <div className="popup-card-header" data-tauri-drag-region>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }} data-tauri-drag-region>
            <div
              data-tauri-drag-region
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                userSelect: 'none',
              }}
            >
              <img
                data-tauri-drag-region
                src="/logo.svg"
                alt="WhisperAgent"
                style={{
                  height: '14px',
                  width: 'auto',
                  pointerEvents: 'none',
                  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
                }}
              />
              <img
                data-tauri-drag-region
                src="/nametext-logo.svg"
                alt="WhisperAgent"
                style={{
                  height: '10px',
                  width: 'auto',
                  pointerEvents: 'none',
                  opacity: 0.9,
                }}
              />
            </div>
            <span data-tauri-drag-region style={{ color: 'rgba(255,255,255,0.2)', fontSize: '11px' }}>|</span>
            <div className="popup-badge" data-tauri-drag-region>
              {renderPersonaIcon(popup.persona_id)}
              <span>{personaName}</span>
            </div>
          </div>

          <div className="popup-header-actions">
            <button
              type="button"
              className="popup-icon-btn"
              onClick={handleCopy}
              title={copied ? 'Copiado!' : 'Copiar resposta'}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button
              type="button"
              className="popup-icon-btn close"
              onClick={dismissPopup}
              title="Fechar (Dispensar)"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Conteúdo textual formatado em Markdown */}
        <MarkdownViewer
          content={popup.content}
          className="popup-card-content standalone-scroll"
        />

        {/* Ações interativas se exigidas */}
        {popup.requires_interaction && (
          <div className="popup-actions-row">
            <button
              type="button"
              className="popup-btn-accept"
              onClick={() => handleInteractionStrict('accepted')}
            >
              <Check size={13} style={{ marginRight: '4px' }} /> Aceitar
            </button>
            <button
              type="button"
              className="popup-btn-deny"
              onClick={() => handleInteractionStrict('denied')}
            >
              <X size={13} style={{ marginRight: '4px' }} /> Negar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
