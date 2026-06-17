import { useRef, useMemo, useState } from 'react';
import { TemplatePreview } from './TemplatePreview';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, X, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type {
  ProspectChannel,
  ProspectMessageTemplate,
} from '@/hooks/useProspectMessageTemplates';
import type { MessageTemplate } from '@/lib/prospect-template-renderer';

interface TemplateEditorProps {
  channel: ProspectChannel;
  draft: TemplateDraft;
  onDraftChange: (next: TemplateDraft) => void;
  inlineImageUrl?: string | null;
  inlineImageAlt?: string | null;
  onInlineImageChange?: (url: string | null, alt: string | null) => void;
  isSavingAttachment?: boolean;
  workspaceId?: string | null;
  personaId?: string | null;
}

export interface TemplateDraft {
  subject: string | null;
  body: string;
  icebreaker_template: string;
}

const VARIABLES = [
  { token: '{first_name}', desc: 'Prénom du prospect' },
  { token: '{last_name}', desc: 'Nom du prospect' },
  { token: '{company}', desc: 'Nom de la société' },
  { token: '{job_title}', desc: 'Intitulé du poste recruté' },
  { token: '{salutation}', desc: 'Bonjour {prénom}, ou fallback Madame/Monsieur' },
];

const CHANNEL_SUPPORTS_SUBJECT: Record<string, boolean> = {
  email: true,
  social_dm: false,
};

