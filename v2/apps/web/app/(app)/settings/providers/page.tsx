import { getTranslations } from 'next-intl/server';
import { listerFournisseurs, type FournisseurVue } from '@jay-reach/core';
import { getProviderEntry } from '@jay-reach/providers';
import { contexteCourant } from '../../../../lib/contexte';
import { dateCourte, FUSEAU_PAR_DEFAUT } from '../../../../lib/dates';
import { CarteFournisseur, type ChampCleFournisseur, type InfoFournisseur } from '../../../../components/reglages/CarteFournisseur';
import type { PuceTon, TuileLogoMarque } from '../../../../components/ui';

export const revalidate = 0;

/** Tuile de logo par fournisseur — les trois marques réelles du kit (`TuileLogo`), une lettre pour les sept autres (brief tâche 21 : « logo ou initiales »). */
const TUILES: Record<string, { marque: TuileLogoMarque; lettre?: string }> = {
  anthropic: { marque: 'lettre', lettre: 'A' },
  fullenrich: { marque: 'lettre', lettre: 'F' },
  dropcontact: { marque: 'lettre', lettre: 'D' },
  bouncer: { marque: 'lettre', lettre: 'B' },
  reoon: { marque: 'lettre', lettre: 'R' },
  salesblink: { marque: 'lettre', lettre: 'S' },
  microsoft_graph: { marque: 'microsoft' },
  adzuna: { marque: 'adzuna' },
  francetravail: { marque: 'francetravail' },
  apify: { marque: 'lettre', lettre: 'Ap' },
};

function composerMasque(champsNonSecrets: ChampCleFournisseur[], config: Record<string, string> | null, dernierCaracteres: string | null): string {
  const bullets = `••••••••••••${dernierCaracteres ?? ''}`;
  const premier = champsNonSecrets[0];
  const valeurConnue = premier && config?.[premier.name];
  return valeurConnue ? `${premier.name} ${valeurConnue} ${bullets}` : bullets;
}

export default async function ProvidersPage() {
  const t = await getTranslations('reglages.fournisseurs');
  // Traducteur racine (sans namespace) : `PROVIDER_CATALOG` (@jay-reach/providers) porte des
  // `labelKey`/`hintKey` en chemin complet depuis la racine des messages (`providers.field.apiKey`),
  // déjà traduits pour l'ancien écran — réutilisés tels quels, pas de doublon sous `reglages.fournisseurs`.
  const tChamps = await getTranslations();
  const ctx = await contexteCourant();
  const fournisseurs = await listerFournisseurs(ctx);
  const peutModifier = ctx.role === 'admin' || ctx.role === 'owner';
  const maintenant = new Date();
  // `reglages.fuseau` n'est pas relu ici (dette R67 bis, `lireReglages` non appelé sur cet
  // écran) : cette page ne montre pas de date propre à l'organisation à part « Dernier
  // test »/« relève », déjà en UTC côté source — le fuseau par défaut suffit tant qu'aucun
  // texte de cet écran n'en dépend réellement.
  const fuseau = FUSEAU_PAR_DEFAUT;

  function libelleEtat(f: FournisseurVue): { ton: PuceTon; texte: string } {
    if (!f.cle.presente) return { ton: 'gris', texte: t('etat.aRenseigner') };
    if (f.cle.statut === 'echec') return { ton: 'attention', texte: t('etat.echec') };
    const connecte = f.categorie === 'envoi' || f.categorie === 'reception';
    return { ton: 'bon', texte: connecte ? t('etat.connecte') : t('etat.cleValide') };
  }

  function infosDuFournisseur(f: FournisseurVue): InfoFournisseur[] {
    const infos: InfoFournisseur[] = [];

    if (f.releve) {
      infos.push({
        libelle: t('colDernierTest'),
        valeur: f.releve.derniereErreur
          ? t('echec', { date: dateCourte(f.releve.dernierPassage ?? new Date().toISOString(), maintenant, fuseau) })
          : f.releve.dernierPassage
            ? t('reussi', { date: dateCourte(f.releve.dernierPassage, maintenant, fuseau) })
            : t('jamaisTeste'),
      });
    } else {
      infos.push({
        libelle: t('colDernierTest'),
        valeur: f.cle.testeeLe ? t('reussi', { date: dateCourte(f.cle.testeeLe, maintenant, fuseau) }) : t('jamaisTeste'),
      });
    }

    let valeurAujourdhui: string = t('sansDonnee');
    if (f.consommationDuJour) {
      const cle = f.providerId === 'anthropic' ? 'scorings' : f.providerId === 'fullenrich' ? 'enrichissements' : 'envois';
      valeurAujourdhui = t(`consommation.${cle}`, {
        utilise: f.consommationDuJour.utilise,
        plafond: f.consommationDuJour.plafond,
      });
    }
    const lien =
      f.lienPlafond != null
        ? { href: f.lienPlafond, texte: t('lien.reglerPlafond') }
        : f.providerId === 'salesblink'
          ? { href: '/settings/senders', texte: t('lien.voirLesBoites') }
          : f.providerId === 'adzuna' || f.providerId === 'francetravail'
            ? { href: '/campaigns', texte: t('lien.voirLesCampagnes') }
            : undefined;
    infos.push({ libelle: t('colAujourdhui'), valeur: valeurAujourdhui, lien });

    return infos;
  }

  return (
    <div style={{ display: 'grid', gap: 16, alignContent: 'start', minWidth: 0 }}>
      <div className="jr-section-entete">
        <div>
          <h2>{t('title')}</h2>
          <p>{t('lead')}</p>
        </div>
      </div>

      <div className="jr-deux-colonnes">
        {fournisseurs.map((f) => {
          const manifest = getProviderEntry(f.providerId);
          const champs: ChampCleFournisseur[] = (manifest?.fields ?? [])
            .filter((champ) => champ.required)
            .map((champ) => ({
              name: champ.name,
              libelle: tChamps(champ.labelKey),
              secret: champ.secret,
              required: champ.required,
              aide: champ.hintKey ? tChamps(champ.hintKey) : undefined,
            }));

          const champsNonSecrets = champs.filter((c) => !c.secret);

          return (
            <CarteFournisseur
              key={f.providerId}
              providerId={f.providerId}
              nom={t(`nom.${f.providerId}`)}
              description={t(`description.${f.providerId}`)}
              tuile={TUILES[f.providerId] ?? { marque: 'lettre', lettre: '?' }}
              etat={libelleEtat(f)}
              champs={champs}
              presente={f.cle.presente}
              masque={composerMasque(champsNonSecrets, f.config, f.cle.dernierCaracteres)}
              infos={infosDuFournisseur(f)}
              peutModifier={peutModifier}
              libelles={{
                champCle: t('champCle'),
                remplacer: t('remplacer'),
                enregistrer: t('enregistrer'),
                annuler: t('annuler'),
                tester: t('tester'),
                enregistrementEnCours: t('enregistrementEnCours'),
                placeholderSecret: t('placeholderSecret'),
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
