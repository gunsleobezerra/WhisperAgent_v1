import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { PopupSoundTone } from './audioNotification';

export type PopupDisplayMode = 'inline' | 'screen_corner' | 'overlay';
export type ScreenCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export interface PopupSettingsConfig {
  displayMode: PopupDisplayMode;
  screenCorner: ScreenCorner;
  soundEnabled: boolean;
  soundTone: PopupSoundTone;
  soundVolume: number; // 0 a 100
  autoDismissSeconds: number;
  minCharsToTrigger: number; // Mínimo de caracteres para disparar a persona
}

export const DEFAULT_POPUP_SETTINGS: PopupSettingsConfig = {
  displayMode: 'screen_corner',
  screenCorner: 'top-right',
  soundEnabled: true,
  soundTone: 'chime',
  soundVolume: 80,
  autoDismissSeconds: 10,
  minCharsToTrigger: 20,
};

const STORAGE_KEY = 'whisper_agent_popup_settings';

export function getStoredPopupSettings(): PopupSettingsConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        displayMode: ['inline', 'screen_corner', 'overlay'].includes(parsed.displayMode)
          ? parsed.displayMode
          : DEFAULT_POPUP_SETTINGS.displayMode,
        screenCorner: ['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(parsed.screenCorner)
          ? parsed.screenCorner
          : DEFAULT_POPUP_SETTINGS.screenCorner,
        soundEnabled: typeof parsed.soundEnabled === 'boolean'
          ? parsed.soundEnabled
          : DEFAULT_POPUP_SETTINGS.soundEnabled,
        soundTone: parsed.soundTone || DEFAULT_POPUP_SETTINGS.soundTone,
        soundVolume: typeof parsed.soundVolume === 'number'
          ? Math.max(0, Math.min(100, parsed.soundVolume))
          : DEFAULT_POPUP_SETTINGS.soundVolume,
        autoDismissSeconds: typeof parsed.autoDismissSeconds === 'number'
          ? parsed.autoDismissSeconds
          : DEFAULT_POPUP_SETTINGS.autoDismissSeconds,
        minCharsToTrigger: typeof parsed.minCharsToTrigger === 'number'
          ? Math.max(1, Math.min(500, parsed.minCharsToTrigger))
          : DEFAULT_POPUP_SETTINGS.minCharsToTrigger,
      };
    }
  } catch (e) {
    console.warn('Erro ao carregar configurações de popup salvas:', e);
  }
  return DEFAULT_POPUP_SETTINGS;
}

export async function saveAndBroadcastPopupSettings(settings: PopupSettingsConfig): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    try {
      await emit('whisper-popup-settings-changed', settings);
      await invoke('set_min_chars_to_trigger', { minChars: settings.minCharsToTrigger });
    } catch {
      // Ignora erro em ambientes sem Tauri IPC (ex: navegador web)
    }
  } catch (e) {
    console.error('Erro ao salvar e transmitir configurações de popup:', e);
  }
}
