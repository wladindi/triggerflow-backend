import express from "express";
import crypto from "crypto";
import { triggerEngine } from "./triggerEngine.js";
import { instagramAPI } from "./instagramAPI.js";

const app = express();

// Raw body needed for signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ─────────────────────────────────────────────
// 1. WEBHOOK VERIFICATION (GET)
// Instagram bate aqui quando você cadastra o webhook
// ─────────────────────────────────────────────
app.get("/webhook/instagram", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Webhook verificado com sucesso");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Falha na verificação do webhook");
  return res.sendStatus(403);
});

// ─────────────────────────────────────────────
// 2. RECEBIMENTO DE EVENTOS (POST)
// Comentários novos chegam aqui em tempo real
// ─────────────────────────────────────────────
app.post("/webhook/instagram", async (req, res) => {
  // Verificar assinatura da Meta para segurança
  if (!verifySignature(req)) {
    console.warn("❌ Assinatura inválida — possível requisição falsa");
    return res.sendStatus(401);
  }

  const body = req.body;

  if (body.object !== "instagram") {
    return res.sendStatus(404);
  }

  // Confirmar recebimento imediatamente (Instagram exige resposta em < 5s)
  res.sendStatus(200);

  // Processar eventos de forma assíncrona
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      await processChange(change);
    }
  }
});

// ─────────────────────────────────────────────
// PROCESSAMENTO DE MUDANÇAS
// ─────────────────────────────────────────────
async function processChange(change) {
  const { field, value } = change;

  // Evento de comentário em post
  if (field === "comments") {
    await handleNewComment(value);
  }

  // Evento de menção em story
  if (field === "mentions") {
    console.log("📸 Menção em story recebida:", value);
    // TODO: implementar gatilhos para stories
  }
}

async function handleNewComment(comment) {
  const {
    id: commentId,
    text,
    from,
    media: { id: mediaId },
    timestamp,
  } = comment;

  console.log(`💬 Novo comentário de @${from.username}: "${text}"`);

  // Passar para o motor de gatilhos
  await triggerEngine.process({
    platform: "instagram",
    eventType: "comment",
    commentId,
    commentText: text,
    userId: from.id,
    username: from.username,
    postId: mediaId,
    timestamp,
  });
}

// ─────────────────────────────────────────────
// VERIFICAÇÃO DE ASSINATURA (SEGURANÇA)
// ─────────────────────────────────────────────
function verifySignature(req) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.META_APP_SECRET)
      .update(req.rawBody)
      .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 TriggerFlow rodando na porta ${PORT}`);
  console.log(`📡 Webhook: POST /webhook/instagram`);
});

export default app;
