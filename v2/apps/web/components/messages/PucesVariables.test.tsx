import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { STANDARD_VARIABLES } from '@jay-reach/core';
import fr from '../../../../packages/i18n/src/messages/fr.json';
import { PucesVariables } from './PucesVariables';

describe('PucesVariables', () => {
  it('une puce par variable, jeton affiché et libellé en infobulle', () => {
    const html = renderToStaticMarkup(
      <PucesVariables variables={['prenom', 'post_sujet']} onInserer={vi.fn()} libelle={(n) => `libellé de ${n}`} />,
    );
    expect(html).toContain('{{prenom}}');
    expect(html).toContain('{{post_sujet}}');
    expect(html).toContain('title="libellé de post_sujet"');
  });

  it('chaque variable standard a son libellé dans les messages', () => {
    const libelles: Record<string, string> = fr.common.variables;
    for (const nom of Object.keys(STANDARD_VARIABLES)) expect(libelles[nom], nom).toBeTruthy();
  });
});
