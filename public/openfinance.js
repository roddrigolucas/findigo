/* ══ FinNexus — Open Finance (Pluggy) ═════════════════════════
   Conecta bancos pelo Open Finance e importa movimentações
   automaticamente. As credenciais da Pluggy ficam no servidor;
   aqui só circulam tokens de conexão de curta duração.        */

const OF_WIDGET = 'https://cdn.pluggy.ai/pluggy-connect/v2.11.0/pluggy-connect.js';
const OF_AUTO_HOURS = 3;            // ao abrir o app, sincroniza se a última foi há mais que isso
let ofState = { configured:false, sandbox:false, items:[], lastSync:null, lastResult:null };
let ofBusy = false;

const ofApi = (action, extra = {}) =>
  api('/api/openfinance', { method:'POST', body: JSON.stringify({ action, ...extra }) });

const OF_ERRORS = {
  pluggy_nao_configurado:'O Open Finance ainda não foi configurado no servidor.',
  pluggy_credenciais:'A Pluggy recusou o Client ID / Client Secret. Confira os dois valores.',
  credenciais_invalidas:'Preencha o Client ID e o Client Secret.',
  item_nao_encontrado:'Conexão não encontrada na Pluggy. Confira o Item ID ou conecte de novo.',
  item_invalido:'Item ID inválido.',
  atualizacao_indisponivel:'Este banco não permite atualização manual agora — ele é atualizado automaticamente 1× por dia.',
  limite_conexoes:'Limite de 20 conexões atingido.',
  pluggy_falhou:'A Pluggy não respondeu como esperado. Tente de novo em instantes.',
};
const ofMsg = (e) => OF_ERRORS[e?.message] || msgFor(e);

const OF_STATUS = {
  UPDATED:      { cls:'ok',   txt:'Conectado' },
  UPDATING:     { cls:'info', txt:'Atualizando…' },
  CREATED:      { cls:'info', txt:'Conectando…' },
  LOGIN_ERROR:  { cls:'err',  txt:'Reconectar' },
  OUTDATED:     { cls:'warn', txt:'Desatualizado' },
  WAITING_USER_INPUT: { cls:'warn', txt:'Aguardando você' },
  REMOVED:      { cls:'err',  txt:'Removido na Pluggy' },
};

function ofStatus(msg, type='info'){
  const el = $('#of-status');
  if (!msg){ el.className = 'status'; el.textContent = ''; return; }
  el.textContent = msg; el.className = `status show ${type}`;
}
const fmtDT = (s) => { if (!s) return '—'; const d = new Date(s); return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) + ' ' + d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); };
const ofAccLabel = (a) => a.type === 'CREDIT' ? 'Cartão de crédito' : ({ CHECKING_ACCOUNT:'Conta corrente', SAVINGS_ACCOUNT:'Poupança' }[a.subtype] || 'Conta');

// saldo do FinNexus para o destino vinculado (conta ou cartão)
function ofTargetBalance(a){
  const acc = accounts.find(x => sameName(x.name, a.target));
  if (acc) return { kind:'acc', ent:acc, value: accBalance(acc) };
  const card = cards.find(x => sameName(x.name, a.target));
  if (card) return { kind:'card', ent:card, value: cardOutstanding(card) };
  return null;
}

function ofDefaultFrom(target){
  const d = new Date(); d.setMonth(d.getMonth() - 12);
  const floor = d.toISOString().slice(0,10);
  const last = transactions.filter(t => sameName(t.account, target) && t.source !== 'openfinance')
    .reduce((m, t) => t.date > m ? t.date : m, '');
  if (!last) return floor;
  const n = new Date(last + 'T12:00:00Z'); n.setUTCDate(n.getUTCDate() + 1);
  const next = n.toISOString().slice(0,10);
  return next > floor ? next : floor;
}

