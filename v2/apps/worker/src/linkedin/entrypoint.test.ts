import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../deploy/vps/navigateur/entrypoint.sh', import.meta.url));

function lancer(url: string | undefined) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: '/tmp' };
  if (url !== undefined) env.LINKEDIN_PROXY_URL = url;
  return spawnSync('bash', [SCRIPT], { env, encoding: 'utf8', timeout: 5_000 });
}

describe("l'entrypoint du navigateur refuse de demarrer", () => {
  it.each([
    ['absente', undefined],
    ['vide', ''],
    ['schema inconnu', 'httpp://proxy.exemple:8080'],
    ['avec identifiants', 'http://utilisateur:mdp-secret@proxy.exemple:8080'],
    ['sans port', 'http://proxy.exemple'],
    ['avec chemin', 'http://proxy.exemple:8080/'],
    ['sans schema', 'proxy.exemple:8080'],
  ] as [string, string | undefined][])('URL de proxy %s', (_nom, url) => {
    const r = lancer(url);
    expect(r.status).toBe(1);
    // La valeur n'est jamais reprise dans le message.
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/mdp-secret|utilisateur/);
  });
});
