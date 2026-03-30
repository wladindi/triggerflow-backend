// ─────────────────────────────────────────────
// TRIGGERFLOW — EMAIL SERVICE COMPLETO
// Powered by Resend (resend.com)
// npm install resend
// ─────────────────────────────────────────────

const RESEND_API = 'https://api.resend.com/emails'
const FROM_NAME  = 'TriggerFlow'
const FROM_EMAIL = 'oi@triggerflow.app'   // domínio verificado no Resend
const FROM       = `${FROM_NAME} <${FROM_EMAIL}>`
const APP_URL    = process.env.FRONTEND_URL ?? 'https://triggerflow.app'

// ── Utilitário de envio ───────────────────────
async function send({ to, subject, html, replyTo }) {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      reply_to: replyTo ?? 'suporte@triggerflow.app',
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`)
  console.log(`📧 E-mail enviado → ${to} | ${subject} | id: ${data.id}`)
  return data
}

// ── Layout base compartilhado ─────────────────
function layout({ preheader = '', body }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>TriggerFlow</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f0eff0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">

<!-- preheader invisível -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}</div>

<!-- wrapper -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0eff0;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <!-- logo -->
  <tr><td style="padding-bottom:20px;text-align:center">
    <div style="display:inline-block;background:#0d0d12;border-radius:12px;padding:14px 20px">
      <span style="font-size:22px;vertical-align:middle">⚡</span>
      <span style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#f5f4f0;vertical-align:middle;margin-left:6px">TriggerFlow</span>
    </div>
  </td></tr>

  <!-- card -->
  <tr><td style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
    ${body}
  </td></tr>

  <!-- footer -->
  <tr><td style="padding:20px 0;text-align:center;font-size:12px;color:#999;line-height:1.6">
    <div>© 2026 TriggerFlow · automação inteligente</div>
    <div style="margin-top:4px">
      <a href="${APP_URL}/privacidade" style="color:#999;text-decoration:none">Privacidade</a> &nbsp;·&nbsp;
      <a href="${APP_URL}/termos" style="color:#999;text-decoration:none">Termos</a> &nbsp;·&nbsp;
      <a href="mailto:suporte@triggerflow.app" style="color:#999;text-decoration:none">Suporte</a>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

// ── Componentes reutilizáveis ─────────────────
function btn(text, url, color = '#0d0d12') {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px auto 0">
    <tr><td style="background:${color};border-radius:8px">
      <a href="${url}" style="display:block;padding:13px 28px;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;white-space:nowrap">${text}</a>
    </td></tr>
  </table>`
}

function divider() {
  return `<tr><td style="padding:0 32px"><hr style="border:none;border-top:1px solid #f0f0f5;margin:0"/></td></tr>`
}

function section(content) {
  return `<tr><td style="padding:32px 32px 0">${content}</td></tr>`
}

function heading(text) {
  return `<h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0d0d12;line-height:1.3">${text}</h1>`
}

function p(text) {
  return `<p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">${text}</p>`
}

function alert(text, color = '#ba7517') {
  const bg = color === '#ba7517' ? '#fff8f0' : color === '#991b1b' ? '#fff1f1' : '#f0fdf4'
  const border = color === '#ba7517' ? '#fed7aa' : color === '#991b1b' ? '#fca5a5' : '#bbf7d0'
  return `<div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:14px 16px;font-size:13px;color:${color};line-height:1.6;margin-bottom:16px">${text}</div>`
}

function steps(items) {
  return `<div style="background:#f9f7ff;border-radius:10px;padding:20px 20px 12px;margin-bottom:20px">
    ${items.map(([num, title, desc]) => `
      <div style="display:flex;gap:12px;margin-bottom:12px;align-items:flex-start">
        <div style="min-width:24px;height:24px;background:#5b3cf5;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;text-align:center;line-height:24px">${num}</div>
        <div>
          <div style="font-size:14px;font-weight:600;color:#0d0d12">${title}</div>
          <div style="font-size:12px;color:#888;margin-top:2px">${desc}</div>
        </div>
      </div>`).join('')}
  </div>`
}

// ─────────────────────────────────────────────
// 1. CONFIRMAÇÃO DE CADASTRO (Supabase Auth)
// Template HTML para colar no Supabase Dashboard
// Auth → Email Templates → Confirm signup
// ─────────────────────────────────────────────
export const SIGNUP_CONFIRMATION_TEMPLATE = layout({
  preheader: 'Confirme seu e-mail para começar a usar o TriggerFlow',
  body: `
    ${section(`
      ${heading('Confirme seu e-mail')}
      ${p('Olá! Obrigado por criar sua conta no TriggerFlow. Clique no botão abaixo para confirmar seu endereço de e-mail e começar a automatizar suas vendas.')}
      ${btn('Confirmar meu e-mail', '{{ .ConfirmationURL }}')}
    `)}
    <tr><td style="padding:20px 32px 0">
      ${alert('Este link expira em 24 horas. Se você não criou uma conta, pode ignorar este e-mail.')}
    </td></tr>
    <tr><td style="padding:0 32px 32px;font-size:12px;color:#aaa">
      Se o botão não funcionar, copie e cole este link no navegador:<br>
      <span style="color:#5b3cf5;word-break:break-all">{{ .ConfirmationURL }}</span>
    </td></tr>
  `
})

