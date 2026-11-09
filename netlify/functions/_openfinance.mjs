// Open Finance via Pluggy — cliente da API, mapeamento e sincronização.
// Credenciais da Pluggy ficam só no servidor (PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET).
import { dataStore, pruneToTwoYears } from "./_lib.mjs";

const API = () => process.env.PLUGGY_API_URL || "https://api.pluggy.ai";
// Credenciais: variáveis de ambiente do Netlify ou, na falta delas, o cadastro feito
// pelo administrador no próprio FinNexus (Blobs, só no servidor — nunca volta ao navegador).
const CRED_KEY = "config/pluggy.json";
export async function pluggyCreds() {
  if (process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET)
    return { clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET, source: "env" };
  const c = await dataStore().get(CRED_KEY, { type: "json" }).catch(() => null);
  return c?.clientId && c?.clientSecret ? { ...c, source: "app" } : null;
}
export const saveCreds = (clientId, clientSecret) =>
  dataStore().setJSON(CRED_KEY, { clientId, clientSecret, savedAt: new Date().toISOString() });
export const pluggyConfigured = async () => !!(await pluggyCreds());

export const OF_KEY = (user) => `of/${user}.json`;
export const TX_KEY = (user) => `tx/${user}.json`;

// ── cliente HTTP ─────────────────────────────────────────────
export class PluggyError extends Error {
  constructor(status, body) {
    super((body && (body.message || body.error)) || `pluggy_${status}`);
    this.status = status; this.body = body;
  }
}

export async function pluggyClient(override) {
  const creds = override || (await pluggyCreds());
  if (!creds) throw new PluggyError(503, { message: "pluggy_nao_configurado" });
  const r = await fetch(`${API()}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: creds.clientId, clientSecret: creds.clientSecret }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.apiKey) throw new PluggyError(r.status, body);
  const apiKey = body.apiKey;

  async function call(method, path, { query, json } = {}) {
    const qs = query
      ? "?" + Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
      : "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${API()}/${path}${qs}`, {
        method,
        headers: { "content-type": "application/json", "X-API-KEY": apiKey },
        body: json ? JSON.stringify(json) : undefined,
      });
      if (res.status === 429 && attempt < 2) { await new Promise((ok) => setTimeout(ok, 1200 * (attempt + 1))); continue; }
      const out = res.status === 204 ? {} : await res.json().catch(() => ({}));
      if (!res.ok) throw new PluggyError(res.status, out);
      return out;
    }
  }

  return {
    connectToken: (options, itemId) => call("POST", "connect_token", { json: { ...(itemId ? { itemId } : {}), options } }),
    item: (id) => call("GET", `items/${encodeURIComponent(id)}`),
    refreshItem: (id) => call("PATCH", `items/${encodeURIComponent(id)}`, { json: {} }),
    deleteItem: (id) => call("DELETE", `items/${encodeURIComponent(id)}`),
    accounts: (itemId) => call("GET", "accounts", { query: { itemId } }),
    async transactions(accountId, dateFrom, deadline) {
      const all = [];
      let after;
      for (let page = 0; page < 40; page++) {
        const r = await call("GET", "v2/transactions", { query: { accountId, dateFrom, after } });
        all.push(...(r.results || []));
        if (!r.next) break;
        after = new URL(r.next, API()).searchParams.get("after");
        if (!after) break;
        if (deadline && Date.now() > deadline) break;
      }
      return all;
    },
  };
}

// ── documento de conexões do usuário ─────────────────────────
export async function loadOF(user) {
  const doc = (await dataStore().get(OF_KEY(user), { type: "json" })) || {};
  return { items: [], seen: {}, lastSync: null, lastResult: null, ...doc };
}
export const saveOF = (user, doc) => dataStore().setJSON(OF_KEY(user), doc);

