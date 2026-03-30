import express from 'express'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { sendWelcomeEmail } from './emailService.js'

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// ─────────────────────────────────────────────
// IDs dos preços no Stripe (criar no dashboard)
// stripe.com/dashboard → Produtos → copiar Price ID
// ─────────────────────────────────────────────
const PLANS = {
  starter: {
    name: 'Starter',
    priceId: process.env.STRIPE_PRICE_STARTER,   // price_xxx
    amount: 9700,   // R$97 em centavos
    limits: { triggers: 3, shots: 500, accounts: 1 },
  },
  pro: {
    name: 'Pro',
    priceId: process.env.STRIPE_PRICE_PRO,        // price_xxx
    amount: 19700,  // R$197
    limits: { triggers: 15, shots: 5000, accounts: 3 },
  },
  agency: {
    name: 'Agency',
    priceId: process.env.STRIPE_PRICE_AGENCY,     // price_xxx
    amount: 49700,  // R$497
    limits: { triggers: -1, shots: 50000, accounts: 20 }, // -1 = ilimitado
  },
}

// ─────────────────────────────────────────────
// MIDDLEWARE AUTH — protege rotas autenticadas
// ─────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ message: 'Não autorizado' })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return res.status(401).json({ message: 'Token inválido' })
  req.user = data.user
  next()
}

