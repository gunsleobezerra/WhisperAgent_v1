---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
## Documentos de Requisitos
- [[1. Visao Geral e Arquitetura]]
- [[4. Integracao LLM e Personas]]

# Funcionalidade: Cliente LLM BYOK (Bring Your Own Key)

**Objetivo:** Gerenciar a comunicação HTTP via Reqwest com provedores de LLM que suportam o padrão OpenAI, processando Server-Sent Events (SSE) para streaming de respostas.

## Contrato / Interface 1: Requisição de Chat Completion
- **Tipo:** Rust Struct / Processador Interno
- **Nome:** `send_chat_completion_request`

**Payload de Entrada:**
```json
{
  "messages": [
    {
      "role": "system|user|assistant",
      "content": "string"
    }
  ],
  "tools": "array",
  "stream": true,
  "api_key": "string",
  "base_url": "string"
}
```

**Fluxo de Sucesso:**
1. Constrói o client HTTP Reqwest com o `base_url` e o cabeçalho de autorização usando a `api_key`.
2. Serializa o payload e dispara um POST request para o endpoint de chat completions.
3. Estabelece a conexão e inicia o recebimento dos chunks em modo streaming (SSE).

**Sucesso (Saída/Evento):**
```json
{
  "status": "connection_established",
  "stream_id": "string"
}
```

**Casos de Falha:**
- `Error_HTTP_401`: Credencial inválida -> Retorna erro detalhado e encerra tentativa.
- `Error_Network_Timeout`: Servidor não responde -> Emite evento `llm_network_error`.

## Contrato / Interface 2: Parsing de SSE Streaming
- **Tipo:** Rust Struct / Processador Interno
- **Nome:** `parse_sse_stream`

**Payload de Entrada:**
```json
{
  "stream_id": "string",
  "raw_chunk": "string"
}
```

**Fluxo de Sucesso:**
1. O parser lê o chunk cru provido pelo stream de rede.
2. Extrai o conteúdo no formato Server-Sent Events prefixado com `data:`.
3. Faz o parse do JSON contido no evento.
4. Acumula os deltas de texto ou argumentos de tool calls na memória para emissão para a UI.

**Sucesso (Saída/Evento):**
```json
{
  "delta_content": "string",
  "tool_calls_delta": "array|null"
}
```

**Casos de Falha:**
- `Error_Malformed_SSE`: Formato SSE inválido -> Ignora o chunk e emite warning no log.
- `Error_JSON_Parse`: JSON corrompido no data block -> Ignora chunk e emite warning no log.

