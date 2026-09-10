---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
[[1. Visao Geral e Arquitetura]]
[[5. Otimizacao de Memoria e Contexto]]
[[Spec_DB_Schema]]

# Funcionalidade: Janela de Sumário da Sessão (Session Summary Window)

**Objetivo:** Permitir que o usuário visualize em uma janela dedicada e focada o ID da sessão ativa e o histórico de resumos sintetizados pelo *Rolling Summarizer*, com recursos de cópia de ID e exportação de sumário.

## Contrato 1: Comando de Abertura / Foco da Janela

- **Tipo:** Tauri Command (Rust Invoke)
- **Nome:** `request_open_session_summary`

**Payload de Entrada:** Nenhum (ou vazio).

**Fluxo de Sucesso:**
1. O usuário aciona o botão de sumário no Live Overlay ou via atalho/tray.
2. O React invoca `request_open_session_summary`.
3. O Backend verifica se a janela de label `"session-summary"` já existe.
4. Se existir, desminimiza, remove sombra nativa, exibe e coloca em foco.
5. Se não existir, instancia a janela via `WebviewWindowBuilder` carregando `index.html?window=session-summary` com dimensões adequadas (ex: 640x540), suporte a resize e decoração transparente moderna.

**Sucesso (Saída/Resposta):**
```json
{
  "status": "success"
}
```

---

## Contrato 2: Consulta dos Detalhes da Sessão Atual

- **Tipo:** Tauri Command (Rust Invoke)
- **Nome:** `get_current_session_details`

**Payload de Saída:**
```json
{
  "session_id": "string",
  "created_at": 1718000000,
  "active_persona": "string",
  "summaries": [
    {
      "id": "uuid-string",
      "created_at": 1718000120,
      "summary": "Tópicos abordados até o momento..."
    }
  ]
}
```

**Fluxo de Sucesso:**
1. A janela `session-summary` é montada no React e invoca `get_current_session_details`.
2. O Backend obtém o `session_id` ativo da sessão global.
3. Se não houver sessão ativa, cria/retorna uma vazia inicializada.
4. Consulta a tabela `sessions` e `events_summary` via SQLite ordenado por `created_at ASC`.
5. Retorna o array de resumos com timestamps legíveis.

---

## Contrato 3: Evento de Atualização em Tempo Real de Sumário

- **Tipo:** Tauri Event (Listen)
- **Nome:** `memory://summary-generated`

**Payload do Evento:**
```json
{
  "session_id": "string",
  "summary_id": "string",
  "created_at": 1718000120,
  "summary": "string"
}
```

**Fluxo de Sucesso:**
1. Quando o `Rolling Summarizer` completa a síntese de um bloco e salva no SQLite, despacha o evento `memory://summary-generated` via `app_handle.emit()`.
2. A janela `session-summary`, se aberta, escuta o evento.
3. Se o `session_id` do payload corresponder à sessão aberta, adiciona o novo resumo ao final da lista na interface reativa do usuário sem recarregar a tela.
