import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { EnrichedProfile } from '@/hooks/useEnrichedCompanies';

export interface SmartleadPushResult {
  ok: number;
  skipped: number;
  failed: number;
}

/**
 * Hook pour push bulk de leads vers Smartlead (Jay Reach 1.5.2).
 *
 * Filtre les profiles avec email + deliverability_status='valid' + pas deja envoyes,
 * puis appelle send-via-smartlead pour chacun via manual_override=true.
 *
 * Retourne :
 * - eligible : profiles a pousser
 * - alreadySent : profiles deja pousses (smartlead_push_decision='push')
 * - totalWithEmail : profiles ayant un email (eligible ou pas)
 * - push() : declenche l'envoi sequentiel
 * - sending : true pendant l'envoi
 */
export function useSmartleadPush(profiles: EnrichedProfile[]) {
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);

  const eligible = useMemo(
    () => profiles.filter(
      (p) => !!p.email && p.deliverability_status === 'valid' && p.smartlead_push_decision !== 'push',
    ),
    [profiles],
  );
  const alreadySent = useMemo(
    () => profiles.filter((p) => p.smartlead_push_decision === 'push').length,
    [profiles],
  );
  const totalWithEmail = useMemo(
    () => profiles.filter((p) => !!p.email).length,
    [profiles],
  );

  const push = async (): Promise<SmartleadPushResult | null> => {
    if (eligible.length === 0) return null;
    setSending(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const accessToken = session?.session?.access_token;
      if (!accessToken) {
        setSending(false);
        throw new Error('Erreur auth : reconnecte-toi');
      }
      let ok = 0;
      let skipped = 0;
      let failed = 0;
      for (const p of eligible) {
        try {
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-via-smartlead`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prospect_id: p.id, channel: 'email', manual_override: true }),
          });
          if (res.ok) ok++;
          else if (res.status === 422) skipped++;
          else failed++;
        } catch {
          failed++;
        }
      }
      queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
      return { ok, skipped, failed };
    } finally {
      setSending(false);
    }
  };

  return { eligible, alreadySent, totalWithEmail, push, sending };
}
