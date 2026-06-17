import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Loader2, Send, Eye, Mail, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useTrackAction } from '@/hooks/useProspectActions';
import type { EnrichedCompany, EnrichedProfile } from '@/hooks/useEnrichedCompanies';
import type { ProspectMessage } from '../useCompanyMessages';

export function MessageContent({
  message,
  profile,
  company,
  channel,
}: {
  message: ProspectMessage;
  profile: EnrichedProfile;
  company: EnrichedCompany;
  channel: 'email' | 'postal_letter' | 'social_dm';
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(message.body);
  const [editedSubject, setEditedSubject] = useState(message.subject || '');
  const [saving, setSaving] = useState(false);
  const trackAction = useTrackAction();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    setEditedBody(message.body);
    setEditedSubject(message.subject || '');
  }, [message.body, message.subject]);

  const previewEmail = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('send-via-smartlead', {
        body: { prospect_id: profile.id, channel: 'email', dry_run: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: boolean; body_html: string; subject: string };
    },
    onSuccess: (data) => {
      const win = window.open('', '_blank');
      if (!win) {
        toast({ variant: 'destructive', description: 'Popup bloqué par le navigateur' });
        return;
      }
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${data.subject || 'Preview'}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;padding:24px;max-width:680px;margin:auto;color:#0f172a;background:#fafafa}.subject{font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin-bottom:16px}.body{background:#fff;padding:24px;border-radius:8px;border:1px solid #e2e8f0;line-height:1.5}</style></head><body><div class="subject"><strong>Sujet :</strong> ${data.subject}</div><div class="body">${data.body_html}</div></body></html>`);
      win.document.close();
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', description: err.message });
    },
  });

  const sendViaSmartlead = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('send-via-smartlead', {
        body: { prospect_id: profile.id, channel: 'email', manual_override: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: boolean; added?: number; skipped?: number };
    },
    onSuccess: (data) => {
      toast({
        description: data.added
          ? 'Lead ajouté à Smartlead — envoi imminent'
          : 'Lead déjà présent dans la campagne',
      });
      queryClient.invalidateQueries({ queryKey: ['company-messages', company.company_group_id] });
      queryClient.invalidateQueries({ queryKey: ['prospect-actions'] });
      trackAction.mutate({
        prospectId: profile.id,
        companyGroupId: company.company_group_id,
        actionType: 'sent',
        channel: 'email',
      });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', description: err.message });
    },
  });

  const saveEdit = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('prospect_messages')
      .update({ body: editedBody, subject: editedSubject })
      .eq('id', message.id);
    setSaving(false);
    if (error) {
      toast({ variant: 'destructive', description: `Erreur : ${error.message}` });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['company-messages', company.company_group_id] });
    setIsEditing(false);
  };

  const handleCopyBody = async () => {
    await navigator.clipboard.writeText(message.body);
    trackAction.mutate({
      prospectId: profile.id,
      companyGroupId: company.company_group_id,
      actionType: 'copy',
      channel,
    });
    toast({ description: 'Message copié dans le presse-papiers' });
  };

  const enrichment = profile.enrichment_data || {};

  const primaryBtnClass =
    channel === 'email' ? 'bg-violet-500 hover:bg-violet-600 text-white' :
    channel === 'postal_letter' ? 'bg-amber-500 hover:bg-amber-600 text-white' :
    'bg-emerald-500 hover:bg-emerald-600 text-white';

  return (
    <div className="mt-3 rounded-md bg-muted/40 border border-border/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Message généré
        </span>
        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Pencil className="w-3 h-3" />
            Éditer
          </button>
        ) : (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setEditedBody(message.body);
                setEditedSubject(message.subject || '');
                setIsEditing(false);
              }}
            >
              Annuler
            </Button>
            <Button
              size="sm"
              className={cn('h-6 px-2 text-[11px]', primaryBtnClass)}
              onClick={saveEdit}
              disabled={saving}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sauvegarder'}
            </Button>
          </div>
        )}
      </div>

      <div className="px-3 pb-3">
        {(channel === 'email' || channel === 'postal_letter') && (
          isEditing ? (
            <input
              type="text"
              value={editedSubject}
              onChange={(e) => setEditedSubject(e.target.value)}
              className="w-full text-[13px] font-medium text-foreground mb-2 px-2 py-1 bg-background rounded border border-border focus:outline-none focus:border-violet-500"
              placeholder={channel === 'email' ? 'Objet du mail' : 'En-tête lettre'}
            />
          ) : (
            message.subject && (
              <p className="text-[13px] font-semibold text-foreground mb-2">
                {message.subject}
              </p>
            )
          )
        )}

        {isEditing ? (
          <textarea
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            rows={Math.max(6, editedBody.split('\n').length + 1)}
            className="w-full text-[13px] text-foreground leading-relaxed px-2 py-1.5 bg-background rounded border border-border focus:outline-none focus:border-violet-500 resize-y font-mono"
          />
        ) : (
          <p className="text-[13px] text-foreground/90 whitespace-pre-line leading-relaxed">
            {message.body}
          </p>
        )}

        {!isEditing && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {channel === 'email' && (
              <>
                {profile.email && (
                  <>
                    <Button
                      size="sm"
                      className={cn('h-7 text-[11px] gap-1.5', primaryBtnClass)}
                      onClick={() => sendViaSmartlead.mutate()}
                      disabled={sendViaSmartlead.isPending || message.status === 'sent'}
                    >
                      {sendViaSmartlead.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Send className="w-3 h-3" />
                      )}
                      {message.status === 'sent' ? 'Envoyé' : 'Envoyer via Smartlead'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] gap-1.5"
                      onClick={() => previewEmail.mutate()}
                      disabled={previewEmail.isPending}
                    >
                      {previewEmail.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                      Aperçu
                    </Button>
                    <a
                      href={buildMailto(profile.email, editedSubject || message.subject || '', message.body)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackAction.mutate({
                        prospectId: profile.id,
                        companyGroupId: company.company_group_id,
                        actionType: 'open',
                        channel: 'email',
                      })}
                    >
                      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5">
                        <Mail className="w-3 h-3" />
                        Gmail
                      </Button>
                    </a>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1.5"
                  onClick={handleCopyBody}
                >
                  <Copy className="w-3 h-3" />
                  Copier
                </Button>
              </>
            )}

            {channel === 'postal_letter' && (
              <>
                <Button
                  size="sm"
                  className={cn('h-7 text-[11px] gap-1.5', primaryBtnClass)}
                  onClick={async () => {
                    // Import dynamique : docx (~500 KB) n'est charge qu'au clic
                    // de telechargement, pas au montage de l'onglet (Jay Reach 1.5.6).
                    const { downloadLetterDocx } = await import('@/lib/generate-letter-docx');
                    await downloadLetterDocx({
                      recipientFirstName: profile.first_name,
                      recipientLastName: profile.last_name,
                      recipientTitle: profile.job_title || 'Directeur Commercial',
                      companyName: company.company_name,
                      companyAddress: (enrichment.company_address as string) || null,
                      companyZip: (enrichment.company_zip as string) || null,
                      companyCity: (enrichment.company_city as string) || null,
                      companyCountry: (enrichment.company_country as string) || 'France',
                      body: editedBody || message.body,
                    });
                    trackAction.mutate({
                      prospectId: profile.id,
                      companyGroupId: company.company_group_id,
                      actionType: 'download',
                      channel: 'postal_letter',
                    });
                    toast({ description: 'Lettre .docx téléchargée' });
                  }}
                >
                  <Download className="w-3 h-3" />
                  Télécharger .docx
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1.5"
                  onClick={handleCopyBody}
                >
                  <Copy className="w-3 h-3" />
                  Copier
                </Button>
              </>
            )}

            {channel === 'social_dm' && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1.5"
                onClick={handleCopyBody}
              >
                <Copy className="w-3 h-3" />
                Copier
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function buildMailto(to: string, subject: string, body: string): string {
  const qs = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${encodeURIComponent(to)}?${qs}`;
}
