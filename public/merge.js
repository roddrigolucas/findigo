/* ══ FinDigo — combinar transações repetidas ══════════════════
   Ex.: "Aluguel" (lançamento recorrente) + "PIX enviado" (extrato) = o mesmo dinheiro.
   Combinar junta as duas numa só: categoria do lançamento planejado, data/conta/valor do
   pagamento real, e guarda as originais para poder separar depois.                       */

const PAY_RX = /\bpix\b|transf|\bted\b|\bdoc\b|pagamento|pgto|boleto|d[eé]bito|compra\s/i;
const isPaymentLike = (t) => ['import', 'openfinance', 'cupom'].includes(t.source) || PAY_RX.test(t.desc);
const MERGE_KEYS = ['id','date','desc','cat','sub','type','amount','account','status','source','kind','ref','nfce','recurId','recurIdx','recurN'];
const slim = (t) => Object.fromEntries(MERGE_KEYS.filter(k => t[k] !== undefined && t[k] !== '').map(k => [k, t[k]]));
const originalsOf = (t) => (t.mergedFrom && t.mergedFrom.length ? t.mergedFrom : [slim(t)]);
const stripCombined = (d) => String(d || '').replace(/\s*\(combinada\)\s*$/i, '').trim();

// o pagamento "de verdade" (dá data, conta e valor)
function pickReal(list){
  const score = (t) => (t.status === 'paid' ? 4 : 0) + (isPaymentLike(t) ? 2 : 0) + (t.source !== 'manual' ? 1 : 0);
  return [...list].sort((a, b) => score(b) - score(a) || b.date.localeCompare(a.date))[0];
}
// o lançamento que melhor descreve a despesa (dá descrição e categoria)
function pickInfo(list){
  const score = (t) => (groupOf(t.cat) ? 4 : 0) + (t.recurId ? 3 : 0) + (t.source === 'manual' ? 2 : 0) + (isPaymentLike(t) ? 0 : 1);
  return [...list].sort((a, b) => score(b) - score(a))[0];
}

function canCombine(list){
  if (list.length < 2) return 'Selecione pelo menos 2 transações para combinar.';
  if (list.some(t => t.kind === 'transfer')) return 'Transferências entre contas e pagamentos de fatura não podem ser combinados.';
  if (new Set(list.map(t => t.type)).size > 1) return 'Só dá para combinar transações do mesmo tipo (todas despesas ou todas receitas).';
  return '';
}

function buildMerged(list, { amount, dateFrom, desc } = {}){
  const real = dateFrom ? list.find(t => t.id === dateFrom) || pickReal(list) : pickReal(list);
  const info = pickInfo(list);
  const rec = list.find(t => t.recurId);
  const nf = list.find(t => t.nfce);
  const m = {
    ...real,
    desc: desc || `${stripCombined(info.desc)} (combinada)`,
    cat: info.cat, sub: info.sub,
    amount: r2(amount != null ? amount : real.amount),
    status: list.some(t => t.status === 'paid') ? 'paid' : real.status,
    hidden: false,
    mergedFrom: list.flatMap(originalsOf).slice(0, 10),
  };
  delete m.recurId; delete m.recurIdx; delete m.recurN;
  if (rec) Object.assign(m, { recurId: rec.recurId, recurIdx: rec.recurIdx, recurN: rec.recurN });
  if (nf) m.nfce = nf.nfce;
  return m;
}

function applyMerge(list, opts){
  const m = buildMerged(list, opts);
  const ids = new Set(list.map(t => t.id));
  const at = transactions.findIndex(t => ids.has(t.id));
  transactions = transactions.filter(t => !ids.has(t.id));
  transactions.splice(Math.max(0, at), 0, m);
  return m;
}

function splitMerged(id){
  const t = transactions.find(x => x.id === id);
  if (!t?.mergedFrom?.length) return;
  if (!confirm(`Separar de novo em ${t.mergedFrom.length} transações?`)) return;
  const back = t.mergedFrom.map(o => normalize({ ...o, id: transactions.some(x => x.id === o.id && x !== t) ? uid() : o.id }));
  transactions = transactions.flatMap(x => x === t ? back : [x]);
  persist(); populateFilters(); renderAll(); toast('Combinação desfeita');
}

