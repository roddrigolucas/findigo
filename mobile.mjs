import { chromium, devices } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const PUB=path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/manifest+json','.png':'image/png'};
let DB={transactions:[]};
const USER={username:'roddrigolucas',role:'admin',name:'Administrador'};
const srv=http.createServer(async(req,res)=>{
  const send=(c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o));};
  const u=req.url.split('?')[0];
  if(u==='/api/auth'){let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);
    if(b.action==='login')return b.password==='194667'?send(200,{token:'t',user:USER}):send(401,{error:'credenciais_invalidas'});
    if(b.action==='session')return req.headers.authorization==='Bearer t'?send(200,{user:USER,exp:Date.now()+3.6e6}):send(401,{error:'sessao_expirada'});
    return send(200,{ok:true,users:[{...USER,active:true}]});}
  if(u==='/api/data'){if(req.method==='GET')return send(200,DB);let raw='';for await(const c of req)raw+=c;DB=JSON.parse(raw);return send(200,{ok:true});}
  const p=path.join(PUB,u==='/'?'index.html':u);
  if(!p.startsWith(PUB)||!fs.existsSync(p)){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'content-type':MIME[path.extname(p)]||'text/plain'});res.end(fs.readFileSync(p));
});
await new Promise(r=>srv.listen(8898,r));

const browser=await chromium.launch();
// Xiaomi 14: ~1200x2670 físico, ~393x852 CSS @3x
const ctx=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:devices['Pixel 7'].userAgent});
const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://localhost:8898/',{waitUntil:'networkidle'});
await page.screenshot({path:'m-login.png'});

// manifesto acessível e válido
const man=await page.evaluate(async()=>{const r=await fetch('/manifest.json');return r.ok?await r.json():null;});
console.log('manifest:', man ? `${man.name} · display=${man.display} · ${man.icons.length} ícones` : 'FALHOU');
const icon=await page.evaluate(async()=>{const r=await fetch('/icon-512.png');return r.ok&&r.headers.get('content-type');});
console.log('ícone 512:', icon);

await page.fill('#lg-user','roddrigolucas'); await page.fill('#lg-pass','194667');
await page.tap('#lg-btn'); await page.waitForSelector('#app:not([hidden])');

// lançar via toque
await page.tap('#btn-add'); await page.waitForSelector('#modal-overlay:not([hidden])');
await page.screenshot({path:'m-modal.png'});
const hoje=new Date().toISOString().slice(0,10);
await page.fill('#m-date',hoje); await page.fill('#m-amount','4200'); await page.fill('#m-desc','Salário');
await page.click('#type-seg button[data-t="income"]');
await page.click('#tx-form button[type=submit]'); await page.waitForSelector('#modal-overlay',{state:'hidden'});
await page.tap('#btn-add'); await page.waitForSelector('#modal-overlay:not([hidden])');
await page.fill('#m-date',hoje); await page.fill('#m-amount','1350'); await page.fill('#m-desc','Aluguel');
await page.selectOption('#m-status','pending');
await page.click('#tx-form button[type=submit]'); await page.waitForSelector('#modal-overlay',{state:'hidden'});
await page.waitForTimeout(600);
await page.screenshot({path:'m-resumo.png'});
// filtros recolhidos por padrão no celular?
const fgVis=await page.isVisible('#f-cat');
console.log('filtros recolhidos ao abrir:', fgVis?'✗ visíveis':'✓ recolhidos');
console.log('resumo no botão:', (await page.textContent('#filter-toggle-txt')).trim());
await page.tap('#filter-toggle'); await page.waitForTimeout(250);
console.log('abrem ao tocar:', await page.isVisible('#f-cat')?'✓':'✗');
await page.screenshot({path:'m-filtros.png'});
await page.tap('#filter-toggle'); await page.waitForTimeout(250);
await page.tap('#tabs .tab[data-tab="monthly"]'); await page.waitForTimeout(400);
await page.screenshot({path:'m-mensal.png'});

// sem rolagem horizontal?
const over=await page.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log('estouro horizontal:', over+'px', over<=1?'✓':'✗ PROBLEMA');
// fontes dos inputs (evitar zoom no foco)
const fs2=await page.evaluate(()=>getComputedStyle(document.querySelector('#f-cat')).fontSize);
console.log('fonte do filtro:', fs2);
console.log('erros JS:', errs.length?errs:'nenhum');
await browser.close(); srv.close();
