import { useEffect, useState, useRef } from 'react';
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

export function PopupSystem() {
  const [popup, setPopup] = useState<LlmActionTriggered | null>(null);
  const [copied, setCopied] = useState(false);
  const [, setSettings] = useState<PopupSettingsConfig>(getStoredPopupSettings);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unlistenSettings = () => {};
    listen<PopupSettingsConfig>('whisper-popup-settings-changed', (event) => {
      if (event.payload) {
        setSettings(event.payload);
      }
    })
      .then((f) => (unlistenSettings = f))
      .catch(() => {});

    let unlistenFn = () => {};
    listen<LlmActionTriggered>('llm_action_triggered', (event) => {
      const payload = event.payload;
      if (payload.action_type === 'popup') {
        const currentSettings = getStoredPopupSettings();
        // Apenas renderiza no PopupSystem do LiveOverlay se o modo for 'overlay'
        if (currentSettings.displayMode === 'overlay') {
          setPopup(payload);
          setCopied(false);

          if (currentSettings.soundEnabled) {
            playPopupSound(currentSettings.soundTone, currentSettings.soundVolume);
          }

          if (timerRef.current) clearTimeout(timerRef.current);
          if (!payload.requires_interaction) {
            const timeoutMs = (currentSettings.autoDismissSeconds || 10) * 1000;
            timerRef.current = setTimeout(() => {
              setPopup(null);
            }, timeoutMs);
          }
        }
      }
    })
      .then((f) => (unlistenFn = f))
      .catch(() => console.warn('Tauri IPC indisponível (modo web)'));

    return () => {
      unlistenSettings();
      unlistenFn();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

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
    setPopup(null);
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

  if (!popup) return null;

  // Busca o nome legível e ícone da persona
  const allPersonas = getStoredPersonas();
  const persona = allPersonas.find((p) => p.id === popup.persona_id);
  const personaName = cleanPersonaName(persona?.name || 'Agente');

  return (
    <div className={`popup-card persona-${popup.persona_id}`}>
      {/* Cabeçalho do Popup */}
      <div className="popup-card-header">
        <div className="popup-badge">
          {renderPersonaIcon(popup.persona_id)}
          <span>{personaName}</span>
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
            className="popup-icon-btn"
            onClick={() => setPopup(null)}
            title="Fechar (Dispensar)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Conteúdo textual do Popup formatado em Markdown */}
      <MarkdownViewer
        content={popup.content}
        className="popup-card-content"
      />

      {/* Ações de aprovação (se exigidas) */}
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
  );
}
