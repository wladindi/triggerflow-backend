import express from 'express'
import crypto from 'crypto'
import { whatsappTriggerEngine } from './whatsappTriggerEngine.js'
import { whatsappAPI } from './whatsappAPI.js'

const router = express.Router()

// ─────────────────────────────────────────────
// 1. VERIFICAÇÃO DO WEBHOOK (GET)
// Meta bate aqui quando você registra o webhook
// ─────────────────────────────────────────────
router.get('/webhook/whatsapp', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verificado')
    return res.status(200).send(challenge)
  }

  console.warn('❌ Falha na verificação do webhook WhatsApp')
  return res.sendStatus(403)
})

// ─────────────────────────────────────────────
// 2. RECEBIMENTO DE EVENTOS (POST)
// Mensagens chegam aqui em tempo real
// ─────────────────────────────────────────────
router.post('/webhook/whatsapp', async (req, res) => {
  // Verificar assinatura da Meta (segurança)
  if (!verifySignature(req)) {
    console.warn('❌ Assinatura inválida no webhook WhatsApp')
    return res.sendStatus(401)
  }

  const body = req.body
  if (body.object !== 'whatsapp_business_account') {
    return res.sendStatus(404)
  }

  // Confirmar imediatamente (Meta exige < 5s)
  res.sendStatus(200)

  // Processar cada entry de forma assíncrona
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === 'messages') {
        await processMessagesChange(change.value)
      }
    }
  }
})

// ─────────────────────────────────────────────
// PROCESSAMENTO DE MUDANÇAS
// ─────────────────────────────────────────────
async function processMessagesChange(value) {
  const { messages, contacts, metadata } = value

  if (!messages?.length) return

  for (const message of messages) {
    const contact = contacts?.find(c => c.wa_id === message.from)

    const ctx = {
      messageId: message.id,
      from: message.from,           // número E.164: 5511999999999
      name: contact?.profile?.name ?? 'Usuário',
      phoneNumberId: metadata.phone_number_id,
      timestamp: message.timestamp,
    }

    // Marcar como lida
    await whatsappAPI.markAsRead(message.id, null).catch(() => {})

    // Rotear por tipo de mensagem
    switch (message.type) {
      case 'text':
        await handleTextMessage(ctx, message.text.body)
        break

      case 'interactive':
        // Usuário clicou em um botão
        if (message.interactive.type === 'button_reply') {
          await handleButtonReply(ctx, message.interactive.button_reply)
        }
        break

      case 'image':
      case 'document':
      case 'audio':
        // Usuário enviou mídia — registrar e continuar fluxo
        await handleMediaMessage(ctx, message.type)
        break

      default:
        console.log(`📨 Tipo de mensagem não tratado: ${message.type}`)
    }
  }
}

// ─────────────────────────────────────────────
// HANDLERS POR TIPO
// ─────────────────────────────────────────────
async function handleTextMessage(ctx, text) {
  console.log(`💬 WhatsApp de ${ctx.name} (${ctx.from}): "${text}"`)

  await whatsappTriggerEngine.process({
    platform: 'whatsapp',
    eventType: 'message',
    messageId: ctx.messageId,
    messageText: text,
    userId: ctx.from,
    username: ctx.name,
    phoneNumberId: ctx.phoneNumberId,
    timestamp: ctx.timestamp,
  })
}

async function handleButtonReply(ctx, buttonReply) {
  console.log(`🔘 Botão clicado por ${ctx.name}: "${buttonReply.title}" (${buttonReply.id})`)

  await whatsappTriggerEngine.processButtonReply({
    userId: ctx.from,
    username: ctx.name,
    buttonId: buttonReply.id,
    buttonTitle: buttonReply.title,
    phoneNumberId: ctx.phoneNumberId,
  })
}

async function handleMediaMessage(ctx, mediaType) {
  console.log(`📎 Mídia recebida de ${ctx.name}: ${mediaType}`)
  // Continuar fluxo ativo se existir
  await whatsappTriggerEngine.processMedia({ ...ctx, mediaType })
}

// ─────────────────────────────────────────────
// VERIFICAÇÃO DE ASSINATURA
// ─────────────────────────────────────────────
function verifySignature(req) {
  const signature = req.headers['x-hub-signature-256']
  if (!signature) return false

  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(req.rawBody)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  } catch {
    return false
  }
}

export default router
