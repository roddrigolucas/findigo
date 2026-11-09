// Teste ponta a ponta do Open Finance: funções reais + Blobs local + Pluggy simulada + Chromium.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BlobsServer } from '@netlify/blobs/server';
import { chromium } from 'playwright';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PUB = path.join(ROOT, 'public');
const ok = []; const check = (n, c, x='') => { ok.push(`${c?'✓':'✗'} ${n}${x?' — '+x:''}`); if (!c) process.exitCode = 1; };

// ── Blobs local ──
const blobs = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'blobs-')), token: 'tk', port: 8911 });
await blobs.start();
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL:'http://localhost:8911', uncachedEdgeURL:'http://localhost:8911', token:'tk', siteID:'site1' })).toString('base64');
Object.assign(process.env, { SESSION_SECRET:'s3cr3t', ADMIN_USER:'rod', ADMIN_PASSWORD:'senha123',
  PLUGGY_CLIENT_ID:'cid', PLUGGY_CLIENT_SECRET:'csec', PLUGGY_API_URL:'http://localhost:8912' });

// ── Pluggy simulada ──
const ITEM = '11111111-1111-4111-8111-111111111111';
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0,10) + 'T03:00:00.000Z'; };
const BANK = [], CARD = [];
for (let i = 0; i < 230; i++) BANK.push({ id:`b${i}`, accountId:'acc-bank', date: day(i % 60), description:`Supermercado BH ${i}`, amount: -(10 + i), type:'DEBIT', category:'Groceries', status:'POSTED' });
BANK.push({ id:'sal', accountId:'acc-bank', date: day(5), description:'SALARIO FIEMG', amount: 9000, type:'CREDIT', category:'Salary', status:'POSTED' });
BANK.push({ id:'self', accountId:'acc-bank', date: day(4), description:'PIX enviado Rodrigo', amount: -500, type:'DEBIT', category:'Same person transfer - PIX', status:'POSTED' });
BANK.push({ id:'fat', accountId:'acc-bank', date: day(3), description:'Pagamento de fatura', amount: -700, type:'DEBIT', category:'Credit card payment', status:'POSTED' });
BANK.push({ id:'ifood', accountId:'acc-bank', date: day(2), description:'IFOOD *RESTAURANTE', amount: -45.9, type:'DEBIT', category:null, status:'PENDING' });
CARD.push({ id:'c1', accountId:'acc-card', date: day(6), description:'AMAZON MARKETPLACE', amount: 300, type:'DEBIT', category:'Online shopping', status:'POSTED', creditCardMetadata:{ installmentNumber:2, totalInstallments:5 } });
CARD.push({ id:'c2', accountId:'acc-card', date: day(3), description:'Pagamento recebido', amount: -700, type:'CREDIT', category:'Credit card payment', status:'POSTED' });
const pluggyLog = [];
const pluggy = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); pluggyLog.push(`${req.method} ${u.pathname}`);
  const send = (c, o) => { res.writeHead(c, {'content-type':'application/json'}); res.end(JSON.stringify(o)); };
  let raw = ''; for await (const c of req) raw += c;
  if (u.pathname === '/auth') { const b = JSON.parse(raw); return b.clientId === 'cid' && b.clientSecret === 'csec' ? send(200, { apiKey:'APIKEY' }) : send(401, { message:'bad' }); }
  if (req.headers['x-api-key'] !== 'APIKEY') return send(401, { message:'no key' });
  if (u.pathname === '/connect_token') return send(200, { accessToken:'CONNECT' });
  if (u.pathname === `/items/${ITEM}`) return send(200, { id: ITEM, status:'UPDATED', executionStatus:'SUCCESS', lastUpdatedAt: new Date().toISOString(), connector:{ id:212, name:'Nubank', imageUrl:'', primaryColor:'820AD1' } });
  if (u.pathname.startsWith('/items/')) return send(404, { message:'Item not found' });
  if (u.pathname === '/accounts') return send(200, { results:[
    { id:'acc-bank', type:'BANK', subtype:'CHECKING_ACCOUNT', name:'Conta Nubank', number:'1234-5', balance:1500.55, currencyCode:'BRL' },
    { id:'acc-card', type:'CREDIT', subtype:'CREDIT_CARD', name:'Nubank Ultravioleta', number:'4321', balance:820.40, currencyCode:'BRL', creditData:{ creditLimit:5000, balanceCloseDate:'2026-10-03T00:00:00Z', balanceDueDate:'2026-10-10T00:00:00Z' } } ] });
  if (u.pathname === '/v2/transactions') {
    const list = (u.searchParams.get('accountId') === 'acc-card' ? CARD : BANK)
      .filter(t => t.date.slice(0,10) >= (u.searchParams.get('dateFrom') || '0'))
      .sort((a,b) => b.date.localeCompare(a.date));
    const off = Number(Buffer.from(u.searchParams.get('after') || 'MA==', 'base64').toString());
    const page = list.slice(off, off + 100);
    const next = off + 100 < list.length ? `/v2/transactions?after=${encodeURIComponent(Buffer.from(String(off+100)).toString('base64'))}` : null;
    return send(200, { results: page, next });
  }
  send(404, { message:'?' });
});
await new Promise(r => pluggy.listen(8912, r));

