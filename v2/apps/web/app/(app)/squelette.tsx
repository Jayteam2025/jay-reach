/**
 * Ce qu'on affiche pendant qu'un écran charge ses données.
 *
 * La coquille (barre latérale, carte Moteur, jauge d'envois) vient du
 * `layout.tsx` du groupe de routes (`components/coquille/Coquille`), qui
 * enveloppe déjà `loading.tsx` comme il enveloppe `page.tsx` — ces squelettes
 * ne rendent donc qu'un contenu, jamais une coquille dupliquée.
 *
 * RÈGLE DE CE FICHIER, posée le 05/10 après un audit : un squelette REPREND LES
 * CLASSES DE MISE EN PAGE DE SON ÉCRAN (`.jr-aujourdhui`, `.jr-contenu`,
 * `.jr-reception`, `.jr-table`…), il ne les redessine pas en style en ligne.
 * Les squelettes précédents décrivaient des écrans d'avant la refonte — quatre
 * cartes d'indicateurs puis deux colonnes `1.6fr 1fr` pour un accueil qui est en
 * réalité une grille `1fr 1fr 320px`, une grille de cartes 2×2 pour une liste de
 * campagnes qui est un tableau — d'où un saut de mise en page à chaque
 * remplacement. Réutiliser la classe réelle rend la divergence impossible, et
 * fait suivre gratuitement les points de rupture (le repli en une colonne sous
 * 1240 px vaut aussi pour le squelette).
 *
 * Les largeurs des barres sont volontairement irrégulières : une colonne de
 * barres identiques se lit comme un tableau vide, pas comme du texte qui arrive.
 */

/** Barre grise animée (classe `.jr-skel`, `apps/web/app/styles/composants.css`). */
function Barre({ l, h = 13, mb }: { l: string | number; h?: number; mb?: number }) {
  return <span className="jr-skel" style={{ width: l, height: h, marginBottom: mb }} />;
}

/**
 * Choisit une largeur dans un cycle. `noUncheckedIndexedAccess` est actif : un
 * accès indexé rend `string | undefined` même quand le modulo le rend
 * impossible, et le compilateur a raison de ne pas en juger. Cette fonction
 * porte la garantie une fois pour toutes plutôt que de semer des `??` partout.
 */
function cycle(largeurs: readonly string[], i: number): string {
  return largeurs[i % largeurs.length] ?? largeurs[0] ?? '50%';
}

/**
 * En-tête de page : même boîte que `EnTetePage` (`.jr-entete-page`, flex avec
 * l'action poussée à droite), pour que le titre ne se déplace pas d'un pixel
 * quand le contenu réel arrive.
 */
function EnTete({ action = false }: { action?: boolean }) {
  return (
    <div className="jr-entete-page">
      <div style={{ display: 'grid', gap: 6 }}>
        <Barre l={190} h={26} />
        <Barre l={320} h={15} />
      </div>
      {action ? <Barre l={148} h={34} /> : null}
    </div>
  );
}

/** Carte au titre suivi de quelques lignes : la forme la plus courante. */
function Carte({ lignes = 4, hauteurLigne = 14 }: { lignes?: number; hauteurLigne?: number }) {
  const largeurs = ['62%', '48%', '70%', '54%', '66%', '44%'];
  return (
    <section className="jr-carte" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <Barre l="38%" h={15} />
      {Array.from({ length: lignes }, (_, i) => (
        <Barre key={i} l={cycle(largeurs, i)} h={hauteurLigne} />
      ))}
    </section>
  );
}

/**
 * Tableau : vraies balises `<table className="jr-table">` plutôt qu'une pile de
 * barres, pour hériter des hauteurs de cellule et des filets réels du tableau
 * qui va le remplacer.
 */
