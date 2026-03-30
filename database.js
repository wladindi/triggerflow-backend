import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─────────────────────────────────────────────
// CAMADA DE BANCO DE DADOS (Supabase)
// ─────────────────────────────────────────────

export const db = {
  // ── Gatilhos ───────────────────────────────
  async getTriggersByPostId(postId, platform) {
    const { data, error } = await supabase
      .from("triggers")
      .select("*")
      .eq("post_id", postId)
      .eq("platform", platform)
      .eq("active", true);

    if (error) throw error;
    return data;
  },

  async createTrigger({ userId, postId, keyword, matchType, flowId, platform }) {
    const { data, error } = await supabase
      .from("triggers")
      .insert({
        user_id: userId,
        post_id: postId,
        keyword,
        match_type: matchType,
        flow_id: flowId,
        platform,
        active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // ── Fluxos ─────────────────────────────────
  async getFlowById(flowId) {
    const { data, error } = await supabase
      .from("flows")
      .select("*, flow_messages(*)")
      .eq("id", flowId)
      .single();

    if (error) throw error;

    return {
      ...data,
      messages: data.flow_messages.sort((a, b) => a.step - b.step),
    };
  },

  async createFlow({ userId, name, goal, productName, productDescription, aiEnabled, messages }) {
    // Criar o fluxo
    const { data: flow, error: flowError } = await supabase
      .from("flows")
      .insert({
        user_id: userId,
        name,
        goal,
        product_name: productName,
        product_description: productDescription,
        ai_enabled: aiEnabled,
      })
      .select()
      .single();

    if (flowError) throw flowError;

    // Criar mensagens do fluxo
    if (messages?.length) {
      const { error: msgError } = await supabase.from("flow_messages").insert(
        messages.map((msg, index) => ({
          flow_id: flow.id,
          text: msg.text,
          delay_seconds: msg.delaySeconds || 0,
          step: index + 1,
        }))
      );
      if (msgError) throw msgError;
    }

    return flow;
  },

  // ── Controle de envios (anti-spam) ─────────
  async hasFlowBeenSentToUser(instagramUserId, triggerId) {
    const { data, error } = await supabase
      .from("flow_sends")
      .select("id")
      .eq("instagram_user_id", instagramUserId)
      .eq("trigger_id", triggerId)
      .maybeSingle();

    if (error) throw error;
    return !!data;
  },

  async markFlowAsSent(instagramUserId, triggerId) {
    const { error } = await supabase.from("flow_sends").insert({
      instagram_user_id: instagramUserId,
      trigger_id: triggerId,
      sent_at: new Date().toISOString(),
    });

    if (error) throw error;
  },

  // ── Analytics ──────────────────────────────
  async logEvent({ triggerId, instagramUserId, eventType, metadata }) {
    const { error } = await supabase.from("events").insert({
      trigger_id: triggerId,
      instagram_user_id: instagramUserId,
      event_type: eventType,
      metadata,
    });

    if (error) console.error("Erro ao salvar evento:", error);
  },
};
