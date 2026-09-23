// ── Categorização automática + parsers de extrato (CSV / XLSX / OFX / PDF)
// Auto-categorization rules
const CAT_RULES = [
  {r:/salário|salario|vencimento|fiemg|lemontech|folha|pagamento\s*emp/i, c:'Salário'},
  {r:/freelance|autônom|mei\s+receit|pj\s+receit|honorário/i, c:'Freelance/Negócios'},
  {r:/dividendo|rendiment|invest|cdb|lci|lca|tesouro|poupança.*receit/i, c:'Investimentos'},
  {r:/poupança|reserva|guardar/i, c:'Poupança'},
  {r:/cartão|cartao|fatura|nubank|mercado\s*pago|brasilcard|bmg|basil\s*card/i, c:'Cartões'},
  {r:/supermercado|mercado|padaria|açougue|hortifruti|ifood|rappi|deliveroo|uber\s*eat|pao\s*de\s*açucar|extra|carrefour|walmart/i, c:'Alimentação'},
  {r:/restaurante|lanchonete|pizzaria|hamburgue|sushi|bar\s+e|café|lanche/i, c:'Alimentação'},
  {r:/aluguel|condomínio|condominio|iptu|agua\s|energia\s|luz\s|enel|cemig|copasa|gás\s|gas\s|comgas/i, c:'Moradia'},
  {r:/reparo|reforma|construção|material\s+construção|casa\s+|(imóvel|imovel)/i, c:'Moradia'},
  {r:/uber|99app|taxi|gasolina|combustível|shell|postos|ônibus|metrô|metro|bilhete\s+ún|estacionamento|pedágio|detran|ipva|seguro\s+(auto|veículo|carro)/i, c:'Transporte'},
  {r:/farmácia|farmacia|drogaria|droga|remédio|remedio|consulta|médico|medico|dentista|plano\s+saúde|hospital|laboratório|exame|fisio|psico/i, c:'Saúde'},
  {r:/academia|pilates|yoga|ginástica|esporte/i, c:'Saúde'},
  {r:/faculdade|universidade|escola|curso|aula|mensalidade|matrícula|livros?|mba|pós\s*grad|pos\s*grad|chatgpt|claude|openai/i, c:'Educação'},
  {r:/netflix|spotify|disney|amazon\s*prime|hbo|paramount|globoplay|apple\s*tv|deezer|youtube|prime\s*video/i, c:'Assinaturas'},
  {r:/claro|tim|vivo|oi\s+|internet|banda\s+larg|telefone|celular/i, c:'Telecomunicações'},
  {r:/ração|pet|banho\s+tosa|veterinário|veterinario|cachorro|gato|pet\s*shop/i, c:'Pets'},
  {r:/hotel|airbnb|passagem|voo|viagem|turismo|hostel|booking/i, c:'Viagens'},
  {r:/cinema|teatro|show|ingresso|parque|diversão|lazer|entretenimento/i, c:'Entretenimento'},
  {r:/empréstimo|emprestimo|parcela|acordo|recovery|divida|dívida|puc\s+\d|finan|débito|debito\s+auto/i, c:'Dívidas'},
  {r:/imposto|das\s+mei|irrf|ir\s+renda|taxa|multa/i, c:'Impostos'},
  {r:/transf|pix/i, c:'Transferências'},
  {r:/compras?|shopping|loja|magazine|amazon|americanas|submarino|casas\s+bahia|extra\s+eletro/i, c:'Compras'},
];

// ─────────────────────────────────────────────────────────────────
// INTELIGÊNCIA ARTIFICIAL (NAIVE BAYES)
// ─────────────────────────────────────────────────────────────────
let bayesModel = { wordsByCat: {}, catCounts: {}, totalDocs: 0 };