// ─────────────────────────────────────────────
// 2. REDEFINIÇÃO DE SENHA (Supabase Auth)
// Template HTML para colar no Supabase Dashboard
// Auth → Email Templates → Reset password
// ─────────────────────────────────────────────
export const RESET_PASSWORD_TEMPLATE = layout({
  preheader: 'Redefinição de senha solicitada para sua conta TriggerFlow',
  body: `
    ${section(`
      ${heading('Redefina sua senha')}
      ${p('Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha.')}
      ${btn('Redefinir minha senha', '{{ .ConfirmationURL }}', '#5b3cf5')}
    `)}
    <tr><td style="padding:20px 32px 0">
      ${alert('Este link é válido por apenas 1 hora por segurança. Se você não solicitou a redefinição, ignore este e-mail — sua senha continua a mesma.')}
    </td></tr>
    <tr><td style="padding:0 32px 32px;font-size:12px;color:#aaa">
      Se o botão não funcionar, copie e cole este link:<br>
      <span style="color:#5b3cf5;word-break:break-all">{{ .ConfirmationURL }}</span>
    </td></tr>
  `
})

// ─────────────────────────────────────────────
// 3. AVISO DE FIM DE TRIAL (3 dias antes)
// Disparado pelo webhook do Stripe:
// customer.subscription.trial_will_end
// ─────────────────────────────────────────────
export async function sendTrialEndingEmail({ to, name, plan, trialEndsAt }) {
  const firstName = name?.split(' ')[0] ?? 'você'
  const date = new Date(trialEndsAt).toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  return send({
    to,
    subject: `⏰ Seu trial termina em 3 dias — ${firstName}, continue automatizando`,
    html: layout({
      preheader: `Seu trial gratuito do TriggerFlow termina ${date}`,
      body: `
        ${section(`
          ${heading(`Seu trial termina em 3 dias, ${firstName}`)}
          ${p(`Seu período gratuito do <strong>TriggerFlow ${plan}</strong> termina na <strong>${date}</strong>.`)}
          ${p('Para continuar usando sem interrupção, você não precisa fazer nada — a cobrança começa automaticamente. Se preferir cancelar, basta acessar o portal de assinatura.')}
          ${steps([
            ['1', 'Manter a assinatura', 'Não faça nada — cobrança automática no fim do trial'],
            ['2', 'Gerenciar pagamento', 'Atualize cartão ou cancele pelo portal abaixo'],
          ])}
          ${btn('Continuar usando o TriggerFlow', `${APP_URL}/dashboard`)}
        `)}
        <tr><td style="padding:16px 32px 0;text-align:center">
          <a href="${APP_URL}/dashboard/plans" style="font-size:13px;color:#888;text-decoration:none">Gerenciar assinatura →</a>
        </td></tr>
        <tr><td style="padding:8px 32px 32px">
          ${alert(`Você ainda tem acesso completo ao plano ${plan} até o fim do trial.`, '#1d9e75')}
        </td></tr>
      `
    })
  })
}

// ─────────────────────────────────────────────
// 4. UPGRADE DE PLANO
// ─────────────────────────────────────────────
export async function sendUpgradeEmail({ to, name, oldPlan, newPlan, nextBillingDate }) {
  const firstName = name?.split(' ')[0] ?? 'você'
  const date = new Date(nextBillingDate).toLocaleDateString('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric'
  })

  const planFeatures = {
    pro: ['15 gatilhos ativos', '5.000 disparos/mês', 'IA com Claude', 'WhatsApp Business', '3 contas Instagram'],
    agency: ['Gatilhos ilimitados', '50.000 disparos/mês', '20 contas Instagram', 'WhatsApp + TikTok', 'API + white-label'],
  }

  const features = planFeatures[newPlan.toLowerCase()] ?? []

  return send({
    to,
    subject: `🚀 Upgrade confirmado — bem-vindo ao ${newPlan}!`,
    html: layout({
      preheader: `Seu upgrade para ${newPlan} foi confirmado`,
      body: `
        ${section(`
          ${heading(`Upgrade confirmado, ${firstName}!`)}
          ${p(`Você migrou do <strong>${oldPlan}</strong> para o <strong>${newPlan}</strong>. Os novos limites já estão ativos na sua conta.`)}
          <div style="background:#f9f7ff;border-radius:10px;padding:20px;margin-bottom:20px">
            <div style="font-size:13px;font-weight:600;color:#5b3cf5;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px">O que você ganhou com o ${newPlan}</div>
            ${features.map(f => `
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:14px;color:#333">
                <span style="color:#1d9e75;font-weight:700">✓</span> ${f}
              </div>`).join('')}
          </div>
          ${p(`Próxima cobrança: <strong>${date}</strong>.`)}
          ${btn('Explorar novos recursos', `${APP_URL}/dashboard`)}
        `)}
        <tr><td style="padding:0 32px 32px">
          ${alert(`A diferença de valor do upgrade foi cobrada de forma proporcional no seu cartão.`, '#185fa5')}
        </td></tr>
      `
    })
  })
}

