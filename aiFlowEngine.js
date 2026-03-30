import { instagramAPI } from "./instagramAPI.js";

// ─────────────────────────────────────────────
// MOTOR DE IA
// Usa Claude para dois cenários:
// 1. Gerar fluxo automaticamente a partir do objetivo
// 2. Responder de forma inteligente dentro do fluxo
// ─────────────────────────────────────────────

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

export const aiFlowEngine = {
  // ── Iniciar fluxo com IA ───────────────────
  async start({ userId, username, flow, platform }) {
    console.log(`🤖 Iniciando fluxo IA para @${username}`);

    // Gerar primeira mensagem personalizada com IA
    const firstMessage = await generatePersonalizedMessage({
      username,
      flowGoal: flow.goal,
      flowContext: flow.context,
      productName: flow.productName,
      productDescription: flow.productDescription,
    });

    // Enviar primeira mensagem
    if (platform === "instagram") {
      await instagramAPI.sendDirectMessage(userId, firstMessage);
    }

    // Salvar estado da conversa para continuar depois
    // (quando o usuário responder ao direct)
    await saveConversationState(userId, flow, [
      { role: "assistant", content: firstMessage },
    ]);
  },

  // ── Continuar conversa quando usuário responde ──
  async continueConversation({ userId, username, userMessage, platform }) {
    const state = await loadConversationState(userId);
    if (!state) return; // Nenhum fluxo ativo

    // Adicionar mensagem do usuário ao histórico
    state.history.push({ role: "user", content: userMessage });

    // Gerar resposta inteligente com IA
    const aiResponse = await generateConversationalResponse({
      username,
      flowGoal: state.flow.goal,
      productName: state.flow.productName,
      productDescription: state.flow.productDescription,
      conversationHistory: state.history,
    });

    // Enviar resposta
    if (platform === "instagram") {
      await instagramAPI.sendDirectMessage(userId, aiResponse);
    }

    // Atualizar histórico
    state.history.push({ role: "assistant", content: aiResponse });
    await saveConversationState(userId, state.flow, state.history);
  },

  // ── Gerar fluxo completo a partir de objetivo ──
  async generateFlow({ goal, productName, productDescription, tone }) {
    const prompt = `
Você é um especialista em copywriting e vendas pelo Instagram Direct.

Crie um fluxo de mensagens para o seguinte objetivo:
- Objetivo: ${goal}
- Produto/serviço: ${productName}
- Descrição: ${productDescription}
- Tom: ${tone || "amigável e direto"}

Retorne APENAS um JSON válido com esta estrutura:
{
  "messages": [
    {
      "text": "texto da mensagem aqui",
      "delaySeconds": 0,
      "step": 1
    }
  ],
  "goal": "${goal}"
}

Regras:
- Máximo 5 mensagens no fluxo
- Primeira mensagem: boas-vindas personalizada com {{username}}
- Use linguagem natural, não robótica
- Inclua CTA claro na última mensagem
- Mensagens curtas (até 3 parágrafos cada)
`;

    const response = await callClaude(prompt);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      return JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error("IA retornou formato inválido para o fluxo");
    }
  },
};

// ─────────────────────────────────────────────
// FUNÇÕES PRIVADAS
// ─────────────────────────────────────────────

async function generatePersonalizedMessage({ username, flowGoal, productName, productDescription }) {
  const prompt = `
Você é um assistente de vendas via Instagram Direct. Seja natural e amigável.

Escreva UMA mensagem de abertura de conversa para:
- Usuário: @${username}
- Objetivo do fluxo: ${flowGoal}
- Produto: ${productName}
- Sobre o produto: ${productDescription}

Regras:
- Máximo 3 parágrafos curtos
- Tom conversacional, não robótico
- Mencione o username com @
- Não use emojis em excesso (máximo 2)
- Finalize com uma pergunta aberta para engajar
- Responda APENAS com o texto da mensagem, sem aspas ou formatação
`;

  return callClaude(prompt);
}

async function generateConversationalResponse({
  username,
  flowGoal,
  productName,
  productDescription,
  conversationHistory,
}) {
  const historyText = conversationHistory
    .map((m) => `${m.role === "user" ? `@${username}` : "Você"}: ${m.content}`)
    .join("\n\n");

  const prompt = `
Você é um assistente de vendas via Instagram Direct. Seja natural e amigável.

Objetivo da conversa: ${flowGoal}
Produto: ${productName} — ${productDescription}

Histórico da conversa:
${historyText}

Continue a conversa de forma natural. Lembre-se do objetivo: ${flowGoal}.
Responda APENAS com o texto da próxima mensagem, sem aspas ou formatação.
`;

  return callClaude(prompt);
}

async function callClaude(prompt) {
  const response = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Erro na API Claude: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// Estado temporário em memória (em produção: Redis ou Supabase)
const conversationStates = new Map();

async function saveConversationState(userId, flow, history) {
  conversationStates.set(userId, { flow, history, updatedAt: Date.now() });
}

async function loadConversationState(userId) {
  return conversationStates.get(userId) || null;
}
