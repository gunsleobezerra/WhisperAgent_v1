---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---

[[1. Visao Geral e Arquitetura]]
[[2. Interface e Overlay]]

# Funcionalidade: Infraestrutura Base Tauri (WisperAgent)

**Objetivo:** Estabelecer a configuração inicial, as dependências obrigatórias e a definição estrita das janelas no core do Tauri para garantir o funcionamento determinístico da aplicação e a comunicação correta entre o OS, a interface principal e o overlay invisível.

## Contrato / Interface
- **Tipo:** Configuração de Ambiente / Tauri Core Config
- **Nome:** `TauriInfrastructureSetup`

### Dependências Rust (`Cargo.toml`)
O arquivo `Cargo.toml` do backend Tauri deve incluir estritamente as bibliotecas necessárias para captura de áudio nativo e inferência offline.

**Payload de Entrada (Seção `[dependencies]`):**
```toml
tauri = { version = "2.0.0", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2.0.0"
tauri-plugin-autostart = "2.0.0"
tauri-plugin-fs = "2.0.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["full"] }
cpal = "0.15" # Captura nativa de microfone e loopback
whisper-rs = "0.11" # Binding FFI para whisper.cpp local
reqwest = { version = "0.12", features = ["json"] } # Integração com LLM (Cloud)
```

### Configuração de Janelas (`tauri.conf.json`)
A inicialização do app impõe a criação simultânea da interface de configurações (main) e da janela de feedback rápido (overlay).

**Payload de Entrada (`tauri.conf.json` / `windows`):**
```json
{
  "app": {
    "windows": [
      {
        "title": "WisperAgent Main",
        "label": "main",
        "url": "index.html",
        "width": 800,
        "height": 600,
        "resizable": true,
        "fullscreen": false,
        "visible": false,
        "center": true
      },
      {
        "title": "WisperAgent Overlay",
        "label": "overlay",
        "url": "overlay.html",
        "width": 300,
        "height": 100,
        "resizable": false,
        "fullscreen": false,
        "transparent": true,
        "alwaysOnTop": true,
        "decorations": false,
        "visible": false,
        "skipTaskbar": true,
        "x": 0,
        "y": 0
      }
    ]
  }
}
```

### Permissões e Plugins (Capabilities do OS)
O app requer os seguintes acessos ao Sistema Operacional.
- `microphone`: O app solicita permissão no SO para o `cpal` acessar o input de áudio.
- `global-shortcut`: Permissão para registrar ganchos globais de teclado (ex: `Ctrl + Shift + Espaço`).
- `fs:read` e `fs:write`: Acesso aos diretórios `App Data` (para configuração) e à pasta de cache local para os modelos `.bin` do Whisper.

**Fluxo de Sucesso (Setup Start):**
1. O Tauri inicia e cria o builder (`tauri::Builder::default()`).
2. O sistema inicializa a System Tray e injeta os plugins: `global-shortcut`, `autostart`, `fs`.
3. O Tauri instancia a janela `main` invisível na memória.
4. O Tauri instancia a janela `overlay` invisível, decormless e com transparência, pronta para ser revelada via atalho.
5. O gerenciador de estado (`tauri::State`) injeta a fila do `tokio` e as configurações do `whisper-rs`.
6. O listener de hotkeys entra em repetição bloqueante para interceptar eventos de ativação.

**Casos de Falha:**
- `Erro de Inicialização CPAL`: Dispositivo de áudio indisponível. -> Registra erro no log; o app exibe na tray e na interface `main` o status `"Microfone não encontrado"`. O overlay rejeita a invocação.
- `Falha de Global Shortcut`: O atalho já está em uso pelo sistema operacional. -> Dispara o evento IPC `"shortcut-binding-failed"` e exibe um alerta de SO forçando o usuário a reconfigurar o atalho na janela `main`.
- `Missing Whisper Model`: Arquivo `.bin` do modelo não encontrado na inicialização. -> Configura a flag de estado global como `NeedsDownload`. O backend retorna erro padrão aos comandos de transcrição até que o download termine.
