'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { STANDARD_VARIABLES, type CampaignNature } from '@jay-reach/core/messages/variables.js';

/**
 * Zone de rédaction d'un message, où taper `{` propose les variables.
 *
 * La double accolade est une convention de développeur. Un opérateur qui écrit
 * ce qu'il a sous les yeux — `{prenom}`, `{Prenom}`, ou `{name}` — voyait son
 * message enregistré tel quel et partir avec les accolades visibles chez le
 * prospect.
 *
 * Deux réponses complémentaires, dont celle-ci est la première : on n'a plus
 * besoin de connaître la syntaxe, puisque la liste s'ouvre dès la première
 * accolade et insère la forme exacte. La seconde vit dans le cœur
 * (`normalizeVariableSyntax`), qui rattrape ce qui a été tapé à la main.
 *
 * Le mot nu, sans accolade, ne peut PAS être reconnu : « entreprise », « ville »
 * et « poste » sont des mots français courants, et « au sujet de votre
 * entreprise » deviendrait une variable au milieu d'une phrase qui n'en veut
 * pas. L'accolade reste le signal d'intention, mais une seule suffit.
 */
export function ChampMessage({
  valeur,
  onChange,
  nature,
  lignes = 6,
  placeholder,
  libelleListe,
}: {
  valeur: string;
  onChange: (v: string) => void;
  nature: CampaignNature;
  lignes?: number;
  placeholder?: string;
  /** Nommé par l'appelant, qui connaît sa langue. */
  libelleListe: string;
}) {
  const champRef = useRef<HTMLTextAreaElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [filtre, setFiltre] = useState('');
  const [choisi, setChoisi] = useState(0);
  /** Position de l'accolade qui a ouvert la liste, pour savoir quoi remplacer. */
  const debutRef = useRef<number | null>(null);

  const disponibles = useMemo(
    () =>
      Object.entries(STANDARD_VARIABLES)
        .filter(([, dispo]) => dispo === 'always' || dispo === nature)
        .map(([nom]) => nom),
    [nature],
  );

  const proposees = useMemo(
    () => disponibles.filter((v) => v.startsWith(filtre.toLowerCase())),
    [disponibles, filtre],
  );

  useEffect(() => {
    setChoisi(0);
  }, [filtre]);

  function fermer() {
    setOuvert(false);
    setFiltre('');
    debutRef.current = null;
  }

  /**
   * Relit ce qui suit la dernière accolade avant le curseur.
   *
   * On repart du texte à chaque frappe plutôt que de suivre les touches une à
   * une : coller, corriger au milieu ou revenir en arrière casserait un
   * compteur, pas une relecture.
   */
  function relireContexte(texte: string, curseur: number) {
    const avant = texte.slice(0, curseur);
    const ouvrante = avant.lastIndexOf('{');
    if (ouvrante === -1) return fermer();
    const saisi = avant.slice(ouvrante + 1).replace(/^\{/, '');
    // Un espace ou une accolade fermante signent la fin de l'intention.
    if (/[\s}]/.test(saisi)) return fermer();
    debutRef.current = ouvrante;
    setFiltre(saisi);
    setOuvert(true);
  }

  function inserer(nom: string) {
    const champ = champRef.current;
    const debut = debutRef.current;
    if (!champ || debut === null) return;
    const curseur = champ.selectionStart;
    const avant = valeur.slice(0, debut);
    const apres = valeur.slice(curseur);
    const jeton = `{{${nom}}}`;
    onChange(avant + jeton + apres);
    fermer();
    // Le curseur se replace après le jeton, sinon la frappe suivante atterrit
    // au début du champ.
    requestAnimationFrame(() => {
      const pos = avant.length + jeton.length;
      champ.focus();
      champ.setSelectionRange(pos, pos);
    });
  }

  function auClavier(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!ouvert || proposees.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setChoisi((i) => (i + 1) % proposees.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setChoisi((i) => (i - 1 + proposees.length) % proposees.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      inserer(proposees[choisi] ?? proposees[0]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      fermer();
    }
  }

  return (
    <div className="rs-champ-msg">
      <textarea
        ref={champRef}
        className="rs-textarea"
        rows={lignes}
        value={valeur}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          relireContexte(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={auClavier}
        onBlur={() => window.setTimeout(fermer, 120)}
        role="combobox"
        aria-expanded={ouvert}
        aria-controls="rs-champ-msg-liste"
        aria-autocomplete="list"
      />

      {ouvert && proposees.length > 0 ? (
        <ul className="rs-champ-msg-liste" id="rs-champ-msg-liste" role="listbox" aria-label={libelleListe}>
          {proposees.map((v, i) => (
            <li key={v}>
              <button
                type="button"
                role="option"
                aria-selected={i === choisi}
                data-choisi={i === choisi ? 'true' : undefined}
                // `mousedown` et non `click` : le champ perd le focus avant le
                // clic, et le repli sur `blur` ferait disparaître la liste
                // sous le curseur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  inserer(v);
                }}
                onMouseEnter={() => setChoisi(i)}
              >
                <span className="mono">{v}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
