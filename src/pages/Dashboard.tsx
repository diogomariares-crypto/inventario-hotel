import { useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useApp } from '../lib/appState'
import { fetchVCounts } from '../lib/data'
import type { Department, VCount } from '../lib/types'
import { deptLabel } from '../lib/types'
import { dm, dmy, money, monthLabel, qty } from '../lib/format'
import { Empty, Loading, StatCard } from '../components/ui'
import { useLembrado } from '../lib/lembrar'

const CORES: Record<string, string> = { FO: '#1a6b4a', HSK: '#b8860b', FB: '#3b6fb8' }

export default function Dashboard() {
  const { hotelId, hotels } = useApp()
  const [rows, setRows] = useState<VCount[]>([])
  const [loading, setLoading] = useState(true)
  const [meses, setMeses] = useLembrado('painel.meses', 6)
  const [item, setItem] = useState<string | null>(null)

  const desde = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - meses)
    return d.toISOString().slice(0, 10)
  }, [meses])

  useEffect(() => {
    if (!hotelId) return
    setLoading(true)
    fetchVCounts({ hotelId, from: desde })
      .then(setRows)
      .finally(() => setLoading(false))
  }, [hotelId, desde])

  /* ------------------------- semanal: custo por quarto ------------------------ */
  const semanal = useMemo(() => {
    const map: Record<string, { periodo: string; ordem: string; FO?: number; HSK?: number }> = {}
    const porPeriodo: Record<string, { dept: Department; custo: number; quartos: number | null; start: string; end: string }> = {}
    for (const r of rows) {
      if (r.kind !== 'semanal' || r.department === 'FB') continue
      const k = r.period_id
      porPeriodo[k] ??= { dept: r.department, custo: 0, quartos: r.occupied_rooms, start: r.start_date, end: r.end_date }
      porPeriodo[k].custo += r.cost_used_eur ?? 0
    }
    for (const p of Object.values(porPeriodo)) {
      if (!p.quartos) continue
      const key = p.start
      map[key] ??= { periodo: `${dm(p.start)}`, ordem: p.start }
      map[key][p.dept as 'FO' | 'HSK'] = Number((p.custo / p.quartos).toFixed(3))
    }
    return Object.values(map).sort((a, b) => a.ordem.localeCompare(b.ordem))
  }, [rows])

  /* ------------------------------ KPIs do topo ----------------------------- */
  const kpis = useMemo(() => {
    const ultimos: Record<string, { custo: number; quartos: number | null; label: string }> = {}
    for (const d of ['FO', 'HSK'] as Department[]) {
      const doDept = rows.filter(r => r.department === d && r.occupied_rooms)
      if (!doDept.length) continue
      const maisRecente = doDept.reduce((a, b) => (a.start_date > b.start_date ? a : b)).start_date
      const linhas = doDept.filter(r => r.start_date === maisRecente)
      ultimos[d] = {
        custo: linhas.reduce((s, r) => s + (r.cost_used_eur ?? 0), 0),
        quartos: linhas[0].occupied_rooms,
        label: `${dm(linhas[0].start_date)}–${dm(linhas[0].end_date)}`,
      }
    }
    const fb = rows.filter(r => r.kind === 'mensal')
    const mesRecente = fb.length ? fb.reduce((a, b) => (a.start_date > b.start_date ? a : b)).label : null
    const stockFB = fb.filter(r => r.label === mesRecente)
      .reduce((s, r) => s + (r.stock_value_eur ?? 0), 0)
    return { ultimos, mesRecente, stockFB }
  }, [rows])

  /* --------------------------- top itens por custo -------------------------- */
  const topItens = useMemo(() => {
    const map: Record<string, { nome: string; dept: Department; custo: number; quartos: number }> = {}
    for (const r of rows) {
      if (r.kind !== 'semanal' || !r.occupied_rooms || r.cost_used_eur == null) continue
      const k = r.item_id
      map[k] ??= { nome: r.item_name, dept: r.department, custo: 0, quartos: 0 }
      map[k].custo += r.cost_used_eur
    }
    const quartosPorDept: Record<string, number> = {}
    const vistos = new Set<string>()
    for (const r of rows) {
      if (r.kind !== 'semanal' || !r.occupied_rooms) continue
      const k = `${r.department}|${r.period_id}`
      if (vistos.has(k)) continue
      vistos.add(k)
      quartosPorDept[r.department] = (quartosPorDept[r.department] ?? 0) + r.occupied_rooms
    }
    return Object.entries(map)
      .map(([id, v]) => ({
        id, nome: v.nome, dept: v.dept,
        eurQuarto: quartosPorDept[v.dept] ? v.custo / quartosPorDept[v.dept] : 0,
        custo: v.custo,
      }))
      .sort((a, b) => b.eurQuarto - a.eurQuarto)
      .slice(0, 10)
  }, [rows])

  /* ------------------------------ drill-down ------------------------------- */
  const historicoItem = useMemo(() => {
    if (!item) return []
    return rows
      .filter(r => r.item_id === item)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
  }, [rows, item])

  if (loading) return <Loading />
  const hotel = hotels.find(h => h.id === hotelId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{hotel?.name}</h1>
          <p className="text-sm text-slate-500">Últimos {meses} meses</p>
        </div>
        <select className="input w-auto" value={meses} onChange={e => setMeses(Number(e.target.value))}>
          {[3, 6, 12, 24].map(m => <option key={m} value={m}>Últimos {m} meses</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <Empty>Ainda não há contagens registadas neste período.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(['FO', 'HSK'] as Department[]).map(d => (
              <StatCard
                key={d}
                tone="brand"
                label={`€/quarto · ${deptLabel(d)}`}
                value={kpis.ultimos[d] ? money(kpis.ultimos[d].custo / (kpis.ultimos[d].quartos ?? 1)) : '—'}
                hint={kpis.ultimos[d] ? `semana ${kpis.ultimos[d].label} · ${kpis.ultimos[d].quartos} quartos` : 'sem dados'}
              />
            ))}
            <StatCard
              label="€/quarto · total"
              value={
                kpis.ultimos.FO || kpis.ultimos.HSK
                  ? money(
                      (['FO', 'HSK'] as Department[]).reduce(
                        (s, d) => s + (kpis.ultimos[d] ? kpis.ultimos[d].custo / (kpis.ultimos[d].quartos ?? 1) : 0), 0))
                  : '—'
              }
              hint="FO + Housekeeping, semana mais recente"
            />
            <StatCard
              label="Stock F&B"
              value={money(kpis.stockFB)}
              hint={kpis.mesRecente ? monthLabel(kpis.mesRecente) : 'sem contagem'}
            />
          </div>

          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Custo por quarto ocupado, semana a semana
            </h2>
            {semanal.length === 0 ? (
              <Empty>Sem semanas com quartos ocupados preenchidos.</Empty>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={semanal} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="periodo" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8"
                           tickFormatter={v => `${v}€`} />
                    <Tooltip
                      formatter={((v: unknown, n: unknown) =>
                        [money(Number(v)), deptLabel(String(n) as Department)]) as never}
                      labelFormatter={l => `Semana de ${l}`}
                    />
                    <Legend formatter={v => deptLabel(v as Department)} />
                    <Line type="monotone" dataKey="FO" stroke={CORES.FO} strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="HSK" stroke={CORES.HSK} strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">
                Top 10 itens por custo/quarto no período
              </h2>
              {topItens.length === 0 ? (
                <Empty>Sem dados suficientes.</Empty>
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topItens} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={v => `${v}€`} />
                      <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <Tooltip formatter={((v: unknown) => money(Number(v))) as never} />
                      <Bar dataKey="eurQuarto" radius={[0, 4, 4, 0]}
                           onClick={(d: { id?: string }) => setItem(d.id ?? null)}>
                        {topItens.map(t => <Cell key={t.id} fill={CORES[t.dept]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="mt-1 text-xs text-slate-400">Clica numa barra para ver o histórico do item.</p>
            </div>

            <div className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">
                {item ? `Histórico · ${historicoItem[0]?.item_name ?? ''}` : 'Histórico do item'}
              </h2>
              {!item ? (
                <Empty>Escolhe um item no gráfico ao lado.</Empty>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-white">
                      <tr>
                        <th className="th">Período</th>
                        <th className="th text-right">Utilizado</th>
                        <th className="th text-right">Custo</th>
                        <th className="th text-right">€/quarto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {historicoItem.map(r => (
                        <tr key={r.id}>
                          <td className="td">{r.kind === 'mensal' ? monthLabel(r.label) : `${dm(r.start_date)}–${dm(r.end_date)}`}</td>
                          <td className="td text-right tabular-nums">{qty(r.used_qty)}</td>
                          <td className="td text-right tabular-nums">{money(r.cost_used_eur)}</td>
                          <td className="td text-right tabular-nums">{money(r.cost_per_room_eur)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <MesesTable rows={rows} />
        </>
      )}
    </div>
  )
}

function MesesTable({ rows }: { rows: VCount[] }) {
  const dados = useMemo(() => {
    const map: Record<string, { mes: string; FO: number; HSK: number; FB: number; quartos: number }> = {}
    const quartosVistos = new Set<string>()
    for (const r of rows) {
      const mes = r.start_date.slice(0, 7)
      map[mes] ??= { mes, FO: 0, HSK: 0, FB: 0, quartos: 0 }
      if (r.department === 'FB') map[mes].FB += r.stock_value_eur ?? 0
      else map[mes][r.department as 'FO' | 'HSK'] += r.cost_used_eur ?? 0
      const k = `${mes}|${r.period_id}`
      if (r.occupied_rooms && !quartosVistos.has(k) && r.department === 'HSK') {
        quartosVistos.add(k)
        map[mes].quartos += r.occupied_rooms
      }
    }
    return Object.values(map).sort((a, b) => b.mes.localeCompare(a.mes))
  }, [rows])

  if (!dados.length) return null
  return (
    <div className="card overflow-x-auto">
      <h2 className="p-4 pb-2 text-sm font-semibold text-slate-700">Totais por mês</h2>
      <table className="w-full min-w-[620px]">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Mês</th>
            <th className="th text-right">Consumo FO</th>
            <th className="th text-right">Consumo HSK</th>
            <th className="th text-right">Stock F&amp;B</th>
            <th className="th text-right">Quartos (HSK)</th>
            <th className="th text-right">€/quarto FO+HSK</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {dados.map(d => (
            <tr key={d.mes}>
              <td className="td font-medium">{monthLabel(d.mes)}</td>
              <td className="td text-right tabular-nums">{money(d.FO)}</td>
              <td className="td text-right tabular-nums">{money(d.HSK)}</td>
              <td className="td text-right tabular-nums">{money(d.FB)}</td>
              <td className="td text-right tabular-nums">{d.quartos || '—'}</td>
              <td className="td text-right tabular-nums font-medium">
                {d.quartos ? money((d.FO + d.HSK) / d.quartos) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-slate-400">
        Última atualização dos dados: {rows[0] ? dmy(rows[0].updated_at.slice(0, 10)) : '—'}
      </p>
    </div>
  )
}
