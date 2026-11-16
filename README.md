# Assistente de Voz Inteligente para Operação de ERP — LiveKit

Aplicação profissional independente de assistência por voz hands-free voltada para mecânicos e técnicos em bancada operarem Ordens de Serviço (OS), estoque e catálogo do ERP através de comandos em português brasileiro.

---

## Destaques do Projeto

- **LiveKit Agents SDK Node.js (v1.10.0)** com suporte a interrupções (barge-in) e baixa latência.
- **Suporte Multiprovedor:** Compatibilidade comprovada com **Google Gemini** (`@livekit/agents-plugin-google`), OpenAI e LiveKit Inference.
- **Camada de Ferramentas (15 Tools):** 10 ferramentas de leitura com resposta imediata e 5 ferramentas de mutação com protocolo obrigatório de confirmação em dois turnos.
- **Resolução Inteligente de Peças:** Algoritmo que lida com termos falados, números de código/SKU, marcas, medidas (litros vs unidades) e desambiguação de múltiplos itens semelhantes.
- **Integração REST Segura com ERP:** Arquitetura isolada via `ErpClient`, preparada para receber os endpoints reais do seu ERP sem expor credenciais ao navegador.
- **Interface Web Moderna:** Construída em React 19 + TypeScript + Vite + Tailwind CSS, com componentes nativos do LiveKit, sem uso de `alert()` ou `window.confirm()`.
- **10 Cenários de Teste Vitest Homologados:** Cobrindo todas as regras de segurança, ambiguidades, concorrência e timeouts.

---

## Estrutura do Monorepo

```
inovar_assistente_voz/
├── .agents/skills/            # LiveKit Agent Skills instaladas e ativas
├── apps/
│   ├── agent/                 # Worker do Agente LiveKit + Servidor Express
│   │   ├── src/
│   │   │   ├── agents/        # Definição do ErpVoiceAgent e rotinas de simulação
│   │   │   ├── config/        # Centralização de endpoints do ERP e Provedores de IA
│   │   │   ├── integrations/  # Cliente HTTP do ERP e Store Mock
│   │   │   ├── services/      # Gerenciamento de contexto e resolução de produtos
│   │   │   ├── tools/         # 15 ferramentas do agente (Query e Mutation)
│   │   │   ├── types/         # Definições de tipos da sessão e do ERP
│   │   │   ├── utils/         # Logger estruturado Pino e Métricas
│   │   │   ├── main.ts        # Entrypoint do worker LiveKit
│   │   │   └── server.ts      # Servidor de emissão de Tokens LiveKit
│   │   └── tests/             # Suíte Vitest dos 10 cenários
│   └── web/                   # Interface Web de Bancada (React + Vite + Tailwind)
│       └── src/
│           ├── components/    # Visualizador de áudio, sala de voz e ModalConfirm
│           ├── hooks/         # Hook de polling de status do backend
│           └── services/      # Requisição segura de tokens LiveKit
├── docs/                      # Documentação completa de Arquitetura, Mapeamento e Instalação
├── .env.example               # Template de variáveis de ambiente
└── package.json               # Gerenciador de workspaces npm
```

Consulte [docs/INSTALLATION.md](file:///d:/Install/Hneemias/projetos/inovar_assistente_voz/docs/INSTALLATION.md) para o guia de inicialização e [docs/ERP_API_MAPPING.md](file:///d:/Install/Hneemias/projetos/inovar_assistente_voz/docs/ERP_API_MAPPING.md) para conectar as rotas reais do seu ERP.
