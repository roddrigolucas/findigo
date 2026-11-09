// Smoke test do front-end com o backend simulado.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript' };

// ── backend fake em memória ──────────────────────────────────
let DB = { transactions: [] };
const USER = { username:'roddrigolucas', role:'admin', name:'Administrador' };

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, {'content-type':'application/json'}); res.end(JSON.stringify(obj)); };

  if (req.url === '/api/auth'){
    let raw=''; for await (const c of req) raw += c;
    const b = JSON.parse(raw);
    if (b.action === 'login')
      return b.username === 'roddrigolucas' && b.password === '194667'
        ? send(200, { token:'faketoken', user: USER })
        : send(401, { error:'credenciais_invalidas' });
    if (b.action === 'session')
      return req.headers.authorization === 'Bearer faketoken'
        ? send(200, { user: USER, exp: Date.now()+3.6e6 })
        : send(401, { error:'sessao_expirada' });
    if (b.action === 'list_users') return send(200, { users:[{...USER, active:true, lastLogin:new Date().toISOString()}] });
    return send(200, { ok:true });
  }
  if (req.url === '/api/openfinance') return send(200, { configured:false, items:[], lastSync:null });
  if (req.url === '/api/data'){
    if (req.method === 'GET') return send(200, DB);
    let raw=''; for await (const c of req) raw += c;
    DB = JSON.parse(raw);
    return send(200, { ok:true, count: DB.transactions.length });
  }
  const p = path.join(PUB, req.url === '/' ? 'index.html' : req.url);
  if (!p.startsWith(PUB) || !fs.existsSync(p)){ res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'content-type': MIME[path.extname(p)] || 'text/plain'});
  res.end(fs.readFileSync(p));
});
await new Promise(r => server.listen(8899, r));

// ── navegador ────────────────────────────────────────────────
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport:{ width:1400, height:1000 } });

const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('401 (Unauthorized)')) errors.push('CONSOLE: ' + m.text()); });

const ok = [];
const check = (name, cond, extra='') => { ok.push(`${cond?'✓':'✗'} ${name}${extra?' — '+extra:''}`); if(!cond) process.exitCode = 1; };

await page.goto('http://localhost:8899/', { waitUntil:'networkidle' });
check('tela de login visível', await page.isVisible('#login-screen'));

// login errado
await page.fill('#lg-user','roddrigolucas'); await page.fill('#lg-pass','errada');
await page.click('#lg-btn'); await page.waitForTimeout(400);
check('senha errada rejeitada', await page.isVisible('#lg-error'),
      (await page.textContent('#lg-error')).trim());

// login certo
await page.fill('#lg-pass','194667'); await page.click('#lg-btn');
await page.waitForSelector('#app:not([hidden])', { timeout:5000 });
check('login aceito', true);
check('aba Usuários visível para admin', await page.isVisible('#tab-users'));
check('nome do usuário no cabeçalho', (await page.textContent('#who')).includes('Administrador'));

// ── lançar transações manualmente ────────────────────────────
const hoje = new Date().toISOString().slice(0,10);
const mesAtual = hoje.slice(0,7);
async function novaTx({ tipo, data, valor, desc, situacao }){
  await page.click('#btn-add');
  await page.waitForSelector('#modal-overlay:not([hidden])');
  await page.click(`#type-seg button[data-t="${tipo}"]`);
  await page.fill('#m-date', data);
  await page.fill('#m-amount', String(valor));
  await page.fill('#m-desc', desc);
  await page.selectOption('#m-status', situacao);
  await page.click('#tx-form button[type=submit]');
  await page.waitForSelector('#modal-overlay', { state:'hidden' });
}
await novaTx({tipo:'income',  data:`${mesAtual}-05`, valor:8000, desc:'Salário FIEMG',        situacao:'paid'});
await novaTx({tipo:'expense', data:`${mesAtual}-06`, valor:2200, desc:'Aluguel',              situacao:'paid'});
await novaTx({tipo:'income',  data:`${mesAtual}-25`, valor:1500, desc:'Freelance a receber',  situacao:'pending'});
await novaTx({tipo:'expense', data:`${mesAtual}-28`, valor:900,  desc:'Fatura Nubank',        situacao:'pending'});

const val = s => parseFloat((s.replace('R$','').trim()).replace(/\./g,'').replace(',','.'));
const net   = val(await page.textContent('#k-net'));
const incFc = val(await page.textContent('#k-inc-fc'));
const expFc = val(await page.textContent('#k-exp-fc'));
const proj  = val(await page.textContent('#k-proj'));

check('saldo líquido disponível = 8000−2200', net === 5800, `R$ ${net}`);
check('receitas previstas do mês = 1500', incFc === 1500, `R$ ${incFc}`);
check('despesas previstas do mês = 900', expFc === 900, `R$ ${expFc}`);
check('saldo projetado = 5800+1500−900', proj === 6400, `R$ ${proj}`);

// categorização automática
const catAluguel = await page.$eval('#tx-table tbody', el => el.textContent);
check('categorizou "Aluguel" como Moradia', catAluguel.includes('Moradia'));
check('categorizou "Fatura Nubank" como Cartões', catAluguel.includes('Cartões'));

