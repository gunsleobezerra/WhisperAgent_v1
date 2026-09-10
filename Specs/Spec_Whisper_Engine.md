---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
[[1. Visao Geral e Arquitetura]]
[[3. Motor STT Local e Audio]]

# Funcionalidade: Motor Whisper-rs e Pipeline de Download

**Objetivo:** Gerenciar o download do modelo do Whisper a partir do HuggingFace no primeiro boot (reportando progresso), e instanciar o motor Whisper-rs na memória para processamento de inferência.

## Contrato / Interface: Inicialização e Download do Modelo
- **Tipo:** Tauri Command
- **Nome:** `init_whisper_engine`

**Payload de Entrada:**
```json
{
  "model_type": "base",
  "repo_id": "ggerganov/whisper.cpp",
  "filename": "ggml-base.bin"
}
```

**Fluxo de Sucesso:**
1. O backend inspeciona o diretório de dados local (ex: `AppData/Local/WisperAgent/models`).
2. Se o arquivo `filename` não for encontrado, inicia o download assíncrono diretamente do repositório HuggingFace (`repo_id`).
3. O download transmite payloads de progresso contínuos via IPC.
4. Após o download (ou se já existente), o backend invoca a API do `whisper-rs` para carregar o modelo (`ggml-base.bin`) em memória.
5. Retorna o status de pronto.

**Sucesso (Saída/Evento):**
```json
{
  "status": "ready",
  "model_path": "C:\\Users\\Leonardo\\AppData\\Local\\WisperAgent\\models\\ggml-base.bin"
}
```

**Casos de Falha:**
- `DOWNLOAD_TIMEOUT`: Falha na conexão com o HuggingFace. -> Retorna `{"error": "DOWNLOAD_TIMEOUT", "message": "Não foi possível conectar ao HuggingFace."}`
- `INSUFFICIENT_STORAGE`: Disco lotado durante a gravação dos pesos. -> Retorna `{"error": "INSUFFICIENT_STORAGE", "message": "Espaço em disco insuficiente."}`
- `MODEL_CORRUPTED`: O checksum do arquivo não bate ou `whisper-rs` rejeita o arquivo. -> Retorna `{"error": "MODEL_CORRUPTED", "message": "Arquivo do modelo inválido ou corrompido."}`

## Contrato / Interface: Progresso de Download
- **Tipo:** Tauri IPC Event
- **Nome:** `whisper_download_progress`

**Payload de Entrada:** N/A (Evento emitido periodicamente pela thread de download)

**Fluxo de Sucesso:**
1. A cada chunk de bytes lido do stream HTTP, o backend calcula o percentual concluído e emite um evento IPC.

**Sucesso (Saída/Evento):**
```json
{
  "model": "ggml-base.bin",
  "progress_percent": 45.5,
  "downloaded_bytes": 65432123,
  "total_bytes": 142000000
}
```

**Casos de Falha:**
- O evento IPC não possui fluxo de falha próprio; se a stream cair, o comando original `init_whisper_engine` falhará retornando o erro apropriado.

## Contrato / Interface: Transcrição Whisper-rs
- **Tipo:** Tauri IPC Event
- **Nome:** `transcription_result`

**Payload de Entrada:** N/A (Evento emitido pelo motor após inferência sobre os frames recebidos)

**Fluxo de Sucesso:**
1. A thread do motor `whisper-rs` extrai frames de áudio consumidos do Ring Buffer.
2. Executa a inferência sobre os frames de áudio.
3. O backend emite um evento IPC estruturado sempre que finaliza a transcrição de um segmento.

**Sucesso (Saída/Evento):**
```json
{
  "text": "Comando de voz reconhecido",
  "is_final": true,
  "confidence_score": 0.95
}
```

**Casos de Falha:**
- `INFERENCE_FAILED`: O motor falha por falta de memória (OOM) ou cálculo inválido durante a execução. -> Emite `{"error": "INFERENCE_FAILED", "message": "Falha na inferência do modelo Whisper-rs."}`

