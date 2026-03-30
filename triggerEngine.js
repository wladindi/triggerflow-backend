import { instagramAPI } from "./instagramAPI.js";
import { aiFlowEngine } from "./aiFlowEngine.js";
import { db } from "./database.js";

// ─────────────────────────────────────────────
// MOTOR DE GATILHOS
// Coração do TriggerFlow — decide o que fazer
// com cada evento recebido
// ─────────────────────────────────────────────
export const triggerEngine = {
  async process(event) {
    const { platform, eventType, commentText, userId, username, postId } =
      event;

    try {
      // 1. Buscar gatilhos cadastrados para este post
      const triggers = await db.getTriggersByPostId(postId, platform);

      if (!triggers.length) {
        console.log(`ℹ️  Nenhum gatilho cadastrado para o post ${postId}`);
        return;
      }

      // 2. Verificar se algum gatilho bate com o comentário
      const matched = findMatchingTrigger(commentText, triggers);

      if (!matched) {
        console.log(`ℹ️  Comentário não ativou nenhum gatilho: "${commentText}"`);
        return;
      }

      console.log(`🎯 Gatilho ativado: "${matched.keyword}" por @${username}`);

      // 3. Verificar se este usuário já recebeu este fluxo (evitar spam)
      const alreadySent = await db.hasFlowBeenSentToUser(userId, matched.id);
      if (alreadySent) {
        console.log(`⏭️  Usuário ${userId} já recebeu este fluxo, pulando`);
        return;
      }

      // 4. Buscar o fluxo de mensagens associado ao gatilho
      const flow = await db.getFlowById(matched.flowId);

      // 5. Disparar o fluxo via IA ou fluxo manual
      if (flow.aiEnabled) {
        await aiFlowEngine.start({ userId, username, flow, platform });
      } else {
        await sendManualFlow({ userId, username, flow, platform });
      }

      // 6. Registrar que o fluxo foi enviado para este usuário
      await db.markFlowAsSent(userId, matched.id);
    } catch (error) {
      console.error("❌ Erro no motor de gatilhos:", error);
    }
  },
};

// ─────────────────────────────────────────────
// MATCH DE GATILHOS
// Compara o comentário com as palavras-chave
// ─────────────────────────────────────────────
function findMatchingTrigger(commentText, triggers) {
  const normalizedComment = commentText.toLowerCase().trim();

  for (const trigger of triggers) {
    const keyword = trigger.keyword.toLowerCase().trim();

    switch (trigger.matchType) {
      case "exact":
        // Comentário precisa ser exatamente a palavra-chave
        if (normalizedComment === keyword) return trigger;
        break;

      case "contains":
        // Comentário precisa conter a palavra-chave
        if (normalizedComment.includes(keyword)) return trigger;
        break;

      case "starts_with":
        // Comentário precisa começar com a palavra-chave
        if (normalizedComment.startsWith(keyword)) return trigger;
        break;

      case "regex":
        // Suporte a regex para casos avançados
        try {
          if (new RegExp(trigger.keyword, "i").test(commentText)) return trigger;
        } catch (e) {
          console.warn(`Regex inválido no gatilho ${trigger.id}:`, e.message);
        }
        break;
    }
  }

  return null;
}

// ─────────────────────────────────────────────
// FLUXO MANUAL (sem IA)
// Envia mensagens pré-definidas em sequência
// ─────────────────────────────────────────────
async function sendManualFlow({ userId, username, flow, platform }) {
  const messages = flow.messages; // array de {text, delaySeconds}

  for (const message of messages) {
    // Aguardar o delay configurado entre mensagens
    if (message.delaySeconds > 0) {
      await sleep(message.delaySeconds * 1000);
    }

    // Substituir variáveis dinâmicas
    const text = message.text
      .replace("{{username}}", username)
      .replace("{{first_name}}", username.split("_")[0]);

    // Enviar via plataforma correta
    if (platform === "instagram") {
      await instagramAPI.sendDirectMessage(userId, text);
    }
    // WhatsApp será adicionado aqui na fase 2

    console.log(`📨 Mensagem enviada para @${username}: "${text.slice(0, 50)}..."`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
