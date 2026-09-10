---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---

**Relacionados:** [[1. Visao Geral e Arquitetura]] | [[2. Interface e Overlay]]

# Funcionalidade: Roteamento Principal App.tsx

**Objetivo:** Ler o estado do roteador via `window.location.search` na inicialização e decidir deterministicamente qual componente renderizar: a janela de configurações (`<SettingsWindow />`) ou o overlay de captura (`<LiveOverlay />`).

## Contrato / Interface
- **Tipo:** React Component & Custom Hook
- **Nome:** Componente `App`, Hook `useAppRouter`

**Payload de Entrada (URL Search Params):**
A URL de inicialização da janela (injetada pelo backend Tauri) deve conter parâmetros de busca para indicar o contexto.
```json
{
  "window": "'settings' | 'overlay'"
}
```

**Fluxo de Sucesso:**
1. A view principal (`App.tsx`) é montada no DOM pelo ponto de entrada da aplicação.
2. O hook `useAppRouter` invoca a API do navegador para ler `window.location.search`.
3. O hook constrói um objeto `URLSearchParams` para extrair o valor da chave `window`.
4. O componente `App` avalia o valor retornado de forma síncrona:
   - Se a avaliação de `window === 'settings'` for verdadeira, monta e renderiza exclusivamente o componente `<SettingsWindow />`.
   - Se a avaliação de `window === 'overlay'` for verdadeira, monta e renderiza exclusivamente o componente `<LiveOverlay />`.

**Sucesso (Saída/Evento):**
A interface da janela requisitada é renderizada com sucesso, contendo as dependências exatas de seu contexto, mantendo as responsabilidades isoladas por processo/janela do Tauri.

**Casos de Falha e Comportamento de Fallback:**
- `Chave Ausente ou Valor Inválido`: Condição de ausência de `?window=` ou valor não reconhecido (ex: `?window=undefined`, `?window=outra_coisa`) -> **O sistema deve renderizar `<LiveOverlay />`** como rota padrão segura e registrar um aviso no console (`console.warn("Rota de janela desconhecida, caindo para LiveOverlay")`).
- `Exceção de Parse`: Se ocorrer uma falha não antecipada na leitura da URL (ex: malformação extrema da string), capturar o erro e aplicar o fallback para `<LiveOverlay />`.
