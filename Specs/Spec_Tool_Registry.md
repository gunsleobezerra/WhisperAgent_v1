---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
## Documentos de Requisitos
- [[1. Visao Geral e Arquitetura]]
- [[4. Integracao LLM e Personas]]

# Funcionalidade: Tool Registry e Invocação Dual-Mode

**Objetivo:** Gerenciar o parsing de intenções de ferramentas (via JSON nativo ou XML) e coordenar o estado de execução, incluindo suspensão para aprovação humana em ações destrutivas.

## Contrato / Interface 1: Parsing e Resolução de Intenção (Dual-Mode Invoker)
- **Tipo:** Rust Struct / Processador Interno
- **Nome:** `process_tool_invocation`

**Payload de Entrada:**
```json
{
  "invocation_id": "string",
  "raw_invocation": "string",
  "format": "json|xml"
}
```

**Fluxo de Sucesso:**
1. Verifica o `format`. Se `json`, faz o parse direto. Se `xml`, aplica regex ou parser estruturado para extrair a tag da ferramenta e argumentos.
2. Identifica o `tool_name` no registro ativo.
3. Valida os argumentos extraídos contra o JSON schema oficial da ferramenta.
4. Consulta a política de segurança da ferramenta para definir se exige intervenção humana.

**Sucesso (Saída/Evento):**
```json
{
  "tool_name": "string",
  "parameters": "object",
  "requires_human_approval": "boolean"
}
```

**Casos de Falha:**
- `Error_Parse_Failed`: Falha ao decodificar a intenção no formato especificado -> Injeta mensagem de erro de formatação para o LLM corrigir.
- `Error_Tool_Unregistered`: Ferramenta não existe no Tool Registry -> Informa ao LLM que a ferramenta não está disponível.

## Contrato / Interface 2: Aprovação Humana e Continuação (Human-in-the-loop)
- **Tipo:** Tauri Command / IPC Event
- **Nome:** `resolve_tool_approval`

**Payload de Entrada:**
```json
{
  "invocation_id": "string",
  "decision": "approve|deny"
}
```

**Fluxo de Sucesso:**
1. Recebe o evento disparado pela interface do usuário com a decisão sobre uma ferramenta pendente.
2. Se `approve`, inicia a execução do script ou comando de sistema correspondente à ferramenta, e captura a saída.
3. Se `deny`, registra a recusa pelo usuário.
4. Retorna a resposta final ou bloqueio como contexto atualizado (Tool Message) para a retomada do LLM.

**Sucesso (Saída/Evento):**
```json
{
  "status": "resolved",
  "llm_resumed": true
}
```

**Casos de Falha:**
- `Error_Invalid_Invocation`: ID de invocação inexistente ou já resolvido -> Descarta o evento.
- `Error_Tool_Execution_Failed`: O script da ferramenta retorna código não-zero ou gera panic -> Informa o erro de execução na Tool Message enviada ao LLM.

