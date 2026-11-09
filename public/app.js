/* ══ FinNexus — app ═════════════════════════════════════════ */

// ── Constantes ──────────────────────────────────────────────
const INCOME_CATS  = ['Salário','Freelance/Negócios','Investimentos','Outros Rendimentos'];
const EXPENSE_CATS = ['Alimentação','Moradia','Transporte','Saúde','Educação','Entretenimento',
  'Assinaturas','Compras','Cartões','Telecomunicações','Pets','Viagens','Dívidas',
  'Transferências','Poupança','Impostos','Outros'];
const ALL_CATS = [...INCOME_CATS, ...EXPENSE_CATS];
const ACCOUNTS = ['Santander', 'Nubank', 'Caixa Poup.Rodrigo', 'Caixa Vó', 'BB Vó', 'Inter', 'Em caixa (efetivo)'];
const ACC_COLORS = ['#FF2E4D','#A472FF','#3D8BFF','#00B8FF','#FFE066','#FF7A00','#3DFF9E'];
const DEFAULT_ACCOUNTS = ACCOUNTS.map((name,i) => ({ id:'acc'+i, name, initial:0, color: ACC_COLORS[i % ACC_COLORS.length] }));
const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTHS_FULL = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

// paleta neon para categorias
const CAT_COLORS = {
  'Salário':'#3DFF9E','Freelance/Negócios':'#5CFFC8','Investimentos':'#00E5FF','Outros Rendimentos':'#7CFFB2',
  'Alimentação':'#FF2E97','Moradia':'#FF6B3D','Transporte':'#FFC44D','Saúde':'#FF4D6D',
  'Educação':'#4D9BFF','Entretenimento':'#A472FF','Assinaturas':'#C77DFF','Compras':'#FF7AC8',
  'Cartões':'#00B8FF','Telecomunicações':'#5EEAD4','Pets':'#9EFF5E','Viagens':'#FFE066',
  'Dívidas':'#FF5C5C','Transferências':'#8E9BCC','Poupança':'#3DFFD6','Impostos':'#B0BAD9',
  'Outros':'#6E7BAE',
};
const MAX_MONTHS = 12;   // janela máxima do filtro
const MAX_YEARS  = 2;    // retenção de dados

// ── Estado ──────────────────────────────────────────────────
let TOKEN = null, ME = null;
let transactions = [];
let accounts = [];
let cards = [];
let investments = [];
let selectedAcc = null;
let selectedCard = null, cardInvKey = null;
let selectedInv = null;
let pendingTxs = [];
let editingId = null;
let modalType = 'expense';
let sortCol = 'date', sortDir = -1;
let saveTimer = null, saveDirty = false;
let serverStamp = '';          // updatedAt do servidor na última leitura/gravação (merge do Open Finance)
let selectedTxs = new Set();
let lastCheckedId = null;
const filters = { from:null, to:null, cat:'', status:'', acc:'' };

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ── Utilitários ─────────────────────────────────────────────
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
const fmtBRL = (v) => (v<0?'-':'') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
function fmtShort(v){
  const a = Math.abs(v);
  if (a >= 1e6) return (v/1e6).toFixed(1).replace('.',',')+'M';
  if (a >= 1e3) return (v/1e3).toFixed(0)+'k';
  return v.toFixed(0);
}
const monthKey = (d) => String(d).slice(0,7);
const todayISO = () => new Date().toISOString().slice(0,10);
const curMonth = () => todayISO().slice(0,7);
function monthLabel(key, full=false){
  const [y,m] = key.split('-');
  const i = parseInt(m,10)-1;
  return full ? `${MONTHS_FULL[i]} ${y}` : `${MONTHS[i]}/${y.slice(2)}`;
}
function addMonths(key, n){
  const [y,m] = key.split('-').map(Number);
  const d = new Date(y, m-1+n, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function monthsBetween(a, b){
  const [ay,am] = a.split('-').map(Number), [by,bm] = b.split('-').map(Number);
  return (by-ay)*12 + (bm-am);
}
function monthRange(from, to){
  const out=[]; let k=from;
  while (monthsBetween(k,to) >= 0 && out.length <= 26){ out.push(k); k = addMonths(k,1); }
  return out;
}
function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2200);
}
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

// ══ API ═════════════════════════════════════════════════════
async function api(path, opts = {}){
  const headers = { 'content-type':'application/json', ...(opts.headers||{}) };
  if (TOKEN) headers.authorization = 'Bearer ' + TOKEN;
  const res = await fetch(path, { ...opts, headers });
  let body = {};
  try { body = await res.json(); } catch {}
  if (res.status === 401 && TOKEN){ forceLogout('Sessão expirada. Entre novamente.'); throw new Error('sessao_expirada'); }
  if (!res.ok) throw new Error(body.error || `erro_${res.status}`);
  return body;
}

const ERRORS = {
  credenciais_invalidas:'Usuário ou senha incorretos.',
  usuario_desativado:'Este usuário está desativado.',
  sessao_expirada:'Sessão expirada. Entre novamente.',
  usuario_existe:'Já existe um usuário com esse nome.',
  usuario_invalido:'Usuário deve ter 3–32 caracteres (letras, números, . _ -).',
  senha_curta:'A senha precisa de ao menos 6 caracteres.',
  senha_atual_incorreta:'Senha atual incorreta.',
  sem_permissao:'Você não tem permissão para isso.',
  nao_pode_alterar_a_si_mesmo:'Você não pode alterar a própria conta por aqui.',
};
const msgFor = (e) => ERRORS[e?.message] || 'Não foi possível concluir. Tente novamente.';