// ─────────────────────────────────────────────
// 1. CRIAR SESSÃO DE CHECKOUT
// Redireciona o usuário para a página de pagamento do Stripe
// ─────────────────────────────────────────────
router.post('/billing/checkout', requireAuth, async (req, res) => {
  try {
    const { planId, successUrl, cancelUrl } = req.body

    const plan = PLANS[planId]
    if (!plan) return res.status(400).json({ message: 'Plano inválido' })

    // Buscar ou criar customer no Stripe
    const customerId = await getOrCreateStripeCustomer(req.user)

    // Verificar se já tem assinatura ativa
    const existing = await getActiveSubscription(customerId)
    if (existing) {
      return res.status(400).json({
        message: 'Você já tem uma assinatura ativa. Use o portal para fazer upgrade.',
        portalUrl: await createPortalUrl(customerId, cancelUrl),
      })
    }

    // Criar sessão de checkout
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: successUrl ?? `${process.env.FRONTEND_URL}/dashboard?checkout=success&plan=${planId}`,
      cancel_url: cancelUrl ?? `${process.env.FRONTEND_URL}/dashboard/plans`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: {
          userId: req.user.id,
          planId,
        },
        trial_period_days: 7, // 7 dias de trial grátis
      },
      metadata: {
        userId: req.user.id,
        planId,
      },
      locale: 'pt-BR',
      currency: 'brl',
      payment_method_types: ['card'],
      custom_text: {
        submit: { message: 'Ao assinar, você concorda com nossos Termos de Uso.' },
      },
    })

    res.json({ url: session.url, sessionId: session.id })
  } catch (err) {
    console.error('Erro no checkout:', err)
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// 2. UPGRADE / DOWNGRADE DE PLANO
// Troca o plano de uma assinatura existente
// ─────────────────────────────────────────────
router.post('/billing/change-plan', requireAuth, async (req, res) => {
  try {
    const { planId } = req.body
    const plan = PLANS[planId]
    if (!plan) return res.status(400).json({ message: 'Plano inválido' })

    const { data: userData } = await supabase
      .from('users')
      .select('stripe_customer_id, stripe_subscription_id, plan')
      .eq('id', req.user.id)
      .single()

    if (!userData?.stripe_subscription_id) {
      return res.status(400).json({ message: 'Sem assinatura ativa. Faça checkout primeiro.' })
    }

    if (userData.plan === planId) {
      return res.status(400).json({ message: 'Você já está neste plano.' })
    }

    // Buscar assinatura atual
    const subscription = await stripe.subscriptions.retrieve(userData.stripe_subscription_id)
    const currentItem = subscription.items.data[0]

    // Alterar o item da assinatura para o novo preço
    const updatedSub = await stripe.subscriptions.update(userData.stripe_subscription_id, {
      items: [{ id: currentItem.id, price: plan.priceId }],
      proration_behavior: 'always_invoice', // cobra/credita a diferença imediatamente
      metadata: { planId, userId: req.user.id },
    })

    // Atualizar no banco imediatamente (webhook vai confirmar)
    await updateUserPlan(req.user.id, planId, updatedSub.id)

    const direction = plan.amount > PLANS[userData.plan]?.amount ? 'upgrade' : 'downgrade'
    res.json({ success: true, direction, plan: planId })
  } catch (err) {
    console.error('Erro ao trocar plano:', err)
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// 3. PORTAL DO CLIENTE (Stripe Billing Portal)
// Gerenciar assinatura, trocar cartão, histórico
// ─────────────────────────────────────────────
router.post('/billing/portal', requireAuth, async (req, res) => {
  try {
    const { returnUrl } = req.body

    const { data: userData } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', req.user.id)
      .single()

    if (!userData?.stripe_customer_id) {
      return res.status(400).json({ message: 'Sem histórico de pagamento encontrado.' })
    }

    const url = await createPortalUrl(
      userData.stripe_customer_id,
      returnUrl ?? `${process.env.FRONTEND_URL}/dashboard/plans`
    )

    res.json({ url })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// 4. STATUS DA ASSINATURA
// ─────────────────────────────────────────────
router.get('/billing/subscription', requireAuth, async (req, res) => {
  try {
    const { data: userData } = await supabase
      .from('users')
      .select('plan, stripe_subscription_id, plan_expires_at, trial_ends_at')
      .eq('id', req.user.id)
      .single()

    if (!userData?.stripe_subscription_id) {
      return res.json({ plan: 'starter', status: 'no_subscription', trial: false })
    }

    const sub = await stripe.subscriptions.retrieve(userData.stripe_subscription_id)

    res.json({
      plan: userData.plan,
      status: sub.status,                           // active, trialing, past_due, canceled
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      limits: PLANS[userData.plan]?.limits,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// 5. WEBHOOK DO STRIPE
// Recebe eventos e atualiza o banco de dados
// IMPORTANTE: usar express.raw() nesta rota
// ─────────────────────────────────────────────
router.post(
  '/billing/webhook',
  express.raw({ type: 'application/json' }), // raw body para verificar assinatura
  async (req, res) => {
    const sig = req.headers['stripe-signature']

    let event
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      console.error('❌ Webhook assinatura inválida:', err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    // Confirmar recebimento imediatamente
    res.sendStatus(200)

    // Processar evento de forma assíncrona
    try {
      await handleStripeEvent(event)
    } catch (err) {
      console.error(`❌ Erro ao processar evento ${event.type}:`, err)
    }
  }
)

// ─────────────────────────────────────────────
// HANDLER DE EVENTOS DO STRIPE
// ─────────────────────────────────────────────
async function handleStripeEvent(event) {
  console.log(`📦 Stripe event: ${event.type}`)

  switch (event.type) {

    // ── Checkout completado ────────────────────
    case 'checkout.session.completed': {
      const session = event.data.object
      if (session.mode !== 'subscription') break

      const userId = session.metadata?.userId
      const planId = session.metadata?.planId
      if (!userId || !planId) break

      await updateUserPlan(userId, planId, session.subscription)

      // E-mail de boas-vindas
      const { data: user } = await supabase
        .from('users').select('email, name').eq('id', userId).single()

      if (user) {
        await sendWelcomeEmail({
          to: user.email,
          name: user.name,
          plan: PLANS[planId].name,
          trialDays: 7,
        })
      }

      console.log(`✅ Plano ${planId} ativado para usuário ${userId}`)
      break
    }

    // ── Assinatura atualizada (upgrade/downgrade) ──
    case 'customer.subscription.updated': {
      const sub = event.data.object
      const userId = sub.metadata?.userId
      const planId = sub.metadata?.planId
      if (!userId || !planId) break

      await updateUserPlan(userId, planId, sub.id)

      // Atualizar status se ficou inadimplente
      if (sub.status === 'past_due') {
        await supabase.from('users')
          .update({ status: 'past_due' })
          .eq('id', userId)
      }
      break
    }

    // ── Trial encerrado ───────────────────────────
    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object
      const userId = sub.metadata?.userId
      // Aqui você enviaria um e-mail de aviso do trial
      console.log(`⏰ Trial encerrando em 3 dias para userId ${userId}`)
      break
    }

    // ── Assinatura cancelada ──────────────────────
    case 'customer.subscription.deleted': {
      const sub = event.data.object
      const userId = sub.metadata?.userId
      if (!userId) break

      await supabase.from('users')
        .update({
          plan: 'starter',
          stripe_subscription_id: null,
          plan_expires_at: null,
        })
        .eq('id', userId)

      console.log(`❌ Assinatura cancelada para userId ${userId} — revertido para Starter`)
      break
    }

    // ── Pagamento falhou ──────────────────────────
    case 'invoice.payment_failed': {
      const invoice = event.data.object
      const customerId = invoice.customer

      const { data: userData } = await supabase
        .from('users').select('id, email, name').eq('stripe_customer_id', customerId).single()

      if (userData) {
        // Marcar como inadimplente após 3 tentativas
        if (invoice.attempt_count >= 3) {
          await supabase.from('users')
            .update({ status: 'past_due' })
            .eq('id', userData.id)
        }
        console.log(`💳 Pagamento falhou (tentativa ${invoice.attempt_count}) para ${userData.email}`)
      }
      break
    }

    // ── Pagamento bem-sucedido ────────────────────
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object
      if (invoice.billing_reason === 'subscription_create') break // já tratado no checkout

      const customerId = invoice.customer
      const { data: userData } = await supabase
        .from('users').select('id').eq('stripe_customer_id', customerId).single()

      if (userData) {
        await supabase.from('users')
          .update({ status: 'active' })
          .eq('id', userData.id)
      }
      break
    }

    default:
      console.log(`ℹ️  Evento não tratado: ${event.type}`)
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
async function getOrCreateStripeCustomer(user) {
  const { data: userData } = await supabase
    .from('users')
    .select('stripe_customer_id, email, name')
    .eq('id', user.id)
    .single()

  if (userData?.stripe_customer_id) return userData.stripe_customer_id

  // Criar novo customer no Stripe
  const customer = await stripe.customers.create({
    email: user.email,
    name: userData?.name ?? user.email,
    metadata: { userId: user.id },
  })

  // Salvar no banco
  await supabase.from('users')
    .update({ stripe_customer_id: customer.id })
    .eq('id', user.id)

  return customer.id
}

async function getActiveSubscription(customerId) {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 1,
  })
  return subs.data[0] ?? null
}

async function updateUserPlan(userId, planId, subscriptionId) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId)

  await supabase.from('users').update({
    plan: planId,
    stripe_subscription_id: subscriptionId,
    plan_expires_at: new Date(sub.current_period_end * 1000).toISOString(),
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    status: 'active',
  }).eq('id', userId)
}

async function createPortalUrl(customerId, returnUrl) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
  return session.url
}

export default router
