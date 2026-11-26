/* ══ FinDigo — taxonomia (grupos › categorias › subcategorias) ══
   Fonte: planilha de configuração do Rodrigo (conf.xlsx).
   Cada transação pertence a UMA categoria e UMA subcategoria; cada categoria a UM grupo.
   Metas dos grupos (sobre a renda do período filtrado):
     2. Essenciais  ≤ 50%   3. Estilo de vida ≤ 30%   4. Futuro ≥ 20%           */

const GROUPS = [
  { id:'g1', n:1, name:'Receitas', full:'Receitas (Entradas)', type:'income', color:'#12A66A',
    hint:'Separe o que é previsível do que é pontual para não comprometer o orçamento fixo contando com dinheiro incerto.',
    cats:[
      { name:'Renda Principal',          icon:'💼', color:'#12A66A', subs:['Salário'] },
      { name:'Renda Extra',              icon:'🧑‍💻', color:'#34C38F', subs:['Renda extra'] },
      { name:'Rendimentos e Benefícios', icon:'💰', color:'#0DB27A', subs:['Dividendos','Rendimentos de aplicações','Vale-alimentação/refeição','Restituição de IR'] },
    ] },
  { id:'g2', n:2, name:'Despesas Essenciais', full:'Despesas Essenciais (Necessidades)', type:'expense', color:'#F97316',
    goal:{ op:'max', pct:50, label:'até 50% da renda' },
    hint:'Gastos indispensáveis para manter a moradia, saúde e capacidade de gerar renda.',
    cats:[
      { name:'Habitação',         icon:'🏠', color:'#F97316', subs:['Aluguel','Condomínio','IPTU','Seguro residencial','Manutenção básica'] },
      { name:'Contas de Consumo', icon:'💡', color:'#14B8A6', subs:['Contas de casa','Contas pessoais','Assinaturas essenciais'] },
      { name:'Alimentação',       icon:'🛒', color:'#EF4444', subs:['Essencial casa','Essencial pessoal','Extra casa'] },
      { name:'Transporte',        icon:'🚗', color:'#F5A524', subs:['Combustível para trabalho','Combustível para estudo','Aplicativos (lazer)','IPVA e seguro auto','Manutenção preventiva','Estacionamento'] },
      { name:'Saúde',             icon:'🩺', color:'#E11D48', subs:['Remédios Vó','Remédios atípicos','Venvanse','Remédios Rodrigo'] },
      { name:'Educação',          icon:'📚', color:'#3B82F6', subs:['Gastos com cursos'] },
    ] },
  { id:'g3', n:3, name:'Estilo de Vida e Lazer', full:'Estilo de Vida e Lazer (Desejos)', type:'expense', color:'#7C5CFC',
    goal:{ op:'max', pct:30, label:'até 30% da renda' },
    hint:'Gastos variáveis que trazem conforto, mas que podem ser cortados ou reduzidos rapidamente em caso de imprevistos.',
    cats:[
      { name:'Alimentação Fora',       icon:'🍽️', color:'#EC4899', subs:['Restaurantes','Bares','Delivery (iFood)','Cafés e lanches'] },
      { name:'Lazer e Cultura',        icon:'🎬', color:'#7C5CFC', subs:['Cinema','Shows','Viagens','Passeios','Hobbies','Jogos'] },
      { name:'Assinaturas e Serviços', icon:'📺', color:'#A855F7', subs:['Streaming','Academia','Clubes','Aplicativos pagos','Armazenamento em nuvem'] },
      { name:'Compras Pessoais',       icon:'🛍️', color:'#D946EF', subs:['Vestuário','Calçados','Eletrônicos','Cosméticos','Presentes','Decoração'] },
      { name:'Cuidados Pessoais',      icon:'💇', color:'#F472B6', subs:['Salão de beleza','Barbearia','Estética','Massagem'] },
      { name:'Pets',                   icon:'🐾', color:'#65A30D', subs:['Ração','Veterinário','Banho e tosa','Medicamentos','Acessórios'] },
      { name:'Esportes',               icon:'🏐', color:'#EAB308', subs:['Academia','Vôlei'] },
    ] },
  { id:'g4', n:4, name:'Metas, Investimentos e Dívidas', full:'Metas, Investimentos e Dívidas (Futuro)', type:'expense', color:'#0EA5E9',
    goal:{ op:'min', pct:20, label:'mínimo 20% da renda' },
    hint:'Trate os aportes como um "boleto" prioritário logo que a receita entrar na conta.',
    cats:[
      { name:'Reserva de Emergência', icon:'🐷', color:'#06B6D4', subs:['Poupar reserva'] },
      { name:'Objetivos Específicos', icon:'🎯', color:'#0EA5E9', subs:['Fundo para viagem','Troca de carro','Entrada de imóvel','Casamento'] },
      { name:'Dívidas e Encargos',    icon:'📉', color:'#DC2626', subs:['Parcelamento de fatura','Empréstimos, cheque especial e tarifas'] },
    ] },
];

