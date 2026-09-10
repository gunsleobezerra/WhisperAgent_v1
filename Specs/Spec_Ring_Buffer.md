---
tags:
  - projeto/whisper-agent
  - spec
  - sdd
---
## 🔗 Documentos de Requisitos
- [[1. Visao Geral e Arquitetura]]
- [[5. Otimizacao de Memoria e Contexto]]

# Funcionalidade: Hot Ring Buffer (Memória RAM)

**Objetivo:** O motor de memória gerencia um `Ring Buffer` em RAM para os últimos 30-60 segundos de fala, mantendo concorrência segura com Mutex sem bloquear a thread de inferência.

## Contrato 1: Estrutura em Memória (RAM)
- **Tipo:** Estrutura de Dados Concorrente em Rust (`Arc<Mutex<VecDeque<AudioSegment>>>`)
- **Nome:** `HotRingBuffer`

**Payload de Entrada (Inserção de Fala):**
```rust
pub struct AudioSegment {
    pub id: String,          // UUIDv4
    pub timestamp: u64,      // Unix Epoch (milissegundos)
    pub text: String,        // Transcrição bruta higienizada
    pub duration_ms: u32,
}
```

**Fluxo de Sucesso (Inserção e Limpeza):**
1. O worker de STT recebe uma transcrição válida e instancia um `AudioSegment`.
2. A thread adquire o lock do `HotRingBuffer`.
3. Adiciona o `AudioSegment` ao final do `VecDeque` via `push_back`.
4. Percorre o início da fila via `pop_front` repetidas vezes e remove itens cujo `timestamp` é inferior a `timestamp_atual - 60000` (60 segundos).
5. Move os itens expirados para o channel MPSC do `Rolling Summarizer`.
6. Libera o lock de forma rápida.

**Casos de Falha:**
- `Erro de Concorrência (PoisonError)`: Uma thread anterior entrou em pânico enquanto segurava o lock. O sistema **entra em panic imeditamente** com a mensagem "FATAL: RingBuffer Mutex poisoned", forçando o supervisor do Tauri a reiniciar o worker de STT.

