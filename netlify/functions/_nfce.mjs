// ══ Cupom fiscal (NFC-e / CF-e SAT / NF-e) — leitura do QR Code ou código de barras ══
// Funções puras (testáveis) + busca na SEFAZ e no cadastro de CNPJ.

const UF = { 11:"RO",12:"AC",13:"AM",14:"RR",15:"PA",16:"AP",17:"TO",21:"MA",22:"PI",23:"CE",24:"RN",25:"PB",26:"PE",27:"AL",28:"SE",29:"BA",
  31:"MG",32:"ES",33:"RJ",35:"SP",41:"PR",42:"SC",43:"RS",50:"MS",51:"MT",52:"GO",53:"DF" };
const MODELO = { "55":"NF-e", "59":"CF-e SAT", "65":"NFC-e" };

const num = (v) => {
  if (v == null) return null;
  let s = String(v).trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");     // 1.234,56 → 1234.56
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const hexToStr = (h) => { try { return /^[0-9a-f]+$/i.test(h) && h.length % 2 === 0 ? h.match(/../g).map((x) => String.fromCharCode(parseInt(x, 16))).join("") : h; } catch { return h; } };
const isoFromBR = (s) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

// Decompõe a chave de acesso (44 dígitos). Só os 22 primeiros têm layout comum a NF-e/NFC-e/SAT.
export function parseChave(ch) {
  if (!/^\d{44}$/.test(ch || "")) return null;
  const cuf = +ch.slice(0, 2), aa = ch.slice(2, 4), mm = ch.slice(4, 6), mod = ch.slice(20, 22);
  if (!UF[cuf] || +mm < 1 || +mm > 12 || !MODELO[mod]) return null;
  return { chave: ch, uf: UF[cuf], ym: `20${aa}-${mm}`, cnpj: ch.slice(6, 20), modelo: mod, modeloNome: MODELO[mod] };
}

// Interpreta o texto lido da câmera.
export function parseCode(raw) {
  const code = String(raw || "").trim();
  const out = { raw: code.slice(0, 600), url: "", amount: null, date: "", day: "" };

  // CF-e SAT: chave|AAAAMMDDhhmmss|valor|CPF|assinatura
  let m = /^(?:CFe)?(\d{44})\|(\d{14})\|([\d.,]+)/.exec(code);
  if (m) {
    const c = parseChave(m[1]); if (!c) return null;
    const d = m[2];
    return { ...out, ...c, amount: num(m[3]), date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` };
  }
  // URL (NFC-e QR Code 1.0 / 2.0)
  if (/^https?:\/\//i.test(code)) {
    let u; try { u = new URL(code); } catch { return null; }
    out.url = u.href;
    const p = u.searchParams.get("p");
    if (p) {                                                   // 2.0: chave|2|amb|cIdToken|hash  ou  chave|2|amb|dia|valor|digVal|cIdToken|hash
      const parts = p.split("|");
      const c = parseChave((parts[0] || "").replace(/\D/g, "")); if (!c) return null;
      if (parts.length >= 8) { out.day = /^\d{1,2}$/.test(parts[3]) ? parts[3].padStart(2, "0") : ""; out.amount = num(parts[4]); }
      return { ...out, ...c };
    }
    const ch = (u.searchParams.get("chNFe") || u.searchParams.get("chave") || "").replace(/\D/g, "");
    const c = parseChave(ch); if (!c) return null;            // 1.0: ...&vNF=12.34&dhEmi=<hex>
    out.amount = num(u.searchParams.get("vNF"));
    const dh = hexToStr(u.searchParams.get("dhEmi") || "");
    if (/^\d{4}-\d{2}-\d{2}/.test(dh)) out.date = dh.slice(0, 10);
    return { ...out, ...c };
  }
  // código de barras / chave digitada (44 dígitos, com ou sem espaços)
  const digits = code.replace(/\D/g, "");
  if (digits.length === 44) { const c = parseChave(digits); return c ? { ...out, ...c } : null; }
  return null;
}

// Só o QR Code traz o link de consulta (com o hash exigido pela SEFAZ). Código de barras = só a chave.
export function consultaUrl(info) { return info.url || ""; }

// Extrai total, data, emitente, itens e pagamento da página (HTML) ou do XML da SEFAZ.
export function parseSefazPage(body) {
  const r = { amount: null, date: "", store: "", items: [], payment: "" };
  if (!body) return r;
  const s = String(body);
  // XML (alguns estados devolvem o XML da nota)
  if (/<(nfeProc|NFe|CFe|infNFe|infCFe)\b/.test(s)) {
    const tag = (t, src = s) => { const m = new RegExp(`<${t}>([^<]*)</${t}>`).exec(src); return m ? m[1].trim() : ""; };
    r.amount = num(tag("vNF") || tag("vCFe"));
    const dh = tag("dhEmi") || (tag("dEmi") ? `${tag("dEmi").slice(0, 4)}-${tag("dEmi").slice(4, 6)}-${tag("dEmi").slice(6, 8)}` : "");
    r.date = /^\d{4}-\d{2}-\d{2}/.test(dh) ? dh.slice(0, 10) : "";
    const emit = (/<emit>([\s\S]*?)<\/emit>/.exec(s) || [])[1] || "";
    r.store = tag("xFant", emit) || tag("xNome", emit);
    for (const m of s.matchAll(/<prod>([\s\S]*?)<\/prod>/g)) r.items.push({ name: tag("xProd", m[1]), value: num(tag("vProd", m[1])) });
    const tp = tag("tPag") || tag("cMP");
    r.payment = { "01":"dinheiro", "03":"credito", "04":"debito", "17":"pix", "05":"credito" }[tp] || "";
    return r;
  }
  // HTML: layout nacional do DANFE NFC-e (ids/classes usados pela maioria das SEFAZ)
  const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|tr|p|li|h\d|td|th|span)>/gi, "$&\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/[ \t]+/g, " ");
  const byId = (id) => { const m = new RegExp(`id=["']${id}["'][^>]*>([\\s\\S]*?)</`, "i").exec(s); return m ? strip(m[1]).trim() : ""; };
  const byClass = (cls) => [...s.matchAll(new RegExp(`class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)</`, "gi"))].map((m) => strip(m[1]).trim());
  const text = strip(s);

  r.store = byId("u20") || byClass("txtTopo")[0] || "";
  const tot = byClass("totalNumb");
  const vp = /Valor\s+a\s+pagar\s*R?\$?\s*:?\s*([\d.]+,\d{2})/i.exec(text) || /Valor\s+total\s*R?\$?\s*:?\s*([\d.]+,\d{2})/i.exec(text)
    || /Total\s*(?:da\s*nota|R\$)\s*:?\s*([\d.]+,\d{2})/i.exec(text);
  r.amount = vp ? num(vp[1]) : (tot.length ? num(tot.filter((x) => /\d,\d{2}/.test(x)).pop()) : null);
  const em = /Emiss[aã]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text) || /Data\s*(?:de\s*)?Emiss[aã]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  r.date = em ? isoFromBR(em[1]) : "";
  if (!r.store) { const n = /(?:Raz[aã]o\s*Social|Nome\s*\/\s*Raz[aã]o\s*Social|Emitente)\s*:?\s*\n?\s*([^\n]{3,80})/i.exec(text); if (n) r.store = n[1].trim(); }
  const names = byClass("txtTit"), vals = byClass("valor");
  names.forEach((n, i) => { if (n && !/^\s*$/.test(n)) r.items.push({ name: n.replace(/\s+/g, " ").trim(), value: num(vals[i]) }); });
  if (/cart[aã]o\s*de\s*cr[eé]dito/i.test(text)) r.payment = "credito";
  else if (/cart[aã]o\s*de\s*d[eé]bito/i.test(text)) r.payment = "debito";
  else if (/\bpix\b|pagamento\s*instant/i.test(text)) r.payment = "pix";
  else if (/\bdinheiro\b/i.test(text)) r.payment = "dinheiro";
  r.store = r.store.replace(/\s+/g, " ").slice(0, 80);
  r.items = r.items.slice(0, 60);
  return r;
}

async function fetchText(url, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: {
      "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "pt-BR,pt;q=0.9" } });
    if (!res.ok) return "";
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "";
    const enc = /iso-8859-1|latin1|windows-1252/i.test(ct) ? "latin1" : "utf-8";
    return new TextDecoder(enc).decode(buf);
  } catch { return ""; } finally { clearTimeout(t); }
}

export async function lookupCnpj(cnpj, ms = 4500) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: ctl.signal });
    if (!res.ok) return null;
    const j = await res.json();
    return { name: (j.nome_fantasia || j.razao_social || "").trim(), legal: (j.razao_social || "").trim(),
      cnae: String(j.cnae_fiscal || ""), cnaeDesc: j.cnae_fiscal_descricao || "" };
  } catch { return null; } finally { clearTimeout(t); }
}

