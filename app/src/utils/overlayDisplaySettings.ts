import { emit } from '@tauri-apps/api/event';

export type HighlightMode = 'auto' | 'custom' | 'llm' | 'hybrid';
export type HighlightStyle = 'marker' | 'colored_text' | 'underline';

export interface OverlayDisplaySettings {
  wordByWordAnimation: boolean;
  highlightEnabled: boolean;
  highlightMode: HighlightMode;
  highlightStyle: HighlightStyle;
  highlightColor: string; // Cor personalizada do grifo (ex: #38bdf8, #facc15, #ec4899, #4ade80, #a855f7)
  customKeywords: string[];
  maxLinesVisible: number; // Ex: 1 a 6 linhas ou 0 para ilimitado
  llmSilenceSeconds: number; // Quantos segundos esperar em silêncio antes de chamar o LLM
}

export const DEFAULT_OVERLAY_DISPLAY_SETTINGS: OverlayDisplaySettings = {
  wordByWordAnimation: true,
  highlightEnabled: true,
  highlightMode: 'auto',
  highlightStyle: 'colored_text',
  highlightColor: '#38bdf8',
  customKeywords: ['atenção', 'urgente', 'whisper', 'tauri', 'concurso', 'artigo', 'lei'],
  maxLinesVisible: 3,
  llmSilenceSeconds: 1.0,
};

const STORAGE_KEY = 'whisper_overlay_display_settings';

export function getStoredOverlayDisplaySettings(): OverlayDisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OVERLAY_DISPLAY_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_OVERLAY_DISPLAY_SETTINGS,
      ...parsed,
      customKeywords: Array.isArray(parsed.customKeywords)
        ? parsed.customKeywords
        : DEFAULT_OVERLAY_DISPLAY_SETTINGS.customKeywords,
    };
  } catch {
    return { ...DEFAULT_OVERLAY_DISPLAY_SETTINGS };
  }
}

export async function saveAndBroadcastOverlayDisplaySettings(
  settings: OverlayDisplaySettings
): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    await emit('whisper-overlay-display-settings-changed', settings);
  } catch (err) {
    console.warn('Erro ao salvar ou emitir whisper-overlay-display-settings-changed:', err);
  }
}

// Lista de Stopwords em Português para filtrar no modo automático
export const PORTUGUESE_STOPWORDS = new Set([
  'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'não', 'uma',
  'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'foi', 'ao',
  'ele', 'das', 'tem', 'à', 'seu', 'sua', 'ou', 'ser', 'quando', 'muito', 'há',
  'nos', 'já', 'está', 'eu', 'também', 'só', 'pelo', 'pela', 'até', 'isso', 'ela',
  'entre', 'era', 'depois', 'sem', 'mesmo', 'aos', 'ter', 'seus', 'quem', 'nas',
  'me', 'esse', 'eles', 'estão', 'você', 'tinha', 'foram', 'essa', 'num', 'nem',
  'suas', 'meu', 'às', 'minha', 'têm', 'numa', 'pelos', 'elas', 'havia', 'seja',
  'qual', 'será', 'nós', 'tenho', 'lhe', 'deles', 'essas', 'esses', 'pelas', 'este',
  'fosse', 'dele', 'tu', 'te', 'vocês', 'vos', 'meus', 'minhas', 'teu', 'tua',
  'teus', 'tuas', 'nosso', 'nossa', 'nossos', 'nossas', 'dela', 'delas', 'esta',
  'estas', 'aquele', 'aquela', 'aqueles', 'aquelas', 'isto', 'aquilo', 'estou',
  'está', 'estamos', 'estão', 'estive', 'esteve', 'estivemos', 'estiveram',
  'estava', 'estávamos', 'estavam', 'sou', 'somos', 'são', 'era', 'éramos', 'eram',
  'fui', 'foi', 'fomos', 'foram', 'fora', 'fôramos', 'seja', 'sejamos', 'sejam',
  'fosse', 'fôssemos', 'fossem', 'for', 'formos', 'forem', 'serei', 'será',
  'seremos', 'serão', 'seria', 'seríamos', 'seriam', 'tenho', 'tem', 'temos',
  'têm', 'tinha', 'tínhamos', 'tinham', 'tive', 'teve', 'tivemos', 'tiveram',
  'tivera', 'tivéramos', 'tenha', 'tenhamos', 'tenham', 'tivesse', 'tivéssemos',
  'tivessem', 'tiver', 'tivermos', 'tiverem', 'terei', 'terá', 'teremos',
  'terão', 'teria', 'teríamos', 'teriam', 'aqui', 'ali', 'lá', 'onde', 'aonde',
  'bom', 'bem', 'mal', 'tudo', 'nada', 'coisa', 'algo', 'pra', 'pro', 'pras', 'pros',
  'então', 'assim', 'pois', 'portanto', 'logo', 'porque', 'porquê', 'né', 'ah', 'oh', 'ok',
]);

/**
 * Avalia se uma palavra deve ser grifada com base nas configurações e metadados.
 */
export function isWordKeyword(
  word: string,
  settings: OverlayDisplaySettings,
  llmKeywords?: Set<string>
): boolean {
  if (!settings.highlightEnabled) return false;

  const cleanWord = word.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'<>]/g, '').trim();
  if (!cleanWord || cleanWord.length <= 1) return false;

  const lower = cleanWord.toLowerCase();

  // MODO 2 ou HÍBRIDO: Lista personalizada
  if (settings.highlightMode === 'custom' || settings.highlightMode === 'hybrid') {
    const isCustom = settings.customKeywords.some((kw) => {
      const kwTrim = kw.trim().toLowerCase();
      if (!kwTrim) return false;
      return lower === kwTrim || lower.includes(kwTrim);
    });
    if (isCustom) return true;
    if (settings.highlightMode === 'custom') return false;
  }

  // MODO 3 ou HÍBRIDO: LLM
  if (settings.highlightMode === 'llm' || settings.highlightMode === 'hybrid') {
    if (llmKeywords && (llmKeywords.has(lower) || llmKeywords.has(cleanWord))) {
      return true;
    }
    if (settings.highlightMode === 'llm') return false;
  }

  // MODO 1 ou HÍBRIDO: Automático Instantâneo
  if (settings.highlightMode === 'auto' || settings.highlightMode === 'hybrid') {
    // 1. Números, percentuais, valores monetários ou códigos (ex: 1988, 50%, R$20, v2)
    if (/\d/.test(cleanWord)) return true;

    // 2. Siglas em caixa alta (ex: STF, CF, API, SUS, TJSP, IA) com 2 ou mais letras
    if (cleanWord.length >= 2 && cleanWord === cleanWord.toUpperCase() && /[A-Z]/.test(cleanWord)) {
      return true;
    }

    // 3. Palavras técnicas e substantivos com mais de 4 letras que não sejam stopwords
    if (cleanWord.length >= 5 && !PORTUGUESE_STOPWORDS.has(lower)) {
      return true;
    }
  }

  return false;
}
