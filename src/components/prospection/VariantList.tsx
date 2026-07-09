import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';

interface VariantListProps {
  label: string;
  description?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  minRows?: number;
}

export function VariantList({
  label,
  description,
  value,
  onChange,
  placeholder = 'Variante…',
  minRows = 1,
}: VariantListProps) {
  const [newValue, setNewValue] = useState('');

  function updateAt(index: number, next: string) {
    const copy = [...value];
    copy[index] = next;
    onChange(copy);
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function add() {
    const trimmed = newValue.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
    setNewValue('');
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            {label}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {value.length} variante{value.length > 1 ? 's' : ''}
            </span>
          </h4>
          {description ? (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          ) : null}
        </div>
      </div>

      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-3 py-2 rounded-md glass">
          Aucune variante. Ajoute-en au moins une.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {value.map((variant, idx) => (
            <li
              key={idx}
              className="group flex items-start gap-2 rounded-md glass px-3 py-2 transition-colors hover:border-violet-500/40 focus-within:border-violet-500"
            >
              <textarea
                value={variant}
                onChange={(e) => updateAt(idx, e.target.value)}
                rows={minRows}
                className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
                placeholder={placeholder}
              />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                aria-label="Supprimer cette variante"
                className="shrink-0 mt-0.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Nouvelle variante… (Entrée pour ajouter)"
          className="flex-1 rounded-md border border-border bg-foreground/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={!newValue.trim()}
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          Ajouter
        </Button>
      </div>
    </div>
  );
}
