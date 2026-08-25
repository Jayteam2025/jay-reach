/** Libellé court et lisible d'un fournisseur/source à partir de son identifiant. */
const PROVIDER_LABELS: Record<string, string> = {
  'jobboard.francetravail': 'France Travail',
  'jobboard.adzuna': 'Adzuna',
  'jobboard.apify': 'Apify',
  francetravail: 'France Travail',
  adzuna: 'Adzuna',
  apify: 'Apify',
};

export function providerLabel(id: string | null | undefined): string {
  if (!id) return '—';
  if (PROVIDER_LABELS[id]) return PROVIDER_LABELS[id];
  const tail = id.split('.').pop() ?? id;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}
