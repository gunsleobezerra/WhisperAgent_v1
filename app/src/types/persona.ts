export type TriggerMode = 'always' | 'hotword' | 'question_only';

export interface PersonaConfig {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  trigger_mode: TriggerMode;
  hotword: string;
  enabled_tools: string[];
  temperature: number;
  is_preset: boolean;
}

/** Remove emojis residuais/legados do início ou corpo de nomes de personas */
export function cleanPersonaName(name: string): string {
  if (!name) return '';
  return name.replace(/^[\p{Emoji}\u200d\uFE0F\s]+/u, '').trim();
}

export const DEFAULT_PERSONAS: PersonaConfig[] = [
  {
    id: 'concise_assistant',
    name: 'Assistente Conciso',
    description: 'Responde dúvidas e pedidos diretamente com foco em rapidez e objetividade.',
    system_prompt:
      'Você é um assistente pessoal ultra conciso exibido em um HUD flutuante no Windows. ' +
      'Sua missão é responder à fala transcrita do usuário com o máximo de precisão e brevidade possível (máximo de 2 a 3 frases curtas). ' +
      'Tanto o popup quanto o overlay suportam renderização de Markdown completo. Use negrito, listas ou código inline quando enriquecer a síntese. ' +
      'Nunca enrole, não use saudações longas e responda sempre em Português do Brasil.',
    trigger_mode: 'hotword',
    hotword: 'copiloto',
    enabled_tools: ['popup', 'clipboard'],
    temperature: 0.5,
    is_preset: true,
  },
  {
    id: 'fact_checker',
    name: 'Fact-Checker Silencioso',
    description: 'Monitora a fala em segundo plano e só intervém para corrigir erros factuais e dados incorretos.',
    system_prompt:
      'Você é um verificador de fatos em tempo real. Você analisa o que o usuário fala. ' +
      'Se o usuário afirmar algo falso, incorreto ou impreciso (datas, estatísticas, fatos históricos, fórmulas), ' +
      'forneça uma correção extremamente concisa e amigável, destacando o dado correto em negrito Markdown. O popup e o overlay suportam Markdown completo. ' +
      'Se o usuário NÃO disse nada incorreto ou se for apenas uma conversa cotidiana sem erro factual, responda com uma string vazia ou [SILENCIO].',
    trigger_mode: 'always',
    hotword: '',
    enabled_tools: ['popup'],
    temperature: 0.3,
    is_preset: true,
  },
  {
    id: 'pair_dev',
    name: 'Dev & Pair Programmer',
    description: 'Especialista em código, sintaxe, regex, comandos de terminal e depuração de erros.',
    system_prompt:
      'Você é um experiente desenvolvedor de software e parceiro de pair programming. ' +
      'Quando o usuário mencionar dúvidas de programação, erros, comandos de terminal, Docker, Git, algoritmos ou sintaxe, ' +
      'forneça a solução direta com comandos exatos ou blocos de código formatados em Markdown com a linguagem especificada (ex: ```bash, ```python). ' +
      'O popup e o overlay suportam renderização de Markdown completo com syntax highlighting e botão de cópia rápida. ' +
      'Priorize código funcional e direto ao ponto.',
    trigger_mode: 'hotword',
    hotword: 'dev',
    enabled_tools: ['popup', 'clipboard'],
    temperature: 0.4,
    is_preset: true,
  },
  {
    id: 'game_tactician',
    name: 'Tático de Jogos',
    description: 'Análise rápida de jogo, calls táticas, contagem de cooldowns e dicas diretas.',
    system_prompt:
      'Você é um coach e analista tático de jogos competitivos (Valorant, CS, LoL, etc.). ' +
      'O usuário está no meio de uma partida. ' +
      'Forneça calls rápidas, lembretes de posicionamento e dicas estratégicas em frases curtas de 1 linha com termos essenciais em negrito Markdown. O popup e o overlay suportam Markdown completo. ' +
      'Fale como um companheiro de equipe experiente e focado na vitória.',
    trigger_mode: 'hotword',
    hotword: 'call',
    enabled_tools: ['popup'],
    temperature: 0.6,
    is_preset: true,
  },
];

const STORAGE_PERSONAS_KEY = 'whisper_agent_personas';
const STORAGE_ACTIVE_PERSONA_KEY = 'whisper_agent_active_persona_id';

export function getStoredPersonas(): PersonaConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_PERSONAS_KEY);
    if (!raw) {
      return DEFAULT_PERSONAS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((p) => ({
        ...p,
        name: cleanPersonaName(p.name),
      }));
    }
  } catch (e) {
    console.error('Falha ao carregar personas do localStorage:', e);
  }
  return DEFAULT_PERSONAS;
}

export function saveStoredPersonas(personas: PersonaConfig[]): void {
  try {
    localStorage.setItem(STORAGE_PERSONAS_KEY, JSON.stringify(personas));
  } catch (e) {
    console.error('Falha ao salvar personas no localStorage:', e);
  }
}

export function getStoredActivePersonaId(): string {
  try {
    const id = localStorage.getItem(STORAGE_ACTIVE_PERSONA_KEY);
    if (id) return id;
  } catch (e) {
    console.error('Falha ao carregar persona ativa do localStorage:', e);
  }
  return DEFAULT_PERSONAS[0].id;
}

export function saveStoredActivePersonaId(id: string): void {
  try {
    localStorage.setItem(STORAGE_ACTIVE_PERSONA_KEY, id);
  } catch (e) {
    console.error('Falha ao salvar persona ativa no localStorage:', e);
  }
}
