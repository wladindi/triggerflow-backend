// ─────────────────────────────────────────────
// WHATSAPP CLOUD API WRAPPER
// Meta Graph API v21.0 — WhatsApp Business
// Docs: developers.facebook.com/docs/whatsapp
// ─────────────────────────────────────────────

const BASE_URL = 'https://graph.facebook.com/v21.0'

// Phone Number ID vem do painel do Meta Business
// (diferente do número de telefone em si)
function getPhoneNumberId(userId) {
  // Em produção: buscar do banco por userId
  // Para MVP: usar variável de ambiente
  return process.env.WHATSAPP_PHONE_NUMBER_ID
}

function getToken(userId) {
  // Em produção: buscar token do banco por userId
  return process.env.WHATSAPP_ACCESS_TOKEN
}

async function call(phoneNumberId, token, path, options = {}) {
  const url = `${BASE_URL}/${phoneNumberId}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const data = await res.json()

  if (!res.ok || data.error) {
    const msg = data.error?.message ?? `HTTP ${res.status}`
    throw new Error(`WhatsApp API: ${msg}`)
  }

  return data
}

// ─────────────────────────────────────────────
export const whatsappAPI = {

  // ── 1. Enviar mensagem de texto simples ────
  async sendText(to, text, userId) {
    const phoneNumberId = getPhoneNumberId(userId)
    const token = getToken(userId)

    return call(phoneNumberId, token, '/messages', {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizePhone(to),
        type: 'text',
        text: {
          preview_url: false,
          body: text,
        },
      },
    })
  },

  // ── 2. Enviar documento (PDF, e-book, etc) ─
  async sendDocument(to, { url, filename, caption }, userId) {
    const phoneNumberId = getPhoneNumberId(userId)
    const token = getToken(userId)

    return call(phoneNumberId, token, '/messages', {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizePhone(to),
        type: 'document',
        document: {
          link: url,       // URL pública do arquivo (ex: Supabase Storage)
          filename,        // Nome exibido no WhatsApp
          caption,         // Legenda opcional abaixo do arquivo
        },
      },
    })
  },

  // ── 3. Enviar imagem ───────────────────────
  async sendImage(to, { url, caption }, userId) {
    const phoneNumberId = getPhoneNumberId(userId)
    const token = getToken(userId)

    return call(phoneNumberId, token, '/messages', {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizePhone(to),
        type: 'image',
        image: { link: url, caption },
      },
    })
  },

  // ── 4. Enviar mensagem com botões (CTA) ────
  async sendButtons(to, { body, buttons }, userId) {
    const phoneNumberId = getPhoneNumberId(userId)
    const token = getToken(userId)

    // Máximo 3 botões por mensagem (limite da Meta)
    if (buttons.length > 3) throw new Error('Máximo 3 botões por mensagem')

    return call(phoneNumberId, token, '/messages', {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: sanitizePhone(to),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: buttons.map((btn, i) => ({
              type: 'reply',
              reply: {
                id: btn.id ?? `btn_${i}`,
                title: btn.title.slice(0, 20), // Max 20 chars
              },
            })),
          },
        },
      },
    })
  },

  // ── 5. Marcar mensagem como lida ──────────
  async markAsRead(messageId, userId) {
    const phoneNumberId = getPhoneNumberId(userId)
    const token = getToken(userId)

    return call(phoneNumberId, token, '/messages', {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
    })
  },

  // ── 6. Obter perfil do usuário ─────────────
  async getUserProfile(phone, userId) {
    const phoneNumberId = getPhoneNumberId(userId)
    const token = getToken(userId)

    return call(phoneNumberId, token,
      `/contacts?phones=${encodeURIComponent(phone)}`, {})
  },

  // ── 7. Fazer upload de mídia (para envio) ──
  async uploadMedia(fileBuffer, mimeType, userId) {
    const phoneNumberId = getPhoneNumberId(userId)
    const token = getToken(userId)

    const form = new FormData()
    form.append('file', new Blob([fileBuffer], { type: mimeType }))
    form.append('messaging_product', 'whatsapp')
    form.append('type', mimeType)

    const res = await fetch(`${BASE_URL}/${phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message)
    return data.id // media_id para usar nas mensagens
  },
}

// ─────────────────────────────────────────────
// HELPER — normalizar número de telefone
// WhatsApp exige formato E.164: 5511999999999
// ─────────────────────────────────────────────
function sanitizePhone(phone) {
  // Remove tudo que não for dígito
  const digits = phone.replace(/\D/g, '')

  // Adiciona código do Brasil se não tiver
  if (digits.length === 11 && digits.startsWith('0')) {
    return '55' + digits.slice(1)
  }
  if (digits.length === 11 || digits.length === 10) {
    return '55' + digits
  }

  return digits
}
