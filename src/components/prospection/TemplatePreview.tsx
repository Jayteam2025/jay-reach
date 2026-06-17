import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Mail, Send } from 'lucide-react';
import {
  DEMO_CONTEXTS,
  type MessageTemplate,
  renderTemplate,
} from '@/lib/prospect-template-renderer';

interface TemplatePreviewProps {
  template: MessageTemplate;
  channel: string;
}

const CHANNEL_LABELS: Record<string, { label: string; icon: typeof Mail }> = {
  email: { label: 'Email', icon: Mail },
  social_dm: { label: 'Social DM', icon: Send },
};

export function TemplatePreview({ template, channel }: TemplatePreviewProps) {
  const demoContext = DEMO_CONTEXTS.default!;
  const result = useMemo(() => {
    return renderTemplate(template, demoContext);
  }, [template, demoContext]);

  const profile = demoContext.profile;
  const channelMeta = CHANNEL_LABELS[channel] ?? { label: channel, icon: Send };
  const ChannelIcon = channelMeta.icon;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Aperçu</span>
        <Badge variant="outline" className="gap-1 font-normal">
          <ChannelIcon className="size-3" />
          {channelMeta.label}
        </Badge>
      </div>

      <div className="rounded-lg border-l-2 border-violet-500/40 bg-muted/30 p-4 space-y-3">
        <div className="space-y-1 pb-3 border-b border-border/50">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Destinataire
          </p>
          <p className="text-sm font-medium text-foreground">
            {profile.first_name} {profile.last_name}
          </p>
          <p className="text-xs text-muted-foreground">
            {profile.job_title || 'Contact'}{' '}
            · {profile.company_name}
          </p>
        </div>

        {result.subject ? (
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Sujet
            </p>
            <p className="text-sm font-semibold text-foreground">{result.subject}</p>
          </div>
        ) : null}

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Corps
          </p>
          <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
            {result.body}
          </pre>
        </div>

        {result.icebreaker ? (
          <div className="space-y-1 pt-3 border-t border-border/50">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Icebreaker
            </p>
            <p className="text-xs italic text-muted-foreground">
              {result.icebreaker}
            </p>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Aperçu sur un profil de démonstration. Les variables {'{first_name}'},{' '}
        {'{company}'}, {'{job_title}'} sont remplacées par les valeurs réelles à
        l'envoi.
      </p>
    </div>
  );
}
