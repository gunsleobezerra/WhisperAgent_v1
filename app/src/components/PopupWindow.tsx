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

export function PopupWindow() {
  const [popups, setPopups] = useState<PopupItem[]>([]);
  const [, setSettings] = useState<PopupSettingsConfig>(getStoredPopupSettings);
  const containerRef = useRef<HTMLDivElement>(null);
  const handledIdsRef = useRef<Set<string>>(new Set());

  // Redimensiona a janela dinamicamente para acomodar a pilha de popups
  useLayoutEffect(() => {
    if (popups.length === 0) {
      return;
    }

    const checkHeightAndResize = () => {
      if (!containerRef.current) return;
      const screenMaxHeight = window.screen?.availHeight ? window.screen.availHeight - 60 : 850;
      const totalHeight = containerRef.current.scrollHeight + 30;

      // Se a pilha de popups estiver batendo no teto (exceder a altura da tela),
      // descartamos os popups mais antigos (no topo da pilha) até caber
      if (totalHeight > screenMaxHeight && popups.length > 1) {
        setPopups((prev) => (prev.length > 1 ? prev.slice(1) : prev));
        return;
      }

      const clampedHeight = Math.min(screenMaxHeight, Math.max(120, Math.ceil(totalHeight)));
      const width = 400;

      const currentSettings = getStoredPopupSettings();
      invoke('show_corner_popup', {
        corner: currentSettings.screenCorner || 'top-right',
        width,
        height: clampedHeight,
      }).catch(() => {});
    };

    // Executa medição
    checkHeightAndResize();
    const t = setTimeout(checkHeightAndResize, 50);

    return () => {
      clearTimeout(t);
    };
  }, [popups]);

  // Adiciona novo popup à fila
  const pushPopup = (action: LlmActionTriggered) => {
    if (!action || (action.action_type && action.action_type !== 'popup')) return;
    const currentSettings = getStoredPopupSettings();
    if (currentSettings.popupEnabled === false) return;

    if (handledIdsRef.current.has(action.action_id)) {
      return;
    }
    handledIdsRef.current.add(action.action_id);

    if (currentSettings.soundEnabled) {
      playPopupSound(currentSettings.soundTone, currentSettings.soundVolume);
    }

    setPopups((prev) => {
      const alreadyInList = prev.some((p) => p.action.action_id === action.action_id);
      if (alreadyInList) return prev;

      const updated = [...prev, { action, addedAt: Date.now(), copied: false }];
      // Limite de segurança de 6 popups simultâneos para evitar sobrecarga
      if (updated.length > 6) {
        return updated.slice(updated.length - 6);
      }
      return updated;
    });

    // Auto dismiss individual com base nas configurações
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
    // Sincroniza configurações de popups
    let unlistenSettings = () => {};
    listen<PopupSettingsConfig>('whisper-popup-settings-changed', (event) => {
      if (event.payload) {
        setSettings(event.payload);
        if (event.payload.popupEnabled === false) {
          setPopups([]);
        }
      }
    })
      .then((f) => (unlistenSettings = f))
      .catch(() => {});

    // Escuta evento do tray para ativar/desativar
    let unlistenTray = () => {};
    listen<{ enabled: boolean }>('tray-popups-toggled', (event) => {
      if (event.payload && event.payload.enabled === false) {
        setPopups([]);
      }
    })
      .then((f) => (unlistenTray = f))
      .catch(() => {});

    // Escuta evento show_popup_content
    let unlistenPopupContent = () => {};
    listen<LlmActionTriggered>('show_popup_content', (event) => {
      if (event.payload) {
        pushPopup(event.payload);
      }
    })
      .then((f) => (unlistenPopupContent = f))
      .catch(() => {});

    // Escuta evento global de ação disparada pelo LLM
    let unlistenLlmAction = () => {};
    listen<LlmActionTriggered>('llm_action_triggered', (event) => {
      if (event.payload) {
        pushPopup(event.payload);
      }
    })
      .then((f) => (unlistenLlmAction = f))
      .catch(() => {});

    // Recupera última ação se houver ao inicializar
    invoke<LlmActionTriggered | null>('get_current_popup_action')
      .then((saved) => {
        if (saved) {
          pushPopup(saved);
        }
      })
      .catch(() => {});

    return () => {
      unlistenSettings();
      unlistenTray();
      unlistenPopupContent();
      unlistenLlmAction();
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

  if (popups.length === 0) {
    return <div className="popup-window-empty" />;
  }

  const allPersonas = getStoredPersonas();

  return (
    <div className="popup-window-wrapper">
      <div ref={containerRef} className="popup-stack-container">
        {popups.map(({ action, copied }) => {
          const persona = allPersonas.find((p) => p.id === action.persona_id);
          const personaName = cleanPersonaName(persona?.name || 'Agente');

          return (
            <div
              key={action.action_id}
              className={`popup-card persona-${action.persona_id} standalone-popup`}
            >
              {/* Cabeçalho do Popup */}
              <div className="popup-card-header" data-tauri-drag-region>
                <div
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                  data-tauri-drag-region
                >
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
                  <span
                    data-tauri-drag-region
                    style={{ color: 'rgba(255,255,255,0.2)', fontSize: '11px' }}
                  >
                    |
                  </span>
                  <div className="popup-badge" data-tauri-drag-region>
                    {renderPersonaIcon(action.persona_id)}
                    <span>{personaName}</span>
                  </div>
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
                    className="popup-icon-btn close"
                    onClick={() => dismissPopup(action.action_id)}
                    title="Fechar (Dispensar)"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              {/* Conteúdo textual formatado em Markdown */}
              <MarkdownViewer
                content={action.content}
                className="popup-card-content standalone-scroll"
              />

              {/* Ações interativas se exigidas */}
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
    </div>
  );
}
