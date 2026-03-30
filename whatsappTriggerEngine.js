import { whatsappAPI } from './whatsappAPI.js'
import { aiFlowEngine } from '../src/aiFlowEngine.js'
import { db } from '../src/database.js'

// Estado de conversas ativas em memória
// Em produção: substituir por Redis para sobreviver a restarts
const activeConversations = new Map()

// ─────────────────────────────────────────────
// MOTOR DE GATILHOS — WHATSAPP
// ─────────────────────────────────────────────
export const whatsappTriggerEngine = {

  // ── Processar mensagem de texto recebida ──
  async process({ platform, messageText, userId, username, phoneNumberId }) {
    try {
      // 1. Verificar se há conversa ativa com este usuário
      const activeConv = activeConversations.get(userId)
      if (activeConv) {
        // Continuar fluxo existente com a resposta do usuário
        return await this.continueFlow(userId, username, messageText, phoneNumberId)
      }

      // 2. Buscar gatilhos de WhatsApp ativos (sem postId fixo — são por conta)
      const triggers = await db.getWhatsAppTriggers(phoneNumberId)
      if (!triggers.length) return

      // 3. Verificar se algum gatilho bate com a mensagem
      const matched = findMatch(messageText, triggers)
      if (!matched) {
        console.log(`ℹ️  Nenhum gatilho WA para: "${messageText}"`)
        return
      }

      console.log(`🎯 Gatilho WA ativado: "${matched.keyword}" por ${username}`)

      // 4. Anti-spam: verificar se já enviou
      const alreadySent = await db.hasFlowBeenSentToUser(userId, matched.id)
      if (alreadySent) {
        console.log(`⏭️  Fluxo já enviado para ${userId}`)
        return
      }

      // 5. Buscar o fluxo associado
      const flow = await db.getFlowById(matched.flowId)

      // 6. Iniciar o fluxo
      if (flow.aiEnabled) {
        await this.startAIFlow({ userId, username, flow, phoneNumberId })
      } else {
        await this.sendManualFlow({ userId, username, flow, phoneNumberId })
      }

      // 7. Registrar envio
      await db.markFlowAsSent(userId, matched.id)
      await db.logEvent({
        triggerId: matched.id,
        instagramUserId: userId,
        eventType: 'flow_sent',
        metadata: { platform: 'whatsapp', keyword: matched.keyword },
      })

    } catch (err) {
      console.error('❌ Erro no motor WA:', err)
    }
  },

  // ── Iniciar fluxo com IA ──────────────────
  async startAIFlow({ userId, username, flow, phoneNumberId }) {
    const firstMessage = await aiFlowEngine.generatePersonalizedMessage({
      username,
      flowGoal: flow.goal,
      productName: flow.productName,
      productDescription: flow.productDescription,
    })

    await whatsappAPI.sendText(userId, firstMessage, null)

    // Salvar estado da conversa
    activeConversations.set(userId, {
      flow,
      phoneNumberId,
      history: [{ role: 'assistant', content: firstMessage }],
      startedAt: Date.now(),
    })

    // Auto-expirar conversa após 24h (janela do WhatsApp)
    setTimeout(() => activeConversations.delete(userId), 24 * 60 * 60 * 1000)
  },

  // ── Continuar conversa com IA ─────────────
  async continueFlow(userId, username, userMessage, phoneNumberId) {
    const conv = activeConversations.get(userId)
    if (!conv) return

    conv.history.push({ role: 'user', content: userMessage })

    const response = await aiFlowEngine.generateConversationalResponse({
      username,
      flowGoal: conv.flow.goal,
      productName: conv.flow.productName,
      productDescription: conv.flow.productDescription,
      conversationHistory: conv.history,
    })

    await whatsappAPI.sendText(userId, response, null)
    conv.history.push({ role: 'assistant', content: response })

    // Atualizar timestamp de atividade
    conv.startedAt = Date.now()
  },

  // ── Fluxo manual (sem IA) ─────────────────
  async sendManualFlow({ userId, username, flow, phoneNumberId }) {
    for (const message of flow.messages) {
      if (message.delaySeconds > 0) {
        await sleep(message.delaySeconds * 1000)
      }

      const text = message.text
        .replace('{{username}}', username)
        .replace('{{first_name}}', username.split(' ')[0])

      // Verificar se é uma mensagem especial
      if (message.type === 'document') {
        await whatsappAPI.sendDocument(userId, {
          url: message.documentUrl,
          filename: message.documentName ?? 'arquivo.pdf',
          caption: text,
        }, null)
      } else if (message.type === 'image') {
        await whatsappAPI.sendImage(userId, {
          url: message.imageUrl,
          caption: text,
        }, null)
      } else if (message.buttons?.length) {
        await whatsappAPI.sendButtons(userId, {
          body: text,
          buttons: message.buttons,
        }, null)
      } else {
        await whatsappAPI.sendText(userId, text, null)
      }

      console.log(`📨 WA enviado para ${username}: "${text.slice(0, 50)}..."`)
    }
  },

  // ── Processar clique em botão ─────────────
  async processButtonReply({ userId, username, buttonId, buttonTitle, phoneNumberId }) {
    const conv = activeConversations.get(userId)
    if (!conv) return

    // Tratar o clique como uma resposta de texto normal
    await this.continueFlow(userId, username, buttonTitle, phoneNumberId)
  },

  // ── Processar mídia recebida ──────────────
  async processMedia({ userId, username, mediaType, phoneNumberId }) {
    const conv = activeConversations.get(userId)
    if (!conv) return

    const message = `[${mediaType} recebido]`
    await this.continueFlow(userId, username, message, phoneNumberId)
  },
}

// ─────────────────────────────────────────────
// MATCH DE GATILHOS (igual ao Instagram)
// ─────────────────────────────────────────────
function findMatch(text, triggers) {
  const normalized = text.toLowerCase().trim()

  for (const trigger of triggers) {
    const keyword = trigger.keyword.toLowerCase().trim()

    switch (trigger.matchType) {
      case 'exact':
        if (normalized === keyword) return trigger
        break
      case 'contains':
        if (normalized.includes(keyword)) return trigger
        break
      case 'starts_with':
        if (normalized.startsWith(keyword)) return trigger
        break
      case 'regex':
        try {
          if (new RegExp(trigger.keyword, 'i').test(text)) return trigger
        } catch {}
        break
    }
  }

  return null
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
