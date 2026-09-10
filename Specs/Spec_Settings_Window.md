---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
[[1. Visao Geral e Arquitetura]]
[[2. Interface e Overlay]]

# Funcionalidade: Janela de Configurações (Settings)

**Objetivo:** Especificar o contrato técnico estrito entre o Frontend React e o Backend Rust para persistência e aplicação de preferências do usuário, incluindo temas e seleção de LLMs.

## Contrato 1: Comando de Sincronização de Estado (Settings)

- **Tipo:** Tauri Command (Rust Invoke)
- **Nome:** `update_settings_state`

**Payload de Entrada:**
```json
{
  "audio_mute": "boolean",
  "active_source_id": "string",
  "transcription_mode": "string",
  "ui_theme": "string",
  "overlay_opacity": "number",
  "overlay_monitor_id": "number",
  "selected_llm_id": "string"
}
```

**Fluxo de Sucesso:**
1. O usuário aplica uma modificação no painel de Settings.
2. O React invoca o comando `update_settings_state` passando todo o objeto serializado.
3. O Backend valida os parâmetros e atualiza o estado interno da aplicação (persistindo em banco/disco).
4. O Backend dispara atualizações nativas, como `set_window_opacity` para as janelas em tempo real.

**Sucesso (Saída/Resposta):**
```json
{
  "status": "success",
  "applied_at": "string"
}
```

**Casos de Falha:**
- `Validação de Opacidade`: `overlay_opacity` menor que 0 ou maior que 100 -> O Backend rejeita a alteração e retorna a string de erro exata `"INVALID_OPACITY_RANGE"`.
- `Monitor Desconectado`: `overlay_monitor_id` refere-se a um ID inexistente no SO -> O Backend rejeita e retorna a string de erro `"MONITOR_NOT_FOUND"`.
- `LLM Inválido`: `selected_llm_id` refere-se a um modelo não suportado ou não configurado -> O Backend rejeita e retorna a string de erro `"LLM_NOT_CONFIGURED"`.

## Contrato 2: Comando de Abertura da Janela de Settings

- **Tipo:** Tauri Command (Rust Invoke)
- **Nome:** `request_open_settings`

**Payload de Entrada:**
```json
{
  "force_focus": "boolean"
}
```

**Fluxo de Sucesso:**
1. O React solicita a exibição da janela de settings ao Backend.
2. O Backend inspeciona a lista de webviews ativas.
3. Se a janela de settings já existe, o Backend foca a janela através de APIs do SO (se `force_focus` for `true`).
4. Se a janela não existe, o Backend instancia o WebView da janela de settings e aplica as decorações apropriadas.

**Sucesso (Saída/Resposta):**
```json
{
  "status": "success",
  "window_id": "string"
}
```

**Casos de Falha:**
- `Limite de Janelas`: O sistema operacional impede uma nova instância webview -> O Backend rejeita a promise com `"WEBVIEW_CREATION_FAILED"`.
- `Bloqueio de Foco`: Janela existe, mas sistema operacional não permite puxar o foco -> Retorna `"FOCUS_DENIED"`.