// ══ AUTENTICAÇÃO ════════════════════════════════════════════
function saveSession(token, user){
  TOKEN = token; ME = user;
  try { localStorage.setItem('fn_token', token); localStorage.setItem('fn_user', JSON.stringify(user)); } catch {}
}
function clearSession(){
  TOKEN = null; ME = null; transactions = []; accounts = []; cards = []; investments = [];
  try { localStorage.removeItem('fn_token'); localStorage.removeItem('fn_user'); } catch {}
}
function forceLogout(msg){
  clearSession();
  $('#app').hidden = true;
  $('#login-screen').hidden = false;
  if (msg) showLoginError(msg);
}
function showLoginError(msg){
  const el = $('#lg-error'); el.textContent = msg; el.hidden = false;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#lg-btn'); btn.disabled = true; btn.textContent = 'Entrando…';
  $('#lg-error').hidden = true;
  try {
    const r = await api('/api/auth', { method:'POST', body: JSON.stringify({
      action:'login', username: $('#lg-user').value, password: $('#lg-pass').value })});
    saveSession(r.token, r.user);
    $('#lg-pass').value = '';
    await enterApp();
  } catch (err) {
    showLoginError(msgFor(err));
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

$('#btn-logout').addEventListener('click', () => {
  if (confirm('Sair do sistema?')) forceLogout();
});

async function enterApp(){
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = ME.name || ME.username;
  $('#who-role').textContent = ME.role === 'admin' ? 'admin' : '';
  $('#tab-users').hidden = ME.role !== 'admin';
  setDefaultPeriod(6);
  await loadData();
  applyShortcut();
  if (typeof ofAuto === 'function') ofAuto();
}

async function loadData(){
  setSync('loading');
  try {
    const r = await api('/api/data');
    serverStamp = r.updatedAt || '';
    transactions = (r.transactions || []).map(normalize);
    accounts = (Array.isArray(r.accounts) && r.accounts.length) ? r.accounts : DEFAULT_ACCOUNTS.map(a => ({...a}));
    cards = Array.isArray(r.cards) ? r.cards : [];
    investments = Array.isArray(r.investments) ? r.investments.map(v => ({ history:[], ...v })) : [];
    // parcelas de cartão cuja data já chegou passam a "realizada" automaticamente
    const today = todayISO(); let promoted = 0;
    transactions.forEach(t => { if (t.kind === 'card' && t.status === 'pending' && t.date <= today){ t.status = 'paid'; promoted++; } });
    if (typeof trainBayes === 'function') trainBayes(transactions);
    setSync('ok');
    const recat = typeof ofRecategorize === 'function' ? ofRecategorize() : 0;
    if (promoted && !recat) persist();
  } catch (e) {
    transactions = [];
    setSync('error');
  }
  populateFilters();
  renderAll();
}

function normalize(t){
  return {
    id: t.id || uid(),
    date: String(t.date).slice(0,10),
    desc: t.desc || '',
    cat: t.cat || 'Outros',
    type: t.type === 'income' ? 'income' : 'expense',
    amount: Math.abs(Number(t.amount) || 0),
    account: t.account || '',
    status: t.status === 'pending' ? 'pending' : 'paid',
    source: t.source || 'manual',
    kind: t.kind || '',
    transferId: t.transferId || '',
    ref: t.ref || '',
    hidden: !!t.hidden,
  };
}

function setSync(state){
  const el = $('#sync'), txt = $('#sync-txt');
  el.classList.remove('saving','error');
  if (state === 'saving'){ el.classList.add('saving'); txt.textContent = 'salvando…'; }
  else if (state === 'loading'){ el.classList.add('saving'); txt.textContent = 'carregando…'; }
  else if (state === 'error'){ el.classList.add('error'); txt.textContent = 'erro ao salvar'; }
  else txt.textContent = 'salvo';
}

function persist(){
  if (typeof trainBayes === 'function') trainBayes(transactions);
  clearTimeout(saveTimer);
  saveDirty = true;
  setSync('saving');
  saveTimer = setTimeout(flushPersist, 500);
}
async function flushPersist(){
  clearTimeout(saveTimer);
  if (!saveDirty) return;
  saveDirty = false;
  try {
    const r = await api('/api/data', { method:'PUT', body: JSON.stringify({ transactions, accounts, cards, investments, since: serverStamp }) });
    serverStamp = r.updatedAt || serverStamp;
    setSync('ok');
    // o Open Finance trouxe movimentações enquanto você editava: recarrega para mostrá-las
    if (r.merged && typeof ofReloadTransactions === 'function') ofReloadTransactions();
  } catch { saveDirty = true; setSync('error'); }
}

// ══ FILTROS ═════════════════════════════════════════════════
function setDefaultPeriod(months){
  const to = curMonth();
  const from = addMonths(to, -(months - 1));
  filters.to = to; filters.from = from;
  $('#f-from').value = from; $('#f-to').value = to;
  syncChips(months);
}
function syncChips(months){
  $$('#period-chips .chip').forEach(c => c.classList.toggle('active', Number(c.dataset.months) === months));
}

$$('#period-chips .chip').forEach(chip => chip.addEventListener('click', () => {
  setDefaultPeriod(Number(chip.dataset.months));
  renderAll();
}));

function onDateFilterChange(){
  let from = $('#f-from').value || filters.from;
  let to   = $('#f-to').value   || filters.to;
  if (monthsBetween(from, to) < 0){ [from, to] = [to, from]; }

  // Limite duro: janela máxima de 12 meses
  const span = monthsBetween(from, to) + 1;
  if (span > MAX_MONTHS){
    from = addMonths(to, -(MAX_MONTHS - 1));
    toast(`Período limitado a ${MAX_MONTHS} meses`);
  }
  // Limite duro: retenção de 2 anos
  const oldest = addMonths(curMonth(), -(MAX_YEARS * 12 - 1));
  if (monthsBetween(oldest, from) < 0){
    from = oldest;
    toast('O sistema mantém os últimos 2 anos');
  }
  filters.from = from; filters.to = to;
  $('#f-from').value = from; $('#f-to').value = to;
  syncChips(monthsBetween(from, to) + 1);
  renderAll();
}
$('#f-from').addEventListener('change', onDateFilterChange);
$('#f-to').addEventListener('change', onDateFilterChange);
$('#f-cat').addEventListener('change', () => { filters.cat = $('#f-cat').value; renderAll(); });
$('#f-acc').addEventListener('change', () => { filters.acc = $('#f-acc').value; renderAll(); });
$('#f-status').addEventListener('change', () => { filters.status = $('#f-status').value; renderAll(); });

function populateFilters(){
  const cats = [...new Set(transactions.map(t => t.cat))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const selCat = $('#f-cat'), curCat = selCat.value;
  selCat.innerHTML = '<option value="">Todas</option>' + cats.map(c=>`<option>${esc(c)}</option>`).join('');
  if (cats.includes(curCat)) selCat.value = curCat;
  
  populateAccountSelects();

  const min = addMonths(curMonth(), -(MAX_YEARS*12 - 1));
  $('#f-from').min = min; $('#f-to').min = min;
  $('#f-from').max = curMonth(); $('#f-to').max = addMonths(curMonth(), 12);
}

function inPeriod(t){
  const k = monthKey(t.date);
  return monthsBetween(filters.from, k) >= 0 && monthsBetween(k, filters.to) >= 0;
}
function getFiltered(){
  return transactions.filter(t =>
    !t.hidden && inPeriod(t) &&
    (!filters.cat || t.cat === filters.cat) &&
    (!filters.acc || t.account === filters.acc) &&
    (!filters.status || t.status === filters.status)
  );
}

const sumOf = (txs, type, status) => txs
  .filter(t => t.type === type && t.kind !== 'transfer' && (!status || t.status === status))
  .reduce((a,t) => a + t.amount, 0);

// ══ ABAS ════════════════════════════════════════════════════
$$('#tabs .tab').forEach(tab => tab.addEventListener('click', () => {
  const name = tab.dataset.tab;
  $$('#tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
  ['summary','monthly','accounts','cards','investments','transactions','import','users'].forEach(p => {
    $('#panel-'+p).hidden = (p !== name);
  });
  $('#filterbar').hidden = (name === 'transactions' || name === 'cards');
  if (name === 'summary') redrawCharts();
  if (name === 'transactions') renderTx();
  if (name === 'accounts') renderAccounts();
  if (name === 'cards') renderCards();
  if (name === 'investments') renderInvestments();
  if (name === 'users') loadUsers();
}));

// ══ RENDER ══════════════════════════════════════════════════
function renderAll(){
  renderSummary();
  renderMonthly();
  renderTx();
  renderAccounts();
  renderCards();
  renderInvestments();
  const span = monthsBetween(filters.from, filters.to) + 1;
  $('#filter-note').textContent =
    `${monthLabel(filters.from)} – ${monthLabel(filters.to)} · ${span} ${span===1?'mês':'meses'} · janela máx. ${MAX_MONTHS}m · histórico ${MAX_YEARS} anos`;
  const extras = [filters.cat, filters.status === 'paid' ? 'realizadas' : filters.status === 'pending' ? 'previstas' : ''].filter(Boolean);
  $('#filter-toggle-txt').textContent =
    `${monthLabel(filters.from)} – ${monthLabel(filters.to)}` + (extras.length ? ` · ${extras.join(' · ')}` : '');
}

// ── Resumo ──
function renderSummary(){
  const f = getFiltered();
  const cm = curMonth();
  const all = transactions;
  const today = todayISO();

  // Saldo líquido disponível: tudo que já foi realizado (inclui saldos iniciais das contas);
  // dinheiro aplicado em investimentos sai do "disponível"; compra no cartão já é gasto
  const netAvailable = accounts.reduce((a,x) => a + (Number(x.initial)||0), 0)
    + sumOf(all,'income','paid') - sumOf(all,'expense','paid') - investedNetTransfers();

  const monthTx = all.filter(t => monthKey(t.date) === cm && !t.hidden);
  const incDone = sumOf(monthTx,'income','paid'),  incFc = sumOf(monthTx,'income','pending');
  const expDone = sumOf(monthTx,'expense','paid'), expFc = sumOf(monthTx,'expense','pending');
  const proj = netAvailable + incFc - expFc;
  const lastDay = `${daysIn(+cm.slice(0,4), +cm.slice(5,7))}/${cm.slice(5,7)}`;

  $('#k-net').textContent = fmtBRL(netAvailable);
  $('#k-net').classList.toggle('neg', netAvailable < 0);
  $('#k-say').innerHTML = (incFc || expFc)
    ? `Até ${lastDay} ainda ${incFc ? `entram <b id="k-inc-fc">${fmtBRL(incFc)}</b>` : `<b id="k-inc-fc" hidden>${fmtBRL(0)}</b>não há receitas previstas`}${expFc ? ` e saem <b id="k-exp-fc">${fmtBRL(expFc)}</b>` : `<b id="k-exp-fc" hidden>${fmtBRL(0)}</b> e nenhuma despesa prevista`}. Você deve fechar ${monthLabel(cm,true)} com <b id="k-proj" class="${proj<0?'neg':''}">${fmtBRL(proj)}</b>.`
    : `Nada previsto até ${lastDay}<b id="k-inc-fc" hidden>${fmtBRL(0)}</b><b id="k-exp-fc" hidden>${fmtBRL(0)}</b> — ${monthLabel(cm,true)} deve fechar com <b id="k-proj" class="${proj<0?'neg':''}">${fmtBRL(proj)}</b>.`;

  const bar = (el, done, todo) => {
    const tot = done + todo, b = $(el);
    b.querySelector('.dash-bar-v').innerHTML = tot ? `<b>${fmtBRL(done)}</b> de ${fmtBRL(tot)}` : 'nada lançado';
    b.querySelector('.done').style.width = tot ? (done/tot*100)+'%' : '0';
    b.querySelector('.todo').style.width = tot ? (todo/tot*100)+'%' : '0';
  };
  bar('#bar-inc', incDone, incFc);
  bar('#bar-exp', expDone, expFc);

  // período (filtro)
  const inc = sumOf(f,'income'), exp = sumOf(f,'expense');
  const span = monthsBetween(filters.from, filters.to) + 1;
  $('#k-inc').textContent = fmtBRL(inc);
  $('#k-exp').textContent = fmtBRL(exp);
  $('#k-avg').textContent = fmtBRL(exp / span);
  $('#k-avg').title = `média mensal em ${span} ${span===1?'mês':'meses'}`;

  // patrimônio
  const accTotal = accounts.reduce((s,a) => s + accBalance(a), 0);
  const ccOpen = cards.reduce((s,c) => s + cardOutstanding(c), 0);
  const ivTot = investments.reduce((s,v) => s + (Number(v.current)||0), 0);
  const ivGain = ivTot - investments.reduce((s,v) => s + invPrincipal(v), 0);
  const nd = nextDue();
  $('#k-acc').textContent = fmtBRL(accTotal);
  $('#k-acc').classList.toggle('neg', accTotal < 0);
  $('#k-acc-sub').textContent = `${accounts.length} ${accounts.length===1?'conta':'contas'}`;
  $('#k-iv').textContent = fmtBRL(ivTot);
  $('#k-iv-sub').textContent = investments.length ? `${ivGain>=0?'+':''}${fmtBRL(ivGain)} de rendimento` : 'nenhum cadastrado';
  $('#k-cc').textContent = fmtBRL(ccOpen);
  $('#k-cc-sub').textContent = !cards.length ? 'nenhum cartão' : nd ? `vence ${fmtDM(nd.due)} · ${nd.card.name}` : 'nada a pagar';
  const worth = accTotal + ivTot - ccOpen;
  $('#k-worth').textContent = fmtBRL(worth);
  $('#k-worth').classList.toggle('neg', worth < 0);

  // alertas
  const alerts = [];
  const late = all.filter(t => t.status === 'pending' && t.kind !== 'card' && !t.hidden && t.date < today);
  if (late.length) alerts.push({ lv:'bad', t:`${late.length} ${late.length===1?'lançamento atrasado':'lançamentos atrasados'}`, d:`${fmtBRL(late.reduce((s,t)=>s+t.amount,0))} sem confirmação` });
  if (proj < 0) alerts.push({ lv:'bad', t:'Saldo projetado negativo', d:`faltam ${fmtBRL(-proj)} para fechar ${monthLabel(cm,true)}` });
  if (nd){
    const days = Math.round((new Date(nd.due+'T12:00') - new Date(today+'T12:00')) / 864e5);
    if (days <= 10) alerts.push({ lv: days < 0 ? 'bad' : 'warn', t:`Fatura ${nd.card.name} ${days < 0 ? 'vencida' : days === 0 ? 'vence hoje' : `vence em ${days} ${days===1?'dia':'dias'}`}`, d:`${fmtBRL(nd.amount)} · ${fmtDM(nd.due)}` });
  }
  const prev = [1,2,3].map(n => addMonths(cm,-n));
  const prevExp = prev.map(k => sumOf(all.filter(t => monthKey(t.date) === k && !t.hidden),'expense'));
  const withData = prevExp.filter(v => v > 0);
  if (withData.length){
    const avg = withData.reduce((a,b)=>a+b,0) / withData.length;
    const day = +today.slice(8,10), dim = daysIn(+cm.slice(0,4), +cm.slice(5,7));
    const pace = expDone / Math.max(1, day) * dim;           // ritmo projetado do mês
    const diff = avg ? (pace - avg) / avg : 0;
    if (day >= 5 && Math.abs(diff) >= 0.1)
      alerts.push({ lv: diff > 0 ? 'warn' : 'good', t: diff > 0 ? `Gastos ${Math.round(diff*100)}% acima do normal` : `Gastos ${Math.round(-diff*100)}% abaixo do normal`,
        d:`no ritmo atual, ${fmtBRL(pace)} no mês; média recente ${fmtBRL(avg)}` });
  }
  const catM = {};
  monthTx.filter(t => t.type === 'expense' && t.kind !== 'transfer').forEach(t => catM[t.cat] = (catM[t.cat]||0) + t.amount);
  const topCat = Object.entries(catM).sort((a,b)=>b[1]-a[1])[0];
  if (topCat && expDone + expFc > 0) alerts.push({ lv:'info', t:`${topCat[0]} lidera os gastos do mês`, d:`${fmtBRL(topCat[1])} · ${Math.round(topCat[1]/(expDone+expFc)*100)}% das despesas` });
  $('#dash-alerts').innerHTML = alerts.length
    ? alerts.slice(0,4).map(a => `<li class="${a.lv}"><b>${esc(a.t)}</b><span>${esc(a.d)}</span></li>`).join('')
    : `<li class="good"><b>Tudo em dia</b><span>Nenhum atraso, fatura próxima ou gasto fora do normal.</span></li>`;

  renderUpcoming();
  redrawCharts();
}

function renderUpcoming(){
  const tb = $('#upcoming-tbl').querySelector('tbody');
  const today = todayISO();
  const rows = transactions
    .filter(t => t.status === 'pending' && t.kind !== 'card' && !t.hidden)
    .map(t => ({ date:t.date, t }));
  // uma linha por cartão: vencimento mais antigo em aberto + total devido
  cards.forEach(card => {
    const open = Object.values(cardInvoices(card)).map(inv => ({ inv, st: invoiceStatus(card, inv) }))
      .filter(({ inv, st }) => st.code !== 'paid' && st.open > 0 && inv.key <= currentInvKey(card))
      .sort((a,b) => a.inv.key.localeCompare(b.inv.key));
    if (!open.length) return;
    const first = open[0];
    const amount = open.reduce((s, x) => s + x.st.open, 0);
    const label = open.length > 1 ? `${open.length} faturas em aberto` : first.st.label;
    rows.push({ date: invoiceDates(card, first.inv.key).due, inv:{ card, key: first.inv.key, amount, label } });
  });
  rows.sort((a,b) => a.date.localeCompare(b.date));
  const up = rows.slice(0, 8);
  if (!up.length){
    tb.innerHTML = `<tr><td><div class="empty" style="padding:22px">Nada previsto. Lance uma receita ou despesa como “Prevista” para acompanhá-la aqui.</div></td></tr>`;
    return;
  }
  tb.innerHTML = up.map(r => {
    const late = r.date < today;
    const when = `<td class="up-date ${late?'late':''}">${fmtDM(r.date)}${late?'<small>atrasado</small>':''}</td>`;
    if (r.inv) return `<tr>${when}
      <td><span class="up-desc">Fatura ${esc(r.inv.card.name)}</span><span class="up-cat">Cartões · ${esc(r.inv.label)}</span></td>
      <td class="num neg">− ${fmtBRL(r.inv.amount).replace('R$ ','')}</td>
      <td class="num"><button class="mini-btn" data-card="${esc(r.inv.card.id)}" data-key="${esc(r.inv.key)}">Ver fatura</button></td></tr>`;
    const t = r.t;
    return `<tr>${when}
      <td><span class="up-desc">${esc(t.desc)}</span><span class="up-cat">${esc(t.cat)}${t.account ? ' · ' + esc(t.account) : ''}</span></td>
      <td class="num ${t.type==='income'?'pos':'neg'}">${t.type==='income'?'+':'−'} ${fmtBRL(t.amount).replace('R$ ','')}</td>
      <td class="num"><button class="mini-btn go" data-pay="${t.id}">Confirmar</button></td></tr>`;
  }).join('');
  tb.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => {
    const t = transactions.find(x => x.id === b.dataset.pay);
    if (t){ t.status = 'paid'; persist(); renderAll(); toast('Lançamento confirmado'); }
  }));
  tb.querySelectorAll('[data-card]').forEach(b => b.addEventListener('click', () => {
    selectedCard = b.dataset.card; cardInvKey = b.dataset.key;
    $('#tabs .tab[data-tab="cards"]').click();
  }));
}

// ── Controle Mensal ──
function renderMonthly(){
  const keys = monthRange(filters.from, filters.to);
  const grid = $('#month-grid');
  const cm = curMonth();

  const data = keys.map(k => {
    const txs = transactions.filter(t => monthKey(t.date) === k &&
      (!filters.cat || t.cat === filters.cat));
    return {
      key: k,
      incPaid: sumOf(txs,'income','paid'), incPend: sumOf(txs,'income','pending'),
      expPaid: sumOf(txs,'expense','paid'), expPend: sumOf(txs,'expense','pending'),
      count: txs.length,
    };
  });
  const max = Math.max(1, ...data.map(d => Math.max(d.incPaid+d.incPend, d.expPaid+d.expPend)));

  grid.innerHTML = data.slice().reverse().map(d => {
    const inc = d.incPaid + d.incPend, exp = d.expPaid + d.expPend;
    const net = inc - exp;
    return `<div class="month-card ${d.key===cm?'current':''}">
      <div class="month-head">
        <div class="month-name">${monthLabel(d.key,true)}</div>
        <div class="month-net" style="color:${net>=0?cssVar('--income'):cssVar('--expense')}">${fmtBRL(net)}</div>
      </div>
      <div class="mrow">
        <span class="mlab">Receitas</span>
        <span class="mbar inc"><span style="width:${(inc/max*100).toFixed(1)}%"></span></span>
        <span class="mval pos">${fmtBRL(inc).replace('R$ ','')}</span>
      </div>
      <div class="mrow">
        <span class="mlab">Despesas</span>
        <span class="mbar exp"><span style="width:${(exp/max*100).toFixed(1)}%"></span></span>
        <span class="mval neg">${fmtBRL(exp).replace('R$ ','')}</span>
      </div>
      <div class="month-foot">
        <span>${d.count} ${d.count===1?'lançamento':'lançamentos'}</span>
        ${d.incPend ? `<span>a receber <b>${fmtBRL(d.incPend).replace('R$ ','')}</b></span>` : ''}
        ${d.expPend ? `<span>a pagar <b>${fmtBRL(d.expPend).replace('R$ ','')}</b></span>` : ''}
        ${(!d.incPend && !d.expPend) ? '<span>tudo realizado</span>' : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Transações ──
const CAT_ICONS = {
  'Salário':'💼','Freelance/Negócios':'🧑‍💻','Investimentos':'💰','Outros Rendimentos':'💵',
  'Alimentação':'🍽️','Moradia':'🏠','Transporte':'🚗','Saúde':'🩺','Educação':'📚','Entretenimento':'🎬',
  'Assinaturas':'📺','Compras':'🛍️','Cartões':'💳','Telecomunicações':'📱','Pets':'🐾','Viagens':'✈️',
  'Dívidas':'📉','Transferências':'🔁','Poupança':'🐷','Impostos':'🧾','Outros':'📦',
};
const catIcon = (c) => CAT_ICONS[c] || '🏷️';
const txView = { period:'this', from:'', to:'', acc:'', type:'', sort:'date', dir:-1, cat:'', showHidden:false, q:'', limit:150 };
let txList = [];

function txRange(){
  const cm = curMonth(), end = (k) => dateIn(k, 31), start = (k) => k + '-01';
  switch (txView.period){
    case 'this': return [start(cm), end(cm)];
    case 'last': { const k = addMonths(cm,-1); return [start(k), end(k)]; }
    case 'next': { const k = addMonths(cm, 1); return [start(k), end(k)]; }
    case '3': case '6': case '12': return [start(addMonths(cm, -(Number(txView.period)-1))), end(cm)];
    case 'year': return [cm.slice(0,4)+'-01-01', cm.slice(0,4)+'-12-31'];
    case 'custom': return [txView.from || '0000-01-01', txView.to || '9999-12-31'];
    default: return ['0000-01-01', '9999-12-31'];
  }
}
function entityOf(name){
  const n = normName(name); if (!n) return null;
  return [...accounts, ...cards, ...investments].find(x => normName(x.name) === n) || null;
}
function txTag(t){
  if (t.kind === 'transfer'){
    if (cardOf(t)) return { cls:'blue', ico:'💳', txt:'Pagamento de fatura' };
    if (invOf(t)) return { cls:'green', ico:'📈', txt: t.type === 'income' ? 'Aporte' : 'Resgate' };
    if (t.cat === 'Cartões' || /fatura/i.test(t.desc)) return { cls:'blue', ico:'💳', txt:'Pagamento de fatura' };
    return { cls:'blue', ico:'⇄', txt:'Entre contas' };
  }
  const m = t.kind === 'card' && /\((\d+)\/(\d+)\)\s*$/.exec(t.desc);
  if (m) return { cls:'violet', ico:'🗓️', txt:`Parcela ${m[1]}/${m[2]}` };
  if (t.status === 'pending') return { cls:'amber', ico:'⏳', txt:'Prevista' };
  return null;
}
const isInternal = (t) => t.kind === 'transfer' && !cardOf(t) && !invOf(t) && !(t.cat === 'Cartões' || /fatura/i.test(t.desc));

function getTxList(){
  const [from, to] = txRange();
  const q = normName(txView.q);
  const outIds = new Set(), seen = new Set();
  if (!txView.acc) transactions.forEach(t => { if (t.kind === 'transfer' && t.transferId && t.type === 'expense') outIds.add(t.transferId); });
  return transactions.filter(t => {
    if (!txView.acc && t.kind === 'transfer' && t.transferId){
      if (t.type === 'income' && outIds.has(t.transferId)) return false;   // a outra ponta já aparece
      if (seen.has(t.transferId + t.type)) return false;
      seen.add(t.transferId + t.type);
    }
    if (t.date < from || t.date > to) return false;
    if (t.hidden && !txView.showHidden) return false;
    if (txView.acc && !sameName(t.account, txView.acc)) return false;
    if (txView.cat && t.cat !== txView.cat) return false;
    switch (txView.type){
      case 'expense': if (t.type !== 'expense' || t.kind === 'transfer') return false; break;
      case 'income': if (t.type !== 'income' || t.kind === 'transfer') return false; break;
      case 'transfer': if (t.kind !== 'transfer') return false; break;
      case 'card': if (t.kind !== 'card') return false; break;
      case 'pending': case 'paid': if (t.status !== txView.type) return false; break;
    }
    if (q && !normName(`${t.desc} ${t.cat} ${t.account} ${fmtDMY(t.date)} ${t.amount.toFixed(2).replace('.',',')}`).includes(q)) return false;
    return true;
  }).sort((a,b) => {
    let r;
    if (txView.sort === 'amount') r = a.amount - b.amount;
    else r = String(a[txView.sort]).localeCompare(String(b[txView.sort]),'pt-BR');
    if (!r && txView.sort !== 'date') r = b.date.localeCompare(a.date) * txView.dir;
    return r * txView.dir;
  });
}

function populateTxFilters(){
  const opt = (n) => `<option value="${esc(n)}">${esc(n)}</option>`;
  const grp = (label, list) => list.length ? `<optgroup label="${label}">${list.map(opt).join('')}</optgroup>` : '';
  const known = [...accounts, ...cards, ...investments];
  const extra = [...new Set(transactions.map(t => t.account).filter(Boolean))].filter(n => !known.some(x => sameName(x.name, n)));
  const sa = $('#tx-acc');
  sa.innerHTML = '<option value="">Todas Contas</option>' + grp('Contas', accounts.map(a=>a.name)) + grp('Cartões', cards.map(c=>c.name))
    + grp('Investimentos', investments.map(v=>v.name)) + grp('Outras', extra);
  sa.value = txView.acc; if (sa.value !== txView.acc){ txView.acc = ''; sa.value = ''; }
  const cats = [...new Set([...ALL_CATS, ...transactions.map(t => t.cat)])].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const sc = $('#tx-cat');
  sc.innerHTML = '<option value="">Categorias</option>' + cats.map(c => `<option value="${esc(c)}">${catIcon(c)} ${esc(c)}</option>`).join('');
  sc.value = txView.cat; if (sc.value !== txView.cat){ txView.cat = ''; sc.value = ''; }
}

function renderTx(){
  if (!$('#tx-table')) return;
  populateTxFilters();
  const f = getTxList();
  txList = f;

  // KPIs — transferências e ocultas não entram nos totais
  const real = f.filter(t => !t.hidden && t.kind !== 'transfer');
  const inc = real.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const exp = real.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  const bal = r2(inc - exp);
  $('#tx-k-count').textContent = f.length.toLocaleString('pt-BR');
  $('#tx-k-exp').textContent = fmtBRL(exp);
  $('#tx-k-inc').textContent = fmtBRL(inc);
  $('#tx-k-bal').textContent = fmtBRL(bal);
  $('#tx-k-bal').className = 'tx2-kval ' + (bal < 0 ? 'neg' : bal > 0 ? 'pos' : '');
  $('#tx-k-bal-ico').className = 'tx2-kico ' + (bal < 0 ? 'neg' : bal > 0 ? 'pos' : '');
  $('#tx-count').textContent = `Transações — ${f.length} no período`;

  const ids = new Set(f.map(t => t.id));
  selectedTxs = new Set([...selectedTxs].filter(id => ids.has(id)));
  updateBulkBar();

  $$('#tx-table th.sortable').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === txView.sort);
    th.dataset.dir = th.dataset.sort === txView.sort ? (txView.dir > 0 ? '↑' : '↓') : '';
  });

  const tb = $('#tx-table tbody');
  if (!f.length){
    tb.innerHTML = `<tr><td colspan="7"><div class="empty"><span class="ei">📭</span>${txView.q ? 'Nenhuma transação encontrada para essa busca.' : 'Nenhuma transação neste filtro.'}</div></td></tr>`;
    $('#chk-all').checked = false; $('#tx-more').hidden = true;
    return;
  }
  $('#chk-all').checked = selectedTxs.size === f.length;
  const rows = f.slice(0, txView.limit);
  $('#tx-more').hidden = f.length <= txView.limit;
  $('#btn-tx-more').textContent = `Mostrar mais (${f.length - txView.limit} restantes)`;

  tb.innerHTML = rows.map(t => {
    const sel = selectedTxs.has(t.id);
    const col = CAT_COLORS[t.cat] || '#6E7BAE';
    const ent = entityOf(t.account);
    const ac = ent?.color || '#6E7BAE';
    const tag = txTag(t);
    const neg = t.type === 'expense';
    const dim = t.hidden || isInternal(t);
    return `<tr class="${sel ? 'selected' : ''} ${dim ? 'dim' : ''}" data-id="${t.id}">
    <td class="chk-col"><input type="checkbox" class="chk-row" data-id="${t.id}" ${sel?'checked':''} aria-label="Selecionar"></td>
    <td><div class="tx2-desc"><span class="tx2-av" style="--c:${col}">${catIcon(t.cat)}</span><span class="tx2-dtxt">${esc(t.desc)}</span>${t.source==='openfinance'?'<span class="tx2-of" title="Importada automaticamente via Open Finance">OF</span>':''}${t.hidden?'<span class="tx2-hid" title="Oculta">oculta</span>':''}</div></td>
    <td><div class="tx2-cats"><span class="tx2-cat"><i>${catIcon(t.cat)}</i>${esc(t.cat)}</span>${tag ? `<span class="tx2-tag ${tag.cls}"><i>${tag.ico}</i>${tag.txt}</span>` : ''}</div></td>
    <td class="tx2-acc">${t.account ? `<span class="tx2-acc-ico" style="--c:${esc(ac)}">${esc(t.account.trim().charAt(0).toUpperCase())}</span>${esc(t.account)}` : '<span class="muted">—</span>'}</td>
    <td class="tx2-date">${fmtDMY(t.date)}</td>
    <td class="num tx2-val ${neg ? '' : 'pos'}">${neg ? '' : '+'}${fmtBRL(t.amount)}</td>
    <td class="act-col"><button class="tx2-dots" data-menu="${t.id}" aria-label="Ações">⋮</button></td>
  </tr>`;
  }).join('');

  const checkboxes = [...tb.querySelectorAll('.chk-row')];
  checkboxes.forEach((chk, idx) => chk.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = chk.dataset.id;
    const start = checkboxes.findIndex(c => c.dataset.id === lastCheckedId);
    const range = e.shiftKey && start !== -1 ? [Math.min(start, idx), Math.max(start, idx)] : [idx, idx];
    for (let i = range[0]; i <= range[1]; i++){
      const c = checkboxes[i]; c.checked = chk.checked;
      chk.checked ? selectedTxs.add(c.dataset.id) : selectedTxs.delete(c.dataset.id);
      c.closest('tr').classList.toggle('selected', chk.checked);
    }
    lastCheckedId = id;
    updateBulkBar();
    $('#chk-all').checked = selectedTxs.size === f.length;
  }));
  tb.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', e => {
    if (e.target.closest('input,button')) return;
    openModal(tr.dataset.id);
  }));
  tb.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openTxMenu(b); }));
}

// menu ⋮ da linha
function openTxMenu(btn){
  const menu = $('#tx-menu'), id = btn.dataset.menu;
  if (!menu.hidden && menu.dataset.for === id){ closeTxMenu(); return; }
  const t = transactions.find(x => x.id === id); if (!t) return;
  menu.dataset.for = id;
  menu.innerHTML = `
    <button data-act="edit">✎ Editar</button>
    ${t.kind === 'transfer' ? '' : '<button data-act="dup">⧉ Duplicar</button>'}
    <button data-act="hide">${t.hidden ? '👁 Mostrar novamente' : '🙈 Ocultar'}</button>
    ${t.status === 'pending' ? '<button data-act="paid">✓ Marcar como realizada</button>' : ''}
    <button data-act="del" class="danger">🗑 Excluir</button>`;
  menu.hidden = false;
  const r = btn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
  let top = r.bottom + 4; if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
  menu.style.top = Math.max(8, top) + 'px';
  menu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
  menu.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const act = b.dataset.act; closeTxMenu();
    if (act === 'edit') openModal(id);
    else if (act === 'del') deleteTx(id);
    else if (act === 'hide'){
      const group = t.kind === 'transfer' && t.transferId ? transactions.filter(x => x.transferId === t.transferId) : [t];
      const v = !t.hidden; group.forEach(x => x.hidden = v);
      persist(); renderAll(); toast(v ? 'Transação ocultada — ative “Mostrar ocultos” para vê-la' : 'Transação visível novamente');
    } else if (act === 'paid'){
      t.status = 'paid'; persist(); renderAll(); toast('Marcada como realizada');
    } else if (act === 'dup'){
      transactions.push({ ...t, id: uid(), transferId:'', hidden:false, source:'manual' });
      persist(); populateFilters(); renderAll(); toast('Transação duplicada');
    }
  }));
}
function closeTxMenu(){ const m = $('#tx-menu'); m.hidden = true; m.dataset.for = ''; }
document.addEventListener('click', e => { if (!e.target.closest('#tx-menu,[data-menu]')) closeTxMenu(); });
window.addEventListener('scroll', closeTxMenu, true);
window.addEventListener('resize', closeTxMenu);

// controles da aba
$('#tx-period').addEventListener('change', e => {
  txView.period = e.target.value; txView.limit = 150;
  $('#tx-custom').hidden = txView.period !== 'custom';
  if (txView.period === 'custom' && !txView.from){
    const cm = curMonth(); txView.from = cm + '-01'; txView.to = dateIn(cm, 31);
    $('#tx-from').value = txView.from; $('#tx-to').value = txView.to;
  }
  renderTx();
});
['#tx-from','#tx-to'].forEach(sel => $(sel).addEventListener('change', () => {
  txView.from = $('#tx-from').value; txView.to = $('#tx-to').value;
  if (txView.from && txView.to && txView.from > txView.to){ [txView.from, txView.to] = [txView.to, txView.from]; $('#tx-from').value = txView.from; $('#tx-to').value = txView.to; }
  renderTx();
}));
$('#tx-acc').addEventListener('change', e => { txView.acc = e.target.value; txView.limit = 150; renderTx(); });
$('#tx-type').addEventListener('change', e => { txView.type = e.target.value; txView.limit = 150; renderTx(); });
$('#tx-cat').addEventListener('change', e => { txView.cat = e.target.value; txView.limit = 150; renderTx(); });
$('#tx-sort').addEventListener('change', e => { const [c, d] = e.target.value.split(':'); txView.sort = c; txView.dir = Number(d); renderTx(); });
$('#tx-show-hidden').addEventListener('change', e => { txView.showHidden = e.target.checked; renderTx(); });
let txSearchT = null;
$('#tx-search').addEventListener('input', e => { clearTimeout(txSearchT); txSearchT = setTimeout(() => { txView.q = e.target.value; txView.limit = 150; renderTx(); }, 120); });
$('#btn-tx-new').addEventListener('click', () => openModal(null));
$('#btn-tx-more').addEventListener('click', () => { txView.limit += 150; renderTx(); });

$$('#tx-table th.sortable').forEach(th => th.addEventListener('click', () => {
  const col = th.dataset.sort;
  if (txView.sort === col) txView.dir *= -1; else { txView.sort = col; txView.dir = (col === 'date' || col === 'amount') ? -1 : 1; }
  const v = `${txView.sort}:${txView.dir}`;
  const sel = $('#tx-sort');
  if (![...sel.options].some(o => o.value === v)) sel.insertAdjacentHTML('beforeend', `<option value="${v}">${th.textContent.trim()} (${txView.dir > 0 ? 'crescente' : 'decrescente'})</option>`);
  sel.value = v;
  renderTx();
}));

// ── BULK ACTIONS ──
$('#chk-all').addEventListener('click', (e) => {
  selectedTxs.clear();
  if (e.target.checked) txList.forEach(t => selectedTxs.add(t.id));
  renderTx();
});

function updateBulkBar() {
  const bar = $('#bulk-bar');
  const count = selectedTxs.size;
  if (count > 0) {
    bar.hidden = false;
    $('#bulk-count').textContent = `${count} selecionada${count>1?'s':''}`;
    if ($('#bulk-cat').options.length < 3) {
      $('#bulk-cat').innerHTML = '<option value="">Categorizar como...</option>' + ALL_CATS.map(c=>`<option>${esc(c)}</option>`).join('');
    }
    const allHidden = transactions.filter(t => selectedTxs.has(t.id)).every(t => t.hidden);
    $('#btn-bulk-hide').textContent = allHidden ? 'Mostrar' : 'Ocultar';
  } else {
    bar.hidden = true;
    $('#bulk-cat').value = '';
  }
}

$('#btn-bulk-hide').addEventListener('click', () => {
  const sel = transactions.filter(t => selectedTxs.has(t.id));
  const v = !sel.every(t => t.hidden);
  const groups = new Set(sel.filter(t => t.kind === 'transfer' && t.transferId).map(t => t.transferId));
  transactions.forEach(t => { if (selectedTxs.has(t.id) || (t.kind === 'transfer' && groups.has(t.transferId))) t.hidden = v; });
  selectedTxs.clear();
  persist(); renderAll(); toast(v ? 'Transações ocultadas' : 'Transações visíveis novamente');
});

$('#btn-bulk-del').addEventListener('click', () => {
  if (!confirm(`Excluir ${selectedTxs.size} transações?`)) return;
  const groups = new Set(transactions.filter(t => selectedTxs.has(t.id) && t.transferId).map(t => t.transferId));
  transactions = transactions.filter(t => !selectedTxs.has(t.id) && !(t.kind === 'transfer' && groups.has(t.transferId)));
  selectedTxs.clear();
  persist(); populateFilters(); renderAll(); toast('Transações excluídas');
});

$('#bulk-cat').addEventListener('change', (e) => {
  const cat = e.target.value;
  if (!cat) return;
  transactions.forEach(t => {
    if (selectedTxs.has(t.id) && t.kind !== 'transfer') {
      t.cat = cat;
      if (INCOME_CATS.includes(cat)) t.type = 'income';
      else if (EXPENSE_CATS.includes(cat)) t.type = 'expense';
    }
  });
  selectedTxs.clear();
  e.target.value = '';
  persist(); populateFilters(); renderAll(); toast('Categorias atualizadas');
});

function deleteTx(id){
  const t = transactions.find(x => x.id === id);
  const group = t?.transferId ? transactions.filter(x => x.transferId === t.transferId) : [];
  const msg = t?.kind === 'transfer' ? 'Excluir esta transferência (as duas pontas)?'
    : t?.kind === 'card' && group.length > 1 ? `Excluir esta compra parcelada (todas as ${group.length} parcelas)?`
    : 'Excluir esta transação?';
  if (!confirm(msg)) return;
  transactions = transactions.filter(x => x.id !== id && !(t?.transferId && x.transferId === t.transferId));
  persist(); populateFilters(); renderAll(); toast('Transação excluída');
}

// ══ CHARTS ══════════════════════════════════════════════════
function rr(ctx,x,y,w,h,r){
  r = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}
function prep(canvas){
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth;
  const h = canvas.getAttribute('height') * 1;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w+'px'; canvas.style.height = h+'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  return { ctx, w, h };
}

function drawMonthly(){
  const canvas = $('#c-monthly'); if (!canvas || !canvas.parentElement.clientWidth) return;
  const { ctx, w, h } = prep(canvas);
  const keys = monthRange(filters.from, filters.to);
  const cm = curMonth();
  const data = keys.map(k => {
    const txs = transactions.filter(t => monthKey(t.date) === k && !t.hidden && (!filters.cat || t.cat === filters.cat));
    return { k, inc: sumOf(txs,'income'), exp: sumOf(txs,'expense') };
  });
  const padL = 50, padR = 8, padT = 12, padB = 30;
  const cw = w - padL - padR, ch = h - padT - padB;
  const max = Math.max(1, ...data.map(d => Math.max(d.inc, d.exp)));
  const grid = 'rgba(142,155,204,.12)', txt3 = cssVar('--text-3');

  ctx.font = '11px "Plus Jakarta Sans", sans-serif';
  for (let i=0;i<=3;i++){
    const y = Math.round(padT + ch - (ch*i/3)) + .5;
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y); ctx.stroke();
    ctx.fillStyle = txt3; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(fmtShort(max*i/3), padL-10, y);
  }
  const slot = cw / Math.max(1,data.length);
  const bw = Math.max(5, Math.min(18, slot*0.28));
  data.forEach((d,i) => {
    const cx = padL + slot*i + slot/2;
    const fut = d.k > cm;
    ctx.globalAlpha = fut ? .35 : 1;
    const hi = (d.inc/max)*ch, he = (d.exp/max)*ch;
    ctx.fillStyle = cssVar('--income');
    if (hi > 0){ rr(ctx, cx-bw-1.5, padT+ch-hi, bw, hi, 3); ctx.fill(); }
    ctx.fillStyle = cssVar('--expense');
    if (he > 0){ rr(ctx, cx+1.5, padT+ch-he, bw, he, 3); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = d.k === cm ? cssVar('--text-1') : txt3;
    ctx.font = (d.k === cm ? '600 ' : '') + '11px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (data.length <= 13 || i % 2 === 0) ctx.fillText(monthLabel(d.k), cx, padT+ch+10);
  });
}

function renderCats(){
  const el = $('#cat-bars'); if (!el) return;
  const f = getFiltered().filter(t => t.type === 'expense' && t.kind !== 'transfer');
  const by = {};
  f.forEach(t => { by[t.cat] = (by[t.cat]||0) + t.amount; });
  const items = Object.entries(by).sort((a,b)=>b[1]-a[1]);
  const total = items.reduce((a,[,v])=>a+v,0);
  $('#cat-period').textContent = `${monthLabel(filters.from)} – ${monthLabel(filters.to)}`;
  if (!total){ el.innerHTML = `<li class="dash-empty">Sem despesas no período.</li>`; return; }
  const top = items.slice(0,6);
  const rest = items.slice(6).reduce((a,[,v])=>a+v,0);
  if (rest > 0) top.push(['Outras', rest]);
  const max = top[0][1];
  el.innerHTML = top.map(([name,val]) => `
    <li><button class="dash-cat" data-cat="${esc(name)}" ${name==='Outras'?'disabled':''} title="Ver ${esc(name)} nas transações">
      <span class="dc-n">${catIcon(name)} ${esc(name)}</span>
      <span class="dc-v">${fmtBRL(val)} <small>${(val/total*100).toFixed(0)}%</small></span>
      <span class="dc-t"><i style="width:${(val/max*100).toFixed(1)}%;background:${CAT_COLORS[name]||'#6E7BAE'}"></i></span>
    </button></li>`).join('');
}
$('#cat-bars')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]'); if (!b || b.disabled) return;
  txView.cat = b.dataset.cat;
  txView.period = 'custom'; txView.from = filters.from + '-01'; txView.to = dateIn(filters.to, 31);
  $('#tx-period').value = 'custom'; $('#tx-custom').hidden = false; $('#tx-from').value = txView.from; $('#tx-to').value = txView.to;
  $('#tabs .tab[data-tab="transactions"]').click();
});

let redrawT = null;
function redrawCharts(){
  clearTimeout(redrawT);
  redrawT = setTimeout(() => { drawMonthly(); renderCats(); }, 60);
}
window.addEventListener('resize', redrawCharts);

// ══ MODAL ═══════════════════════════════════════════════════
function populateCatSelect(){
  const list = modalType === 'income' ? INCOME_CATS : EXPENSE_CATS;
  const sel = $('#m-cat'), cur = sel.value;
  sel.innerHTML = list.map(c=>`<option>${esc(c)}</option>`).join('');
  if (list.includes(cur)) sel.value = cur;
}
function setModalType(t){
  modalType = t;
  $$('#type-seg button').forEach(b => b.classList.toggle('active', b.dataset.t === t));
  populateCatSelect();
}
$$('#type-seg button').forEach(b => b.addEventListener('click', () => setModalType(b.dataset.t)));

$('#m-desc').addEventListener('blur', () => {
  if (editingId) return;
  const d = $('#m-desc').value.trim();
  if (d) { const c = categorize(d, modalType); if (c) $('#m-cat').value = c; }
});

function openModal(id){
  editingId = id || null;
  $('#modal-title').textContent = id ? 'Editar transação' : 'Nova transação';
  $('#btn-del').hidden = !id;
  if (id){
    const t = transactions.find(x => x.id === id);
    setModalType(t.type);
    $('#m-date').value = t.date; $('#m-amount').value = t.amount;
    $('#m-desc').value = t.desc; $('#m-cat').value = t.cat;
    ensureAccountOption(t.account);
    $('#m-account').value = t.account; $('#m-status').value = t.status;
  } else {
    setModalType('expense');
    $('#m-date').value = todayISO(); $('#m-amount').value = '';
    $('#m-desc').value = ''; $('#m-account').value = ''; $('#m-status').value = 'paid';
  }
  $('#modal-overlay').hidden = false;
  setTimeout(() => $('#m-amount').focus(), 40);
}
const closeModal = () => { $('#modal-overlay').hidden = true; editingId = null; };
$('#btn-add').addEventListener('click', () => openModal(null));
$('#btn-close').addEventListener('click', closeModal);
$('#modal-overlay').addEventListener('mousedown', e => { if (e.target.id === 'modal-overlay') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#modal-overlay').hidden) closeModal();
  ['#acc-overlay','#cc-overlay','#iv-overlay'].forEach(o => { const el = $(o); if (el && !el.hidden) el.hidden = true; });
});

$('#btn-del').addEventListener('click', () => {
  if (!editingId) return;
  if (!confirm('Excluir esta transação?')) return;
  const t0 = transactions.find(t => t.id === editingId);
  transactions = transactions.filter(t => t.id !== editingId && !(t0?.kind === 'transfer' && t.transferId === t0.transferId));
  closeModal(); persist(); populateFilters(); renderAll(); toast('Transação excluída');
});

$('#tx-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const tx = {
    id: editingId || uid(),
    date: $('#m-date').value,
    desc: $('#m-desc').value.trim(),
    cat: $('#m-cat').value,
    type: modalType,
    amount: Math.abs(parseFloat($('#m-amount').value) || 0),
    account: $('#m-account').value.trim(),
    status: $('#m-status').value,
    source: 'manual',
  };
  const orig = editingId && transactions.find(t => t.id === editingId);
  if (orig){ tx.kind = orig.kind; tx.transferId = orig.transferId; tx.ref = orig.ref; tx.source = orig.source; tx.hidden = !!orig.hidden; }
  if (!tx.date || !tx.desc || tx.amount <= 0) return;
  if (editingId) transactions = transactions.map(t => t.id === editingId ? tx : t);
  else transactions.push(tx);
  closeModal(); persist(); populateFilters(); renderAll();
  toast(editingId ? 'Transação atualizada' : 'Transação adicionada');
});

// ══ IMPORTAÇÃO ══════════════════════════════════════════════
function showStatus(msg, type='info'){
  const el = $('#import-status');
  el.textContent = msg; el.className = `status show ${type}`;
}
$('#drop').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value=''; });
['dragenter','dragover'].forEach(ev => $('#drop').addEventListener(ev, e => { e.preventDefault(); $('#drop').classList.add('over'); }));
['dragleave','drop'].forEach(ev => $('#drop').addEventListener(ev, e => { e.preventDefault(); $('#drop').classList.remove('over'); }));
$('#drop').addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

async function handleFile(file){
  const name = file.name.toLowerCase();
  showStatus(`Lendo ${file.name}…`, 'info');
  $('#preview-card').hidden = true;
  try {
    let txs = [];
    if (name.endsWith('.xlsx') || name.endsWith('.xls')){
      const buf = await file.arrayBuffer();
      const { headers, rows } = await parseXLSX(buf);
      txs = rowsToTransactions(rows, headers);
    } else if (name.endsWith('.ofx')){
      txs = parseOFX(await file.text());
    } else if (name.endsWith('.pdf')){
      const text = await extractPDFText(await file.arrayBuffer());
      txs = parsePlainText(text);
    } else {
      const text = await file.text();
      if (/<STMTTRN>/i.test(text)) txs = parseOFX(text);
      else {
        const { headers, rows } = parseCSVText(text);
        txs = rowsToTransactions(rows, headers);
      }
    }
    txs = txs.map(t => ({ ...normalize(t), source: name.split('.').pop() }));
    if (!txs.length){
      showStatus('Nenhuma transação reconhecida neste arquivo. Verifique se ele contém colunas de data, descrição e valor — ou lance manualmente.', 'err');
      return;
    }
    pendingTxs = txs;
    showPreview(txs, file.name);
  } catch (err) {
    console.error(err);
    showStatus(`Erro ao ler o arquivo: ${err.message}`, 'err');
  }
}

// fallback: linhas soltas de texto (PDF)
function parsePlainText(text){
  const out = [];
  const lines = text.split(/[\r\n]+/);
  const re = /(\d{2}[\/.-]\d{2}(?:[\/.-]\d{2,4})?)\s+(.{3,120}?)\s+(-?R?\$?\s?[\d.]{1,12},\d{2})\s*$/;
  lines.forEach(line => {
    const m = line.trim().match(re);
    if (!m) return;
    const date = parseBRDate(m[1]);
    if (!date) return;
    const desc = m[2].trim();
    let amount = parseBRNumber(m[3]);
    const type = amount >= 0 ? 'income' : 'expense';
    amount = Math.abs(amount);
    if (!amount) return;
    out.push({ id: uid(), date, desc, cat: categorize(desc, type), type, amount, account:'', status:'paid' });
  });
  return out;
}

function showPreview(txs, fname){
  const inc = txs.filter(t=>t.type==='income').length;
  const exp = txs.length - inc;
  showStatus(`${txs.length} transações reconhecidas em ${fname} — ${inc} receitas, ${exp} despesas.`, 'ok');
  $('#preview-title').textContent = `Prévia — ${txs.length} transações (mostrando até 50)`;
  const tb = $('#preview-table').querySelector('tbody');
  tb.innerHTML = txs.slice(0,50).map(t => `<tr>
    <td style="white-space:nowrap">${t.date.split('-').reverse().join('/')}</td>
    <td>${esc(t.desc)}</td>
    <td><span class="pill">${esc(t.cat)}</span></td>
    <td class="num ${t.type==='income'?'pos':'neg'}">${t.type==='income'?'+':'−'} ${fmtBRL(t.amount).replace('R$ ','')}</td>
  </tr>`).join('');
  $('#preview-card').hidden = false;
}

$('#btn-cancel-import').addEventListener('click', () => {
  pendingTxs = []; $('#preview-card').hidden = true;
  showStatus('Importação cancelada.', 'info');
});

$('#btn-confirm-import').addEventListener('click', () => {
  const existing = new Set(transactions.map(t => `${t.date}|${t.desc}|${t.amount}`));
  const cutoff = addMonths(curMonth(), -(MAX_YEARS*12 - 1)) + '-01';
  let old = 0;
  const fresh = pendingTxs.filter(t => {
    if (t.date < cutoff){ old++; return false; }
    return !existing.has(`${t.date}|${t.desc}|${t.amount}`);
  });
  const dupes = pendingTxs.length - fresh.length - old;
  const acc = $('#import-account').value;
  if (acc) fresh.forEach(t => t.account = acc);
  
  transactions.push(...fresh);
  pendingTxs = []; $('#preview-card').hidden = true;
  persist(); populateFilters(); renderAll();
  let msg = `${fresh.length} transações importadas.`;
  if (dupes) msg += ` ${dupes} duplicadas ignoradas.`;
  if (old) msg += ` ${old} fora da janela de ${MAX_YEARS} anos descartadas.`;
  showStatus(msg, 'ok');
  toast(`${fresh.length} transações importadas`);
});

// ══ EXPORT ══════════════════════════════════════════════════
$('#btn-export').addEventListener('click', () => {
  const f = getFiltered();
  if (!f.length){ toast('Nada para exportar neste filtro'); return; }
  const head = 'Data,Descrição,Categoria,Tipo,Situação,Valor,Conta';
  const rows = f.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(t => [
    t.date, `"${t.desc.replace(/"/g,'""')}"`, t.cat,
    t.type === 'income' ? 'Receita' : 'Despesa',
    t.status === 'pending' ? 'Prevista' : 'Realizada',
    (t.type === 'income' ? t.amount : -t.amount).toFixed(2).replace('.',','),
    `"${(t.account||'').replace(/"/g,'""')}"`,
  ].join(','));
  const blob = new Blob(['﻿' + head + '\n' + rows.join('\n')], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `finnexus_${filters.from}_${filters.to}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast('CSV exportado');
});

// ══ USUÁRIOS (admin) ════════════════════════════════════════
async function loadUsers(){
  if (!ME || ME.role !== 'admin') return;
  const tb = $('#users-table').querySelector('tbody');
  try {
    const { users } = await api('/api/auth', { method:'POST', body: JSON.stringify({ action:'list_users' }) });
    tb.innerHTML = `<tr><th>Usuário</th><th>Nome</th><th>Perfil</th><th>Último acesso</th><th></th></tr>` +
      users.map(u => `<tr>
        <td><b>${esc(u.username)}</b></td>
        <td>${esc(u.name||'—')}</td>
        <td><span class="pill ${u.role==='admin'?'income':''}">${u.role==='admin'?'Administrador':'Usuário'}</span></td>
        <td style="color:var(--text-3)">${u.lastLogin ? new Date(u.lastLogin).toLocaleString('pt-BR') : 'nunca'}</td>
        <td><div class="row-actions">
          ${u.username === ME.username ? '<span class="pill">você</span>' : `
            <button class="mini-btn" data-toggle="${esc(u.username)}" data-active="${u.active}">${u.active?'Desativar':'Ativar'}</button>
            <button class="mini-btn danger" data-rm="${esc(u.username)}">Excluir</button>`}
        </div></td>
      </tr>`).join('');
    tb.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
      await api('/api/auth', { method:'POST', body: JSON.stringify({
        action:'set_active', username:b.dataset.toggle, active: b.dataset.active !== 'true' })});
      loadUsers(); toast('Usuário atualizado');
    }));
    tb.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Excluir o usuário ${b.dataset.rm}? Os dados financeiros dele permanecem armazenados.`)) return;
      await api('/api/auth', { method:'POST', body: JSON.stringify({ action:'delete_user', username:b.dataset.rm })});
      loadUsers(); toast('Usuário excluído');
    }));
  } catch (e) { tb.innerHTML = `<tr><td>${msgFor(e)}</td></tr>`; }
}

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth', { method:'POST', body: JSON.stringify({
      action:'create_user',
      username: $('#u-user').value, name: $('#u-name').value,
      password: $('#u-pass').value, role: $('#u-role').value })});
    e.target.reset(); loadUsers(); toast('Usuário criado');
  } catch (err) { alert(msgFor(err)); }
});