function ofTargetOptions(a){
  const opt = (v, txt) => `<option value="${esc(v)}" ${sameName(v, a.target) && v ? 'selected' : ''}>${esc(txt)}</option>`;
  const accs = accounts.map(x => opt(x.name, x.name)).join('');
  const cds = cards.map(x => opt(x.name, x.name)).join('');
  const primary = a.type === 'CREDIT'
    ? `<optgroup label="Cartões">${cds}</optgroup><optgroup label="Contas">${accs}</optgroup>`
    : `<optgroup label="Contas">${accs}</optgroup><optgroup label="Cartões">${cds}</optgroup>`;
  return `<option value="">— não importar —</option>${primary}
    <optgroup label="Criar"><option value="__new__">+ Criar ${a.type === 'CREDIT' ? 'cartão' : 'conta'} “${esc(a.name)}”</option></optgroup>`;
}

function renderOF(){
  const card = $('#of-card'); if (!card) return;
  const { configured, items } = ofState;
  $('#of-setup').hidden = configured;
  $('#of-cred').hidden = configured || !ofState.isAdmin;
  $('#of-connect').hidden = !configured;
  $('#of-manual').hidden = !configured;
  $('#of-sync').hidden = !configured || !items.length;
  const linked = items.reduce((n, it) => n + it.accounts.filter(a => a.target).length, 0);
  $('#of-sub').textContent = !configured
    ? 'Conecte seus bancos e as movimentações chegam sozinhas.'
    : !items.length ? 'Nenhum banco conectado ainda.'
    : `${items.length} ${items.length === 1 ? 'banco' : 'bancos'} · ${linked} ${linked === 1 ? 'conta importando' : 'contas importando'} · última sincronização ${fmtDT(ofState.lastSync)}`;

  $('#of-list').innerHTML = items.map(it => {
    const st = OF_STATUS[it.status] || { cls:'info', txt: it.status || '—' };
    const needsReconnect = ['LOGIN_ERROR','OUTDATED','WAITING_USER_INPUT'].includes(it.status);
    const logo = it.connector.imageUrl
      ? `<img class="of-logo" src="${esc(it.connector.imageUrl)}" alt="" loading="lazy">`
      : `<span class="of-logo of-logo-txt" style="--c:${esc(it.connector.primaryColor ? '#' + it.connector.primaryColor.replace('#','') : '#00E5FF')}">${esc(it.connector.name.charAt(0))}</span>`;
    const rows = it.accounts.map(a => {
      const tb = a.target ? ofTargetBalance(a) : null;
      let diff = '';
      if (tb && tb.kind === 'acc'){
        const d = r2(a.balance - tb.value);
        diff = Math.abs(d) < 0.01
          ? `<span class="of-ok">✓ saldos conferem</span>`
          : `<span class="of-diff">FinNexus ${fmtBRL(tb.value)} <button class="of-link" data-fix="${esc(it.id)}|${esc(a.id)}" title="Ajusta o saldo inicial da conta para bater com o banco">igualar</button></span>`;
      }
      return `<tr>
        <td><div class="of-acc-name">${esc(a.name)}</div><div class="of-acc-sub">${ofAccLabel(a)}${a.number ? ' · ' + esc(a.number) : ''}</div></td>
        <td class="num"><div>${fmtBRL(a.type === 'CREDIT' ? -Math.abs(a.balance) : a.balance)}</div><div class="of-acc-sub">${diff}</div></td>
        <td><select class="of-target" data-item="${esc(it.id)}" data-acc="${esc(a.id)}">${ofTargetOptions(a)}</select></td>
        <td><input type="date" class="of-from" data-item="${esc(it.id)}" data-acc="${esc(a.id)}" value="${esc(a.from || '')}" ${a.target ? '' : 'disabled'} title="Importar movimentações a partir desta data"></td>
        <td class="of-acc-sub">${a.target ? (a.lastSync ? fmtDT(a.lastSync) : 'pendente') : '—'}</td>
      </tr>`;
    }).join('');
    return `<div class="of-item">
      <div class="of-item-head">
        ${logo}
        <div class="of-item-title"><b>${esc(it.connector.name)}</b>
          <span class="of-acc-sub">dados do banco de ${fmtDT(it.lastUpdatedAt)}${it.error ? ' · ' + esc(it.error) : ''}</span></div>
        <span class="of-pill ${st.cls}">${st.txt}</span>
        <div class="of-item-btns">
          ${needsReconnect ? `<button class="btn-ghost of-btn" data-reconnect="${esc(it.id)}">Reconectar</button>` : ''}
          <button class="btn-ghost of-btn" data-syncitem="${esc(it.id)}" title="Buscar movimentações agora">⟳</button>
          <button class="btn-ghost of-btn" data-remove="${esc(it.id)}" title="Remover conexão">✕</button>
        </div>
      </div>
      ${it.accounts.length
        ? `<div class="tbl-wrap"><table class="of-accs"><thead><tr><th>Conta no banco</th><th class="num">Saldo no banco</th><th>Importar para</th><th>A partir de</th><th>Sincronizada</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="of-acc-sub" style="padding:10px 0">O banco ainda não enviou as contas. Elas aparecem após a primeira atualização.</div>`}
    </div>`;
  }).join('');
}

