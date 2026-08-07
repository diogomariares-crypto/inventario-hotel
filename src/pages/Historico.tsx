import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { fetchVCounts } from '../lib/data'
import type { Department, VCount } from '../lib/types'
import { DEPARTMENTS } from '../lib/types'
import { dm, downloadCSV, money, monthLabel, qty } from '../lib/format'
import { Empty, Loading } from '../components/ui'

export default function Historico() {
  const { hotelId, hotels } = useApp()
  const [dept, setDept] = useState<Department | ''>('')
  const [rows, setRows] = useState<VCount[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    if (!hotelId) return
    setLoading(true)
    fetchVCounts({ hotelId, dept: dept || undefined })
      .then(setRows)
      .finally(() => setLoading(false))
  }, [hotelId, dept])

  const periodos = useMemo(() => {
    const map: Record<string, {
      id: string; label: string; ordem: string; dept: Department
      linhas: number; custo: number; stock: number; quartos: number | null; status: string
    }> = {}
    for (const r of rows) {
      map[r.period_id] ??= {
        id: r.period_id,
        label: r.kind === 'mensal' ? monthLabel(r.label) : `${dm(r.start_date)} – ${dm(r.end_date)}`,
        ordem: r.start_date,
        dept: r.department,
        linhas: 0, custo: 0, stock: 0,
        quartos: r.occupied_rooms,
        status: r.status,
      }
      const p = map[r.period_id]
      p.linhas++
      p.custo += r.cost_used_eur ?? 0
      p.stock += r.stock_value_eur ?? 0
    }
    const lista = Object.values(map).sort((a, b) => b.ordem.localeCompare(a.ordem))
    const q = busca.trim().toLowerCase()
    return q ? lista.filter(p => p.label.toLowerCase().includes(q)) : lista
  }, [rows, busca])

  const exportar = () => {
    const hotel = hotels.find(h => h.id === hotelId)?.slug ?? 'hotel'
    downloadCSV(`inventario_${hotel}${dept ? '_' + dept : ''}.csv`, [
      ['departamento', 'tipo', 'periodo_inicio', 'periodo_fim', 'quartos_ocupados', 'item',
       'referencia', 'categoria', 'fornecedor', 'unidade', 'preco_unitario_eur',
       'inv_inicial', 'recebido_encomendas', 'outras_entradas', 'valor_pago_eur',
       'inv_final', 'quebras',
       'utilizado', 'custo_utilizado_eur', 'valor_stock_eur', 'custo_por_quarto_eur'],
      ...rows.map(r => [
        r.department, r.kind, r.start_date, r.end_date, r.occupied_rooms, r.item_name,
        r.ref, r.category, r.supplier, r.unit, r.unit_price_eur,
        r.opening_qty, r.received_qty, r.purchased_qty, r.amount_paid_eur,
        r.closing_qty, r.quebras,
        r.used_qty, r.cost_used_eur, r.stock_value_eur, r.cost_per_room_eur,
      ]),
    ])
  }

  if (loading) return <Loading />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Departamento</label>
          <select className="input w-auto" value={dept} onChange={e => setDept(e.target.value as Department | '')}>
            <option value="">Todos</option>
            {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="label">Procurar período</label>
          <input className="input" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Ex: Junho, 25/08…" />
        </div>
        <button className="btn-ghost" onClick={exportar} disabled={!rows.length}>Exportar CSV</button>
      </div>

      {periodos.length === 0 ? (
        <Empty>Sem períodos registados.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Período</th>
                <th className="th">Dep.</th>
                <th className="th text-right">Linhas</th>
                <th className="th text-right">Quartos</th>
                <th className="th text-right">Consumo</th>
                <th className="th text-right">Valor em stock</th>
                <th className="th text-right">€/quarto</th>
                <th className="th">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {periodos.map(p => (
                <tr key={p.id}>
                  <td className="td font-medium">{p.label}</td>
                  <td className="td">{p.dept}</td>
                  <td className="td text-right tabular-nums">{p.linhas}</td>
                  <td className="td text-right tabular-nums">{p.quartos ?? '—'}</td>
                  <td className="td text-right tabular-nums">{p.dept === 'FB' ? '—' : money(p.custo)}</td>
                  <td className="td text-right tabular-nums">{money(p.stock)}</td>
                  <td className="td text-right tabular-nums">
                    {p.quartos && p.dept !== 'FB' ? money(p.custo / p.quartos) : '—'}
                  </td>
                  <td className="td">
                    <span className={`chip ${p.status === 'submetido'
                      ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-800'}`}>
                      {p.status === 'submetido' ? 'Fechado' : 'Rascunho'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400">{qty(rows.length)} linhas de contagem carregadas.</p>
    </div>
  )
}