$('#pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth', { method:'POST', body: JSON.stringify({
      action:'change_password', current: $('#pw-cur').value, next: $('#pw-new').value })});
    e.target.reset(); toast('Senha alterada com sucesso');
  } catch (err) { alert(msgFor(err)); }
});

// ══ CONTAS / CARTÕES / INVESTIMENTOS — utilidades comuns ════
const normName = (s) => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const sameName = (a, b) => normName(a) === normName(b);
function accOf(t){ const n = normName(t.account); return n ? accounts.find(a => normName(a.name) === n) || null : null; }
function cardOf(t){ const n = normName(t.account); return n ? cards.find(c => normName(c.name) === n) || null : null; }
function invOf(t){ const n = normName(t.account); return n ? investments.find(v => normName(v.name) === n) || null : null; }
function nameTaken(name, exceptId){
  return [...accounts, ...cards, ...investments].some(x => x.id !== exceptId && sameName(x.name, name));
}
const fmtDM = (iso) => `${iso.slice(8,10)}/${iso.slice(5,7)}`;
const fmtDMY = (iso) => iso.split('-').reverse().join('/');
const r2 = (v) => Math.round(v * 100) / 100;
function daysIn(y, m){ return new Date(y, m, 0).getDate(); }            // m = 1..12
function dateIn(key, day){                                              // key 'YYYY-MM'
  const [y,m] = key.split('-').map(Number);
  return `${key}-${String(Math.min(day, daysIn(y,m))).padStart(2,'0')}`;
}
function addMonthsISO(iso, n){
  const key = addMonths(iso.slice(0,7), n);
  return dateIn(key, Number(iso.slice(8,10)));
}

