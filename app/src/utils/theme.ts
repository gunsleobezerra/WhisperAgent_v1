import { emit } from '@tauri-apps/api/event';

export interface ThemeConfig {
  id: string;
  name: string;
  accentColor: string;
  bgOverlay: string;
  bgSettings: string;
  bgCard: string;
  textPrimary: string;
  textSecondary: string;
  textPartial: string;
  borderColor: string;

  // Tokens semânticos monocromáticos complementares
  accentHover?: string;
  accentText?: string;
  accentSubtle?: string;
  bgInput?: string;
  borderFocus?: string;
  textMuted?: string;
}

export const PRESET_THEMES: ThemeConfig[] = [
  {
    id: 'monochrome_obsidian',
    name: 'Monochrome Obsidian',
    accentColor: '#ffffff',
    bgOverlay: 'rgba(10, 10, 12, 0.82)',
    bgSettings: '#0d0d11',
    bgCard: '#18181b',
    textPrimary: '#fafafa',
    textSecondary: '#a1a1aa',
    textPartial: '#e4e4e7',
    borderColor: 'rgba(255, 255, 255, 0.10)',
    accentHover: '#e4e4e7',
    accentText: '#09090b',
    accentSubtle: 'rgba(255, 255, 255, 0.12)',
    bgInput: 'rgba(255, 255, 255, 0.04)',
    borderFocus: 'rgba(255, 255, 255, 0.35)',
    textMuted: '#71717a',
  },
  {
    id: 'monochrome_carbon',
    name: 'Monochrome Carbon',
    accentColor: '#e4e4e7',
    bgOverlay: 'rgba(9, 9, 11, 0.82)',
    bgSettings: '#09090b',
    bgCard: '#121214',
    textPrimary: '#f4f4f5',
    textSecondary: '#a1a1aa',
    textPartial: '#d4d4d8',
    borderColor: 'rgba(255, 255, 255, 0.10)',
    accentHover: '#f4f4f5',
    accentText: '#09090b',
    accentSubtle: 'rgba(255, 255, 255, 0.12)',
    bgInput: 'rgba(255, 255, 255, 0.04)',
    borderFocus: 'rgba(255, 255, 255, 0.35)',
    textMuted: '#71717a',
  },
  {
    id: 'monochrome_slate',
    name: 'Monochrome Slate',
    accentColor: '#cbd5e1',
    bgOverlay: 'rgba(15, 23, 42, 0.82)',
    bgSettings: '#0f172a',
    bgCard: '#1e293b',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    textPartial: '#cbd5e1',
    borderColor: 'rgba(255, 255, 255, 0.10)',
    accentHover: '#e2e8f0',
    accentText: '#0f172a',
    accentSubtle: 'rgba(255, 255, 255, 0.12)',
    bgInput: 'rgba(255, 255, 255, 0.04)',
    borderFocus: 'rgba(255, 255, 255, 0.35)',
    textMuted: '#64748b',
  },
  {
    id: 'monochrome_titanium',
    name: 'Monochrome Titanium',
    accentColor: '#d6d3d1',
    bgOverlay: 'rgba(28, 25, 23, 0.82)',
    bgSettings: '#1c1917',
    bgCard: '#292524',
    textPrimary: '#fafaf9',
    textSecondary: '#a8a29e',
    textPartial: '#d6d3d1',
    borderColor: 'rgba(255, 255, 255, 0.10)',
    accentHover: '#e7e5e4',
    accentText: '#1c1917',
    accentSubtle: 'rgba(255, 255, 255, 0.12)',
    bgInput: 'rgba(255, 255, 255, 0.04)',
    borderFocus: 'rgba(255, 255, 255, 0.35)',
    textMuted: '#78716c',
  },
  {
    id: 'monochrome_oled',
    name: 'Monochrome OLED Pitch Black',
    accentColor: '#ffffff',
    bgOverlay: 'rgba(0, 0, 0, 0.90)',
    bgSettings: '#000000',
    bgCard: '#111111',
    textPrimary: '#ffffff',
    textSecondary: '#888888',
    textPartial: '#cccccc',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    accentHover: '#e5e5e5',
    accentText: '#000000',
    accentSubtle: 'rgba(255, 255, 255, 0.15)',
    bgInput: 'rgba(255, 255, 255, 0.05)',
    borderFocus: 'rgba(255, 255, 255, 0.45)',
    textMuted: '#666666',
  },
];

export const DEFAULT_THEME = PRESET_THEMES[0];

export function applyThemeToDom(theme: ThemeConfig) {
  const root = document.documentElement;
  root.style.setProperty('--accent-color', theme.accentColor);
  root.style.setProperty('--bg-overlay', theme.bgOverlay);
  root.style.setProperty('--bg-settings', theme.bgSettings);
  root.style.setProperty('--bg-card', theme.bgCard);
  root.style.setProperty('--text-primary', theme.textPrimary);
  root.style.setProperty('--text-secondary', theme.textSecondary);
  root.style.setProperty('--text-partial', theme.textPartial);
  root.style.setProperty('--border-color', theme.borderColor);

  // Tokens semânticos complementares monocromáticos
  root.style.setProperty('--accent-hover', theme.accentHover ?? '#e4e4e7');
  root.style.setProperty('--accent-text', theme.accentText ?? '#09090b');
  root.style.setProperty('--accent-subtle', theme.accentSubtle ?? 'rgba(255, 255, 255, 0.12)');
  root.style.setProperty('--bg-input', theme.bgInput ?? 'rgba(255, 255, 255, 0.04)');
  root.style.setProperty('--border-focus', theme.borderFocus ?? 'rgba(255, 255, 255, 0.35)');
  root.style.setProperty('--text-muted', theme.textMuted ?? '#71717a');
}

export function getStoredTheme(): ThemeConfig {
  try {
    const raw = localStorage.getItem('whisper_agent_theme');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.accentColor && parsed.bgOverlay) {
        // Migra automaticamente temas legados coloridos para o padrão monocromático
        const legacyThemeIds = [
          'modern_dark',
          'cyberpunk',
          'matrix',
          'ocean',
          'sunset',
          'dracula',
        ];
        if (legacyThemeIds.includes(parsed.id)) {
          return DEFAULT_THEME;
        }
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Erro ao carregar tema salvo:', e);
  }
  return DEFAULT_THEME;
}

export async function saveAndBroadcastTheme(theme: ThemeConfig) {
  try {
    localStorage.setItem('whisper_agent_theme', JSON.stringify(theme));
    applyThemeToDom(theme);

    try {
      await emit('whisper-theme-changed', theme);
    } catch (ipcErr) {
      // Ignora se estiver fora do Tauri (ex: navegador web)
    }
  } catch (e) {
    console.error('Erro ao salvar e transmitir tema:', e);
  }
}