// ── folha "Combinar transações" ──────────────────────────────
function openMergeSheet(ids, onDone){
  const list = ids.map(id => transactions.find(t => t.id === id)).filter(Boolean);
  const err = canCombine(list);
  if (err){ toast(err); return; }
  const real = pickReal(list), info = pickInfo(list);
  const amounts = [...new Set(list.map(t => r2(t.amount)))];
  const sum = r2(list.reduce((s, t) => s + t.amount, 0));
  const sh = $('#sheet-merge .sheet');
  sh.innerHTML = `
    <div class="sheet-grip"></div>
    <h3 class="mg-title">Combinar ${list.length} transações</h3>
    <p class="mg-sub">Elas viram uma só — o dinheiro conta uma vez. Dá para separar depois.</p>
    <ul class="mg-list">${list.map(t => `<li><span><b>${esc(t.desc)}</b><small>${fmtDMY(t.date)} · ${esc(t.account || 'sem conta')} · ${esc(t.cat)}${t.status === 'pending' ? ' · prevista' : ''}</small></span><em class="${t.type === 'income' ? 'pos' : 'neg'}">${fmtBRL(t.amount)}</em></li>`).join('')}</ul>
    <div class="mg-fields">
      <label>Descrição<input id="mg-desc" maxlength="240" value="${esc(stripCombined(info.desc) + ' (combinada)')}"></label>
      <label>Valor<select id="mg-amount">${amounts.map(a => `<option value="${a}">${fmtBRL(a)}</option>`).join('')}${amounts.length > 1 || list.length > 2 ? `<option value="${sum}">Somar tudo — ${fmtBRL(sum)}</option>` : ''}</select></label>
      <label>Data e conta de<select id="mg-from">${list.map(t => `<option value="${esc(t.id)}">${fmtDMY(t.date)} · ${esc(t.account || 'sem conta')} — ${esc(t.desc).slice(0, 28)}</option>`).join('')}</select></label>
      <p class="mg-cat">Categoria: <b>${catIcon(info.cat)} ${esc(info.cat)} › ${esc(info.sub || '')}</b>${list.some(t => t.recurId) ? ' · continua na série recorrente' : ''}</p>
    </div>
    <div class="mg-actions"><button class="btn-ghost" id="mg-cancel">Cancelar</button><button class="btn-primary" id="mg-ok">⧉ Combinar</button></div>`;
  $('#mg-amount').value = String(r2(real.amount));
  $('#mg-from').value = real.id;
  $('#mg-cancel').addEventListener('click', closeSheets);
  $('#mg-ok').addEventListener('click', () => {
    const desc = $('#mg-desc').value.trim() || `${stripCombined(info.desc)} (combinada)`;
    applyMerge(list, { amount: Number($('#mg-amount').value), dateFrom: $('#mg-from').value, desc });
    selectedTxs.clear(); closeSheets();
    persist(); populateFilters(); renderAll();
    toast(`${list.length} transações combinadas em uma`);
    if (onDone) onDone();
  });
  openSheet('#sheet-merge');
}