// categorias de sistema (fora dos 4 grupos)
const SPECIAL_CATS = [
  { name:'Transferências', icon:'🔁', color:'#94A3B8', subs:['Entre contas'], both:true },   // PIX/TED: movimentação se for entre contas suas
  { name:'Cartões',        icon:'💳', color:'#6366F1', subs:['Pagamento de fatura'] },
  { name:'Outros',         icon:'📦', color:'#9CA3AF', subs:['A classificar'] },
];

const CAT_INFO = {};            // nome → { name, icon, color, subs, group }
GROUPS.forEach(g => g.cats.forEach(c => { CAT_INFO[c.name] = { ...c, group: g }; }));
SPECIAL_CATS.forEach(c => { CAT_INFO[c.name] = { ...c, group: null }; });

const INCOME_CATS  = GROUPS[0].cats.map(c => c.name);
const EXPENSE_CATS = [...GROUPS.slice(1).flatMap(g => g.cats.map(c => c.name)), ...SPECIAL_CATS.map(c => c.name)];
const ALL_CATS     = [...INCOME_CATS, ...EXPENSE_CATS];
const CAT_COLORS = Object.fromEntries(Object.values(CAT_INFO).map(c => [c.name, c.color]));
const CAT_ICONS  = Object.fromEntries(Object.values(CAT_INFO).map(c => [c.name, c.icon]));
const subsOf  = (cat) => CAT_INFO[cat]?.subs || [];
const groupOf = (cat) => CAT_INFO[cat]?.group || null;
const catsForType = (type) => type === 'income' ? [...INCOME_CATS, 'Transferências'] : EXPENSE_CATS;
const validPair = (cat, sub) => subsOf(cat).includes(sub);

