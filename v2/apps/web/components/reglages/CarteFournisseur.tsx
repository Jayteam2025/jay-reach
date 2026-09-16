'use client';

/**
 * Carte fournisseur de l'écran Réglages › Fournisseurs (tâche 21, maquette
 * `reglages-fournisseurs.html`) : tuile + nom + description, statut de la
 * clé, formulaire « Remplacer » (secret + champs non secrets du catalogue),
 * bouton « Tester », et une colonne d'informations libre (dernier test,
 * consommation du jour, relève…) fournie par la page — chaque fournisseur a
 * sa propre combinaison de chiffres, pas de forme unique à standardiser ici.
 */
import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Bouton, Carte, Champ, Puce, TuileLogo } from '../ui';
import type { PuceTon, TuileLogoMarque } from '../ui';
import { actionEnregistrerCle, actionModifierConfigFournisseur, actionTesterFournisseur } from '../../app/actions/providers';

export interface ChampCleFournisseur {
  name: string;
  libelle: string;
  secret: boolean;
  required: boolean;
  aide?: string;
  exemple?: string;
}

/**
 * Champ non secret optionnel du catalogue (`sync_interval_min`, `reply_max_delay_h`,
 * `model_smart`…) — relecture tâche 21, point 2 : affiché avec sa valeur courante et
 * modifiable SANS passer par « Remplacer » (donc sans retaper le secret), via
 * `modifierConfigFournisseur`/`merge_provider_config`.
 */
export interface ChampConfigFournisseur {
  name: string;
  libelle: string;
  valeurActuelle: string;
  aide?: string;
}

export interface InfoFournisseur {
  libelle: string;
  valeur: ReactNode;
  lien?: { href: string; texte: string };
}

export interface CarteFournisseurProps {
  providerId: string;
  nom: string;
  description: string;
  tuile: { marque: TuileLogoMarque; lettre?: string };
  etat: { ton: PuceTon; texte: string };
  /** Champs requis du catalogue (le secret et l'identité minimale, ex. app_id) — formulaire « Remplacer ». */
  champs: ChampCleFournisseur[];
  /** Champs optionnels du catalogue (sync_interval_min, model_smart…) — bloc « Réglages » toujours visible, indépendant de « Remplacer ». */
  champsConfig: ChampConfigFournisseur[];
  presente: boolean;
  /** 4 derniers caractères connus, pour composer le masque « ••••1234 » — la page les lit dans `config`/`last4` si elle en a, sinon un masque générique. */
  masque: string;
  infos: InfoFournisseur[];
  /** `ctx.role` au moins `admin` (brief : « rôle admin pour les écritures ») — sinon la carte est lecture seule, sans « Remplacer »/« Tester » ni formulaire. */
  peutModifier: boolean;
  libelles: {
    champCle: string;
    remplacer: string;
    enregistrer: string;
    annuler: string;
    tester: string;
    enregistrementEnCours: string;
    placeholderSecret: string;
    reglagesTitre: string;
    enregistrerReglages: string;
  };
}

