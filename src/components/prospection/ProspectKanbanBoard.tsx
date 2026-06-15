import { useState, useMemo, useCallback, useRef } from 'react';
import { DragDropProvider } from '@dnd-kit/react';
import { move } from '@dnd-kit/helpers';
import { isSortable } from '@dnd-kit/react/sortable';
import { Prospect, useUpdateProspectStatus } from '@/hooks/useProspects';
import { ProspectKanbanColumn } from './ProspectKanbanColumn';

const STAGES = [
  { key: 'new', label: 'Signal détecté', color: '#60A5FA' },
  { key: 'qualified', label: 'Qualifié', color: '#a78bfa' },
  { key: 'in_sequence', label: 'En séquence', color: '#f59e0b' },
  { key: 'replied', label: 'Répondu', color: '#2ec4b6' },
  { key: 'meeting_booked', label: 'RDV obtenu', color: '#22c55e' },
  { key: 'converted', label: 'Converti', color: '#10b981' },
  { key: 'lost', label: 'Perdu', color: '#ef4444' },
];

interface ProspectKanbanBoardProps {
  prospects: Prospect[];
  onProspectClick: (id: string) => void;
}

export function ProspectKanbanBoard({
  prospects,
  onProspectClick,
}: ProspectKanbanBoardProps) {
  const updateStatus = useUpdateProspectStatus();
  const [activeStageKey, setActiveStageKey] = useState<string | null>(null);

  // Track the original stage before any onDragOver moves happen
  const dragOriginRef = useRef<{ prospectId: string; stageKey: string; index: number } | null>(null);

  // Local state: Record<stageKey, prospectId[]> for dnd-kit move() helper
  const buildProspectsByStage = useCallback(
    (prospectsList: Prospect[]) => {
      const map: Record<string, string[]> = {};
      for (const stage of STAGES) {
        map[stage.key] = [];
      }
      for (const prospect of prospectsList) {
        const status = prospect.status || 'new';
        if (map[status]) {
          map[status].push(prospect.id);
        }
      }
      return map;
    },
    [],
  );

  const [items, setItems] = useState<Record<string, string[]>>(() => buildProspectsByStage(prospects));

  // Keep local state in sync with props (when prospects refresh from server)
  const prevProspectsRef = useRef(prospects);
  if (prospects !== prevProspectsRef.current) {
    prevProspectsRef.current = prospects;
    setItems(buildProspectsByStage(prospects));
  }

  // Snapshot to revert on cancel
  const snapshot = useRef<Record<string, string[]>>(structuredClone(items));

  // Lookup prospects by id for rendering
  const prospectsById = useMemo(() => {
    const map = new Map<string, Prospect>();
    for (const prospect of prospects) {
      map.set(prospect.id, prospect);
    }
    return map;
  }, [prospects]);

  const handleDragStart = useCallback((event: any) => {
    snapshot.current = structuredClone(items);
    // Save origin BEFORE any onDragOver moves
    const source = event.operation?.source;
    if (source) {
      dragOriginRef.current = {
        prospectId: String(source.id),
        stageKey: String(source.group ?? ''),
        index: source.index ?? 0,
      };
    }
  }, [items]);

  const handleDragOver = useCallback(
    (event: any) => {
      setItems((currentItems) => {
        const newItems = move(currentItems, event);
        // Find which stage the dragged item is now in
        const sourceId = String(event.operation?.source?.id ?? '');
        for (const [stageKey, prospectIds] of Object.entries(newItems)) {
          if ((prospectIds).includes(sourceId)) {
            setActiveStageKey(stageKey);
            break;
          }
        }
        return newItems;
      });
    },
    [],
  );

  // Use a ref to always have fresh items for position calculation
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const handleDragEnd = useCallback(
    (event: any) => {
      setActiveStageKey(null);

      if (event.canceled) {
        setItems(snapshot.current);
        return;
      }

      const { source } = event.operation;
      if (!isSortable(source)) return;

      const origin = dragOriginRef.current;
      dragOriginRef.current = null;
      if (!origin) return;

      const prospectId = origin.prospectId;
      const sourceStageKey = origin.stageKey;
      const sourceIndex = origin.index;

      // Current position after all onDragOver moves
      const targetStageKey = String(source.group ?? '');
      const targetIndex = source.index ?? 0;

      // No actual change
      if (sourceStageKey === targetStageKey && sourceIndex === targetIndex) return;

      // Fire mutation to update prospect status
      updateStatus.mutate({
        id: prospectId,
        status: targetStageKey,
      });
    },
    [updateStatus],
  );

  return (
    <DragDropProvider
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="relative flex gap-2 overflow-x-auto py-2 px-2 flex-1 min-h-0 -mx-6">
        {STAGES.map((stage) => (
          <ProspectKanbanColumn
            key={stage.key}
            stageKey={stage.key}
            label={stage.label}
            color={stage.color}
            prospectIds={items[stage.key] ?? []}
            prospectsById={prospectsById}
            onProspectClick={onProspectClick}
            isActive={activeStageKey === stage.key}
          />
        ))}
        <div className="sticky right-0 top-0 bottom-0 w-8 flex-shrink-0 pointer-events-none bg-gradient-to-l from-background to-transparent" />
      </div>
    </DragDropProvider>
  );
}
