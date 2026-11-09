// /api/openfinance — conexões bancárias via Open Finance (Pluggy).
import { authed, json } from "./_lib.mjs";
import {
  pluggyConfigured, pluggyClient, saveCreds, loadOF, saveOF, syncUser, publicOF, itemView, accountView, PluggyError,
} from "./_openfinance.mjs";

const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const s = await authed(req);
  if (!s) return json({ error: "sessao_expirada" }, 401);

  let body = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const user = s.sub;
  const action = body.action;

  try {
    if (action === "status") {
      const of = await loadOF(user);
      return json({ configured: await pluggyConfigured(), isAdmin: s.role === "admin", sandbox: process.env.PLUGGY_INCLUDE_SANDBOX === "1", ...publicOF(of) });
    }

    if (action === "save_credentials") {
      if (s.role !== "admin") return json({ error: "sem_permissao" }, 403);
      const clientId = String(body.clientId || "").trim();
      const clientSecret = String(body.clientSecret || "").trim();
      if (!clientId || !clientSecret || clientId.length > 100 || clientSecret.length > 200) return json({ error: "credenciais_invalidas" }, 400);
      await pluggyClient({ clientId, clientSecret });          // valida na Pluggy antes de gravar
      await saveCreds(clientId, clientSecret);
      return json({ ok: true, configured: true });
    }

    if (!(await pluggyConfigured())) return json({ error: "pluggy_nao_configurado" }, 503);

    if (action === "connect_token") {
      const pg = await pluggyClient();
      const itemId = body.itemId ? String(body.itemId).slice(0, 64) : undefined;
      const r = await pg.connectToken({ clientUserId: user, avoidDuplicates: false }, itemId);
      return json({ accessToken: r.accessToken });
    }

    if (action === "add_item") {
      const itemId = String(body.itemId || "").trim();
      if (!/^[0-9a-f-]{20,64}$/i.test(itemId)) return json({ error: "item_invalido" }, 400);
      console.log("openfinance add_item", user, itemId);
      const pg = await pluggyClient();
      const item = await pg.item(itemId);
      const of = await loadOF(user);
      const accs = (await pg.accounts(itemId)).results || [];
      let it = of.items.find((x) => x.id === itemId);
      const prevAcc = new Map((it?.accounts || []).map((a) => [a.id, a]));
      if (!it) { it = { id: itemId, addedAt: new Date().toISOString() }; of.items.push(it); }
      Object.assign(it, itemView(item), { accounts: accs.map((a) => accountView(a, prevAcc.get(a.id))) });
      if (of.items.length > 20) return json({ error: "limite_conexoes" }, 400);
      await saveOF(user, of);
      return json({ ok: true, ...publicOF(of) });
    }

    if (action === "link_accounts") {
      // body.links = [{ itemId, accountId, target, from }]
      const of = await loadOF(user);
      for (const l of Array.isArray(body.links) ? body.links.slice(0, 100) : []) {
        const acc = of.items.find((i) => i.id === l.itemId)?.accounts?.find((a) => a.id === l.accountId);
        if (!acc) continue;
        const target = String(l.target || "").slice(0, 60);
        if (target !== acc.target) acc.lastSync = null;      // trocou o destino: reimporta desde "from"
        acc.target = target;
        const from = isoDate(l.from);
        if (from && from !== acc.from) { acc.from = from; acc.lastSync = null; }
      }
      await saveOF(user, of);
      return json({ ok: true, ...publicOF(of) });
    }

    if (action === "sync") {
      const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(String) : undefined;
      const result = await syncUser(user, { itemIds, deadline: Date.now() + 45000 });
      const of = await loadOF(user);
      return json({ ok: true, result, ...publicOF(of) });
    }

    if (action === "refresh_item") {
      const pg = await pluggyClient();
      const of = await loadOF(user);
      const it = of.items.find((x) => x.id === body.itemId);
      if (!it) return json({ error: "nao_encontrado" }, 404);
      try { Object.assign(it, itemView(await pg.refreshItem(it.id))); }
      catch (e) { return json({ error: "atualizacao_indisponivel", detail: e.message }, 409); }
      await saveOF(user, of);
      return json({ ok: true, ...publicOF(of) });
    }

    if (action === "remove_item") {
      const of = await loadOF(user);
      const it = of.items.find((x) => x.id === body.itemId);
      if (!it) return json({ error: "nao_encontrado" }, 404);
      of.items = of.items.filter((x) => x.id !== it.id);
      if (body.revoke) {
        try { const pg = await pluggyClient(); await pg.deleteItem(it.id); } catch { /* já removido na Pluggy */ }
      }
      await saveOF(user, of);
      return json({ ok: true, ...publicOF(of) });
    }

    return json({ error: "acao_desconhecida" }, 400);
  } catch (e) {
    if (e instanceof PluggyError) {
      console.error("pluggy", e.status, e.body);
      const status = e.status === 404 ? 404 : e.status === 401 || e.status === 403 ? 502 : e.status === 503 ? 503 : 502;
      return json({ error: e.status === 404 ? "item_nao_encontrado" : e.status === 401 || e.status === 403 ? "pluggy_credenciais" : "pluggy_falhou", detail: e.message }, status);
    }
    console.error(e);
    return json({ error: "falha_interna" }, 500);
  }
};

export const config = { path: "/api/openfinance" };
