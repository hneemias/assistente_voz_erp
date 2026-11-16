# INVENTÁRIO DE INTEGRAÇÃO REST DO ERP (INOVAR ASSISTENTE DE VOZ)

Este documento define formalmente todas as operações consumidas pelo **Assistente de Voz LiveKit**, seus métodos HTTP, estruturas de requisição/resposta, autenticação e status atual de homologação com o backend real do ERP (Node.js + Express).

> **Princípio Arquitetural:** O assistente de voz funciona como uma camada de inteligência conversacional hands-free. A fonte de verdade das regras de negócio, cálculos, persistência e validação é exclusivamente o seu ERP através destas APIs REST. Nenhuma operação de escrita é efetuada no banco de dados diretamente pelo assistente.

---

## 1. Configuração e Autenticação

- **Arquivo Centralizador de Rotas:** [`apps/agent/src/config/erp-endpoints.ts`](file:///d:/Install/Hneemias/projetos/inovar_assistente_voz/apps/agent/src/config/erp-endpoints.ts)
- **Variáveis de Ambiente:**
  - `ERP_MODE`: `'mock'` (ambiente de desenvolvimento seguro) ou `'live'` (produção conectado ao seu ERP)
  - `ERP_API_BASE_URL`: URL base do seu servidor Express (ex: `http://localhost:4000/api/v1`)
  - `ERP_AUTH_TYPE`: `'bearer'` | `'api-key'` | `'basic'`
  - `ERP_API_TOKEN`: Token ou chave de API do ERP
  - `ERP_API_TIMEOUT_MS`: Tempo limite em milissegundos (padrão: `8000`)

---

## 2. Tabela de Mapeamento das 15 Operações

| Operação | Método | Endpoint no ERP | Parâmetros | Status Atual | Requer Confirmação Prévia? |
| :--- | :---: | :--- | :--- | :---: | :---: |
| `consultar_os` | **GET** | `/ordens-servico/:numero_os` | `numero_os` (path) | `PENDING_CONTRACT` | **Não** (Leitura direta) |
| `listar_os_abertas` | **GET** | `/ordens-servico/abertas` | `status`, `aberta_ha_mais_de_dias`, `aguardando_produto` | `PENDING_CONTRACT` | **Não** (Leitura direta) |
| `listar_todas_os` | **GET** | `/ordens-servico` | `status`, `cliente`, `limite` | `PENDING_CONTRACT` | **Não** (Leitura direta) |
| `consultar_detalhes_os` | **GET** | `/ordens-servico/:numero_os/detalhes`| `numero_os` (path) | `PENDING_CONTRACT` | **Não** (Leitura direta) |
| `listar_produtos` | **GET** | `/produtos` | `categoria`, `estoque_abaixo_de`, `apenas_em_estoque` | `PENDING_CONTRACT` | **Não** (Leitura direta) |
| `buscar_produto_por_nome`| **GET** | `/produtos/busca` | `q` (query string com termo falado) | `PENDING_CONTRACT` | **Não** (Leitura direta) |
| `consultar_produto_por_codigo`| **GET** | `/produtos/codigo/:codigo` | `codigo` (path) | `PENDING_CONTRACT` | **Não** (Leitura direta) |
| `consultar_estoque` | **GET** | `/produtos/:produto_id/estoque` | `produto_id` (path) | `PENDING_CONTRACT` | **Não** (Leitura direta) |
| `consultar_total_os` | **GET** | `/ordens-servico/:numero_os/totais` | `numero_os` (path) | `PENDING_CONTRACT` | **Não** (Leitura direta) |
| `listar_itens_os` | **GET** | `/ordens-servico/:numero_os/itens` | `numero_os` (path) | `PENDING_CONTRACT` | **Não** (Leitura direta) |
| `alterar_status_os` | **PATCH** | `/ordens-servico/:numero_os/status` | Body: `{ "status": "string" }` | `PENDING_CONTRACT` | **SIM (Obrigatória)** |
| `adicionar_produto_os`| **POST** | `/ordens-servico/:numero_os/produtos`| Body: `{ "produto_id": "string", "quantidade": number }` | `PENDING_CONTRACT` | **SIM (Obrigatória)** |
| `remover_produto_os` | **DELETE**| `/ordens-servico/:numero_os/produtos/:item_id` | `numero_os`, `item_id` (path) | `PENDING_CONTRACT` | **SIM (Obrigatória)** |
| `adicionar_servico_os`| **POST** | `/ordens-servico/:numero_os/servicos`| Body: `{ "servico_id": "string", "quantidade": number }` | `PENDING_CONTRACT` | **SIM (Obrigatória)** |
| `remover_servico_os` | **DELETE**| `/ordens-servico/:numero_os/servicos/:item_id` | `numero_os`, `item_id` (path) | `PENDING_CONTRACT` | **SIM (Obrigatória)** |

---

## 3. Contratos Esperados das APIs (Exemplos)

### 3.1. `consultar_os` (GET `/ordens-servico/3030`)
- **Headers:** `Authorization: Bearer <TOKEN>`, `Accept: application/json`
- **Exemplo de Resposta (200 OK):**
```json
{
  "numero_os": "3030",
  "cliente_nome": "Carlos Eduardo Mendes",
  "veiculo_equipamento": "VW Gol 1.6 MSI - Placa ABC-3030",
  "status": "em_andamento",
  "data_abertura": "2026-11-14T08:30:00-03:00",
  "dias_aberta": 2,
  "aguardando_produto": false,
  "valor_total": 517.00,
  "quantidade_itens": 4
}
```

### 3.2. `buscar_produto_por_nome` (GET `/produtos/busca?q=oleo+5w30`)
- **Exemplo de Resposta (200 OK):**
```json
[
  {
    "produto_id": "PROD-201",
    "codigo": "201",
    "nome": "Óleo Motor 5W30 Sintético Castrol Magnatec",
    "categoria": "Lubrificantes",
    "unidade": "L",
    "preco_venda": 58.00,
    "estoque_atual": 24,
    "estoque_minimo": 10,
    "ativo": true
  },
  {
    "produto_id": "PROD-202",
    "codigo": "202",
    "nome": "Óleo Motor 5W30 Sintético Mobil Super",
    "categoria": "Lubrificantes",
    "unidade": "L",
    "preco_venda": 52.00,
    "estoque_atual": 12,
    "estoque_minimo": 8,
    "ativo": true
  }
]
```

### 3.3. `alterar_status_os` (PATCH `/ordens-servico/3030/status`)
- **Headers:** `Idempotency-Key: idem-...`
- **Corpo da Requisição:**
```json
{
  "status": "concluida"
}
```
- **Exemplo de Resposta (200 OK):**
```json
{
  "numero_os": "3030",
  "cliente_nome": "Carlos Eduardo Mendes",
  "status": "concluida",
  "valor_total": 517.00,
  "quantidade_itens": 4
}
```

### 3.4. `adicionar_produto_os` (POST `/ordens-servico/3030/produtos`)
- **Headers:** `Idempotency-Key: idem-...`
- **Corpo da Requisição:**
```json
{
  "produto_id": "PROD-101",
  "quantidade": 2
}
```
- **Exemplo de Resposta (201 Created):**
```json
{
  "item_adicionado": {
    "item_id": "ITEM-P-901",
    "produto_id": "PROD-101",
    "codigo": "101",
    "nome": "Filtro de Óleo Tecfil PSL55",
    "unidade": "UN",
    "quantidade": 2,
    "preco_unitario": 45.00,
    "subtotal": 90.00
  },
  "totais": {
    "numero_os": "3030",
    "total_produtos": 322.00,
    "total_servicos": 240.00,
    "desconto": 0,
    "valor_total": 562.00,
    "moeda": "BRL"
  }
}
```

---

## 4. Como homologar suas rotas reais

Quando você for conectar ao seu backend Express real:
1. Abra `apps/agent/src/config/erp-endpoints.ts`.
2. Ajuste o `pathTemplate` para coincidir com as suas rotas no Express (ex: se no seu ERP a rota for `/os/:id` em vez de `/ordens-servico/:numero_os`, basta alterar o template).
3. Mude o campo `contractStatus` da operação de `'PENDING_CONTRACT'` para `'CONFIGURED'`.
4. Defina no seu `.env`: `ERP_MODE=live` e `ERP_API_BASE_URL=http://seu-servidor-erp:porta/api`.

---

## 5. Payload Real de Produção Mapeado (Extraído da API Real)

O assistente foi alimentado com o payload real extraído diretamente da API de produção do sistema (26 Ordens de Serviço reais do período de 10/11/2026 a 16/11/2026), persistido no mock store em [`apps/agent/src/integrations/erp/mock-data/real-erp-orders.json`](file:///d:/Install/Hneemias/projetos/inovar_assistente_voz/apps/agent/src/integrations/erp/mock-data/real-erp-orders.json).

### 5.1. Estrutura do Envelope da API Real
```json
{
  "id": "26a42bfc-0857-4038-b264-25ef8d250cdc",
  "type": "SERVICE_ORDERS",
  "params": {
    "start": "10/11/2026",
    "end": "16/11/2026"
  },
  "status": "COMPLETED",
  "result": [
    {
      "numero": "4345",
      "tipo": "OS",
      "data": "16/11/2026 14:08:16",
      "cliente": "JEANE APARECIDA PIMENTA",
      "totalOS": 0,
      "vendedor": "60,00",
      "situacao": "Em aberto\n                                                Em aberto",
      "id": "4398",
      "codigoCliente": "1980",
      "cpfCnpj": "01429364130",
      "endereco": "RUA 16 QUADRA 08 LOTE 19, nº S/N, VALE DO SOL - Edéia, GO",
      "observacao": "VERIFICAR PROBLEMA INTERNET\nJAENE\nRUA 16 N QD 08 LT 19 VALE DO SOL",
      "equipamento": "",
      "modelo": "",
      "marcaEquipamento": "",
      "nSerie": "",
      "itens": [
        {
          "seq": "1",
          "codigo": "663",
          "produtoServico": "PRESTACAO DE SERVICOS",
          "valorUnitario": 60,
          "quantidade": 1
        }
      ]
    }
  ]
}
```

### 5.2. De-Para dos Campos do ERP Real para o Assistente

| Campo do ERP Real | Campo no Assistente | Tratamento / Normalização | Exemplo Real |
| :--- | :--- | :--- | :--- |
| `numero` | `numero_os` | String limpa | `"4345"`, `"4344"`, `"4340"` |
| `cliente` | `cliente_nome` | String limpa | `"JEANE APARECIDA PIMENTA"` |
| `situacao` | `status` | Sanitização de quebras de linha e mapeamento | `"Em aberto\n Em aberto"` -> `'aberta'`, `"Concluido"` -> `'concluida'` |
| `vendedor` | `valor_total` | Parsing monetário brasileiro (moeda BRL) | `"60,00"` -> `60.00`, `"1.831,00"` -> `1831.00` |
| `data` | `data_abertura` | Parsing DD/MM/YYYY HH:mm:ss -> ISO-8601 | `"16/11/2026 14:08:16"` -> `"2026-11-16T14:08:16-03:00"` |
| `equipamento` | `equipamento` | Tipo do equipamento | `"IMPRESSORA"`, `"NOTEBOOK"`, `"DESKTOP"` |
| `modelo` | `modelo` | Modelo do aparelho | `"L3250"`, `"P112F"`, `"UNIQUE S2660"` |
| `marcaEquipamento` | `marca_equipamento` | Fabricante | `"EPSON"`, `"DELL"`, `"HP"`, `"HAYOM"` |
| `nSerie` | `numero_serie` | Número de série | `"XAAB493618"`, `"ST:4YPR244"` |
| `observacao` | `observacoes` | Descrição do problema / defeito | Ex: `"VERIFICAR PROBLEMA INTERNET..."` |
| `itens[].produtoServico` | `nome` / `descricao` | Classificação entre Produto e Serviço | `"PRESTACAO DE SERVICOS"` (SRV), `"LICENÇA ANTIVIRUS KASPERSKY"` (PROD) |
