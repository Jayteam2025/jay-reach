import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FicheSequence } from '@jay-reach/core';

/**
 * `SectionOuEnEstOn` appelle `useTranslations` directement (contrairement à
 * `libelleMotifPause`/`libelleProchainMessage`, déjà testées isolément dans
 * `lib/motif-pause.test.ts`) : un faux `next-intl` minimal plutôt qu'un
 * `NextIntlClientProvider` complet — seul `useTranslations` est utilisé ici.
 * Rend visible à la fois le namespace ET la clé, pour distinguer sans
 * ambiguïté une ligne de l'autre dans les assertions.
 */
vi.mock('next-intl', () => ({
  useTranslations:
    (namespace: string) =>
    (cle: string, valeurs?: Record<string, string | number>) => {
      const suffixe = valeurs
        ? Object.entries(valeurs)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')
        : '';
      return suffixe ? `${namespace}.${cle}:${suffixe}` : `${namespace}.${cle}`;
    },
}));

const { SectionOuEnEstOn } = await import('./SectionOuEnEstOn');

function sequence(overrides: Partial<FicheSequence> = {}): FicheSequence {
  return {
    etapes: [],
    boite: null,
    pause: null,
    prochainMessageLe: null,
    ...overrides,
  };
}

describe('SectionOuEnEstOn', () => {
  // F11 : rougirait si la ligne « Prochain message » disparaissait ou si elle n'était plus
  // placée sous l'emplacement existant (`sequence.nextMessage`, même bloc que `pausedLine`).
  it('inscription active avec une échéance -> ligne « Prochain message » affichée', () => {
    const html = renderToStaticMarkup(
      <SectionOuEnEstOn
        sequence={sequence({ prochainMessageLe: '2026-09-28T08:00:00.000Z' })}
        campagneId="camp-1"
        fuseau="Europe/Paris"
      />,
    );
    expect(html).toContain('campagne.fiche.sequence.nextMessage:date=28 septembre');
    expect(html).not.toContain('pausedLine');
  });

  it('inscription active sans échéance connue -> aucune ligne de statut', () => {
    const html = renderToStaticMarkup(
      <SectionOuEnEstOn sequence={sequence()} campagneId="camp-1" fuseau="Europe/Paris" />,
    );
    expect(html).not.toContain('sequence.nextMessage');
    expect(html).not.toContain('sequence.pausedLine');
  });

  // Garde défensive du composant (pas seulement de `lireFiche`, qui garantit déjà l'exclusion
  // mutuelle en base) : une pause l'emporte toujours sur une échéance, jamais les deux lignes.
  it('inscription en pause -> ligne de pause seule, même si prochainMessageLe est renseigné', () => {
    const html = renderToStaticMarkup(
      <SectionOuEnEstOn
        sequence={sequence({
          pause: { motif: 'absence', repriseLe: null, inscriptionId: 'enr-1' },
          prochainMessageLe: '2026-09-28T08:00:00.000Z',
        })}
        campagneId="camp-1"
        fuseau="Europe/Paris"
      />,
    );
    expect(html).toContain('sequence.pausedLine');
    expect(html).not.toContain('sequence.nextMessage');
  });

  // F11 : la copie ne distingue plus une pause d'absence des autres pauses — toujours
  // « resume », jamais « resumeNow » (rougirait si la clé/le choix distinct revenait).
  it('bouton de reprise d’une pause d’absence : clé resume, jamais resumeNow', () => {
    const html = renderToStaticMarkup(
      <SectionOuEnEstOn
        sequence={sequence({ pause: { motif: 'absence', repriseLe: null, inscriptionId: 'enr-1' } })}
        campagneId="camp-1"
        fuseau="Europe/Paris"
      />,
    );
    expect(html).toContain('campagne.contacts.actions.resume');
    expect(html).not.toContain('resumeNow');
  });
});