async function ofLoad(){
  try { ofState = await ofApi('status'); } catch { ofState = { ...ofState, configured:false, items:[] }; }
  renderOF();
}

async function ofReloadTransactions(){
  try {
    const r = await api('/api/data');
    transactions = (r.transactions || []).map(normalize);
    if (r.updatedAt) serverStamp = r.updatedAt;
    ofRecategorize();
    populateFilters(); renderAll();
  } catch {}
}

// categoria que a Pluggy não soube dizer: usa o classificador local (aprende com seus lançamentos)
function ofRecategorize(){
  if (typeof predictCategory !== 'function') return 0;
  let n = 0;
  transactions.forEach(t => {
    if (t.source !== 'openfinance' || t.ref !== 'of-auto') return;
    const c = predictCategory(t.desc, t.type);
    if (c && ALL_CATS.includes(c)) t.cat = c;
    t.ref = ''; n++;
  });
  if (n) persist();
  return n;
}

async function ofSync(itemIds, { quiet = false } = {}){
  if (ofBusy) return;
  ofBusy = true;
  $('#of-sync').disabled = true; $('#of-sync').textContent = '⟳ Sincronizando…';
  if (!quiet) ofStatus('Buscando movimentações nos bancos…', 'info');
  try {
    await flushPersist();                        // grava alterações pendentes antes
    const r = await ofApi('sync', itemIds ? { itemIds } : {});
    ofState = { ...ofState, ...r };
    const { added, updated, errors } = r.result;
    if (added || updated) await ofReloadTransactions();
    const msg = added || updated
      ? `${added} ${added === 1 ? 'movimentação nova importada' : 'movimentações novas importadas'}${updated ? `, ${updated} atualizadas` : ''}.`
      : 'Tudo em dia — nenhuma movimentação nova.';
    if (!quiet || added) toast(`Open Finance: ${msg}`);
    ofStatus(errors.length ? `${msg} ${errors.length} ${errors.length === 1 ? 'conta' : 'contas'} com erro — veja o status abaixo.` : msg, errors.length ? 'err' : 'ok');
  } catch (e) {
    if (!quiet) ofStatus(ofMsg(e), 'err');
  } finally {
    ofBusy = false;
    $('#of-sync').disabled = false; $('#of-sync').textContent = '⟳ Sincronizar agora';
    renderOF();
  }
}

async function ofAuto(){
  await ofLoad();
  if (!ofState.configured) return;
  const linked = ofState.items.some(it => it.accounts.some(a => a.target));
  const age = ofState.lastSync ? (Date.now() - new Date(ofState.lastSync).getTime()) / 36e5 : Infinity;
  if (linked && age > OF_AUTO_HOURS) ofSync(null, { quiet:true });
}

