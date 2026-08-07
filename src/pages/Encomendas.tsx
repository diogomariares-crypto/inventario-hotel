import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import {
  createPurchase, deletePurchase, fetchPurchases, fetchStock, receivePurchase,
} from '../lib/data'
import type { Department, Purchase, StockRow } from '../lib/types'
import { DEPARTMENTS } from '../lib/types'
import { dmy, downloadCSV, money, qty, todayISO } from '../lib/format'
import { Empty, Loading, Modal, NumInput, useToast } from '../components/ui'

type PurchaseRow = Purchase & {
  items: { id: string; name: string; department: Department; unit: string; unit_price_eur: number | null }
}

export default function Encomendas() {
  const { hotelId } = useApp()
  const { canWrite, email } = useAuth()
  const toast = useToast()

  const [dept, setDept] = useState<Department>('HSK')
  const [stock, setStock] = useState<StockRow[]>([])
  const [compras, setCompras] = useState<PurchaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<'sugestoes' | 'pendentes' | 'historico'>('sugestoes')
  const [busca, setBusca] = useState('')
  const [nova, setNova] = useState<{ item?: StockRow; qty: number; valor: number; data: string; fornecedor: string; nota: string } | null>(null)
  const [receber, setReceber] = useState<{ p: PurchaseRow; data: string; qty: number } | null>(null)

  const editavel = canWrite(dept)

  const carregar = async () => {
    if (!hotelId) return
    setLoading(true)
    try {
      const [s, c] = await Promise.all([fetchStock(hotelId, dept), fetchPurchases(hotelId, dept)])
      setStock(s)
      setCompras(c)
    } catch (e) {
      toast((e as Error).message, 'erro')
    } finally { setLoading(false) }
  }
  useEffect(() => { carregar() }, [hotelId, dept])

  const pendentes = useMemo(() => compras.filter(c => !c.received_date), [compras])
  const recebidas = useMemo(() => compras.filter(c => c.received_date), [compras])

  const sugestoes = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return stock
      .filter(s => !q || s.item_name.toLowerCase().includes(q))
      .sort((a, b) => {
        const sa = a.sugerido ?? -1, sb = b.sugerido ?? -1
        if (sb !== sa) return sb - sa
        return a.item_name.localeCompare(b.item_name, 'pt')
      })
  }, [stock, busca])

  const aRepor = sugestoes.filter(s => (s.sugerido ?? 0) > 0).length
  const semPar = stock.filter(s => s.par_qty == null).length

  const guardarEncomenda = async () => {
    if (!nova?.item || !hotelId) return
    if (nova.qty <= 0) { toast('Indica uma quantidade', 'erro'); return }
    try {
      await createPurchase({
        hotel_id: hotelId,
        item_id: nova.item.item_id,
        qty: nova.qty,
        amount_paid_eur: nova.valor,
        order_date: nova.data,
        supplier: nova.fornecedor.trim() || null,
        note: nova.nota.trim() || null,
        created_by: email,
      })
      toast('Encomenda registada')
      setNova(null)
      carregar()
    } catch (e) { toast((e as Error).message, 'erro') }
  }

  const marcarRecebida = async () => {
    if (!receber) return
    try {
      await receivePurchase(receber.p.id, receber.data, email, receber.qty)
      toast('Chegada registada')
      setReceber(null)
      carregar()
    } catch (e) { toast((e as Error).message, 'erro') }
  }

  const apagar = async (p: PurchaseRow) => {
    if (!confirm(`Apagar a encomenda de ${qty(p.qty)} ${p.items.unit} de "${p.items.name}"?`)) return
    try { await deletePurchase(p.id); toast('Encomenda apagada'); carregar() }
    catch (e) { toast((e as Error).message, 'erro') }
  }

  if (loading) return <Loading />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {DEPARTMENTS.filter(d => d.value !== 'FB').map(d => (
          <button
            key={d.value}
            onClick={() => setDept(d.value)}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium ${
              dept === d.value ? 'bg-brand-500 text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {d.label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" onClick={() => downloadCSV(`encomendas_${dept}.csv`, [
            ['item', 'quantidade', 'unidade', 'valor_eur', 'fornecedor', 'data_encomenda', 'data_chegada', 'nota'],
            ...compras.map(c => [c.items.name, c.qty, c.items.unit, c.amount_paid_eur,
              c.supplier, c.order_date, c.received_date, c.note]),
          ])} disabled={!compras.length}>Exportar</button>
          <button className="btn-primary" disabled={!editavel}
                  onClick={() => setNova({ qty: 0, valor: 0, data: todayISO(), fornecedor: '', nota: '' })}>
            + Encomenda
          </button>
        </div>
      </div>

      {!editavel && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Só podes consultar as encomendas deste departamento.
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3">
          <div className="text-xs text-slate-500">A repor</div>
          <div className="text-lg font-semibold tabular-nums">{aRepor}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-slate-500">Por chegar</div>
          <div className="text-lg font-semibold tabular-nums">{pendentes.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-slate-500">Valor por chegar</div>
          <div className="text-lg font-semibold tabular-nums">
            {money(pendentes.reduce((s, p) => s + Number(p.amount_paid_eur), 0))}
          </div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {([
          ['sugestoes', `O que comprar (${aRepor})`],
          ['pendentes', `Por chegar (${pendentes.length})`],
          ['historico', `Recebidas (${recebidas.length})`],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
              aba === k ? 'bg-slate-800 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ------------------------------ Sugestões ------------------------------ */}
      {aba === 'sugestoes' && (
        <>
          <input className="input" placeholder="Procurar item…" value={busca}
                 onChange={e => setBusca(e.target.value)} />
          {semPar > 0 && (
            <div className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              {semPar} {semPar === 1 ? 'item não tem' : 'itens não têm'} stock ideal definido, por isso não
              aparecem sugestões para eles. Define o <strong>Par</strong> em <em>Itens</em>.
            </div>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Item</th>
                  <th className="th text-right">Stock atual</th>
                  <th className="th text-right">Por chegar</th>
                  <th className="th text-right">Par</th>
                  <th className="th text-right">Sugerido</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sugestoes.map(s => (
                  <tr key={s.item_id} className={(s.sugerido ?? 0) > 0 ? 'bg-amber-50/40' : ''}>
                    <td className="td">
                      <div className="font-medium text-slate-800">{s.item_name}</div>
                      <div className="text-xs text-slate-400">
                        {s.contado_em ? `contado a ${dmy(s.contado_em)}` : 'nunca contado'}
                        {s.unit_price_eur != null && ` · ${money(Number(s.unit_price_eur))}/${s.unit}`}
                      </div>
                    </td>
                    <td className="td text-right tabular-nums">{qty(s.stock_atual)}</td>
                    <td className="td text-right tabular-nums text-slate-500">
                      {s.por_chegar > 0 ? qty(s.por_chegar) : '—'}
                    </td>
                    <td className="td text-right tabular-nums text-slate-500">{qty(s.par_qty)}</td>
                    <td className={`td text-right tabular-nums ${(s.sugerido ?? 0) > 0 ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>
                      {s.sugerido == null ? '—' : qty(s.sugerido)}
                    </td>
                    <td className="td text-right">
                      <button
                        className="text-sm text-brand-600 hover:underline disabled:text-slate-300"
                        disabled={!editavel}
                        onClick={() => setNova({
                          item: s,
                          qty: s.sugerido ?? 0,
                          valor: (s.sugerido ?? 0) * Number(s.unit_price_eur ?? 0),
                          data: todayISO(), fornecedor: '', nota: '',
                        })}
                      >
                        encomendar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sugestoes.length === 0 && <div className="p-8 text-center text-sm text-slate-500">Sem itens.</div>}
          </div>
        </>
      )}

      {/* ------------------------------ Pendentes ------------------------------ */}
      {aba === 'pendentes' && (
        pendentes.length === 0 ? (
          <Empty>Não há encomendas por chegar.</Empty>
        ) : (
          <div className="space-y-2">
            {pendentes.map(p => (
              <div key={p.id} className="card flex flex-wrap items-center gap-3 border-l-4 border-l-amber-400 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">{p.items.name}</div>
                  <div className="text-xs text-slate-500">
                    encomendado a {dmy(p.order_date)}
                    {p.supplier && ` · ${p.supplier}`}
                    {p.note && ` · ${p.note}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{qty(p.qty)} {p.items.unit}</div>
                  <div className="text-xs text-slate-500 tabular-nums">{money(Number(p.amount_paid_eur))}</div>
                </div>
                <button
                  className="btn-primary"
                  disabled={!editavel}
                  onClick={() => setReceber({ p, data: todayISO(), qty: Number(p.qty) })}
                >
                  Chegou
                </button>
                <button className="text-sm text-slate-400 hover:text-red-600 disabled:opacity-40"
                        disabled={!editavel} onClick={() => apagar(p)}>apagar</button>
              </div>
            ))}
          </div>
        )
      )}

      {/* ------------------------------ Histórico ------------------------------ */}
      {aba === 'historico' && (
        recebidas.length === 0 ? (
          <Empty>Ainda não há encomendas recebidas.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Item</th>
                  <th className="th text-right">Quantidade</th>
                  <th className="th text-right">Valor</th>
                  <th className="th">Encomendada</th>
                  <th className="th">Chegou</th>
                  <th className="th">Fornecedor</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recebidas.map(p => (
                  <tr key={p.id}>
                    <td className="td font-medium">{p.items.name}</td>
                    <td className="td text-right tabular-nums">{qty(p.qty)} {p.items.unit}</td>
                    <td className="td text-right tabular-nums">{money(Number(p.amount_paid_eur))}</td>
                    <td className="td text-slate-500">{dmy(p.order_date)}</td>
                    <td className="td">{dmy(p.received_date!)}</td>
                    <td className="td text-slate-500">{p.supplier ?? '—'}</td>
                    <td className="td text-right">
                      <button className="text-sm text-slate-400 hover:text-red-600 disabled:opacity-40"
                              disabled={!editavel} onClick={() => apagar(p)}>apagar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <p className="text-xs text-slate-400">
        As quantidades contam para o consumo na contagem cuja semana inclui a <strong>data de chegada</strong>.
        Enquanto a encomenda estiver por chegar, não entra em nenhum cálculo.
      </p>

      {/* ------------------------------- Modais ------------------------------- */}
      <Modal open={!!nova} onClose={() => setNova(null)} title="Nova encomenda">
        {nova && (
          <div className="space-y-3">
            <div>
              <label className="label">Item *</label>
              <select
                className="input"
                value={nova.item?.item_id ?? ''}
                onChange={e => {
                  const it = stock.find(s => s.item_id === e.target.value)
                  setNova({ ...nova, item: it, valor: (nova.qty || 0) * Number(it?.unit_price_eur ?? 0) })
                }}
              >
                <option value="">— escolher —</option>
                {stock.map(s => <option key={s.item_id} value={s.item_id}>{s.item_name}</option>)}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Quantidade *</label>
                <NumInput value={nova.qty} onChange={n => setNova({
                  ...nova, qty: n,
                  valor: nova.item?.unit_price_eur != null
                    ? Number((n * Number(nova.item.unit_price_eur)).toFixed(2)) : nova.valor,
                })} />
              </div>
              <div>
                <label className="label">Valor total (€)</label>
                <NumInput value={nova.valor} onChange={n => setNova({ ...nova, valor: n })} />
              </div>
              <div>
                <label className="label">Data da encomenda</label>
                <input type="date" className="input" value={nova.data}
                       onChange={e => setNova({ ...nova, data: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Fornecedor</label>
                <input className="input" value={nova.fornecedor}
                       onChange={e => setNova({ ...nova, fornecedor: e.target.value })} />
              </div>
              <div>
                <label className="label">Nota</label>
                <input className="input" value={nova.nota}
                       onChange={e => setNova({ ...nova, nota: e.target.value })} />
              </div>
            </div>
            {nova.item && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Stock atual: {qty(nova.item.stock_atual)} {nova.item.unit}
                {nova.item.par_qty != null && ` · par: ${qty(nova.item.par_qty)}`}
                {nova.item.por_chegar > 0 && ` · já por chegar: ${qty(nova.item.por_chegar)}`}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setNova(null)}>Cancelar</button>
              <button className="btn-primary" onClick={guardarEncomenda} disabled={!nova.item}>Registar</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!receber} onClose={() => setReceber(null)} title="Registar chegada">
        {receber && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              <strong>{receber.p.items.name}</strong> — encomendado a {dmy(receber.p.order_date)}.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Quantidade recebida</label>
                <NumInput value={receber.qty} onChange={n => setReceber({ ...receber, qty: n })} />
              </div>
              <div>
                <label className="label">Data de chegada *</label>
                <input type="date" className="input" value={receber.data}
                       onChange={e => setReceber({ ...receber, data: e.target.value })} />
              </div>
            </div>
            {receber.qty !== Number(receber.p.qty) && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Recebeste {qty(receber.qty)} em vez dos {qty(receber.p.qty)} encomendados — o registo fica
                com a quantidade que indicares.
              </p>
            )}
            <p className="text-xs text-slate-500">
              A partir desta data, a quantidade passa a contar como entrada na contagem dessa semana.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setReceber(null)}>Cancelar</button>
              <button className="btn-primary" onClick={marcarRecebida}>Confirmar chegada</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
