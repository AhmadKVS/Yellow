#!/usr/bin/env node
/**
 * Directory tool for the `yellow-users` table — the live people directory the
 * bubble map reads from.
 *
 * The app now shows *real registered users*; the ten bundled personas are an
 * opt-in escape hatch for an empty room, not the product. So this script has
 * three modes:
 *
 *   node scripts/seed-personas.mjs            inspect — print who is in the
 *                                             directory right now (read-only)
 *   node scripts/seed-personas.mjs --demo     write the ten demo personas as
 *                                             directory rows (idempotent)
 *   node scripts/seed-personas.mjs --remove   delete those demo rows again
 *
 * Plain Node ESM, not part of the Next.js build.
 *
 * Zero drift: the persona data is read straight out of `lib/seed.ts` at run
 * time — the same file the app imports — so there is no second copy to fall
 * out of sync. `--verify-source` prints the checksum it read.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = path.join(ROOT, "lib", "seed.ts");

// Importing a .ts file makes Node grumble about the package type. That is the
// one warning we expect; everything else still prints.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning?.code === "MODULE_TYPELESS_PACKAGE_JSON") return;
  console.warn(`${warning.name}: ${warning.message}`);
});

/* -------------------------------------------------------------------------- */
/* .env.local (no dotenv dependency)                                          */
/* -------------------------------------------------------------------------- */

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const REGION = process.env.AWS_REGION ?? "us-east-2";
const USERS_TABLE = process.env.YELLOW_USERS_TABLE ?? "yellow-users";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

/* -------------------------------------------------------------------------- */
/* the personas — read from lib/seed.ts, never duplicated                     */
/* -------------------------------------------------------------------------- */

/**
 * Preferred path: let Node strip the types and import the real module, so the
 * script literally shares the app's constant.
 */
async function importSeed() {
  const mod = await import(pathToFileURL(SEED_PATH).href);
  if (!Array.isArray(mod?.SEED_PERSONAS)) throw new Error("no SEED_PERSONAS export");
  return { personas: mod.SEED_PERSONAS, how: "imported lib/seed.ts" };
}

/**
 * Fallback for Node builds without type stripping: lift the array literal out
 * of the same file's text. Still a single source of truth — just parsed
 * instead of imported.
 */
function parseSeed() {
  const source = readFileSync(SEED_PATH, "utf8");
  const marker = source.indexOf("SEED_PERSONAS");
  if (marker === -1) throw new Error("SEED_PERSONAS not found in lib/seed.ts");

  const start = source.indexOf("[", marker);
  if (start === -1) throw new Error("could not find the start of the array");

  // String-aware bracket scan — persona copy is full of apostrophes.
  let depth = 0;
  let quote = null;
  let end = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("unbalanced array literal in lib/seed.ts");

  const literal = source.slice(start, end + 1);
  const personas = new Function(`"use strict"; return (${literal});`)();
  if (!Array.isArray(personas)) throw new Error("literal did not evaluate to an array");
  return { personas, how: "parsed lib/seed.ts" };
}

async function loadPersonas() {
  try {
    return await importSeed();
  } catch {
    return parseSeed();
  }
}

const REQUIRED_TAGS = ["softSkills", "interests"];

/** Same contract the API route enforces before anything renders a row. */
function validate(personas) {
  const problems = [];
  personas.forEach((p, i) => {
    const at = `#${i} (${p?.id ?? "no id"})`;
    if (typeof p?.id !== "string" || !p.id) problems.push(`${at}: missing id`);
    if (typeof p?.name !== "string" || !p.name.trim()) problems.push(`${at}: missing name`);
    if (typeof p?.emoji !== "string") problems.push(`${at}: missing emoji`);
    if (!Array.isArray(p?.gradient) || p.gradient.length !== 2) {
      problems.push(`${at}: gradient must be a 2-tuple`);
    }
    if (typeof p?.tagline !== "string") problems.push(`${at}: missing tagline`);
    for (const key of REQUIRED_TAGS) {
      if (!Array.isArray(p?.[key]) || p[key].some((t) => typeof t !== "string")) {
        problems.push(`${at}: ${key} must be a string[]`);
      }
    }
    for (const key of ["who", "building", "lookingFor"]) {
      if (typeof p?.intro?.[key] !== "string") problems.push(`${at}: intro.${key} missing`);
    }
    if (!Array.isArray(p?.cannedReplies)) problems.push(`${at}: cannedReplies must be an array`);
  });
  return problems;
}

/**
 * DynamoDB maps are unordered, so a round-tripped item comes back with its
 * keys in a different order. Sort them before comparing, or every row looks
 * like drift.
 */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const DEMO_PREFIX = "demo-";
