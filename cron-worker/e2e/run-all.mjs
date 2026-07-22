// Runs every native-worker E2E check in this directory. Drop a new
// <worker-name>.mjs file here (exporting an async run(env) that throws on
// failure) and it's picked up automatically on the next deploy — no workflow
// changes needed. Worker name -> URL is derived from the filename, matching
// the globalcrm-cron-<name> naming used by native-jobs.txt.
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const CF_WORKERS_SUBDOMAIN = requireEnv("CF_WORKERS_SUBDOMAIN");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`missing required env: ${name}`); process.exit(1); }
  return v;
}

const files = readdirSync(here).filter((f) => f.endsWith(".mjs") && f !== "run-all.mjs");
if (files.length === 0) { console.log("no e2e checks found — nothing to run"); process.exit(0); }

let failed = 0;
for (const file of files) {
  const name = file.replace(/\.mjs$/, "");
  const workerUrl = `https://globalcrm-cron-${name}.${CF_WORKERS_SUBDOMAIN}.workers.dev`;
  const env = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_URL: workerUrl };
  process.stdout.write(`-- ${name} (${workerUrl}) ... `);
  try {
    const mod = await import(pathToFileURL(join(here, file)));
    await mod.run(env);
    console.log("PASS");
  } catch (e) {
    console.log("FAIL");
    console.error(`   ${e.stack || e}`);
    failed++;
  }
}

console.log(`\n---- e2e: ${files.length - failed}/${files.length} passed ----`);
process.exit(failed > 0 ? 1 : 0);