// ─────────────────────────────────────────────
// 5. DOWNGRADE DE PLANO
// ─────────────────────────────────────────────
export async function sendDowngradeEmail({ to, name, oldPlan, newPlan, effectiveDate }) {
  const firstName = name?.split(' ')[0] ?? 'você'
  const date = new Date(effectiveDate).toLocaleDateString('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric'
  })

  return send({
    to,
    subject: `Alteração de plano — ${oldPlan} → ${newPlan}`,
    html: layout({
      preheader: `Seu plano foi alterado para ${newPlan}`,
      body: `
        ${section(`
          ${heading(`Plano alterado, ${firstName}`)}
          ${p(`Seu plano foi alterado de <strong>${oldPlan}</strong> para <strong>${newPlan}</strong>. A mudança entra em vigor em <strong>${date}</strong>.`)}
          ${alert(`Atenção: se você tiver mais gatilhos ou contas conectadas do que o novo plano permite, os que excederem o limite serão pausados automaticamente.`, '#ba7517')}
          ${p('Você pode fazer upgrade a qualquer momento pelo dashboard.')}
          ${btn('Ver meu plano atual', `${APP_URL}/dashboard/plans`)}
        `)}
        <tr><td style="padding:0 32px 32px;font-size:13px;color:#888">
          Tem dúvidas? <a href="mailto:suporte@triggerflow.app" style="color:#5b3cf5">Fale com o suporte</a>.
        </td></tr>
      `
    })
  })
}

// ─────────────────────────────────────────────
// 6. CANCELAMENTO DE ASSINATURA
// ─────────────────────────────────────────────
export async function sendCancellationEmail({ to, name, plan, accessUntil }) {
  const firstName = name?.split(' ')[0] ?? 'você'
  const date = new Date(accessUntil).toLocaleDateString('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric'
  })

  return send({
    to,
    subject: `Assinatura cancelada — sentiremos sua falta, ${firstName}`,
    html: layout({
      preheader: `Sua assinatura foi cancelada. Acesso disponível até ${date}`,
      body: `
        ${section(`
          ${heading(`Assinatura cancelada`)}
          ${p(`Olá, ${firstName}. Sua assinatura do <strong>TriggerFlow ${plan}</strong> foi cancelada com sucesso.`)}
          <div style="background:#f9fafb;border-radius:10px;padding:20px;margin-bottom:20px">
            <div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px">O que acontece agora:</div>
            <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;font-size:14px;color:#555">
              <span style="color:#1d9e75;font-weight:700;margin-top:1px">✓</span>
              <span>Você ainda tem acesso completo até <strong>${date}</strong></span>
            </div>
            <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;font-size:14px;color:#555">
              <span style="color:#1d9e75;font-weight:700;margin-top:1px">✓</span>
              <span>Seus dados ficam salvos por 90 dias — basta reativar para recuperar tudo</span>
            </div>
            <div style="display:flex;align-items:flex-start;gap:10px;font-size:14px;color:#555">
              <span style="color:#1d9e75;font-weight:700;margin-top:1px">✓</span>
              <span>Nenhuma cobrança futura será feita</span>
            </div>
          </div>
          ${p('Se mudou de ideia ou cancelou por engano, você pode reativar a qualquer momento.')}
          ${btn('Reativar minha assinatura', `${APP_URL}/dashboard/plans`, '#5b3cf5')}
        `)}
        <tr><td style="padding:16px 32px 0">
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;font-size:13px;color:#991b1b;line-height:1.6">
            <strong>Nos ajude a melhorar:</strong> Por que você cancelou? Sua resposta leva 30 segundos e nos ajuda muito.<br>
            <a href="mailto:suporte@triggerflow.app?subject=Feedback cancelamento" style="color:#991b1b;font-weight:600">Deixar feedback →</a>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;font-size:13px;color:#aaa;text-align:center">
          Tem alguma dúvida? <a href="mailto:suporte@triggerflow.app" style="color:#888">suporte@triggerflow.app</a>
        </td></tr>
      `
    })
  })
}

// ─────────────────────────────────────────────
// RE-EXPORT das funções do emailService.js anterior
// (boas-vindas e pagamento falhou)
// ─────────────────────────────────────────────
export { sendWelcomeEmail, sendPaymentFailedEmail } from './emailService.js'
