#!/usr/bin/env node
/**
 * Gate anti-hardcodes pour Jay Reach OSS.
 *
 * Scan des strings Jay-spécifiques qui ne doivent pas survivre dans le code.
 * Le projet est une extraction OSS donc les secrets personnels + domains Jay
 * doivent être supprimés.
 *
 * Usage :
 *   node scripts/check-no-jay-hardcodes.mjs            # warn-only (exit 0)
 *   node scripts/check-no-jay-hardcodes.mjs --strict   # exit 1 si violation (CI)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SCAN_DIRS = [
  join(ROOT, 'src'),
  join(ROOT, 'supabase', 'functions'),
  join(ROOT, 'scripts'),
];
const STRICT = process.argv.includes('--strict');

// Forbidden patterns — real leaks (secrets, personal emails, workspace UUIDs)
// "Jay" branding in product name / text is allowed
const FORBIDDEN = [
  // Jay-specific domain (except mainteiner contact hey@jay-assistant.fr)
  { re: /(?<!hey@)jay-assistant\.fr/, label: 'domaine Jay-assistant.fr hardcodé' },
  // Personal emails (real leaks)
  { re: /renartjeanbaptiste@gmail\.com/, label: 'email personnel Jean-Baptiste' },
  { re: /alexdeclercq@hotmail\.com/, label: 'email personnel Alexandre' },
  // Generic personal email patterns (fallback)
  { re: /\w+@(?:gmail|hotmail|yahoo|outlook)\.com/, label: 'email personnel', except: ['_shared/internal-users.ts', '_shared/internal-users.test.ts'] },
  // Internal workspace UUID (if any)
  { re: /00000000-0000-0000-0000-000000000001/, label: 'hardcoded workspace UUID pattern' },
  // Jay-specific internal UUIDs (must not reappear)
  { re: /aa853541-4146-47b4-bd64-b035f28a41b3/, label: 'UUID utilisateur Jay interne' },
  { re: /c4b3c69b-a862-431c-a9f8-00c2fead350a/, label: 'UUID utilisateur Jay interne' },
  { re: /f2db7bdb-1067-412d-a3ee-f0d101fd3b99/, label: 'UUID utilisateur Jay interne' },
  // Jay company name (must not appear outside placeholder context)
  { re: /HEY JAY/, label: 'nom de société Jay' },
  // Jay Supabase project ref (prod/staging — must not hardcode)
  { re: /kaysiemagfaqmvusyfav/, label: 'UUID projet Supabase Jay prod' },
  { re: /xaysbsoccvkkduwxymqj/, label: 'UUID projet Supabase Jay staging' },
  // Jardipro integration (Jay-internal ERP)
  { re: /jardipro/, label: 'intégration ERP Jardipro (Jay-interne)' },
  // CV Jay asset
  { re: /cv-jay-assistant/, label: 'CV Jay Reach (asset Jay-interne)' },
  // Jay-internal CRM detection flag
  { re: /isJayNativeCrm/, label: 'isJayNativeCrm (fonction Jay-interne)' },
];

// Files where certain patterns are legitimate (tests, comments, docs)
const IGNORED_PATH_PARTS = ['__tests__', '.test.', 'node_modules', 'check-no-jay-hardcodes.mjs'];

// Allowlist: specific exceptions for patterns that are legit
const ALLOWLIST = {
  // internal-users test fixtures may contain test emails
  '_shared/internal-users.test.ts': [
    'test@example.com',
  ],
  // Personas and Triggers use placeholder UUIDs for multi-workspace filtering
  'ProspectionPersonas.tsx': [
    "INTERNAL_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'",
  ],
  'ProspectionTriggers.tsx': [
    "INTERNAL_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'",
  ],
  // Maintainer contact email (authorized in docs / config)
  'SECURITY': [
    'hey@jay-assistant.fr',
  ],
  'README': [
    'hey@jay-assistant.fr',
  ],
  // Generated types from Supabase (project ref in comments/exports)
  'src/integrations/supabase/types.ts': [
    'kaysiemagfaqmvusyfav',
  ],
  // Product name "Jay Reach" is authorized everywhere (not a hardcode leak)
  '*': [
    'Jay Reach',
  ],
};

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) {
        yield* walk(full);
      } else if (full.endsWith('.ts') || full.endsWith('.tsx') || full.endsWith('.mjs')) {
        yield full;
      }
    } catch {
      // Ignore permission errors
    }
  }
}

function isAllowlisted(rel, lineNum, lineText) {
  for (const [key, patterns] of Object.entries(ALLOWLIST)) {
    if (key.includes(':')) {
      const [file, lineStr] = key.split(':');
      if (rel.includes(file) && parseInt(lineStr) === lineNum) return true;
    }
    if (rel.includes(key)) {
      const patternList = Array.isArray(patterns) ? patterns : [patterns];
      if (patternList.some(p => typeof p === 'string' && lineText.includes(p))) return true;
    }
  }
  return false;
}

const violations = [];

for (const scanDir of SCAN_DIRS) {
  for (const file of walk(scanDir)) {
    const rel = relative(ROOT, file);

    // Skip ignored paths
    if (IGNORED_PATH_PARTS.some(p => rel.includes(p))) continue;

    try {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Skip comments
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;

        for (const { re, label, except } of FORBIDDEN) {
          // Skip if file is in except list
          if (except && except.some(ex => rel.includes(ex))) continue;

          if (re.test(line)) {
            if (!isAllowlisted(rel, i + 1, line)) {
              violations.push({
                rel,
                line: i + 1,
                label,
                text: line.trim().slice(0, 100),
              });
            }
          }
        }
      });
    } catch {
      // Ignore read errors (binary files, etc)
    }
  }
}

if (violations.length === 0) {
  console.log('✓ check-no-jay-hardcodes: aucun secret ou domaine Jay détecté.');
  process.exit(0);
}

console.log(`✗ check-no-jay-hardcodes: ${violations.length} occurrence(s) détectée(s)${STRICT ? '' : ' (warn-only)'}\n`);
for (const v of violations) {
  console.log(`  ${v.rel}:${v.line}  [${v.label}]`);
  console.log(`    ${v.text}`);
}
console.log('');

process.exit(STRICT ? 1 : 0);
