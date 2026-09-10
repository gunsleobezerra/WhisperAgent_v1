---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
[[1. Visao Geral e Arquitetura]]
[[2. Interface e Overlay]]

# Funcionalidade: Sistema de Popups do LLM

**Objetivo:** Especificar estritamente a recepção de ações do LLM para exibição configurável (embutida no texto de transcrição, popup flutuante em cantos da tela ou acoplado ao overlay) e emissão de efeito sonoro de notificação personalizável via Web Audio API.

## Contrato 1: Evento de Ação do LLM (Exibição de Popups)

- **Tipo:** IPC Event (Tauri Listen)
- **Nome:** `llm_action_triggered`

**Payload de Entrada:**
```json
{
  "action_id": "string",
  "persona_id": "string",
  "action_type": "string",
  "content": "string",
  "requires_interaction": "boolean"
}
```

**Fluxo de Sucesso:**
1. O Backend despacha `llm_action_triggered` quando uma resposta final do modelo define que um popup precisa ser aberto.
2. O React processa a mensagem. Se `action_type` for estritamente igual a `"popup"`:
   - Se `displayMode === "inline"`, renderiza o balão/card de ação diretamente dentro do histórico de transcrição no Overlay HUD com suporte completo a Markdown (negrito, listas, blocos de código com botão de cópia, links, tabelas).
   - Se `displayMode === "screen_corner"`, despacha `show_corner_popup` com o canto configurado (`top-right`, `top-left`, `bottom-right`, `bottom-left`) para a janela dedicada de popup, renderizando o conteúdo em Markdown.
   - Se `displayMode === "overlay"`, renderiza o popup HUD acoplado ao card principal do overlay com renderização completa em Markdown.
3. O conteúdo textual recebido no campo `content` é processado pelo componente `MarkdownViewer` (`react-markdown` + `remark-gfm`), formatando blocos de código com syntax highlighting, tags de linguagem e botão de cópia dedicado.
4. Se `soundEnabled === true`, sintetiza instantaneamente o preset de áudio escolhido (`chime`, `ping`, `bell`, `pop`, `chord`, `subtle`) via Web Audio API no volume selecionado.
5. Se `requires_interaction` for `true`, o componente renderiza botões "Aceitar" e "Negar".

**Casos de Falha:**
- `Ação Incompatível`: `action_type` igual a `"clipboard"` ou `"script"` -> O React ignora a requisição assumindo que o Backend já tomou a providência nativa correspondente.

## Contrato 2: Comando de Resposta de Interação (Aceitar/Negar)

- **Tipo:** Tauri Command (Rust Invoke)
- **Nome:** `submit_popup_interaction`

**Payload de Entrada:**
```json
{
  "action_id": "string",
  "interaction_result": "string" 
}
```
*Nota: `interaction_result` deve ser estritamente `"accepted"` ou `"denied"`.*

**Fluxo de Sucesso:**
1. O usuário clica no botão "Aceitar" ou "Negar" renderizado no componente de popup do React.
2. O React invoca o comando `submit_popup_interaction` passando o `action_id` e o resultado da interação.
3. O Backend recebe a confirmação, aplica a lógica vinculada à ação e instrui o fechamento do popup via estado ou evento subsequente.
4. O React desmonta o componente flutuante associado.

**Sucesso (Saída/Resposta):**
```json
{
  "status": "success"
}
```

## Contrato 3: Controle da Janela de Popup nos Cantos da Tela

- **Tipo:** Tauri Command (Rust Invoke)
- **Nome:** `show_corner_popup` e `hide_corner_popup`

**Payload de Entrada (`show_corner_popup`):**
```json
{
  "corner": "string", // "top-left" | "top-right" | "bottom-left" | "bottom-right"
  "width": 380.0,
  "height": 190.0
}
```

**Fluxo de Sucesso:**
1. O Backend obtém as coordenadas e dimensões da tela pelo monitor primário/ativo.
2. Calcula a posição física considerando DPI, margens e barra de tarefas do Windows.
3. Posiciona a janela `popup` no canto desejado e torna-a visível com `always_on_top(true)`.

## Contrato 4: Sincronização de Configurações de Popups e Sons

- **Tipo:** IPC Event (Tauri Emit / Listen)
- **Nome:** `whisper-popup-settings-changed`

**Payload de Entrada:**
```json
{
  "displayMode": "string", // "inline" | "screen_corner" | "overlay"
  "screenCorner": "string", // "top-right" | "top-left" | "bottom-right" | "bottom-left"
  "soundEnabled": true,
  "soundTone": "string", // "chime" | "ping" | "bell" | "pop" | "chord" | "subtle"
  "soundVolume": 80,
  "autoDismissSeconds": 10
}
```