export function TemplateEditor({
  channel,
  draft,
  onDraftChange,
  inlineImageUrl,
  inlineImageAlt,
  onInlineImageChange,
  isSavingAttachment,
  workspaceId,
  personaId,
}: TemplateEditorProps) {
  const supportsSubject = CHANNEL_SUPPORTS_SUBJECT[channel] ?? false;
  const supportsInlineImage = channel === 'email';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const previewTemplate: MessageTemplate = useMemo(
    () => ({
      channel,
      subject: draft.subject?.trim() ? draft.subject : null,
      body: draft.body,
      icebreaker_template: draft.icebreaker_template,
    }),
    [draft, channel],
  );

  async function handleFileUpload(file: File) {
    if (!workspaceId || !personaId) {
      toast.error('Workspace ou persona manquant');
      return;
    }

    const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      toast.error('Format non supporté. Utilisez PNG, JPEG, WebP ou GIF.');
      return;
    }

    const maxSize = 5 * 1024 * 1024; // 5 MB
    if (file.size > maxSize) {
      toast.error('Fichier trop volumineux (max 5 MB)');
      return;
    }

    setIsUploading(true);
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
      const cleanName = file.name
        .replace(/[^a-z0-9.-]+/gi, '-')
        .toLowerCase()
        .slice(0, 80);
      const path = `${workspaceId}/${personaId}-email-${Date.now()}${ext && !cleanName.endsWith(`.${ext}`) ? `.${ext}` : ''}`;

      const { error: uploadErr } = await supabase.storage
        .from('brand-assets')
        .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
      if (uploadErr) throw uploadErr;

      const { data: pub } = supabase.storage
        .from('brand-assets')
        .getPublicUrl(path);

      onInlineImageChange?.(pub.publicUrl, null);
      toast.success('Image téléchargée');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      toast.error(`Erreur upload: ${message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
      <div className="space-y-6">
        <VariableHints />

        {supportsSubject ? (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Sujet de l'email</h4>
            <input
              type="text"
              value={draft.subject ?? ''}
              onChange={(e) =>
                onDraftChange({ ...draft, subject: e.target.value })
              }
              placeholder="ex: ton CRM et la pression en ce moment"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500"
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-medium text-foreground">Corps du message</h4>
            <span className="text-xs text-muted-foreground">
              {draft.body.length} caractères
            </span>
          </div>
          <textarea
            value={draft.body}
            onChange={(e) => onDraftChange({ ...draft, body: e.target.value })}
            rows={16}
            spellCheck
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 font-mono leading-relaxed"
            placeholder="Hello {first_name},&#10;&#10;J'ai vu que {company} recrute un {job_title}…"
          />
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">
            Icebreaker
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Affiché dans la fiche prospect, pas envoyé au prospect
            </span>
          </h4>
          <input
            type="text"
            value={draft.icebreaker_template}
            onChange={(e) =>
              onDraftChange({ ...draft, icebreaker_template: e.target.value })
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500"
            placeholder="{company} recrute un {job_title}"
          />
        </div>

        {supportsInlineImage && (
          <div className="space-y-2 pt-4 border-t border-border/40">
            <h4 className="text-sm font-medium text-foreground">
              Image intégrée au mail
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Optionnel. Apparaît en bas du corps du message.
              </span>
            </h4>

            {inlineImageUrl ? (
              <div className="space-y-3">
                <div className="relative w-full bg-card border border-border rounded-md p-3 flex items-start gap-3">
                  <img
                    src={inlineImageUrl}
                    alt={inlineImageAlt || 'Image inline'}
                    className="w-16 h-16 object-cover rounded border border-border/50 shrink-0"
                    onError={() => toast.error('Image non chargeable')}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {inlineImageAlt || 'Image intégrée'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {inlineImageUrl.split('/').pop()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => onInlineImageChange?.(null, null)}
                    disabled={isSavingAttachment || isUploading}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="inline_image_alt" className="text-xs">Texte alternatif (optionnel)</Label>
                  <Input
                    id="inline_image_alt"
                    type="text"
                    value={inlineImageAlt ?? ''}
                    onChange={(e) => onInlineImageChange?.(inlineImageUrl, e.target.value || null)}
                    placeholder="Description de l'image"
                    className="text-sm"
                    disabled={isSavingAttachment || isUploading}
                  />
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSavingAttachment || isUploading}
                  className="w-full"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Téléchargement...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4 mr-2" />
                      Remplacer l'image
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-border rounded-md p-6 text-center cursor-pointer hover:border-violet-500 hover:bg-violet-500/5 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add('border-violet-500', 'bg-violet-500/5');
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('border-violet-500', 'bg-violet-500/5');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-violet-500', 'bg-violet-500/5');
                  const file = e.dataTransfer.files[0];
                  if (file) void handleFileUpload(file);
                }}
              >
                <ImageIcon className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm font-medium text-foreground">Cliquez ou glissez une image ici</p>
                <p className="text-xs text-muted-foreground mt-1">PNG, JPEG, WebP ou GIF (max 5 MB)</p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileUpload(file);
              }}
              className="hidden"
            />

            {(isSavingAttachment || isUploading) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                {isUploading ? 'Téléchargement en cours...' : 'Enregistrement...'}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <TemplatePreview
          template={previewTemplate}
          channel={channel}
        />
      </div>
    </div>
  );
}

function VariableHints() {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(token);
      window.setTimeout(() => setCopied((c) => (c === token ? null : c)), 1200);
    } catch {
      // clipboard may be unavailable
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-2">
      <h4 className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
        Variables disponibles
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {VARIABLES.map(({ token, desc }) => (
          <button
            key={token}
            type="button"
            onClick={() => copy(token)}
            title={desc}
            className="rounded bg-violet-500/10 px-2 py-0.5 text-xs font-mono text-violet-600 dark:text-violet-300 transition-colors hover:bg-violet-500/20"
          >
            {copied === token ? 'Copié !' : token}
          </button>
        ))}
      </div>
    </div>
  );
}

export function deepEqualDraft(a: TemplateDraft, b: TemplateDraft): boolean {
  if (a.body !== b.body) return false;
  if (a.icebreaker_template !== b.icebreaker_template) return false;
  if ((a.subject ?? '') !== (b.subject ?? '')) return false;
  return true;
}

export function templateToDraft(t: ProspectMessageTemplate): TemplateDraft {
  return {
    subject: t.subject,
    body: t.body,
    icebreaker_template: t.icebreaker_template,
  };
}

export type { ProspectChannel };
