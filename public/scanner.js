/* ══ FinDigo — leitura do cupom fiscal pela câmera ════════════
   QR Code da NFC-e / CF-e SAT (ou código de barras com a chave de 44 dígitos).
   Fluxo: câmera → código → /api/nfce (SEFAZ + CNPJ) → transação no mês, categoria e conta. */

let scanStream = null, scanTimer = null, scanBusy = false, scanReader = null;
let lastScanned = null;                                   // { tx, info } do último lançamento (para desfazer/editar)

const SCAN_PREF = {
  get acc(){ try { return localStorage.getItem('fn_scan_acc') || ''; } catch { return ''; } },
  set acc(v){ try { localStorage.setItem('fn_scan_acc', v); } catch {} },
  get auto(){ try { return localStorage.getItem('fn_scan_auto') !== '0'; } catch { return true; } },
  set auto(v){ try { localStorage.setItem('fn_scan_auto', v ? '1' : '0'); } catch {} },
};

// CNAE do estabelecimento → categoria/subcategoria (prefixos, do mais específico ao mais geral)
const CNAE_MAP = [
  ['5611201','Alimentação Fora','Restaurantes'], ['5611203','Alimentação Fora','Cafés e lanches'], ['5611204','Alimentação Fora','Bares'],
  ['5611205','Alimentação Fora','Bares'], ['5611','Alimentação Fora','Restaurantes'], ['5612','Alimentação Fora','Cafés e lanches'],
  ['5620','Alimentação Fora','Restaurantes'],
  ['4711','Alimentação','Essencial casa'], ['4712','Alimentação','Essencial casa'], ['4721','Alimentação','Essencial casa'],
  ['4722','Alimentação','Essencial casa'], ['4724','Alimentação','Essencial casa'], ['4729','Alimentação','Essencial casa'],
  ['4723','Alimentação','Extra casa'],
  ['4771','Saúde','Remédios Rodrigo'], ['4772','Compras Pessoais','Cosméticos'],
  ['4731','Transporte','Combustível para trabalho'], ['4732','Transporte','Combustível para trabalho'],
  ['4520','Transporte','Manutenção preventiva'], ['4530','Transporte','Manutenção preventiva'], ['5223','Transporte','Estacionamento'],
  ['4789004','Pets','Ração'], ['7500','Pets','Veterinário'], ['9609208','Pets','Banho e tosa'],
  ['4781','Compras Pessoais','Vestuário'], ['4782','Compras Pessoais','Calçados'], ['4751','Compras Pessoais','Eletrônicos'],
  ['4752','Compras Pessoais','Eletrônicos'], ['4753','Compras Pessoais','Eletrônicos'], ['4754','Compras Pessoais','Decoração'],
  ['4755','Compras Pessoais','Decoração'], ['4759','Compras Pessoais','Decoração'],
  ['9602501','Cuidados Pessoais','Salão de beleza'], ['9602502','Cuidados Pessoais','Estética'], ['9313','Esportes','Academia'],
  ['4761','Educação','Gastos com cursos'], ['85','Educação','Gastos com cursos'],
  ['5510','Lazer e Cultura','Viagens'], ['5590','Lazer e Cultura','Viagens'], ['5914','Lazer e Cultura','Cinema'],
  ['4744','Habitação','Manutenção básica'], ['4742','Habitação','Manutenção básica'],
];
function catFromCupom(info){
  const c = String(info.cnae || '');
  if (c) for (const [pre, cat, sub] of CNAE_MAP) if (c.startsWith(pre)) return { cat, sub };
  const text = [info.store, info.legal, info.cnaeDesc, ...(info.items || []).slice(0, 8).map(i => i.name)].join(' ');
  const r = classify(text, 'expense');
  return r && r.cat !== 'Transferências' ? r : { cat:'Outros', sub:'A classificar' };
}
function accountFromCupom(info){
  if (info.payment === 'credito'){
    const pref = cards.find(c => sameName(c.name, SCAN_PREF.acc));
    if (pref) return pref.name;
    if (cards.length === 1) return cards[0].name;
  }
  const all = [...accounts, ...cards];
  const pref = all.find(a => sameName(a.name, SCAN_PREF.acc));
  return pref ? pref.name : (accounts[0]?.name || '');
}
function dateFromCupom(info){
  if (/^\d{4}-\d{2}-\d{2}$/.test(info.date || '')) return { date: info.date, approx: false };
  const today = todayISO();
  if (info.ym === today.slice(0, 7)) return { date: today, approx: true };
  return { date: dateIn(info.ym, 1), approx: true };
}
// "SUPERMERCADOS BH COMERCIO LTDA" → "Supermercados BH Comercio LTDA" (siglas curtas ficam em maiúsculas)
const LOWER_WORDS = new Set(['de','da','do','das','dos','e','em','na','no','com','para']);
const titleCase = (s) => String(s || '').trim().split(/\s+/).map((w, i) => {
  const lw = w.toLowerCase();
  if (i > 0 && LOWER_WORDS.has(lw)) return lw;
  if (/^(ltda|s\/?a|me|eireli|epp)\.?$/i.test(w) || (w.length <= 3 && /^[A-Z0-9&]+$/.test(w) && !/^[AEIOU]+$/.test(w))) return w.toUpperCase();
  return lw.charAt(0).toUpperCase() + lw.slice(1);
}).join(' ');

