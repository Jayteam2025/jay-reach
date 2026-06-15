import { Navigation } from 'lucide-react';
import { isNavigableLocation, getNavigationUrl } from '@/lib/navigation-utils';
import { cn } from '@/lib/utils';

interface NavigationLinkProps {
  location: string;
  className?: string;
}

export function NavigationLink({ location, className }: NavigationLinkProps) {
  if (!isNavigableLocation(location)) return null;

  return (
    <a
      href={getNavigationUrl(location)}
      target="_blank"
      rel="noopener noreferrer"
      title="Itinéraire"
      className={cn(
        'inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline',
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <Navigation className="h-3 w-3" />
      <span>Itinéraire</span>
    </a>
  );
}
