import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

interface CodeBlockProps {
  children?: React.ReactNode;
  className?: string;
}

function CodeBlock({ children, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeString = String(children).replace(/\n$/, '');

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Falha ao copiar código:', err);
    }
  };

  return (
    <div
      className="markdown-code-block"
      data-tauri-drag-region={false}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="markdown-code-header" data-tauri-drag-region={false}>
        <span className="markdown-code-lang">{language || 'código'}</span>
        <button
          type="button"
          className="markdown-code-copy-btn"
          onClick={handleCopy}
          onMouseDown={(e) => e.stopPropagation()}
          title={copied ? 'Copiado!' : 'Copiar código'}
          data-tauri-drag-region={false}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copiado' : 'Copiar'}</span>
        </button>
      </div>
      <pre
        className="markdown-code-pre"
        data-tauri-drag-region={false}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <code className={className}>{codeString}</code>
      </pre>
    </div>
  );
}

export function MarkdownViewer({ content, className = '' }: MarkdownViewerProps) {
  const handleLinkOpen = async (href?: string) => {
    if (!href) return;
    let targetUrl = href.trim();
    if (!targetUrl.includes('://') && !targetUrl.startsWith('mailto:') && !targetUrl.startsWith('#')) {
      targetUrl = `https://${targetUrl}`;
    }

    try {
      // 1. Tenta comando nativo do backend Rust (rundll32 url.dll no Windows)
      await invoke('open_browser_url', { url: targetUrl });
    } catch (invokeErr) {
      console.warn('Falha ao abrir via invoke(open_browser_url), tentando plugin-opener:', invokeErr);
      try {
        // 2. Fallback para o plugin de opener do Tauri
        await openUrl(targetUrl);
      } catch (openerErr) {
        console.warn('Falha ao abrir via plugin-opener, tentando window.open:', openerErr);
        // 3. Fallback web padrão
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    }
  };

  return (
    <div className={`markdown-viewer-root ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }: any) {
            const isInline = inline || (!className && !String(children).includes('\n'));
            if (isInline) {
              return (
                <code
                  className="markdown-inline-code"
                  onMouseDown={(e) => e.stopPropagation()}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="markdown-link"
                data-tauri-drag-region={false}
                title={`Abrir no navegador: ${href}`}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleLinkOpen(href);
                }}
                {...props}
              >
                <span>{children}</span>
                <ExternalLink size={11} style={{ opacity: 0.85, flexShrink: 0 }} />
              </a>
            );
          },
          table({ children }) {
            return (
              <div
                className="markdown-table-wrapper"
                data-tauri-drag-region={false}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <table className="markdown-table">{children}</table>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
