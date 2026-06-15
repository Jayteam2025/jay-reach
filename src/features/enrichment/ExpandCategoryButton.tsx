import { Button } from '@/components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import type { EnrichedCompany } from '@/hooks/useEnrichedCompanies';
import { useExpandCategory, type ExpandCategory } from './useCompanyEnrichment';

/**
 * ExpandCategoryButton — si FullEnrich a encore X contacts dispo dans cette
 * categorie, affiche un bouton "En scraper N de plus" (Jay Reach 1.5.3).
 */
export function ExpandCategoryButton({
  company,
  category,
  label,
}: {
  company: EnrichedCompany;
  category: ExpandCategory;
  label: string;
}) {
  const { moreAvailable, expand, isExpanding } = useExpandCategory(company, category, label);

  if (moreAvailable <= 0) return null;

  return (
    <div className="flex items-center justify-between border-t border-border/50 pt-6 -mx-5 px-5">
      <p className="text-[13px] text-muted-foreground">
        <span className="text-foreground font-medium">{moreAvailable}</span>
        {' '}autre{moreAvailable > 1 ? 's' : ''} {label} disponible{moreAvailable > 1 ? 's' : ''} dans FullEnrich
      </p>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-[12px]"
        onClick={expand}
        disabled={isExpanding}
      >
        {isExpanding ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Plus className="w-3.5 h-3.5" />
        )}
        En scraper {Math.min(10, moreAvailable)} de plus
      </Button>
    </div>
  );
}
