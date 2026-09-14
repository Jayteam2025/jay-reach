export type AvatarTaille = 'normal' | 'grand' | 'xl';
export type AvatarCanal = 'email' | 'linkedin';

export type AvatarProps = {
  nom: string;
  photoUrl?: string | null;
  taille?: AvatarTaille;
  canal?: AvatarCanal;
};

// Initiales = deux premières lettres des deux premiers mots du nom (« Claire Moreau » -> « CM »).
function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (mots.length >= 2) {
    return `${mots[0]?.[0] ?? ''}${mots[1]?.[0] ?? ''}`.toUpperCase();
  }
  return (mots[0] ?? '').slice(0, 2).toUpperCase();
}

export function Avatar({ nom, photoUrl, taille, canal }: AvatarProps) {
  const classe = [
    'jr-avatar',
    photoUrl ? 'photo' : undefined,
    taille && taille !== 'normal' ? taille : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  const style = photoUrl ? { backgroundImage: `url(${photoUrl})` } : undefined;
  return (
    <span className={classe} style={style}>
      {!photoUrl && initiales(nom)}
      {canal === 'email' && <i className="jr-canal em">@</i>}
      {canal === 'linkedin' && (
        <i className="jr-canal li">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
          </svg>
        </i>
      )}
    </span>
  );
}
