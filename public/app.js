/* ══ FinNexus — app ═════════════════════════════════════════ */

// ── Constantes ──────────────────────────────────────────────
const INCOME_CATS  = ['Salário','Freelance/Negócios','Investimentos','Outros Rendimentos'];
const EXPENSE_CATS = ['Alimentação','Moradia','Transporte','Saúde','Educação','Entretenimento',
  'Assinaturas','Compras','Cartões','Telecomunicações','Pets','Viagens','Dívidas',
  'Transferências','Poupança','Impostos','Outros'];
const ALL_CATS = [...INCOME_CATS, ...EXPENSE_CATS];
const ACCOUNTS = ['Santander', 'Nubank', 'Caixa Poup.Rodrigo', 'Caixa Vó', 'BB Vó', 'Inter', 'Em caixa (efetivo)'];
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
let pendingTxs = [];
let editingId = null;
let modalType = 'expense';
let sortCol = 'date', sortDir = -1;
let saveTimer = null;
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
  TOKEN = null; ME = null; transactions = [];
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
}

async function loadData(){
  setSync('loading');
  try {
    const r = await api('/api/data');
    transactions = (r.transactions || []).map(normalize);
    if (typeof trainBayes === 'function') trainBayes(transactions);
    setSync('ok');
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
  setSync('saving');
  saveTimer = setTimeout(async () => {
    try {
      await api('/api/data', { method:'PUT', body: JSON.stringify({ transactions }) });
      setSync('ok');
    } catch { setSync('error'); }
  }, 500);
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
  
  const accOpts = '<option value="">Todas</option>' + ACCOUNTS.map(a=>`<option>${esc(a)}</option>`).join('');
  if ($('#f-acc').innerHTML.length < 50) $('#f-acc').innerHTML = accOpts;
  
  const mAccOpts = '<option value="">(Nenhuma)</option>' + ACCOUNTS.map(a=>`<option>${esc(a)}</option>`).join('');
  if ($('#m-account').innerHTML.length < 50) $('#m-account').innerHTML = mAccOpts;
  if ($('#import-account').innerHTML.length < 50) $('#import-account').innerHTML = mAccOpts;

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
    inPeriod(t) &&
    (!filters.cat || t.cat === filters.cat) &&
    (!filters.acc || t.account === filters.acc) &&
    (!filters.status || t.status === filters.status)
  );
}

const sumOf = (txs, type, status) => txs
  .filter(t => t.type === type && (!status || t.status === status))
  .reduce((a,t) => a + t.amount, 0);