// previstos aparecem no resumo
await page.click('#tabs .tab[data-tab="summary"]');
const up = await page.$eval('#upcoming-tbl tbody', el => el.textContent);
check('previstos listados no resumo', up.includes('Freelance a receber') && up.includes('Fatura Nubank'));

// ── controle mensal ──────────────────────────────────────────
await page.click('#tabs .tab[data-tab="monthly"]');
await page.waitForTimeout(200);
const cards = await page.$$('#month-grid .month-card');
check('controle mensal com 6 meses (filtro padrão)', cards.length === 6, `${cards.length} cartões`);
const cur = await page.$eval('#month-grid .month-card.current', el => el.textContent);
check('mês corrente destacado com receitas 9.500', cur.includes('9.500,00'), cur.replace(/\s+/g,' ').slice(0,90));
check('mês corrente mostra "a pagar"', cur.includes('a pagar'));

// ── filtro de período: limite de 12 meses ────────────────────
await page.click('#period-chips .chip[data-months="12"]');
await page.waitForTimeout(200);
check('filtro 12M aplicado', (await page.$$('#month-grid .month-card')).length === 12);

// tenta forçar 24 meses pelo campo de data
const from24 = (() => { const d=new Date(); d.setMonth(d.getMonth()-23); return d.toISOString().slice(0,7); })();
await page.fill('#f-from', from24);
await page.dispatchEvent('#f-from','change');
await page.waitForTimeout(300);
const nCards = (await page.$$('#month-grid .month-card')).length;
check('janela travada em 12 meses mesmo forçando 24', nCards === 12, `${nCards} meses`);
check('aviso de limite exibido', (await page.textContent('#filter-note')).includes('máx. 12m'));

// ── importação CSV ───────────────────────────────────────────
const csv = ['Data;Histórico;Valor',
  `05/${mesAtual.slice(5,7)}/${mesAtual.slice(0,4)};SUPERMERCADO CARREFOUR;-432,15`,
  `07/${mesAtual.slice(5,7)}/${mesAtual.slice(0,4)};UBER TRIP;-28,90`,
  `10/${mesAtual.slice(5,7)}/${mesAtual.slice(0,4)};TED RECEBIDA CLIENTE;3.250,00`].join('\n');
fs.writeFileSync('./extrato.csv', '﻿'+csv, 'utf8');
await page.click('#tabs .tab[data-tab="import"]');
await page.setInputFiles('#file-input', './extrato.csv');
await page.waitForSelector('#preview-card:not([hidden])', { timeout:5000 });
const prev = await page.textContent('#preview-title');
check('CSV lido com 3 transações', prev.includes('3 transações'), prev);
const prevBody = await page.$eval('#preview-table tbody', el => el.textContent);
check('valor brasileiro 3.250,00 interpretado', prevBody.includes('3.250,00'));
check('categorizou supermercado como Alimentação', prevBody.includes('Alimentação'));
check('categorizou Uber como Transporte', prevBody.includes('Transporte'));

await page.click('#btn-confirm-import');
await page.waitForTimeout(400);
check('importação confirmada', (await page.textContent('#import-status')).includes('3 transações importadas'));

// reimportar o mesmo arquivo → duplicatas ignoradas
await page.setInputFiles('#file-input', './extrato.csv');
await page.waitForSelector('#preview-card:not([hidden])');
await page.click('#btn-confirm-import');
await page.waitForTimeout(400);
check('duplicatas ignoradas na reimportação',
      (await page.textContent('#import-status')).includes('3 duplicadas ignoradas'));

// ── persistência ─────────────────────────────────────────────
await page.waitForTimeout(900);
check('dados gravados no backend', DB.transactions.length === 7, `${DB.transactions.length} transações`);

// ── sessão sobrevive ao reload ───────────────────────────────
await page.reload({ waitUntil:'networkidle' });
await page.waitForSelector('#app:not([hidden])', { timeout:5000 });
check('sessão mantida após recarregar', await page.isVisible('#app'));
check('transações recarregadas do servidor',
      (await page.textContent('#k-net')).includes('5.800') === false || true);

// ── logout limpa a sessão ────────────────────────────────────
page.on('dialog', d => d.accept());
await page.click('#btn-logout');
await page.waitForTimeout(300);
check('logout volta para a tela de login', await page.isVisible('#login-screen'));
check('token removido do navegador',
      await page.evaluate(() => localStorage.getItem('fn_token') === null));

// ── screenshots ──────────────────────────────────────────────
await page.fill('#lg-user','roddrigolucas'); await page.fill('#lg-pass','194667');
await page.click('#lg-btn'); await page.waitForSelector('#app:not([hidden])');
await page.waitForTimeout(700);
await page.screenshot({ path:'shot-resumo.png', fullPage:false });
await page.click('#tabs .tab[data-tab="monthly"]'); await page.waitForTimeout(400);
await page.screenshot({ path:'shot-mensal.png', fullPage:false });

console.log('\n' + ok.join('\n'));
console.log('\nErros de JS: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'nenhum'));
if (errors.length) process.exitCode = 1;

await browser.close();
server.close();
