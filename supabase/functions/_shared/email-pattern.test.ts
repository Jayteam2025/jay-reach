import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEmail,
  detectPattern,
  normalizeNamePart,
  type EmailSample,
} from "./email-pattern.ts";

// ─── normalizeNamePart ──────────────────────────────────────────────────────

Deno.test("normalizeNamePart: accents", () => {
  assertEquals(normalizeNamePart("Anaïs"), "anais");
  assertEquals(normalizeNamePart("Émilie"), "emilie");
  assertEquals(normalizeNamePart("François"), "francois");
});

Deno.test("normalizeNamePart: trim + lowercase", () => {
  assertEquals(normalizeNamePart("  Marie  "), "marie");
  assertEquals(normalizeNamePart("MARIE"), "marie");
});

Deno.test("normalizeNamePart: stripSpaces preserve les tirets", () => {
  // "Jean-Pierre" : on garde le tiret (variante de prenom)
  assertEquals(normalizeNamePart("Jean-Pierre"), "jean-pierre");
  // "Le Bras" : strip les espaces avec stripSpaces:true (nom compose)
  assertEquals(normalizeNamePart("Le Bras", { stripSpaces: true }), "lebras");
  assertEquals(normalizeNamePart("De Sousa", { stripSpaces: true }), "desousa");
});

Deno.test("buildEmail: first compose strip espaces (bug Engie 2026-05-18)", () => {
  // "EL YAMANI" en first_name produisait "el yamani.idrissi@engie.com" (espace)
  const email = buildEmail("first.last", "EL YAMANI", "Idrissi", "engie.com");
  assertEquals(email, "elyamani.idrissi@engie.com");
  if (email && email.split("@")[0].includes(" ")) {
    throw new Error(`Espace detecte dans local-part : ${email}`);
  }
});

Deno.test("buildEmail: nom compose dans last_name strip aussi", () => {
  assertEquals(
    buildEmail("first.last", "Marjane", "Ben abdesslem", "engie.com"),
    "marjane.benabdesslem@engie.com",
  );
});

Deno.test("buildEmail: tirets preserves (Jean-Pierre)", () => {
  assertEquals(
    buildEmail("first.last", "Jean-Pierre", "Dupont", "x.com"),
    "jean-pierre.dupont@x.com",
  );
});

Deno.test("normalizeNamePart: vide / null", () => {
  assertEquals(normalizeNamePart(""), "");
  assertEquals(normalizeNamePart(null), "");
  assertEquals(normalizeNamePart(undefined), "");
});

// ─── detectPattern : cas reels valides empiriquement ────────────────────────

const PAPREC_SAMPLES: EmailSample[] = [
  { first_name: "Allan", last_name: "Lignot", email: "allan.lignot@paprec.com" },
  { first_name: "Amanda", last_name: "FLORCZAK", email: "amanda.florczak@paprec.com" },
  { first_name: "Anaïs", last_name: "Hamdi-Cherif", email: "anais.hamdi-cherif@paprec.com" },
  { first_name: "Bertrand", last_name: "Hyllaire", email: "bertrand.hyllaire@paprec.com" },
  { first_name: "Coralie", last_name: "De Sousa", email: "coralie.desousa@paprec.com" },
];

Deno.test("detectPattern: paprec.com -> first.last HIGH", () => {
  const r = detectPattern(PAPREC_SAMPLES);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.tier, "high");
  assertEquals(r.confidence, 1.0);
  assertEquals(r.hits, 5);
  assertEquals(r.total, 5);
});

