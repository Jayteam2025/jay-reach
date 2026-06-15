import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { token, crm_type } = await req.json()

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Token required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Valider crm_type si fourni
    const crmTypeFilter = crm_type || null
    if (crmTypeFilter && !['hubspot', 'salesforce'].includes(crmTypeFilter)) {
      return new Response(
        JSON.stringify({ error: 'Invalid crm_type. Must be "hubspot" or "salesforce"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Valider le token et récupérer le user_id
    const { data: userId, error: tokenError } = await supabase.rpc('validate_extension_token', {
      p_token: token
    })

    if (tokenError || !userId) {
      console.error('Invalid token:', tokenError)
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Détecter le type de CRM de l'utilisateur
    const { data: crmTypeData } = await supabase.rpc('detect_user_crm_type', {
      p_user_id: userId
    })
    const crmType = crmTypeData || 'hubspot'

    // Compter les actions par statut, filtrer par crm_type si fourni
    let query = supabase
      .from('extension_action_queue')
      .select('id, status, action_group_id')
      .eq('user_id', userId)

    // Filtrer par CRM si spécifié
    if (crmTypeFilter) {
      query = query.eq('crm_type', crmTypeFilter)
    }

    const { data: stats, error: statsError } = await query

    if (statsError) {
      console.error('Error fetching stats:', statsError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch stats' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Si aucun CRM n'est filtré, grouper les actions par action_group_id pour éviter les doublons
    let actionsToCount = stats || []
    if (!crmTypeFilter) {
      // Grouper par action_group_id - ne compter qu'une seule action par groupe
      const groupMap = new Map()
      for (const action of actionsToCount) {
        const groupId = action.action_group_id || action.id // Utiliser l'ID si pas de groupe
        if (!groupMap.has(groupId)) {
          groupMap.set(groupId, action)
        }
      }
      actionsToCount = Array.from(groupMap.values())
    }

    // Calculer les statistiques
    const pendingActions = actionsToCount.filter((a: any) => a.status === 'pending').length || 0
    const processingActions = actionsToCount.filter((a: any) => a.status === 'processing').length || 0
    const completedActions = actionsToCount.filter((a: any) => a.status === 'completed').length || 0
    const failedActions = actionsToCount.filter((a: any) => a.status === 'failed').length || 0

    console.log(`📊 Stats for user ${userId} (${crmType}${crmTypeFilter ? `, filtered by ${crmTypeFilter}` : ''}): ${pendingActions} pending, ${completedActions} completed, ${failedActions} failed`)

    // Compter les invitations LinkedIn en attente (pending + processing)
    const { count: pendingLinkedInCount } = await supabase
      .from('linkedin_invitation_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['pending', 'processing'])

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()
    const { count: invitedRecentCount } = await supabase
      .from('linkedin_invitation_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'sent')
      .gte('sent_at', sevenDaysAgo)

    return new Response(
      JSON.stringify({
        valid: true,
        userId,
        crmType,
        pendingActions: pendingActions + processingActions, // On groupe pending et processing
        completedActions,
        failedActions,
        pendingLinkedInInvitations: pendingLinkedInCount || 0,
        invitedRecentCount: invitedRecentCount || 0,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in extension-get-status:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
