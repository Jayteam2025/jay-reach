/**
 * Ce qu'on affiche pendant qu'un écran charge ses données.
 *
 * La coquille (barre latérale, carte Moteur, jauge d'envois) vient du
 * `layout.tsx` du groupe de routes (`components/coquille/Coquille`), qui
 * enveloppe déjà `loading.tsx` comme il enveloppe `page.tsx` — ces squelettes
 * ne rendent donc plus qu'un contenu, jamais une coquille dupliquée. Jusqu'à
 * la tâche 24, un second exemplaire de la barre latérale (jetons `rs-*`,
 * routes d'avant la refonte) s'affichait par-dessus la vraie le temps du
 * chargement.
 *
 * Chaque écran garde SA forme : un squelette générique ferait sauter la mise
 * en page au remplacement, ce qui est plus désagréable qu'un écran vide.
 */

/** Barre grise animée (classe `.jr-skel`, `apps/web/app/styles/composants.css`). */
function Barre({ l, h = 13, mb }: { l: string | number; h?: number; mb?: number }) {
  return <span className="jr-skel" style={{ width: l, height: h, marginBottom: mb }} />;
}

/** Surtitre, titre, chapô : toutes les pages ouvrent pareil. */
function EnTete({ chapo = 2 }: { chapo?: number }) {
  return (
    <>
      <Barre l={90} h={11} mb={10} />
      <Barre l="42%" h={32} mb={14} />
      {Array.from({ length: chapo }, (_, i) => (
        <Barre key={i} l={i === 0 ? '68%' : '44%'} h={15} mb={i === chapo - 1 ? 24 : 6} />
      ))}
    </>
  );
}

/**
 * Aujourd'hui : quatre indicateurs, deux panneaux côte à côte, puis les deux
 * listes du bas.
 */
export function SqueletteTableauDeBord() {
  return (
    <div style={{ padding: '22px 28px 28px' }}>
      <EnTete />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="jr-carte" style={{ display: 'grid', gap: 8, padding: 14 }}>
            <Barre l="62%" h={17} />
            <Barre l={64} h={33} />
            <Barre l="48%" h={18} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginTop: 16 }}>
        <section className="jr-carte" style={{ display: 'grid', gap: 12, padding: 16 }}>
          <Barre l="30%" h={11} />
          <span className="jr-skel" style={{ height: 210, borderRadius: 6 }} />
        </section>
        <section className="jr-carte" style={{ display: 'grid', gap: 12, padding: 16 }}>
          <Barre l="52%" h={11} />
          <span className="jr-skel" style={{ height: 210, borderRadius: 6 }} />
        </section>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginTop: 16 }}>
        <section className="jr-carte" style={{ display: 'grid', gap: 14, padding: 16 }}>
          <Barre l="36%" h={11} />
          {['52%', '44%', '58%', '40%', '50%'].map((l, i) => (
            <div key={i} style={{ display: 'grid', gap: 6 }}>
              <Barre l={l} h={14} />
              <Barre l="70%" h={11} />
            </div>
          ))}
        </section>
        <section className="jr-carte" style={{ display: 'grid', gap: 10, padding: 16 }}>
          <Barre l="46%" h={11} />
          <Barre l="80%" h={13} />
        </section>
      </div>
    </div>
  );
}

/** Campagnes : en-tête à deux boutons, puis la grille de deux colonnes. */
export function SqueletteCampagnes() {
  return (
    <div style={{ padding: '22px 28px 28px' }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <EnTete chapo={1} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Barre l={132} h={34} />
          <Barre l={148} h={34} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, marginTop: 18 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="jr-carte" style={{ display: 'grid', gap: 12, padding: 16 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Barre l="46%" h={15} />
              <span className="jr-skel" style={{ width: 58, height: 20, borderRadius: 999 }} />
            </div>
            <Barre l="100%" h={6} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', rowGap: 12, columnGap: 12 }}>
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} style={{ display: 'grid', gap: 5 }}>
                  <Barre l={46} h={20} />
                  <Barre l="66%" h={11} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Réception : une liste de conversations, deux lignes et une pastille chacune. */
export function SqueletteReception() {
  const gauche = ['38%', '30%', '44%', '34%', '40%', '28%'];
  const droite = ['72%', '64%', '80%', '58%', '70%', '66%'];
  return (
    <div style={{ padding: '22px 28px 28px' }}>
      <EnTete />
      <div style={{ display: 'grid', gap: 0 }}>
        {gauche.map((l, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 12,
              padding: '14px 0',
              borderTop: '1px solid var(--jr-filet)',
            }}
          >
            <div style={{ display: 'grid', gap: 7 }}>
              <Barre l={l} h={14} />
              <Barre l={droite[i] ?? '70%'} h={12} />
            </div>
            <span className="jr-skel" style={{ width: 64, height: 20, borderRadius: 999 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Écrans en liste de cartes : campagne (nouvelle/fiche), personas, expéditeurs. */
export function SqueletteListe({ cartes = 4, entete = false }: { cartes?: number; entete?: boolean }) {
  return (
    <div style={{ padding: '22px 28px 28px' }}>
      {entete ? (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <EnTete chapo={1} />
          </div>
          <Barre l={148} h={34} />
        </div>
      ) : (
        <EnTete />
      )}
      <div style={{ display: 'grid', gap: 14, marginTop: entete ? 4 : 0 }}>
        {Array.from({ length: cartes }, (_, i) => (
          <section key={i} className="jr-carte" style={{ display: 'grid', gap: 10, padding: 16 }}>
            <Barre l={['42%', '34%', '48%', '38%', '44%'][i % 5] ?? '40%'} h={15} />
            <Barre l="86%" h={13} />
            <Barre l="62%" h={13} />
          </section>
        ))}
      </div>
    </div>
  );
}
