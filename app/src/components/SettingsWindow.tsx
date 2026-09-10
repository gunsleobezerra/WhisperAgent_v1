import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';
import {
  X,
  Mic,
  MicOff,
  FileText,
  Users,
  Cpu,
  Sliders,
  Palette,
  Activity,
  VolumeX,
  Headphones,
  Clock,
  Volume2,
  TrendingUp,
  AlertTriangle,
  Pause,
  Play,
  FolderOpen,
  HelpCircle,
  Sparkles,
  Info,
  Plus,
  Check,
  Trash2,
  MessageSquare,
  Copy,
  Save,
  RotateCcw,
  KeyRound,
  Minimize2,
  Tv,
  Maximize2,
  Columns2,
  Layers,
  ShieldCheck,
  Code2,
  Gamepad2,
  Bot,
  Bell,
  LayoutTemplate,
  Monitor,
  Search,
  Type,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  ThemeConfig,
  PRESET_THEMES,
  DEFAULT_THEME,
  getStoredTheme,
  saveAndBroadcastTheme,
  applyThemeToDom,
} from '../utils/theme';
import {
  getStoredPopupSettings,
  saveAndBroadcastPopupSettings,
  PopupSettingsConfig,
} from '../utils/popupSettings';
import {
  playPopupSound,
  SOUND_PRESETS,
  PopupSoundTone,
} from '../utils/audioNotification';
import {
  PersonaConfig,
  TriggerMode,
  DEFAULT_PERSONAS,
  getStoredPersonas,
  saveStoredPersonas,
  getStoredActivePersonaId,
  saveStoredActivePersonaId,
  cleanPersonaName,
} from '../types/persona';

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

interface AudioDevice {
  id: string;
  name: string;
  is_loopback: boolean;
  default: boolean;
}

interface AudioRecordingStats {
  duration_seconds: number;
  sample_rate: number;
  rms_level: number;
  peak_level: number;
  sample_count: number;
  timestamp_ms: number;
}

interface AudioLevelEvent {
  rms: number;
  peak: number;
  is_speaking: boolean;
}

type TabKey = 'audio' | 'transcription' | 'personas' | 'llm' | 'overlay' | 'popups' | 'theme' | 'about';

interface NavTabItem {
  id: TabKey;
  label: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  subtitle: string;
}

const NAV_TABS: NavTabItem[] = [
  {
    id: 'audio',
    label: 'Áudio & Voz',
    icon: Mic,
    title: 'Dispositivos de Áudio & Captação',
    subtitle: 'Microfone de entrada, monitoramento ao vivo em VU e sensibilidade VAD',
  },
  {
    id: 'transcription',
    label: 'Transcrição',
    icon: FileText,
    title: 'Motor de Transcrição & Modelos',
    subtitle: 'Parâmetros Whisper Local, modelos GGML e pós-processamento',
  },
  {
    id: 'personas',
    label: 'Personas',
    icon: Users,
    title: 'Personas & Perfis Especializados',
    subtitle: 'Assistentes inteligentes, prompts customizados e ferramentas integradas',
  },
  {
    id: 'llm',
    label: 'Provedores & Modelos',
    icon: Cpu,
    title: 'Provedores de Inteligência Artificial',
    subtitle: 'Traga sua própria chave de API (BYOK) para endpoints compatíveis',
  },
  {
    id: 'overlay',
    label: 'Overlay',
    icon: Sliders,
    title: 'Aparência & Comportamento do Overlay',
    subtitle: 'Opacidade, tamanho, ancoragem e fluidez na área de trabalho',
  },
  {
    id: 'popups',
    label: 'Ações & Popups',
    icon: Bell,
    title: 'Notificações HUD & Feedback Sonoro',
    subtitle: 'Posição na tela, tons de áudio sintetizado e volume',
  },
  {
    id: 'theme',
    label: 'Tema & Cores',
    icon: Palette,
    title: 'Personalização Visual & Paletas',
    subtitle: 'Presets de cores modernas e customização detalhada de tema',
  },
  {
    id: 'about',
    label: 'Sobre',
    icon: Info,
    title: 'Sobre o WhisperAgent',
    subtitle: 'Identidade visual, arquitetura do sistema e links oficiais',
  },
];

interface SearchConfigItem {
  id: string;
  tab: TabKey;
  title: string;
  description: string;
  keywords: string[];
}

const SETTINGS_SEARCH_INDEX: SearchConfigItem[] = [
  // ÁUDIO
  {
    id: 'audio-device',
    tab: 'audio',
    title: 'Dispositivo de Entrada / Microfone',
    description: 'Selecione o microfone ou fonte de áudio loopback para captura de voz.',
    keywords: ['microfone', 'dispositivo', 'entrada', 'som', 'mic', 'loopback', 'audio', 'fone', 'headset'],
  },
  {
    id: 'audio-mute',
    tab: 'audio',
    title: 'Silenciar Microfone (Mudo)',
    description: 'Pausa a captura do microfone sem desligar a aplicação.',
    keywords: ['mudo', 'silenciar', 'mute', 'desativar', 'microfone', 'voz'],
  },
  {
    id: 'audio-vu-meter',
    tab: 'audio',
    title: 'Nível do Microfone ao Vivo (VU Meter)',
    description: 'Monitor visual em tempo real com níveis RMS e de pico em decibéis.',
    keywords: ['vu meter', 'nivel', 'volume', 'rms', 'pico', 'decibeis', 'ao vivo', 'barra'],
  },
  {
    id: 'audio-vad',
    tab: 'audio',
    title: 'Sensibilidade de Detecção de Voz (VAD)',
    description: 'Define o limiar de energia para iniciar e encerrar a fala automaticamente.',
    keywords: ['vad', 'sensibilidade', 'limiar', 'threshold', 'voz', 'silencio', 'fala', 'corte'],
  },
  {
    id: 'audio-diagnostics',
    tab: 'audio',
    title: 'Diagnóstico & Teste de Reprodução de Áudio',
    description: 'Ouça o áudio gravado no buffer circular e baixe arquivos WAV de depuração.',
    keywords: ['diagnostico', 'ouvir', 'player', 'reproduzir', 'wav', 'buffer', 'gravar', 'teste'],
  },

  // TRANSCRIÇÃO
  {
    id: 'transcription-mode',
    tab: 'transcription',
    title: 'Modo de Transcrição (Whisper)',
    description: 'Escolha entre processamento local via whisper.cpp ou motores alternativos.',
    keywords: ['modo', 'stt', 'whisper', 'local', 'cpp', 'transcricao', 'voz para texto'],
  },
  {
    id: 'transcription-model',
    tab: 'transcription',
    title: 'Modelo Whisper (tiny, base, small, medium)',
    description: 'Alterne o peso do modelo GGML para balancear precisão e uso de CPU.',
    keywords: ['modelo', 'whisper', 'tiny', 'base', 'small', 'medium', 'ggml', 'pesos', 'precisao', 'cpu'],
  },
  {
    id: 'transcription-llm-correction',
    tab: 'transcription',
    title: 'Correção Inteligente de Transcrição via LLM',
    description: 'Ajusta pontuação, sintaxe e termos técnicos automaticamente com IA.',
    keywords: ['correcao', 'llm', 'inteligente', 'pontuacao', 'gramatica', 'ia', 'contexto'],
  },

  // PERSONAS
  {
    id: 'personas-selection',
    tab: 'personas',
    title: 'Seleção de Persona Ativa',
    description: 'Escolha qual assistente orientará as respostas do modelo.',
    keywords: ['persona', 'agente', 'assistente', 'perfil', 'concise', 'fact checker', 'pair dev', 'game tactician'],
  },
  {
    id: 'personas-create',
    tab: 'personas',
    title: 'Criar Nova Persona',
    description: 'Crie perfis personalizados com objetivos e instruções próprias.',
    keywords: ['criar', 'nova persona', 'adicionar', 'novo agente', 'custom'],
  },
  {
    id: 'personas-prompt',
    tab: 'personas',
    title: 'Instruções de Sistema (System Prompt)',
    description: 'Defina o papel, tom e comportamento do assistente em linguagem natural.',
    keywords: ['prompt', 'instrucoes', 'sistema', 'system prompt', 'comportamento', 'diretrizes'],
  },
  {
    id: 'personas-trigger',
    tab: 'personas',
    title: 'Modos de Gatilho (Trigger)',
    description: 'Disparo contínuo, por palavra-chave, atalho global ou silêncio.',
    keywords: ['gatilho', 'trigger', 'continuo', 'palavra-chave', 'atalho', 'silencio', 'disparo'],
  },
  {
    id: 'personas-tools',
    tab: 'personas',
    title: 'Ferramentas Habilitadas da Persona',
    description: 'Habilite ferramentas como busca na web, executor de código e notificações.',
    keywords: ['ferramentas', 'tools', 'web', 'busca', 'codigo', 'notificacao', 'integracao'],
  },

  // IA (BYOK)
  {
    id: 'llm-endpoint',
    tab: 'llm',
    title: 'Endpoint da API de IA',
    description: 'URL base da API compatível com OpenAI (ex: 9router, Groq, OpenRouter).',
    keywords: ['endpoint', 'url', 'base url', 'api', 'provedor', 'servidor', 'openai', 'groq'],
  },
  {
    id: 'llm-key',
    tab: 'llm',
    title: 'Chave de API (API Key)',
    description: 'Sua chave de acesso privada armazenada com segurança localmente.',
    keywords: ['chave', 'api key', 'token', 'secret', 'credencial', 'senha', 'autenticacao'],
  },
  {
    id: 'llm-model',
    tab: 'llm',
    title: 'Identificador do Modelo de Linguagem',
    description: 'Nome do modelo chamado na API (ex: gpt-4o, claude-3-5, llama-3, geral).',
    keywords: ['modelo', 'model', 'nome', 'gpt', 'claude', 'llama', 'qwen', 'geral', 'llm'],
  },

  // OVERLAY
  {
    id: 'overlay-opacity',
    tab: 'overlay',
    title: 'Opacidade do Fundo do Overlay',
    description: 'Ajuste a transparência da janela flutuante de 20% a 100%.',
    keywords: ['opacidade', 'transparencia', 'alpha', 'fundo', 'visibilidade', 'overlay'],
  },
  {
    id: 'overlay-size',
    tab: 'overlay',
    title: 'Largura e Altura do Overlay',
    description: 'Redimensione a largura (320px-1200px) e altura (110px-600px) do card flutuante.',
    keywords: ['tamanho', 'largura', 'altura', 'width', 'height', 'dimensao', 'redimensionar'],
  },
  {
    id: 'overlay-presets',
    tab: 'overlay',
    title: 'Predefinições de Tamanho do Overlay',
    description: 'Alternância rápida entre tamanhos Compacto, Padrão, Médio e Expandido.',
    keywords: ['presets', 'predefinicoes', 'compacto', 'padrao', 'medio', 'expandido', 'tamanho rapido'],
  },
  {
    id: 'overlay-shortcuts',
    tab: 'overlay',
    title: 'Dicas de Atalhos & Comportamento',
    description: 'Instruções para fixação no topo, arrastar pela tela e fechar com ESC.',
    keywords: ['atalhos', 'teclado', 'arrastar', 'fixar', 'topo', 'comportamento', 'janela'],
  },

  // POPUPS & AÇÕES
  {
    id: 'popups-display-mode',
    tab: 'popups',
    title: 'Modo de Exibição dos Popups',
    description: 'Escolha exibir notificações no canto da tela (screen corner) ou dentro do overlay.',
    keywords: ['modo', 'exibicao', 'popup', 'canto da tela', 'screen corner', 'hud', 'notificacao'],
  },
  {
    id: 'popups-corner-position',
    tab: 'popups',
    title: 'Posição no Canto da Tela',
    description: 'Defina o canto da tela para as notificações: superior/inferior direito ou esquerdo.',
    keywords: ['canto', 'posicao', 'corner', 'topo', 'inferior', 'direito', 'esquerdo', 'tela'],
  },
  {
    id: 'popups-sound-toggle',
    tab: 'popups',
    title: 'Efeitos Sonoros de Notificação',
    description: 'Habilite ou desabilite o feedback de áudio sintetizado em novas ações.',
    keywords: ['som', 'efeito sonoro', 'audio', 'notificacao', 'alerta sonoro', 'chime', 'beep'],
  },
  {
    id: 'popups-sound-tone',
    tab: 'popups',
    title: 'Timbre Sonoro (Pop, Sino, Digital, Alerta, Chime)',
    description: 'Escolha o tipo de frequência e harmônico reproduzido na notificação.',
    keywords: ['timbre', 'tom', 'som', 'pop', 'sino', 'digital', 'alerta', 'chime'],
  },
  {
    id: 'popups-sound-volume',
    tab: 'popups',
    title: 'Volume do Alerta Sonoro',
    description: 'Ajuste o ganho sonoro das notificações de 0% a 100%.',
    keywords: ['volume', 'ganho', 'altura', 'som', 'decibeis', 'intensidade'],
  },
  {
    id: 'popups-test',
    tab: 'popups',
    title: 'Disparar Notificação & Som de Teste',
    description: 'Simula um popup do modelo e reproduz o som configurado imediatamente.',
    keywords: ['teste', 'testar', 'disparar', 'simular', 'popup de teste', 'som de teste'],
  },

  // TEMA & CORES
  {
    id: 'theme-presets',
    tab: 'theme',
    title: 'Predefinições de Tema (Dark, Obsidian, Cyberpunk, etc.)',
    description: 'Temas visuais prontos com paletas coordenadas para overlay e configurações.',
    keywords: ['tema', 'presets', 'dark', 'obsidian', 'cyberpunk', 'synthwave', 'midnight', 'light'],
  },
  {
    id: 'theme-custom-colors',
    tab: 'theme',
    title: 'Cores Personalizadas do Tema',
    description: 'Customize cor de destaque (accent), cor de fundo, cards e texto com seletor HEX.',
    keywords: ['cores', 'customizar', 'accent', 'destaque', 'fundo', 'card', 'hex', 'color picker'],
  },
  {
    id: 'theme-preview',
    tab: 'theme',
    title: 'Pré-visualização ao Vivo do Overlay',
    description: 'Veja instantaneamente como a combinação de cores se comportará no HUD flutuante.',
    keywords: ['preview', 'pre-visualizacao', 'ao vivo', 'hud', 'simulacao', 'cores'],
  },

  // SOBRE
  {
    id: 'about-info',
    tab: 'about',
    title: 'Sobre o WhisperAgent',
    description: 'Informações da versão, stack tecnológica, Tauri v2 e whisper.cpp.',
    keywords: ['sobre', 'versao', 'info', 'tauri', 'whisper', 'stack', 'creditos', 'links', 'logo'],
  },
];

