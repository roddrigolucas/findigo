# FinNexus — Sistema de Gestão Financeira

Aplicação web de controle financeiro pessoal com autenticação, importação de
extratos bancários e controle mensal de receitas e despesas.

## Funcionalidades

- **Login e sessão** — autenticação server-side (PBKDF2-SHA256, 150k iterações) e
  token de sessão assinado com HMAC-SHA256, válido por 12 horas.
- **Gestão de usuários** — o administrador cria, ativa/desativa e remove usuários.
  Cada usuário tem seus próprios dados financeiros, isolados por conta.
- **Resumo** — saldo líquido disponível, receitas previstas do mês, despesas
  previstas do mês e saldo projetado.
- **Controle mensal** — um cartão por mês com receitas, despesas, saldo e o que
  ainda está previsto (a receber / a pagar).
- **Filtro de período** — janela de 1 a 12 meses (limite máximo de 12), com
  filtros adicionais por categoria e situação.
- **Importação de extratos** — XLSX, CSV, PDF, OFX e TXT, com detecção automática
  de colunas, formato numérico brasileiro, categorização e remoção de duplicatas.
- **Lançamento manual** — receitas e despesas, realizadas ou previstas.
- **Retenção** — 24 meses de histórico, aplicada tanto na gravação quanto na leitura.
- **Exportação CSV** do período filtrado.
- **Open Finance** — conecta bancos via Pluggy/MeuPluggy e importa extrato e
  movimentações automaticamente (a cada 4 h e ao abrir o app), sem duplicar.

## Arquitetura

```
public/          front-end estático (HTML/CSS/JS, sem dependências externas)
  index.html
  app.css
  app.js         estado, filtros, gráficos (Canvas), UI
  parsers.js     leitores de XLSX/CSV/OFX/PDF + categorização
netlify/functions/
  _lib.mjs       hash de senha, tokens de sessão, acesso ao Netlify Blobs
  auth.mjs       POST /api/auth  — login, sessão, usuários, troca de senha
  data.mjs       GET/PUT/DELETE /api/data — transações do usuário logado
  _openfinance.mjs   cliente Pluggy, mapeamento de categorias, sincronização
  openfinance.mjs    POST /api/openfinance — conectar, vincular, sincronizar
  openfinance-cron.mjs  sincronização agendada (cron 23 */4 * * * UTC)
public/openfinance.js   painel "Open Finance" na aba Importar
```

Persistência em **Netlify Blobs** (`users` e `userdata`). Nenhuma senha é
armazenada em texto puro e nenhuma credencial fica no código do front-end.

## Variáveis de ambiente

| Variável         | Descrição                                              |
|------------------|--------------------------------------------------------|
| `SESSION_SECRET` | Chave HMAC para assinar os tokens de sessão (secreta). |
| `ADMIN_USER`     | Usuário administrador criado no primeiro acesso.       |
| `ADMIN_PASSWORD` | Senha inicial do administrador (secreta).              |
| `PLUGGY_CLIENT_ID` | Client ID da aplicação na Pluggy (Open Finance).     |
| `PLUGGY_CLIENT_SECRET` | Client Secret da Pluggy (secreta).               |
| `PLUGGY_INCLUDE_SANDBOX` | `1` mostra os bancos de teste da Pluggy no widget. |

## Open Finance

1. Crie a conta em <https://meu.pluggy.ai> e conecte seus bancos (gratuito).
2. Em <https://dashboard.pluggy.ai>, inclua o conector **MeuPluggy** e crie uma
   aplicação para obter Client ID/Secret; cadastre-os no Netlify e publique.
3. No FinNexus, aba **Importar → Conectar banco** → escolha **MeuPluggy** e
   autorize cada banco. Depois vincule cada conta do banco a uma conta ou cartão.

Cada movimentação recebe o id `of_<id Pluggy>`: nunca duplica, uma excluída por
você não volta, e lançamentos pendentes são atualizados quando confirmados.
A data "a partir de" começa no dia seguinte ao último extrato já importado.
Teste: `node ofsmoke.mjs` (Pluggy simulada + Blobs local + Chromium).

O administrador é criado automaticamente na primeira chamada a `/api/auth`.
Depois disso, altere a senha pelo próprio sistema (aba **Usuários**).

## Desenvolvimento local

```bash
npm install
npm install -D playwright && npx playwright install chromium
npx netlify dev
```

## Teste automatizado

`smoke.mjs` sobe um backend simulado e roda o front-end num Chromium headless,
verificando login, KPIs do resumo, controle mensal, o limite de 12 meses do
filtro, a importação de CSV (formato brasileiro, categorização e remoção de
duplicatas), a persistência e o logout.

```bash
npm install -D playwright && npx playwright install chromium
node smoke.mjs
```

## Instalação no celular (PWA)

O sistema é um **Progressive Web App**: abrindo a URL no Chrome do Android,
o menu ⋮ oferece **Instalar aplicativo** / *Adicionar à tela inicial*. Ele passa
a ter ícone próprio, abre em tela cheia sem a barra do navegador e mantém a
casca em cache para carregar mesmo com rede ruim.

O service worker (`sw.js`) nunca guarda respostas de `/api/` em cache — sessão e
dados financeiros vêm sempre da rede.

`mobile.mjs` roda a interface num viewport de celular e verifica o manifesto,
os ícones, a barra de filtros recolhível e a ausência de rolagem horizontal.
