import { useState } from 'react';
import { useProspects } from '@/hooks/useProspects';
import { ProspectKanbanBoard } from './ProspectKanbanBoard';
import { ProspectSidePanel } from './ProspectSidePanel';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ProspectionPipeline() {
  const { data: prospects, isLoading } = useProspects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const handleProspectClick = (id: string) => {
    setSelectedId(id);
    setPanelOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold text-foreground title-glow">Pipeline</h2>
          <p className="text-sm text-muted-foreground">{prospects?.length || 0} prospects</p>
        </div>
        <Button size="sm" variant="default" className="gap-2">
          <Plus className="w-4 h-4" />
          Nouveau prospect
        </Button>
      </div>
      <ProspectKanbanBoard prospects={prospects || []} onProspectClick={handleProspectClick} />
      <ProspectSidePanel
        prospectId={selectedId}
        open={panelOpen}
        onOpenChange={setPanelOpen}
      />
    </div>
  );
}