// Fluxo completo: código → dados do cupom.
export async function readCupom(code, { fetchPage = fetchText, cnpjLookup = lookupCnpj } = {}) {
  const info = parseCode(code);
  if (!info) return { error: "codigo_invalido" };
  const url = consultaUrl(info);
  let host = ""; try { host = url ? new URL(url).hostname : ""; } catch {}
  const safe = /\.gov\.br$/i.test(host);                       // só consulta portais oficiais
  const [page, emp] = await Promise.all([
    safe ? fetchPage(url, 7000).then(parseSefazPage).catch(() => null) : Promise.resolve(null),
    cnpjLookup(info.cnpj).catch(() => null),
  ]);
  const amount = info.amount || page?.amount || null;
  let date = info.date || page?.date || "";
  if (!date && info.day) date = `${info.ym}-${info.day}`;
  return {
    chave: info.chave, modelo: info.modeloNome, uf: info.uf, ym: info.ym, cnpj: info.cnpj,
    amount, date, items: page?.items || [], payment: page?.payment || "",
    store: (emp?.name || page?.store || "").slice(0, 80), legal: emp?.legal || page?.store || "",
    cnae: emp?.cnae || "", cnaeDesc: emp?.cnaeDesc || "",
    consulta: url, sefaz: !!(page && (page.amount || page.items.length)),
  };
}