const demoKey = (id) => `${DEMO_PREFIX}${id}`;
const isDemoKey = (key) => typeof key === "string" && key.startsWith(DEMO_PREFIX);

/* -------------------------------------------------------------------------- */
/* modes                                                                      */
/* -------------------------------------------------------------------------- */

async function scanDirectory() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await ddb.send(
      new ScanCommand({ TableName: USERS_TABLE, ExclusiveStartKey })
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

function describe(items) {
  const real = items.filter((i) => !isDemoKey(i.userId));
  const demo = items.filter((i) => isDemoKey(i.userId));

  console.log(`\n  ${items.length} row(s) in "${USERS_TABLE}"`);
  console.log(`    ${real.length} real user(s), ${demo.length} demo persona(s)\n`);

  if (items.length === 0) {
    console.log("    (empty — the bubble map will show the 'first one here' state)\n");
    return;
  }

  for (const item of items) {
    const p = item.profile ?? {};
    const kind = isDemoKey(item.userId) ? "demo" : "user";
    const skills = Array.isArray(p.softSkills) ? p.softSkills.length : "?";
    const interests = Array.isArray(p.interests) ? p.interests.length : "?";
    console.log(
      `    [${kind}] ${String(item.userId).padEnd(42)} ${String(p.name ?? "?").padEnd(12)}` +
        ` ${skills} skills / ${interests} interests`
    );
  }
  console.log("");
}

async function inspect() {
  console.log(`Reading directory "${USERS_TABLE}" in ${REGION}...`);
  describe(await scanDirectory());
}

async function writeDemo(personas) {
  console.log(`Writing ${personas.length} demo persona(s) to "${USERS_TABLE}"...`);
  for (const persona of personas) {
    const id = demoKey(persona.id);
    await ddb.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: {
          userId: id,
          profile: { ...persona, id },
          demo: true,
          updatedAt: Date.now(),
        },
      })
    );
    console.log(`  put ${id}`);
  }

  // Read back and prove what actually landed.
  const items = await scanDirectory();
  const written = items.filter((i) => isDemoKey(i.userId));
  console.log(`\nRead-back: ${written.length}/${personas.length} demo row(s) present.`);

  const expected = new Map(personas.map((p) => [demoKey(p.id), p]));
  let drift = 0;
  for (const [id, persona] of expected) {
    const row = written.find((w) => w.userId === id);
    if (!row) {
      console.log(`  MISSING ${id}`);
      drift += 1;
      continue;
    }
    const sent = stableStringify({ ...persona, id });
    const got = stableStringify(row.profile);
    if (sent !== got) {
      console.log(`  DRIFT   ${id} — round-tripped copy differs from lib/seed.ts`);
      drift += 1;
    }
  }
  if (drift === 0) console.log("  every row matches lib/seed.ts exactly.");

  describe(items);
  console.log(
    "NOTE: these rows are only shown when NEXT_PUBLIC_DEMO_PERSONAS=true.\n" +
      "      Run with --remove to take them back out.\n"
  );
  return drift === 0;
}

async function removeDemo() {
  const items = await scanDirectory();
  const demo = items.filter((i) => isDemoKey(i.userId));
  if (demo.length === 0) {
    console.log(`No demo rows in "${USERS_TABLE}" — nothing to remove.`);
  } else {
    console.log(`Removing ${demo.length} demo row(s) from "${USERS_TABLE}"...`);
    for (const item of demo) {
      await ddb.send(
        new DeleteCommand({ TableName: USERS_TABLE, Key: { userId: item.userId } })
      );
      console.log(`  deleted ${item.userId}`);
    }
  }
  describe(await scanDirectory());
}

/* -------------------------------------------------------------------------- */

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has("--remove")) {
    await removeDemo();
    return;
  }

  const { personas, how } = await loadPersonas();
  const checksum = createHash("sha256")
    .update(JSON.stringify(personas))
    .digest("hex")
    .slice(0, 12);
  console.log(`Source: ${how} — ${personas.length} persona(s), checksum ${checksum}`);

  const problems = validate(personas);
  if (problems.length > 0) {
    console.error("\nlib/seed.ts failed validation:");
    for (const p of problems) console.error(`  - ${p}`);
    throw new Error(`${problems.length} problem(s) in lib/seed.ts`);
  }
  console.log("Validation: all personas match the shape the API enforces.");

  if (args.has("--demo")) {
    const clean = await writeDemo(personas);
    if (!clean) throw new Error("read-back did not match what was written");
    return;
  }

  await inspect();
  console.log(
    "Modes: --demo writes the personas above into the directory, " +
      "--remove takes them back out.\n"
  );
}

main().catch((err) => {
  console.error("\nFailed:", err?.name ?? "Error", err?.message ?? err);
  process.exitCode = 1;
});
