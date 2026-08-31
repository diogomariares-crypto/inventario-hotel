import { useEffect, useMemo, useState } from 'react'
import { createPurchase, fetchStock } from '../lib/data'
import type { Department, Item, StockRow } from '../lib/types'
import {
  analisar, cobertura, fetchConsumo, fetchFornecedores,
  type Analise, type Consumo, type Fornecedor,
} from '../lib/reposicao'
import { money, qty, todayISO } from '../lib/format'
import { Spinner, useToast } from './ui'

type Linha = {
  s: StockRow
  item: Item | undefined
  a: Analise
  alvo: number | null
  sugerido: number
}

/**
 * O que falta repor, logo a seguir à contagem — porque é aí que se sabe o que
 * há, e é aí que apetece encomendar. Antes era preciso ir a outro separador
 * procurar os mesmos artigos outra vez.
 */
export default function ARepor({
  dept, hotelId, editavel, itens, email, aoEncomendar,
}: {
  dept: Department
  hotelId: string
  editavel: boolean
  itens: Item[]
  email: string | null
  aoEncomendar?: () => void
}) {
  const toast = useToast()
  const [stock, setStock] = useState<StockRow[]>([])
  const [consumo, setConsumo] = useState<Record<string, Consumo>>({})
  const [fornecedores, setFornecedores] = useState<Record<string, Fornecedor>>({})
  const [loading, setLoading] = useState(true)
  const [quantidades, setQuantidades] = useState<Record<string, number>>({})
  const [aEnviar, setAEnviar] = useState<string | null>(null)
  const [tudo, setTudo] = useState(false)

  const carregar = () => {
    setLoading(true)
    Promise.all([fetchStock(hotelId, dept), fetchConsumo(hotelId, dept), fetchFornecedores()])
      .then(([s, c, f]) => { setStock(s); setConsumo(c); setFornecedores(f) })
      .catch(e => toast((e as Error).message, 'erro'))
      .finally(() => setLoading(false))
  }
  useEffect(carregar, [hotelId, dept])

  const porItem = useMemo(
    () => Object.fromEntries(itens.map(i => [i.id, i])), [itens])

  const linhas: Linha[] = useMemo(() => {
    return stock.map(s => {
      const item = porItem[s.item_id]
      const a = analisar({
        stock: s.stock_atual,
        consumo: consumo[s.item_id],
        fornecedor: item?.supplier ? fornecedores[item.supplier] : undefined,
        frequencia: s.count_frequency,
      })
      // o par escrito à mão manda; o calculado só entra onde não há nenhum
      const alvo = s.par_qty ?? a.par
      const sugerido = alvo == null
        ? 0
        : Math.max(0, Math.ceil(alvo - (s.stock_atual ?? 0) - s.por_chegar))
      return { s, item, a, alvo, sugerido }
    })
  }, [stock, consumo, fornecedores, porItem])

  /** Primeiro o que fica sem produto antes de a encomenda chegar. */
  const aRepor = useMemo(() => {
    const relevantes = linhas.filter(l => l.sugerido > 0 || l.a.ruptura)
    return relevantes.sort((x, y) => {
      if (x.a.ruptura !== y.a.ruptura) return x.a.ruptura ? -1 : 1
      const cx = x.a.cobertura ?? Infinity, cy = y.a.cobertura ?? Infinity
      if (cx !== cy) return cx - cy
      return y.sugerido - x.sugerido
    })
  }, [linhas])

  const visiveis = tudo ? aRepor : aRepor.slice(0, 12)
  const emRuptura = aRepor.filter(l => l.a.ruptura).length
  const valor = aRepor.reduce(
    (t, l) => t + (quantidades[l.s.item_id] ?? l.sugerido) * (l.s.unit_price_eur ?? 0), 0)

  const encomendar = async (l: Linha) => {
    const q = quantidades[l.s.item_id] ?? l.sugerido
    if (q <= 0) return
    setAEnviar(l.s.item_id)
    try {
      await createPurchase({
        hotel_id: hotelId,
        item_id: l.s.item_id,
        qty: q,
        amount_paid_eur: q * (l.s.unit_price_eur ?? 0),
        order_date: todayISO(),
        supplier: l.item?.supplier ?? null,
        note: 'a repor, a partir da contagem',
        created_by: email,
      })
      toast(`${l.s.item_name}: ${qty(q)} encomendados`)
      setQuantidades(x => ({ ...x, [l.s.item_id]: 0 }))
      carregar()
      aoEncomendar?.()
    } catch (e) {
      toast((e as Error).message, 'erro')
    } finally { setAEnviar(null) }
  }

  if (loading) {
    return (
      <div className="card flex items-center gap-2 p-4 text-sm text-slate-500">
        <Spinner /> a ver o que falta repor…
      </div>
    )
  }

  if (aRepor.length === 0) {
    return (
      <div className="card p-4 text-sm text-slate-500">
        Nada a repor com o stock actual.
      </div>
    )
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">
          A repor · {aRepor.length}
          {emRuptura > 0 && (
            <span className="ml-2 chip bg-red-100 text-red-700">
              {emRuptura} {emRuptura === 1 ? 'acaba' : 'acabam'} antes de chegar
            </span>
          )}
        </h3>
        <span className="text-xs tabular-nums text-slate-500">
          {money(valor)} se encomendares tudo
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        Ordenado pelo que se esgota primeiro. A cobertura é o tempo que o stock
        actual aguenta ao ritmo a que se tem gasto.
      </p>

      <div className="mt-3 space-y-1.5">
        {visiveis.map(l => (
          <LinhaRepor
            key={l.s.item_id}
            l={l}
            editavel={editavel}
            aEnviar={aEnviar === l.s.item_id}
            quantidade={quantidades[l.s.item_id] ?? l.sugerido}
            onQuantidade={n => setQuantidades(x => ({ ...x, [l.s.item_id]: n }))}
            onEncomendar={() => encomendar(l)}
          />
        ))}
      </div>

      {aRepor.length > 12 && (
        <button className="mt-3 text-sm text-brand-700 hover:underline"
                onClick={() => setTudo(t => !t)}>
          {tudo ? 'Mostrar só os 12 mais urgentes' : `Ver os outros ${aRepor.length - 12}`}
        </button>
      )}
    </div>
  )
}