function trainBayes(transactions) {
  const wordsByCat = {};
  const catCounts = {};
  let totalDocs = 0;
  
  transactions.forEach(tx => {
    if (!tx.cat) return;
    totalDocs++;
    if (!wordsByCat[tx.cat]) { wordsByCat[tx.cat] = {}; catCounts[tx.cat] = 0; }
    catCounts[tx.cat]++;
    
    const words = String(tx.desc).toLowerCase().split(/[\W_]+/).filter(w => w.length > 2 && isNaN(w));
    words.forEach(w => {
      wordsByCat[tx.cat][w] = (wordsByCat[tx.cat][w] || 0) + 1;
    });
  });
  
  bayesModel = { wordsByCat, catCounts, totalDocs };
}

function predictCategory(desc, type) {
  const d = String(desc).toLowerCase();
  
  // 1. Tenta regras estáticas primeiro
  for (const rule of CAT_RULES) {
    if (rule.r.test(d)) {
      const cat = rule.c;
      if (typeof INCOME_CATS !== 'undefined') {
        if (type === 'income' && INCOME_CATS.includes(cat)) return cat;
        if (type === 'income' && !INCOME_CATS.includes(cat)) continue;
      }
      if (type === 'expense') return cat;
    }
  }
  
  // 2. Fallback para IA Bayesiana
  if (bayesModel.totalDocs === 0) {
    return type === 'income' ? 'Outros Rendimentos' : 'Outros';
  }
  
  const words = d.split(/[\W_]+/).filter(w => w.length > 2 && isNaN(w));
  let bestCat = type === 'income' ? 'Outros Rendimentos' : 'Outros';
  let bestScore = -Infinity;
  const V = 1000;
  
  for (const cat in bayesModel.catCounts) {
    if (typeof INCOME_CATS !== 'undefined') {
      if (type === 'income' && !INCOME_CATS.includes(cat)) continue;
      if (type === 'expense' && INCOME_CATS.includes(cat)) continue;
    }
    
    let score = Math.log(bayesModel.catCounts[cat] / bayesModel.totalDocs);
    const catWords = bayesModel.wordsByCat[cat] || {};
    const totalWordsInCat = Object.values(catWords).reduce((a,b) => a+b, 0);
    
    words.forEach(w => {
      const count = catWords[w] || 0;
      score += Math.log((count + 1) / (totalWordsInCat + V));
    });
    
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }
  
  return bestCat;
}

function categorize(desc, type) {
  return predictCategory(desc, type);
}

// ─────────────────────────────────────────────────────────────────
// KEYWORDS FOR COLUMN MAPPING
// ─────────────────────────────────────────────────────────────────
const DATE_KW = ['data','date','dt','dia','datum','fecha'];
const DESC_KW = ['desc','hist','titulo','título','memo','lanc','transaction','detail','label','name','estabelecimento'];
const AMT_KW  = ['valor','value','amount','total','montante','importe'];
const CRD_KW  = ['cred','credit','entrada','income','receita','in'];
const DBT_KW  = ['deb','debit','saída','saida','expense','despesa','out'];

function deaccent(s){ return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

function findHeaderRow(allRows) {
  let bestIdx = 0;
  let maxScore = -1;
  for(let i=0; i<Math.min(allRows.length, 25); i++) {
    const row = allRows[i];
    let score = row.length;
    const norm = row.map(c => deaccent(String(c).toLowerCase().trim()));
    if(norm.some(c => DATE_KW.some(k => c.includes(k)))) score += 10;
    if(norm.some(c => DESC_KW.some(k => c.includes(k)))) score += 10;
    if(norm.some(c => AMT_KW.some(k => c.includes(k)))) score += 10;
    if(score > maxScore) { maxScore = score; bestIdx = i; }
  }
  return bestIdx;
}

// ─────────────────────────────────────────────────────────────────
// CSV PARSER
// ─────────────────────────────────────────────────────────────────
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).slice(0, 15);
  const counts = {',':0, ';':0, '\t':0, '|':0};
  lines.forEach(line => {
    let inQ = false;
    for (const c of line.slice(0,500)) {
      if (c === '"') inQ = !inQ;
      if (!inQ && counts[c] !== undefined) counts[c]++;
    }
  });
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
}

function parseCSVLine(line, delim) {
  const cells=[]; let cur='', inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
    else if(c===delim&&!inQ){cells.push(cur.trim());cur='';}
    else cur+=c;
  }
  cells.push(cur.trim()); return cells;
}

