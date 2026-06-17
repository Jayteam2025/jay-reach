import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");

// Charger .env
const env = readFileSync(".env", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim() || "";

const projectRef = get("SUPABASE_PROJECT_REF");
const accessToken = get("SUPABASE_ACCESS_TOKEN");
const dbPassword = get("SUPABASE_DB_PASSWORD");

if (!projectRef) {
  console.error("SUPABASE_PROJECT_REF manquant dans .env");
  process.exit(1);
}
if (!accessToken) {
  console.error("SUPABASE_ACCESS_TOKEN manquant dans .env");
  process.exit(1);
}
if (!dbPassword) {
  console.error("SUPABASE_DB_PASSWORD manquant dans .env");
  process.exit(1);
}

console.log("=== Configuration des crons pg_cron ===\n");
console.log(`Cible : ${projectRef}\n`);

// Définition des jobs cron
// Format : [nom_job, schedule_cron, fonction_edge, description]
const jobs = [
  [
    "jr-poll-batches",
    "*/15 * * * *",
    "poll-prospect-batches",
    "Récupération récurrente des signaux de batch",
  ],
  [
    "jr-bouncer-batch",
    "0 7,13 * * *",
    "bouncer-batch",
    "Validation Bouncer en masse (07h et 13h UTC)",
  ],
  [
    "jr-bounce-learning",
    "0 4 * * *",
    "bounce-learning",
    "Apprentissage quotidien des taux de bounce (04h UTC)",
  ],
  [
    "jr-credits-monitor",
    "0 6 * * *",
    "fullenrich-credits-monitor",
    "Monitoring crédits FullEnrich (06h UTC)",
  ],
  [
    "jr-weekly-recap",
    "0 8 * * 1",
    "prospect-weekly-recap",
    "Récapitulatif hebdomadaire lundi 08h UTC",
  ],
  [
    "jr-cleanup-prospects",
    "0 0 * * *",
    "cleanup-expired-prospects",
    "Nettoyage prospects expirés chaque minuit UTC",
  ],
  [
    "jr-cleanup-crm",
    "0 2 * * *",
    "cleanup-stuck-crm-detections",
    "Nettoyage détections CRM bloquées (02h UTC)",
  ],
  [
    "jr-weekly-cron",
    "0 6 * * 1",
    "weekly-prospect-cron",
    "Cron hebdomadaire prospects lundi 06h UTC",
  ],
];

// Construire le SQL
const baseUrl = `https://${projectRef}.supabase.co/functions/v1`;

let sqlStatements = [];

// Activer les extensions
sqlStatements.push("CREATE EXTENSION IF NOT EXISTS pg_cron;");
sqlStatements.push("CREATE EXTENSION IF NOT EXISTS pg_net;");

// Pour chaque job, déplanifier l'existant et créer le nouveau
for (const [jobName, schedule, functionName, description] of jobs) {
  const functionUrl = `${baseUrl}/${functionName}`;

  sqlStatements.push(`
-- ${description}
SELECT cron.unschedule('${jobName}') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = '${jobName}'
);
SELECT cron.schedule(
  '${jobName}',
  '${schedule}',
  $$
  SELECT net.http_post(
    '${functionUrl}',
    '{}'::jsonb,
    'application/json',
    jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
    )
  ) AS request_id;
  $$
);
`);
}

const sqlScript = sqlStatements.join("\n");

if (dryRun) {
  console.log("Mode --dry-run : affichage du SQL (non exécuté):\n");
  console.log(sqlScript);
  console.log("\n[DRY-RUN] Aucun changement effectué.");
  process.exit(0);
}

console.log("Exécution du SQL via Management API Supabase...\n");

// Exécuter via Management API Supabase
const curlCmd = `curl -s -X POST \\
  "https://api.supabase.com/v1/projects/${projectRef}/database/query" \\
  -H "Authorization: Bearer ${accessToken}" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"${sqlScript.replace(/"/g, '\\"').replace(/\n/g, " ")}"}'`;

try {
  const result = execSync(curlCmd, { encoding: "utf8" });
  const parsed = JSON.parse(result);

  if (parsed.error) {
    console.error("Erreur API Supabase:", parsed.error);
    process.exit(1);
  }

  console.log("[OK] Crons planifiés avec succès.\n");
  for (const [jobName, schedule, functionName, description] of jobs) {
    console.log(`  [OK] ${jobName} (${schedule}) -> ${functionName}`);
  }

  console.log(`
Note : Ces jobs crons sont optionnels. Le pipeline de prospection fonctionne
sans eux. Chaque job appelle sa edge function via le secret CRON_SECRET.

Pour vérifier les jobs planifiés (côté Postgres) :
  SELECT jobname, schedule, command FROM cron.job;

Si un job échoue silencieusement :
  1. Vérifier que CRON_SECRET est défini dans les secrets Supabase :
     supabase secrets list
  2. Si manquant, générer une clé et la définir :
     supabase secrets set CRON_SECRET="$(openssl rand -base64 32)"
  3. Vérifier les logs Supabase :
     supabase functions list --linked
`);
} catch (e) {
  console.error("Erreur lors de l'exécution :", e.message);
  process.exit(1);
}