function LinhaRepor({
  l, editavel, quantidade, aEnviar, onQuantidade, onEncomendar,
}: {
  l: Linha
  editavel: boolean
  quantidade: number
  aEnviar: boolean
  onQuantidade: (n: number) => void
  onEncomendar: () => void
}) {
  const { s, a, alvo } = l
  const calculado = s.par_qty == null && a.par != null

  return (
    <div className={`rounded-lg border p-2.5 ${
      a.ruptura ? 'border-red-200 bg-red-50/60' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-[160px] flex-1">
          <div className="text-sm font-medium text-slate-800">{s.item_name}</div>
          <div className="text-[11px] text-slate-400">
            {l.item?.supplier || 'sem fornecedor'} · entrega em {a.prazo} dias
          </div>
        </div>

        <div className="w-24 text-right">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Stock</div>
          <div className="text-sm tabular-nums text-slate-700">
            {qty(s.stock_atual ?? 0)} {s.unit}
            {s.por_chegar > 0 && (
              <span className="ml-1 text-[11px] text-brand-600">+{qty(s.por_chegar)}</span>
            )}
          </div>
        </div>

        <div className="w-28 text-right">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Dura</div>
          <div className={`text-sm ${a.ruptura ? 'font-semibold text-red-600' : 'text-slate-700'}`}>
            {cobertura(a.cobertura)}
          </div>
        </div>

        <div className="w-24 text-right">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">
            Par {calculado && <span className="text-brand-600">calc.</span>}
          </div>
          <div className="text-sm tabular-nums text-slate-700">
            {alvo == null ? '—' : qty(alvo)}
          </div>
        </div>

        {editavel && (
          <div className="flex items-end gap-1.5">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Encomendar</div>
              <input
                inputMode="decimal"
                className="input w-20 px-2 py-1 text-right text-sm tabular-nums"
                value={quantidade === 0 ? '' : String(quantidade).replace('.', ',')}
                onChange={e => {
                  const n = Number(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))
                  onQuantidade(Number.isFinite(n) ? n : 0)
                }}
              />
            </div>
            <button
              className="btn-primary px-3 py-1.5 text-sm disabled:opacity-40"
              disabled={quantidade <= 0 || aEnviar}
              onClick={onEncomendar}
            >
              {aEnviar ? '…' : 'Encomendar'}
            </button>
          </div>
        )}
      </div>

      {(a.ruptura || a.confianca !== 'boa') && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          {a.ruptura && (
            <span className="font-medium text-red-600">
              O stock acaba em {cobertura(a.cobertura)} e a entrega demora {a.prazo} dias.{' '}
            </span>
          )}
          {a.confianca !== 'boa' && <>Sem par calculado: {a.porque}.</>}
        </p>
      )}
    </div>
  )
}