// ── regras por palavra-chave: [regex, categoria, subcategoria, tipo ('income'|'expense'|'')] ──
const SUB_RULES = [
  // receitas
  [/sal[aá]rio|vencimento|folha\s*(de\s*)?pag|fiemg|senai|lemontech|proventos|pagamento\s*emp|capes|bolsa\s*(de\s*)?(estudo|doutorado|pesquisa)/i, 'Renda Principal','Salário','income'],
  [/dividend|\bjcp\b|juros\s*s(obre)?\/?\s*cap/i,                       'Rendimentos e Benefícios','Dividendos','income'],
  [/rendiment|\bcdb\b|\blci\b|\blca\b|tesouro|resgate|remunera[cç][aã]o\s*(da\s*)?conta/i, 'Rendimentos e Benefícios','Rendimentos de aplicações','income'],
  [/vale.?(alimenta|refei)|\bva\b|\bvr\b|alelo|sodexo|pluxee|\bticket\b|\bflash\b|\bcaju\b|\bswile\b/i, 'Rendimentos e Benefícios','Vale-alimentação/refeição','income'],
  [/restitui/i,                                                        'Rendimentos e Benefícios','Restituição de IR','income'],
  [/freela|honor[aá]rio|aut[oô]nom|bico|venda|\bmei\b/i,              'Renda Extra','Renda extra','income'],
  // movimentações / cartões
  [/parcelamento\s*(de\s*)?fatura|parc\.?\s*fatura/i,                 'Dívidas e Encargos','Parcelamento de fatura','expense'],
  [/fatura|pagamento\s*(de\s*)?cart[aã]o|pgto\.?\s*cart/i,            'Cartões','Pagamento de fatura','expense'],
  // habitação
  [/aluguel|imobili[aá]ria|quinto\s*andar/i,                           'Habitação','Aluguel','expense'],
  [/condom[ií]nio/i,                                                   'Habitação','Condomínio','expense'],
  [/\biptu\b/i,                                                        'Habitação','IPTU','expense'],
  [/seguro\s*(resid|casa|lar)/i,                                       'Habitação','Seguro residencial','expense'],
  [/reparo|reforma|manuten[cç][aã]o\s*(casa|resid)|material\s*(de\s*)?constru|leroy|eletricista|encanador|chaveiro/i, 'Habitação','Manutenção básica','expense'],
  // contas de consumo
  [/cemig|copasa|energia|\bluz\b|\b[áa]gua\b|\bg[áa]s\b|comgas|gasmig|internet|banda\s*larga|\bnet\s*(combo|virtua)|vivo\s*fibra|algar/i, 'Contas de Consumo','Contas de casa','expense'],
  [/\bclaro\b|\btim\b|\bvivo\b|\boi\b|celular|recarga/i,               'Contas de Consumo','Contas pessoais','expense'],
  [/chatgpt|openai|anthropic|claude\.ai|microsoft\s*365|office\s*365|github|adobe|canva|notion/i, 'Contas de Consumo','Assinaturas essenciais','expense'],
  // alimentação fora (antes de supermercado: "ifood mercado" é delivery)
  [/ifood|rappi|uber\s*eats|aiqfome|z[eé]\s*delivery|delivery/i,       'Alimentação Fora','Delivery (iFood)','expense'],
  [/restaurante|churrasc|pizzaria|hamburg|burger|sushi|lanchonete|mc\s*donald|bk\b|outback|madero|spoleto|subway/i, 'Alimentação Fora','Restaurantes','expense'],
  [/\bbar\b|boteco|choperia|cervejaria|pub\b/i,                        'Alimentação Fora','Bares','expense'],
  [/caf[eé]\b|cafeteria|starbucks|lanche|sorvet|a[cç]a[ií]|doceria|confeitaria/i, 'Alimentação Fora','Cafés e lanches','expense'],
  // alimentação (essencial)
  [/supermercado|mercado|mercearia|atacad|assa[ií]|carrefour|extra\b|p[aã]o\s*de\s*a[cç][uú]car|\bepa\b|verdemar|super\s*nosso|apoio\s*mineiro|bh\s*super|a[cç]ougue|hortifruti|sacol[aã]o|padaria|panific/i, 'Alimentação','Essencial casa','expense'],
  // transporte
  [/posto|combust|gasolina|etanol|diesel|\bshell\b|ipiranga|petrobras|\bbr\s*mania|\bale\b\s*comb/i, 'Transporte','Combustível para trabalho','expense'],
  [/\buber\b|\b99\s*(app|pop|taxi)?\b|t[aá]xi|cabify|indriver/i,      'Transporte','Aplicativos (lazer)','expense'],
  [/\bipva\b|licenciamento|detran|seguro\s*(auto|ve[ií]culo|carro)|porto\s*seguro|azul\s*seguros/i, 'Transporte','IPVA e seguro auto','expense'],
  [/oficina|mec[aâ]nic|revis[aã]o|\bpneu|troca\s*de\s*[oó]leo|auto\s*pe[cç]as|lava\s*jato/i, 'Transporte','Manutenção preventiva','expense'],
  [/estacion|parking|ped[aá]gio|sem\s*parar|veloe|conectcar|zona\s*azul|rotativo/i, 'Transporte','Estacionamento','expense'],
  // saúde
  [/venvanse|lisdex/i,                                                 'Saúde','Venvanse','expense'],
  [/farm[aá]cia|drogaria|droga\s*raia|drogasil|ara[uú]jo|pacheco|pague\s*menos|rem[eé]dio|medicamento/i, 'Saúde','Remédios Rodrigo','expense'],
  // educação
  [/curso|faculdade|universidade|escola|mensalidade|matr[ií]cula|udemy|alura|coursera|\bmba\b|p[oó]s.?gradua|livraria|livros?\b/i, 'Educação','Gastos com cursos','expense'],
  // lazer e cultura
  [/cinema|cinemark|cineart|cinépolis|cinepolis|teatro/i,             'Lazer e Cultura','Cinema','expense'],
  [/\bshow\b|ingresso|sympla|eventim|ticketmaster|festival/i,          'Lazer e Cultura','Shows','expense'],
  [/hotel|pousada|airbnb|booking|decolar|passagem|\bvoo\b|latam|gol\s*linhas|azul\s*linhas|\bviagem|hostel|123\s*milhas/i, 'Lazer e Cultura','Viagens','expense'],
  [/parque|passeio|museu|zool[oó]gico/i,                               'Lazer e Cultura','Passeios','expense'],
  [/steam|playstation|\bpsn\b|xbox|nintendo|\bjogo|game/i,             'Lazer e Cultura','Jogos','expense'],
  // assinaturas e serviços
  [/netflix|spotify|disney|prime\s*video|amazon\s*prime|\bhbo|\bmax\b|paramount|globoplay|apple\s*tv|deezer|youtube|crunchyroll|star\+/i, 'Assinaturas e Serviços','Streaming','expense'],
  [/icloud|google\s*one|dropbox|onedrive|google\s*storage/i,           'Assinaturas e Serviços','Armazenamento em nuvem','expense'],
  [/app\s*store|apple\.com|google\s*play/i,                            'Assinaturas e Serviços','Aplicativos pagos','expense'],
  [/\bclube\b/i,                                                       'Assinaturas e Serviços','Clubes','expense'],
  // esportes (antes de "academia" em assinaturas)
  [/academia|smart\s*fit|bluefit|\bgym\b|crossfit|pilates|muscula/i,   'Esportes','Academia','expense'],
  [/v[oô]lei/i,                                                        'Esportes','Vôlei','expense'],
  // compras pessoais
  [/renner|riachuelo|c\s*&\s*a\b|cea\b|zara|hering|marisa|roupa|vestu|shein/i, 'Compras Pessoais','Vestuário','expense'],
  [/cal[cç]ado|t[eê]nis|centauro|netshoes|arezzo|sapat/i,              'Compras Pessoais','Calçados','expense'],
  [/eletr[oô]n|magazine\s*luiza|magalu|kabum|fast\s*shop|casas\s*bahia|ponto\s*frio|samsung|apple\s*store/i, 'Compras Pessoais','Eletrônicos','expense'],
  [/botic[aá]rio|natura|sephora|cosm[eé]t|perfum|eudora|avon/i,         'Compras Pessoais','Cosméticos','expense'],
  [/presente/i,                                                        'Compras Pessoais','Presentes','expense'],
  [/decora|tok\s*&?\s*stok|camicado|etna|mobly/i,                      'Compras Pessoais','Decoração','expense'],
  // cuidados pessoais
  [/sal[aã]o|cabeleir/i,                                               'Cuidados Pessoais','Salão de beleza','expense'],
  [/barbear/i,                                                         'Cuidados Pessoais','Barbearia','expense'],
  [/est[eé]tic|depila|manicure|sobrancelha/i,                          'Cuidados Pessoais','Estética','expense'],
  [/massag/i,                                                          'Cuidados Pessoais','Massagem','expense'],
  // pets
  [/ra[cç][aã]o|petz|cobasi|pet\s*shop|petlove/i,                      'Pets','Ração','expense'],
  [/veterin/i,                                                         'Pets','Veterinário','expense'],
  [/banho\s*e?\s*tosa|\btosa\b/i,                                      'Pets','Banho e tosa','expense'],
  // futuro
  [/poupan[cç]a|reserva|guardar|caixinha|cofrinho/i,                   'Reserva de Emergência','Poupar reserva','expense'],
  [/empr[eé]stimo|cheque\s*especial|\biof\b|juros|tarifa|anuidade|cesta\s*(de\s*)?servi|pacote\s*(de\s*)?servi|encargo|mora\b|multa/i, 'Dívidas e Encargos','Empréstimos, cheque especial e tarifas','expense'],
  // transferências (por último: PIX para terceiros vira despesa quando não houver a ponta na outra conta)
  [/\bpix\b|transf|\bted\b|\bdoc\b/i,                                  'Transferências','Entre contas',''],
];

