import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { 
  Copy, 
  Check, 
  RotateCcw, 
  Clock, 
  Bot, 
  FileText, 
  Download, 
  Minus, 
  X,
  Sparkles,
  Info,
  Zap,
} from 'lucide-react';
import { MarkdownViewer } from './MarkdownViewer';

interface SummaryRecord {
  id: string;
  session_id: string;
  created_at: number;
  summary: string;
}

interface CurrentSessionDetails {
  session_id: string;
  created_at: number;
  active_persona: string;
  summaries: SummaryRecord[];
}

export const SessionSummaryWindow: React.FC = () => {
  const [sessionDetails, setSessionDetails] = useState<CurrentSessionDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isSummarizingNow, setIsSummarizingNow] = useState(false);

  // Carrega os detalhes iniciais da sessão e do SQLite
  const loadSessionDetails = async () => {
    try {
      setIsLoading(true);
      const data = await invoke<CurrentSessionDetails>('get_current_session_details');
      setSessionDetails(data);
    } catch (err) {
      console.error('Erro ao buscar detalhes da sessão:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessionDetails();

    // Remove sombras retangulares nativas da janela no Windows
    try {
      getCurrentWindow().setShadow(false).catch(() => {});
    } catch {}

    // Escuta novos resumos gerados em tempo real pelo Rolling Summarizer
    let unlisten: (() => void) | undefined;
    listen<SummaryRecord>('memory://summary-generated', (event) => {
      const newRec = event.payload;
      if (!newRec) return;

      setSessionDetails((prev) => {
        if (!prev) return prev;
        // Se pertencer à mesma sessão exibida, adiciona ou atualiza
        if (prev.session_id === newRec.session_id) {
          const exists = prev.summaries.some((s) => s.id === newRec.id);
          if (exists) return prev;
          return {
            ...prev,
            summaries: [...prev.summaries, newRec],
          };
        } else {
          // Sessão trocada, recarrega completo
          loadSessionDetails();
          return prev;
        }
      });
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        console.warn('Erro ao registrar listener memory://summary-generated:', err);
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleCopySessionId = async () => {
    if (!sessionDetails?.session_id) return;
    try {
      await navigator.clipboard.writeText(sessionDetails.session_id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (err) {
      console.error('Falha ao copiar session_id:', err);
    }
  };

  const handleCopyAllSummaries = async () => {
    if (!sessionDetails || sessionDetails.summaries.length === 0) return;
    try {
      const fullContent = [
        `# Sumário da Sessão: ${sessionDetails.session_id}`,
        `**Início:** ${new Date(sessionDetails.created_at * 1000).toLocaleString()}`,
        `**Persona Ativa:** ${sessionDetails.active_persona}`,
        '',
        '---',
        '',
        ...sessionDetails.summaries.map((s, idx) => {
          const time = new Date(s.created_at * 1000).toLocaleTimeString();
          return `### Bloco #${idx + 1} (${time})\n\n${s.summary}\n`;
        }),
      ].join('\n');

      await navigator.clipboard.writeText(fullContent);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch (err) {
      console.error('Falha ao copiar conteúdo consolidado:', err);
    }
  };

  const handleDownloadMarkdown = () => {
    if (!sessionDetails || sessionDetails.summaries.length === 0) return;
    const fullContent = [
      `# Sumário da Sessão: ${sessionDetails.session_id}`,
      `**Início:** ${new Date(sessionDetails.created_at * 1000).toLocaleString()}`,
      `**Persona:** ${sessionDetails.active_persona}`,
      '',
      '---',
      '',
      ...sessionDetails.summaries.map((s, idx) => {
        const time = new Date(s.created_at * 1000).toLocaleTimeString();
        return `### Bloco #${idx + 1} (${time})\n\n${s.summary}\n`;
      }),
    ].join('\n');

    const blob = new Blob([fullContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `whisperagent-resumo-${sessionDetails.session_id.slice(0, 8)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateNewSession = async () => {
    if (!window.confirm('Deseja iniciar uma nova sessão? O contexto da IA e o buffer recente serão zerados para uma nova conversa.')) {
      return;
    }
    try {
      setIsCreatingSession(true);
      await invoke('create_new_session');
      await loadSessionDetails();
    } catch (err) {
      console.error('Erro ao criar nova sessão:', err);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleForceSummarize = async () => {
    try {
      setIsSummarizingNow(true);
      const newRec = await invoke<SummaryRecord>('force_summarize_now');
      if (newRec) {
        setSessionDetails((prev) => {
          if (!prev) return prev;
          const exists = prev.summaries.some((s) => s.id === newRec.id);
          if (exists) return prev;
          return {
            ...prev,
            summaries: [...prev.summaries, newRec],
          };
        });
      }
    } catch (err: any) {
      console.warn('Não foi possível gerar resumo manual:', err);
      alert(typeof err === 'string' ? err : 'Ainda não há áudio recente no buffer para resumir.');
    } finally {
      setIsSummarizingNow(false);
    }
  };

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (e) {
      console.error(e);
    }
  };

  const handleClose = async () => {
    try {
      await invoke('hide_session_summary');
    } catch {
      try {
        await getCurrentWindow().close();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const formattedDate = sessionDetails?.created_at
    ? new Date(sessionDetails.created_at * 1000).toLocaleString()
    : 'Desconhecido';

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-card, rgba(18, 18, 22, 0.95))',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        color: 'var(--text-primary, #ffffff)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
        boxSizing: 'border-box',
        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
        borderRadius: '12px',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
      }}
    >
      {/* Barra de Título Arrastável */}
      <div
        data-tauri-drag-region
        style={{
          height: '44px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          userSelect: 'none',
          cursor: 'grab',
        }}
      >
        <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={16} color="var(--primary-color, #6366f1)" />
          <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.3px' }}>
            Sumário da Sessão
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: '10px',
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              color: 'var(--primary-color, #818cf8)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
            }}
          >
            Memória Consolidada
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={handleMinimize}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #a1a1aa)',
              padding: '5px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Minimizar"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary, #a1a1aa)',
              padding: '5px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Fechar"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Subcabeçalho da Sessão: ID, Horário e Ações */}
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary, #a1a1aa)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Sessão Ativa:
            </span>
            <code
              style={{
                fontSize: '12px',
                fontFamily: 'monospace',
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                padding: '3px 7px',
                borderRadius: '5px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'var(--text-primary, #ffffff)',
              }}
            >
              {sessionDetails?.session_id || 'Carregando...'}
            </code>
            <button
              onClick={handleCopySessionId}
              disabled={!sessionDetails?.session_id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: '5px',
                backgroundColor: copiedId ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                color: copiedId ? '#4ade80' : 'var(--text-primary, #ffffff)',
                border: copiedId ? '1px solid rgba(74, 222, 128, 0.4)' : '1px solid rgba(255, 255, 255, 0.12)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title="Copiar UUID da Sessão"
            >
              {copiedId ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedId ? 'Copiado!' : 'Copiar ID'}</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11px', color: 'var(--text-secondary, #a1a1aa)', marginTop: '2px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} /> Início: {formattedDate}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Bot size={12} /> Persona: {sessionDetails?.active_persona || 'Padrão'}
            </span>
          </div>
        </div>

        {/* Botões de Ação do Topo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleForceSummarize}
            disabled={isSummarizingNow}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '12px',
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: 'rgba(99, 102, 241, 0.2)',
              color: 'var(--primary-color, #a5b4fc)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              cursor: isSummarizingNow ? 'wait' : 'pointer',
              fontWeight: 600,
              transition: 'all 0.15s ease',
            }}
            title="Consolidar imediatamente o que acabou de ser falado no buffer recente"
          >
            <Zap size={13} fill="currentColor" />
            <span>{isSummarizingNow ? 'Resumindo...' : 'Resumir Agora'}</span>
          </button>

          <button
            onClick={handleCopyAllSummaries}
            disabled={!sessionDetails?.summaries.length}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '12px',
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: copiedAll ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.06)',
              color: copiedAll ? '#4ade80' : 'var(--text-primary, #ffffff)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              cursor: sessionDetails?.summaries.length ? 'pointer' : 'not-allowed',
              opacity: sessionDetails?.summaries.length ? 1 : 0.5,
              fontWeight: 500,
            }}
            title="Copiar todos os tópicos formatados em Markdown"
          >
            {copiedAll ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedAll ? 'Copiado' : 'Copiar Tudo'}</span>
          </button>

          <button
            onClick={handleDownloadMarkdown}
            disabled={!sessionDetails?.summaries.length}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '12px',
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              color: 'var(--text-primary, #ffffff)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              cursor: sessionDetails?.summaries.length ? 'pointer' : 'not-allowed',
              opacity: sessionDetails?.summaries.length ? 1 : 0.5,
              fontWeight: 500,
            }}
            title="Exportar sumário como arquivo .md"
          >
            <Download size={13} />
            <span>Exportar .md</span>
          </button>

          <button
            onClick={handleCreateNewSession}
            disabled={isCreatingSession}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '12px',
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
            title="Encerrar sessão atual e iniciar uma nova"
          >
            <RotateCcw size={13} />
            <span>Nova Sessão</span>
          </button>
        </div>
      </div>

      {/* Conteúdo Central: Lista de Tópicos e Resumos */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary, #a1a1aa)', fontSize: '13px' }}>
            Carregando memória da sessão...
          </div>
        ) : !sessionDetails?.summaries || sessionDetails.summaries.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '12px',
              color: 'var(--text-secondary, #a1a1aa)',
              textAlign: 'center',
              padding: '40px 20px',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sparkles size={22} color="var(--primary-color, #818cf8)" />
            </div>
            <div>
              <p style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #ffffff)' }}>
                Nenhum sumário consolidado ainda
              </p>
              <p style={{ margin: 0, fontSize: '12px', maxWidth: '380px', lineHeight: '1.5' }}>
                Conforme você fala, o motor do WhisperAgent analisa a conversa e gera tópicos consolidados automaticamente a cada 2 minutos ou durante pausas.
              </p>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                color: 'var(--text-primary, #e2e8f0)',
                marginTop: '10px',
              }}
            >
              <Info size={13} color="#818cf8" />
              <span>O que você acabou de falar nos últimos 60 segundos permanece ativo na memória rápida (RAM).</span>
            </div>
          </div>
        ) : (
          sessionDetails.summaries.map((item, index) => {
            const timeStr = new Date(item.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return (
              <div
                key={item.id || index}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'var(--primary-color, #818cf8)',
                        backgroundColor: 'rgba(99, 102, 241, 0.15)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      Bloco #{index + 1}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary, #a1a1aa)' }}>
                      {timeStr}
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.3)', fontFamily: 'monospace' }}>
                    {item.id.slice(0, 8)}
                  </span>
                </div>

                <div style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-primary, #f4f4f5)' }}>
                  <MarkdownViewer content={item.summary} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rodapé Informativo */}
      <div
        style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: 'var(--text-secondary, #71717a)',
        }}
      >
        <span>
          Total de resumos consolidados: {sessionDetails?.summaries?.length || 0}
        </span>
        <span>
          Armazenado localmente em SQLite (memory.sqlite3)
        </span>
      </div>
    </div>
  );
};
