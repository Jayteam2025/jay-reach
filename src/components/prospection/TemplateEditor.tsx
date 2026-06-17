import { useMemo, useState } from 'react';
import { TemplatePreview } from './TemplatePreview';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';
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
  postal_letter: false,
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
}: TemplateEditorProps) {
  const supportsSubject = CHANNEL_SUPPORTS_SUBJECT[channel] ?? false;
  const supportsInlineImage = channel === 'email';

  const previewTemplate: MessageTemplate = useMemo(
    () => ({
      channel,
      subject: draft.subject?.trim() ? draft.subject : null,
      body: draft.body,
      icebreaker_template: draft.icebreaker_template,
    }),
    [draft, channel],
  );

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
            <div className="space-y-2">
              <Label htmlFor="inline_image_url" className="text-xs">URL de l'image</Label>
              <div className="flex gap-2">
                <Input
                  id="inline_image_url"
                  type="url"
                  value={inlineImageUrl ?? ''}
                  onChange={(e) => onInlineImageChange?.(e.target.value || null, inlineImageAlt ?? null)}
                  placeholder="https://..."
                  className="text-sm"
                />
                {inlineImageUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => onInlineImageChange?.(null, null)}
                    disabled={isSavingAttachment}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            {inlineImageUrl && (
              <div className="space-y-2">
                <Label htmlFor="inline_image_alt" className="text-xs">Texte alternatif (optionnel)</Label>
                <Input
                  id="inline_image_alt"
                  type="text"
                  value={inlineImageAlt ?? ''}
                  onChange={(e) => onInlineImageChange?.(inlineImageUrl, e.target.value || null)}
                  placeholder="Description de l'image"
                  className="text-sm"
                  disabled={isSavingAttachment}
                />
              </div>
            )}
            {isSavingAttachment && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Enregistrement...
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
