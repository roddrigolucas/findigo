// Sincronização automática do Open Finance — a cada 4 horas (UTC: 00:23, 04:23, 08:23 …
// = 21:23, 01:23, 05:23, 09:23, 13:23, 17:23 em Brasília).
// A Pluggy/MeuPluggy atualiza os dados do banco ~1×/dia; aqui só trazemos o que chegou.
import { dataStore } from "./_lib.mjs";
import { pluggyConfigured, pluggyClient, syncUser } from "./_openfinance.mjs";

export default async () => {
  if (!(await pluggyConfigured())) return;
  const deadline = Date.now() + 25000;               // limite de 30 s das funções agendadas
  const { blobs } = await dataStore().list({ prefix: "of/" });
  const client = await pluggyClient();
  const docs = [];
  for (const b of blobs) {
    const doc = await dataStore().get(b.key, { type: "json" });
    if (doc?.items?.some((i) => i.accounts?.some((a) => a.target))) docs.push({ user: b.key.slice(3, -5), last: doc.lastSync || "" });
  }
  docs.sort((a, b) => a.last.localeCompare(b.last));  // quem está há mais tempo sem sincronizar vai primeiro
  for (const d of docs) {
    if (Date.now() > deadline - 5000) break;
    try {
      const r = await syncUser(d.user, { client, deadline });
      console.log(`openfinance ${d.user}: +${r.added} ~${r.updated} erros=${r.errors.length}`);
    } catch (e) {
      console.error(`openfinance ${d.user}:`, e.message);
    }
  }
};

export const config = { schedule: "23 */4 * * *" };
