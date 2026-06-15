/**
 * Detecte les noms d'entreprise qui sont en realite des fragments de descriptions
 * d'offres (job title, type de contrat, phrase de pitch).
 *
 * Cas reels trouves le 2026-05-17 sur France Travail (offres confidentielles) :
 *   - "KEY ACCOUNT MANAGER H/F Rattache"   <- job title brut
 *   - "CDI temps plein - Toulon"            <- contrat + ville
 *   - "Vos missions Rattache"               <- debut de paragraphe missions
 *
 * Returns true si le nom DOIT etre rejete (job title fragment, pas une entreprise).
 */
export function looksLikeJobTitleFragment(name: string | null | undefined): boolean {
  if (!name) return false;
  const s = name.trim();
  if (!s) return false;
  const lower = s.toLowerCase();

  // Marqueurs de genre H/F, F/H, M/F, F/M (jamais dans un vrai nom d'entreprise)
  if (/\b(h\s*\/\s*f|f\s*\/\s*h|m\s*\/\s*f|f\s*\/\s*m|h\.f|f\.h)\b/i.test(s)) return true;

  // Type de contrat en debut de chaine
  if (/^(cdi|cdd|cdii|stage|alternance|interim|intérim|freelance|stagiaire)\b/i.test(s)) return true;
  // Type de contrat n'importe ou (temps plein/partiel)
  if (/\b(temps plein|temps partiel|mi-temps)\b/i.test(lower)) return true;

  // Debut de paragraphe d'offre type "Vos missions...", "Notre client...", "Vos taches..."
  if (/^(vos|votre|nos|notre|mes)\s+(missions?|tâches|taches|responsabilités|responsabilites|objectifs?|enjeux|defis|défis)\b/i.test(s)) return true;
  // "Notre client" / "Notre partenaire" en debut
  if (/^(notre|nos)\s+(client|partenaire|equipe|équipe|société|societe|entreprise|groupe|filiale)s?\b/i.test(s)) return true;

  // Participe passe en fin de chaine = phrase tronquee ("X est Rattaché", "Y est Basé")
  if (/\b(rattaché[e]?s?|rattache[e]?s?|basé[e]?s?|base[e]?s?|situé[e]?s?|situe[e]?s?|intégré[e]?s?|integre[e]?s?|doté[e]?s?|dote[e]?s?|impliqué[e]?s?|implique[e]?s?)\s*$/i.test(lower)) return true;

  // Mots-cles de job title (jamais dans un vrai nom d'entreprise legitime)
  const jobTitleKeywords = [
    'key account manager', 'business developer', 'account executive',
    'product owner', 'business analyst', 'data analyst', 'community manager',
    'project manager', 'sales manager', 'sales executive', 'sales director',
    'directeur commercial', 'directrice commerciale',
    'responsable commercial', 'responsable commerciale',
    'commercial terrain', 'technico-commercial', 'technico commercial',
    'chef de secteur', 'chef de zone', 'chef des ventes', 'chef de ventes',
    'attaché commercial', 'attache commercial',
    'ingénieur commercial', 'ingenieur commercial',
    "chargé d'affaires", "charge d'affaires",
    'chargé de clientèle', 'charge de clientele',
    'consultant commercial', 'conseiller commercial',
  ];
  if (jobTitleKeywords.some(kw => lower.includes(kw))) return true;

  // 3+ mots tout-majuscules consecutifs = job title brut type "KEY ACCOUNT MANAGER"
  // (les vrais noms style "BNP PARIBAS", "AIR FRANCE" font 2 mots max ALL CAPS)
  const tokens = s.split(/\s+/);
  const allCapsCount = tokens.filter(w => /^[A-Z][A-Z0-9]+$/.test(w)).length;
  if (allCapsCount >= 3) return true;

  // 1 seul mot qui est un stop word francais courant (pronom, participe, langue, etc.)
  // Catche les bouts de phrase qui se sont retrouves seuls comme nom d'entreprise.
  // Cas reels : "Issu", "Elle", "Intéressé", "ANGLAIS", "Oretc" (typo proche d'Ortec)
  if (tokens.length === 1) {
    const singleWordStopWords = new Set([
      // Pronoms personnels / demonstratifs
      'elle', 'il', 'lui', 'eux', 'ils', 'elles', 'ce', 'ca', 'ça', 'on', 'celle', 'celui', 'ceux', 'celles',
      // Participes passes / adjectifs courants
      'issu', 'issue', 'issus', 'issues',
      'interesse', 'interessé', 'intéressé', 'interessée', 'intéressée',
      'rattache', 'rattaché', 'rattachee', 'rattachée',
      'base', 'basé', 'basee', 'basée',
      'situe', 'situé', 'situee', 'située',
      'integre', 'intégré', 'integree', 'intégrée',
      'donne', 'donné', 'donnee', 'donnée',
      'pris', 'prise', 'recu', 'reçu', 'recue', 'reçue',
      // Adjectifs / determinants qui suggerent une troncature ("Caisse d'Epargne Grand")
      'grand', 'grande', 'petit', 'petite', 'haut', 'haute', 'bas', 'basse',
      'nouveau', 'nouvelle', 'vieux', 'vieille', 'jeune',
      'fort', 'forte', 'long', 'longue', 'court', 'courte',
      // Langues / disciplines (jamais un nom d'entreprise legitime en 1 mot)
      'anglais', 'français', 'francais', 'allemand', 'espagnol', 'italien', 'chinois',
      'informatique', 'mathematiques', 'mathématiques', 'physique', 'chimie',
      // Mots de transition / verbes
      'participer', 'gerer', 'gérer', 'piloter', 'animer', 'développer', 'developper',
    ]);
    const lowerSingle = tokens[0].toLowerCase().replace(/[.,;:!?]$/, '');
    if (singleWordStopWords.has(lowerSingle)) return true;
  }

  // Debut par un verbe a l'infinitif suivi d'une preposition (fragment de phrase d'offre)
  // Cas reel : "Participer aux ..."
  if (/^(participer|gerer|gérer|piloter|animer|développer|developper|réaliser|realiser|construire|garantir|fideliser|fidéliser|valoriser|securiser|sécuriser)\s+(au|aux|à|a|aux|le|la|les|des|de|du|en)\b/i.test(s)) {
    return true;
  }

  // Debut par un nom abstrait de management + "de" + autre nom = description, pas une entreprise
  // Cas reel : "Gestion de Portefeuilles existants"
  if (/^(gestion|direction|développement|developpement|stratégie|strategie|planification|optimisation|coordination|administration|encadrement|supervision)\s+(de\s+|des\s+|du\s+|d'|de la\s+|de l')/i.test(s)) {
    return true;
  }

  // Fin par un mot tronque typique de nom compose ("Caisse d'Epargne Grand" -> "Grand Est")
  // Detecte les noms qui finissent juste avant la specification geographique habituelle.
  if (tokens.length >= 2) {
    const lastWord = tokens[tokens.length - 1].toLowerCase().replace(/[.,;:!?]$/, '');
    const truncationSuffixes = new Set([
      'grand', 'grande', 'saint', 'sainte', 'nouvelle', 'nouveau',
      'pays', 'haut', 'haute', 'bas', 'basse', 'centre', 'rhin',
    ]);
    if (truncationSuffixes.has(lastWord)) return true;
  }

  return false;
}