// ══ ABAS ════════════════════════════════════════════════════
$$('#tabs .tab').forEach(tab => tab.addEventListener('click', () => {
  const name = tab.dataset.tab;
  $$('#tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
  ['summary','monthly','transactions','import','users'].forEach(p => {
    $('#panel-'+p).hidden = (p !== name);
  });
  if (name === 'summary') redrawCharts();
  if (name === 'users') loadUsers();
}));

// ══ RENDER ══════════════════════════════════════════════════
function renderAll(){
  renderSummary();
  renderMonthly();
  renderTx();
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

  // Saldo líquido disponível: tudo que já foi realizado (todo o histórico armazenado)
  const netAvailable = sumOf(all,'income','paid') - sumOf(all,'expense','paid');

  // Previsto no mês corrente
  const monthTx = all.filter(t => monthKey(t.date) === cm);
  const incFc = sumOf(monthTx,'income','pending');
  const expFc = sumOf(monthTx,'expense','pending');
  const nInc = monthTx.filter(t=>t.type==='income'&&t.status==='pending').length;
  const nExp = monthTx.filter(t=>t.type==='expense'&&t.status==='pending').length;

  $('#k-net').textContent = fmtBRL(netAvailable);
  $('#k-net').style.setProperty('color', netAvailable >= 0 ? cssVar('--neon-cyan') : cssVar('--neon-red'));
  $('#k-net-sub').textContent = `realizado até hoje · ${all.filter(t=>t.status==='paid').length} lançamentos`;

  $('#k-inc-fc').textContent = fmtBRL(incFc);
  $('#k-inc-fc-sub').textContent = nInc ? `${nInc} a receber em ${monthLabel(cm,true)}` : `nada previsto em ${monthLabel(cm,true)}`;
  $('#k-exp-fc').textContent = fmtBRL(expFc);
  $('#k-exp-fc-sub').textContent = nExp ? `${nExp} a pagar em ${monthLabel(cm,true)}` : `nada previsto em ${monthLabel(cm,true)}`;

  const proj = netAvailable + incFc - expFc;
  $('#k-proj').textContent = fmtBRL(proj);
  $('#k-proj').style.setProperty('color', proj >= 0 ? cssVar('--neon-amber') : cssVar('--neon-red'));

  const inc = sumOf(f,'income'), exp = sumOf(f,'expense');
  const span = monthsBetween(filters.from, filters.to) + 1;
  $('#k-inc').textContent = fmtBRL(inc);
  $('#k-inc-sub').textContent = `${f.filter(t=>t.type==='income').length} lançamentos`;
  $('#k-exp').textContent = fmtBRL(exp);
  $('#k-exp-sub').textContent = `${f.filter(t=>t.type==='expense').length} lançamentos`;
  $('#k-avg').textContent = fmtBRL(exp / span);
  $('#k-avg-sub').textContent = `sobre ${span} ${span===1?'mês':'meses'}`;

  renderUpcoming();
  redrawCharts();
}

function renderUpcoming(){
  const tb = $('#upcoming-tbl').querySelector('tbody');
  const up = transactions
    .filter(t => t.status === 'pending')
    .sort((a,b) => a.date.localeCompare(b.date))
    .slice(0, 8);
  if (!up.length){
    tb.innerHTML = `<tr><td><div class="empty" style="padding:26px"><span class="ei">🗓️</span>Nenhum lançamento previsto. Marque uma transação como “Prevista” para acompanhá-la aqui.</div></td></tr>`;
    return;
  }
  const today = todayISO();
  tb.innerHTML = up.map(t => {
    const late = t.date < today;
    return `<tr>
      <td style="white-space:nowrap">${t.date.slice(8,10)}/${t.date.slice(5,7)}${late?' <span class="pill pending">atrasado</span>':''}</td>
      <td>${esc(t.desc)}</td>
      <td><span class="pill">${esc(t.cat)}</span></td>
      <td class="num ${t.type==='income'?'pos':'neg'}">${t.type==='income'?'+':'−'} ${fmtBRL(t.amount).replace('R$ ','')}</td>
      <td class="num"><button class="mini-btn go" data-pay="${t.id}">Confirmar</button></td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => {
    const t = transactions.find(x => x.id === b.dataset.pay);
    if (t){ t.status = 'paid'; persist(); renderAll(); toast('Lançamento confirmado'); }
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
function renderTx(){
  const f = getFiltered().slice().sort((a,b) => {
    let r;
    if (sortCol === 'amount') r = a.amount - b.amount;
    else r = String(a[sortCol]).localeCompare(String(b[sortCol]),'pt-BR');
    return r * sortDir;
  });
  
  const currentFilteredIds = new Set(f.map(t => t.id));
  const newSelection = new Set();
  selectedTxs.forEach(id => { if (currentFilteredIds.has(id)) newSelection.add(id); });
  selectedTxs = newSelection;
  updateBulkBar();

  $('#tx-count').textContent = `Transações — ${f.length} no período`;
  const tb = $('#tx-table').querySelector('tbody');
  if (!f.length){
    tb.innerHTML = `<tr><td colspan="8"><div class="empty"><span class="ei">📭</span>Nenhuma transação neste filtro.</div></td></tr>`;
    $('#chk-all').checked = false;
    return;
  }
  
  $('#chk-all').checked = selectedTxs.size === f.length && f.length > 0;

  tb.innerHTML = f.map((t, index) => {
    const sel = selectedTxs.has(t.id);
    return `<tr class="${sel ? 'selected' : ''}" data-index="${index}">
    <td class="chk-col"><input type="checkbox" class="chk-row" data-id="${t.id}" ${sel?'checked':''}></td>
    <td style="white-space:nowrap">${t.date.split('-').reverse().join('/')}</td>
    <td>${esc(t.desc)}</td>
    <td><span class="pill">${esc(t.cat)}</span></td>
    <td style="color:var(--text-3)">${esc(t.account||'—')}</td>
    <td><span class="pill ${t.status}">${t.status==='pending'?'prevista':'realizada'}</span></td>
    <td class="num ${t.type==='income'?'pos':'neg'}">${t.type==='income'?'+':'−'} ${fmtBRL(t.amount).replace('R$ ','')}</td>
    <td><div class="row-actions">
      <button class="mini-btn" data-edit="${t.id}">Editar</button>
      <button class="mini-btn danger" data-del="${t.id}">×</button>
    </div></td>
  </tr>`
  }).join('');
  
  tb.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.edit)));
  tb.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteTx(b.dataset.del)));
  
  const rows = tb.querySelectorAll('tr');
  const checkboxes = tb.querySelectorAll('.chk-row');
  
  checkboxes.forEach((chk, idx) => {
    chk.addEventListener('click', (e) => {
      const id = chk.dataset.id;
      if (e.shiftKey && lastCheckedId !== null) {
        let start = -1, end = -1;
        checkboxes.forEach((c, i) => {
          if (c.dataset.id === lastCheckedId) start = i;
          if (c === chk) end = i;
        });
        if (start !== -1 && end !== -1) {
          const min = Math.min(start, end), max = Math.max(start, end);
          for (let i = min; i <= max; i++) {
            const c = checkboxes[i];
            c.checked = chk.checked;
            if (c.checked) selectedTxs.add(c.dataset.id);
            else selectedTxs.delete(c.dataset.id);
            rows[i].classList.toggle('selected', c.checked);
          }
        }
      } else {
        if (chk.checked) selectedTxs.add(id);
        else selectedTxs.delete(id);
        rows[idx].classList.toggle('selected', chk.checked);
      }
      lastCheckedId = id;
      updateBulkBar();
      $('#chk-all').checked = selectedTxs.size === f.length && f.length > 0;
    });
  });
}

// ── BULK ACTIONS ──
$('#chk-all').addEventListener('click', (e) => {
  const checked = e.target.checked;
  const f = getFiltered();
  selectedTxs.clear();
  if (checked) f.forEach(t => selectedTxs.add(t.id));
  renderTx();
});

function updateBulkBar() {
  const bar = $('#bulk-bar');
  const count = selectedTxs.size;
  if (count > 0) {
    bar.hidden = false;
    $('#bulk-count').textContent = `${count} selecionada${count>1?'s':''}`;
    if ($('#bulk-cat').innerHTML.length < 50) {
      $('#bulk-cat').innerHTML = '<option value="">Categorizar como...</option>' + ALL_CATS.map(c=>`<option>${esc(c)}</option>`).join('');
    }
  } else {
    bar.hidden = true;
    $('#bulk-cat').value = '';
  }
}

$('#btn-bulk-del').addEventListener('click', () => {
  if (!confirm(`Excluir ${selectedTxs.size} transações?`)) return;
  transactions = transactions.filter(t => !selectedTxs.has(t.id));
  selectedTxs.clear();
  persist(); populateFilters(); renderAll(); toast('Transações excluídas');
});

$('#bulk-cat').addEventListener('change', (e) => {
  const cat = e.target.value;
  if (!cat) return;
  
  transactions.forEach(t => {
    if (selectedTxs.has(t.id)) {
      t.cat = cat;
      if (INCOME_CATS.includes(cat)) t.type = 'income';
      else if (EXPENSE_CATS.includes(cat)) t.type = 'expense';
    }
  });
  
  selectedTxs.clear();
  e.target.value = '';
  persist(); populateFilters(); renderAll(); toast('Categorias atualizadas');
});

$$('#tx-table th.sortable').forEach(th => th.addEventListener('click', () => {
  const col = th.dataset.sort;
  if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = col === 'date' ? -1 : 1; }
  renderTx();
}));

function deleteTx(id){
  if (!confirm('Excluir esta transação?')) return;
  transactions = transactions.filter(t => t.id !== id);
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
  const data = keys.map(k => {
    const txs = transactions.filter(t => monthKey(t.date) === k && (!filters.cat || t.cat === filters.cat));
    return { k, inc: sumOf(txs,'income'), exp: sumOf(txs,'expense') };
  });
  const padL = 52, padR = 12, padT = 16, padB = 34;
  const cw = w - padL - padR, ch = h - padT - padB;
  const max = Math.max(1, ...data.map(d => Math.max(d.inc, d.exp)));
  const grid = cssVar('--border'), txt3 = cssVar('--text-3');

  ctx.font = '10px "Plus Jakarta Sans", sans-serif';
  for (let i=0;i<=4;i++){
    const y = padT + ch - (ch*i/4);
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL,y+.5); ctx.lineTo(w-padR,y+.5); ctx.stroke();
    ctx.fillStyle = txt3; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(fmtShort(max*i/4), padL-8, y);
  }

  const slot = cw / Math.max(1,data.length);
  const bw = Math.max(4, Math.min(20, slot*0.32));
  data.forEach((d,i) => {
    const cx = padL + slot*i + slot/2;
    const hi = (d.inc/max)*ch, he = (d.exp/max)*ch;
    ctx.shadowBlur = 10;
    ctx.fillStyle = cssVar('--income'); ctx.shadowColor = cssVar('--income');
    if (hi > 0){ rr(ctx, cx-bw-2, padT+ch-hi, bw, hi, 3); ctx.fill(); }
    ctx.fillStyle = cssVar('--expense'); ctx.shadowColor = cssVar('--expense');
    if (he > 0){ rr(ctx, cx+2, padT+ch-he, bw, he, 3); ctx.fill(); }
    ctx.shadowBlur = 0;
    ctx.fillStyle = txt3; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (data.length <= 13 || i % 2 === 0) ctx.fillText(monthLabel(d.k), cx, padT+ch+9);
  });
}

function drawDonut(){
  const canvas = $('#c-donut'); if (!canvas || !canvas.parentElement.clientWidth) return;
  const { ctx, w, h } = prep(canvas);
  const f = getFiltered().filter(t => t.type === 'expense');
  const by = {};
  f.forEach(t => { by[t.cat] = (by[t.cat]||0) + t.amount; });
  const items = Object.entries(by).sort((a,b)=>b[1]-a[1]);
  const total = items.reduce((a,[,v])=>a+v,0);
  const legend = $('#donut-legend');

  if (!total){
    ctx.fillStyle = cssVar('--text-3'); ctx.font = '13px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Sem despesas no período', w/2, h/2);
    legend.innerHTML = ''; return;
  }

  const top = items.slice(0,7);
  const rest = items.slice(7).reduce((a,[,v])=>a+v,0);
  if (rest > 0) top.push(['Outras categorias', rest]);

  const cx = w/2, cy = h/2, R = Math.min(w,h)/2 - 8, r0 = R*0.62;
  let ang = -Math.PI/2;
  top.forEach(([name,val]) => {
    const a = (val/total) * Math.PI*2;
    const color = CAT_COLORS[name] || '#6E7BAE';
    ctx.beginPath();
    ctx.arc(cx,cy,R,ang,ang+a); ctx.arc(cx,cy,r0,ang+a,ang,true); ctx.closePath();
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fill();
    ctx.shadowBlur = 0;
    ang += a;
  });
  ctx.fillStyle = cssVar('--text-1');
  ctx.font = '600 16px Sora, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(fmtBRL(total).replace('R$ ',''), cx, cy-6);
  ctx.fillStyle = cssVar('--text-3'); ctx.font = '10px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('total de despesas', cx, cy+12);

  legend.innerHTML = top.map(([name,val]) => `
    <div class="legend-item">
      <span class="sw" style="background:${CAT_COLORS[name]||'#6E7BAE'};box-shadow:0 0 8px ${CAT_COLORS[name]||'#6E7BAE'}"></span>
      <span class="ln">${esc(name)}</span>
      <span class="lv">${(val/total*100).toFixed(0)}%</span>
    </div>`).join('');
}

let redrawT = null;
function redrawCharts(){
  clearTimeout(redrawT);
  redrawT = setTimeout(() => { drawMonthly(); drawDonut(); }, 60);
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
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal-overlay').hidden) closeModal(); });

$('#btn-del').addEventListener('click', () => {
  if (!editingId) return;
  if (!confirm('Excluir esta transação?')) return;
  transactions = transactions.filter(t => t.id !== editingId);
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
