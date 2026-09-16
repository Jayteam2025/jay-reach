'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Bouton, Carte, Champ, Puce } from '../ui';
import { actionTesterAppariement } from '../../app/actions/personas';

type Resultat = {
  statut: 'matched' | 'ambiguous' | 'none';
  persona: string | null;
  candidats: string[];
};

/**
 * Test d'appariement (maquette `reglages-personas.html`) : correspondance par
 * intitulé de poste, sur les personas actifs de l'organisation
 * (`persona-matching.ts`, `matchPersona`). La maquette montre un vrai appel
 * au modèle (score, justification, temps de réponse) : le brief de cette
 * tâche borne l'interface à `testerAppariement(ctx,{intitule}) → { persona:
 * string | null }`, adossée au moteur de correspondance de motifs déjà
 * utilisé par l'assistant de création de campagne — pas de scoring LLM ici.
 * Écart assumé, documenté dans le rapport de tâche.
 */
export function TestAppariement() {
  const t = useTranslations('reglages.personas.test');
  const [pending, startTransition] = useTransition();
  const [intitule, setIntitule] = useState('');
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  function tester() {
    if (!intitule.trim()) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionTesterAppariement(intitule.trim());
      if (res.ok) setResultat(res.valeur);
      else setErreur(res.error);
    });
  }

  return (
    <Carte
      titre={
        <>
          {t('title')} <small>{t('lead')}</small>
        </>
      }
    >
      <div className="jr-formulaire" style={{ paddingTop: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Champ>
              <input
                value={intitule}
                placeholder={t('placeholder')}
                disabled={pending}
                onChange={(e) => setIntitule(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    tester();
                  }
                }}
              />
            </Champ>
          </div>
          <Bouton onClick={tester} disabled={pending || !intitule.trim()} aria-busy={pending}>
            {pending ? t('testing') : t('button')}
          </Bouton>
        </div>

        {erreur && (
          <div className="jr-notification erreur" role="alert">
            {erreur}
          </div>
        )}

        {resultat && (
          <div className="jr-message" style={{ margin: 0 }}>
            <div className="entete">
              <span style={{ flex: 'none' }}>
                {resultat.statut === 'matched' && (
                  <Puce ton="bon" point>
                    {t('matched', { persona: resultat.persona })}
                  </Puce>
                )}
                {resultat.statut === 'ambiguous' && (
                  <Puce ton="attention" point>
                    {t('ambiguous', { personas: resultat.candidats.join(', ') })}
                  </Puce>
                )}
                {resultat.statut === 'none' && (
                  <Puce ton="erreur" point>
                    {t('none')}
                  </Puce>
                )}
              </span>
            </div>
          </div>
        )}
      </div>
    </Carte>
  );
}