// ── câmera ──────────────────────────────────────────────────
async function loadZXing(){
  if (window.ZXing) return window.ZXing;
  await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = '/vendor/zxing.min.js'; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  return window.ZXing;
}
async function makeDecoder(){
  if ('BarcodeDetector' in window){
    try {
      const fmts = await BarcodeDetector.getSupportedFormats();
      if (fmts.includes('qr_code')){
        const det = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'itf'].filter(f => fmts.includes(f)) });
        return async (src) => { const r = await det.detect(src); return r[0]?.rawValue || ''; };
      }
    } catch {}
  }
  const Z = await loadZXing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.ITF]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader(); reader.setHints(hints);
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
  return async (src) => {
    const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    if (!w || !h) return '';
    const k = Math.min(1, 1280 / Math.max(w, h));
    cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    try {
      const lum = new Z.HTMLCanvasElementLuminanceSource(cv);
      return reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(lum))).getText();
    } catch { return ''; }
  };
}

async function openScanner(){
  closeSheets();
  const ov = $('#scan-ov'); ov.hidden = false;
  document.body.classList.add('no-scroll');
  scanSetMsg('Aponte a câmera para o QR Code do cupom fiscal', '');
  $('#scan-auto').checked = SCAN_PREF.auto;
  scanBusy = false;
  try { scanReader = await makeDecoder(); }
  catch { scanSetMsg('Não consegui carregar o leitor. Use "Foto do cupom" ou "Digitar chave".', 'err'); return; }
  if (!navigator.mediaDevices?.getUserMedia){ scanSetMsg('Este navegador não libera a câmera aqui. Use "Foto do cupom".', 'err'); return; }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    const v = $('#scan-video'); v.srcObject = scanStream; v.setAttribute('playsinline', ''); await v.play();
    const tick = async () => {
      if (!scanStream || scanBusy) return;
      const code = await scanReader(v).catch(() => '');
      if (code && !scanBusy){ scanBusy = true; onCode(code); return; }
      scanTimer = setTimeout(tick, 220);
    };
    tick();
  } catch (e){
    scanSetMsg(e && e.name === 'NotAllowedError' ? 'Acesso à câmera negado. Libere a câmera nas permissões do navegador ou use "Foto do cupom".'
      : 'Câmera indisponível. Use "Foto do cupom" ou "Digitar chave".', 'err');
  }
}
function stopCamera(){
  clearTimeout(scanTimer); scanTimer = null;
  if (scanStream){ scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  const v = $('#scan-video'); if (v) v.srcObject = null;
}
function closeScanner(){
  stopCamera();
  $('#scan-ov').hidden = true; $('#scan-res').hidden = true;
  document.body.classList.remove('no-scroll');
}
function scanSetMsg(msg, cls){ const el = $('#scan-msg'); el.textContent = msg; el.className = 'scan-msg ' + (cls || ''); }

// ── código lido → transação ─────────────────────────────────
async function onCode(code){
  if (navigator.vibrate) navigator.vibrate(60);
  stopCamera();
  scanSetMsg('Cupom lido! Consultando a SEFAZ…', 'ok');
  $('#scan-ov').classList.add('busy');
  let info;
  try { info = await api('/api/nfce', { method:'POST', body: JSON.stringify({ code }) }); }
  catch (e){
    $('#scan-ov').classList.remove('busy');
    scanSetMsg(e.message === 'codigo_invalido' ? 'Esse código não é de um cupom fiscal (NFC-e / CF-e SAT). Tente o QR Code do rodapé do cupom.' : 'Não consegui consultar agora. Verifique a internet e tente de novo.', 'err');
    setTimeout(() => { if (!$('#scan-ov').hidden && !scanStream) { scanBusy = false; openScanner(); } }, 2600);
    return;
  }
  $('#scan-ov').classList.remove('busy');
  const dup = transactions.find(t => t.nfce === info.chave);
  if (dup){ showScanResult(dup, info, 'dup'); return; }

  const { cat, sub } = catFromCupom(info);
  const { date, approx } = dateFromCupom(info);
  const tx = { id: uid(), date, desc: titleCase(info.store) || `Cupom ${info.modelo} ${info.cnpj}`, cat, sub, type:'expense',
    amount: info.amount || 0, account: accountFromCupom(info), status: date <= todayISO() ? 'paid' : 'pending',
    source:'cupom', kind:'', transferId:'', ref:'', nfce: info.chave };

  if (!info.amount){                                       // SEFAZ não respondeu: completa o valor à mão
    closeScanner();
    openModal(null);
    pendingNfce = info.chave;
    setModalType('expense');
    $('#m-date').value = tx.date; $('#m-desc').value = tx.desc; ensureAccountOption(tx.account); $('#m-account').value = tx.account;
    $('#m-cat').value = tx.cat; populateSubSelect('#m-sub', tx.cat, tx.sub);
    $('#m-amount').value = ''; setTimeout(() => $('#m-amount').focus(), 80);
    toast('Cupom lido — a SEFAZ não informou o valor. Digite o total.');
    return;
  }
  if (SCAN_PREF.auto){
    transactions.push(tx); persist(); populateFilters(); renderAll();
    showScanResult(tx, info, approx ? 'approx' : 'saved');
  } else showScanResult(tx, info, 'confirm');
}

function showScanResult(tx, info, mode){
  lastScanned = { tx, info, mode };
  $('#scan-ov').hidden = true;
  const r = $('#scan-res'); r.hidden = false;
  const head = { saved:'✓ Transação lançada', approx:'✓ Transação lançada', confirm:'Confira e lance', dup:'Esse cupom já foi lançado' }[mode];
  const items = (info.items || []).slice(0, 6).map(i => `<li><span>${esc(titleCase(i.name))}</span><b>${i.value ? fmtBRL(i.value) : ''}</b></li>`).join('');
  const more = (info.items || []).length > 6 ? `<li class="more">+ ${(info.items.length - 6)} itens</li>` : '';
  const accOpts = [...accounts.map(a => a.name), ...cards.map(c => c.name)];
  if (tx.account && !accOpts.some(n => sameName(n, tx.account))) accOpts.unshift(tx.account);
  r.querySelector('.sheet').innerHTML = `
    <div class="sheet-grip"></div>
    <h3 class="sr-head ${mode === 'dup' ? 'warn' : ''}">${head}</h3>
    <div class="sr-amount">${fmtBRL(tx.amount)}</div>
    <div class="sr-store">${esc(tx.desc)}</div>
    <div class="sr-meta">${esc(info.modelo || 'Cupom')} · ${fmtDMY(tx.date)}${mode === 'approx' ? ' <em>(data aproximada — confira)</em>' : ''}</div>
    ${mode === 'dup' ? '' : `
    <div class="sr-fields">
      <label>Categoria<select id="sr-cat">${catOptionsHTML('expense', esc)}</select></label>
      <label>Subcategoria<select id="sr-sub"></select></label>
      <label>Conta / cartão<select id="sr-acc">${accOpts.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></label>
    </div>`}
    ${items ? `<details class="sr-items"><summary>${info.items.length} ${info.items.length === 1 ? 'item' : 'itens'} no cupom</summary><ul>${items}${more}</ul></details>` : ''}
    <div class="sr-actions">
      ${mode === 'confirm' ? `<button class="btn-primary" id="sr-save">Lançar</button>` : ''}
      ${mode === 'saved' || mode === 'approx' ? `<button class="btn-ghost" id="sr-undo">Desfazer</button><button class="btn-ghost" id="sr-edit">Editar</button>` : ''}
      ${mode === 'dup' ? `<button class="btn-ghost" id="sr-edit">Ver lançamento</button>` : ''}
      <button class="btn-primary ${mode === 'confirm' ? 'ghosty' : ''}" id="sr-again">📷 Ler outro</button>
    </div>
    <button class="sr-close" id="sr-close" aria-label="Fechar">✕</button>`;
  if (mode !== 'dup'){
    $('#sr-cat').value = tx.cat; populateSubSelect('#sr-sub', tx.cat, tx.sub);
    $('#sr-acc').value = accOpts.find(n => sameName(n, tx.account)) || '';
    const sync = () => {
      tx.cat = $('#sr-cat').value; tx.sub = $('#sr-sub').value; tx.account = $('#sr-acc').value;
      SCAN_PREF.acc = tx.account;
      if (mode !== 'confirm'){ persist(); renderAll(); }
    };
    $('#sr-cat').addEventListener('change', () => { populateSubSelect('#sr-sub', $('#sr-cat').value); sync(); });
    $('#sr-sub').addEventListener('change', sync);
    $('#sr-acc').addEventListener('change', sync);
  }
  $('#sr-save')?.addEventListener('click', () => {
    tx.cat = $('#sr-cat').value; tx.sub = $('#sr-sub').value; tx.account = $('#sr-acc').value; SCAN_PREF.acc = tx.account;
    transactions.push(tx); persist(); populateFilters(); renderAll(); toast('Transação lançada'); closeScanner();
  });
  $('#sr-undo')?.addEventListener('click', () => {
    transactions = transactions.filter(t => t.id !== tx.id); persist(); populateFilters(); renderAll(); toast('Lançamento desfeito'); closeScanner();
  });
  $('#sr-edit')?.addEventListener('click', () => { closeScanner(); openModal(tx.id); });
  $('#sr-again').addEventListener('click', () => { $('#scan-res').hidden = true; openScanner(); });
  $('#sr-close').addEventListener('click', closeScanner);
}

// ── foto do cupom / digitar chave ───────────────────────────
$('#scan-photo').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  scanSetMsg('Lendo a foto…', '');
  try {
    const img = new Image(); img.src = URL.createObjectURL(f); await img.decode();
    const dec = scanReader || await makeDecoder();
    let code = await dec(img).catch(() => '');
    if (!code && 'createImageBitmap' in window){ const bmp = await createImageBitmap(img); code = await dec(bmp).catch(() => ''); }
    URL.revokeObjectURL(img.src);
    if (code){ scanBusy = true; onCode(code); }
    else scanSetMsg('Não achei o QR Code na foto. Tente mais perto, com boa luz e o código inteiro na imagem.', 'err');
  } catch { scanSetMsg('Não consegui abrir a foto.', 'err'); }
});
$('#scan-type').addEventListener('click', () => {
  const v = prompt('Digite os 44 números da chave de acesso (no rodapé do cupom):');
  if (v && v.replace(/\D/g, '').length === 44){ scanBusy = true; onCode(v); }
  else if (v) toast('A chave tem 44 números');
});
$('#scan-close').addEventListener('click', closeScanner);
$('#scan-auto').addEventListener('change', (e) => { SCAN_PREF.auto = e.target.checked; });
document.querySelectorAll('[data-scan]').forEach(b => b.addEventListener('click', openScanner));
document.addEventListener('visibilitychange', () => { if (document.hidden && scanStream) stopCamera(); });
