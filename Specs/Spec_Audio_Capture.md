---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
[[1. Visao Geral e Arquitetura]]
[[3. Motor STT Local e Audio]]

# Funcionalidade: Captura de Áudio e Gerenciamento CPAL

**Objetivo:** Configurar e gerenciar a captura de áudio multiplataforma utilizando CPAL, operando em threads dedicadas e gerenciando rigorosamente os estados de falha física, incluindo hot-swapping de dispositivos.

## Contrato / Interface: Inicialização de Captura
- **Tipo:** Tauri Command
- **Nome:** `start_audio_capture`

**Payload de Entrada:**
```json
{
  "device_id": "default",
  "sample_rate": 16000,
  "channels": 1,
  "format": "f32"
}
```

**Fluxo de Sucesso:**
1. O backend solicita a lista de hosts CPAL e adquire o dispositivo apontado por `device_id` (ou o padrão se não for encontrado).
2. Configura a stream de entrada para o `sample_rate`, canais e formato definidos.
3. Inicia a thread de captura, alocando um Ring Buffer em memória para armazenamento temporário dos frames.
4. Retorna a confirmação do dispositivo ativo e seu estado.

**Sucesso (Saída/Evento):**
```json
{
  "status": "capturing",
  "active_device_id": "microfone-usb-123"
}
```

**Casos de Falha:**
- `DEVICE_NOT_FOUND`: O `device_id` especificado não existe ou foi desconectado. -> Retorna `{"error": "DEVICE_NOT_FOUND", "message": "Dispositivo de áudio não encontrado."}`
- `MICROPHONE_DENIED`: Permissão em nível de SO recusada. -> Retorna `{"error": "MICROPHONE_DENIED", "message": "Acesso ao microfone negado pelo SO."}`
- `UNSUPPORTED_AUDIO_FORMAT`: Dispositivo não suporta o `sample_rate` ou formatação. -> Retorna `{"error": "UNSUPPORTED_AUDIO_FORMAT", "message": "Formato de áudio não suportado pelo dispositivo."}`

## Contrato / Interface: Evento de Hot-Swapping e Falha Física
- **Tipo:** Tauri IPC Event
- **Nome:** `audio_device_status_changed`

**Payload de Entrada:** N/A (Emissão assíncrona pela thread de captura)

**Fluxo de Sucesso (Desconexão / Hot-swap):**
1. A thread de captura do CPAL detecta falha ao ler do dispositivo (ex: cabo USB desconectado).
2. A stream é imediatamente pausada e limpa da memória.
3. Um evento IPC é emitido notificando o frontend sobre a perda do dispositivo.

**Sucesso (Saída/Evento):**
```json
{
  "event": "device_disconnected",
  "device_id": "microfone-usb-123",
  "timestamp": 1693526543
}
```

**Casos de Falha:**
- `STREAM_RECOVERY_FAILED`: O CPAL falha catastroficamente ao tentar fechar a stream rompida. -> Emite `{"error": "STREAM_RECOVERY_FAILED", "message": "Falha irrecuperável na thread de áudio."}` e finaliza a thread.

## Contrato / Interface: Interrupção de Captura
- **Tipo:** Tauri Command
- **Nome:** `stop_audio_capture`

**Payload de Entrada:** N/A

**Fluxo de Sucesso:**
1. O backend sinaliza `RUNNING_FLAG` como `false`.
2. A thread de captura CPAL detecta o sinal, encerra a leitura e libera o stream do dispositivo.
3. Frames adicionais no buffer são descartados e novos disparos de inferência STT são suspensos.
4. Retorna `Ok(())`.

**Sucesso (Saída):**
```json
null
```

## Contrato / Interface: Diagnóstico e Escuta do Áudio do Whisper
- **Tipo:** Tauri Command
- **Nome:** `get_last_captured_audio`

**Objetivo:** Retornar os bytes do arquivo `.wav` padrão PCM 16-bit 16kHz mono do último segmento de fala que foi enviado ao motor Whisper para reprodução direta no frontend e verificação pelo usuário.

**Fluxo de Sucesso:**
1. Recupera o buffer `LAST_CAPTURED_AUDIO` ou lê `last_whisper_input.wav` gravado em disco.
2. Retorna `Ok(Vec<u8>)`.

## Contrato / Interface: Estatísticas do Último Áudio
- **Tipo:** Tauri Command
- **Nome:** `get_audio_recording_stats`

**Saída:**
```json
{
  "duration_seconds": 3.42,
  "sample_rate": 16000,
  "rms_level": 0.072,
  "peak_level": 0.58,
  "sample_count": 54720,
  "timestamp_ms": 1757361200000
}
```

## Contrato / Interface: Abertura da Pasta de Gravações
- **Tipo:** Tauri Command
- **Nome:** `open_recordings_folder`

**Objetivo:** Abre no explorador nativo do sistema operacional (ex: Windows Explorer) a pasta onde os arquivos `.wav` de diagnóstico são persistidos.

## Contrato / Interface: VU Meter em Tempo Real
- **Tipo:** Tauri IPC Event
- **Nome:** `audio_level_meter`

**Payload Emitido (~80ms periodicamente):**
```json
{
  "rms": 0.045,
  "peak": 0.32,
  "is_speaking": true
}
```


