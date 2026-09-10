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

interface PopupItem {
  action: LlmActionTriggered;
  addedAt: number;
  copied: boolean;
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

export function PopupSystem() {
  const [popups, setPopups] = useState<PopupItem[]>([]);
  const [, setSettings] = useState<PopupSettingsConfig>(getStoredPopupSettings);
  const containerRef = useRef<HTMLDivElement>(null);
  const handledIdsRef = useRef<Set<string>>(new Set());

  // Limita a pilha para não exceder o limite de altura do container ou da tela
  useLayoutEffect(() => {
    if (popups.length <= 1) return;
    if (!containerRef.current) return;

    const screenMaxHeight = window.screen?.availHeight ? window.screen.availHeight * 0.75 : 600;
    if (containerRef.current.scrollHeight > screenMaxHeight) {
      // Descarta o popup mais antigo
      setPopups((prev) => (prev.length > 1 ? prev.slice(1) : prev));
    }
  }, [popups]);

  const pushPopup = (action: LlmActionTriggered) => {
    if (!action || (action.action_type && action.action_type !== 'popup')) return;
    const currentSettings = getStoredPopupSettings();
    if (currentSettings.popupEnabled === false) return;
    if (currentSettings.displayMode !== 'overlay') return;

    if (handledIdsRef.current.has(action.action_id)) return;
    handledIdsRef.current.add(action.action_id);

    if (currentSettings.soundEnabled) {
      playPopupSound(currentSettings.soundTone, currentSettings.soundVolume);
    }

    setPopups((prev) => {
      const exists = prev.some((p) => p.action.action_id === action.action_id);
      if (exists) return prev;
      const updated = [...prev, { action, addedAt: Date.now(), copied: false }];
      if (updated.length > 5) {
        return updated.slice(updated.length - 5);
      }
      return updated;
    });

    if (!action.requires_interaction) {
      const timeoutMs = (currentSettings.autoDismissSeconds || 10) * 1000;
      setTimeout(() => {
        dismissPopup(action.action_id);
      }, timeoutMs);
    }
  };

  const dismissPopup = (actionId: string) => {
    setPopups((prev) => prev.filter((p) => p.action.action_id !== actionId));
  };

  useEffect(() => {
    let unlistenSettings = () => {};
    listen<PopupSettingsConfig>('whisper-popup-settings-changed', (event) => {
      if (event.payload) {
        setSettings(event.payload);
        if (event.payload.popupEnabled === false || event.payload.displayMode !== 'overlay') {
          setPopups([]);
        }
      }
    })
      .then((f) => (unlistenSettings = f))
      .catch(() => {});

    let unlistenTray = () => {};
    listen<{ enabled: boolean }>('tray-popups-toggled', (event) => {
      if (event.payload && event.payload.enabled === false) {
        setPopups([]);
      }
    })
      .then((f) => (unlistenTray = f))
      .catch(() => {});

    let unlistenFn = () => {};
    listen<LlmActionTriggered>('llm_action_triggered', (event) => {
      pushPopup(event.payload);
    })
      .then((f) => (unlistenFn = f))
      .catch(() => console.warn('Tauri IPC indisponível (modo web)'));

    return () => {
      unlistenSettings();
      unlistenTray();
      unlistenFn();
    };
  }, []);

  const handleInteractionStrict = async (actionId: string, result: 'accepted' | 'denied') => {
    try {
      await invoke('submit_popup_interaction', {
        actionId,
        interactionResult: result,
      });
    } catch (e) {
      console.warn('Erro ao submeter interação:', e);
    }
    dismissPopup(actionId);
  };

  const handleCopy = async (actionId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setPopups((prev) =>
        prev.map((item) =>
          item.action.action_id === actionId ? { ...item, copied: true } : item
        )
      );
      setTimeout(() => {
        setPopups((prev) =>
          prev.map((item) =>
            item.action.action_id === actionId ? { ...item, copied: false } : item
          )
        );
      }, 2000);
    } catch (e) {
      console.warn('Falha ao copiar:', e);
    }
  };

  if (popups.length === 0) return null;

  const allPersonas = getStoredPersonas();

  return (
    <div ref={containerRef} className="popup-stack-container overlay-stack">
      {popups.map(({ action, copied }) => {
        const persona = allPersonas.find((p) => p.id === action.persona_id);
        const personaName = cleanPersonaName(persona?.name || 'Agente');

        return (
          <div key={action.action_id} className={`popup-card persona-${action.persona_id}`}>
            {/* Cabeçalho do Popup */}
            <div className="popup-card-header">
              <div className="popup-badge">
                {renderPersonaIcon(action.persona_id)}
                <span>{personaName}</span>
              </div>

              <div className="popup-header-actions">
                <button
                  type="button"
                  className="popup-icon-btn"
                  onClick={() => handleCopy(action.action_id, action.content)}
                  title={copied ? 'Copiado!' : 'Copiar resposta'}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <button
                  type="button"
                  className="popup-icon-btn"
                  onClick={() => dismissPopup(action.action_id)}
                  title="Fechar (Dispensar)"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Conteúdo textual do Popup formatado em Markdown */}
            <MarkdownViewer
              content={action.content}
              className="popup-card-content"
            />

            {/* Ações de aprovação (se exigidas) */}
            {action.requires_interaction && (
              <div className="popup-actions-row">
                <button
                  type="button"
                  className="popup-btn-accept"
                  onClick={() => handleInteractionStrict(action.action_id, 'accepted')}
                >
                  <Check size={13} style={{ marginRight: '4px' }} /> Aceitar
                </button>
                <button
                  type="button"
                  className="popup-btn-deny"
                  onClick={() => handleInteractionStrict(action.action_id, 'denied')}
                >
                  <X size={13} style={{ marginRight: '4px' }} /> Negar
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
