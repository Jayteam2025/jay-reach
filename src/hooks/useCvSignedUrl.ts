import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

const CV_PATH = 'cv-jay-assistant.pdf';
const BUCKET = 'prospection-assets';

/**
 * Retourne une signed URL (1h) pour telecharger le CV statique.
 * Le bucket est prive : seuls les admins authentifies peuvent generer
 * des signed URLs via la policy RLS.
 */
export function useCvSignedUrl() {
  return useQuery({
    queryKey: ['cv-signed-url'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(CV_PATH, 3600);
      if (error) {
        // 'Object not found' = CV non configure sur ce workspace (staging, dev).
        // Phase 1.3 V1bis : remplacer ce hardcode par workspace_brand.attachments.
        if (!/not found/i.test(error.message)) {
          logger.warn('[useCvSignedUrl] signed URL error', { error: error.message });
        }
        return null;
      }
      return data.signedUrl;
    },
    staleTime: 30 * 60 * 1000,
  });
}
