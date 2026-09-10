---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
[[1. Visao Geral e Arquitetura]]
[[2. Interface e Overlay]]

# Funcionalidade: System Tray

**Objetivo:** Prover um ícone na área de notificação (System Tray) para acesso rápido às funções principais do WisperAgent (Configurações, Mudo e Encerrar), mantendo a aplicação operante em background e permitindo controle rápido sem depender da janela principal.

## Contrato / Interface
- **Tipo:** Tauri System Tray & IPC Events
- **Nome:** `whisper-agent-tray`

**Menu Items (IDs):**
1. `settings`: Abre ou foca a janela de configurações da aplicação.
2. `mute`: Alterna o estado de mudo do microfone.
3. `quit`: Encerra a aplicação completamente.

**Fluxo de Sucesso:**
1. A aplicação é inicializada e registra com sucesso o ícone do System Tray no Sistema Operacional.
2. O usuário clica com o botão direito no ícone da bandeja, exibindo o menu de opções.
3. O usuário seleciona um dos itens definidos (`settings`, `mute`, `quit`).
4. O backend em Rust processa o evento de clique interceptando o ID do menu.
5. O sistema executa a ação local no Rust ou despacha um evento IPC para o frontend reagir.

**Eventos e Ações de Sucesso (Por ID):**

- **ID `settings`:**
  - **Ação:** O backend Rust localiza a janela configurada como `settings` (ou a janela principal) e invoca os métodos `show()` e `set_focus()`.
  - **Evento IPC (Disparado para o Frontend):** 
    ```json
    {
      "event": "tray-menu-settings-clicked",
      "payload": null
    }
    ```

- **ID `mute`:**
  - **Ação:** O backend Rust altera o booleano de estado de captação de áudio.
  - **Evento IPC (Disparado para o Frontend):**
    ```json
    {
      "event": "tray-menu-mute-toggled",
      "payload": {
        "is_muted": true // reflete o novo estado após o clique
      }
    }
    ```

- **ID `quit`:**
  - **Ação:** O backend Rust intercepta o clique, salva qualquer estado pendente e invoca a finalização do processo principal via `app.exit(0)`. Não há evento IPC de retorno pois o processo é finalizado.

**Casos de Falha:**
- `Falha na Inicialização do Ícone`: Se o arquivo de ícone (.ico/.png) não for encontrado ou estiver corrompido, a aplicação deve logar erro de inicialização e continuar a execução sem System Tray.
- `Janela Settings Não Encontrada`: Se o ID `settings` for clicado e a janela alvo não existir na pool de janelas do Tauri, o sistema deve recriar a janela usando o builder padrão.
