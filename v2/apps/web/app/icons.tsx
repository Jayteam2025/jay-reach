/** Icônes inline (aucune dépendance externe). currentColor, taille via CSS. */
import type { SVGProps } from 'react';

export type IconName =
  | 'dashboard'
  | 'signals'
  | 'prospects'
  | 'campaigns'
  | 'inbox'
  | 'sources'
  | 'personas'
  | 'providers'
  | 'branding'
  | 'mail'
  | 'linkedin'
  | 'phone'
  | 'chevron';

const S = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  switch (name) {
    case 'dashboard':
      return (
        <svg {...S} {...props}>
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      );
    case 'signals':
      return (
        <svg {...S} {...props}>
          <path d="M5 12a7 7 0 0 1 7-7" />
          <path d="M8.5 12a3.5 3.5 0 0 1 3.5-3.5" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <path d="M19 12a7 7 0 0 1-7 7" />
        </svg>
      );
    case 'prospects':
      return (
        <svg {...S} {...props}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      );
    case 'campaigns':
      return (
        <svg {...S} {...props}>
          <path d="M21 3 10.5 13.5" />
          <path d="M21 3l-6.5 18-4-8-8-4Z" />
        </svg>
      );
    case 'inbox':
      return (
        <svg {...S} {...props}>
          <path d="M3 12h5l1.5 2.5h5L16 12h5" />
          <path d="M5 6h14l2 6v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" />
        </svg>
      );
    case 'sources':
      return (
        <svg {...S} {...props}>
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case 'personas':
      return (
        <svg {...S} {...props}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <path d="M16 5.5a3 3 0 0 1 0 5.8" />
          <path d="M17 14.2a5.5 5.5 0 0 1 3.5 5" />
        </svg>
      );
    case 'providers':
      return (
        <svg {...S} {...props}>
          <circle cx="8" cy="15" r="4" />
          <path d="M10.8 12.2 20 3" />
          <path d="M16 7l3 3" />
          <path d="M14.5 8.5l3 3" />
        </svg>
      );
    case 'branding':
      return (
        <svg {...S} {...props}>
          <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.5-9-7.5Z" />
          <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="11" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'mail':
      return (
        <svg {...S} {...props}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      );
    case 'linkedin':
      return (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" {...props}>
          <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.8 0 0 .78 0 1.74v20.52C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.74V1.74C24 .78 23.2 0 22.22 0Z" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...S} {...props}>
          <path d="M6.5 3.5 9 4l1 3.5-2 1.5a11 11 0 0 0 5 5l1.5-2 3.5 1 .5 2.5a2 2 0 0 1-2 2.3A16 16 0 0 1 4.2 5.5a2 2 0 0 1 2.3-2Z" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...S} {...props}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
  }
}
