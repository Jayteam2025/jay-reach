import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/react';
import { CollisionPriority } from '@dnd-kit/abstract';
import { Prospect } from '@/hooks/useProspects';
import { SortableProspectCard } from './SortableProspectCard';
import { cn } from '@/lib/utils';

interface ProspectKanbanColumnProps {
  stageKey: string;
  label: string;
  color: string;
  prospectIds: string[];
  prospectsById: Map<string, Prospect>;
  onProspectClick: (id: string) => void;
  isActive?: boolean;
}

export function ProspectKanbanColumn({
  stageKey,
  label,
  color,
  prospectIds,
  prospectsById,
  onProspectClick,
  isActive = false,
}: ProspectKanbanColumnProps) {
  const { ref, isDropTarget } = useDroppable({
    id: stageKey,
    type: 'column',
    accept: 'item',
    collisionPriority: CollisionPriority.Low,
  });

  const prospects = useMemo(
    () => prospectIds.map((id) => prospectsById.get(id)).filter(Boolean) as Prospect[],
    [prospectIds, prospectsById],
  );

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl min-w-[280px] w-[280px] flex-shrink-0 transition-all duration-150 border-t-2',
        (isDropTarget || isActive) && 'ring-2 ring-violet-300/50 dark:ring-violet-500/20 bg-violet-50/30 dark:bg-violet-500/[0.03]',
        !isActive && 'border-t-transparent',
      )}
      style={isActive ? { borderTopColor: color } : undefined}
    >
      {/* Header */}
      <div className="px-3 py-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[13px] font-semibold text-gray-800 dark:text-white/80 truncate">{label}</span>
        <span className="flex-shrink-0 min-w-[20px] h-5 rounded-md bg-gray-100 dark:bg-white/5 px-1.5 flex items-center justify-center text-[11px] text-gray-500 dark:text-white/60 font-medium tabular-nums">
          {prospects.length}
        </span>
      </div>

      {/* Droppable zone */}
      <div
        ref={ref}
        className={cn(
          'flex-1 flex flex-col gap-1.5 px-1.5 pb-3 min-h-[120px] rounded-lg transition-colors duration-150',
          (isDropTarget || isActive) && 'bg-violet-50/80 dark:bg-violet-500/[0.08]',
        )}
      >
        {prospects.map((prospect, index) => (
          <SortableProspectCard
            key={prospect.id}
            id={prospect.id}
            index={index}
            prospect={prospect}
            onClick={() => onProspectClick(prospect.id)}
            group={stageKey}
          />
        ))}

        {prospects.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-10">
            <span className="text-[12px] text-gray-400 dark:text-white/40">Aucun prospect</span>
          </div>
        )}
      </div>
    </div>
  );
}
