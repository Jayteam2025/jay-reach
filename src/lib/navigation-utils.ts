const NON_NAVIGABLE_PATTERNS = [
  /^https?:\/\//i,
  /zoom/i,
  /teams/i,
  /meet\.google/i,
  /webex/i,
  /skype/i,
  /^tel:/i,
];

export function isNavigableLocation(location: string): boolean {
  if (!location || typeof location !== 'string') return false;
  const trimmed = location.trim();
  if (trimmed.length < 5) return false;
  return !NON_NAVIGABLE_PATTERNS.some(pattern => pattern.test(trimmed));
}

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export function getNavigationUrl(location: string): string {
  const encoded = encodeURIComponent(location);
  if (isMobile()) {
    return `https://waze.com/ul?q=${encoded}&navigate=yes`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
}
