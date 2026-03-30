// ─────────────────────────────────────────────
// WRAPPER DA API DO INSTAGRAM (Meta Graph API)
// Centraliza todas as chamadas à Meta
// ─────────────────────────────────────────────

const BASE_URL = "https://graph.instagram.com/v21.0";

export const instagramAPI = {
  // ── Enviar mensagem no Direct ──────────────
  async sendDirectMessage(recipientId, text) {
    const response = await fetch(`${BASE_URL}/me/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Erro ao enviar DM: ${JSON.stringify(error)}`);
    }

    return response.json();
  },

  // ── Enviar mensagem com botões (CTA) ───────
  async sendMessageWithButtons(recipientId, text, buttons) {
    const response = await fetch(`${BASE_URL}/me/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text,
              buttons: buttons.map((btn) => ({
                type: btn.type || "web_url",
                title: btn.title,
                url: btn.url,
              })),
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Erro ao enviar botões: ${JSON.stringify(error)}`);
    }

    return response.json();
  },

  // ── Responder comentário publicamente ──────
  async replyToComment(commentId, text) {
    const response = await fetch(`${BASE_URL}/${commentId}/replies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Erro ao responder comentário: ${JSON.stringify(error)}`);
    }

    return response.json();
  },

  // ── Obter informações do usuário ───────────
  async getUserInfo(userId) {
    const response = await fetch(
      `${BASE_URL}/${userId}?fields=name,username,profile_pic`,
      {
        headers: {
          Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Erro ao buscar usuário: ${JSON.stringify(error)}`);
    }

    return response.json();
  },

  // ── Listar posts da conta ──────────────────
  async getAccountPosts(limit = 10) {
    const response = await fetch(
      `${BASE_URL}/me/media?fields=id,caption,media_type,timestamp,permalink&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Erro ao listar posts: ${JSON.stringify(error)}`);
    }

    return response.json();
  },

  // ── Assinar webhook para comentários ───────
  async subscribeToComments(pageId) {
    const response = await fetch(
      `${BASE_URL}/${pageId}/subscribed_apps`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          subscribed_fields: ["comments", "mentions"],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Erro ao assinar webhook: ${JSON.stringify(error)}`);
    }

    console.log("✅ Assinado para receber comentários via webhook");
    return response.json();
  },
};