function Tableau({ colonnes = 5, lignes = 8 }: { colonnes?: number; lignes?: number }) {
  return (
    <div className="jr-carte">
      <table className="jr-table">
        <thead>
          <tr>
            {Array.from({ length: colonnes }, (_, i) => (
              <th key={i}>
                <Barre l={i === 0 ? 96 : 64} h={11} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: lignes }, (_, i) => (
            <tr key={i}>
              {Array.from({ length: colonnes }, (_, j) => (
                <td key={j}>
                  {j === 0 ? (
                    <div style={{ display: 'grid', gap: 5 }}>
                      <Barre l={cycle(['64%', '52%', '72%', '58%'], i)} h={13} />
                      <Barre l="44%" h={11} />
                    </div>
                  ) : (
                    <Barre l={cycle(['38%', '52%', '30%', '46%'], i + j)} h={12} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Aujourd'hui : `.jr-aujourdhui`, deux colonnes souples puis une colonne fixe de
 * 320 px (à traiter, file du jour, moteur et plafonds), et le tableau des
 * campagnes en pleine largeur.
 */
export function SqueletteTableauDeBord() {
  return (
    <>
      <EnTete action />
      <div className="jr-aujourdhui">
        <Carte lignes={5} />
        <Carte lignes={5} />
        <div className="jr-moteur-plafonds">
          <Carte lignes={3} />
          <Carte lignes={3} />
        </div>
        <div className="pleine">
          <Tableau colonnes={6} lignes={4} />
        </div>
      </div>
    </>
  );
}

/** Campagnes : `.jr-contenu`, le tableau des campagnes en pleine largeur. */
export function SqueletteCampagnes() {
  return (
    <>
      <EnTete action />
      <div className="jr-contenu">
        <div className="pleine">
          <Tableau colonnes={7} lignes={6} />
        </div>
      </div>
    </>
  );
}

/**
 * Réception : `.jr-reception`, trois colonnes (liste des fils, fil, fiche du
 * contact). La colonne de droite disparaît sous 1180 px, comme sur l'écran réel,
 * puisque c'est la même classe qui porte la règle.
 */
export function SqueletteReception() {
  const largeurs = ['38%', '30%', '44%', '34%', '40%', '28%', '36%'];
  return (
    <div className="jr-reception">
      <div style={{ borderRight: '1px solid var(--jr-filet)', padding: '14px 12px', display: 'grid', gap: 2, alignContent: 'start' }}>
        {largeurs.map((l, i) => (
          <div key={i} style={{ display: 'grid', gap: 7, padding: '12px 8px', borderBottom: '1px solid var(--jr-filet)' }}>
            <Barre l={l} h={14} />
            <Barre l={cycle(['72%', '64%', '80%', '58%'], i)} h={12} />
          </div>
        ))}
      </div>
      <div style={{ padding: '18px 20px', display: 'grid', gap: 14, alignContent: 'start' }}>
        <Barre l="46%" h={17} />
        {[180, 120, 200].map((h, i) => (
          <span key={i} className="jr-skel" style={{ height: h, borderRadius: 8 }} />
        ))}
      </div>
      <div style={{ borderLeft: '1px solid var(--jr-filet)', padding: '18px 16px', display: 'grid', gap: 12, alignContent: 'start' }}>
        <Barre l="70%" h={15} />
        <Barre l="52%" h={12} />
        <Barre l="64%" h={12} />
      </div>
    </div>
  );
}

/**
 * Fiche de campagne : en-tête, barre d'onglets, puis `.jr-contenu` (colonne
 * principale et colonne latérale de 340 px). Sert aussi à ses six sous-pages,
 * qui partagent exactement cette ossature.
 */
export function SqueletteFicheCampagne() {
  return (
    <>
      <EnTete action />
      <div style={{ padding: '10px 28px 0' }}>
        <div className="jr-onglets">
          {[86, 74, 96, 68, 80, 92, 70].map((l, i) => (
            <span key={i} style={{ padding: '9px 12px' }}>
              <Barre l={l} h={13} />
            </span>
          ))}
        </div>
      </div>
      <div className="jr-contenu">
        <Carte lignes={6} />
        <Carte lignes={4} />
      </div>
    </>
  );
}

/** Écrans à filtres puis tableau : Contacts et ses onglets. */
export function SqueletteTableauFiltre() {
  return (
    <>
      <EnTete />
      <div className="jr-contenu">
        <div className="pleine" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[92, 116, 84, 104].map((l, i) => (
            <Barre key={i} l={l} h={30} />
          ))}
        </div>
        <div className="pleine">
          <Tableau colonnes={6} lignes={10} />
        </div>
      </div>
    </>
  );
}

/** Écrans en liste de cartes : réglages, personas, expéditeurs, assistant. */
export function SqueletteListe({ cartes = 4, entete = false }: { cartes?: number; entete?: boolean }) {
  return (
    <>
      <EnTete action={entete} />
      <div className="jr-contenu">
        <div className="pleine" style={{ display: 'grid', gap: 14 }}>
          {Array.from({ length: cartes }, (_, i) => (
            <Carte key={i} lignes={3} />
          ))}
        </div>
      </div>
    </>
  );
}
