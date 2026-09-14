import { IconeLinkedin } from './IconeLinkedin';

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
          <IconeLinkedin />
        </i>
      )}
    </span>
  );
}
