import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { aiFlowEngine } from './aiFlowEngine.js'

const router = express.Router()
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// ─────────────────────────────────────────────
// MIDDLEWARE AUTH
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
// MAPEAMENTOS DO QUIZ
// ─────────────────────────────────────────────
const PLAN_MAP = {
  micro: 'starter',
  mid:   'pro',
  macro: 'agency',
}

const OBJECTIVE_GOALS = {
  vender:      'Converter leads em clientes pagantes pelo direct',
  isca:        'Entregar material gratuito e capturar leads qualificados',
  qualificar:  'Identificar e qualificar leads com interesse real',
  engajamento: 'Aumentar engajamento e fidelizar seguidores',
}

const BUSINESS_CONTEXT = {
  infoproduto: 'criador de infoprodutos (cursos, e-books, mentorias)',
  ecommerce:   'loja de e-commerce',
  servico:     'prestador de serviços (freelance, agência, consultoria)',
  conteudo:    'criador de conteúdo digital',
}

const PLATFORM_MAP = {
  instagram: ['instagram'],
  whatsapp:  ['whatsapp'],
  ambos:     ['instagram', 'whatsapp'],
  tiktok:    ['instagram'], // TikTok na fase 2 — usa Instagram no MVP
}

// ─────────────────────────────────────────────
// POST /onboarding/complete
// Recebe respostas do quiz e configura a conta
// ─────────────────────────────────────────────
router.post('/onboarding/complete', requireAuth, async (req, res) => {
  try {
    const { q1, q2, q3, q4, q5, q6 } = req.body

    // Validar campos obrigatórios
    if (!q4 || q4.trim().length < 2) {
      return res.status(400).json({ message: 'Palavra-chave é obrigatória (mínimo 2 caracteres)' })
    }

    const userId    = req.user.id
    const keyword   = q4.toUpperCase().trim()
    const product   = q6?.trim() || 'Meu produto'
    const platforms = PLATFORM_MAP[q3] ?? ['instagram']
    const goal      = OBJECTIVE_GOALS[q2] ?? 'Engajar leads e converter em clientes'
    const business  = BUSINESS_CONTEXT[q1] ?? 'negócio digital'
    const suggestedPlan = PLAN_MAP[q5] ?? 'starter'

    // 1. Salvar respostas do quiz no banco
    const { error: quizError } = await supabase
      .from('onboarding_answers')
      .upsert({
        user_id:       userId,
        business_type: q1,
        objective:     q2,
        platform:      q3,
        keyword,
        audience_size: q5,
        product_name:  product,
        completed_at:  new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (quizError) throw quizError

    // 2. Atualizar metadata do usuário
    await supabase.from('users').update({
      onboarding_completed: true,
      suggested_plan:       suggestedPlan,
    }).eq('id', userId)

    // 3. Gerar fluxo de mensagens com IA baseado no quiz
    console.log(`🤖 Gerando fluxo com IA para ${userId}...`)
    const generatedFlow = await aiFlowEngine.generateFlow({
      goal,
      productName:        product,
      productDescription: `${product} — para ${business}. Objetivo: ${goal}.`,
      tone:               q1 === 'conteudo' ? 'descontraído e autêntico' : 'profissional e direto',
    })

    // 4. Salvar o fluxo gerado no banco
    const { data: flow, error: flowError } = await supabase
      .from('flows')
      .insert({
        user_id:             userId,
        name:                `Fluxo principal — ${keyword}`,
        goal,
        product_name:        product,
        product_description: `${product} — ${business}`,
        ai_enabled:          true,
        context:             `Negócio: ${business}. Objetivo: ${goal}. Plataforma: ${platforms.join(', ')}.`,
      })
      .select()
      .single()

    if (flowError) throw flowError

    // 5. Salvar mensagens do fluxo gerado
    if (generatedFlow?.messages?.length) {
      await supabase.from('flow_messages').insert(
        generatedFlow.messages.map((msg, i) => ({
          flow_id:       flow.id,
          text:          msg.text,
          delay_seconds: msg.delaySeconds ?? 0,
          step:          i + 1,
        }))
      )
    }

    // 6. Criar gatilho para cada plataforma
    const triggersCreated = []
    for (const platform of platforms) {
      const { data: trigger, error: trigError } = await supabase
        .from('triggers')
        .insert({
          user_id:    userId,
          flow_id:    flow.id,
          post_id:    'all',          // 'all' = qualquer post (configurável depois)
          platform,
          keyword,
          match_type: 'contains',
          active:     false,          // inativo até conectar a conta
        })
        .select()
        .single()

      if (trigError) throw trigError
      triggersCreated.push(trigger)
    }

    // 7. Retornar resultado para o frontend
    res.json({
      success:       true,
      suggestedPlan,
      flow:          { id: flow.id, name: flow.name, messagesCount: generatedFlow?.messages?.length ?? 0 },
      triggers:      triggersCreated.map(t => ({ id: t.id, platform: t.platform, keyword: t.keyword })),
      nextSteps:     buildNextSteps(platforms, suggestedPlan),
    })

  } catch (err) {
    console.error('❌ Erro no onboarding:', err)
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// GET /onboarding/status
// Verifica se o usuário já completou o onboarding
// ─────────────────────────────────────────────
router.get('/onboarding/status', requireAuth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('onboarding_completed, suggested_plan')
      .eq('id', req.user.id)
      .single()

    const { data: answers } = await supabase
      .from('onboarding_answers')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle()

    res.json({
      completed:     user?.onboarding_completed ?? false,
      suggestedPlan: user?.suggested_plan,
      answers,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function buildNextSteps(platforms, plan) {
  const steps = []

  if (platforms.includes('instagram')) {
    steps.push({
      id:     'connect_instagram',
      label:  'Conectar sua conta do Instagram',
      url:    '/dashboard/connect',
      done:   false,
    })
  }

  if (platforms.includes('whatsapp')) {
    steps.push({
      id:     'connect_whatsapp',
      label:  'Conectar WhatsApp Business',
      url:    '/dashboard/connect',
      done:   false,
    })
  }

  steps.push({
    id:     'activate_trigger',
    label:  'Ativar seu primeiro gatilho',
    url:    '/dashboard/triggers',
    done:   false,
  })

  steps.push({
    id:     'test_trigger',
    label:  'Testar comentando a palavra-chave',
    url:    '/dashboard/triggers',
    done:   false,
  })

  if (plan === 'agency') {
    steps.push({
      id:     'invite_team',
      label:  'Convidar membros da equipe',
      url:    '/dashboard/settings/team',
      done:   false,
    })
  }

  return steps
}

export default router
