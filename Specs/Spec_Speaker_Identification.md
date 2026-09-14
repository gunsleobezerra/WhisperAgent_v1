---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
[[1. Visao Geral e Arquitetura]]
[[3. Motor STT Local e Audio]]
[[4. Integracao LLM e Personas]]
[[Spec_Audio_Capture]]
[[Spec_Live_Overlay]]

# Funcionalidade: Identificação de Interlocutores e Resolução de Nomes (Speaker Diarization & Name Resolution)

**Objetivo:** Prover um modo ativável/desativável sob demanda que identifica quem está falando (diarização de áudio por canal de entrada/loopback) e infere contextualmente os nomes dos participantes através da análise das transcrições pela LLM.

---

## 1. Contrato / Interface: Alternância de Modo (Toggle)

- **Tipo:** Tauri Command
- **Nome:** `set_speaker_identification_mode`

**Payload de Entrada:**
```json
{
  "enabled": true
}
```

**Fluxo de Sucesso:**
1. O backend atualiza o estado atômico global `speaker_identification_enabled`.
2. Se `enabled == true`, habilita o rastreamento individual de fluxos de áudio (Canal 0: Microfone local / `self`, Canal 1: Loopback do sistema / `system_audio`) e inicializa o mapa de interlocutores da sessão.
3. Se `enabled == false`, desativa o enriquecimento de nomes nas emissões do Live Overlay, retornando ao formato de transcrição padrão contínua.
4. Emite confirmação do estado atual para o frontend.

**Sucesso (Saída):**
```json
{
  "enabled": true,
  "active_speakers_count": 0
}
```

**Casos de Falha:**
- `SYSTEM_AUDIO_LOOPBACK_UNAVAILABLE`: Loopback não configurado ou sem permissão -> Retorna `{"error": "LOOPBACK_UNAVAILABLE", "message": "Identificação ativada apenas para canal de microfone local (loopback inativo)."}`.

---

## 2. Contrato / Interface: Evento de Transcrição com Atribuição de Falante

- **Tipo:** Tauri IPC Event
- **Nome:** `speaker_transcription_update`

**Payload de Emissão (Backend -> Frontend Overlay):**
```json
{
  "session_id": "sess_2026_09_10_001",
  "segment_id": "seg_104",
  "speaker_id": "speaker_system_01",
  "speaker_label": "Carlos",
  "is_inferred": true,
  "confidence": 0.92,
  "source_channel": "loopback",
  "text": "Sim Leonardo, podemos fechar a sprint amanhã.",
  "timestamp_start_ms": 145000,
  "timestamp_end_ms": 148200
}
```

---

## 3. Contrato / Interface: Dedução e Resolução de Nomes via LLM

- **Tipo:** Internal Worker Pipeline / LLM Extraction Hook
- **Disparo:** Acionado a cada lote de conversas acumuladas ou quando detectadas menções em primeira/segunda pessoa ("eu sou...", "aqui é o...", "olá fulano").

**Schema do Prompt Interno (Structured Output):**
```json
{
  "interlocutors": [
    {
      "speaker_id": "speaker_system_01",
      "assigned_name": "Carlos",
      "evidence": "Interlocutor disse 'Aqui é o Carlos'",
      "confidence": 0.95
    }
  ]
}
```

**Comportamento de Resolução:**
1. Se `source_channel == "mic"`, a identidade padrão é `Você (Usuário)` a menos que haja persona ou nome configurado em `Spec_Settings_Window`.
2. Se `source_channel == "loopback"` e nenhum nome foi inferido, o `speaker_label` exibe temporariamente `Interlocutor 1`, `Interlocutor 2`.
3. Quando a LLM deduz um nome com `confidence >= 0.80`, o `speaker_label` é atualizado retroativamente e emitido via evento IPC `speaker_identity_resolved`.

---

## 4. Contrato / Interface: Evento de Resolução Retroativa de Identidade

- **Tipo:** Tauri IPC Event
- **Nome:** `speaker_identity_resolved`

**Payload de Emissão:**
```json
{
  "speaker_id": "speaker_system_01",
  "resolved_name": "Carlos",
  "evidence": "Aqui é o Carlos da equipe de infra",
  "previous_label": "Interlocutor 1"
}
```

---

## 5. Contrato / Interface: Correção Manual de Nome (Override pelo Usuário)

- **Tipo:** Tauri Command
- **Nome:** `override_speaker_name`

**Payload de Entrada:**
```json
{
  "speaker_id": "speaker_system_01",
  "custom_name": "Carlos Mendes"
}
```

**Fluxo de Sucesso:**
1. O backend sobrescreve forçadamente o mapa de nomes em memória para `speaker_system_01`.
2. O registro em SQLite é atualizado com `is_manual_override = 1`.
3. Notifica o Live Overlay com o evento `speaker_identity_resolved`.

**Sucesso (Saída):**
```json
{
  "success": true,
  "speaker_id": "speaker_system_01",
  "name": "Carlos Mendes"
}
```