// ── widget Pluggy Connect ──
function ofLoadWidget(){
  if (window.PluggyConnect) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = OF_WIDGET; s.async = true;
    s.onload = () => ok(); s.onerror = () => fail(new Error('widget'));
    document.head.appendChild(s);
  });
}

async function ofOpenConnect(itemId, { allowDuplicate = false } = {}){
  ofStatus('Abrindo a conexão segura com o banco…', 'info');
  let lastItemId = null;
  const addItem = async (id) => {
    ofStatus('Banco conectado. Carregando contas…', 'info');
    try {
      ofState = { ...ofState, ...(await ofApi('add_item', { itemId: id })) };
      renderOF();
      ofStatus('Banco conectado! Escolha abaixo para qual conta ou cartão do FinNexus cada conta do banco deve ser importada.', 'ok');
    } catch (e) { ofStatus(ofMsg(e), 'err'); }
  };
  try {
    const [{ accessToken }] = await Promise.all([ofApi('connect_token', { ...(itemId ? { itemId } : {}), ...(allowDuplicate ? { allowDuplicate: true } : {}) }), ofLoadWidget()]);
    const w = new window.PluggyConnect({
      connectToken: accessToken,
      includeSandbox: !!ofState.sandbox,
      language: 'pt',
      ...(itemId ? { updateItem: itemId } : {}),
      onEvent: (ev) => { if (ev?.item?.id) lastItemId = ev.item.id; },
      onSuccess: async (data) => { if (data?.item?.id) await addItem(data.item.id); },
      onError: async (err) => {
        console.warn('[FinNexus] Pluggy Connect', err);
        // conexão já existente (ex.: tentativa anterior) — reaproveita em vez de bloquear
        const id = err?.data?.item?.id || lastItemId;
        if (id && /ALREADY_EXISTS|already/i.test(err?.message || '')) { await addItem(id); return; }
        if (/ALREADY_EXISTS/i.test(err?.message || '')) {
          ofStatus('Você já tinha uma conexão com esse banco. Abrindo de novo para reaproveitá-la…', 'info');
          setTimeout(() => ofOpenConnect(itemId, { allowDuplicate: true }), 600);
          return;
        }
        ofStatus(`Não foi possível conectar: ${err?.message || 'erro na conexão'}`, 'err');
      },
      onClose: () => { if ($('#of-status').textContent.startsWith('Abrindo')) ofStatus(''); },
    });
    w.init();
  } catch (e) {
    ofStatus(e.message === 'widget' ? 'Não foi possível carregar o componente da Pluggy. Verifique sua conexão.' : ofMsg(e), 'err');
  }
}

function ofUniqueName(base){
  let name = base.slice(0, 54), i = 2;
  while (nameTaken(name)) name = `${base.slice(0, 50)} ${i++}`;
  return name;
}

async function ofLink(itemId, accId, target, from){
  try {
    ofState = { ...ofState, ...(await ofApi('link_accounts', { links:[{ itemId, accountId: accId, target, from }] })) };
    renderOF();
    if (target) await ofSync([itemId]);
    else ofStatus('Conta desvinculada — novas movimentações dela não serão importadas.', 'info');
  } catch (e) { ofStatus(ofMsg(e), 'err'); }
}

