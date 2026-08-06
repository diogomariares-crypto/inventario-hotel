# Inventário Hotel

App única de gestão de inventário para os hotéis chic&basic / Casa Teva.
Substitui as duas apps anteriores (Inventário Restaurante e Room Cost Tracker),
juntando num só sítio:

- **F&B / Restaurante** — contagem **mensal** por categoria e fornecedor, com quebras e motivo
- **Front Office** e **Housekeeping** — contagem **semanal** com inventário inicial/final,
  compras e **custo por quarto ocupado**
- **Painel** com evolução do €/quarto, top de itens por custo e totais mensais
- **Histórico** e exportação para CSV/Excel
- **Gestão de itens, preços e utilizadores** (administrador)

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Estilos | Tailwind CSS v4 |
| Gráficos | Recharts |
| Backend | Supabase (PostgreSQL + Auth + Realtime + RLS) |
| Alojamento | GitHub Pages (deploy automático via GitHub Actions) |

Não há dependência do Lovable: o código é todo deste repositório e a base de
dados é o projeto Supabase próprio.

## Desenvolvimento local

```bash
npm install
npm run dev
```

Por omissão liga-se ao projeto Supabase de produção. Para apontar a outro,
cria um ficheiro `.env.local`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

A chave *publishable*/anon é pública por natureza — quem protege os dados é o
Row Level Security definido na base de dados (ver `supabase/schema.sql`).

## Publicação

Cada `git push` para `main` dispara o workflow `.github/workflows/deploy.yml`,
que compila e publica em GitHub Pages. Basta ter **Settings › Pages › Source =
GitHub Actions**.

## Base de dados

O esquema completo está em [`supabase/schema.sql`](supabase/schema.sql).

Tabelas principais:

| Tabela | Para que serve |
|---|---|
| `hotels` | Hotéis (Gravity, Tokyo Hoose, Concrete, Casa Teva) |
| `items` | Catálogo. FO/HSK por hotel; F&B partilhado (`hotel_id` nulo) |
| `periods` | Semanas (FO/HSK) e meses (F&B), com quartos ocupados e estado |
| `counts` | Contagens: inventário inicial/final, compras, quebras |
| `purchases` | Encomendas FO/HSK |
| `v_counts` | Vista com os cálculos: utilizado, custo, €/quarto |

Fórmulas (na vista `v_counts`, para nunca divergirem entre ecrãs):

```
utilizado      = inv_inicial + comprado − inv_final
custo          = utilizado × preço_unitário
custo_p/quarto = custo ÷ quartos_ocupados      (nulo se não houver quartos)
```

## Permissões

| Papel | Pode |
|---|---|
| `admin` | tudo: itens, preços, utilizadores, importações, todas as contagens |
| `fo` | contagens de Front Office |
| `hsk` | contagens de Housekeeping |
| `fb` | contagens de F&B |

Cada pessoa cria a própria conta no ecrã de entrada; um administrador atribui
depois as permissões em **Utilizadores**.
