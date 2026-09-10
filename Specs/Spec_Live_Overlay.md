---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
[[1. Visao Geral e Arquitetura]]
[[2. Interface e Overlay]]

# Funcionalidade: Overlay Transparente (Live Transcription)

**Objetivo:** Definir estritamente a comunicação para exibir a transcrição em tempo real no Overlay Transparente, otimizando o DOM e implementando batching de 100ms via Tauri Events.

## Contrato 1: Evento de Transcrição em Tempo Real

- **Tipo:** IPC Event (Tauri Listen)
- **Nome:** `stt_transcription_update`

**Payload de Entrada:**
```json
{
  "mode": "string",
  "text": "string",
  "is_final": "boolean"
}
```

**Fluxo de Sucesso:**
1. O Backend emite o evento `stt_transcription_update` a cada batch de 100ms ou ao final de uma sentença.
2. A janela React Live Overlay escuta o evento de forma passiva.
3. O React substitui o nó de texto renderizado na tela pelo valor do campo `text`, garantindo otimização de DOM e evitando re-renderizações complexas.
4. O React avalia a flag `is_final`. Se for `true`, inicia o timer nativo para aplicar fade out e limpar a tela após o tempo configurado.

**Casos de Falha:**
- `Payload Malformado`: Campos essenciais vêm com tipos de dados incorretos ou ausentes -> O React descarta o evento silenciosamente e não altera a interface, prevenindo falha de renderização.

## Contrato 2: Controle de Interrupção / Retomada de Transcrição

- **Tipo:** Ação de Interface / IPC Command Invoke
- **Nome:** `toggle_transcription_action`

**Fluxo de Sucesso:**
1. O usuário clica no botão de ação da barra do Overlay (`⏸️` quando ativo ou `▶️` quando pausado).
2. Se ativo (`isListening === true`):
   - Invoca o comando Tauri `stop_audio_capture`.
   - Limpa o texto parcial em streaming (`livePartialText = ''`).
   - Atualiza o estado da interface para `isListening = false` e status `○ Interrompido` (cor de aviso).
   - Altera o ícone do botão para `▶️` com tooltip "Retomar transcrição".
3. Se pausado (`isListening === false`):
   - Invoca o comando Tauri `start_audio_capture` com o dispositivo persistido.
   - Atualiza o estado da interface para `isListening = true` e status `○ Aguardando fala`.
   - Altera o ícone do botão para `⏸️` com tooltip "Interromper transcrição".

## Contrato 3: Renderização de Markdown no HUD

- **Tipo:** Renderização React com `react-markdown` e `remark-gfm`
- **Componente:** `MarkdownViewer`

**Fluxo de Sucesso:**
1. Ao receber respostas da LLM disparadas em modo inline (`displayMode === "inline"`) ou no popup acoplado (`displayMode === "overlay"`), o componente processa o conteúdo via Markdown AST.
2. Blocos de código são renderizados com fonte monospace, identificação da sintaxe/linguagem e botão interativo de cópia para a área de transferência.
3. Negrito, itálico, listas, tabelas e links são formatados preservando o contraste e a transparência do HUD flutuante.
