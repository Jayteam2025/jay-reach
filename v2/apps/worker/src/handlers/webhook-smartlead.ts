/**
 * Branchement automatique du webhook Smartlead.
 *
 * Sans webhook, aucune réponse ne remonte : le prospect répond, personne ne le
 * sait, et la séquence continue de le relancer. C'était jusqu'ici à l'opérateur
 * d'aller coller une URL et un jeton dans Smartlead, depuis un écran du menu
 * principal — de la configuration technique qu'il n'a pas à connaître, et dont
 * l'oubli ne se voyait nulle part.
 *
 * On le branche donc au premier envoi passant par une campagne : c'est le
 * moment où la campagne existe et où la clé API est forcément valide, puisqu'on
 * s'en sert dans la foulée.
 *
 * Silencieux en cas d'échec : un webhook non branché fait perdre des réponses,
 * mais faire échouer l'envoi ferait perdre l'envoi *et* les réponses.
 */
import type { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { upsertCampaignWebhook } from '@jay-reach/providers/outreach';

/**
 * Événements qui nous intéressent. Une réponse ouvre un fil et arrête la
 * séquence ; un bounce et une désinscription partent en exclusion.
 */
const EVENEMENTS = ['EMAIL_REPLY', 'EMAIL_BOUNCE', 'LEAD_UNSUBSCRIBED'] as const;

/**
 * Secret du webhook de l'organisation, créé au besoin.
 *
 * Il vit dans `credentials.config.webhook_secret`, à côté de la clé API du même
 * provider — c'est la route entrante qui le relira pour authentifier Smartlead.
 */
async function secretDeLOrganisation(pool: Pool, organizationId: string): Promise<string | null> {
  const existant = await pool.query<{ secret: string | null }>(
    `select config->>'webhook_secret' as secret from credentials
      where organization_id = $1 and provider_id = 'smartlead'`,
    [organizationId],
  );
  if (existant.rowCount === 0) {
    // Pas de credential Smartlead : il n'y a pas d'envoi possible non plus.
    return null;
  }
  const secret = existant.rows[0]?.secret;
  if (secret) {
    return secret;
  }
  const nouveau = randomBytes(24).toString('base64url');
  await pool.query(
    `update credentials
        set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('webhook_secret', $2::text)
      where organization_id = $1 and provider_id = 'smartlead'`,
    [organizationId, nouveau],
  );
  return nouveau;
}

/**
 * S'assure que la campagne Smartlead nous renvoie ses événements.
 *
 * Ne fait rien si c'est déjà branché : `webhook_registered_at` évite un appel
 * réseau à chaque envoi.
 */
export async function assurerWebhookSmartlead(
  pool: Pool,
  organizationId: string,
  campaignId: number | string,
  apiKey: string,
  appUrl: string | undefined,
): Promise<void> {
  if (!appUrl) {
    // Sans URL publique, l'adresse qu'on donnerait à Smartlead ne mènerait
    // nulle part. Mieux vaut ne rien brancher qu'un webhook mort.
    console.warn('[webhook] APP_URL absente — branchement Smartlead ignoré');
    return;
  }

  const deja = await pool.query(
    `select 1 from smartlead_campaign_mappings
      where organization_id = $1 and campaign_id = $2 and webhook_registered_at is not null
      limit 1`,
    [organizationId, String(campaignId)],
  );
  if ((deja.rowCount ?? 0) > 0) {
    return;
  }

  const secret = await secretDeLOrganisation(pool, organizationId);
  if (!secret) {
    return;
  }

  const url = `${appUrl.replace(/\/+$/, '')}/api/webhooks/smartlead?org=${encodeURIComponent(organizationId)}&token=${encodeURIComponent(secret)}`;
  try {
    await upsertCampaignWebhook(
      campaignId,
      { name: 'Jay Reach', webhook_url: url, event_types: [...EVENEMENTS] },
      apiKey,
    );
    await pool.query(
      `update smartlead_campaign_mappings set webhook_registered_at = now()
        where organization_id = $1 and campaign_id = $2`,
      [organizationId, String(campaignId)],
    );
    console.log(`[webhook] campagne Smartlead ${campaignId} branchée`);
  } catch (err) {
    // L'URL du provider porte la clé API en query : ne jamais relayer l'erreur
    // brute, elle la contiendrait.
    console.warn(`[webhook] branchement Smartlead impossible pour la campagne ${campaignId}`);
    void err;
  }
}