Deno.test("detectPattern: theodore.fr -> last (juste le nom)", () => {
  const samples: EmailSample[] = [
    { first_name: "Achille", last_name: "Seiller", email: "seiller@theodore.fr" },
    { first_name: "Damien", last_name: "Bruet", email: "bruet@theodore.fr" },
    { first_name: "Hugo", last_name: "Helin", email: "helin@theodore.fr" },
    { first_name: "Manon", last_name: "Deneuve", email: "deneuve@theodore.fr" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "last");
  assertEquals(r.tier, "high");
  assertEquals(r.confidence, 1.0);
});

Deno.test("detectPattern: paritel.fr -> f.last (initial + nom)", () => {
  const samples: EmailSample[] = [
    { first_name: "Anis", last_name: "CHENOUF", email: "a.chenouf@paritel.fr" },
    { first_name: "Aubry", last_name: "Mananjamany", email: "a.mananjamany@paritel.fr" },
    { first_name: "Gauthier", last_name: "Beghin", email: "g.beghin@paritel.fr" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "f.last");
  assertEquals(r.tier, "high");
});

Deno.test("detectPattern: pg.com -> last.f (P&G exotique)", () => {
  const samples: EmailSample[] = [
    { first_name: "Adrien", last_name: "Pignol", email: "pignol.a@pg.com" },
    { first_name: "Antoine", last_name: "Bonetto", email: "bonetto.a@pg.com" },
    { first_name: "Cécile", last_name: "Keller", email: "keller.c@pg.com" },
    { first_name: "Cédric", last_name: "Blum", email: "blum.c@pg.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "last.f");
  assertEquals(r.tier, "high");
});

Deno.test("detectPattern: pattern mixte 73% -> SKIP (sous le seuil 85%)", () => {
  // 11 first.last + 3 first + 1 autre = 11/15 = 73%. Avec le seuil
  // remonte a 0.85 (cf TIER_THRESHOLDS.medium), on tombe en skip.
  const samples: EmailSample[] = [
    ...Array.from({ length: 11 }, (_, i) => ({
      first_name: `User${i}`,
      last_name: `Doe${i}`,
      email: `user${i}.doe${i}@x.com`,
    })),
    { first_name: "Astrid", last_name: "Dupont", email: "astrid@x.com" },
    { first_name: "Paul", last_name: "Martin", email: "paul@x.com" },
    { first_name: "Sara", last_name: "Cohen", email: "sara@x.com" },
    { first_name: "Camille", last_name: "Robieu", email: "cr@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.tier, "skip");
  assertEquals(r.hits, 11);
  assertEquals(r.total, 15);
});

Deno.test("detectPattern: 86% -> HIGH (juste au-dessus du seuil)", () => {
  // 12 first.last + 2 autres = 12/14 = 85.7% -> high
  const samples: EmailSample[] = [
    ...Array.from({ length: 12 }, (_, i) => ({
      first_name: `User${i}`,
      last_name: `Doe${i}`,
      email: `user${i}.doe${i}@x.com`,
    })),
    { first_name: "Astrid", last_name: "Dupont", email: "astrid@x.com" },
    { first_name: "Paul", last_name: "Martin", email: "paul@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.tier, "high");
});

Deno.test("detectPattern: bruit total -> SKIP", () => {
  const samples: EmailSample[] = [
    { first_name: "A", last_name: "B", email: "totally-random@x.com" },
    { first_name: "C", last_name: "D", email: "weird@x.com" },
    { first_name: "E", last_name: "F", email: "ef.gg.hh@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.tier, "skip");
});

Deno.test("detectPattern: empty samples -> null", () => {
  const r = detectPattern([]);
  assertEquals(r.pattern, null);
  assertEquals(r.tier, "skip");
  assertEquals(r.confidence, 0);
});

Deno.test("detectPattern: ignore samples avec champs manquants", () => {
  // Note 2026-05 : depuis l'ajout du filtre isUsableSample, les first/last de
  // moins de 2 chars sont aussi ignores (data scrape tronquee). On utilise
  // donc des noms a 2 chars minimum pour ce test de couverture des nulls.
  const samples: EmailSample[] = [
    { first_name: "Marie", last_name: null, email: "marie@x.com" }, // ignore (null)
    { first_name: null, last_name: "Dupont", email: "dupont@x.com" }, // ignore (null)
    { first_name: "Al", last_name: "Bo", email: "al.bo@x.com" },
    { first_name: "Co", last_name: "Du", email: "co.du@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.total, 2); // les 2 lignes completes uniquement
  assertEquals(r.confidence, 1.0);
});

Deno.test("detectPattern: secondary detecte si plusieurs patterns coexistent", () => {
  const samples: EmailSample[] = [
    { first_name: "Marie", last_name: "Dupont", email: "marie.dupont@x.com" },
    { first_name: "Paul", last_name: "Martin", email: "paul.martin@x.com" },
    { first_name: "Anne", last_name: "Bernard", email: "anne.bernard@x.com" },
    // Sara : pattern "first" seul (cas legacy/exec)
    { first_name: "Sara", last_name: "Cohen", email: "sara@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.secondary?.pattern, "first");
  assertEquals(r.secondary?.hits, 1);
});

// ─── buildEmail ─────────────────────────────────────────────────────────────

Deno.test("buildEmail: first.last accents + tirets preserves", () => {
  assertEquals(buildEmail("first.last", "Marie", "Dupont", "x.com"), "marie.dupont@x.com");
  assertEquals(buildEmail("first.last", "Anaïs", "Hamdi-Cherif", "paprec.com"), "anais.hamdi-cherif@paprec.com");
  assertEquals(buildEmail("first.last", "Jean-Pierre", "Le Bras", "x.com"), "jean-pierre.lebras@x.com");
});

Deno.test("buildEmail: f.last", () => {
  assertEquals(buildEmail("f.last", "Marie", "Dupont", "x.com"), "m.dupont@x.com");
});

Deno.test("buildEmail: last.f (P&G)", () => {
  assertEquals(buildEmail("last.f", "Marie", "Dupont", "pg.com"), "dupont.m@pg.com");
});

Deno.test("buildEmail: last (theodore)", () => {
  assertEquals(buildEmail("last", "Marie", "Dupont", "theodore.fr"), "dupont@theodore.fr");
});

Deno.test("buildEmail: input incomplet -> null", () => {
  assertEquals(buildEmail("first.last", "", "Dupont", "x.com"), null);
  assertEquals(buildEmail("first.last", "Marie", "", "x.com"), null);
  assertEquals(buildEmail("first.last", "Marie", "Dupont", ""), null);
  assertEquals(buildEmail("first.last", null, "Dupont", "x.com"), null);
});

Deno.test("buildEmail: domaine clean (strip @ leader / case)", () => {
  assertEquals(buildEmail("first.last", "Marie", "Dupont", "@X.COM"), "marie.dupont@x.com");
  assertEquals(buildEmail("first.last", "Marie", "Dupont", "  X.COM  "), "marie.dupont@x.com");
});

// ─── Robustesse face aux donnees polluees (cf bug Rexel 2026-05) ────────────
// Contexte : sur 57 emails @rexel.fr, le detecteur tombait a 80.7% a cause
// de 7 lignes pourries (initiales, noms inverses, dash↔space, nom compose
// tronque), alors que le pattern reel est first.last >92%. Tests pour valider
// que ces lignes sont desormais correctement gerees.

Deno.test("detectPattern: ignore samples avec first OU last < 2 chars (donnee scrape tronquee)", () => {
  const samples: EmailSample[] = [
    { first_name: "Marie", last_name: "Dupont", email: "marie.dupont@x.com" },
    { first_name: "Paul", last_name: "Martin", email: "paul.martin@x.com" },
    { first_name: "Anne", last_name: "Bernard", email: "anne.bernard@x.com" },
    // Lignes a ignorer (samples polluants)
    { first_name: "A", last_name: "H", email: "ahamdoun@x.com" },
    { first_name: "Meh", last_name: "T", email: "meh.t@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.total, 3); // les 2 samples polluants ignores
  assertEquals(r.hits, 3);
  assertEquals(r.confidence, 1.0);
  assertEquals(r.tier, "high");
});

Deno.test("detectPattern: ignore samples avec first OU last terminant par '.' (initiale)", () => {
  // "LAURENT F." (last = "F." = vraisemblablement initiale tronquee)
  // "julien T." idem.
  const samples: EmailSample[] = [
    { first_name: "Marie", last_name: "Dupont", email: "marie.dupont@x.com" },
    { first_name: "Paul", last_name: "Martin", email: "paul.martin@x.com" },
    { first_name: "LAURENT", last_name: "F.", email: "laurent.foulon@x.com" },
    { first_name: "julien", last_name: "T.", email: "julien.t.@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.total, 2);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.confidence, 1.0);
});

Deno.test("detectPattern: tolere dash <-> space (Marie Laure / marie-laure)", () => {
  // "Marie Laure" (avec espace) → email "marie-laure.jaouen" (avec tiret).
  // Sans tolerance, ce sample est un miss → tire la confidence vers le bas.
  const samples: EmailSample[] = [
    { first_name: "Marie", last_name: "Dupont", email: "marie.dupont@x.com" },
    { first_name: "Paul", last_name: "Martin", email: "paul.martin@x.com" },
    { first_name: "Anne", last_name: "Bernard", email: "anne.bernard@x.com" },
    { first_name: "Marie Laure", last_name: "JAOUEN", email: "marie-laure.jaouen@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.hits, 4);
  assertEquals(r.total, 4);
  assertEquals(r.confidence, 1.0);
});

Deno.test("detectPattern: tolere dash <-> space inverse (Jean-Pierre / jean pierre dans email)", () => {
  // Cas symetrique : first avec tiret, email avec espace (rare mais possible).
  const samples: EmailSample[] = [
    { first_name: "Marie", last_name: "Dupont", email: "marie.dupont@x.com" },
    { first_name: "Jean-Pierre", last_name: "Bras", email: "jean pierre.bras@x.com" },
    { first_name: "Paul", last_name: "Martin", email: "paul.martin@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.hits, 3);
  assertEquals(r.total, 3);
});

Deno.test("detectPattern: tolere espace supprime dans first compose (marie laure -> marielaure)", () => {
  // Variante : "Marie Laure" stripee dans l'email (marielaure.jaouen).
  const samples: EmailSample[] = [
    { first_name: "Marie", last_name: "Dupont", email: "marie.dupont@x.com" },
    { first_name: "Paul", last_name: "Martin", email: "paul.martin@x.com" },
    { first_name: "Marie Laure", last_name: "JAOUEN", email: "marielaure.jaouen@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.hits, 3);
  assertEquals(r.confidence, 1.0);
});

Deno.test("detectPattern: detecte swap first/last quand source a les noms inverses", () => {
  // Cas Rexel: "Vabres / Christian / cvabres@rexel.fr" -> noms inverses dans
  // l'import. Christian est en realite le prenom, Vabres le nom.
  // Le pattern reel = flast (c+vabres). Sans tolerance swap, c'est un miss.
  const samples: EmailSample[] = [
    { first_name: "Caroline", last_name: "Haddoum", email: "chaddoum@x.com" }, // flast normal
    { first_name: "David", last_name: "Bocou", email: "dbocou@x.com" },        // flast normal
    { first_name: "Karine", last_name: "BATS", email: "kbats@x.com" },         // flast normal
    { first_name: "Vabres", last_name: "Christian", email: "cvabres@x.com" },  // flast swapped
    { first_name: "Zaafouri", last_name: "Hamdi", email: "hzaafouri@x.com" },  // flast swapped
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "flast");
  // Les 5 samples comptent (normaux + swap detecte)
  assertEquals(r.hits, 5);
  assertEquals(r.total, 5);
});

Deno.test("detectPattern: pattern first-last (tiret) simc.fr type", () => {
  // Vrai cas prod (simc.fr) : pattern firstname-lastname@simc.fr
  const samples: EmailSample[] = [
    { first_name: "Adrien", last_name: "Enoc", email: "adrien-enoc@x.com" },
    { first_name: "Morgan", last_name: "Coville", email: "morgan-coville@x.com" },
    { first_name: "Aline", last_name: "PINTO", email: "aline-pinto@x.com" },
    { first_name: "Benjamin", last_name: "MARTIN", email: "benjamin-martin@x.com" },
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "first-last");
  assertEquals(r.tier, "high");
  assertEquals(r.confidence, 1.0);
});

Deno.test("buildEmail: first-last", () => {
  assertEquals(buildEmail("first-last", "Marie", "Dupont", "x.com"), "marie-dupont@x.com");
  assertEquals(buildEmail("first-last", "Jean-Pierre", "Le Bras", "x.com"), "jean-pierre-lebras@x.com");
});

Deno.test("detectPattern: cas Rexel reel (57 samples) -> first.last HIGH", () => {
  // Reproduit exactement la data prod constatee le 11/05/2026.
  // Sans les ameliorations : 46/57 = 80.7% -> skip.
  // Avec : 7 lignes polluees skip OU detectees via tolerance -> high.
  const samples: EmailSample[] = [
    { first_name: "A", last_name: "H", email: "ahamdoun@rexel.fr" }, // pollue, skip
    { first_name: "Alain", last_name: "MARCEAU", email: "alain.marceau@rexel.fr" },
    { first_name: "Anne Charlotte", last_name: "TOUZÉ", email: "anne charlotte.touze@rexel.fr" },
    { first_name: "Antonio", last_name: "Muñoz", email: "antonio.munoz@rexel.fr" },
    { first_name: "Arnaud", last_name: "LAINÉ", email: "arnaud.laine@rexel.fr" },
    { first_name: "Aurélien", last_name: "Pierre", email: "aurelien.pierre@rexel.fr" },
    { first_name: "BENJAMIN", last_name: "HOCQUAUX", email: "benjamin.hocquaux@rexel.fr" },
    { first_name: "Brice", last_name: "Daguin", email: "brice.daguin@rexel.fr" },
    { first_name: "Caroline", last_name: "Haddoum", email: "chaddoum@rexel.fr" }, // flast
    { first_name: "Clément", last_name: "Manetti", email: "clement.manetti@rexel.fr" },
    { first_name: "Vabres", last_name: "Christian", email: "cvabres@rexel.fr" }, // swap flast
    { first_name: "Damien", last_name: "Bourdelas", email: "damien.bourdelas@rexel.fr" },
    { first_name: "Damien", last_name: "FUSTIER", email: "damien.fustier@rexel.fr" },
    { first_name: "Darcy", last_name: "Cerveira", email: "darcy.cerveira@rexel.fr" },
    { first_name: "Davy", last_name: "Nuñez", email: "davy.nunez@rexel.fr" },
    { first_name: "David", last_name: "Bocou", email: "dbocou@rexel.fr" }, // flast
    { first_name: "Didier", last_name: "FLORET", email: "didier.floret@rexel.fr" },
    { first_name: "Fabien", last_name: "Botté", email: "fabien.botte@rexel.fr" },
    { first_name: "Fabien", last_name: "Couton", email: "fabien.couton@rexel.fr" },
    { first_name: "Florian", last_name: "Lalande", email: "florian.lalande@rexel.fr" },
    { first_name: "Franck", last_name: "GUYOMARD", email: "franck.guyomard@rexel.fr" },
    { first_name: "Zaafouri", last_name: "Hamdi", email: "hzaafouri@rexel.fr" }, // swap flast
    { first_name: "Issam", last_name: "Amrane", email: "issam.amrane@rexel.fr" },
    { first_name: "Jeremy", last_name: "Vilain", email: "jeremy.vilain@rexel.fr" },
    { first_name: "Jerome", last_name: "PITREL", email: "jerome.pitrel@rexel.fr" },
    { first_name: "Galichet", last_name: "Jean - Charles", email: "jgalichet@rexel.fr" }, // swap flast
    { first_name: "Jonathan", last_name: "Perrier", email: "jonathan.perrier@rexel.fr" },
    { first_name: "Jose", last_name: "Fumanal", email: "jose.fumanal@rexel.fr" },
    { first_name: "julien", last_name: "T.", email: "julien.t.@rexel.fr" }, // pollue, skip
    { first_name: "Karine", last_name: "BATS", email: "kbats@rexel.fr" }, // flast
    { first_name: "LAURENT", last_name: "GAUME", email: "laurent.gaume@rexel.fr" },
    { first_name: "Laurent", last_name: "SOULA", email: "laurent.soula@rexel.fr" },
    { first_name: "Luc", last_name: "SEQUIER", email: "luc.sequier@rexel.fr" },
    { first_name: "Maël", last_name: "BOYARD", email: "mael.boyard@rexel.fr" },
    { first_name: "Marc", last_name: "MAROSZ", email: "marc.marosz@rexel.fr" },
    { first_name: "Marco", last_name: "Settembrini", email: "marco.settembrini@rexel.fr" },
    { first_name: "Marie Laure", last_name: "JAOUEN", email: "marie-laure.jaouen@rexel.fr" }, // dash<->space
    { first_name: "MATESO", last_name: "Bryan", email: "mateso.bryan@rexel.fr" },
    { first_name: "Mathieu", last_name: "Godefroy", email: "mathieu.godefroy@rexel.fr" },
    { first_name: "maxime", last_name: "proust", email: "maxime.proust@rexel.fr" },
    { first_name: "Michel", last_name: "Devine", email: "michel.devine@rexel.fr" },
    { first_name: "Mickael", last_name: "Sagnes", email: "mickael.sagnes@rexel.fr" },
    { first_name: "Mikael", last_name: "Moricet", email: "mikael.moricet@rexel.fr" },
    { first_name: "Mohamed", last_name: "Akanni", email: "mohamed.akanni@rexel.fr" },
    { first_name: "Nicolas", last_name: "Evrard", email: "nicolas.evrard@rexel.fr" },
    { first_name: "oliveira", last_name: "david", email: "oliveira.david@rexel.fr" },
    { first_name: "Olivier", last_name: "STARCK", email: "olivier.starck@rexel.fr" },
    { first_name: "Patricia", last_name: "Bénard - Canon", email: "patricia.benard@rexel.fr" }, // tronque
    { first_name: "Philippe", last_name: "Lecroix", email: "philippe.lecroix@rexel.fr" },
    { first_name: "pierre", last_name: "sganga", email: "pierre.sganga@rexel.fr" },
    { first_name: "Pierre", last_name: "THOREAU-MAMBOURG", email: "pierre.thoreau@rexel.fr" }, // tronque
    { first_name: "Quentin", last_name: "BEGUERY", email: "qbeguery@rexel.fr" }, // flast
    { first_name: "Quentin", last_name: "Crovisier", email: "quentin.crovisier@rexel.fr" },
    { first_name: "Romain", last_name: "Etienne", email: "romain.etienne@rexel.fr" },
    { first_name: "Sebastien", last_name: "Bouchy", email: "sebastien.bouchy@rexel.fr" },
    { first_name: "Sylvain", last_name: "Nicolas", email: "sylvain.nicolas@rexel.fr" },
    { first_name: "Wallet", last_name: "Luc", email: "wallet.luc@rexel.fr" }, // swap (1.last)? non en fait reverse mais first.last matche quand meme
  ];
  const r = detectPattern(samples);
  assertEquals(r.pattern, "first.last");
  assertEquals(r.tier, "high");
  // Avec ameliorations : 55 samples retenus (2 polluants skip), >= 85% sur first.last
  // 47 first.last (incluant les 2 cas dash<->space tolere) + 6 flast (4 normaux + 2 swap)
  // + 2 nom compose tronque non matche = 47/53 = 88.7%
  // Selon le decoupage exact, on peut etre entre 85% et 92%, mais TOUJOURS >= 85% (high)
});
