import express from 'express'
import { db } from '../database.js'
import { instagramAPI } from '../instagramAPI.js'
import { aiFlowEngine } from '../aiFlowEngine.js'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const router = express.Router()

// Supabase admin client para verificar tokens JWT
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// ─────────────────────────────────────────────
// MIDDLEWARE DE AUTENTICAÇÃO
// Verifica o JWT do Supabase em todas as rotas
// ─────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token não fornecido' })
  }

  const token = authHeader.split(' ')[1]
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return res.status(401).json({ message: 'Token inválido ou expirado' })
  }

  req.user = data.user
  next()
}

router.use(requireAuth)

// ─────────────────────────────────────────────
// GATILHOS
// ─────────────────────────────────────────────
router.get('/triggers', async (req, res) => {
  try {
    const data = await db.getTriggersByUserId(req.user.id)
    res.json(data)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/triggers/:id', async (req, res) => {
  try {
    const data = await db.getTriggerById(req.params.id, req.user.id)
    if (!data) return res.status(404).json({ message: 'Gatilho não encontrado' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/triggers', async (req, res) => {
  try {
    const { name, postId, keyword, matchType, flowId, platform } = req.body
    if (!keyword || !flowId || !platform) {
      return res.status(400).json({ message: 'keyword, flowId e platform são obrigatórios' })
    }
    const trigger = await db.createTrigger({
      userId: req.user.id, name, postId, keyword, matchType, flowId, platform,
    })
    res.status(201).json(trigger)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.patch('/triggers/:id', async (req, res) => {
  try {
    const updated = await db.updateTrigger(req.params.id, req.user.id, req.body)
    res.json(updated)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.patch('/triggers/:id/active', async (req, res) => {
  try {
    const { active } = req.body
    const updated = await db.updateTrigger(req.params.id, req.user.id, { active })
    res.json(updated)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.delete('/triggers/:id', async (req, res) => {
  try {
    await db.deleteTrigger(req.params.id, req.user.id)
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// FLUXOS
// ─────────────────────────────────────────────
router.get('/flows', async (req, res) => {
  try {
    res.json(await db.getFlowsByUserId(req.user.id))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/flows', async (req, res) => {
  try {
    const flow = await db.createFlow({ userId: req.user.id, ...req.body })
    res.status(201).json(flow)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.patch('/flows/:id', async (req, res) => {
  try {
    res.json(await db.updateFlow(req.params.id, req.user.id, req.body))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.delete('/flows/:id', async (req, res) => {
  try {
    await db.deleteFlow(req.params.id, req.user.id)
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// Gerar fluxo com IA
router.post('/flows/generate', async (req, res) => {
  try {
    const { goal, productName, productDescription } = req.body
    const flow = await aiFlowEngine.generateFlow({ goal, productName, productDescription })
    res.json(flow)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────
router.get('/analytics/summary', async (req, res) => {
  try {
    const { period = '7d' } = req.query
    const since = periodToDate(period)

    const { data: events } = await supabase
      .from('events')
      .select('event_type, created_at')
      .eq('user_id', req.user.id)
      .gte('created_at', since.toISOString())

    const shots    = events.filter(e => e.event_type === 'flow_sent').length
    const replies  = events.filter(e => e.event_type === 'reply_received').length
    const converts = events.filter(e => e.event_type === 'converted').length

    res.json({
      activeTriggers: await db.countActiveTriggers(req.user.id),
      shots,
      replyRate: shots > 0 ? Math.round((replies / shots) * 100) : 0,
      conversions: converts,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/analytics/timeseries', async (req, res) => {
  try {
    const { period = '7d' } = req.query
    const since = periodToDate(period)
    const days = parseInt(period)

    const { data: events } = await supabase
      .from('events')
      .select('event_type, created_at')
      .eq('user_id', req.user.id)
      .gte('created_at', since.toISOString())

    // Agrupar por dia
    const series = Array.from({ length: days }, (_, i) => {
      const date = new Date(since)
      date.setDate(date.getDate() + i)
      const dayStr = date.toISOString().split('T')[0]
      const dayEvents = events.filter(e => e.created_at.startsWith(dayStr))
      return {
        date: dayStr,
        shots: dayEvents.filter(e => e.event_type === 'flow_sent').length,
        conversions: dayEvents.filter(e => e.event_type === 'converted').length,
      }
    })

    res.json(series)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/analytics/funnel', async (req, res) => {
  try {
    const { period = '7d' } = req.query
    const since = periodToDate(period)

    const { data: events } = await supabase
      .from('events')
      .select('event_type')
      .eq('user_id', req.user.id)
      .gte('created_at', since.toISOString())

    const count = (type) => events.filter(e => e.event_type === type).length

    res.json([
      { label: 'Comentários detectados', value: count('comment_detected') },
      { label: 'Direct enviado',         value: count('flow_sent') },
      { label: 'Responderam',            value: count('reply_received') },
      { label: 'Convertidos',            value: count('converted') },
    ])
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/analytics/by-trigger', async (req, res) => {
  try {
    const { period = '7d' } = req.query
    const since = periodToDate(period)

    const { data } = await supabase
      .from('events')
      .select('trigger_id, event_type, triggers(keyword)')
      .eq('user_id', req.user.id)
      .gte('created_at', since.toISOString())
      .not('trigger_id', 'is', null)

    // Agrupar por trigger
    const grouped = data.reduce((acc, e) => {
      const key = e.trigger_id
      if (!acc[key]) acc[key] = { keyword: e.triggers?.keyword, shots: 0, conversions: 0 }
      if (e.event_type === 'flow_sent') acc[key].shots++
      if (e.event_type === 'converted') acc[key].conversions++
      return acc
    }, {})

    res.json(Object.values(grouped))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// INSTAGRAM OAUTH
// ─────────────────────────────────────────────
router.get('/instagram/oauth/url', (_req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: `${process.env.APP_URL}/instagram/callback`,
    scope: 'instagram_basic,instagram_manage_comments,instagram_manage_messages',
    response_type: 'code',
    state: Math.random().toString(36).slice(2), // CSRF token básico
  })
  res.json({ url: `https://www.facebook.com/v21.0/dialog/oauth?${params}` })
})

router.post('/instagram/oauth/callback', async (req, res) => {
  try {
    const { code } = req.body

    // Trocar code por token de longa duração
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      new URLSearchParams({
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: `${process.env.APP_URL}/instagram/callback`,
        code,
      })
    )
    const tokenData = await tokenRes.json()
    if (tokenData.error) throw new Error(tokenData.error.message)

    // Buscar ID da conta Instagram vinculada à página
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${tokenData.access_token}`
    )
    const meData = await meRes.json()
    const page = meData.data?.[0]

    if (!page) throw new Error('Nenhuma Página do Facebook encontrada')

    // Salvar token e account ID no banco
    await supabase.from('users').update({
      instagram_access_token: tokenData.access_token,
      instagram_account_id: page.id,
      instagram_username: page.name,
    }).eq('id', req.user.id)

    res.json({ success: true, username: page.name })
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.get('/instagram/connection', async (req, res) => {
  try {
    const { data } = await supabase
      .from('users')
      .select('instagram_account_id, instagram_username')
      .eq('id', req.user.id)
      .single()

    res.json({
      connected: !!data?.instagram_account_id,
      username: data?.instagram_username,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.delete('/instagram/connection', async (req, res) => {
  try {
    await supabase.from('users').update({
      instagram_access_token: null,
      instagram_account_id: null,
      instagram_username: null,
    }).eq('id', req.user.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/instagram/posts', async (req, res) => {
  try {
    const { data: userData } = await supabase
      .from('users').select('instagram_access_token').eq('id', req.user.id).single()

    if (!userData?.instagram_access_token) {
      return res.status(400).json({ message: 'Instagram não conectado' })
    }

    const posts = await instagramAPI.getAccountPosts(20)
    res.json(posts.data ?? [])
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// BILLING (Stripe)
// ─────────────────────────────────────────────
router.post('/billing/checkout', async (req, res) => {
  try {
    const { planId, successUrl, cancelUrl } = req.body

    const prices = {
      starter: process.env.STRIPE_PRICE_STARTER,
      pro: process.env.STRIPE_PRICE_PRO,
      agency: process.env.STRIPE_PRICE_AGENCY,
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: req.user.email,
      line_items: [{ price: prices[planId], quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId: req.user.id },
    })

    res.json({ url: session.url })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/billing/portal', async (req, res) => {
  try {
    const { returnUrl } = req.body
    const { data: userData } = await supabase
      .from('users').select('stripe_customer_id').eq('id', req.user.id).single()

    const session = await stripe.billingPortal.sessions.create({
      customer: userData.stripe_customer_id,
      return_url: returnUrl,
    })

    res.json({ url: session.url })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// PERFIL
// ─────────────────────────────────────────────
router.get('/user/profile', async (req, res) => {
  try {
    const { data } = await supabase
      .from('users').select('*').eq('id', req.user.id).single()
    res.json(data)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/user/subscription', async (req, res) => {
  try {
    const { data } = await supabase
      .from('users').select('plan, plan_expires_at').eq('id', req.user.id).single()
    res.json(data)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function periodToDate(period) {
  const days = parseInt(period) || 7
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(0, 0, 0, 0)
  return date
}

export default router