// classifica pela descrição; restrictTo: lista de categorias permitidas
function classifyDesc(desc, type, restrictTo){
  const d = String(desc || '');
  for (const [re, cat, sub, ty] of SUB_RULES){
    if (ty && type && ty !== type) continue;
    if (restrictTo && !restrictTo.includes(cat)) continue;
    if (re.test(d)) return { cat, sub };
  }
  return null;
}
// subcategoria mais provável dentro de uma categoria
function guessSub(cat, desc, type){
  const subs = subsOf(cat);
  if (!subs.length) return '';
  const hit = classifyDesc(desc, type, [cat]);
  return hit ? hit.sub : subs[0];
}

// categorias antigas (antes da planilha) → candidatas na taxonomia nova (a 1ª é o padrão)
const LEGACY_MAP = {
  'Salário':['Renda Principal'], 'Freelance/Negócios':['Renda Extra'],
  'Investimentos':['Rendimentos e Benefícios'], 'Outros Rendimentos':['Renda Extra','Rendimentos e Benefícios','Renda Principal'],
  'Alimentação':['Alimentação','Alimentação Fora'], 'Moradia':['Habitação','Contas de Consumo'],
  'Transporte':['Transporte'], 'Saúde':['Saúde','Esportes'], 'Educação':['Educação','Contas de Consumo'],
  'Entretenimento':['Lazer e Cultura','Assinaturas e Serviços','Esportes'], 'Assinaturas':['Assinaturas e Serviços','Contas de Consumo'],
  'Compras':['Compras Pessoais','Cuidados Pessoais','Pets'], 'Telecomunicações':['Contas de Consumo'],
  'Pets':['Pets'], 'Viagens':['Lazer e Cultura'], 'Dívidas':['Dívidas e Encargos'], 'Poupança':['Reserva de Emergência'],
  'Impostos':['Dívidas e Encargos','Habitação','Transporte'],
  'Cartões':['Cartões','Dívidas e Encargos'], 'Transferências':['Transferências'], 'Outros':['Outros'],
};
const LEGACY_DEFAULT_SUB = { 'Viagens':'Viagens', 'Impostos':'Empréstimos, cheque especial e tarifas', 'Telecomunicações':'Contas pessoais' };