function parseCSVText(text) {
  // Remove BOM
  if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
  const delim=detectDelimiter(text);
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2) return {headers:[],rows:[]};
  const allRows = lines.map(l => parseCSVLine(l, delim));
  const bestIdx = findHeaderRow(allRows);
  const headers = allRows[bestIdx].map(h=>h.toLowerCase().trim().replace(/['"]/g,''));
  const rows = allRows.slice(bestIdx+1).filter(cells=>cells.some(v=>String(v).trim()));
  return {headers,rows};
}

function parseBRDate(s) {
  s=String(s).trim();
  // ISO
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  // DD/MM/YYYY or DD-MM-YYYY
  const m=s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if(m){ const y=m[3].length===2?'20'+m[3]:m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  // Try JS Date
  const d=new Date(s); if(!isNaN(d)) return d.toISOString().split('T')[0];
  return null;
}

function parseBRNumber(s) {
  s=String(s).trim().replace(/[R$\s]/g,'');
  if(!s||s==='-'||s==='0'||s.toLowerCase()==='null') return 0;
  // 1.234,56 → 1234.56
  if(/\d\.\d{3},\d/.test(s)) s=s.replace(/\./g,'').replace(',','.');
  // 1,234.56 → 1234.56
  else if(/\d,\d{3}\.\d/.test(s)) s=s.replace(/,/g,'');
  // 1.234 (no decimal sep) → 1234
  else if(/^\d{1,3}(\.\d{3})+$/.test(s)) s=s.replace(/\./g,'');
  // 1234,56 → 1234.56
  else s=s.replace(',','.');
  return parseFloat(s)||0;
}

// matchKW and detectMapping
function matchKW(header, kws) {
  const h = deaccent(header);
  return kws.some(k => h.includes(deaccent(k)));
}

function detectMapping(headers) {
  const map={date:null,desc:null,amount:null,credit:null,debit:null};
  headers.forEach((h,i)=>{
    const lh=String(h).toLowerCase();
    if(!map.date&&matchKW(lh,DATE_KW)) map.date=i;
    else if(!map.desc&&matchKW(lh,DESC_KW)) map.desc=i;
    else if(!map.credit&&matchKW(lh,CRD_KW)) map.credit=i;
    else if(!map.debit&&matchKW(lh,DBT_KW)) map.debit=i;
    else if(!map.amount&&matchKW(lh,AMT_KW)) map.amount=i;
  });
  // Fallback guesses
  if(map.date===null) map.date=0;
  if(map.desc===null) map.desc=map.date===1?0:1;
  if(map.amount===null&&map.credit===null&&map.debit===null) {
    // last numeric column
    map.amount=headers.length-1;
  }
  return map;
}

function rowsToTransactions(rows, headers) {
  const map=detectMapping(headers);
  const out=[];
  rows.forEach(row=>{
    const cells=Array.isArray(row)?row:headers.map(h=>row[h]||'');
    const dateStr=cells[map.date];
    const date=parseBRDate(dateStr);
    if(!date) return;

    const desc=String(cells[map.desc]||'').trim();
    if(!desc) return;

    let amount=0, type='expense';
    if(map.amount!==null&&map.credit===null){
      amount=parseBRNumber(cells[map.amount]);
      type=amount>=0?'income':'expense';
      amount=Math.abs(amount);
    } else if(map.credit!==null) {
      const crd=parseBRNumber(cells[map.credit]);
      const dbt=parseBRNumber(cells[map.debit]);
      if(crd>0){amount=crd;type='income';}
      else if(dbt>0){amount=dbt;type='expense';}
      else return;
    }
    if(amount<=0) return;

    const cat=categorize(desc,type);
    out.push({id:uid(), date, desc, cat, type, amount, account:''});
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────
// XLSX PARSER
// ─────────────────────────────────────────────────────────────────
async function decompressDeflate(data) {
  const ds=new DecompressionStream('deflate-raw');
  const writer=ds.writable.getWriter();
  const reader=ds.readable.getReader();
  writer.write(data); writer.close();
  const chunks=[]; while(true){ const{value,done}=await reader.read(); if(done)break; if(value)chunks.push(value); }
  const total=chunks.reduce((a,b)=>a+b.length,0);
  const result=new Uint8Array(total); let pos=0;
  for(const c of chunks){result.set(c,pos);pos+=c.length;}
  return result;
}

async function parseZIP(buffer) {
  const bytes=new Uint8Array(buffer), view=new DataView(buffer);
  const entries={};
  // Find End of Central Directory
  let eocd=-1;
  for(let i=bytes.length-22;i>=0;i--){ if(view.getUint32(i,true)===0x06054b50){eocd=i;break;} }
  if(eocd===-1) throw new Error('Not a ZIP');
  const cdCount=view.getUint16(eocd+10,true), cdOffset=view.getUint32(eocd+16,true);
  let pos=cdOffset;
  for(let e=0;e<cdCount;e++){
    if(view.getUint32(pos,true)!==0x02014b50) break;
    const comp=view.getUint16(pos+10,true);
    const compSz=view.getUint32(pos+20,true), uncompSz=view.getUint32(pos+24,true);
    const fnLen=view.getUint16(pos+28,true), exLen=view.getUint16(pos+30,true), cmLen=view.getUint16(pos+32,true);
    const lhOff=view.getUint32(pos+42,true);
    const name=new TextDecoder().decode(bytes.slice(pos+46,pos+46+fnLen));
    const lhExLen=view.getUint16(lhOff+28,true), lhFnLen=view.getUint16(lhOff+26,true);
    const dataOff=lhOff+30+lhFnLen+lhExLen;
    if(comp===0){
      entries[name]=new TextDecoder('utf-8').decode(bytes.slice(dataOff,dataOff+uncompSz));
    } else if(comp===8){
      try{
        const dec=await decompressDeflate(bytes.slice(dataOff,dataOff+compSz));
        entries[name]=new TextDecoder('utf-8').decode(dec);
      }catch(e){}
    }
    pos+=46+fnLen+exLen+cmLen;
  }
  return entries;
}

function excelDateToISO(serial) {
  // Excel serial: days since Jan 1, 1900 (with leap year bug at 1900)
  const d=new Date(Math.round((serial-25569)*86400*1000));
  return d.toISOString().split('T')[0];
}

async function parseXLSX(buffer) {
  const entries=await parseZIP(buffer);
  // Shared strings
  let ss=[];
  const ssKey=Object.keys(entries).find(k=>/sharedStrings\.xml$/i.test(k));
  if(ssKey){
    const doc=new DOMParser().parseFromString(entries[ssKey],'text/xml');
    ss=Array.from(doc.querySelectorAll('si')).map(si=>Array.from(si.querySelectorAll('t')).map(t=>t.textContent).join(''));
  }
  // Sheet
  const shKey=Object.keys(entries).find(k=>/worksheets\/sheet1?\.xml$/i.test(k))||Object.keys(entries).find(k=>/worksheets\//.test(k));
  if(!shKey) throw new Error('No sheet found');
  const doc=new DOMParser().parseFromString(entries[shKey],'text/xml');
  const rowMap={};
  doc.querySelectorAll('row').forEach(row=>{
    const rn=parseInt(row.getAttribute('r')||'0')-1;
    rowMap[rn]={};
    row.querySelectorAll('c').forEach(cell=>{
      const ref=cell.getAttribute('r');
      if(!ref) return;
      const col=ref.replace(/\d/g,'');
      const t=cell.getAttribute('t');
      const vEl=cell.querySelector('v');
      const iEl=cell.querySelector('is>t');
      let val='';
      if(iEl) val=iEl.textContent;
      else if(vEl){
        if(t==='s') val=ss[parseInt(vEl.textContent)]||'';
        else if(t==='str'||t==='b') val=vEl.textContent;
        else {
          const num=parseFloat(vEl.textContent);
          // Detect date: serial between ~35000 (1996) and ~65000 (2078)
          if(num>35000&&num<65000&&!t) val=excelDateToISO(num);
          else val=vEl.textContent;
        }
      }
      // Column letter to index
      let ci=0; for(const c of col) ci=ci*26+(c.charCodeAt(0)-64); ci--;
      rowMap[rn][ci]=val;
    });
  });
  const rNums=Object.keys(rowMap).map(Number).sort((a,b)=>a-b);
  if(!rNums.length) return{headers:[],rows:[]};
  const maxCol=Math.max(...rNums.flatMap(n=>Object.keys(rowMap[n]).map(Number)));
  const toArr=rn=>{ const a=[]; for(let i=0;i<=maxCol;i++) a.push(rowMap[rn][i]||''); return a; };
  const allRows = rNums.map(toArr);
  const bestIdx = findHeaderRow(allRows);
  const headers = allRows[bestIdx];
  const rows = allRows.slice(bestIdx+1);
  return{headers,rows};
}

// ─────────────────────────────────────────────────────────────────
// OFX PARSER
// ─────────────────────────────────────────────────────────────────
function parseOFX(text) {
  const txs=[];
  const re=/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m;
  while((m=re.exec(text))!==null){
    const blk=m[1];
    const get=tag=>{const r=new RegExp(`<${tag}>([^<]+)`,'i');const mm=r.exec(blk);return mm?mm[1].trim():''};
    const dtRaw=get('DTPOSTED')||get('DTUSER');
    const date=dtRaw?dtRaw.slice(0,4)+'-'+dtRaw.slice(4,6)+'-'+dtRaw.slice(6,8):null;
    if(!date) continue;
    const amtRaw=parseFloat(get('TRNAMT'))||0;
    const desc=(get('NAME')||get('MEMO')||'').replace(/&amp;/g,'&').trim();
    if(!desc||!amtRaw) continue;
    const amount=Math.abs(amtRaw);
    const type=amtRaw>0?'income':'expense';
    txs.push({id:uid(),date,desc,cat:categorize(desc,type),type,amount,account:''});
  }
  return txs;
}

function cleanDesc(desc) {
  desc = desc.replace(/"/g, ''); 
  desc = desc.replace(/Cp\s*:\d+-?/ig, '');
  desc = desc.replace(/\d{5}\s+\d{5,15}\s+/g, '');
  desc = desc.replace(/-\s*•••\.\d{3}\.\d{3}-••/g, ''); 
  desc = desc.replace(/-\s*\d{2}\.\d{3}\.\d{3}/g, '');
  return desc.trim();
}

function parsePlainText(text){
  const out = [];
  const lines = text.split(/[\r\n]+/);
  
  const reTrad = /^(\d{2}[\/.-]\d{2}(?:[\/.-]\d{2,4})?)\s+(.{3,120}?)\s+(-?R?\$?\s?[\d.]{1,12},\d{2})\s*$/;
  const reDateHeader = /^(\d{1,2})\s+de\s+([a-zA-ZçÇ]+)\s+de\s+(\d{4})/i;
  const reNuDateHeader = /^(\d{2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})/i;
  
  const monthMap = { 'janeiro':'01', 'fevereiro':'02', 'março':'03', 'marco':'03', 'abril':'04', 'maio':'05', 'junho':'06', 'julho':'07', 'agosto':'08', 'setembro':'09', 'outubro':'10', 'novembro':'11', 'dezembro':'12' };
  const nuMap = {jan:'01',fev:'02',mar:'03',abr:'04',mai:'05',jun:'06',jul:'07',ago:'08',set:'09',out:'10',nov:'11',dez:'12'};

  let currentDate = null;
  let pendingDesc = '';
  let nuType = null;

  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    if (/^SAC|Fale com a gente|Tem alguma dúvida/i.test(line)) return;

    // Check Inter date header
    const dMatch = line.match(reDateHeader);
    if (dMatch) {
      const d = dMatch[1].padStart(2, '0');
      const m = monthMap[dMatch[2].toLowerCase()];
      const y = dMatch[3];
      if (m) { currentDate = `${y}-${m}-${d}`; pendingDesc = ''; nuType = null; }
      return;
    }

    // Check Nubank date header
    const nuDateMatch = line.match(reNuDateHeader);
    if (nuDateMatch) {
      const d = nuDateMatch[1].padStart(2, '0');
      const m = nuMap[nuDateMatch[2].toLowerCase()];
      const y = nuDateMatch[3];
      if (m) { currentDate = `${y}-${m}-${d}`; pendingDesc = ''; }
      if (line.toLowerCase().includes('entradas')) nuType = 'income';
      if (line.toLowerCase().includes('saídas') || line.toLowerCase().includes('saidas')) nuType = 'expense';
      return;
    }

    // Nubank section toggles
    if (line.toLowerCase().includes('total de entradas')) { nuType = 'income'; return; }
    if (line.toLowerCase().includes('total de saídas') || line.toLowerCase().includes('total de saidas')) { nuType = 'expense'; return; }

    // Try traditional inline date
    const tradMatch = line.match(reTrad);
    if (tradMatch) {
      const date = parseBRDate(tradMatch[1]);
      if (!date) return;
      const desc = tradMatch[2].trim();
      let amount = parseBRNumber(tradMatch[3]);
      const type = amount >= 0 ? 'income' : 'expense';
      amount = Math.abs(amount);
      if (amount) out.push({ id: uid(), date, desc, cat: categorize(desc, type), type, amount, account:'', status:'paid' });
      return;
    }

    // Try block transaction
    if (currentDate) {
      const interMatch = line.match(/^(.*?)\s*(-?R?\$\s*[\d.]{1,12},\d{2})(?:\s+-?R?\$\s*[\d.]{1,12},\d{2})?\s*$/);
      const nuMatch = line.match(/^(.*?)\s+((?:\d{1,3}\.)*\d{1,3},\d{2})\s*$/);

      if (interMatch && interMatch[2]) {
        let desc = (pendingDesc + ' ' + interMatch[1]).trim();
        desc = cleanDesc(desc);
        if (desc.toLowerCase().startsWith('saldo') || desc.toLowerCase().includes('saldo do dia')) {
          pendingDesc = ''; return;
        }

        let amount = parseBRNumber(interMatch[2]);
        const type = amount >= 0 ? 'income' : 'expense';
        amount = Math.abs(amount);
        if (amount) out.push({ id: uid(), date: currentDate, desc: desc||'Transação', cat: categorize(desc, type), type, amount, account:'', status:'paid' });
        
        pendingDesc = '';
      } 
      else if (nuMatch && nuType && pendingDesc === '') {
        let desc = nuMatch[1].trim();
        desc = cleanDesc(desc);
        if (desc.toLowerCase().startsWith('saldo') || desc.toLowerCase().includes('total')) {
          return;
        }
        
        let amount = parseBRNumber(nuMatch[2]);
        amount = Math.abs(amount);
        if (amount > 0) {
          out.push({ id: uid(), date: currentDate, desc: desc||'Transação', cat: categorize(desc, nuType), type: nuType, amount, account:'', status:'paid' });
        }
        pendingDesc = ''; 
      }
      else {
        pendingDesc += ' ' + line;
      }
    }
  });

  return out;
}

// ─────────────────────────────────────────────────────────────────
// PDF TEXT EXTRACTION (pdf.js)
// ─────────────────────────────────────────────────────────────────
async function extractPDFText(buffer) {
  if (!window.pdfjsLib) throw new Error('PDF.js não carregado. Verifique sua conexão com a internet ou faça Ctrl+F5.');
  
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  
  const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(buffer)});
  const pdf = await loadingTask.promise;
  let fullText = '';
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    
    const lines = {};
    content.items.forEach(item => {
      const y = Math.round(item.transform[5] / 5) * 5;
      if (!lines[y]) lines[y] = [];
      lines[y].push(item);
    });
    
    const sortedY = Object.keys(lines).map(Number).sort((a,b) => b - a);
    
    sortedY.forEach(y => {
      const lineItems = lines[y].sort((a,b) => a.transform[4] - b.transform[4]);
      fullText += lineItems.map(i => i.str).join(' ') + '\n';
    });
  }
  return fullText;
}