// selects de conta (filtro, lançamento, importação)
function populateAccountSelects(){
  const extra = [...new Set(transactions.map(t => t.account).filter(Boolean))]
    .filter(n => ![...accounts, ...cards, ...investments].some(x => sameName(x.name, n)));
  const opt = (n) => `<option value="${esc(n)}">${esc(n)}</option>`;
  const grp = (label, list) => list.length ? `<optgroup label="${label}">${list.map(opt).join('')}</optgroup>` : '';
  const names = (l) => l.map(x => x.name);

  const fAcc = $('#f-acc'), fv = fAcc.value;
  fAcc.innerHTML = '<option value="">Todas</option>' + grp('Contas', names(accounts)) + grp('Cartões', names(cards))
    + grp('Investimentos', names(investments)) + grp('Outras', extra);
  fAcc.value = fv; if (fAcc.value !== fv){ fAcc.value = ''; filters.acc = ''; }

  const base = '<option value="">(Nenhuma)</option>' + grp('Contas', names(accounts)) + grp('Cartões', names(cards));
  const mAcc = $('#m-account'), mv = mAcc.value;
  mAcc.innerHTML = base; mAcc.value = mv;
  const iAcc = $('#import-account'), iv = iAcc.value;
  iAcc.innerHTML = base; iAcc.value = iv;
}
function ensureAccountOption(name){
  if (!name) return;
  const sel = $('#m-account');
  if (![...sel.options].some(o => o.value === name)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(name)}">${esc(name)}</option>`);
}

