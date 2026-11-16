# ARQUITETURA DO SISTEMA: INOVAR ASSISTENTE DE VOZ PARA ERP

## 1. Visão Geral

O sistema é uma camada independente de conversação por voz e inteligência artificial voltada para operação de ERP em bancada (hands-free). O operador de bancada conversa em linguagem natural em português brasileiro através de um microfone conectado à interface web, e o assistente consulta e executa comandos diretamente no backend REST do ERP existente.

```
+-------------------------------------------------------------------------------------------------+
|                                    OPERADOR DE BANCADA (VOZ)                                    |
+-------------------------------------------------------------------------------------------------+
                                                |
                                      Microfone / Alto-falante
                                                v
+-------------------------------------------------------------------------------------------------+
|                       FRONTEND WEB (Vite + React 19 + TypeScript + Tailwind)                   |
|  - LiveKit WebRTC Client (@livekit/components-react)                                            |
|  - RoomAudioRenderer (Áudio do Agente em tempo real)                                            |
|  - BarVisualizer & Indicador de Atividade de Fala (Speaking / Listening / Thinking)            |
|  - Painel de Ordens & Métricas Operacionais                                                     |
|  - ModalConfirm (Regra de segurança contra window.confirm) & Sonner (Toasts)                    |
+-------------------------------------------------------------------------------------------------+
                                                |  (WebRTC Seguro)
                                                v
+-------------------------------------------------------------------------------------------------+
|                           LIVEKIT CLOUD / OSS (Servidor de Tempo Real)                          |
|  - WebRTC Room Transport                                                                        |
|  - Detecção de Interrupções de Fala (Barge-in adaptativo)                                       |
+-------------------------------------------------------------------------------------------------+
                                                |  (Agent Protocol)
                                                v
+-------------------------------------------------------------------------------------------------+
|                    SERVIÇO DO AGENTE DE VOZ (@livekit/agents Node.js 1.10.0)                    |
|  1. Prewarm: Carregamento do modelo Silero VAD no processo pai do worker                        |
|  2. AgentSession: Orquestração do pipeline de áudio                                             |
|     - VAD: Silero VAD                                                                           |
|     - STT: Deepgram Nova-3 / AssemblyAI / OpenAI (pt-BR com keyterms de bancada)                |
|     - LLM: Google Gemini (@livekit/agents-plugin-google) / LiveKit Inference / OpenAI           |
|     - TTS: Cartesia Sonic-3 / ElevenLabs / Google Preview TTS (voz natural pt-BR)               |
|  3. Context Manager:                                                                            |
|     - Gerenciamento de contexto conversacional por sessão (activeOsNumber)                      |
|     - Resolução inteligente de produtos falados (códigos, marcas, especificações)              |
|     - Gate de segurança estrito para operações de escrita (confirmação em 2 etapas)            |
|  4. Tools Layer (15 ferramentas LLM tipadas com Zod):                                          |
|     - 10 ferramentas de consulta (leitura imediata sem confirmação prévia)                      |
|     - 5 ferramentas de alteração (staging de revisão, gating e execução com Idempotency-Key)   |
|  5. Observabilidade & Logs:                                                                     |
|     - Logger estruturado Pino com sanitização de credenciais sensíveis                          |
|     - Métricas operacionais em memória e endpoint /api/metrics                                  |
|  6. Servidor Auxiliar Express (Porta 3001):                                                    |
|     - Emissão segura de Tokens LiveKit com escopo de sala (/api/token)                          |
|     - Healthcheck e mapeamento de contratos (/api/health, /api/erp/mapping)                     |
+-------------------------------------------------------------------------------------------------+
                                                |  (HTTP REST com Headers / Idempotency-Key)
                                                v
+-------------------------------------------------------------------------------------------------+
|                             BACKEND DO ERP (Node.js + Express)                                  |
|  - Fonte oficial de verdade dos dados e regras de negócio                                       |
|  - Banco de Dados Transacional do ERP                                                           |
+-------------------------------------------------------------------------------------------------+
```

---

## 2. Princípios Arquiteturais e Diretrizes de Segurança

1. **Separação Estrita de Responsabilidades:**
   - O modelo de IA interpreta linguagem natural, identifica intenções e extrai parâmetros.
   - O código TypeScript governa a máquina de estados, regras de validação, limites de estoque e controle de confirmação.
2. **Nenhuma Alteração sem Confirmação Prévia:**
   - Operações mutantes (`alterar_status_os`, `adicionar_produto_os`, etc.) realizam primeiro uma fase de revisão (`CONFIRMATION_REQUIRED`), solicitando autorização expressa do usuário em turno posterior.
   - Mesmo que o LLM chame prematuramente uma função com `confirmado_pelo_usuario: true` no mesmo turno, o `context-manager` bloqueia a ação (`SAME_TURN_APPROVAL_FORBIDDEN`).
3. **Resolução de Ambiguidades:**
   - Nomes com múltiplas opções (ex: dois tipos de óleo 5W30) não são selecionados por adivinhação; o assistente devolve `AMBIGUOUS` com os códigos e preços para que o técnico decida.
4. **Proteção contra Timeouts:**
   - Timeouts em operações de escrita nunca sofrem repetição automática (retry) descontrolada, marcando a requisição como inconclusiva (`INCONCLUSIVE_TIMEOUT`) para evitar duplicidade de itens no ERP.
5. **Privacidade de Credenciais:**
   - O frontend nunca recebe tokens administrativos do LiveKit ou do ERP. A autenticação com o ERP ocorre estritamente dentro do backend do agente de voz.
