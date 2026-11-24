import { parseCode, parseSefazPage, readCupom } from './netlify/functions/_nfce.mjs';
const ch = '31' + '2611' + '17176561000149' + '65' + '001' + '000003855' + '1' + '00003941' + '0';
const ok = (n, c, x='') => console.log(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`);
let r = parseCode(`https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml?p=${ch}|2|1|1|ABCDEF0123`);
ok('online 2.0', r && r.chave === ch && r.uf === 'MG' && r.ym === '2026-11' && r.cnpj === '17176561000149' && !r.amount, JSON.stringify(r).slice(0,160));
r = parseCode(`http://www.fazenda.pr.gov.br/nfce/qrcode?p=${ch}|2|1|24|152.37|6A6B|1|ABCD`);
ok('offline 2.0 (dia+valor)', r && r.day === '24' && r.amount === 152.37);
const dh = Buffer.from('2026-11-20T14:20:11-03:00').toString('hex');
r = parseCode(`https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx?chNFe=${ch}&nVersao=100&tpAmb=1&dhEmi=${dh}&vNF=49.27&vICMS=0`);
ok('1.0 (vNF+dhEmi hex)', r && r.amount === 49.27 && r.date === '2026-11-20');
const sat = '35' + '2611' + '17176561000149' + '59' + '900000001' + '000123' + '123456' + '7';
r = parseCode(`${sat}|20261123183011|87.90||assinaturaBase64==`);
ok('CF-e SAT', r && r.modelo === '59' && r.amount === 87.9 && r.date === '2026-11-23', JSON.stringify(r).slice(0,120));
r = parseCode(ch.replace(/(\d{4})/g, '$1 '));
ok('código de barras / chave com espaços', r && r.chave === ch && !r.url);
ok('inválido', parseCode('7891234567895') === null && parseCode('https://example.com') === null);
const html = `<html><body><div id="u20" class="txtTopo">SUPERMERCADOS BH COMERCIO DE ALIMENTOS S/A</div>
<div class="text">CNPJ: 04.641.376/0001-36</div>
<table id="tabResult"><tr id="Item + 1"><td><span class="txtTit">ARROZ TIO JOAO 5KG</span></td><td><span class="valor">27,90</span></td></tr>
<tr><td><span class="txtTit">LEITE ITAMBE 1L</span></td><td><span class="valor">5,49</span></td></tr></table>
<div id="totalNota"><div id="linhaTotal"><label>Qtd. total de itens:</label><span class="totalNumb">2</span></div>
<div id="linhaTotal"><label>Valor total R$:</label><span class="totalNumb">33,39</span></div>
<div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">33,39</span></div>
<div id="linhaTotal"><label class="tx">Cartão de Crédito</label><span class="totalNumb">33,39</span></div></div>
<ul><li><strong>Número: </strong>3855 <strong> Série: </strong>1 <strong> Emissão: </strong>23/11/2026 18:30:11 - Via Consumidor</li></ul></body></html>`;
const p = parseSefazPage(html);
ok('página SEFAZ (layout nacional)', p.amount === 33.39 && p.date === '2026-11-23' && p.store.startsWith('SUPERMERCADOS BH') && p.items.length === 2 && p.payment === 'credito', JSON.stringify(p));
const xml = `<nfeProc><NFe><infNFe><ide><dhEmi>2026-11-22T10:00:00-03:00</dhEmi></ide><emit><CNPJ>1</CNPJ><xNome>DROGARIA ARAUJO S A</xNome><xFant>DROGARIA ARAUJO</xFant></emit>
<det nItem="1"><prod><xProd>VENVANSE 50MG</xProd><vProd>312.40</vProd></prod></det><total><ICMSTot><vNF>312.40</vNF></ICMSTot></total><pag><detPag><tPag>04</tPag></detPag></pag></infNFe></NFe></nfeProc>`;
const x = parseSefazPage(xml);
ok('XML da nota', x.amount === 312.4 && x.date === '2026-11-22' && x.store === 'DROGARIA ARAUJO' && x.payment === 'debito' && x.items[0].name === 'VENVANSE 50MG', JSON.stringify(x));
const full = await readCupom(`https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml?p=${ch}|2|1|1|ABCDEF`, {
  fetchPage: async () => html, cnpjLookup: async () => ({ name: 'SUPERMERCADOS BH', legal: 'SUPERMERCADOS BH COMERCIO', cnae: '4711302', cnaeDesc: 'Comércio varejista de mercadorias em geral - supermercados' }) });
ok('fluxo completo', full.amount === 33.39 && full.date === '2026-11-23' && full.store === 'SUPERMERCADOS BH' && full.sefaz, JSON.stringify(full).slice(0,200));
const evil = await readCupom(`https://evil.example.com/x?p=${ch}|2|1|1|AB`, { fetchPage: async () => { throw new Error('não deveria buscar'); }, cnpjLookup: async () => null });
ok('não consulta site que não é .gov.br', !evil.sefaz && evil.chave === ch);
