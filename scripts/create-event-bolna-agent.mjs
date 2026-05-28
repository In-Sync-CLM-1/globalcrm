// One-shot setup: create the Tanvi / Event Cold Intro Bolna agent and link it
// to the corresponding ai_call_scripts row. Already executed once for In-Sync
// Demo (org 61f7f96d…, agent ca01b4eb-56f5-4cae-957b-89f561201b82). Re-run is
// idempotent: it skips if the script already has a bolna_agent_id.
//
// Why this exists instead of letting the dialer auto-create on first call:
//   the dialer's _shared/aiCalling.ts createBolnaAgent still sets
//   samples_per_second=8000 on input/output, which poisons the welcome-message
//   audio cache and produces an elongated/stretched greeting. This script uses
//   the tuned recipe (no samples_per_second, caching:false, buffer_size:250)
//   that Nikita / GlobalCRM agent uses.
//
// Run: node scripts/create-event-bolna-agent.mjs
// Env: SUPABASE_ACCESS_TOKEN, BOLNA_API_KEY (both in globalcrm/.env).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
const envText = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  envText.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);

const SBP = env.SUPABASE_ACCESS_TOKEN;
const SB_PROJECT = env.SUPABASE_PROJECT_REF;
const BOLNA = env.BOLNA_API_KEY;
const SCRIPT_ID = "5ced1200-333e-4da7-be7f-112ccbb293c0"; // Event - Cold Intro v1
const WEBHOOK = `https://${SB_PROJECT}.supabase.co/functions/v1/ai-bolna-webhook`;

async function sbsql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${SB_PROJECT}/database/query`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SBP}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return r.json();
}

function composeSystemPrompt(s) {
  const keyPoints = Array.isArray(s.key_points) ? s.key_points : [];
  const objections = s.objection_handling && typeof s.objection_handling === "object"
    ? s.objection_handling : {};
  const productLabel = s.product_name || "our product";
  const parts = [
    `You are an AI sales agent for ${productLabel}, calling {first_name} {last_name} from {company}.`,
    `Your objective: ${s.objective}`,
    "",
    "Opening line:",
    s.opening,
    "",
  ];
  if (keyPoints.length) {
    parts.push("Key talking points (weave these in naturally):");
    for (const p of keyPoints) parts.push(`- ${p}`);
    parts.push("");
  }
  const objKeys = Object.keys(objections);
  if (objKeys.length) {
    parts.push("If they raise objections, here is how to respond:");
    for (const k of objKeys) parts.push(`\n${k}:\n${objections[k]}`);
    parts.push("");
  }
  if (s.closing) { parts.push("Closing:", s.closing, ""); }
  if (s.product_notes) {
    parts.push("=== Product Reference (use this to answer detailed questions during the call. Treat these facts as authoritative; never invent pricing, features, or customer names outside this section.) ===");
    parts.push(s.product_notes);
    parts.push("=== End Product Reference ===", "");
  }
  if (s.behavioral_guidelines) {
    parts.push("=== Behavioral guidelines (how to handle the call, not what to say) ===");
    parts.push(s.behavioral_guidelines);
    parts.push("=== End behavioral guidelines ===", "");
  }
  parts.push(
    "=== Speaking style ===",
    "Speak naturally and conversationally, like a warm, professional sales rep — not a script reader.",
    "Listen actively. Imagine you are talking to a busy operations head.",
    "End each thought clearly so the prospect has a chance to respond.",
    "",
    "=== Pronunciation rules (the synthesizer reads your text literally) ===",
    "Say \"In-Sync\" as one phrase (two words: \"in sync\").",
    "Say \"Event\" as the product name; capitalise it in your delivery.",
    "Say \"B2B\" as \"B to B\".",
    "Say \"SaaS\" as \"sass\".",
    "Say \"rupees\" always. Never write \"Rs\".",
    "For amounts and numbers, prefer spoken form.",
    "",
    `Speak in clear, natural ${s.language === "hi" ? "Hindi" : "English"}.`
  );
  return parts.join("\n");
}

async function main() {
  const rows = await sbsql(`select * from ai_call_scripts where id='${SCRIPT_ID}';`);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("script not found: " + JSON.stringify(rows));
  }
  const s = rows[0];
  if (s.bolna_agent_id) {
    console.log("Already linked, skipping:", s.bolna_agent_id);
    return;
  }

  const body = {
    agent_config: {
      agent_name: `gcrm-${s.id.slice(0, 8)}-${Date.now()}`,
      agent_welcome_message: s.opening,
      webhook_url: WEBHOOK,
      tasks: [{
        task_type: "conversation",
        toolchain: { execution: "parallel", pipelines: [["transcriber", "llm", "synthesizer"]] },
        tools_config: {
          input: { provider: "exotel", format: "wav" },
          output: { provider: "exotel", format: "wav" },
          llm_agent: {
            agent_type: "simple_llm_agent",
            agent_flow_type: "streaming",
            llm_config: { family: "openai", model: "gpt-4o-mini", temperature: 0.4, max_tokens: 150 },
          },
          transcriber: {
            provider: "deepgram", model: "nova-2", language: s.language || "en",
            stream: true, encoding: "linear16", endpointing: 400,
          },
          synthesizer: {
            provider: "elevenlabs", stream: true,
            buffer_size: 250, caching: false,
            provider_config: {
              voice: s.voice_name || "Riya Rao - Professional Voice",
              voice_id: s.voice_id || "vYENaCJHl4vFKNDYPr8y",
              model: "eleven_turbo_v2_5",
            },
          },
        },
        task_config: {
          hangup_after_silence: 10,
          call_terminate: s.max_duration_seconds || 240,
          backchanneling: false,
          check_if_user_online: false,
          optimize_latency: true,
        },
      }],
    },
    agent_prompts: { task_1: { system_prompt: composeSystemPrompt(s) } },
  };

  const r = await fetch("https://api.bolna.ai/v2/agent", {
    method: "POST",
    headers: { "Authorization": `Bearer ${BOLNA}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Bolna agent create failed: ${r.status} ${text}`);
  const j = JSON.parse(text);
  const agentId = j.agent_id ?? j.id;
  if (!agentId) throw new Error("Bolna response missing id: " + text);
  console.log("Created Bolna agent:", agentId);

  await fetch(`https://api.bolna.ai/v2/agent/${agentId}`, {
    method: "PATCH",
    headers: { "Authorization": `Bearer ${BOLNA}`, "Content-Type": "application/json" },
    body: JSON.stringify({ agent_config: { agent_name: "Tanvi - Event Sales" } }),
  });

  const upd = await sbsql(
    `update ai_call_scripts set bolna_agent_id='${agentId}', updated_at=now() where id='${SCRIPT_ID}' returning id, bolna_agent_id;`
  );
  console.log("Linked:", JSON.stringify(upd));
}

main().catch((e) => { console.error(e); process.exit(1); });