function ofInitUI(){
  if (!$('#of-card')) return;
  $('#of-cred').addEventListener('submit', async (e) => {
    e.preventDefault();
    ofStatus('Validando as credenciais na Pluggy…', 'info');
    try {
      await ofApi('save_credentials', { clientId: $('#of-cid').value.trim(), clientSecret: $('#of-csec').value.trim() });
      $('#of-csec').value = '';
      await ofLoad();
      ofStatus('Credenciais validadas e salvas. Agora clique em “+ Conectar banco”.', 'ok');
    } catch (err) { ofStatus(ofMsg(err), 'err'); }
  });
  $('#of-connect').addEventListener('click', () => ofOpenConnect());
  $('#of-sync').addEventListener('click', () => ofSync());
  $('#of-add').addEventListener('click', async () => {
    const id = $('#of-item-id').value.trim();
    if (!id){ toast('Cole o Item ID'); return; }
    ofStatus('Verificando conexão na Pluggy…', 'info');
    try {
      ofState = { ...ofState, ...(await ofApi('add_item', { itemId: id })) };
      $('#of-item-id').value = ''; renderOF();
      ofStatus('Conexão adicionada. Agora escolha o destino de cada conta.', 'ok');
    } catch (e) { ofStatus(ofMsg(e), 'err'); }
  });

  $('#of-list').addEventListener('change', async (e) => {
    const el = e.target;
    const it = ofState.items.find(x => x.id === el.dataset.item);
    const a = it?.accounts.find(x => x.id === el.dataset.acc);
    if (!a) return;
    if (el.classList.contains('of-target')){
      let target = el.value;
      if (target === '__new__'){
        const name = ofUniqueName(a.name);
        if (a.type === 'CREDIT'){
          const day = (s, d) => s ? Math.min(31, Math.max(1, Number(s.slice(8,10)) || d)) : d;
          cards.push({ id: uid(), name, limit: a.creditLimit || 0, closingDay: day(a.closeDate, 1), dueDay: day(a.dueDate, 10),
            color: ACC_COLORS[cards.length % ACC_COLORS.length], payFrom:'', last4: String(a.number||'').replace(/\D/g,'').slice(-4) });
        } else {
          accounts.push({ id: uid(), name, initial: 0, color: ACC_COLORS[accounts.length % ACC_COLORS.length], _ofNew: true });
        }
        persist(); populateAccountSelects(); renderAll();
        target = name;
        toast(`${a.type === 'CREDIT' ? 'Cartão' : 'Conta'} “${name}” criad${a.type === 'CREDIT' ? 'o' : 'a'}`);
      }
      const from = target ? (a.from || ofDefaultFrom(target)) : '';
      await ofLink(it.id, a.id, target, from);
      // conta recém-criada: começa com o saldo que o banco informa
      const acc = accounts.find(x => x._ofNew && sameName(x.name, target));
      if (acc){ delete acc._ofNew; acc.initial = r2(a.balance - (accBalance(acc) - (Number(acc.initial)||0))); persist(); renderAll(); renderOF(); }
    } else if (el.classList.contains('of-from') && el.value){
      await ofLink(it.id, a.id, a.target, el.value);
    }
  });

  $('#of-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.syncitem) return ofSync([b.dataset.syncitem]);
    if (b.dataset.reconnect) return ofOpenConnect(b.dataset.reconnect);
    if (b.dataset.fix){
      const [iid, aid] = b.dataset.fix.split('|');
      const a = ofState.items.find(x => x.id === iid)?.accounts.find(x => x.id === aid);
      const tb = a && ofTargetBalance(a);
      if (!tb || tb.kind !== 'acc') return;
      const d = r2(a.balance - tb.value);
      if (!confirm(`Ajustar o saldo inicial de “${tb.ent.name}” em ${fmtBRL(d)} para bater com o banco (${fmtBRL(a.balance)})?`)) return;
      tb.ent.initial = r2((Number(tb.ent.initial)||0) + d);
      persist(); renderAll(); renderOF(); toast('Saldo ajustado');
      return;
    }
    if (b.dataset.remove){
      const it = ofState.items.find(x => x.id === b.dataset.remove);
      if (!confirm(`Remover a conexão com ${it?.connector.name || 'o banco'}? As movimentações já importadas continuam no FinNexus.`)) return;
      const revoke = confirm('Também revogar o acesso na Pluggy? (OK = revogar · Cancelar = só parar de importar aqui)');
      try { ofState = { ...ofState, ...(await ofApi('remove_item', { itemId: it.id, revoke })) }; renderOF(); ofStatus('Conexão removida.', 'info'); }
      catch (err) { ofStatus(ofMsg(err), 'err'); }
    }
  });
}
ofInitUI();
