import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(
  new URL('../../../../deploy/vps/navigateur/entrypoint.sh', import.meta.url),
);

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

describe("l'entrypoint du navigateur, jusqu'au lancement de Chromium", () => {
  /** `chromium` et `socat` factices : le premier imprime ses arguments puis son environnement. */
  function lancerFactice(version = 'Chromium 129.0.6668.89 built on Debian GNU/Linux 12') {
    const dossier = mkdtempSync(join(tmpdir(), 'entrypoint-'));
    const bin = join(dossier, 'bin');
    const profil = join(dossier, 'profil');
    mkdirSync(bin);
    mkdirSync(profil);
    writeFileSync(
      join(bin, 'chromium'),
      `#!/usr/bin/env bash\nif [[ "$1" == "--version" ]]; then echo '${version}'; exit 0; fi\nprintf 'ARG %s\\n' "$@"\nenv | sed 's/^/ENV /'\n`,
      { mode: 0o755 },
    );
    writeFileSync(join(bin, 'socat'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      symlinkSync('autre-hote-12345', join(profil, f));
    }
    const r = spawnSync('bash', [SCRIPT], {
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: dossier,
        PROFIL_DIR: profil,
        LINKEDIN_PROXY_URL: 'http://proxy.exemple:8080',
        DATABASE_URL: 'postgres://secret',
      },
      encoding: 'utf8',
      timeout: 5_000,
    });
    return {
      r,
      profil,
      args: r.stdout
        .split('\n')
        .filter((l) => l.startsWith('ARG '))
        .map((l) => l.slice(4)),
      env: r.stdout,
    };
  }

  it('annonce un User-Agent sans HeadlessChrome, dérivé de la version réelle du binaire', () => {
    const { r, args } = lancerFactice();
    expect(r.status).toBe(0);
    const ua = args.find((a) => a.startsWith('--user-agent='));
    expect(ua).toMatch(/Chrome\/129\.0\.6668\.89 /);
    expect(ua).not.toMatch(/Headless/i);
  });

  it('supprime les verrous de profil laissés par un conteneur précédent', () => {
    const { profil } = lancerFactice();
    for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      // lstat : ces verrous sont des liens, souvent pendants, que `existsSync` ne voit pas.
      expect(() => lstatSync(join(profil, f))).toThrow();
    }
  });

  it('garde le fuseau et la langue, et ne laisse passer aucune autre variable', () => {
    const { env } = lancerFactice();
    expect(env).toMatch(/^ENV TZ=Europe\/Paris$/m);
    expect(env).toMatch(/^ENV LANG=fr_FR\.UTF-8$/m);
    expect(env).not.toMatch(/DATABASE_URL|secret/);
  });

  it('pose la langue, le magasin de mots de passe et coupe le réseau en arrière-plan', () => {
    const { args } = lancerFactice();
    expect(args).toEqual(
      expect.arrayContaining([
        '--lang=fr-FR',
        '--password-store=basic',
        '--disable-background-networking',
      ]),
    );
    expect(args).toContain('--proxy-server=http://proxy.exemple:8080');
  });
});