// Coloca uma transação na taxonomia nova. Retorna true se mudou algo.
function migrateTx(t){
  if (t.cat in CAT_INFO && validPair(t.cat, t.sub)) return false;
  const type = t.type === 'income' ? 'income' : 'expense';
  let cat = t.cat, sub = '';
  if (CAT_INFO[cat] && !LEGACY_MAP[cat]){
    sub = guessSub(cat, t.desc, type);                            // já é categoria nova: só falta a sub
  } else {
    const cands = LEGACY_MAP[cat] || null;
    const hit = classifyDesc(t.desc, type, cands || undefined);
    if (hit){ cat = hit.cat; sub = hit.sub; }
    else if (cands){ cat = cands[0]; sub = LEGACY_DEFAULT_SUB[t.cat] && validPair(cat, LEGACY_DEFAULT_SUB[t.cat]) ? LEGACY_DEFAULT_SUB[t.cat] : subsOf(cat)[0]; }
    else { cat = type === 'income' ? 'Renda Extra' : 'Outros'; sub = subsOf(cat)[0]; }
  }
  // receita precisa de categoria de receita (ou Transferências) e vice-versa
  if (type === 'income' && !catsForType('income').includes(cat)){ cat = 'Renda Extra'; sub = 'Renda extra'; }
  if (type === 'expense' && !EXPENSE_CATS.includes(cat)){ cat = 'Outros'; sub = 'A classificar'; }
  if (!validPair(cat, sub)) sub = subsOf(cat)[0] || '';
  const changed = t.cat !== cat || t.sub !== sub;
  t.cat = cat; t.sub = sub;
  return changed;
}

// <option>s de categoria agrupadas por grupo
function catOptionsHTML(type, esc){
  const allow = new Set(type ? catsForType(type) : ALL_CATS);
  const og = (label, cats) => {
    const list = cats.filter(c => allow.has(c));
    return list.length ? `<optgroup label="${esc(label)}">${list.map(c => `<option value="${esc(c)}">${CAT_ICONS[c]} ${esc(c)}</option>`).join('')}</optgroup>` : '';
  };
  return GROUPS.map(g => og(`${g.n}. ${g.name}`, g.cats.map(c => c.name))).join('')
    + og('Outros', SPECIAL_CATS.map(c => c.name));
}
// <option>s "Categoria › Subcategoria" (value = "cat||sub")
function catSubOptionsHTML(esc){
  const og = (label, cats) => `<optgroup label="${esc(label)}">${cats.flatMap(c => subsOf(c).map(s =>
    `<option value="${esc(c)}||${esc(s)}">${esc(c)} › ${esc(s)}</option>`)).join('')}</optgroup>`;
  return GROUPS.map(g => og(`${g.n}. ${g.name}`, g.cats.map(c => c.name))).join('')
    + og('Outros', SPECIAL_CATS.map(c => c.name));
}
