const TOKEN = process.env.TOKEN;
const REF = "ejzjrvazegaxrhqizgaa";
const DEMO_ORG = "61f7f96d-e80c-4d9b-a765-8eb32bd3c70d";
async function sql(q){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:"POST",headers:{Authorization:"Bearer "+TOKEN,"Content-Type":"application/json"},
    body:JSON.stringify({query:q})});
  return r.json();
}
const rows = await sql(`select coalesce(whatsapp_api_key,api_key) k, coalesce(whatsapp_api_token,api_token) t, coalesce(whatsapp_subdomain,subdomain) sub, coalesce(whatsapp_account_sid,account_sid) sid, waba_id from exotel_settings where org_id='${DEMO_ORG}' and is_active and whatsapp_enabled limit 1;`);
const s = rows[0];
const names = ["wallet_low_balance_admin_v1","wallet_exhausted_admin_v1"];
async function statusOf(n){
  const url = `https://${s.sub}/v2/accounts/${s.sid}/templates?waba_id=${s.waba_id}&name=${n}`;
  const j = await (await fetch(url, { headers:{ Authorization: "Basic "+Buffer.from(`${s.k}:${s.t}`).toString("base64") } })).json();
  return j?.response?.whatsapp?.templates?.[0]?.data?.status || "UNKNOWN";
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
for (let i=0;i<40;i++){
  const st = {};
  for (const n of names) st[n] = await statusOf(n);
  if (names.every(n => st[n] !== "PENDING")){ console.log("RESOLVED:", JSON.stringify(st)); process.exit(0); }
  await sleep(180000);
}
console.log("TIMEOUT still pending after ~2h");
