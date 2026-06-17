import { useProspectSequences, ProspectSequence } from '@/hooks/useProspectConfig';
import { Badge } from '@/components/ui/badge';
import { Mail, Instagram, FileText, Loader2 } from 'lucide-react';

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  instagram: Instagram,
  letter: FileText,
};

export function ProspectionSequences() {
  const { data: sequences = [], isLoading } = useProspectSequences();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-foreground/50" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Séquences</h2>
        <p className="text-foreground/60 mt-1">Créez et automatisez vos séquences de prospection</p>
      </div>

      {/* Sequences list */}
      {sequences.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground">Aucune séquence configurée</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {sequences.map((sequence: ProspectSequence) => {
            const steps = sequence.steps || [];
            return (
              <div
                key={sequence.id}
                className="rounded-lg border border-border bg-card p-4 hover:bg-card/80 transition-colors hover:shadow-md"
              >
                <div className="space-y-3">
                  {/* Header: Name + Active Badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-foreground">{sequence.name}</h3>
                    </div>
                    <Badge variant={sequence.is_active ? 'default' : 'secondary'}>
                      {sequence.is_active ? 'Actif' : 'Inactif'}
                    </Badge>
                  </div>

                  {/* Steps visualization */}
                  {steps.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">{steps.length} étapes</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {steps.map((step, idx: number) => {
                          const Icon = CHANNEL_ICONS[step.channel] || Mail;
                          return (
                            <div key={idx} className="flex items-center">
                              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-foreground/5 border border-border text-xs">
                                <Icon className="w-3 h-3 text-foreground/60" />
                                <span className="text-foreground/60">J+{step.delay_days ?? step.day ?? 0}</span>
                              </div>
                              {idx < steps.length - 1 && (
                                <div className="mx-1 text-foreground/30">→</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
