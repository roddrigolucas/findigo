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
    return json({
      transactions: kept,
      accounts: doc.accounts || null,
      cards: doc.cards || null,
      investments: doc.investments || null,
      updatedAt: doc.updatedAt,
    });
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
        kind: ["transfer", "adjust", "card"].includes(t.kind) ? t.kind : "",
        transferId: String(t.transferId || "").slice(0, 40),
        ref: String(t.ref || "").slice(0, 20),
        ...(t.hidden ? { hidden: true } : {}),
      })).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    );

    const accounts = Array.isArray(body.accounts)
      ? body.accounts.slice(0, 100).map((a) => ({
          id: String(a.id || crypto.randomUUID()).slice(0, 40),
          name: String(a.name || "").slice(0, 60),
          initial: Number(a.initial) || 0,
          color: String(a.color || "#00E5FF").slice(0, 20),
        })).filter((a) => a.name)
      : undefined;

    const day = (v) => Math.min(31, Math.max(1, parseInt(v, 10) || 1));
    const cards = Array.isArray(body.cards)
      ? body.cards.slice(0, 50).map((c) => ({
          id: String(c.id || crypto.randomUUID()).slice(0, 40),
          name: String(c.name || "").slice(0, 60),
          limit: Math.max(0, Number(c.limit) || 0),
          closingDay: day(c.closingDay),
          dueDay: day(c.dueDay),
          color: String(c.color || "#A472FF").slice(0, 20),
          payFrom: String(c.payFrom || "").slice(0, 40),
          last4: String(c.last4 || "").replace(/\D/g, "").slice(-4),
        })).filter((c) => c.name)
      : undefined;

    const investments = Array.isArray(body.investments)
      ? body.investments.slice(0, 100).map((v) => ({
          id: String(v.id || crypto.randomUUID()).slice(0, 40),
          name: String(v.name || "").slice(0, 60),
          type: String(v.type || "Outros").slice(0, 30),
          institution: String(v.institution || "").slice(0, 60),
          color: String(v.color || "#00E5FF").slice(0, 20),
          initial: Number(v.initial) || 0,
          current: Number(v.current) || 0,
          updatedAt: String(v.updatedAt || "").slice(0, 10),
          history: Array.isArray(v.history)
            ? v.history.slice(-120).map((h) => ({ date: String(h.date || "").slice(0, 10), value: Number(h.value) || 0 }))
                .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date))
            : [],
        })).filter((v) => v.name)
      : undefined;

    const prev = (await store.get(key, { type: "json" })) || {};
    const updatedAt = new Date().toISOString();

    // O Open Finance grava direto no servidor. Se chegaram movimentações depois da última
    // leitura deste cliente, elas não estão no corpo — preserva em vez de apagar.
    const since = typeof body.since === "string" ? body.since : "";
    const sent = new Set(clean.map((t) => t.id));
    const merged = since
      ? (prev.transactions || []).filter((t) =>
          t.source === "openfinance" && t.importedAt && t.importedAt > since && !sent.has(t.id))
      : [];
    if (merged.length) clean.push(...merged);

    await store.setJSON(key, {
      transactions: clean,
      accounts: accounts ?? prev.accounts ?? null,
      cards: cards ?? prev.cards ?? null,
      investments: investments ?? prev.investments ?? null,
      updatedAt,
    });
    return json({ ok: true, count: clean.length, updatedAt, merged: merged.length });
  }

  if (req.method === "DELETE") {
    const prev = (await store.get(key, { type: "json" })) || {};
    await store.setJSON(key, { ...prev, transactions: [], updatedAt: new Date().toISOString() });
    return json({ ok: true });
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/data" };
