---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
## 🔗 Documentos de Requisitos
- [[1. Visao Geral e Arquitetura]]
- [[5. Otimizacao de Memoria e Contexto]]

# Funcionalidade: Banco de Dados SQLite e Rolling Summaries

**Objetivo:** Persistir resumos consolidados da conversa em um banco local SQLite (via `rusqlite`) e construir dinamicamente o contexto para a LLM combinando banco e memória rápida.

## Contrato 1: Schema SQLite (DDL)
- **Tipo:** Banco de Dados Embutido Local
- **Nome:** `memory.sqlite3`

**Schema DDL Obrigatório:**
```sql
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    active_persona TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events_summary (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    summary TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_facts (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    fact TEXT NOT NULL,
    relevance_score INTEGER NOT NULL
);
```

## Contrato 2: Escrita e Rolling Summarization
- **Tipo:** Processo Worker Rust
- **Nome:** `Rolling Summarizer`

**Fluxo de Sucesso:**
1. O worker `Rolling Summarizer` aguarda o disparo (intervalo fixo ou silêncio contínuo via VAD).
2. O worker extrai os blocos expirados do canal (MPSC).
3. Aciona a LLM e recebe o texto sintetizado.
4. Abre conexão bloqueante com o SQLite.
5. Inicia uma transação e executa o `INSERT INTO events_summary`.
6. Realiza o commit da transação.
7. Emite evento IPC para o frontend:

**Sucesso (Evento IPC):**
```json
{
  "event": "memory://summary-generated",
  "payload": {
    "session_id": "uuid-aqui",
    "summary_id": "uuid-aqui"
  }
}
```

**Casos de Falha:**
- `Erro SQLITE_BUSY`: O banco encontra-se travado por leitura longa. O worker executa 3 tentativas (backoff 100ms, 500ms, 2000ms). Se falhar na 3ª, aborta o salvamento e loga "WARN: SQLITE_BUSY, summary discarded".
- `Erro SQLiteConstraint`: O `session_id` da query não existe na tabela `sessions`. O worker descarta a transação e loga "ERROR: Orphant summary, constraint violation".

## Contrato 3: Montagem de Prompt Dinâmico
- **Tipo:** Função de Consulta Rust
- **Nome:** `build_agent_context(session_id: &str) -> String`

**Fluxo de Sucesso:**
1. Abre conexão com o banco SQLite em modo `Read-Only`.
2. Executa a query: `SELECT summary FROM events_summary WHERE session_id = ? ORDER BY created_at DESC LIMIT 50`.
3. Adquire lock de leitura no `HotRingBuffer` e compila todos os `text` ativos.
4. Monta a string final estrita seguindo a formatação:

```text
[PERSONA ACTIVE]: {active_persona}
[CONTEXTO CONSOLIDADO DA PARTIDA]:
{events_summary_concatenated}

[ÚLTIMOS X SEGUNDOS (FALA AO VIVO)]:
{hot_ring_buffer_concatenated}
```
5. Retorna a String bruta.

**Casos de Falha:**
- `Erro de Leitura SQLite (Falha no arquivo/Database Locked)`: A função captura o erro silenciosamente (Catch), loga "WARN: Failed to read memory.sqlite3" e **monta o contexto usando apenas o HotRingBuffer**, garantindo que o agente responda independente de falha no disco.

