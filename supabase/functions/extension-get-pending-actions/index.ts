import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from "../_shared/cors.ts"

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

    // Valider le crm_type (par défaut 'hubspot' pour compatibilité)
    const crmType = crm_type || 'hubspot'
    if (!['hubspot', 'salesforce'].includes(crmType)) {
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

    console.log(`✅ Token validated for user: ${userId}`)

    // Récupérer les actions en attente pour le CRM spécifié (max 10 à la fois)
    console.log(`🔍 Fetching pending actions for CRM type: ${crmType}`)
    const { data: actions, error: actionsError } = await supabase
      .from('extension_action_queue')
      .select('*')
      .eq('user_id', userId)
      .eq('crm_type', crmType)  // Filtrer par type de CRM
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10)

    if (actionsError) {
      console.error('Error fetching actions:', actionsError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch actions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`📋 Found ${actions?.length || 0} pending actions`)

    // Marquer les actions comme "processing"
    if (actions && actions.length > 0) {
      const actionIds = actions.map((a: any) => a.id)

      await supabase
        .from('extension_action_queue')
        .update({
          status: 'processing',
          processing_started_at: new Date().toISOString()
        })
        .in('id', actionIds)
    }

    return new Response(
      JSON.stringify({ actions: actions || [] }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in extension-get-pending-actions:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