// ══ CONTAS ══════════════════════════════════════════════════
function accBalance(a){
  return (Number(a.initial)||0) + transactions
    .filter(t => t.status === 'paid' && sameName(t.account, a.name))
    .reduce((s,t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
}
function accPending(a){
  return transactions.filter(t => t.status === 'pending' && sameName(t.account, a.name))
    .reduce((s,t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
}

function renderAccounts(){
  const grid = $('#acc-grid'); if (!grid) return;
  const total = accounts.reduce((s,a) => s + accBalance(a), 0);
  const unassigned = transactions.filter(t => t.status === 'paid' && !accOf(t) && !cardOf(t) && !invOf(t)).length;
  $('#acc-total').textContent = fmtBRL(total);
  $('#acc-total').style.color = total >= 0 ? cssVar('--neon-cyan') : cssVar('--neon-red');
  $('#acc-total-sub').textContent = `${accounts.length} contas` +
    (unassigned ? ` · ${unassigned} lançamentos realizados sem conta vinculada` : ' · todos os lançamentos vinculados');

  grid.innerHTML = accounts.map(a => {
    const bal = accBalance(a), pend = accPending(a);
    const n = transactions.filter(t => sameName(t.account, a.name)).length;
    return `<div class="acc-card ${selectedAcc===a.id?'sel':''}" style="--ac:${esc(a.color)}" data-acc="${a.id}">
      <div class="acc-head">
        <span class="acc-dot"></span><span class="acc-name">${esc(a.name)}</span>
        <button class="mini-btn" data-acc-edit="${a.id}" title="Editar conta">✎</button>
      </div>
      <div class="acc-bal ${bal<0?'neg':''}">${fmtBRL(bal)}</div>
      <div class="acc-meta">${n} ${n===1?'movimento':'movimentos'}${pend?` · previsto ${pend>0?'+':''}${fmtBRL(pend).replace('R$ ','')}`:''}</div>
      <div class="acc-actions">
        <button class="mini-btn go" data-acc-op="in" data-id="${a.id}">+ Inserir</button>
        <button class="mini-btn danger" data-acc-op="out" data-id="${a.id}">− Retirar</button>
        <button class="mini-btn" data-acc-op="transfer" data-id="${a.id}" title="Transferir">⇄</button>
      </div>
    </div>`;
  }).join('') || `<div class="card empty"><span class="ei">🏦</span>Nenhuma conta cadastrada.</div>`;

  grid.querySelectorAll('[data-acc]').forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    selectedAcc = selectedAcc === c.dataset.acc ? null : c.dataset.acc;
    renderAccounts();
  }));
  grid.querySelectorAll('[data-acc-op]').forEach(b => b.addEventListener('click', () => openAccModal(b.dataset.accOp, b.dataset.id)));
  grid.querySelectorAll('[data-acc-edit]').forEach(b => b.addEventListener('click', () => openAccModal('edit', b.dataset.accEdit)));
  renderAccHistory();
}

function kindLabel(t){
  if (t.kind === 'transfer') return cardOf(t) ? 'pag. fatura' : invOf(t) ? (t.type === 'income' ? 'aporte' : 'resgate') : 'transferência';
  if (t.kind === 'adjust') return 'manual';
  if (t.kind === 'card') return 'cartão';
  return t.status === 'pending' ? 'prevista' : 'realizada';
}

function renderAccHistory(){
  const a = accounts.find(x => x.id === selectedAcc);
  const tb = $('#acc-hist tbody');
  const list = (a ? transactions.filter(t => sameName(t.account, a.name)) : transactions.filter(t => accOf(t)))
    .slice().sort((x,y) => y.date.localeCompare(x.date)).slice(0, 60);
  $('#acc-hist-title').textContent = a ? `Movimentações — ${a.name}` : 'Últimas movimentações (todas as contas) — clique numa conta para filtrar';
  if (!list.length){
    tb.innerHTML = `<tr><td><div class="empty" style="padding:26px"><span class="ei">🏦</span>Nenhuma movimentação ainda.</div></td></tr>`;
    return;
  }
  tb.innerHTML = list.map(t => `<tr>
    <td style="white-space:nowrap">${fmtDMY(t.date)}</td>
    <td>${esc(t.desc)}</td>
    <td style="color:var(--text-3)">${esc(t.account)}</td>
    <td><span class="pill ${t.kind?'':t.status}">${kindLabel(t)}</span></td>
    <td class="num ${t.type==='income'?'pos':'neg'}">${t.type==='income'?'+':'−'} ${fmtBRL(t.amount).replace('R$ ','')}</td>
    <td><button class="mini-btn danger" data-acc-del="${t.id}">×</button></td>
  </tr>`).join('');
  tb.querySelectorAll('[data-acc-del]').forEach(b => b.addEventListener('click', () => deleteTx(b.dataset.accDel)));
}

let accOp = 'in', accEditId = null;
function setAccOp(op){
  accOp = op;
  $$('#acc-seg button').forEach(b => b.classList.toggle('active', b.dataset.op === op));
  const edit = op === 'edit';
  $('#acc-op-fields').hidden = edit;
  $('#acc-edit-fields').hidden = !edit;
  $('#a-to-wrap').hidden = op !== 'transfer';
  $('#a-from-lab').textContent = op === 'transfer' ? 'De' : 'Conta';
  $('#a-del').hidden = !(edit && accEditId);
  $('#acc-title').textContent = { in:'Inserir valor', out:'Retirar valor', transfer:'Transferência entre contas',
    edit: accEditId ? 'Editar conta' : 'Nova conta' }[op];
}
function openAccModal(op, id){
  const opts = accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  $('#a-from').innerHTML = opts; $('#a-to').innerHTML = opts;
  accEditId = op === 'edit' ? (id || null) : null;
  if (id && op !== 'edit') $('#a-from').value = id;
  if (op === 'transfer'){
    const other = accounts.find(a => a.id !== $('#a-from').value);
    if (other) $('#a-to').value = other.id;
  }
  $('#a-date').value = todayISO(); $('#a-amount').value = ''; $('#a-desc').value = '';
  const a = accounts.find(x => x.id === accEditId);
  $('#a-name').value = a ? a.name : ''; $('#a-initial').value = a ? a.initial : 0;
  $('#a-color').value = a ? a.color : '#00E5FF';
  $('#acc-seg').hidden = op === 'edit';
  setAccOp(op);
  $('#acc-overlay').hidden = false;
  setTimeout(() => (op === 'edit' ? $('#a-name') : $('#a-amount')).focus(), 40);
}
const closeAccModal = () => { $('#acc-overlay').hidden = true; accEditId = null; };
$$('#acc-seg button').forEach(b => b.addEventListener('click', () => setAccOp(b.dataset.op)));
$('#a-close').addEventListener('click', closeAccModal);
$('#acc-overlay').addEventListener('mousedown', e => { if (e.target.id === 'acc-overlay') closeAccModal(); });
$('#btn-acc-new').addEventListener('click', () => openAccModal('edit', null));
$('#btn-acc-transfer').addEventListener('click', () => openAccModal('transfer', selectedAcc || accounts[0]?.id));

$('#a-del').addEventListener('click', () => {
  const a = accounts.find(x => x.id === accEditId); if (!a) return;
  if (!confirm(`Excluir a conta ${a.name}? Os lançamentos continuam existindo, mas ficam sem conta vinculada.`)) return;
  accounts = accounts.filter(x => x.id !== a.id);
  if (selectedAcc === a.id) selectedAcc = null;
  closeAccModal(); persist(); populateFilters(); renderAll(); toast('Conta excluída');
});

function renameLinked(oldName, newName){
  if (sameName(oldName, newName)) return;
  transactions.forEach(t => { if (sameName(t.account, oldName)) t.account = newName; });
  cards.forEach(c => { if (sameName(c.payFrom, oldName)) c.payFrom = newName; });
}

$('#acc-form').addEventListener('submit', e => {
  e.preventDefault();
  if (accOp === 'edit'){
    const name = $('#a-name').value.trim();
    if (!name) return;
    if (nameTaken(name, accEditId)){ alert('Já existe uma conta, cartão ou investimento com esse nome.'); return; }
    const initial = parseFloat($('#a-initial').value) || 0, color = $('#a-color').value;
    if (accEditId){
      const a = accounts.find(x => x.id === accEditId);
      renameLinked(a.name, name);
      Object.assign(a, { name, initial, color });
    } else accounts.push({ id: uid(), name, initial, color });
    closeAccModal(); persist(); populateFilters(); renderAll(); toast('Conta salva');
    return;
  }
  const amount = Math.abs(parseFloat($('#a-amount').value) || 0);
  const date = $('#a-date').value || todayISO();
  const from = accounts.find(a => a.id === $('#a-from').value);
  if (!from || amount <= 0){ toast('Informe a conta e um valor'); return; }
  const desc = $('#a-desc').value.trim();
  if (accOp === 'transfer'){
    const to = accounts.find(a => a.id === $('#a-to').value);
    if (!to || to.id === from.id){ toast('Escolha contas diferentes'); return; }
    pushTransfer({ date, amount, cat:'Transferências', from: from.name, to: to.name,
      descFrom: desc || `Transferência para ${to.name}`, descTo: desc || `Transferência de ${from.name}` });
    toast(`${fmtBRL(amount)} transferido de ${from.name} para ${to.name}`);
  } else {
    const inc = accOp === 'in';
    transactions.push({ id: uid(), date, amount, status:'paid', source:'manual', kind:'adjust', transferId:'', ref:'',
      type: inc ? 'income' : 'expense', cat: inc ? 'Outros Rendimentos' : 'Outros', account: from.name,
      desc: desc || (inc ? `Inserção manual — ${from.name}` : `Retirada manual — ${from.name}`) });
    toast(inc ? `${fmtBRL(amount)} inserido em ${from.name}` : `${fmtBRL(amount)} retirado de ${from.name}`);
  }
  closeAccModal(); persist(); populateFilters(); renderAll();
});

// par de lançamentos espelhados (saída de "from", entrada em "to")
function pushTransfer({ date, amount, cat, from, to, descFrom, descTo, ref = '' }){
  const tid = uid();
  const base = { date, cat, amount, status:'paid', source:'transfer', kind:'transfer', transferId:tid, ref };
  transactions.push(
    { ...base, id: uid(), type:'expense', account: from, desc: descFrom },
    { ...base, id: uid(), type:'income',  account: to,   desc: descTo },
  );
}

// ══ CARTÕES ═════════════════════════════════════════════════
// Fatura identificada pelo mês de VENCIMENTO ('YYYY-MM').
// Compra no dia do fechamento ou depois cai na fatura seguinte.
function invoiceKeyFor(card, iso){
  const day = Number(iso.slice(8,10));
  const closeKey = day < card.closingDay ? iso.slice(0,7) : addMonths(iso.slice(0,7), 1);
  return card.dueDay > card.closingDay ? closeKey : addMonths(closeKey, 1);
}
function invoiceDates(card, key){
  const closeKey = card.dueDay > card.closingDay ? key : addMonths(key, -1);
  return { close: dateIn(closeKey, card.closingDay), due: dateIn(key, card.dueDay) };
}
function cardTxs(card){ return transactions.filter(t => sameName(t.account, card.name)); }
function cardInvoices(card){
  const map = {};
  const get = (k) => map[k] || (map[k] = { key:k, charges:[], payments:[], total:0, paid:0 });
  cardTxs(card).forEach(t => {
    if (t.kind === 'transfer'){                       // pagamento de fatura
      if (t.type === 'income'){ const inv = get(t.ref || invoiceKeyFor(card, t.date)); inv.payments.push(t); inv.paid += t.amount; }
      return;
    }
    const inv = get(invoiceKeyFor(card, t.date));
    inv.charges.push(t);
    inv.total += t.type === 'expense' ? t.amount : -t.amount;   // receita no cartão = estorno
  });
  Object.values(map).forEach(inv => { inv.total = r2(inv.total); inv.paid = r2(inv.paid); });
  return map;
}
function invoiceStatus(card, inv){
  const { close, due } = invoiceDates(card, inv.key);
  const today = todayISO();
  const open = r2(inv.total - inv.paid);
  if (today < close) return { code:'open', label:'aberta', open };
  if (open <= 0.004) return { code:'paid', label: inv.total > 0 ? 'paga' : 'sem gastos', open:0 };
  if (today > due) return { code:'late', label:'vencida', open };
  return { code:'closed', label:'fechada', open };
}
const currentInvKey = (card) => invoiceKeyFor(card, todayISO());
function cardOutstanding(card){                       // fatura atual + anteriores não pagas
  const cur = currentInvKey(card);
  return r2(Object.values(cardInvoices(card)).filter(i => i.key <= cur)
    .reduce((s,i) => s + Math.max(0, i.total - i.paid), 0));
}
function cardCommitted(card){                         // inclui parcelas futuras
  return r2(Object.values(cardInvoices(card)).reduce((s,i) => s + Math.max(0, i.total - i.paid), 0));
}
function nextDue(){
  let best = null;
  cards.forEach(card => {
    Object.values(cardInvoices(card)).forEach(inv => {
      const st = invoiceStatus(card, inv);
      if (st.code === 'paid' || st.open <= 0) return;
      if (inv.key > currentInvKey(card)) return;
      const { due } = invoiceDates(card, inv.key);
      if (!best || due < best.due) best = { card, due, amount: st.open };
    });
  });
  return best;
}

function cardInitials(name){
  const w = String(name).trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '') + (w.length > 1 ? w[1][0] : (w[0]?.[1] || ''))).toUpperCase();
}
function renderCards(){
  const grid = $('#cc-grid'); if (!grid) return;
  if (selectedCard && !cards.some(c => c.id === selectedCard)) selectedCard = null;
  if (!selectedCard && cards.length) selectedCard = cards[0].id;

  // Fatura atual = soma das faturas do ciclo atual de todos os cartões
  const curTotal = r2(cards.reduce((s,c) => { const inv = cardInvoices(c)[currentInvKey(c)]; return s + (inv ? inv.total : 0); }, 0));
  const overdue = r2(cards.reduce((s,c) => { const inv = cardInvoices(c)[currentInvKey(c)]; return s + cardOutstanding(c) - (inv ? Math.max(0, inv.total - inv.paid) : 0); }, 0));
  const nd = nextDue();
  $('#cc-total').textContent = fmtBRL(curTotal);
  $('#cc-count').textContent = `(${cards.length})`;
  $('#cc-total-sub').innerHTML = !cards.length ? 'cadastre seu primeiro cartão'
    : [nd ? `próximo vencimento ${fmtDM(nd.due)} · ${esc(nd.card.name)} · ${fmtBRL(nd.amount)}` : 'nenhuma fatura pendente',
       overdue > 0.004 ? `<span class="neg">${fmtBRL(overdue)} de faturas anteriores em aberto</span>` : ''].filter(Boolean).join(' · ');

  if (!cards.length){
    grid.innerHTML = `<div class="card empty" style="grid-column:1/-1"><span class="ei">💳</span>Nenhum cartão cadastrado.<br>
      Clique em <b>+ Novo cartão</b> e informe limite, dia de fechamento e de vencimento.</div>`;
    $('#cc-inv-tbl tbody').innerHTML = ''; $('#cc-inv-nav').innerHTML = ''; $('#cc-next').innerHTML = '';
    $('#cc-inv-title').textContent = 'Faturas';
    return;
  }

  grid.innerHTML = cards.map(c => {
    const cur = currentInvKey(c);
    const inv = cardInvoices(c)[cur] || { key:cur, total:0, paid:0, charges:[] };
    const st = invoiceStatus(c, inv);
    const { close, due } = invoiceDates(c, cur);
    const lim = Number(c.limit)||0, used = Math.max(0, cardCommitted(c));
    const usedPct = lim ? Math.min(100, used/lim*100) : 0;
    const avail = r2(lim - used);
    return `<div class="cc2-card ${selectedCard===c.id?'sel':''}" style="--ac:${esc(c.color)}" data-card="${c.id}" tabindex="0">
      <span class="cc2-deco a"></span><span class="cc2-deco b"></span>
      <div class="cc2-top">
        <span class="cc2-logo">${esc(cardInitials(c.name))}</span>
        <div class="cc2-id"><div class="cc2-name">${esc(c.name)}</div><div class="cc2-num">•••• ${esc(c.last4 || '····')}</div></div>
        <button class="cc2-edit" data-card-edit="${c.id}" title="Editar cartão" aria-label="Editar cartão">✎</button>
      </div>
      <div class="cc2-lab">Fatura atual <span class="pill st-${st.code}">${st.label}</span></div>
      <div class="cc2-val">${fmtBRL(inv.total)}</div>
      <div class="cc2-dates">fecha ${fmtDM(close)} · vence ${fmtDM(due)}</div>
      <div class="cc2-sep"></div>
      <div class="cc2-lim-row"><span><svg class="ico" viewBox="0 0 24 24"><path d="M4 7a2 2 0 0 1 2-2h12v4M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><circle cx="16" cy="14" r="1"/></svg>Limite total</span><b>${lim ? fmtBRL(lim) : '—'}</b></div>
      <div class="cc2-bar">${lim ? `<span class="u" style="width:${usedPct.toFixed(1)}%"></span><span class="d" style="width:${(100-usedPct).toFixed(1)}%"></span>` : ''}</div>
      <div class="cc2-leg">
        <span class="lu"><i></i>Usado</span><b>${fmtBRL(used)}</b>
        <span class="ld"><i></i>Disponível</span><b class="${avail < 0 ? 'neg' : 'pos'}">${lim ? fmtBRL(avail) : '—'}</b>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-card]').forEach(el => {
    const pick = () => { if (selectedCard !== el.dataset.card){ selectedCard = el.dataset.card; cardInvKey = null; } renderCards(); };
    el.addEventListener('click', e => { if (!e.target.closest('button')) pick(); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) pick(); });
  });
  grid.querySelectorAll('[data-card-edit]').forEach(b => b.addEventListener('click', () => openCardModal('edit', b.dataset.cardEdit)));
  renderCardInvoice();
  renderNextInvoices();
}

function oldestUnpaidKey(card){
  const cur = currentInvKey(card);
  const list = Object.values(cardInvoices(card)).filter(i => i.key <= cur)
    .filter(i => { const st = invoiceStatus(card, i); return st.code !== 'paid' && st.open > 0.004 && st.code !== 'open'; })
    .sort((a,b) => a.key.localeCompare(b.key));
  return list[0]?.key || null;
}

function renderCardInvoice(){
  const card = cards.find(c => c.id === selectedCard); if (!card) return;
  const invs = cardInvoices(card);
  const key = cardInvKey || currentInvKey(card);
  cardInvKey = key;
  const inv = invs[key] || { key, charges:[], payments:[], total:0, paid:0 };
  const st = invoiceStatus(card, inv);
  const { close, due } = invoiceDates(card, key);
  $('#cc-inv-title').textContent = `Fatura — ${card.name}`;
  $('#cc-inv-nav').innerHTML = `
    <button class="mini-btn" data-inv-nav="-1" aria-label="Fatura anterior">‹</button>
    <div class="inv-nav-mid">
      <div class="inv-month">${monthLabel(key,true)} <span class="pill st-${st.code}">${st.label}</span></div>
      <div class="inv-sub">fecha ${fmtDMY(close)} · vence ${fmtDMY(due)}</div>
    </div>
    <div class="inv-amt">
      <div>${fmtBRL(inv.total)}</div>
      <div class="inv-sub">${inv.paid ? `pago ${fmtBRL(inv.paid)}` : ''}${st.open > 0.004 && st.code !== 'open' ? ` · falta ${fmtBRL(st.open)}` : ''}</div>
    </div>
    ${st.open > 0.004 ? `<button class="mini-btn go" data-inv-pay>Pagar</button>` : ''}
    <button class="mini-btn" data-inv-buy title="Nova compra neste cartão">+ Compra</button>
    <button class="mini-btn" data-inv-nav="1" aria-label="Próxima fatura">›</button>`;
  $('#cc-inv-nav').querySelectorAll('[data-inv-nav]').forEach(b => b.addEventListener('click', () => {
    cardInvKey = addMonths(cardInvKey, Number(b.dataset.invNav)); renderCardInvoice();
  }));
  $('#cc-inv-nav').querySelector('[data-inv-pay]')?.addEventListener('click', () => openCardModal('pay', card.id, key));
  $('#cc-inv-nav').querySelector('[data-inv-buy]')?.addEventListener('click', () => openCardModal('buy', card.id));

  const rows = [...inv.charges, ...inv.payments].sort((a,b) => b.date.localeCompare(a.date));
  const tb = $('#cc-inv-tbl tbody');
  if (!rows.length){
    tb.innerHTML = `<tr><td><div class="empty" style="padding:26px"><span class="ei">🧾</span>Nenhuma compra nesta fatura.</div></td></tr>`;
    return;
  }
  tb.innerHTML = rows.map(t => {
    const pay = t.kind === 'transfer';
    return `<tr>
      <td style="white-space:nowrap">${fmtDMY(t.date)}</td>
      <td>${esc(t.desc)}${t.status==='pending'?' <span class="pill pending">futura</span>':''}</td>
      <td>${pay ? '<span class="pill paid">pagamento</span>' : `<span class="pill">${esc(t.cat)}</span>`}</td>
      <td class="num ${pay || t.type==='income' ? 'pos' : 'neg'}">${pay || t.type==='income' ? '−' : ''} ${fmtBRL(t.amount).replace('R$ ','')}</td>
      <td><div class="row-actions">${pay ? '' : `<button class="mini-btn" data-cc-edit="${t.id}">Editar</button>`}<button class="mini-btn danger" data-cc-del="${t.id}">×</button></div></td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('[data-cc-edit]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.ccEdit)));
  tb.querySelectorAll('[data-cc-del]').forEach(b => b.addEventListener('click', () => deleteTx(b.dataset.ccDel)));
}

function renderNextInvoices(){
  const box = $('#cc-next');
  const totals = {};
  cards.forEach(card => {
    const cur = currentInvKey(card);
    Object.values(cardInvoices(card)).forEach(inv => {
      if (inv.key < cur) return;
      const v = Math.max(0, inv.total - inv.paid);
      if (!v) return;
      (totals[inv.key] = totals[inv.key] || { total:0, by:[] }).total += v;
      totals[inv.key].by.push({ card, v });
    });
  });
  const keys = Object.keys(totals).sort().slice(0, 8);
  if (!keys.length){ box.innerHTML = `<div class="empty" style="padding:26px"><span class="ei">📆</span>Nada lançado para as próximas faturas.</div>`; return; }
  const max = Math.max(...keys.map(k => totals[k].total));
  box.innerHTML = keys.map(k => `
    <div class="mrow nx-row">
      <span class="mlab">${monthLabel(k)}</span>
      <span class="mbar stack">${totals[k].by.map(({card,v}) =>
        `<span title="${esc(card.name)}: ${fmtBRL(v)}" style="width:${(v/max*100).toFixed(1)}%;background:${esc(card.color)};box-shadow:0 0 8px ${esc(card.color)}"></span>`).join('')}</span>
      <span class="mval neg">${fmtBRL(totals[k].total).replace('R$ ','')}</span>
    </div>`).join('') +
    `<div class="alloc-legend" style="margin-top:12px">${cards.map(c => `<span class="lg"><i style="background:${esc(c.color)}"></i>${esc(c.name)}</span>`).join('')}</div>`;
}

// ── modal de cartão: compra / pagamento / cadastro ──
let ccMode = 'buy', ccEditId = null, ccPayKey = null;
function openCardModal(mode, id, key){
  ccMode = mode; ccEditId = id || null; ccPayKey = key || null;
  $('#cc-buy-fields').hidden = mode !== 'buy';
  $('#cc-pay-fields').hidden = mode !== 'pay';
  $('#cc-edit-fields').hidden = mode !== 'edit';
  $('#cc-del').hidden = !(mode === 'edit' && id);
  const accOpts = accounts.map(a => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');
  const card = cards.find(c => c.id === id);

  if (mode === 'buy'){
    if (!cards.length){ toast('Cadastre um cartão primeiro'); return openCardModal('edit', null); }
    $('#cc-title').textContent = 'Compra no cartão';
    $('#c-card').innerHTML = cards.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    $('#c-card').value = (card || cards[0]).id;
    $('#c-date').value = todayISO(); $('#c-desc').value = ''; $('#c-amount').value = ''; $('#c-parc').value = 1;
    $('#c-cat').innerHTML = EXPENSE_CATS.map(c => `<option>${esc(c)}</option>`).join('');
    $('#c-cat').value = 'Compras';
    $('#cc-submit').textContent = 'Lançar compra';
    updateBuyHint();
  } else if (mode === 'pay'){
    const inv = cardInvoices(card)[key] || { key, total:0, paid:0 };
    const st = invoiceStatus(card, inv);
    const { due } = invoiceDates(card, key);
    $('#cc-title').textContent = `Pagar fatura — ${card.name}`;
    $('#p-from').innerHTML = accOpts;
    $('#p-from').value = accounts.some(a => sameName(a.name, card.payFrom)) ? accounts.find(a => sameName(a.name, card.payFrom)).name : (accounts[0]?.name || '');
    $('#p-date').value = todayISO();
    $('#p-amount').value = Math.max(0, r2(inv.total - inv.paid)).toFixed(2);
    $('#p-hint').textContent = `Fatura de ${monthLabel(key,true)} · total ${fmtBRL(inv.total)}${inv.paid ? ` · já pago ${fmtBRL(inv.paid)}` : ''} · vence ${fmtDMY(due)} (${st.label}). O valor sai da conta escolhida como transferência — não conta como despesa de novo.`;
    $('#cc-submit').textContent = 'Confirmar pagamento';
  } else {
    $('#cc-title').textContent = card ? 'Editar cartão' : 'Novo cartão';
    $('#e-payfrom').innerHTML = '<option value="">(escolher na hora)</option>' + accOpts;
    $('#e-name').value = card?.name || ''; $('#e-limit').value = card?.limit ?? '';
    $('#e-close').value = card?.closingDay ?? 1; $('#e-due').value = card?.dueDay ?? 10;
    $('#e-payfrom').value = card?.payFrom || ''; $('#e-color').value = card?.color || '#A472FF';
    $('#e-last4').value = card?.last4 || '';
    $('#cc-submit').textContent = 'Salvar';
  }
  $('#cc-overlay').hidden = false;
  setTimeout(() => ({ buy:$('#c-amount'), pay:$('#p-amount'), edit:$('#e-name') })[mode].focus(), 40);
}
function updateBuyHint(){
  const card = cards.find(c => c.id === $('#c-card').value); if (!card) return;
  const date = $('#c-date').value || todayISO();
  const amt = Math.abs(parseFloat($('#c-amount').value) || 0);
  const n = Math.max(1, Math.min(48, parseInt($('#c-parc').value, 10) || 1));
  const key = invoiceKeyFor(card, date);
  const { due } = invoiceDates(card, key);
  let h = `Entra na fatura de ${monthLabel(key,true)} (vence ${fmtDMY(due)}).`;
  if (n > 1 && amt) h += ` ${n}× de ${fmtBRL(r2(amt/n))} — última em ${monthLabel(addMonths(key, n-1),true)}.`;
  $('#c-hint').textContent = h;
}
['#c-card','#c-date','#c-amount','#c-parc'].forEach(s => $(s).addEventListener('input', updateBuyHint));
$('#c-desc').addEventListener('blur', () => {
  const d = $('#c-desc').value.trim();
  if (d && typeof categorize === 'function'){ const c = categorize(d, 'expense'); if (c && EXPENSE_CATS.includes(c)) $('#c-cat').value = c; }
});
const closeCardModal = () => { $('#cc-overlay').hidden = true; };
$('#cc-close').addEventListener('click', closeCardModal);
$('#cc-overlay').addEventListener('mousedown', e => { if (e.target.id === 'cc-overlay') closeCardModal(); });
$('#btn-cc-new').addEventListener('click', () => openCardModal('edit', null));
$('#btn-cc-buy').addEventListener('click', () => openCardModal('buy', selectedCard));

$('#cc-del').addEventListener('click', () => {
  const c = cards.find(x => x.id === ccEditId); if (!c) return;
  const pend = cardCommitted(c);
  if (!confirm(`Excluir o cartão ${c.name}?${pend ? ` Há ${fmtBRL(pend)} em faturas não pagas.` : ''} As compras continuam no histórico, sem cartão vinculado.`)) return;
  cards = cards.filter(x => x.id !== c.id);
  closeCardModal(); persist(); populateFilters(); renderAll(); toast('Cartão excluído');
});

$('#cc-form').addEventListener('submit', e => {
  e.preventDefault();
  if (ccMode === 'edit'){
    const name = $('#e-name').value.trim();
    if (!name){ toast('Dê um nome ao cartão'); return; }
    if (nameTaken(name, ccEditId)){ alert('Já existe uma conta, cartão ou investimento com esse nome.'); return; }
    const day = (v) => Math.min(31, Math.max(1, parseInt(v, 10) || 1));
    const data = { name, limit: Math.max(0, parseFloat($('#e-limit').value) || 0),
      closingDay: day($('#e-close').value), dueDay: day($('#e-due').value),
      payFrom: $('#e-payfrom').value, color: $('#e-color').value,
      last4: ($('#e-last4').value.match(/\d/g) || []).join('').slice(-4) };
    if (ccEditId){
      const c = cards.find(x => x.id === ccEditId);
      renameLinked(c.name, name);
      Object.assign(c, data);
    } else { const c = { id: uid(), ...data }; cards.push(c); selectedCard = c.id; }
    cardInvKey = null;
    closeCardModal(); persist(); populateFilters(); renderAll(); toast('Cartão salvo');
    return;
  }
  if (ccMode === 'buy'){
    const card = cards.find(c => c.id === $('#c-card').value);
    const date = $('#c-date').value || todayISO();
    const desc = $('#c-desc').value.trim();
    const total = r2(Math.abs(parseFloat($('#c-amount').value) || 0));
    const n = Math.max(1, Math.min(48, parseInt($('#c-parc').value, 10) || 1));
    if (!card || !desc || total <= 0){ toast('Informe descrição e valor'); return; }
    const per = r2(Math.floor(total / n * 100) / 100), gid = n > 1 ? uid() : '';
    const today = todayISO();
    for (let i = 0; i < n; i++){
      const d = addMonthsISO(date, i);
      const amount = i === n - 1 ? r2(total - per * (n - 1)) : per;
      transactions.push({ id: uid(), date: d, amount, type:'expense', cat: $('#c-cat').value,
        desc: n > 1 ? `${desc} (${i+1}/${n})` : desc, account: card.name,
        status: d <= today ? 'paid' : 'pending', source:'card', kind:'card', transferId: gid, ref:'' });
    }
    selectedCard = card.id; cardInvKey = invoiceKeyFor(card, date);
    closeCardModal(); persist(); populateFilters(); renderAll();
    toast(n > 1 ? `Compra lançada em ${n}× no ${card.name}` : `Compra lançada no ${card.name}`);
    return;
  }
  // pagamento
  const card = cards.find(c => c.id === ccEditId);
  const amount = r2(Math.abs(parseFloat($('#p-amount').value) || 0));
  const from = $('#p-from').value;
  if (!card || !from || amount <= 0){ toast('Escolha a conta e o valor'); return; }
  pushTransfer({ date: $('#p-date').value || todayISO(), amount, cat:'Cartões', from, to: card.name, ref: ccPayKey,
    descFrom: `Pagamento fatura ${card.name} — ${monthLabel(ccPayKey)}`, descTo: `Pagamento recebido — ${monthLabel(ccPayKey)}` });
  if (!card.payFrom) card.payFrom = from;
  closeCardModal(); persist(); populateFilters(); renderAll();
  toast(`Fatura de ${monthLabel(ccPayKey,true)} paga com ${from}`);
});

// ══ INVESTIMENTOS ═══════════════════════════════════════════
const INV_TYPES = {
  'Renda Fixa (CDB/LCI/LCA)':'#00E5FF', 'Tesouro Direto':'#3DFF9E', 'Poupança':'#3DFFD6',
  'Ações':'#FF2E97', 'FIIs':'#FFC44D', 'Fundos':'#A472FF', 'Cripto':'#FF7A00',
  'Previdência':'#4D9BFF', 'Outros':'#8E9BCC',
};
function invMoves(v){ return transactions.filter(t => t.kind === 'transfer' && sameName(t.account, v.name)); }
function invPrincipal(v){
  return (Number(v.initial)||0) + invMoves(v).reduce((s,t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
}
function investedNetTransfers(){       // aportes − resgates via contas (sai do "disponível")
  return transactions.filter(t => t.kind === 'transfer' && t.status === 'paid' && invOf(t))
    .reduce((s,t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
}
function pushHistory(v, date){
  v.history = (v.history || []).filter(h => h.date !== date);
  v.history.push({ date, value: r2(v.current) });
  v.history.sort((a,b) => a.date.localeCompare(b.date));
  v.history = v.history.slice(-120);
  v.updatedAt = date;
}

function sparkline(v){
  const pts = (v.history || []).slice(-24);
  if (pts.length < 2) return '';
  const vals = pts.map(p => p.value), min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const W = 120, H = 30;
  const d = pts.map((p,i) => `${i ? 'L' : 'M'}${(i/(pts.length-1)*W).toFixed(1)},${(H - 2 - (p.value-min)/span*(H-4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}

function renderInvestments(){
  const grid = $('#iv-grid'); if (!grid) return;
  const total = investments.reduce((s,v) => s + (Number(v.current)||0), 0);
  const principal = investments.reduce((s,v) => s + invPrincipal(v), 0);
  const gain = total - principal;
  $('#iv-total').textContent = fmtBRL(total);
  $('#iv-total').style.color = cssVar('--neon-lime');
  $('#iv-total-sub').textContent = investments.length ? `${investments.length} ${investments.length===1?'aplicação':'aplicações'} · aplicado ${fmtBRL(principal)}` : 'cadastre sua primeira aplicação';
  $('#iv-gain').textContent = (gain >= 0 ? '+' : '') + fmtBRL(gain);
  $('#iv-gain').style.color = gain >= 0 ? cssVar('--neon-lime') : cssVar('--neon-red');
  $('#iv-gain-sub').textContent = principal > 0 ? `${gain>=0?'+':''}${(gain/principal*100).toFixed(2).replace('.',',')}% sobre o aplicado` : '—';

  // alocação por tipo
  const by = {};
  investments.forEach(v => { by[v.type] = (by[v.type]||0) + (Number(v.current)||0); });
  const items = Object.entries(by).filter(([,x]) => x > 0).sort((a,b) => b[1]-a[1]);
  $('#iv-alloc-bar').innerHTML = items.length
    ? items.map(([t,x]) => `<span title="${esc(t)}: ${fmtBRL(x)}" style="width:${(x/total*100).toFixed(2)}%;background:${INV_TYPES[t]||'#8E9BCC'};box-shadow:0 0 10px ${INV_TYPES[t]||'#8E9BCC'}"></span>`).join('')
    : '<span class="alloc-empty"></span>';
  $('#iv-alloc-legend').innerHTML = items.length
    ? items.map(([t,x]) => `<span class="lg"><i style="background:${INV_TYPES[t]||'#8E9BCC'}"></i>${esc(t)} <b>${(x/total*100).toFixed(0)}%</b></span>`).join('')
    : '<span class="lg" style="color:var(--text-3)">Sem saldo investido ainda.</span>';

  grid.innerHTML = investments.map(v => {
    const p = invPrincipal(v), cur = Number(v.current)||0, g = cur - p;
    return `<div class="acc-card iv-card ${selectedInv===v.id?'sel':''}" style="--ac:${esc(v.color || INV_TYPES[v.type] || '#00E5FF')}" data-inv="${v.id}">
      <div class="acc-head">
        <span class="acc-dot"></span><span class="acc-name">${esc(v.name)}</span>
        <button class="mini-btn" data-inv-edit="${v.id}" title="Editar">✎</button>
      </div>
      <div class="acc-meta" style="margin:0 0 6px"><span class="pill">${esc(v.type)}</span>${v.institution ? ` · ${esc(v.institution)}` : ''}</div>
      <div class="acc-bal">${fmtBRL(cur)}</div>
      <div class="acc-meta">aplicado ${fmtBRL(p)} · <span class="${g>=0?'pos':'neg'}">${g>=0?'+':''}${fmtBRL(g).replace('R$ ','')}${p>0?` (${(g/p*100).toFixed(1).replace('.',',')}%)`:''}</span>${v.updatedAt ? `<br>valor atualizado em ${fmtDMY(v.updatedAt)}` : ''}</div>
      ${sparkline(v)}
      <div class="acc-actions">
        <button class="mini-btn go" data-inv-op="aporte" data-id="${v.id}">+ Aportar</button>
        <button class="mini-btn danger" data-inv-op="resgate" data-id="${v.id}">− Resgatar</button>
        <button class="mini-btn" data-inv-op="valor" data-id="${v.id}" title="Atualizar valor atual">↻</button>
      </div>
    </div>`;
  }).join('') || `<div class="card empty" style="grid-column:1/-1"><span class="ei">📈</span>Nenhum investimento cadastrado.<br>Clique em <b>+ Novo investimento</b>.</div>`;

  grid.querySelectorAll('[data-inv]').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    selectedInv = selectedInv === el.dataset.inv ? null : el.dataset.inv;
    renderInvestments();
  }));
  grid.querySelectorAll('[data-inv-edit]').forEach(b => b.addEventListener('click', () => openInvModal('edit', b.dataset.invEdit)));
  grid.querySelectorAll('[data-inv-op]').forEach(b => b.addEventListener('click', () => openInvModal(b.dataset.invOp, b.dataset.id)));
  renderInvHistory();
}

function renderInvHistory(){
  const v = investments.find(x => x.id === selectedInv);
  const list = (v ? [v] : investments);
  const rows = [];
  list.forEach(inv => {
    invMoves(inv).forEach(t => rows.push({ date:t.date, name:inv.name, label: t.type==='income'?'aporte':'resgate',
      cls: t.type==='income'?'pos':'neg', amount:(t.type==='income'?'+ ':'− ')+fmtBRL(t.amount).replace('R$ ',''), id:t.id }));
    (inv.history || []).forEach(h => rows.push({ date:h.date, name:inv.name, label:'valor atual', cls:'', amount: fmtBRL(h.value).replace('R$ ',''), id:'' }));
  });
  rows.sort((a,b) => b.date.localeCompare(a.date) || (a.id ? -1 : 1));
  $('#iv-hist-title').textContent = v ? `Movimentações — ${v.name}` : 'Movimentações de investimentos — clique numa aplicação para filtrar';
  const tb = $('#iv-hist tbody');
  if (!rows.length){ tb.innerHTML = `<tr><td><div class="empty" style="padding:26px"><span class="ei">📈</span>Nenhuma movimentação ainda.</div></td></tr>`; return; }
  tb.innerHTML = rows.slice(0, 80).map(r => `<tr>
    <td style="white-space:nowrap">${fmtDMY(r.date)}</td>
    <td>${esc(r.name)}</td>
    <td><span class="pill ${r.label==='aporte'?'income':r.label==='resgate'?'expense':''}">${r.label}</span></td>
    <td class="num ${r.cls}">${r.amount}</td>
    <td>${r.id ? `<button class="mini-btn danger" data-iv-del="${r.id}">×</button>` : ''}</td>
  </tr>`).join('');
  tb.querySelectorAll('[data-iv-del]').forEach(b => b.addEventListener('click', () => {
    const t = transactions.find(x => x.id === b.dataset.ivDel);
    const inv = t && invOf(t) || investments.find(x => transactions.some(y => y.transferId === t?.transferId && sameName(y.account, x.name)));
    const before = transactions.length;
    deleteTx(b.dataset.ivDel);
    if (inv && transactions.length < before){         // desfaz o efeito no valor atual
      inv.current = r2(Math.max(0, (Number(inv.current)||0) + (t.type === 'income' ? -t.amount : t.amount)));
      persist(); renderAll();
    }
  }));
}

let ivOp = 'aporte', ivEditId = null;
function setIvOp(op){
  ivOp = op;
  $$('#iv-seg button').forEach(b => b.classList.toggle('active', b.dataset.op === op));
  const edit = op === 'edit';
  $('#iv-seg').hidden = edit;
  $('#iv-op-fields').hidden = edit;
  $('#iv-edit-fields').hidden = !edit;
  $('#iv-del').hidden = !(edit && ivEditId);
  $('#i-acc-wrap').hidden = op === 'valor';
  $('#i-acc-lab').textContent = op === 'resgate' ? 'Creditar na conta' : 'Conta de origem';
  $('#i-amount-lab').textContent = op === 'valor' ? 'Valor atual total (R$)' : 'Valor (R$)';
  $('#iv-title').textContent = { aporte:'Aportar', resgate:'Resgatar', valor:'Atualizar valor atual',
    edit: ivEditId ? 'Editar investimento' : 'Novo investimento' }[op];
  updateIvHint();
}
function updateIvHint(){
  const v = investments.find(x => x.id === $('#i-inv').value);
  if (!v || ivOp === 'edit'){ $('#i-hint').textContent = ''; return; }
  const cur = Number(v.current)||0;
  $('#i-hint').textContent = ivOp === 'valor'
    ? `Hoje: ${fmtBRL(cur)} · aplicado ${fmtBRL(invPrincipal(v))}. Informe o saldo que aparece no app do banco/corretora — a diferença vira rendimento.`
    : ivOp === 'aporte' ? `Sai da conta como transferência (não é despesa). Saldo atual da aplicação: ${fmtBRL(cur)}.`
    : `Volta para a conta como transferência. Disponível para resgate: ${fmtBRL(cur)}.`;
}
function openInvModal(op, id){
  ivEditId = op === 'edit' ? (id || null) : null;
  if (op !== 'edit' && !investments.length){ toast('Cadastre um investimento primeiro'); return openInvModal('edit', null); }
  $('#i-inv').innerHTML = investments.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
  if (id && op !== 'edit') $('#i-inv').value = id;
  $('#i-acc').innerHTML = accounts.map(a => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');
  $('#i-date').value = todayISO(); $('#i-amount').value = '';
  $('#v-type').innerHTML = Object.keys(INV_TYPES).map(t => `<option>${esc(t)}</option>`).join('');
  const v = investments.find(x => x.id === ivEditId);
  $('#v-name').value = v?.name || ''; $('#v-type').value = v?.type || 'Renda Fixa (CDB/LCI/LCA)';
  $('#v-inst').value = v?.institution || ''; $('#v-color').value = v?.color || INV_TYPES[v?.type] || '#00E5FF';
  $('#v-initial-row').hidden = !!v;
  $('#v-initial').value = 0; $('#v-current').value = 0;
  setIvOp(op);
  $('#iv-overlay').hidden = false;
  setTimeout(() => (op === 'edit' ? $('#v-name') : $('#i-amount')).focus(), 40);
}
const closeInvModal = () => { $('#iv-overlay').hidden = true; ivEditId = null; };
$$('#iv-seg button').forEach(b => b.addEventListener('click', () => setIvOp(b.dataset.op)));
$('#i-inv').addEventListener('change', updateIvHint);
$('#v-type').addEventListener('change', () => { if (!ivEditId) $('#v-color').value = INV_TYPES[$('#v-type').value] || '#00E5FF'; });
$('#v-initial').addEventListener('input', () => { if (!(parseFloat($('#v-current').value) > 0)) $('#v-current').value = $('#v-initial').value; });
$('#iv-close').addEventListener('click', closeInvModal);
$('#iv-overlay').addEventListener('mousedown', e => { if (e.target.id === 'iv-overlay') closeInvModal(); });
$('#btn-iv-new').addEventListener('click', () => openInvModal('edit', null));

$('#iv-del').addEventListener('click', () => {
  const v = investments.find(x => x.id === ivEditId); if (!v) return;
  if ((Number(v.current)||0) > 0.004){ alert(`Ainda há ${fmtBRL(v.current)} em ${v.name}. Faça o resgate (ou atualize o valor para zero) antes de excluir.`); return; }
  if (!confirm(`Excluir o investimento ${v.name}? O histórico de aportes e resgates continua nas contas.`)) return;
  investments = investments.filter(x => x.id !== v.id);
  if (selectedInv === v.id) selectedInv = null;
  closeInvModal(); persist(); populateFilters(); renderAll(); toast('Investimento excluído');
});

$('#iv-form').addEventListener('submit', e => {
  e.preventDefault();
  if (ivOp === 'edit'){
    const name = $('#v-name').value.trim();
    if (!name){ toast('Dê um nome ao investimento'); return; }
    if (nameTaken(name, ivEditId)){ alert('Já existe uma conta, cartão ou investimento com esse nome.'); return; }
    const data = { name, type: $('#v-type').value, institution: $('#v-inst').value.trim(), color: $('#v-color').value };
    if (ivEditId){
      const v = investments.find(x => x.id === ivEditId);
      renameLinked(v.name, name);
      Object.assign(v, data);
    } else {
      const initial = r2(Math.max(0, parseFloat($('#v-initial').value) || 0));
      const current = r2(Math.max(0, parseFloat($('#v-current').value) || initial));
      const v = { id: uid(), ...data, initial, current, history: [], updatedAt: '' };
      if (current || initial) pushHistory(v, todayISO());
      investments.push(v);
    }
    closeInvModal(); persist(); populateFilters(); renderAll(); toast('Investimento salvo');
    return;
  }
  const v = investments.find(x => x.id === $('#i-inv').value);
  const amount = r2(Math.abs(parseFloat($('#i-amount').value) || 0));
  const date = $('#i-date').value || todayISO();
  if (!v){ toast('Escolha o investimento'); return; }
  if (ivOp === 'valor'){
    if (!$('#i-amount').value){ toast('Informe o valor atual'); return; }
    v.current = amount; pushHistory(v, date);
    toast(`${v.name} atualizado para ${fmtBRL(amount)}`);
  } else {
    const acc = $('#i-acc').value;
    if (!acc || amount <= 0){ toast('Escolha a conta e o valor'); return; }
    if (ivOp === 'aporte'){
      pushTransfer({ date, amount, cat:'Investimentos', from: acc, to: v.name,
        descFrom: `Aporte — ${v.name}`, descTo: `Aporte vindo de ${acc}` });
      v.current = r2((Number(v.current)||0) + amount);
      toast(`${fmtBRL(amount)} aplicado em ${v.name}`);
    } else {
      if (amount > (Number(v.current)||0) + 0.004 && !confirm(`O resgate (${fmtBRL(amount)}) é maior que o saldo registrado (${fmtBRL(v.current)}). Continuar?`)) return;
      pushTransfer({ date, amount, cat:'Investimentos', from: v.name, to: acc,
        descFrom: `Resgate para ${acc}`, descTo: `Resgate — ${v.name}` });
      v.current = r2(Math.max(0, (Number(v.current)||0) - amount));
      toast(`${fmtBRL(amount)} resgatado de ${v.name}`);
    }
    pushHistory(v, date);
  }
  closeInvModal(); persist(); populateFilters(); renderAll();
});

// ══ PWA ═════════════════════════════════════════════════════
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// atalhos do ícone na tela inicial (?acao=nova | ?acao=importar)
function applyShortcut(){
  const acao = new URLSearchParams(location.search).get('acao');
  if (acao === 'nova') openModal(null);
  if (acao === 'importar') $('#tabs .tab[data-tab="import"]').click();
  if (acao) history.replaceState(null, '', location.pathname);
}

// ══ BOOT ════════════════════════════════════════════════════
(async function boot(){
  try {
    const t = localStorage.getItem('fn_token');
    const u = localStorage.getItem('fn_user');
    if (t && u){
      TOKEN = t; ME = JSON.parse(u);
      const r = await api('/api/auth', { method:'POST', body: JSON.stringify({ action:'session' }) });
      ME = r.user;
      await enterApp();
      return;
    }
  } catch { clearSession(); }
  $('#login-screen').hidden = false;
  $('#lg-user').focus();
})();

// ── barra de filtros recolhível (celular) ───────────────────
$('#filter-toggle').addEventListener('click', () => {
  const bar = $('#filterbar');
  const open = bar.classList.toggle('open');
  $('#filter-toggle').setAttribute('aria-expanded', String(open));
  if (open) redrawCharts();
});
