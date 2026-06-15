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
    const { token, actionId, status, errorMessage } = await req.json()

    if (!token || !actionId || !status) {
      return new Response(
        JSON.stringify({ error: 'Token, actionId, and status required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Valider le token
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

    // Préparer les données de mise à jour
    const updateData: any = {
      status,
      processed_at: new Date().toISOString()
    }

    if (errorMessage) {
      updateData.error_message = errorMessage
    }

    // Incrémenter retry_count si failed
    if (status === 'failed') {
      const { data: action } = await supabase
        .from('extension_action_queue')
        .select('retry_count, max_retries')
        .eq('id', actionId)
        .single()

      if (action) {
        updateData.retry_count = (action.retry_count || 0) + 1

        // Si on n'a pas dépassé max_retries, remettre en pending
        if (updateData.retry_count < action.max_retries) {
          updateData.status = 'pending'
          updateData.processing_started_at = null
          updateData.processed_at = null
          console.log(`⚠️ Action ${actionId} will be retried (attempt ${updateData.retry_count + 1}/${action.max_retries})`)
        }
      }
    }

    // Mettre à jour l'action
    console.log(`📝 Updating action ${actionId} for user ${userId} with status ${status}`)
    const { data: updateResult, error: updateError } = await supabase
      .from('extension_action_queue')
      .update(updateData)
      .eq('id', actionId)
      .eq('user_id', userId) // Sécurité: vérifier que l'action appartient bien à l'utilisateur
      .select()

    if (updateError) {
      console.error('❌ Error updating action:', updateError)
      return new Response(
        JSON.stringify({
          error: 'Failed to update action',
          details: updateError.message,
          code: updateError.code,
          hint: updateError.hint
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!updateResult || updateResult.length === 0) {
      console.error('⚠️ No action was updated. Action may not exist or does not belong to user.')
      console.log(`Action ID: ${actionId}, User ID: ${userId}`)
      return new Response(
        JSON.stringify({
          error: 'Action not found or access denied',
          actionId,
          userId
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`✅ Action ${actionId} updated to ${status}`)

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in extension-update-action-status:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
