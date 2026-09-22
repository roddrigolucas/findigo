import { dataStore, authed, json, pruneToTwoYears } from "./_lib.mjs";

const KEY = (user) => `tx/${user}.json`;

export default async (req) => {
  const s = await authed(req);
  if (!s) return json({ error: "sessao_expirada" }, 401);

  const store = dataStore();
  const key = KEY(s.sub);

  // ── READ ───────────────────────────────────────────────────
  if (req.method === "GET") {
    const doc = (await store.get(key, { type: "json" })) || { transactions: [], updatedAt: null };
    const kept = pruneToTwoYears(doc.transactions || []);
    return json({ transactions: kept, updatedAt: doc.updatedAt });
  }

  // ── WRITE (full replace) ───────────────────────────────────
  if (req.method === "PUT") {
    let body = {};
    try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    if (!Array.isArray(body.transactions)) return json({ error: "formato_invalido" }, 400);
    if (body.transactions.length > 50000) return json({ error: "excede_limite" }, 413);

    const clean = pruneToTwoYears(
      body.transactions.map((t) => ({
        id: String(t.id || crypto.randomUUID()),
        date: String(t.date || "").slice(0, 10),
        desc: String(t.desc || "").slice(0, 240),
        cat: String(t.cat || "Outros").slice(0, 60),
        type: t.type === "income" ? "income" : "expense",
        amount: Number(t.amount) || 0,
        account: String(t.account || "").slice(0, 60),
        status: t.status === "pending" ? "pending" : "paid",
        source: String(t.source || "manual").slice(0, 40),
      })).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    );

    const updatedAt = new Date().toISOString();
    await store.setJSON(key, { transactions: clean, updatedAt });
    return json({ ok: true, count: clean.length, updatedAt });
  }

  if (req.method === "DELETE") {
    await store.setJSON(key, { transactions: [], updatedAt: new Date().toISOString() });
    return json({ ok: true });
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/data" };
