import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const checks = [];
const ok = (label) => checks.push({ label, ok: true });
const ko = (label, fix) => checks.push({ label, ok: false, fix });

const [maj, min] = process.versions.node.split(".").map(Number);
maj > 22 || (maj === 22 && min >= 12)
  ? ok(`Node ${process.versions.node}`)
  : ko(`Node ${process.versions.node}`, "Installer Node >= 22.12");

for (const [bin, cmd, fix, required] of [
  ["pnpm", "pnpm -v", "npm i -g pnpm", true],
  ["supabase CLI", "supabase --version", "https://supabase.com/docs/guides/cli", true],
  ["deno", "deno --version", "https://deno.land (optionnel, tests edge fns)", false],
]) {
  try {
    execSync(cmd, { stdio: "pipe" });
    ok(bin);
  } catch {
    // Try pnpm exec as fallback for supabase
    if (bin === "supabase CLI") {
      try {
        execSync("pnpm exec supabase --version", { stdio: "pipe" });
        ok(bin);
        continue;
      } catch {
        // Fall through to error handling
      }
    }
    required ? ko(bin, fix) : checks.push({ label: bin, ok: false, fix, optional: true });
  }
}

let url = "", anon = "";
if (!existsSync(".env")) ko(".env", "cp .env.example .env puis remplir les variables");
else {
  const env = readFileSync(".env", "utf8");
  url = (env.match(/^VITE_SUPABASE_URL=(.+)$/m) || [])[1]?.trim() || "";
  anon = (env.match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m) || [])[1]?.trim() || "";
  url ? ok("VITE_SUPABASE_URL") : ko("VITE_SUPABASE_URL", "renseigner dans .env");
  anon ? ok("VITE_SUPABASE_ANON_KEY") : ko("VITE_SUPABASE_ANON_KEY", "renseigner dans .env");
}

if (url && anon) {
  try {
    const r = await fetch(`${url}/rest/v1/`, { method: "HEAD", headers: { apikey: anon } });
    [200, 401, 404].includes(r.status) ? ok("Connexion Supabase") : ko("Connexion Supabase", `statut ${r.status}`);
  } catch (e) { ko("Connexion Supabase", `injoignable: ${e.message}`); }
}

for (const c of checks) {
  const mark = c.ok ? "[OK]  " : c.optional ? "[--]  " : "[FAIL]";
  console.log(`${mark} ${c.label}${c.ok ? "" : ` -> ${c.fix}`}`);
}
const failed = checks.filter((c) => !c.ok && !c.optional);
if (failed.length) { console.error(`\n${failed.length} prérequis manquant(s).`); process.exit(1); }
console.log("\nEnvironnement OK.");
