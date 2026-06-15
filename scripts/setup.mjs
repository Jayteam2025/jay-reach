import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const run = (cmd) => { console.log(`$ ${cmd}`); execSync(cmd, { stdio: "inherit" }); };
const runSilent = (cmd) => execSync(cmd, { encoding: "utf8", stdio: "pipe" });

const env = readFileSync(".env", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim() || "";

const ref = get("SUPABASE_PROJECT_REF");
const token = get("SUPABASE_ACCESS_TOKEN");
const password = get("SUPABASE_DB_PASSWORD");

if (!ref) { console.error("SUPABASE_PROJECT_REF manquant dans .env"); process.exit(1); }
if (!token) { console.error("SUPABASE_ACCESS_TOKEN manquant dans .env"); process.exit(1); }
if (!password) { console.error("SUPABASE_DB_PASSWORD manquant dans .env"); process.exit(1); }

console.log("=== Vérification de l'environnement ===\n");
run("node scripts/doctor.mjs");

console.log("\n=== Lien au projet Supabase ===\n");
const linkCmd = `SUPABASE_ACCESS_TOKEN=${token} pnpm exec supabase link --project-ref ${ref}`;
try {
  runSilent(linkCmd);
  console.log("✓ Projet lié");
} catch (e) {
  console.error("Erreur lors du lien au projet:", e.message);
  process.exit(1);
}

console.log("\n=== Déploiement des migrations DB ===\n");
const dbCmd = `SUPABASE_ACCESS_TOKEN=${token} pnpm exec supabase db push --password "${password}"`;
try {
  run(dbCmd);
} catch (e) {
  console.error("Erreur lors du push DB:", e.message);
  process.exit(1);
}

console.log("\n=== Configuration du secret de chiffrement ===\n");
const SECRET = "TOKEN_ENCRYPTION_KEY";
const existingSecretsCmd = `SUPABASE_ACCESS_TOKEN=${token} pnpm exec supabase secrets list`;
try {
  const existing = runSilent(existingSecretsCmd);
  if (existing.includes(SECRET)) {
    console.log(`✓ ${SECRET} déjà défini, on le conserve.`);
  } else {
    const key = randomBytes(32).toString("base64");
    console.log(`✓ Génération d'une nouvelle clé de chiffrement (32 bytes, base64)`);
    const setCmd = `SUPABASE_ACCESS_TOKEN=${token} pnpm exec supabase secrets set ${SECRET}=${key}`;
    run(setCmd);
  }
} catch (e) {
  console.error("Erreur lors de la gestion du secret:", e.message);
  process.exit(1);
}

console.log("\n=== Déploiement des functions ===\n");
const deployCmd = `SUPABASE_ACCESS_TOKEN=${token} pnpm exec supabase functions deploy --no-verify-jwt`;
try {
  run(deployCmd);
} catch (e) {
  console.error("Erreur lors du déploiement des functions:", e.message);
  process.exit(1);
}

console.log("\n╔════════════════════════════════════════════════════════╗");
console.log("║ Setup terminé. Prêt à démarrer !                      ║");
console.log("╚════════════════════════════════════════════════════════╝");
console.log(`
Prochaines étapes :

  1. pnpm dev
  2. Inscris-toi (1er compte = admin + workspace créé automatiquement)
  3. Onglet Config -> renseigne tes clés providers :
     - LLM (Anthropic)
     - FullEnrich (optionnel, pour enrichissement email)
     - Bouncer (optionnel, pour validation email)
     - Smartlead (optionnel, pour envoi campagnes)
  4. Crée tes triggers, personas et templates
  5. Lance ta première campagne de prospection

Documentation : README.md et docs/ du projet

`);
