import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { demander, demanderMasque, SaisieInterrompue } from './saisie.js';

function flux() {
  const input = new PassThrough();
  const output = new PassThrough();
  const ecrit: string[] = [];
  output.on('data', (c: Buffer) => ecrit.push(c.toString()));
  return { input, output, ecrit };
}

describe('la saisie masquee', () => {
  it("rend la reponse sans jamais l'ecrire sur la sortie", async () => {
    const { input, output, ecrit } = flux();
    const p = demanderMasque('Mot de passe : ', { input, output });
    input.write('secret-123\n');
    expect(await p).toBe('secret-123');
    expect(ecrit.join('')).not.toMatch(/secret-123/);
    expect(ecrit.join('')).toMatch(/Mot de passe/);
  });

  it('rejette quand la saisie est interrompue par Ctrl+C', async () => {
    const { input, output } = flux();
    const p = demanderMasque('Mot de passe : ', { input, output });
    input.write('\x03');
    await expect(p).rejects.toBeInstanceOf(SaisieInterrompue);
  });

  it('rejette quand le flux se ferme sans reponse', async () => {
    const { input, output } = flux();
    const p = demanderMasque('Code : ', { input, output });
    input.end();
    await expect(p).rejects.toBeInstanceOf(SaisieInterrompue);
  });
});

describe("la saisie visible de l'identifiant", () => {
  const origine = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  afterEach(() => {
    if (origine) Object.defineProperty(process.stdin, 'isTTY', origine);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  });

  it('rejette sur Ctrl+C quand stdin est un terminal : le finally de la commande doit pouvoir passer', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const { input, output } = flux();
    const p = demander('Identifiant : ', { input, output });
    input.write('\x03');
    await expect(p).rejects.toBeInstanceOf(SaisieInterrompue);
  });

  it("rend l'identifiant saisi", async () => {
    const { input, output } = flux();
    const p = demander('Identifiant : ', { input, output }, true);
    input.write('  moi@exemple.fr \n');
    expect(await p).toBe('moi@exemple.fr');
  });
});