export function SettingsWindow() {
  const [activeTab, setActiveTab] = useState<TabKey>('audio');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedView, setSelectedView] = useState<'tab' | 'search'>('tab');

  const isSearching = searchQuery.trim().length > 0;
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return SETTINGS_SEARCH_INDEX.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.includes(q))
    );
  }, [searchQuery]);

  const matchCountByTab = useMemo(() => {
    if (!isSearching) return {} as Record<TabKey, number>;
    const counts: Partial<Record<TabKey, number>> = {};
    for (const item of searchResults) {
      counts[item.tab] = (counts[item.tab] || 0) + 1;
    }
    return counts as Record<TabKey, number>;
  }, [isSearching, searchResults]);

  // Configurações de Áudio
  const [audioMute, setAudioMute] = useState<boolean>(() => localStorage.getItem('audio_mute') === 'true');
  const [activeSourceId, setActiveSourceId] = useState<string>(() => localStorage.getItem('active_source_id') || 'default');
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);

  // Diagnóstico e Escuta do Áudio do Whisper
  const [micLevel, setMicLevel] = useState<AudioLevelEvent>({
    rms: 0,
    peak: 0,
    is_speaking: false,
  });
  const [vadSensitivity, setVadSensitivity] = useState<number>(0.005);
  const [audioStats, setAudioStats] = useState<AudioRecordingStats | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioPlayProgress, setAudioPlayProgress] = useState(0);
  const [audioError, setAudioError] = useState<string>('');
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [activeAudioElement, setActiveAudioElement] = useState<HTMLAudioElement | null>(null);

  // Configurações de Transcrição
  const [transcriptionMode, setTranscriptionMode] = useState<string>(() => localStorage.getItem('transcription_mode') || 'whisper');
  const [whisperModel, setWhisperModel] = useState<string>(() => localStorage.getItem('whisper_model') || 'tiny');
  const [llmCorrectionEnabled, setLlmCorrectionEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('llm_correction_enabled');
    return saved !== null ? saved === 'true' : true;
  });

  // Configurações de Overlay
  const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
    const saved = localStorage.getItem('overlay_opacity');
    return saved ? Number(saved) : 85;
  });
  const [overlayWidth, setOverlayWidth] = useState<number>(() => {
    const saved = localStorage.getItem('overlay_width');
    return saved ? Number(saved) : 500;
  });
  const [overlayHeight, setOverlayHeight] = useState<number>(() => {
    const saved = localStorage.getItem('overlay_height');
    return saved ? Number(saved) : 180;
  });
  const [overlayFontSize, setOverlayFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('overlay_font_size');
    return saved ? Math.max(14, Math.min(36, Number(saved))) : 18;
  });

  // Configurações de IA (BYOK)
  const [byokEndpoint, setByokEndpoint] = useState<string>(() => localStorage.getItem('byok_endpoint') ?? '');
  const [byokApiKey, setByokApiKey] = useState<string>(() => localStorage.getItem('byok_key') ?? '');
  const [byokModel, setByokModel] = useState<string>(() => localStorage.getItem('byok_model') ?? 'geral');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [llmTestStatus, setLlmTestStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const handleTestLlmConnection = async () => {
    if (!byokEndpoint.trim()) {
      setLlmTestStatus({
        type: 'error',
        message: 'Por favor, informe o Endpoint da API antes de testar a conexão.',
      });
      return;
    }

    setIsTestingLlm(true);
    setLlmTestStatus(null);

    try {
      const res = await invoke<{ success: boolean; models: string[]; message: string }>(
        'test_llm_connection_and_fetch_models',
        {
          endpoint: byokEndpoint.trim(),
          apiKey: byokApiKey.trim(),
        }
      );

      if (res.success) {
        setAvailableModels(res.models);
        if (res.models.length > 0) {
          setLlmTestStatus({
            type: 'success',
            message: `Conectado com sucesso! ${res.models.length} modelo(s) encontrado(s).`,
          });
          // Se o modelo atual estiver em branco ou não listado e houver modelos, sugere manter ou usar o primeiro
          if (!byokModel.trim() && res.models[0]) {
            setByokModel(res.models[0]);
          }
        } else {
          setLlmTestStatus({
            type: 'success',
            message: 'Conectado com sucesso! Nenhum modelo foi retornado na rota /models.',
          });
        }
      }
    } catch (err: any) {
      console.error('Erro ao testar conexão LLM:', err);
      const errMsg = typeof err === 'string' ? err : err?.message || 'Falha ao conectar com o endpoint de LLM.';
      setLlmTestStatus({
        type: 'error',
        message: errMsg,
      });
    } finally {
      setIsTestingLlm(false);
    }
  };

  // Configurações de Tema
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(getStoredTheme);

  // Configurações de Personas e Agentes
  const [personas, setPersonas] = useState<PersonaConfig[]>(getStoredPersonas);
  const [activePersonaId, setActivePersonaId] = useState<string>(getStoredActivePersonaId);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(getStoredActivePersonaId);
  const [editingPersona, setEditingPersona] = useState<PersonaConfig>(() => {
    const list = getStoredPersonas();
    const actId = getStoredActivePersonaId();
    return list.find((p) => p.id === actId) || list[0] || DEFAULT_PERSONAS[0];
  });

  // Configurações de Ações e Popups do Modelo
  const [popupSettings, setPopupSettings] = useState<PopupSettingsConfig>(getStoredPopupSettings);
  const [testActionFired, setTestActionFired] = useState(false);
  const [playingTone, setPlayingTone] = useState<string | null>(null);

  const updatePopupSetting = <K extends keyof PopupSettingsConfig>(key: K, value: PopupSettingsConfig[K]) => {
    const next = { ...popupSettings, [key]: value };
    setPopupSettings(next);
    saveAndBroadcastPopupSettings(next);
  };

  const handleTestSound = (tone?: PopupSoundTone) => {
    const toneToPlay = tone || popupSettings.soundTone;
    setPlayingTone(toneToPlay);
    playPopupSound(toneToPlay, popupSettings.soundVolume);
    setTimeout(() => setPlayingTone(null), 600);
  };

  const handleTriggerTestPopup = async () => {
    setTestActionFired(true);
    setTimeout(() => setTestActionFired(false), 3000);

    const testPayload = {
      action_id: `test_${Date.now()}`,
      persona_id: activePersonaId || 'concise_assistant',
      action_type: 'popup',
      content: 'Notificação de teste do modelo! Local de exibição e som configurados com sucesso.',
      requires_interaction: false,
    };

    try {
      if (popupSettings.soundEnabled) {
        handleTestSound();
      }

      if (popupSettings.displayMode === 'screen_corner') {
        await invoke('show_corner_popup', {
          action: testPayload,
          corner: popupSettings.screenCorner,
          width: 380,
          height: 190,
        });
      } else {
        // Dispara o evento que o LiveOverlay ou PopupSystem escutam e processam
        await emit('llm_action_triggered', testPayload);
      }
    } catch (err) {
      console.warn('Erro ao disparar ação de teste:', err);
    }
  };

  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    // Aplica tema salvo no carregamento
    const stored = getStoredTheme();
    setCurrentTheme(stored);
    applyThemeToDom(stored);

    // Sincroniza a persona ativa com o backend Rust
    const initialActive =
      getStoredPersonas().find((p) => p.id === getStoredActivePersonaId()) || DEFAULT_PERSONAS[0];
    invoke('set_active_persona', { persona: initialActive }).catch(() => {});

    // Sincroniza o mínimo de caracteres para disparo com o backend Rust
    const storedPopup = getStoredPopupSettings();
    invoke('set_min_chars_to_trigger', { minChars: storedPopup.minCharsToTrigger }).catch(() => {});

    try {
      invoke<AudioDevice[]>('get_available_audio_devices')
        .then((devices) => {
          setAudioDevices(devices);
          const savedSource = localStorage.getItem('active_source_id');
          if (savedSource) {
            setActiveSourceId(savedSource);
          } else {
            const def = devices.find((d) => d.default && !d.is_loopback);
            if (def) setActiveSourceId(def.id);
          }
        })
        .catch((err) => console.error('Erro ao buscar dispositivos:', err));

      invoke<string>('get_current_whisper_model')
        .then((model) => {
          const saved = localStorage.getItem('whisper_model');
          if (!saved && model) setWhisperModel(model);
        })
        .catch(() => {});

      invoke<number>('get_vad_sensitivity')
        .then((s) => setVadSensitivity(s))
        .catch(() => {});

      invoke<AudioRecordingStats>('get_audio_recording_stats')
        .then((stats) => setAudioStats(stats))
        .catch(() => {});
    } catch (e) {
      console.warn('Ambiente web (sem Tauri) detectado:', e);
    }

    let unlistenAudio = () => {};
    listen<{ deviceId: string }>('audio_source_changed', (event) => {
      if (event.payload?.deviceId) {
        setActiveSourceId(event.payload.deviceId);
      }
    }).then((f) => (unlistenAudio = f)).catch(() => {});

    let unlistenLevel = () => {};
    listen<AudioLevelEvent>('audio_level_meter', (event) => {
      if (event.payload) {
        setMicLevel(event.payload);
      }
    }).then((f) => (unlistenLevel = f)).catch(() => {});

    let unlistenFinalized = () => {};
    listen<AudioRecordingStats>('audio_capture_finalized', (event) => {
      if (event.payload) {
        setAudioStats(event.payload);
      }
    }).then((f) => (unlistenFinalized = f)).catch(() => {});

    return () => {
      unlistenAudio();
      unlistenLevel();
      unlistenFinalized();
    };
  }, []);

  const handlePlayLastAudio = async () => {
    try {
      if (isPlayingAudio && activeAudioElement) {
        activeAudioElement.pause();
        setIsPlayingAudio(false);
        return;
      }
      setAudioError('');
      const bytes = await invoke<number[]>('get_last_captured_audio');
      if (!bytes || bytes.length === 0) {
        setAudioError('Nenhum áudio gravado ainda. Fale no microfone para capturar!');
        return;
      }
      const u8 = new Uint8Array(bytes);
      const blob = new Blob([u8], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
      }
      setCurrentAudioUrl(url);

      const audio = new Audio(url);
      setActiveAudioElement(audio);

      audio.onended = () => {
        setIsPlayingAudio(false);
        setAudioPlayProgress(0);
      };
      audio.ontimeupdate = () => {
        if (audio.duration) {
          setAudioPlayProgress((audio.currentTime / audio.duration) * 100);
        }
      };
      audio.onerror = (e) => {
        console.error('Erro de reprodução de áudio:', e);
        setIsPlayingAudio(false);
        setAudioError('Falha ao reproduzir áudio.');
      };

      setIsPlayingAudio(true);
      await audio.play();
    } catch (err: any) {
      console.error('Erro ao buscar áudio:', err);
      setAudioError(typeof err === 'string' ? err : 'Nenhum áudio disponível no momento.');
      setIsPlayingAudio(false);
    }
  };

  const handleOpenRecordingsFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (err) {
      console.error('Erro ao abrir pasta:', err);
    }
  };

  const handleSensitivityChange = async (newVal: number) => {
    setVadSensitivity(newVal);
    try {
      await invoke('set_vad_sensitivity', { sensitivity: newVal });
    } catch (e) {
      console.warn('Erro ao atualizar sensibilidade VAD:', e);
    }
  };

  const handleOpacityChange = async (val: number) => {
    setOverlayOpacity(val);
    localStorage.setItem('overlay_opacity', String(val));
    try {
      await emit('whisper-overlay-opacity', { opacity: val });
    } catch (err) {
      console.warn('Erro ao emitir whisper-overlay-opacity:', err);
    }
  };

  const applyOverlaySize = async (w: number, h: number) => {
    const finalW = Math.max(320, Math.min(1200, w));
    const finalH = Math.max(110, Math.min(800, h));
    setOverlayWidth(finalW);
    setOverlayHeight(finalH);
    localStorage.setItem('overlay_width', String(finalW));
    localStorage.setItem('overlay_height', String(finalH));
    try {
      await emit('whisper-overlay-resize', { width: finalW, height: finalH });
    } catch (err) {
      console.warn('Erro ao emitir whisper-overlay-resize:', err);
    }
  };

  const applyOverlayFontSize = async (size: number) => {
    const finalSize = Math.max(14, Math.min(36, size));
    setOverlayFontSize(finalSize);
    localStorage.setItem('overlay_font_size', String(finalSize));
    try {
      await emit('whisper-overlay-font-size', { fontSize: finalSize });
    } catch (err) {
      console.warn('Erro ao emitir whisper-overlay-font-size:', err);
    }
  };

  const handleClose = async () => {
    try {
      await invoke('hide_settings');
    } catch (e) {
      console.warn('Erro ao fechar configs (Tauri IPC falhou, tentando fallback):', e);
      window.close();
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('');
          setSelectedView('tab');
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchQuery]);

  const handleDragMouseDown = async (e: React.MouseEvent) => {
    if (e.button === 0) {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.startDragging();
      } catch (err) {
        console.warn(err);
      }
    }
  };

  const handleSelectPreset = (preset: ThemeConfig) => {
    setCurrentTheme(preset);
    applyThemeToDom(preset);
    saveAndBroadcastTheme(preset);
  };

  const handleColorChange = (key: keyof ThemeConfig, val: string) => {
    const updated: ThemeConfig = {
      ...currentTheme,
      id: 'custom',
      name: 'Customizado',
      [key]: val,
    };
    setCurrentTheme(updated);
    applyThemeToDom(updated);
    saveAndBroadcastTheme(updated);
  };

  const handleResetTheme = () => {
    handleSelectPreset(DEFAULT_THEME);
  };

  // Funções de Gestão de Personas
  const handleSelectPersona = (id: string) => {
    setSelectedPersonaId(id);
    const found = personas.find((p) => p.id === id);
    if (found) {
      setEditingPersona({ ...found });
    }
  };

  const handleMakeActivePersona = async (personaToActivate: PersonaConfig) => {
    setActivePersonaId(personaToActivate.id);
    saveStoredActivePersonaId(personaToActivate.id);
    try {
      await invoke('set_active_persona', { persona: personaToActivate });
      setStatusMsg(`Persona ativa: ${cleanPersonaName(personaToActivate.name)}`);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (e) {
      console.warn('Erro ao atualizar persona ativa no backend:', e);
    }
  };

  const handleSaveEditingPersona = async () => {
    const updated = personas.map((p) => (p.id === editingPersona.id ? editingPersona : p));
    setPersonas(updated);
    saveStoredPersonas(updated);
    if (activePersonaId === editingPersona.id) {
      try {
        await invoke('set_active_persona', { persona: editingPersona });
      } catch (e) {
        console.warn('Erro ao atualizar persona ativa no backend:', e);
      }
    }
    setStatusMsg(`Persona "${cleanPersonaName(editingPersona.name)}" salva!`);
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const handleCreateNewPersona = () => {
    const newId = `persona_${Date.now()}`;
    const newPersona: PersonaConfig = {
      id: newId,
      name: 'Nova Persona Personalizada',
      description: 'Defina a missão e o foco de ação deste agente.',
      system_prompt:
        'Você é um agente prestativo e direto. Responda em Português de forma clara, concisa e orientada a ações. O popup e o overlay suportam renderização de Markdown completo (negrito, listas, blocos de código).',
      trigger_mode: 'always',
      hotword: '',
      enabled_tools: ['popup'],
      temperature: 0.5,
      is_preset: false,
    };
    const updated = [...personas, newPersona];
    setPersonas(updated);
    saveStoredPersonas(updated);
    setSelectedPersonaId(newId);
    setEditingPersona(newPersona);
    setStatusMsg('Nova persona criada! Edite os detalhes abaixo.');
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const handleDeletePersona = (idToDelete: string) => {
    if (personas.length <= 1) return;
    const filtered = personas.filter((p) => p.id !== idToDelete);
    setPersonas(filtered);
    saveStoredPersonas(filtered);
    const nextPersona = filtered[0];
    setSelectedPersonaId(nextPersona.id);
    setEditingPersona({ ...nextPersona });
    if (activePersonaId === idToDelete) {
      setActivePersonaId(nextPersona.id);
      saveStoredActivePersonaId(nextPersona.id);
      invoke('set_active_persona', { persona: nextPersona }).catch(() => {});
    }
    setStatusMsg('Persona excluída!');
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const handleResetPersonas = async () => {
    setPersonas(DEFAULT_PERSONAS);
    saveStoredPersonas(DEFAULT_PERSONAS);
    const defaultAct = DEFAULT_PERSONAS[0];
    setActivePersonaId(defaultAct.id);
    saveStoredActivePersonaId(defaultAct.id);
    setSelectedPersonaId(defaultAct.id);
    setEditingPersona({ ...defaultAct });
    try {
      await invoke('set_active_persona', { persona: defaultAct });
    } catch (e) {}
    setStatusMsg('Presets de fábrica restaurados!');
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const handleToggleTool = (toolName: string) => {
    const currentTools = editingPersona.enabled_tools || [];
    const hasTool = currentTools.includes(toolName);
    const updatedTools = hasTool
      ? currentTools.filter((t) => t !== toolName)
      : [...currentTools, toolName];

    setEditingPersona({
      ...editingPersona,
      enabled_tools: updatedTools,
    });
  };

  const handleSave = async () => {
    try {
      setStatusMsg('Salvando preferências...');
      localStorage.setItem('active_source_id', activeSourceId);
      localStorage.setItem('audio_mute', String(audioMute));
      localStorage.setItem('transcription_mode', transcriptionMode);
      localStorage.setItem('whisper_model', whisperModel);
      localStorage.setItem('byok_endpoint', byokEndpoint);
      localStorage.setItem('byok_key', byokApiKey);
      localStorage.setItem('byok_model', byokModel);
      localStorage.setItem('llm_correction_enabled', String(llmCorrectionEnabled));
      localStorage.setItem('overlay_opacity', String(overlayOpacity));
      localStorage.setItem('overlay_width', String(overlayWidth));
      localStorage.setItem('overlay_height', String(overlayHeight));
      localStorage.setItem('overlay_font_size', String(overlayFontSize));

      // Salva e persiste personas (incluindo qualquer alteração na persona em edição)
      const updatedPersonas = personas.map((p) => (p.id === editingPersona.id ? editingPersona : p));
      setPersonas(updatedPersonas);
      saveStoredPersonas(updatedPersonas);
      saveStoredActivePersonaId(activePersonaId);

      try {
        await emit('whisper-overlay-resize', { width: overlayWidth, height: overlayHeight });
      } catch (e) {}

      try {
        await emit('whisper-overlay-opacity', { opacity: overlayOpacity });
      } catch (e) {}

      try {
        await emit('whisper-overlay-font-size', { fontSize: overlayFontSize });
      } catch (e) {}

      try {
        await emit('audio_source_changed', { deviceId: activeSourceId });
      } catch (e) {}

      try {
        await emit('whisper-settings-saved', {});
      } catch (e) {}

      // Salva e transmite tema
      await saveAndBroadcastTheme(currentTheme);

      // Sincroniza a persona ativa com o backend
      const activeObj = updatedPersonas.find((p) => p.id === activePersonaId) || editingPersona;
      try {
        await invoke('set_active_persona', { persona: activeObj });
      } catch (e) {
        console.warn('Erro ao definir persona ativa:', e);
      }

      try {
        await invoke('set_whisper_model', { modelName: whisperModel });
      } catch (e) {
        console.warn('Erro ao definir modelo whisper:', e);
      }

      try {
        await invoke('update_settings_state', {
          audioMute,
          activeSourceId,
          transcriptionMode,
          uiTheme: currentTheme.id,
          overlayOpacity,
          overlayMonitorId: 0,
          selectedLlmId: byokModel,
          byokEndpoint,
          byokApiKey,
          llmCorrectionEnabled,
        });
      } catch (e) {
        console.warn(e);
      }

      try {
        await invoke('start_audio_capture', {
          deviceId: activeSourceId,
          sampleRate: 16000,
          channels: 1,
          format: 'f32',
        });
      } catch (e) {
        console.warn('Erro ao reiniciar audio capture:', e);
      }

      setStatusMsg('Salvo com sucesso!');
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (e) {
      console.error(e);
      setStatusMsg('Salvo localmente!');
      setTimeout(() => setStatusMsg(''), 3000);
    }
  };

  return (
    <div className="settings-window-container">
      {/* Barra de controle superior com Drag Region */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          paddingBottom: '10px',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <div
          data-tauri-drag-region
          onMouseDown={handleDragMouseDown}
          style={{
            fontSize: '14px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'grab',
            flexGrow: 1,
            userSelect: 'none',
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
                height: '24px',
                width: 'auto',
                pointerEvents: 'none',
                filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))',
              }}
            />
            <img
              data-tauri-drag-region
              src="/nametext-logo.svg"
              alt="WhisperAgent"
              style={{
                height: '16px',
                width: 'auto',
                pointerEvents: 'none',
                opacity: 0.95,
              }}
            />
          </div>
          <span
            data-tauri-drag-region
            style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)' }}
          >
            | Configurações
          </span>
        </div>

        <button
          type="button"
          className="overlay-icon-btn close"
          onClick={handleClose}
          onMouseDown={(e) => e.stopPropagation()}
          title="Fechar Janela (ESC)"
          style={{ zIndex: 9999 }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Corpo com Layout em Duas Colunas: Sidebar + Conteúdo */}
      <div className="settings-body">
        {/* Coluna Lateral de Navegação (Sidebar) */}
        <div className="settings-sidebar">
          {/* Caixa de Pesquisa de Configurações */}
          <div className="settings-search-box">
            <Search size={14} className="settings-search-icon" />
            <input
              type="text"
              className="settings-search-input"
              placeholder="Pesquisar config..."
              value={searchQuery}
              onChange={(e) => {
                const val = e.target.value;
                setSearchQuery(val);
                if (val.trim().length > 0) {
                  setSelectedView('search');
                } else {
                  setSelectedView('tab');
                }
              }}
            />
            {searchQuery && (
              <button
                type="button"
                className="settings-search-clear"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedView('tab');
                }}
                title="Limpar pesquisa (ESC)"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Menu Vertical de Abas */}
          <div className="settings-nav-list">
            {isSearching && (
              <button
                type="button"
                className={`settings-nav-btn ${selectedView === 'search' ? 'active' : ''}`}
                onClick={() => setSelectedView('search')}
              >
                <div className="settings-nav-btn-left">
                  <Search size={14} />
                  <span>Resultados</span>
                </div>
                <span className="settings-nav-badge">{searchResults.length}</span>
              </button>
            )}

            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const matches = matchCountByTab[tab.id] || 0;
              const isSelected = selectedView === 'tab' && activeTab === tab.id;
              const isDimmed = isSearching && matches === 0;

              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`settings-nav-btn ${isSelected ? 'active' : ''} ${isDimmed ? 'dimmed' : ''}`}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setSelectedView('tab');
                  }}
                  title={tab.subtitle}
                >
                  <div className="settings-nav-btn-left">
                    <Icon size={14} />
                    <span>{tab.label}</span>
                  </div>
                  {isSearching && matches > 0 && (
                    <span className="settings-nav-badge">{matches}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Área de Conteúdo à Direita */}
        <div className="settings-content-wrapper">
          {/* Cabeçalho da Seção Ativa */}
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title">
                {selectedView === 'search' ? (
                  <>
                    <Search size={15} style={{ color: 'var(--accent-color)' }} />
                    Resultados da Busca
                  </>
                ) : (
                  <>
                    {(() => {
                      const tab = NAV_TABS.find((t) => t.id === activeTab);
                      const Icon = tab ? tab.icon : Sliders;
                      return (
                        <>
                          <Icon size={15} style={{ color: 'var(--accent-color)' }} />
                          {tab?.title || 'Configurações'}
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
              <div className="settings-section-subtitle">
                {selectedView === 'search'
                  ? `${searchResults.length} configuração(ões) encontrada(s) para "${searchQuery}"`
                  : NAV_TABS.find((t) => t.id === activeTab)?.subtitle}
              </div>
            </div>

            {isSearching && selectedView === 'tab' && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: '11px', padding: '4px 8px' }}
                onClick={() => setSelectedView('search')}
              >
                Ver todos ({searchResults.length})
              </button>
            )}
          </div>

          {/* Conteúdo Dinâmico por Aba ou Busca */}
          <div className="settings-tab-content">
            {selectedView === 'search' ? (
              <div className="search-results-list">
                {searchResults.length === 0 ? (
                  <div className="info-box" style={{ textAlign: 'center', padding: '28px 16px' }}>
                    <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                      Nenhuma configuração encontrada
                    </p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                      Não encontramos nenhuma configuração correspondente a "{searchQuery}".
                    </p>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ marginTop: '14px' }}
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedView('tab');
                      }}
                    >
                      Limpar busca
                    </button>
                  </div>
                ) : (
                  searchResults.map((result) => {
                    const tabDef = NAV_TABS.find((t) => t.id === result.tab);
                    const TabIcon = tabDef?.icon || Sliders;
                    return (
                      <div
                        key={result.id}
                        className="search-result-card"
                        onClick={() => {
                          setActiveTab(result.tab);
                          setSelectedView('tab');
                        }}
                      >
                        <div className="search-result-header">
                          <span className="search-result-title">
                            <TabIcon size={13} style={{ color: 'var(--accent-color)' }} />
                            {result.title}
                          </span>
                          <span className="search-result-tag">{tabDef?.label || result.tab}</span>
                        </div>
                        <p className="search-result-desc">{result.description}</p>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <>
        {/* ABA: ÁUDIO */}
        {activeTab === 'audio' && (
          <div>
            <div className="form-group">
              <label className="form-label">Microfone / Dispositivo de Entrada</label>
              <select
                className="form-select"
                value={activeSourceId}
                onChange={(e) => setActiveSourceId(e.target.value)}
              >
                <option value="default">Padrão do Sistema Operacional</option>
                {audioDevices.map((dev, idx) => (
                  <option key={idx} value={dev.id}>
                    {dev.name} {dev.default ? '(Padrão)' : ''} {dev.is_loopback ? '(Loopback)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ marginTop: '12px' }}>
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={audioMute}
                  onChange={(e) => setAudioMute(e.target.checked)}
                />
                Silenciar captura de voz (Microfone Mudo)
              </label>
            </div>

            {/* SEÇÃO: VU METER EM TEMPO REAL */}
            <div
              style={{
                marginTop: '16px',
                padding: '12px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Activity size={14} />
                  Nível do Microfone ao Vivo
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: micLevel.is_speaking
                      ? 'rgba(255, 255, 255, 0.15)'
                      : 'rgba(148, 163, 184, 0.1)',
                    color: micLevel.is_speaking ? '#ffffff' : 'var(--text-secondary)',
                    border: `1px solid ${
                      micLevel.is_speaking ? 'rgba(255, 255, 255, 0.4)' : 'rgba(148, 163, 184, 0.2)'
                    }`,
                    boxShadow: micLevel.is_speaking ? '0 0 8px rgba(255, 255, 255, 0.8)' : 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  {micLevel.is_speaking ? (
                    <>
                      <Mic size={11} /> Detectando Fala
                    </>
                  ) : (
                    <>
                      <MicOff size={11} /> Silêncio / Espera
                    </>
                  )}
                </span>
              </div>

              {/* Barra de VU Meter */}
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '14px',
                  background: 'rgba(0, 0, 0, 0.35)',
                  borderRadius: '7px',
                  overflow: 'hidden',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                {/* Linha indicadora do limiar VAD */}
                <div
                  style={{
                    position: 'absolute',
                    left: `${Math.min(98, Math.max(2, Math.round(vadSensitivity * 700)))}%`,
                    top: 0,
                    bottom: 0,
                    width: '2px',
                    background: 'var(--text-primary, #ffffff)',
                    zIndex: 2,
                    boxShadow: '0 0 6px rgba(255, 255, 255, 0.7)',
                  }}
                  title={`Limiar de ativação VAD: ${vadSensitivity.toFixed(3)}`}
                />

                {/* Barra de preenchimento RMS */}
                <div
                  style={{
                    width: `${Math.min(100, Math.max(0, Math.round(micLevel.rms * 700)))}%`,
                    height: '100%',
                    background:
                      micLevel.rms * 700 > 85
                        ? 'linear-gradient(90deg, #52525b, #a1a1aa, #ffffff)'
                        : micLevel.rms * 700 > 50
                        ? 'linear-gradient(90deg, #52525b, #a1a1aa)'
                        : '#52525b',
                    transition: 'width 60ms ease-out',
                    borderRadius: '7px',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '6px',
                  fontSize: '10px',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>Silêncio</span>
                <span>
                  RMS: {(micLevel.rms * 100).toFixed(1)}% | Pico:{' '}
                  {(micLevel.peak * 100).toFixed(0)}%
                </span>
                <span style={{ color: 'var(--text-primary, #ffffff)' }}>
                  Limiar: {(vadSensitivity * 100).toFixed(1)}%
                </span>
              </div>
            </div>

            {/* CONTROLE DE SENSIBILIDADE VAD */}
            <div className="form-group" style={{ marginTop: '14px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Sensibilidade de Detecção de Fala (Limiar VAD)
                </label>
                <span style={{ fontSize: '11px', color: 'var(--accent-color)', fontWeight: 600 }}>
                  {vadSensitivity.toFixed(3)}
                </span>
              </div>
              <input
                type="range"
                min="0.001"
                max="0.025"
                step="0.001"
                value={vadSensitivity}
                onChange={(e) => handleSensitivityChange(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent-color)' }}
              />
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  marginTop: '8px',
                }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleSensitivityChange(0.002)}
                  style={{
                    fontSize: '10px',
                    padding: '3px 8px',
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    background:
                      vadSensitivity === 0.002
                        ? 'rgba(255, 255, 255, 0.18)'
                        : 'rgba(255, 255, 255, 0.05)',
                    border: vadSensitivity === 0.002
                      ? '1px solid rgba(255, 255, 255, 0.35)'
                      : '1px solid var(--border-color)',
                  }}
                >
                  <Mic size={11} />
                  Alta Sensibilidade (Voz Baixa)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleSensitivityChange(0.005)}
                  style={{
                    fontSize: '10px',
                    padding: '3px 8px',
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    background:
                      vadSensitivity === 0.005
                        ? 'rgba(255, 255, 255, 0.18)'
                        : 'rgba(255, 255, 255, 0.05)',
                    border: vadSensitivity === 0.005
                      ? '1px solid rgba(255, 255, 255, 0.35)'
                      : '1px solid var(--border-color)',
                  }}
                >
                  <Sliders size={11} />
                  Padrão (0.005)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleSensitivityChange(0.012)}
                  style={{
                    fontSize: '10px',
                    padding: '3px 8px',
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    background:
                      vadSensitivity === 0.012
                        ? 'rgba(255, 255, 255, 0.18)'
                        : 'rgba(255, 255, 255, 0.05)',
                    border: vadSensitivity === 0.012
                      ? '1px solid rgba(255, 255, 255, 0.35)'
                      : '1px solid var(--border-color)',
                  }}
                >
                  <VolumeX size={11} />
                  Ambiente Barulhento
                </button>
              </div>
            </div>

            {/* SEÇÃO: DIAGNÓSTICO E ESCUTA DO ÁUDIO DO WHISPER */}
            <div
              style={{
                marginTop: '18px',
                padding: '14px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px',
                }}
              >
                <Headphones size={15} style={{ opacity: 0.9 }} />
                <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                  Diagnóstico: Ouvir o som que o Whisper ouve
                </strong>
              </div>

              <p
                style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  margin: '0 0 12px 0',
                  lineHeight: '1.4',
                }}
              >
                Toque o botão abaixo para ouvir pelos seus alto-falantes exatamente o áudio
                (16kHz mono processado) que o motor Whisper recebeu na última sentença que você falou.
              </p>

              {audioStats ? (
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-primary)',
                    background: 'rgba(0, 0, 0, 0.25)',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    marginBottom: '12px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={12} /> Duração: <strong>{audioStats.duration_seconds.toFixed(1)}s</strong>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Volume2 size={12} /> Nível Médio: <strong>{(audioStats.rms_level * 100).toFixed(1)}%</strong>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <TrendingUp size={12} /> Pico: <strong>{(audioStats.peak_level * 100).toFixed(0)}%</strong>
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    fontStyle: 'italic',
                    marginBottom: '12px',
                  }}
                >
                  Nenhuma fala capturada ainda nesta sessão. Diga uma frase para gravar e testar!
                </div>
              )}

              {/* Barra de progresso de reprodução */}
              {isPlayingAudio && (
                <div
                  style={{
                    width: '100%',
                    height: '4px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: '2px',
                    marginBottom: '10px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${audioPlayProgress}%`,
                      height: '100%',
                      background: 'var(--accent-color)',
                      transition: 'width 100ms linear',
                    }}
                  />
                </div>
              )}

              {audioError && (
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary, #a1a1aa)',
                    marginBottom: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <AlertTriangle size={13} /> {audioError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handlePlayLastAudio}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    background: isPlayingAudio ? 'rgba(255, 255, 255, 0.16)' : 'var(--accent-color)',
                    color: isPlayingAudio ? 'var(--text-primary, #ffffff)' : 'var(--accent-text, #09090b)',
                    border: isPlayingAudio ? '1px solid rgba(255, 255, 255, 0.3)' : '1px solid var(--accent-color)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isPlayingAudio ? (
                    <>
                      <Pause size={14} /> Pausar Áudio
                    </>
                  ) : (
                    <>
                      <Play size={14} /> Ouvir Última Fala Processada
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleOpenRecordingsFolder}
                  title="Abrir pasta no Windows Explorer com o arquivo last_whisper_input.wav"
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <FolderOpen size={13} />
                  Abrir Pasta (.wav)
                </button>
              </div>
            </div>

            <div className="info-box" style={{ marginTop: '14px' }}>
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <HelpCircle size={13} /> Dica de Diagnóstico:
              </strong>{' '}
              Se ao ouvir o áudio você perceber que a sua
              voz está muito abafada, metálica ou cortando sílabas:
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                <li>Aumente a sensibilidade se as primeiras palavras não estiverem sendo capturadas.</li>
                <li>Verifique se o microfone correto está selecionado acima no seletor de dispositivos.</li>
                <li>Para gravar reuniões ou áudio interno do PC, selecione o dispositivo <em>Loopback</em>.</li>
              </ul>
            </div>
          </div>
        )}

        {/* ABA: TRANSCRIÇÃO */}
        {activeTab === 'transcription' && (
          <div>
            <div className="form-group">
              <label className="form-label">Motor de Transcrição (STT)</label>
              <select
                className="form-select"
                value={transcriptionMode}
                onChange={(e) => setTranscriptionMode(e.target.value)}
              >
                <option value="whisper">Whisper Local (Privacidade Total & 100% Offline)</option>
                <option value="cloud">Cloud Fallback (9Router / OpenAI Whisper API)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Modelo Whisper Local</label>
              <select
                className="form-select"
                value={whisperModel}
                onChange={(e) => setWhisperModel(e.target.value)}
              >
                <option value="tiny-q5_1">Tiny Q5_1 (~31 MB - Máxima Velocidade / Baixo Uso de CPU - Recomendado)</option>
                <option value="base-q5_1">Base Q5_1 (~57 MB - Rápido + Alta Precisão em Português)</option>
                <option value="tiny">Tiny (~75 MB - Não quantizado)</option>
                <option value="base">Base (~148 MB - Não quantizado)</option>
              </select>
            </div>

            <div className="form-group" style={{ marginTop: '14px' }}>
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={llmCorrectionEnabled}
                  onChange={(e) => setLlmCorrectionEnabled(e.target.checked)}
                />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} /> Correção e Pontuação Automática via IA (LLM Post-Processing)
                </span>
              </label>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginTop: '4px', marginLeft: '24px' }}>
                A IA revisa em segundo plano a pontuação, acentuação e erros fonéticos sem atrasar a transcrição ao vivo no HUD.
              </span>
            </div>

            <div className="info-box" style={{ marginTop: '14px' }}>
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <Info size={13} /> Dica de Precisão:
              </strong>{' '}
              Se o texto estiver com erros ou palavras truncadas, recomendamos selecionar o modelo <strong>Base (~148 MB)</strong> acima. Ele possui mais que o dobro de parâmetros treinados em português e, somado à Correção via IA, gera frases perfeitas.
            </div>
          </div>
        )}

        {/* ABA: PERSONAS & AGENTES */}
        {activeTab === 'personas' && (
          <div>
            <div style={{ marginBottom: '12px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span className="form-label" style={{ marginBottom: 0 }}>
                  Selecione uma Persona para Editar ou Ativar
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCreateNewPersona}
                  style={{
                    fontSize: '11px',
                    padding: '4px 10px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Plus size={12} /> Nova Persona
                </button>
              </div>

              {/* Grid de Seleção de Personas */}
              <div className="personas-grid">
                {personas.map((p) => {
                  const isSelected = p.id === selectedPersonaId;
                  const isActive = p.id === activePersonaId;
                  return (
                    <div
                      key={p.id}
                      className={`persona-card ${isSelected ? 'selected' : ''} ${
                        isActive ? 'active' : ''
                      }`}
                      onClick={() => handleSelectPersona(p.id)}
                    >
                      <div className="persona-card-header">
                        <span
                          className="persona-name"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          {renderPersonaIcon(p.id)}
                          {cleanPersonaName(p.name)}
                        </span>
                        {isActive && (
                          <span
                            className="persona-badge-active"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                          >
                            <Check size={10} strokeWidth={3} /> ATIVA
                          </span>
                        )}
                      </div>
                      <div className="persona-desc">{p.description}</div>
                      <div className="persona-meta">
                        <span className="persona-mode-tag">
                          {p.trigger_mode === 'hotword'
                            ? `Gatilho: "${p.hotword || 'palavra'}"`
                            : p.trigger_mode === 'question_only'
                            ? 'Apenas Dúvidas (?)'
                            : 'Proativo (Sempre)'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Painel de Edição da Persona Selecionada */}
            <div className="persona-editor-box">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                  borderBottom: '1px solid var(--border-color)',
                  paddingBottom: '8px',
                }}
              >
                <div>
                  <span style={{ fontWeight: 700, fontSize: '13px' }}>
                    Configurando: {cleanPersonaName(editingPersona.name)}
                  </span>
                  {editingPersona.id === activePersonaId ? (
                    <span
                      style={{
                        marginLeft: '8px',
                        color: 'var(--accent-color)',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      (Persona Ativa no HUD)
                    </span>
                  ) : null}
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  {editingPersona.id !== activePersonaId && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleMakeActivePersona(editingPersona)}
                      style={{
                        fontSize: '11px',
                        padding: '4px 10px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Check size={12} /> Tornar Ativa
                    </button>
                  )}
                  {!editingPersona.is_preset && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleDeletePersona(editingPersona.id)}
                      style={{
                        fontSize: '11px',
                        padding: '4px 8px',
                        color: 'var(--text-secondary)',
                        borderColor: 'var(--border-color)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Trash2 size={12} /> Excluir
                    </button>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Nome da Persona</label>
                <input
                  type="text"
                  className="form-input"
                  value={editingPersona.name}
                  onChange={(e) =>
                    setEditingPersona({ ...editingPersona, name: e.target.value })
                  }
                  placeholder="Ex: Assistente Técnico"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Descrição Resumida</label>
                <input
                  type="text"
                  className="form-input"
                  value={editingPersona.description}
                  onChange={(e) =>
                    setEditingPersona({ ...editingPersona, description: e.target.value })
                  }
                  placeholder="Ex: Responde dúvidas de código e arquitetura"
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '10px',
                  marginBottom: '10px',
                }}
              >
                <div>
                  <label className="form-label">Modo de Intervenção (Gatilho)</label>
                  <select
                    className="form-select"
                    value={editingPersona.trigger_mode}
                    onChange={(e) =>
                      setEditingPersona({
                        ...editingPersona,
                        trigger_mode: e.target.value as TriggerMode,
                      })
                    }
                  >
                    <option value="hotword">Palavra de Ativação (Hotword)</option>
                    <option value="question_only">Apenas se for Pergunta / Dúvida (?)</option>
                    <option value="always">Proativo (Sempre Analisando a Fala)</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">
                    {editingPersona.trigger_mode === 'hotword'
                      ? 'Palavra de Ativação (Hotword)'
                      : 'Palavra de Ativação (Opcional)'}
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={editingPersona.hotword}
                    disabled={editingPersona.trigger_mode !== 'hotword'}
                    onChange={(e) =>
                      setEditingPersona({ ...editingPersona, hotword: e.target.value })
                    }
                    placeholder="Ex: copiloto, whisper, dev"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">System Prompt (Diretrizes e Comportamento)</label>
                <textarea
                  className="form-input"
                  rows={4}
                  style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '12px' }}
                  value={editingPersona.system_prompt}
                  onChange={(e) =>
                    setEditingPersona({ ...editingPersona, system_prompt: e.target.value })
                  }
                  placeholder="Defina o papel, as restrições e as diretrizes do agente..."
                />
              </div>

              <div className="form-group">
                <label className="form-label">Ferramentas Habilitadas para esta Persona</label>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <label className="form-checkbox">
                    <input
                      type="checkbox"
                      checked={editingPersona.enabled_tools?.includes('popup') ?? true}
                      onChange={() => handleToggleTool('popup')}
                    />
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <MessageSquare size={13} /> Popups no HUD Overlay
                    </span>
                  </label>
                  <label className="form-checkbox">
                    <input
                      type="checkbox"
                      checked={editingPersona.enabled_tools?.includes('clipboard') ?? false}
                      onChange={() => handleToggleTool('clipboard')}
                    />
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <Copy size={13} /> Botão de Cópia Rápida
                    </span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveEditingPersona}
                  style={{
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <Save size={13} /> Salvar Esta Persona
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleResetPersonas}
                  style={{
                    fontSize: '11px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                  title="Restaura os 4 agentes padrão de fábrica"
                >
                  <RotateCcw size={12} /> Restaurar Padrões de Fábrica
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ABA: IA (BYOK) */}
        {activeTab === 'llm' && (
          <div>
            <div className="form-group">
              <label className="form-label">Endpoint da API (Compatível com OpenAI / v1)</label>
              <input
                type="text"
                className="form-input"
                value={byokEndpoint}
                onChange={(e) => setByokEndpoint(e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Chave de API (API Key)</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  className="form-input"
                  value={byokApiKey}
                  onChange={(e) => setByokApiKey(e.target.value)}
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="btn-secondary"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {showApiKey ? 'Ocultar' : 'Exibir'}
                </button>
              </div>
            </div>

            {/* BOTÃO DE TESTAR CONEXÃO & CARREGAR MODELOS */}
            <div style={{ marginTop: '8px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleTestLlmConnection}
                  disabled={isTestingLlm}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: isTestingLlm ? 'not-allowed' : 'pointer',
                    opacity: isTestingLlm ? 0.7 : 1,
                  }}
                >
                  <RefreshCw
                    size={14}
                    style={{
                      animation: isTestingLlm ? 'spin 1s linear infinite' : 'none',
                    }}
                  />
                  {isTestingLlm ? 'Testando Conexão...' : 'Testar Conexão & Carregar Modelos'}
                </button>

                {availableModels.length > 0 && (
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      background: 'rgba(255, 255, 255, 0.05)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                    }}
                  >
                    {availableModels.length} modelo(s) disponível(is)
                  </span>
                )}
              </div>

              {/* MENSAGEM DE STATUS DO TESTE */}
              {llmTestStatus && (
                <div
                  style={{
                    marginTop: '10px',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    backgroundColor:
                      llmTestStatus.type === 'success'
                        ? 'rgba(34, 197, 94, 0.12)'
                        : 'rgba(239, 68, 68, 0.12)',
                    border: `1px solid ${
                      llmTestStatus.type === 'success'
                        ? 'rgba(34, 197, 94, 0.35)'
                        : 'rgba(239, 68, 68, 0.35)'
                    }`,
                    color:
                      llmTestStatus.type === 'success'
                        ? '#4ade80'
                        : '#f87171',
                  }}
                >
                  {llmTestStatus.type === 'success' ? (
                    <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                  ) : (
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                  )}
                  <span>{llmTestStatus.message}</span>
                </div>
              )}
            </div>

            {/* MODELO DE IA (SELETOR + INPUT MANUAL) */}
            <div className="form-group">
              <label className="form-label">Modelo de Inteligência Artificial</label>

              {availableModels.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <select
                    className="form-select"
                    value={availableModels.includes(byokModel) ? byokModel : ''}
                    onChange={(e) => {
                      if (e.target.value) {
                        setByokModel(e.target.value);
                      }
                    }}
                  >
                    <option value="" disabled>
                      -- Selecione um modelo carregado da API --
                    </option>
                    {availableModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Ou digite manualmente:
                    </span>
                    <input
                      type="text"
                      className="form-input"
                      value={byokModel}
                      onChange={(e) => setByokModel(e.target.value)}
                      placeholder="geral, gpt-4o-mini, etc."
                      style={{ flex: 1 }}
                    />
                  </div>
                </div>
              ) : (
                <input
                  type="text"
                  className="form-input"
                  value={byokModel}
                  onChange={(e) => setByokModel(e.target.value)}
                  placeholder="geral, gpt-4o-mini, etc."
                />
              )}
            </div>

            <div className="info-box">
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <KeyRound size={13} /> BYOK (Bring Your Own Key):
              </strong>{' '}
              Suporta qualquer provedor com API compatível com o padrão OpenAI (ex: 9Router, OpenAI, Groq, Ollama, vLLM). Clique em <strong>Testar Conexão & Carregar Modelos</strong> para verificar a chave e carregar os modelos disponíveis diretamente no seletor.
            </div>
          </div>
        )}

        {/* ABA: OVERLAY */}
        {activeTab === 'overlay' && (
          <div>
            <div className="form-group">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Opacidade do Overlay HUD
                </label>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--accent-color)',
                  }}
                >
                  {overlayOpacity}%
                </span>
              </div>
              <input
                type="range"
                className="form-range"
                min="30"
                max="100"
                value={overlayOpacity}
                onChange={(e) => handleOpacityChange(Number(e.target.value))}
              />
            </div>

            {/* Tamanho da Letra / Fonte da Transcrição */}
            <div className="form-group" style={{ marginTop: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Tamanho da Letra / Fonte da Transcrição
                </label>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--accent-color)',
                  }}
                >
                  {overlayFontSize} px
                </span>
              </div>
              <input
                type="range"
                className="form-range"
                min="14"
                max="32"
                step="1"
                value={overlayFontSize}
                onChange={(e) => applyOverlayFontSize(Number(e.target.value))}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '10px',
                  color: 'var(--text-secondary)',
                  marginTop: '4px',
                }}
              >
                <span>14px (Discreto)</span>
                <span>18px (Padrão)</span>
                <span>24px (Grande)</span>
                <span>32px (Máximo)</span>
              </div>
            </div>

            {/* Dimensões da Janela */}
            <div className="form-group" style={{ marginTop: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Dimensões do Overlay
                </label>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--accent-color)',
                  }}
                >
                  {overlayWidth} × {overlayHeight} px
                </span>
              </div>

              {/* Slider Largura */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '3px' }}>
                  <span>Largura</span>
                  <span>{overlayWidth}px</span>
                </div>
                <input
                  type="range"
                  className="form-range"
                  min="320"
                  max="1000"
                  step="10"
                  value={overlayWidth}
                  onChange={(e) => applyOverlaySize(Number(e.target.value), overlayHeight)}
                />
              </div>

              {/* Slider Altura */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '3px' }}>
                  <span>Altura</span>
                  <span>{overlayHeight}px</span>
                </div>
                <input
                  type="range"
                  className="form-range"
                  min="110"
                  max="600"
                  step="10"
                  value={overlayHeight}
                  onChange={(e) => applyOverlaySize(overlayWidth, Number(e.target.value))}
                />
              </div>

              {/* Presets Rápidos */}
              <label className="form-label" style={{ fontSize: '11px', marginBottom: '4px' }}>
                Tamanhos Predefinidos (Presets)
              </label>
              <div className="preset-grid">
                <button
                  type="button"
                  className={`preset-btn ${overlayWidth === 400 && overlayHeight === 130 ? 'active' : ''}`}
                  onClick={() => applyOverlaySize(400, 130)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Minimize2 size={13} /> Compacto
                  </span>
                  <span className="preset-btn-sub">400 × 130 px (discreto)</span>
                </button>
                <button
                  type="button"
                  className={`preset-btn ${overlayWidth === 500 && overlayHeight === 180 ? 'active' : ''}`}
                  onClick={() => applyOverlaySize(500, 180)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Tv size={13} /> Padrão
                  </span>
                  <span className="preset-btn-sub">500 × 180 px (recomendado)</span>
                </button>
                <button
                  type="button"
                  className={`preset-btn ${overlayWidth === 700 && overlayHeight === 260 ? 'active' : ''}`}
                  onClick={() => applyOverlaySize(700, 260)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Maximize2 size={13} /> Expandido
                  </span>
                  <span className="preset-btn-sub">700 × 260 px (mais linhas)</span>
                </button>
                <button
                  type="button"
                  className={`preset-btn ${overlayWidth === 360 && overlayHeight === 500 ? 'active' : ''}`}
                  onClick={() => applyOverlaySize(360, 500)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Columns2 size={13} /> Lateral / Chat
                  </span>
                  <span className="preset-btn-sub">360 × 500 px (modo coluna)</span>
                </button>
              </div>
            </div>

            <div className="info-box">
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <Layers size={13} /> Janela Flutuante Always-on-Top:
              </strong>
              <ul style={{ paddingLeft: '18px', marginTop: '6px' }}>
                <li><strong>Redimensionamento livre:</strong> Arraste diretamente qualquer borda ou o ícone no canto inferior direito do overlay.</li>
                <li><strong>Arrasto:</strong> Arraste a janela segurando na barra de título.</li>
                <li><strong>Configurações:</strong> Clique no ícone de engrenagem no overlay para abrir estas configurações.</li>
                <li>Pressione <strong>ESC</strong> a qualquer momento para fechar este painel.</li>
                <li>O overlay flutua suavemente sobre jogos, IDEs e navegadores.</li>
              </ul>
            </div>
          </div>
        )}

        {/* ABA: AÇÕES & POPUPS DO MODELO */}
        {activeTab === 'popups' && (
          <div>
            {/* Modo de Exibição */}
            <div className="form-group" style={{ marginBottom: '18px' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <LayoutTemplate size={14} color="var(--accent-color)" />
                Local de Exibição das Ações do Modelo
              </label>
              <div className="display-mode-grid">
                <div
                  className={`display-mode-card ${popupSettings.displayMode === 'inline' ? 'active' : ''}`}
                  onClick={() => updatePopupSetting('displayMode', 'inline')}
                >
                  <div className="display-mode-icon">
                    <MessageSquare size={18} />
                  </div>
                  <div className="display-mode-text">
                    <strong>Embutido no Texto</strong>
                    <span>Aparece integrado diretamente dentro da transcrição na janela do Overlay</span>
                  </div>
                  {popupSettings.displayMode === 'inline' && (
                    <div className="display-mode-check"><Check size={14} /></div>
                  )}
                </div>

                <div
                  className={`display-mode-card ${popupSettings.displayMode === 'screen_corner' ? 'active' : ''}`}
                  onClick={() => updatePopupSetting('displayMode', 'screen_corner')}
                >
                  <div className="display-mode-icon">
                    <Monitor size={18} />
                  </div>
                  <div className="display-mode-text">
                    <strong>Popup no Canto da Tela</strong>
                    <span>Flutua isoladamente em um dos quatro cantos do seu monitor</span>
                  </div>
                  {popupSettings.displayMode === 'screen_corner' && (
                    <div className="display-mode-check"><Check size={14} /></div>
                  )}
                </div>

                <div
                  className={`display-mode-card ${popupSettings.displayMode === 'overlay' ? 'active' : ''}`}
                  onClick={() => updatePopupSetting('displayMode', 'overlay')}
                >
                  <div className="display-mode-icon">
                    <Layers size={18} />
                  </div>
                  <div className="display-mode-text">
                    <strong>Acoplado ao Overlay</strong>
                    <span>Flutua fixado logo abaixo do card principal do Overlay HUD</span>
                  </div>
                  {popupSettings.displayMode === 'overlay' && (
                    <div className="display-mode-check"><Check size={14} /></div>
                  )}
                </div>
              </div>
            </div>

            {/* Seletor de Canto da Tela (apenas se screen_corner selecionado) */}
            {popupSettings.displayMode === 'screen_corner' && (
              <div className="form-group" style={{ marginBottom: '18px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Monitor size={14} color="var(--accent-color)" />
                  Escolha o Canto da Tela
                </label>
                <div className="screen-corner-selector">
                  <div className="screen-mockup">
                    <button
                      type="button"
                      className={`screen-corner-hotspot top-left ${popupSettings.screenCorner === 'top-left' ? 'active' : ''}`}
                      onClick={() => updatePopupSetting('screenCorner', 'top-left')}
                      title="Canto Superior Esquerdo"
                    >
                      <span>Topo Esq.</span>
                    </button>
                    <button
                      type="button"
                      className={`screen-corner-hotspot top-right ${popupSettings.screenCorner === 'top-right' ? 'active' : ''}`}
                      onClick={() => updatePopupSetting('screenCorner', 'top-right')}
                      title="Canto Superior Direito"
                    >
                      <span>Topo Dir.</span>
                    </button>
                    <div className="screen-mockup-center">
                      <Tv size={28} opacity={0.3} />
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Área Central do Monitor</span>
                    </div>
                    <button
                      type="button"
                      className={`screen-corner-hotspot bottom-left ${popupSettings.screenCorner === 'bottom-left' ? 'active' : ''}`}
                      onClick={() => updatePopupSetting('screenCorner', 'bottom-left')}
                      title="Canto Inferior Esquerdo"
                    >
                      <span>Fundo Esq.</span>
                    </button>
                    <button
                      type="button"
                      className={`screen-corner-hotspot bottom-right ${popupSettings.screenCorner === 'bottom-right' ? 'active' : ''}`}
                      onClick={() => updatePopupSetting('screenCorner', 'bottom-right')}
                      title="Canto Inferior Direito"
                    >
                      <span>Fundo Dir.</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Configurações de Áudio / Som da Notificação */}
            <div className="form-group" style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label className="form-label" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Bell size={14} color="var(--accent-color)" />
                  Som de Notificação das Ações
                </label>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={popupSettings.soundEnabled}
                    onChange={(e) => updatePopupSetting('soundEnabled', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              {popupSettings.soundEnabled && (
                <div className="sound-config-box">
                  {/* Grid de Presets de Som */}
                  <label className="form-label" style={{ fontSize: '11px', marginBottom: '6px' }}>
                    Efeito Sonoro Específico
                  </label>
                  <div className="sound-preset-grid">
                    {SOUND_PRESETS.map((preset) => {
                      const isSelected = popupSettings.soundTone === preset.id;
                      const isPlaying = playingTone === preset.id;
                      return (
                        <div
                          key={preset.id}
                          className={`sound-preset-card ${isSelected ? 'active' : ''}`}
                          onClick={() => {
                            updatePopupSetting('soundTone', preset.id);
                            handleTestSound(preset.id);
                          }}
                        >
                          <div className="sound-preset-info">
                            <strong>{preset.name}</strong>
                            <span>{preset.description}</span>
                          </div>
                          <button
                            type="button"
                            className={`sound-play-mini-btn ${isPlaying ? 'playing' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTestSound(preset.id);
                            }}
                            title="Ouvir som"
                          >
                            <Play size={11} fill={isPlaying ? "currentColor" : "none"} />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Volume do Som */}
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Volume2 size={12} /> Volume do Som
                      </span>
                      <span>{popupSettings.soundVolume}%</span>
                    </div>
                    <input
                      type="range"
                      className="form-range"
                      min="0"
                      max="100"
                      value={popupSettings.soundVolume}
                      onChange={(e) => updatePopupSetting('soundVolume', Number(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Tempo de Auto-Fechamento */}
            <div className="form-group" style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} /> Fechamento Automático (Auto-dismiss)
                </span>
                <span>{popupSettings.autoDismissSeconds}s</span>
              </div>
              <input
                type="range"
                className="form-range"
                min="3"
                max="30"
                step="1"
                value={popupSettings.autoDismissSeconds}
                onChange={(e) => updatePopupSetting('autoDismissSeconds', Number(e.target.value))}
              />
            </div>

            {/* Mínimo de Caracteres para Disparar */}
            <div className="form-group" style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Type size={12} /> Mínimo de Caracteres para Disparar
                </span>
                <span>{popupSettings.minCharsToTrigger} chars</span>
              </div>
              <input
                type="range"
                className="form-range"
                min="5"
                max="300"
                step="5"
                value={popupSettings.minCharsToTrigger}
                onChange={(e) => updatePopupSetting('minCharsToTrigger', Number(e.target.value))}
              />
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px', opacity: 0.7 }}>
                A persona só será chamada se o texto transcrito tiver ao menos {popupSettings.minCharsToTrigger} caracteres.
              </div>
            </div>

            {/* Botões de Teste de Notificação e Som */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button
                type="button"
                className={`settings-action-btn primary ${testActionFired ? 'success' : ''}`}
                onClick={handleTriggerTestPopup}
                disabled={testActionFired}
                style={{
                  flex: 1,
                  ...(testActionFired
                    ? {
                        background: 'var(--text-primary, #ffffff)',
                        color: 'var(--accent-text, #09090b)',
                        borderColor: 'var(--text-primary, #ffffff)',
                        boxShadow: '0 2px 10px rgba(255, 255, 255, 0.25)',
                      }
                    : {}),
                }}
              >
                {testActionFired ? (
                  <>
                    <Check size={14} />
                    <span>Notificação Enviada!</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>Testar Notificação Agora</span>
                  </>
                )}
              </button>
              {popupSettings.soundEnabled && (
                <button
                  type="button"
                  className={`settings-action-btn ${playingTone !== null ? 'playing' : ''}`}
                  onClick={() => handleTestSound()}
                  title="Ouvir som selecionado"
                  style={
                    playingTone !== null
                      ? {
                          background: 'rgba(255, 255, 255, 0.2)',
                          borderColor: 'var(--text-primary, #ffffff)',
                          color: 'var(--text-primary, #ffffff)',
                        }
                      : {}
                  }
                >
                  <Volume2 size={14} />
                  <span>Ouvir Som</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ABA: TEMA & CORES */}
        {activeTab === 'theme' && (
          <div>
            <div style={{ marginBottom: '12px' }}>
              <span className="form-label">Temas Predefinidos</span>
              <div className="theme-grid">
                {PRESET_THEMES.map((theme) => {
                  const isSelected = currentTheme.id === theme.id;
                  return (
                    <div
                      key={theme.id}
                      className={`theme-card ${isSelected ? 'active' : ''}`}
                      onClick={() => handleSelectPreset(theme)}
                    >
                      <div className="theme-card-title">
                        <span>{theme.name}</span>
                        {isSelected && (
                          <Check size={13} color="var(--accent-color)" />
                        )}
                      </div>
                      <div className="theme-card-dots">
                        <span className="theme-dot" style={{ background: theme.accentColor }} />
                        <span className="theme-dot" style={{ background: theme.bgOverlay }} />
                        <span className="theme-dot" style={{ background: theme.textPartial }} />
                        <span className="theme-dot" style={{ background: theme.borderColor }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span className="form-label" style={{ marginBottom: 0 }}>
                  Personalização de Cores Individuais
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleResetTheme}
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                >
                  Restaurar Padrão
                </button>
              </div>

              <div className="custom-colors-container">
                <div className="color-row">
                  <span className="color-row-label">Cor de Destaque (Accent)</span>
                  <div className="color-input-wrapper">
                    <span className="color-hex">{currentTheme.accentColor}</span>
                    <input
                      type="color"
                      value={currentTheme.accentColor.startsWith('#') ? currentTheme.accentColor : '#ffffff'}
                      onChange={(e) => handleColorChange('accentColor', e.target.value)}
                    />
                  </div>
                </div>

                <div className="color-row">
                  <span className="color-row-label">Voz ao Vivo (Streaming)</span>
                  <div className="color-input-wrapper">
                    <span className="color-hex">{currentTheme.textPartial}</span>
                    <input
                      type="color"
                      value={currentTheme.textPartial.startsWith('#') ? currentTheme.textPartial : '#e4e4e7'}
                      onChange={(e) => handleColorChange('textPartial', e.target.value)}
                    />
                  </div>
                </div>

                <div className="color-row">
                  <span className="color-row-label">Texto Principal</span>
                  <div className="color-input-wrapper">
                    <span className="color-hex">{currentTheme.textPrimary}</span>
                    <input
                      type="color"
                      value={currentTheme.textPrimary.startsWith('#') ? currentTheme.textPrimary : '#fafafa'}
                      onChange={(e) => handleColorChange('textPrimary', e.target.value)}
                    />
                  </div>
                </div>

                <div className="color-row">
                  <span className="color-row-label">Texto Secundário</span>
                  <div className="color-input-wrapper">
                    <span className="color-hex">{currentTheme.textSecondary}</span>
                    <input
                      type="color"
                      value={currentTheme.textSecondary.startsWith('#') ? currentTheme.textSecondary : '#a1a1aa'}
                      onChange={(e) => handleColorChange('textSecondary', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Pré-visualização ao Vivo do Overlay */}
            <div>
              <span className="form-label">Pré-visualização ao Vivo do Overlay</span>
              <div
                className="theme-preview-box"
                style={{
                  background: currentTheme.bgOverlay,
                  borderColor: currentTheme.borderColor,
                  color: currentTheme.textPrimary,
                }}
              >
                <div className="theme-preview-header">
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <img src="/logo.svg" alt="WhisperAgent" style={{ height: '14px', width: 'auto' }} />
                    <img src="/nametext-logo.svg" alt="WhisperAgent" style={{ height: '10px', width: 'auto' }} />
                    <span style={{ fontSize: '9px', opacity: 0.6, letterSpacing: '0.08em', fontWeight: 600, color: currentTheme.textSecondary }}>OVERLAY</span>
                  </div>
                  <span style={{ color: currentTheme.textPrimary, textShadow: '0 0 8px rgba(255, 255, 255, 0.8)', fontWeight: 600 }}>● Ouvindo voz...</span>
                </div>
                <div className="theme-preview-content" style={{ color: currentTheme.textPrimary }}>
                  Transcrição confirmada da fala em tempo real
                  <span className="theme-preview-partial" style={{ color: currentTheme.textPartial }}>
                    {' '}e as próximas palavras sendo reconhecidas...
                  </span>
                  <span style={{ color: currentTheme.textPrimary, opacity: 0.85, marginLeft: '2px' }}>
                    ▍
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ABA: SOBRE & IDENTIDADE VISUAL */}
        {activeTab === 'about' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', padding: '4px 0' }}>
            <div
              style={{
                background: 'linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '24px 20px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '-40px',
                  width: '240px',
                  height: '240px',
                  background: 'radial-gradient(circle, var(--accent-color) 0%, transparent 70%)',
                  opacity: 0.18,
                  pointerEvents: 'none',
                  filter: 'blur(35px)',
                }}
              />
              {/* Logo Completa Oficial com Símbolo e Tipografia */}
              <img
                src="/logo-with-text.svg"
                alt="WhisperAgent Logo Completa"
                style={{
                  maxWidth: '220px',
                  width: '100%',
                  height: 'auto',
                  filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5)) drop-shadow(0 2px 10px rgba(255,255,255,0.12))',
                }}
              />
              <span
                style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  maxWidth: '460px',
                  lineHeight: '1.5',
                  marginTop: '2px',
                }}
              >
                Assistente de voz em tempo real e copiloto inteligente com transcrição STT local contínua e privacidade total.
              </span>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '3px 10px',
                    borderRadius: '20px',
                    background: 'rgba(255,255,255,0.08)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                  }}
                >
                  Versão 0.1.0
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '3px 10px',
                    borderRadius: '20px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: 'var(--text-primary, #ffffff)',
                    fontWeight: 600,
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                  }}
                >
                  STT Local Whisper.cpp 100% Offline
                </span>
              </div>
            </div>

            {/* Variações da Identidade Visual */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              <div
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '14px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  textAlign: 'center',
                }}
              >
                <div style={{ height: '36px', display: 'flex', alignItems: 'center' }}>
                  <img
                    src="/logo.svg"
                    alt="Ícone do WhisperAgent"
                    style={{ height: '32px', width: 'auto', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.4))' }}
                  />
                </div>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Ícone / Símbolo</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  Usado no System Tray, Favicon, HUD Overlay e Badges.
                </span>
              </div>

              <div
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '14px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  textAlign: 'center',
                }}
              >
                <div style={{ height: '36px', display: 'flex', alignItems: 'center' }}>
                  <img
                    src="/nametext-logo.svg"
                    alt="Wordmark do WhisperAgent"
                    style={{ height: '14px', width: 'auto' }}
                  />
                </div>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Wordmark / Tipografia</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  Texto vetorial branco para barras de título e cabeçalhos.
                </span>
              </div>

              <div
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '14px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px',
                  textAlign: 'center',
                }}
              >
                <div style={{ height: '36px', display: 'flex', alignItems: 'center' }}>
                  <img
                    src="/logo-with-text.svg"
                    alt="Logo Completa do WhisperAgent"
                    style={{ height: '36px', width: 'auto' }}
                  />
                </div>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Logo Completa</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  Combinação símbolo + nome para telas de apresentação e sobre.
                </span>
              </div>
            </div>

            {/* Informações Técnicas e de Sistema */}
            <div
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cpu size={14} style={{ color: 'var(--accent-color)' }} />
                Status do Sistema & Arquitetura
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                <div>• <strong>Engine STT:</strong> Whisper.cpp ({whisperModel})</div>
                <div>• <strong>Modo Transcrição:</strong> {transcriptionMode === 'whisper' ? 'Whisper Local' : 'Cloud Fallback'}</div>
                <div>• <strong>Motor de Áudio:</strong> CPAL WASAPI Loopback 16kHz Mono</div>
                <div>• <strong>Copiloto IA (BYOK):</strong> {llmCorrectionEnabled ? `Ativo (${byokModel || 'Custom'})` : 'Desativado'}</div>
              </div>
            </div>
          </div>
        )}
              </>
            )}
          </div>

          {/* Rodapé / Barra de Ações */}
          <div className="settings-footer">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSave}
              >
                Salvar e Aplicar
              </button>
              {statusMsg && (
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-primary, #ffffff)',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <Check size={13} color="#ffffff" />
                  {statusMsg}
                </span>
              )}
            </div>

            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Dica: ESC para fechar
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