const iso = (d) => (d ? String(d).slice(0, 10) : "");
const addDays = (isoDate, n) => { const d = new Date(isoDate + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function itemView(item) {
  const c = item.connector || {};
  return {
    id: item.id,
    connector: { id: c.id, name: c.name || "Banco", imageUrl: c.imageUrl || "", primaryColor: c.primaryColor || "" },
    status: item.status || "",
    executionStatus: item.executionStatus || "",
    lastUpdatedAt: item.lastUpdatedAt || null,
    error: item.error ? String(item.error.message || item.error.code || "").slice(0, 200) : "",
  };
}

export function accountView(a, prev = {}) {
  const cd = a.creditData || {};
  return {
    id: a.id,
    type: a.type,                       // BANK | CREDIT
    subtype: a.subtype || "",
    name: String(a.marketingName || a.name || "Conta").slice(0, 80),
    number: String(a.number || "").slice(0, 30),
    balance: Number(a.balance) || 0,
    currency: a.currencyCode || "BRL",
    creditLimit: Number(cd.creditLimit) || 0,
    closeDate: iso(cd.balanceCloseDate),
    dueDate: iso(cd.balanceDueDate),
    target: prev.target || "",
    from: prev.from || "",
    lastSync: prev.lastSync || null,
  };
}

// ── mapeamento de categoria Pluggy → FinNexus ───────────────
const SELF_TRANSFER = /same person|mesma titularidade|entre contas/i;
const CARD_PAYMENT = /credit card payment|pagamento de (cart|fatura)|fatura/i;

const EXPENSE_RULES = [
  [/gas station|fuel|combust|parking|estacion|taxi|ride|uber|99|toll|ped[aá]gio|transport|vehicle|automotive|mobilidade/i, "Transporte"],
  [/grocer|supermarket|supermercado|food|eating|restaurant|bakery|padaria|delivery|aliment|drinks|bares/i, "Alimentação"],
  [/rent|aluguel|housing|moradia|mortgage|electric|energia|water|[áa]gua|utilit|condom|home|casa/i, "Moradia"],
  [/telecom|internet|mobile|celular|phone|telefon/i, "Telecomunicações"],
  [/subscription|assinatura|streaming|digital service|software|video|music/i, "Assinaturas"],
  [/health|sa[uú]de|pharmac|farm[aá]c|hospital|clinic|dent|wellness|gym|fitness|academia/i, "Saúde"],
  [/educat|educa[cç]|school|escola|universit|course|curso|book|livr/i, "Educação"],
  [/leisure|lazer|entertain|cinema|game|sport|esporte|event|ticket/i, "Entretenimento"],
  [/\bpets?\b/i, "Pets"],
  [/travel|viage|airline|a[ée]reo|hotel|accommodation|lodging|hosped|airport|tour/i, "Viagens"],
  [/tax|tribut|impost|iof|iptu|ipva/i, "Impostos"],
  [/loan|empr[eé]st|financ|debt|d[ií]vida|interest|juros|late payment|overdraft/i, "Dívidas"],
  [/saving|poupan/i, "Poupança"],
  [/shopping|compras|cloth|vestu|electronic|eletr[oô]n|department|online|marketplace|store|loja/i, "Compras"],
  [/transfer|pix|ted\b|doc\b|withdraw|saque/i, "Transferências"],
];
const INCOME_RULES = [
  [/salary|sal[aá]rio|payroll|wage|proventos|pension|aposent/i, "Salário"],
  [/invest|interest|juros|dividend|yield|rendiment|redemption|resgate/i, "Investimentos"],
  [/freelanc|business|neg[oó]cio|sales|vendas/i, "Freelance/Negócios"],
];

export function mapCategory(t, type) {
  const c = `${t.category || ""}`;
  const desc = `${t.description || ""}`;
  if (SELF_TRANSFER.test(c)) return { cat: "Transferências", kind: "transfer", auto: false };
  if (CARD_PAYMENT.test(c) || (/pagamento.*fatura|pgto.*fatura|fatura.*cart/i.test(desc)))
    return { cat: "Cartões", kind: "transfer", auto: false };
  const rules = type === "income" ? INCOME_RULES : EXPENSE_RULES;
  for (const [re, cat] of rules) if (c && re.test(c)) return { cat, kind: "", auto: false };
  return { cat: type === "income" ? "Outros Rendimentos" : "Outros", kind: "", auto: true };
}

export function toFinNexus(t, acc, nowIso) {
  const type = t.type === "CREDIT" ? "income" : "expense";
  const { cat, kind, auto } = mapCategory(t, type);
  let desc = String(t.description || t.descriptionRaw || "Movimentação").replace(/\s+/g, " ").trim();
  const cm = t.creditCardMetadata || {};
  if (cm.totalInstallments > 1 && cm.installmentNumber && !/\d+\s*\/\s*\d+/.test(desc))
    desc += ` (${cm.installmentNumber}/${cm.totalInstallments})`;
  return {
    id: `of_${t.id}`,
    date: iso(t.date),
    desc: desc.slice(0, 240),
    cat,
    type,
    amount: Math.round(Math.abs(Number(t.amount) || 0) * 100) / 100,
    account: acc.target,
    status: t.status === "PENDING" ? "pending" : "paid",
    source: "openfinance",
    kind,
    transferId: "",
    ref: auto ? "of-auto" : "",
    importedAt: nowIso,
  };
}

// ── sincronização ────────────────────────────────────────────
// Atualiza status/contas de cada item e importa as movimentações das contas vinculadas.
export async function syncUser(user, { itemIds, deadline = Date.now() + 50000, client } = {}) {
  const pg = client || (await pluggyClient());
  const of = await loadOF(user);
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const result = { added: 0, updated: 0, accounts: 0, errors: [], at: nowIso };

  const txStore = dataStore();
  const txDoc = (await txStore.get(TX_KEY(user), { type: "json" })) || { transactions: [] };
  const txs = Array.isArray(txDoc.transactions) ? txDoc.transactions : [];
  const byId = new Map(txs.map((t) => [t.id, t]));
  let changed = false;

  for (const it of of.items) {
    if (itemIds && !itemIds.includes(it.id)) continue;
    if (Date.now() > deadline) { result.errors.push({ item: it.id, error: "tempo_esgotado" }); break; }
    try {
      Object.assign(it, itemView(await pg.item(it.id)));
      const accs = (await pg.accounts(it.id)).results || [];
      const prevById = new Map((it.accounts || []).map((a) => [a.id, a]));
      it.accounts = accs.map((a) => accountView(a, prevById.get(a.id)));
    } catch (e) {
      it.error = String(e.message || "falha").slice(0, 200);
      if (e.status === 404) it.status = "REMOVED";
      result.errors.push({ item: it.id, error: it.error });
      continue;
    }

    for (const acc of it.accounts) {
      if (!acc.target) continue;
      if (Date.now() > deadline) { result.errors.push({ account: acc.id, error: "tempo_esgotado" }); break; }
      const from = acc.from || addDays(today, -90);
      // reprocessa 15 dias para pegar lançamentos pendentes que viraram definitivos
      const dateFrom = acc.lastSync ? [from, addDays(acc.lastSync.slice(0, 10), -15)].sort()[1] : from;
      try {
        const list = await pg.transactions(acc.id, dateFrom, deadline);
        for (const t of list) {
          const nt = toFinNexus(t, acc, nowIso);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(nt.date) || nt.date < from || !nt.amount) continue;
          const cur = byId.get(nt.id);
          if (cur) {
            if (cur.status !== nt.status || cur.amount !== nt.amount || cur.date !== nt.date) {
              cur.status = nt.status; cur.amount = nt.amount; cur.date = nt.date;
              result.updated++; changed = true;
            }
          } else if (!of.seen[nt.id]) {          // já visto e ausente = o usuário excluiu
            txs.push(nt); byId.set(nt.id, nt);
            result.added++; changed = true;
          }
          of.seen[nt.id] = nt.date;
        }
        acc.lastSync = nowIso;
        result.accounts++;
      } catch (e) {
        result.errors.push({ account: acc.id, error: String(e.message || "falha").slice(0, 200) });
      }
    }
  }

  // limpa o histórico de "vistos" fora da janela de retenção
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 2);
  const cut = cutoff.toISOString().slice(0, 10);
  for (const [k, d] of Object.entries(of.seen)) if (d < cut) delete of.seen[k];

  if (changed) {
    await txStore.setJSON(TX_KEY(user), { ...txDoc, transactions: pruneToTwoYears(txs), updatedAt: nowIso });
  }
  of.lastSync = nowIso;
  of.lastResult = { added: result.added, updated: result.updated, errors: result.errors.length, at: nowIso };
  await saveOF(user, of);
  return result;
}

export function publicOF(of) {
  return {
    items: of.items.map(({ id, connector, status, executionStatus, lastUpdatedAt, error, addedAt, accounts }) =>
      ({ id, connector, status, executionStatus, lastUpdatedAt, error, addedAt, accounts: accounts || [] })),
    lastSync: of.lastSync,
    lastResult: of.lastResult,
  };
}