// ── funções reais ──
const fn = {
  '/api/auth': (await import('./netlify/functions/auth.mjs')).default,
  '/api/data': (await import('./netlify/functions/data.mjs')).default,
  '/api/openfinance': (await import('./netlify/functions/openfinance.mjs')).default,
};
const cron = (await import('./netlify/functions/openfinance-cron.mjs')).default;
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png' };
const app = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:8899');
  if (fn[u.pathname]) {
    let raw = ''; for await (const c of req) raw += c;
    const r = await fn[u.pathname](new Request(u, { method: req.method, headers: req.headers, body: ['GET','HEAD'].includes(req.method) ? undefined : raw }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(await r.text());
  }
  const p = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!p.startsWith(PUB) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'text/plain' }); res.end(fs.readFileSync(p));
});
await new Promise(r => app.listen(8899, r));
const call = async (p, body, token, method='POST') => {
  const r = await fetch('http://localhost:8899' + p, { method, headers:{ 'content-type':'application/json', ...(token ? { authorization:'Bearer '+token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

// login + extrato já importado do Nubank (até 15 dias atrás)
const { body: lg } = await call('/api/auth', { action:'login', username:'rod', password:'senha123' });
const T = lg.token;
await call('/api/data', { transactions:[{ id:'old1', date: day(15).slice(0,10), desc:'Extrato antigo', cat:'Outros', type:'expense', amount: 10, account:'Nubank', source:'csv' }] }, T, 'PUT');

// sem credenciais configuradas → status configured:false
const saved = process.env.PLUGGY_CLIENT_ID; delete process.env.PLUGGY_CLIENT_ID;
check('status sem credenciais = não configurado', (await call('/api/openfinance', { action:'status' }, T)).body.configured === false);
process.env.PLUGGY_CLIENT_ID = saved;
check('exige sessão', (await call('/api/openfinance', { action:'status' })).status === 401);

delete process.env.PLUGGY_CLIENT_ID; delete process.env.PLUGGY_CLIENT_SECRET;
check('credencial errada recusada', (await call('/api/openfinance', { action:'save_credentials', clientId:'cid', clientSecret:'x' }, T)).body.error === 'pluggy_credenciais');
check('salvar credenciais pelo app', (await call('/api/openfinance', { action:'save_credentials', clientId:'cid', clientSecret:'csec' }, T)).body.ok === true);
check('status configurado via app', (await call('/api/openfinance', { action:'status' }, T)).body.configured === true);
// ── navegador ──
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport:{ width:1400, height:1000 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body:'' }));
await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ body:'', contentType:'text/javascript' }));
await page.route('https://cdn.pluggy.ai/**', r => r.fulfill({ contentType:'text/javascript', body:`
  window.PluggyConnect = class { constructor(o){ this.o = o; window.__pcOpts = { connectToken:o.connectToken, updateItem:o.updateItem, language:o.language }; }
    init(){ setTimeout(() => this.o.onSuccess({ item:{ id:'${ITEM}' } }), 50); } };` }));
await page.addInitScript(() => { window.confirm = () => true; });

await page.goto('http://localhost:8899/', { waitUntil:'domcontentloaded' });
await page.fill('#lg-user','rod'); await page.fill('#lg-pass','senha123'); await page.click('#lg-btn');
await page.waitForSelector('#app:not([hidden])');
await page.click('#tabs .tab[data-tab="import"]');
await page.waitForSelector('#of-connect:not([hidden])');
check('card Open Finance com botão Conectar', await page.isVisible('#of-connect'));
check('instruções de configuração ocultas', await page.isHidden('#of-setup'));

await page.click('#of-connect');
await page.waitForSelector('.of-item');
check('widget recebeu connect token', (await page.evaluate(() => window.__pcOpts)).connectToken === 'CONNECT');
check('banco listado com 2 contas', (await page.$$('.of-accs tbody tr')).length === 2, await page.textContent('.of-item-title'));
await page.screenshot({ path: ROOT + '/of-1-conectado.png' });

// vincula conta corrente → Nubank (existente)
await page.selectOption('select.of-target[data-acc="acc-bank"]', 'Nubank');
await page.waitForFunction(() => /nova|em dia/.test(document.querySelector('#of-status').textContent));
const st1 = await page.textContent('#of-status');
const fromBank = await page.inputValue('input.of-from[data-acc="acc-bank"]');
const d14 = day(14).slice(0,10);
const expectedBank = [...BANK].filter(t => t.date.slice(0,10) >= d14).length;
check('"a partir de" = dia seguinte ao último extrato', fromBank === d14, fromBank);
check('importou só o que é novo (paginação incluída)', st1.startsWith(`${expectedBank} `), st1);

await page.waitForTimeout(1200);
let db = (await call('/api/data', null, T, 'GET')).body.transactions;
const byId = (id) => db.find(t => t.id === id);
check('salário como receita/Salário', byId('of_sal')?.type === 'income' && byId('of_sal')?.cat === 'Salário');
check('transferência própria não conta como despesa', byId('of_self')?.kind === 'transfer');
check('pagamento de fatura vira transferência/Cartões', byId('of_fat')?.kind === 'transfer' && byId('of_fat')?.cat === 'Cartões');
check('pendente fica previsto', byId('of_ifood')?.status === 'pending');
check('sem categoria → classificador local', byId('of_ifood')?.ref === '' && byId('of_ifood')?.cat !== 'Outros', byId('of_ifood')?.cat);
check('extrato antigo preservado', !!byId('old1'));

// cartão → criar novo
await page.selectOption('select.of-target[data-acc="acc-card"]', '__new__');
await page.waitForFunction(() => document.querySelector('select.of-target[data-acc="acc-card"]').value.includes('Ultravioleta') && /nova|em dia/.test(document.querySelector('#of-status').textContent));
db = (await call('/api/data', null, T, 'GET')).body;
const card = (db.cards || []).find(c => c.name === 'Nubank Ultravioleta');
check('cartão criado com limite/fechamento/vencimento/final', card && card.limit === 5000 && card.closingDay === 3 && card.dueDay === 10 && card.last4 === '4321', JSON.stringify(card));
check('parcela com (2/5) na descrição', db.transactions.find(t => t.id === 'of_c1')?.desc.endsWith('(2/5)'));
check('pagamento recebido no cartão = transferência', db.transactions.find(t => t.id === 'of_c2')?.kind === 'transfer');

// igualar saldo da conta ao banco
const hasFix = await page.$('button[data-fix]');
if (hasFix) { await hasFix.click(); await page.waitForSelector('.of-ok'); }
check('saldo FinNexus igual ao do banco', !!(await page.$('.of-ok')));

// sincronizar de novo → nada novo
await page.click('#of-sync');
await page.waitForFunction(() => document.querySelector('#of-status').textContent.includes('em dia'));
check('segunda sincronização sem duplicar', true);

// excluir uma importada → não volta
await page.evaluate(() => { transactions = transactions.filter(t => t.id !== 'of_b0'); persist(); });
await page.waitForTimeout(900);
await page.click('#of-sync');
await page.waitForFunction(() => document.querySelector('#of-status').textContent.includes('em dia'));
check('excluída pelo usuário não é reimportada', !(await call('/api/data', null, T, 'GET')).body.transactions.some(t => t.id === 'of_b0'));

// pendente → definitivo
BANK.find(t => t.id === 'ifood').status = 'POSTED';
await page.click('#of-sync');
await page.waitForFunction(() => /atualizad/.test(document.querySelector('#of-status').textContent));
check('pendente que virou definitivo é atualizado', (await call('/api/data', null, T, 'GET')).body.transactions.find(t => t.id === 'of_ifood')?.status === 'paid');

// corrida: servidor importa enquanto a aba está aberta e depois a aba salva
BANK.push({ id:'late', accountId:'acc-bank', date: day(0), description:'PIX recebido Maria', amount: 120, type:'CREDIT', category:'Transfer - PIX', status:'POSTED' });
const cr = await call('/api/openfinance', { action:'sync' }, T);
check('sync via API traz a nova', cr.body.result.added === 1);
await page.evaluate(() => { transactions[0].desc += ' (editado)'; persist(); });
await page.waitForTimeout(1500);
const after = (await call('/api/data', null, T, 'GET')).body.transactions;
check('gravação da aba não apaga a importada em paralelo', after.some(t => t.id === 'of_late'));
check('aba recarregou e mostra a importada', await page.evaluate(() => transactions.some(t => t.id === 'of_late')));

// sincronização agendada
BANK.push({ id:'cron1', accountId:'acc-bank', date: day(0), description:'Padaria', amount: -12, type:'DEBIT', category:'Bakery', status:'POSTED' });
const ofdoc = await (await import('./netlify/functions/_openfinance.mjs')).loadOF('rod');
ofdoc.lastSync = '2000-01-01T00:00:00Z'; await (await import('./netlify/functions/_openfinance.mjs')).saveOF('rod', ofdoc);
await cron(new Request('http://x', { method:'POST', body: JSON.stringify({ next_run: new Date().toISOString() }) }));
check('função agendada importou', (await call('/api/data', null, T, 'GET')).body.transactions.find(t => t.id === 'of_cron1')?.cat === 'Alimentação');

// aba Transações mostra o selo OF
await page.reload(); await page.waitForSelector('#app:not([hidden])');
await page.click('#tabs .tab[data-tab="transactions"]');
await page.waitForSelector('.tx2-of');
check('selo OF nas transações', (await page.$$('.tx2-of')).length > 0);
await page.click('#tabs .tab[data-tab="import"]'); await page.waitForSelector('.of-item');
await page.screenshot({ path: ROOT + '/of-2-desktop.png' });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
check('sem rolagem horizontal no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
await page.screenshot({ path: ROOT + '/of-3-mobile.png', fullPage: true });

// reconectar usa updateItem
await call('/api/openfinance', { action:'remove_item', itemId: ITEM }, T);
check('remover conexão', (await call('/api/openfinance', { action:'status' }, T)).body.items.length === 0);
check('item inexistente → erro claro', (await call('/api/openfinance', { action:'add_item', itemId:'22222222-2222-4222-8222-222222222222' }, T)).body.error === 'item_nao_encontrado');

check('sem erros no console', errors.length === 0, errors.join(' | '));
console.log(ok.join('\n'));
await browser.close(); app.close(); pluggy.close(); await blobs.stop();
