// Utilitário de síntese de áudio para notificações de ações do modelo via Web Audio API
// Não requer arquivos externos ou conexões com a internet.

export type PopupSoundTone = 'chime' | 'ping' | 'bell' | 'pop' | 'chord' | 'subtle';

export interface SoundPreset {
  id: PopupSoundTone;
  name: string;
  description: string;
}

export const SOUND_PRESETS: SoundPreset[] = [
  { id: 'chime', name: 'Chime Harmônico', description: 'Dois tons ascendentes suaves e cristalinos' },
  { id: 'ping', name: 'Digital Ping', description: 'Pulso eletrônico moderno e discreto' },
  { id: 'bell', name: 'Sino Cristalino', description: 'Ressonância clássica com harmônicos brilhantes' },
  { id: 'pop', name: 'Pop Suave', description: 'Efeito orgânico rápido estilo bolha' },
  { id: 'chord', name: 'Acorde Triádico', description: 'Harmonia suave de três notas' },
  { id: 'subtle', name: 'Alerta Discreto', description: 'Toque duplo minimalista e suave' },
];

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function playPopupSound(tone: PopupSoundTone = 'chime', volume = 80) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Normaliza o volume de 0 a 100 para ganho real (com corte de segurança em 0.6 para não estourar)
    const masterGain = ctx.createGain();
    const normalizedVol = Math.max(0, Math.min(100, volume)) / 100;
    const peakGain = normalizedVol * 0.35;
    masterGain.gain.setValueAtTime(peakGain, ctx.currentTime);
    masterGain.connect(ctx.destination);

    const now = ctx.currentTime;

    switch (tone) {
      case 'chime': {
        // Dois tons harmônicos ascendentes (C6 -> G6)
        playTone(ctx, masterGain, 1046.5, now, 0.28, 'sine');
        playTone(ctx, masterGain, 1567.98, now + 0.08, 0.38, 'sine');
        break;
      }
      case 'ping': {
        // Bip digital moderno e limpo
        playTone(ctx, masterGain, 1760.0, now, 0.18, 'sine');
        break;
      }
      case 'bell': {
        // Sino com fundamental e harmônico
        playTone(ctx, masterGain, 659.25, now, 0.55, 'sine');
        playTone(ctx, masterGain, 1318.5, now, 0.45, 'triangle', 0.5);
        break;
      }
      case 'pop': {
        // Pop com variação rápida de frequência
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(500, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);

        gain.gain.setValueAtTime(peakGain * 0.8, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      }
      case 'chord': {
        // Tríade maior elegante: E5, G#5, B5, E6
        playTone(ctx, masterGain, 659.25, now, 0.4, 'sine', 0.6);
        playTone(ctx, masterGain, 830.61, now + 0.04, 0.4, 'sine', 0.7);
        playTone(ctx, masterGain, 987.77, now + 0.08, 0.45, 'sine', 0.8);
        playTone(ctx, masterGain, 1318.51, now + 0.12, 0.5, 'sine', 0.9);
        break;
      }
      case 'subtle': {
        // Dois toques sutis e rápidos
        playTone(ctx, masterGain, 880, now, 0.05, 'triangle', 0.4);
        playTone(ctx, masterGain, 1108.73, now + 0.07, 0.06, 'triangle', 0.5);
        break;
      }
      default: {
        playTone(ctx, masterGain, 1046.5, now, 0.3, 'sine');
      }
    }
  } catch (err) {
    console.warn('Erro ao reproduzir som de notificação:', err);
  }
}

function playTone(
  ctx: AudioContext,
  destination: AudioNode,
  frequency: number,
  startTime: number,
  duration: number,
  type: OscillatorType = 'sine',
  volumeFactor = 1.0
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.linearRampToValueAtTime(volumeFactor, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(gain);
  gain.connect(destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}
