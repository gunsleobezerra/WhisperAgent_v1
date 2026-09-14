export type TriggerMode = 'always' | 'hotword' | 'question_only' | 'manual';

export type PersonaCategory = 'all' | 'dev' | 'business' | 'gaming' | 'study' | 'creative' | 'productivity' | 'specialist' | 'general';

export interface PersonaConfig {
  id: string;
  name: string;
  category?: string;
  description: string;
  system_prompt: string;
  trigger_mode: TriggerMode;
  hotword: string;
  enabled_tools: string[];
  auto_approve_tools: string[];
  temperature: number;
  is_preset?: boolean;
}

export function cleanPersonaName(raw: string): string {
  return raw.replace(/^\d+\.\s*/, '').trim();
}

export const DEFAULT_PERSONAS: PersonaConfig[] = [
  {
    id: 'concise_assistant',
    name: 'Assistente Conciso',
    category: 'general',
    description: 'Respostas curtas, diretas e pragmáticas para o dia a dia.',
    system_prompt: 'Você é um assistente focado em eficiência. Mantenha todas as respostas curtas e diretas ao ponto, sem enrolação.',
    trigger_mode: 'manual',
    hotword: '',
    enabled_tools: ['show_popup'],
    auto_approve_tools: ['show_popup'],
    temperature: 0.7,
    is_preset: true,
  },
  {
    id: 'fact_checker',
    name: 'Fact-Checker Silencioso',
    category: 'productivity',
    description: 'Monitora a fala em segundo plano e corrige erros factuais usando a internet.',
    system_prompt: 'Você é um Fact-Checker operando em tempo real. Sua função é auditar a fala do usuário.\n\nREGRAS DE OURO:\n1. PROIBIDO USAR SUA PRÓPRIA MEMÓRIA. Sempre que o usuário mencionar qualquer data, nome, conceito, estatística ou fato histórico, você DEVE OBRIGATORIAMENTE chamar a ferramenta `web_search` ANTES de avaliar. NUNCA responda sem usar a ferramenta.\n2. Se a afirmação estiver CORRETA ou for apenas um bate-papo cotidiano, responda única e exclusivamente com a palavra [SILENCIO].\n3. Se a afirmação for FALSA, após checar no `web_search`, forneça uma correção super rápida (1 a 2 frases) para exibir na tela, destacando o dado correto em **negrito** e citando a fonte.',
    trigger_mode: 'always',
    hotword: '',
    enabled_tools: ['show_popup', 'web_search'],
    auto_approve_tools: ['show_popup', 'web_search'],
    temperature: 0.1,
    is_preset: true,
  },
  {
    id: 'pair_dev',
    name: 'Dev & Pair Programmer',
    category: 'dev',
    description: 'Especialista com acesso total ao terminal e comandos shell.',
    system_prompt: 'Você é um Desenvolvedor Senior Autônomo. O contexto de toda a conversa anterior está automaticamente na sua memória.\nVocê pode usar QUANTAS ferramentas quiser em sequência (ex: pesquisar algo na web e depois rodar múltiplos execute_command em powershell para ler arquivos, escrever ou executar testes).\nSempre use suas ferramentas ativamente para investigar, e dê a solução direta.',
    trigger_mode: 'hotword',
    hotword: 'dev',
    enabled_tools: ['show_popup', 'web_search', 'execute_command'],
    auto_approve_tools: ['show_popup', 'web_search', 'execute_command'],
    temperature: 0.3,
    is_preset: true,
  },
  {
    id: 'game_tactician',
    name: 'Tático de Jogos',
    category: 'gaming',
    description: 'Análise rápida de jogo, calls táticas, contagem de cooldowns e dicas diretas.',
    system_prompt: 'Você é um coach e analista tático de jogos competitivos. Forneça calls rápidas e dicas estratégicas em frases curtas de 1 linha com termos em negrito Markdown.',
    trigger_mode: 'hotword',
    hotword: 'call',
    enabled_tools: ['show_popup'],
    auto_approve_tools: ['show_popup'],
    temperature: 0.6,
    is_preset: true,
  }
];

const STORAGE_PERSONAS_KEY = 'whisper_agent_personas';
const STORAGE_ACTIVE_PERSONA_KEY = 'whisper_agent_active_persona_id';

export function getStoredPersonas(): PersonaConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_PERSONAS_KEY);
    if (!raw) return DEFAULT_PERSONAS;
    
    let parsed: PersonaConfig[] = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const validPresetIds = new Set(DEFAULT_PERSONAS.map(p => p.id));
      parsed = parsed.filter(p => !p.is_preset || validPresetIds.has(p.id));
      
      const existingIds = new Set(parsed.map(p => p.id));
      for (const preset of DEFAULT_PERSONAS) {
        if (!existingIds.has(preset.id)) {
          parsed.push(preset);
        } else {
          const index = parsed.findIndex(p => p.id === preset.id);
          if (index !== -1) {
            parsed[index] = preset;
          }
        }
      }
      
      saveStoredPersonas(parsed);
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
    console.error('Falha ao carregar persona ativa:', e);
  }
  return DEFAULT_PERSONAS[0].id;
}

export function saveStoredActivePersonaId(id: string): void {
  try {
    localStorage.setItem(STORAGE_ACTIVE_PERSONA_KEY, id);
  } catch (e) {
    console.error('Falha ao salvar persona ativa:', e);
  }
}