// ── possíveis repetidas: lançamento planejado/manual × pagamento do extrato ──
// mesmo tipo e valor, até 5 dias de diferença, e um dos dois com cara de pagamento (PIX, extrato, cupom…)
function findMergeSuggestions(){
  const cents = (v) => Math.round(v * 100);
  const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  const pool = transactions.filter(t => !t.kind && !t.hidden && !MOVE_IDS.has(t.id) && !t.mergedFrom);
  const byKey = new Map();
  pool.forEach(t => { const k = t.type + '|' + cents(t.amount); (byKey.get(k) || byKey.set(k, []).get(k)).push(t); });
  const used = new Set(), pairs = [];
  byKey.forEach(arr => {
    if (arr.length < 2) return;
    const cand = [];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++){
      const a = arr[i], b = arr[j], d = days(a.date, b.date);
      if (d > 5) continue;
      const exact = a.date === b.date && sameName(a.account, b.account) && normName(a.desc) === normName(b.desc);
      if (exact) continue;                                     // cópia idêntica: vai para "Duplicadas"
      if (!(isPaymentLike(a) || isPaymentLike(b))) continue;
      if (isPaymentLike(a) && isPaymentLike(b) && normName(a.desc) !== normName(b.desc) && a.source === b.source) continue;  // dois pagamentos diferentes
      cand.push({ a, b, d });
    }
    cand.sort((x, y) => x.d - y.d).forEach(({ a, b }) => {
      if (used.has(a.id) || used.has(b.id)) return;
      used.add(a.id); used.add(b.id); pairs.push([a, b]);
    });
  });
  return pairs.sort((x, y) => y[0].date.localeCompare(x[0].date));
}

function openRepeatsSheet(){
  const dups = findDuplicates();
  const pairs = findMergeSuggestions();
  const row = (t) => `<span><b>${esc(t.desc)}</b><small>${fmtDMY(t.date)} · ${esc(t.account || 'sem conta')}${t.status === 'pending' ? ' · prevista' : ''}${t.recurId ? ' · recorrente' : ''}</small></span>`;
  const sh = $('#sheet-merge .sheet');
  sh.innerHTML = `
    <div class="sheet-grip"></div>
    <h3 class="mg-title">Transações repetidas</h3>
    <div class="rp-block">
      <div class="rp-h"><b>Cópias idênticas</b><span class="${dups.size ? '' : 'zero'}">${dups.size ? `${dups.size} sobrando` : 'nenhuma'}</span></div>
      <p class="mg-sub">Mesma data, valor, conta e descrição — fica só uma de cada.</p>
      ${dups.size ? '<button class="btn-ghost rp-btn" id="rp-dedupe">Remover cópias</button>' : ''}
    </div>
    <div class="rp-block">
      <div class="rp-h"><b>Mesmo gasto lançado duas vezes</b><span class="${pairs.length ? '' : 'zero'}">${pairs.length ? `${pairs.length} ${pairs.length === 1 ? 'par' : 'pares'}` : 'nenhum'}</span></div>
      <p class="mg-sub">Ex.: o aluguel planejado e o PIX que pagou o aluguel. Combinar deixa uma só transação.</p>
      ${pairs.length ? `<ul class="rp-list">${pairs.map(([a, b], i) => `<li>
        <div class="rp-pair">${row(a)}${row(b)}</div>
        <div class="rp-side"><em class="${a.type === 'income' ? 'pos' : 'neg'}">${fmtBRL(a.amount)}</em><button class="btn-primary rp-one" data-pair="${i}">⧉ Combinar</button></div></li>`).join('')}</ul>
        ${pairs.length > 1 ? '<button class="btn-ghost rp-btn" id="rp-all">Combinar todos os pares</button>' : ''}` : ''}
      <p class="mg-tip">Não achou? Na lista, marque as transações e use <b>⧉ Combinar</b>.</p>
    </div>
    <div class="mg-actions"><button class="btn-ghost" id="mg-cancel">Fechar</button></div>`;
  $('#mg-cancel').addEventListener('click', closeSheets);
  $('#rp-dedupe')?.addEventListener('click', () => { closeSheets(); try { localStorage.removeItem('fn_dedupe_skip'); } catch {} offerDedupe(false); });
  sh.querySelectorAll('[data-pair]').forEach(b => b.addEventListener('click', () => {
    const [a, c] = pairs[+b.dataset.pair];
    openMergeSheet([a.id, c.id], () => setTimeout(openRepeatsSheet, 250));
  }));
  $('#rp-all')?.addEventListener('click', () => {
    if (!confirm(`Combinar os ${pairs.length} pares? Cada par vira uma transação (dá para separar depois).`)) return;
    pairs.forEach(p => applyMerge(p));
    closeSheets(); persist(); populateFilters(); renderAll();
    toast(`${pairs.length} pares combinados`);
  });
  openSheet('#sheet-merge');
}
