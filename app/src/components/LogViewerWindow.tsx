import { useEffect, useState, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

interface LogRecord {
  level: number;
  message: string;
  time?: string;
}

export function LogViewerWindow() {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Escuta o evento padrão do tauri-plugin-log
    let unlisten: () => void;
    listen<any>('log://log', (event) => {
      const msg = event.payload;
      setLogs((prev) => {
        const newLogs = [...prev, msg];
        if (newLogs.length > 500) {
          return newLogs.slice(newLogs.length - 500); // Manter ultimos 500
        }
        return newLogs;
      });
    }).then(f => unlisten = f).catch(console.warn);

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLevelColor = (level: number) => {
    switch (level) {
      case 1: return '#ef4444'; // Error
      case 2: return '#f59e0b'; // Warn
      case 3: return '#3b82f6'; // Info
      case 4: return '#8b5cf6'; // Debug
      case 5: return '#6b7280'; // Trace
      default: return '#a1a1aa';
    }
  };

  const getLevelName = (level: number) => {
    switch (level) {
      case 1: return 'ERROR';
      case 2: return 'WARN';
      case 3: return 'INFO';
      case 4: return 'DEBUG';
      case 5: return 'TRACE';
      default: return 'LOG';
    }
  };

  return (
    <div style={{ padding: '16px', height: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary, #1e1e2e)', color: 'var(--text-primary, #cdd6f4)' }}>
      <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '20px' }}>🖥️</span> WhisperAgent - Logs do Backend
      </h2>
      <div 
        ref={scrollRef}
        style={{ 
          flex: 1, 
          overflowY: 'auto', 
          backgroundColor: '#11111b', 
          padding: '12px', 
          borderRadius: '8px', 
          fontFamily: 'monospace',
          fontSize: '13px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: '#6c7086' }}>Aguardando logs... (Você precisa rodar com RUST_LOG=debug para ver tudo)</div>
        ) : (
          logs.map((l, i) => (
            <div key={i} style={{ marginBottom: '4px', borderBottom: '1px solid #313244', paddingBottom: '2px' }}>
              <span style={{ color: getLevelColor(l.level), fontWeight: 'bold', marginRight: '8px' }}>
                [{getLevelName(l.level)}]
              </span>
              <span style={{ color: '#a6adc8' }}>{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
