// Starts dialixa-sync (Ajimos call reports) every 5 minutes. Holds only the token for that one function.
export default {
  async scheduled(_event, env) {
    const res = await fetch(`${env.SUPABASE_URL}/functions/v1/dialixa-sync`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-sync-token": env.DIALIXA_SYNC_TOKEN }, body: "{}",
    });
    console.log("dialixa-sync", res.status, (await res.text()).slice(0, 300));
  },
};
