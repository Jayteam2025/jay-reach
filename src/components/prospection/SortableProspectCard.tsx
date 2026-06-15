import { useSortable } from '@dnd-kit/react/sortable';
import { Prospect } from '@/hooks/useProspects';
import { ProspectCard } from './ProspectCard';

interface SortableProspectCardProps {
  id: string;
  index: number;
  prospect: Prospect;
  onClick?: () => void;
  group: string;
}

export function SortableProspectCard({
  id,
  index,
  prospect,
  onClick,
  group,
}: SortableProspectCardProps) {
  const { ref, isDragging } = useSortable({
    id,
    index,
    group,
    type: 'item',
    accept: 'item',
  });

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-roledescription="element deplacable"
      aria-label={`${prospect.first_name} ${prospect.last_name}`}
      onClick={onClick}
      data-dragging={isDragging || undefined}
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      <ProspectCard prospect={prospect} onClick={onClick} />
    </div>
  );
}
