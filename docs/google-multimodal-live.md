# Google Gemini Multimodal Live API (Guia de Exploração Futura)

Este documento descreve como funciona a **Gemini Multimodal Live API** e como ela pode ser utilizada com o **LiveKit Agents** no Assistente de Voz ERP.

---

## 1. O que é a Gemini Multimodal Live API?

Diferente do pipeline tradicional de agentes de voz — que é dividido em 3 etapas desconectadas:
1. **STT (Speech-to-Text):** Transcreve o áudio em texto (ex: Deepgram).
2. **LLM:** Recebe o texto e gera a resposta em texto (ex: Gemini Flash).
3. **TTS (Text-to-Speech):** Sintetiza o texto em áudio (ex: Cartesia / ElevenLabs).

A **Multimodal Live API** do Gemini é um modelo **Speech-to-Speech nativo**:
- Ele recebe diretamente o fluxo de áudio PCM do microfone do técnico via WebSocket bidirecional.
- O próprio modelo de rede neural compreende a entonação, pausas, sotaque e intenção diretamente do áudio (sem perda de nuances na transcrição).
- O modelo gera áudio falado de forma nativa e em tempo real, com latência ultrabaixa (~300ms fim a fim).
- Permite **interrupções naturais**: se o usuário começar a falar enquanto o agente está falando, o Gemini detecta a sobreposição na mesma conexão e para imediatamente de falar.
- Suporta **Function Calling (Tools)** em tempo real: o Gemini pode pausar a resposta de áudio, invocar ferramentas como `consultar_os` ou `alterar_status_os`, receber o resultado JSON e continuar falando naturalmente.

---

## 2. Vantagens e Desvantagens para o ERP

### Vantagens:
- **Custo Zero:** Acesso no plano gratuito do Google AI Studio com a mesma `GOOGLE_API_KEY`.
- **Simplificação Máxima de Arquitetura:** Elimina a necessidade de contratar e gerenciar provedores e chaves de STT e TTS separados.
- **Naturalidade de Interrupção:** Menos falsos positivos de silêncio e corte de turnos mais fluido.

### Desvantagens e Cuidados Atuais:
- **Rate Limits do Free Tier:** O Free Tier possui limites de requisições por minuto e sessões concorrentes no Google AI Studio.
- **Latência de Tools:** A execução de tools requer uma troca de mensagens com o Gemini pelo mesmo canal de streaming.
- **Sotaque em Português:** Embora tenha suporte a pt-BR, vozes nativas dedicadas (como Cartesia Heitor) costumam soar mais autênticas para o contexto brasileiro que os modelos gerais de voz do Gemini.

---

## 3. Como Implementar com LiveKit Agents

O pacote `@livekit/agents-plugin-google` já instalado no projeto possui suporte integrado à Live API através do módulo `realtime`:

```typescript
import * as google from '@livekit/agents-plugin-google';
import { voice } from '@livekit/agents';

// Exemplo de configuração com RealtimeModel:
const realtimeModel = new google.realtime.RealtimeModel({
  model: 'models/gemini-2.0-flash-exp', // ou versão mais recente
  apiKey: process.env.GOOGLE_API_KEY,
  voice: 'Kore', // Opções: Puck, Charon, Kore, Fenrir, Aoede
  instructions: 'Você é o assistente técnico do ERP da Inovar Assistência Técnica...',
});

// Na sessão do LiveKit:
const session = new voice.AgentSession({
  llm: realtimeModel, // Em modo realtime, o modelo unifica LLM, STT e TTS
  // vad e turnHandling nativos integrados
});
```

---

## 4. Modelos e Vozes Suportados no Google AI Studio

### Modelos atuais:
- `gemini-2.0-flash-exp` (ou versões estáveis derivadas anunciadas no Google AI Studio)

### Vozes disponíveis (multilíngues):
- `Puck`: Masculina jovem e enérgica.
- `Charon`: Masculina grave e séria.
- `Kore`: Feminina suave e acolhedora.
- `Fenrir`: Masculina encorpada e rápida.
- `Aoede`: Feminina articulada e profissional.

---

## 5. Quando migrar para esta abordagem?
Recomenda-se explorar esta arquitetura caso:
1. Você queira simplificar a stack para uma única chave de API (Google AI Studio).
2. Deseje que o técnico possa interromper o robô no meio de uma frase com altíssima reatividade.
3. Não queira gerenciar contas separadas no Deepgram / Cartesia.