export function CarteFournisseur({
  providerId,
  nom,
  description,
  tuile,
  etat,
  champs,
  champsConfig,
  presente,
  masque,
  infos,
  peutModifier,
  libelles,
}: CarteFournisseurProps) {
  const router = useRouter();
  const [enEdition, setEnEdition] = useState(peutModifier && !presente);
  const [valeurs, setValeurs] = useState<Record<string, string>>({});
  const [valeursConfig, setValeursConfig] = useState<Record<string, string>>({});
  const [pendingSave, startSave] = useTransition();
  const [pendingTest, startTest] = useTransition();
  const [pendingConfig, startConfig] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const champSecret = champs.find((c) => c.secret);

  function annuler() {
    setValeurs({});
    setErreur(null);
    setEnEdition(false);
  }

  function enregistrer() {
    setErreur(null);
    const secret = champSecret ? (valeurs[champSecret.name] ?? '') : '';
    const config: Record<string, string> = {};
    for (const champ of champs) {
      if (!champ.secret) config[champ.name] = valeurs[champ.name] ?? '';
    }
    startSave(async () => {
      const res = await actionEnregistrerCle(providerId, secret, config);
      if (res.ok) {
        setValeurs({});
        setEnEdition(false);
        router.refresh();
      } else {
        setErreur(res.error);
      }
    });
  }

  function enregistrerConfig() {
    setErreur(null);
    const config: Record<string, string> = {};
    for (const champ of champsConfig) {
      config[champ.name] = valeursConfig[champ.name] ?? champ.valeurActuelle;
    }
    startConfig(async () => {
      const res = await actionModifierConfigFournisseur(providerId, config);
      if (res.ok) {
        setValeursConfig({});
        router.refresh();
      } else {
        setErreur(res.error);
      }
    });
  }

  function tester() {
    setErreur(null);
    startTest(async () => {
      const res = await actionTesterFournisseur(providerId);
      if (!res.ok) setErreur(res.error);
      else router.refresh();
    });
  }

  return (
    <Carte
      entete={
        <>
          <div className="jr-qui">
            <TuileLogo marque={tuile.marque} lettre={tuile.lettre} taille="grande" />
            <span>
              <b style={{ fontSize: 16 }}>{nom}</b>
              <small>{description}</small>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Puce ton={etat.ton} point>
              {etat.texte}
            </Puce>
          </div>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 18, paddingTop: 12 }}>
        <div>
          <span className="jr-libelle">{libelles.champCle}</span>
          {!enEdition ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="jr-champ" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, padding: '5px 10px' }}>
                {presente ? masque : '—'}
              </span>
              {peutModifier && (
                <>
                  <Bouton taille="petit" onClick={() => setEnEdition(true)} disabled={pendingTest}>
                    {libelles.remplacer}
                  </Bouton>
                  <Bouton taille="petit" onClick={tester} disabled={pendingTest} aria-busy={pendingTest}>
                    {libelles.tester}
                  </Bouton>
                </>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {champs.map((champ) => (
                <div key={champ.name}>
                  <Champ libelle={champ.libelle} id={`${providerId}-${champ.name}`}>
                    <input
                      id={`${providerId}-${champ.name}`}
                      type={champ.secret ? 'password' : 'text'}
                      autoComplete="off"
                      required={champ.required}
                      placeholder={champ.secret ? libelles.placeholderSecret : (champ.exemple ?? champ.libelle)}
                      value={valeurs[champ.name] ?? ''}
                      onChange={(e) => setValeurs((v) => ({ ...v, [champ.name]: e.target.value }))}
                      disabled={pendingSave}
                    />
                  </Champ>
                  {champ.aide && <div className="jr-aide">{champ.aide}</div>}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <Bouton variante="principal" taille="petit" onClick={enregistrer} disabled={pendingSave} aria-busy={pendingSave}>
                  {pendingSave ? libelles.enregistrementEnCours : libelles.enregistrer}
                </Bouton>
                {presente && (
                  <Bouton taille="petit" onClick={annuler} disabled={pendingSave}>
                    {libelles.annuler}
                  </Bouton>
                )}
              </div>
            </div>
          )}
        </div>

        {infos.map((info) => (
          <div key={info.libelle}>
            <span className="jr-libelle">{info.libelle}</span>
            <div style={{ fontSize: 13.5 }}>{info.valeur}</div>
            {info.lien && (
              <a className="jr-lien" style={{ fontSize: 12.5 }} href={info.lien.href}>
                {info.lien.texte}
              </a>
            )}
          </div>
        ))}
      </div>

      {champsConfig.length > 0 && (
        <div style={{ borderTop: '1px solid var(--jr-filet)', margin: '12px 18px 0', paddingTop: 12 }}>
          <span className="jr-libelle">{libelles.reglagesTitre}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 6 }}>
            {champsConfig.map((champ) => (
              <div key={champ.name}>
                <Champ libelle={champ.libelle} id={`${providerId}-cfg-${champ.name}`}>
                  <input
                    id={`${providerId}-cfg-${champ.name}`}
                    value={valeursConfig[champ.name] ?? champ.valeurActuelle}
                    onChange={(e) => setValeursConfig((v) => ({ ...v, [champ.name]: e.target.value }))}
                    disabled={!peutModifier || pendingConfig}
                  />
                </Champ>
                {champ.aide && <div className="jr-aide">{champ.aide}</div>}
              </div>
            ))}
          </div>
          {peutModifier && (
            <div style={{ marginTop: 8 }}>
              <Bouton variante="principal" taille="petit" onClick={enregistrerConfig} disabled={pendingConfig} aria-busy={pendingConfig}>
                {pendingConfig ? libelles.enregistrementEnCours : libelles.enregistrerReglages}
              </Bouton>
            </div>
          )}
        </div>
      )}

      {erreur && (
        <div className="jr-bandeau erreur" role="alert" style={{ margin: '0 18px 16px' }}>
          <span>{erreur}</span>
        </div>
      )}
    </Carte>
  );
}
