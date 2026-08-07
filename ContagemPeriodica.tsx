import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useApp } from '../lib/appState'
import {
  createPeriodAt, fetchCounts, fetchItems, fetchLastPeriod, fetchPeriods,
  fetchPreviousClosing, fetchReceivedInPeriod, updatePeriod, upsertCount,
} from '../lib/data'
import type { Count, Department, Item, Period, PeriodKind } from '../lib/types'
import { addDays, dmy, lastDayOfMonth, money, qty, todayISO } from '../lib/format'
import { Loading, Modal, NumInput, Spinner, useToast } from '../components/ui'
import { supabase } from '../lib/supabase'

type Row = Count & { item: Item }

const FREQ: { value: PeriodKind; label: string; nota: string }[] = [
  { value: 'semanal', label: 'Semanal', nota: 'itens contados todas as semanas' },
  { value: 'mensal', label: 'Mensal', nota: 'itens contados uma vez por mês' },
]

export default function ContagemPeriodica({ dept }: { dept: Department }) {
  const { hotelId } = useApp()
  const { canWrite, isAdmin, email } = useAuth()
  const toast = useToast()
  const editable = canWrite(dept)

  const [freq, setFreq] = useState<PeriodKind>('semanal')
  const [periods, setPeriods] = useState<Period[]>([])
  const [period, setPeriod] = useState<Period | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [recebido, setRecebido] = useState<Record<string, { qty: number; valor: number; encomendas: number }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(0)
  const [nova, setNova] = useState<{ data: string; inicio: string; primeira: boolean } | null>(null)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const rowsRef = useRef<Record<string, Row>>({})
  rowsRef.current = rows

  /* ------------------------------ carregamento ----------------------------- */
  useEffect(() => {
    if (!hotelId) return
    setLoading(true)
    Promise.all([fetchPeriods(dept, hotelId, freq), fetchItems(dept, hotelId, freq)])
      .then(([ps, its]) => {
        setPeriods(ps)
        setItems(its)
        setPeriod(ps[0] ?? null)
      })
      .catch(e => toast((e as Error).message, 'erro'))
      .finally(() => setLoading(false))
  }, [hotelId, dept, freq])

  useEffect(() => {
    if (!period) { setRows({}); setRecebido({}); return }
    let alive = true
    ;(async () => {
      const [cs, prev, rec] = await Promise.all([
        fetchCounts(period.id),
        fetchPreviousClosing(dept, period.hotel_id, freq, period.start_date),
        fetchReceivedInPeriod(period.hotel_id, period.start_date, period.end_date),
      ])
      if (!alive) return
      setRecebido(rec)
      const byItem: Record<string, Count> = {}
      for (const c of cs) byItem[c.item_id] = c
      const next: Record<string, Row> = {}
      for (const it of items) {
        const c = byItem[it.id]
        next[it.id] = {
          id: c?.id ?? '',
          period_id: period.id,
          item_id: it.id,
          opening_qty: c ? Number(c.opening_qty) : (prev[it.id] ?? 0),
          purchased_qty: c ? Number(c.purchased_qty) : 0,
          amount_paid_eur: c ? Number(c.amount_paid_eur) : 0,
          closing_qty: c ? Number(c.closing_qty) : 0,
          closing_counted: c?.closing_counted ?? false,
          quebras: c ? Number(c.quebras) : 0,
          motivo: c?.motivo ?? null,
          comentario: c?.comentario ?? null,
          unit_price_eur: c?.unit_price_eur ?? null,
          updated_by: c?.updated_by ?? null,
          updated_at: c?.updated_at ?? '',
          item: it,
        }
      }
      setRows(next)
      rowsRef.current = next
    })()
    return () => { alive = false }
  }, [period?.id, items])

  /* -------------------------------- realtime ------------------------------- */
  useEffect(() => {
    if (!period) return
    const ch = supabase
      .channel(`counts-${period.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'counts', filter: `period_id=eq.${period.id}` },
        payload => {
          const c = payload.new as Count
          if (!c?.item_id) return
          setRows(r => (r[c.item_id]
            ? { ...r, [c.item_id]: { ...r[c.item_id], ...c,
                opening_qty: Number(c.opening_qty), purchased_qty: Number(c.purchased_qty),
                amount_paid_eur: Number(c.amount_paid_eur), closing_qty: Number(c.closing_qty) } }
            : r))
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [period?.id])

  /* --------------------------------- gravar -------------------------------- */
  const save = (itemId: string, patch: Partial<Count>) => {
    if (!period || !editable) return
    setRows(r => {
      const next = { ...r, [itemId]: { ...r[itemId], ...patch } }
      rowsRef.current = next
      return next
    })
    clearTimeout(timers.current[itemId])
    timers.current[itemId] = setTimeout(async () => {
      const r = rowsRef.current[itemId]
      setSaving(s => s + 1)
      try {
        await upsertCount({
          period_id: period.id, item_id: itemId,
          opening_qty: r.opening_qty,
          purchased_qty: r.purchased_qty,
          amount_paid_eur: r.amount_paid_eur,
          closing_qty: r.closing_qty,
          closing_counted: true,
          updated_by: email,
        })
      } catch (e) {
        toast((e as Error).message, 'erro')
      } finally { setSaving(s => s - 1) }
    }, 700)
  }

  /* --------------------------- criar nova contagem -------------------------- */
  const abrirNova = async () => {
    if (!hotelId) return
    const ultimo = await fetchLastPeriod(dept, hotelId, freq)
    const hoje = todayISO()
    const sugerida = freq === 'mensal' ? lastDayOfMonth(hoje.slice(0, 7)) : hoje
    setNova({
      data: ultimo && sugerida <= ultimo.end_date ? addDays(ultimo.end_date, 1) : sugerida,
      inicio: ultimo ? addDays(ultimo.end_date, 1) : hoje,
      primeira: !ultimo,
    })
  }

  const criar = async () => {
    if (!nova || !hotelId) return
    try {
      const p = await createPeriodAt(dept, hotelId, freq, nova.data, nova.primeira ? nova.inicio : undefined)
      const ps = await fetchPeriods(dept, hotelId, freq)
      setPeriods(ps)
      setPeriod(ps.find(x => x.id === p.id) ?? p)
      setNova(null)
      toast('Contagem criada')
    } catch (e) { toast((e as Error).message, 'erro') }
  }

  const submeter = async () => {
    if (!period) return
    const faltam = Object.values(rows).filter(r => !r.closing_counted && !r.id).length
    if (faltam && !confirm(`${faltam} itens ainda sem contagem. Fechar na mesma?`)) return
    await updatePeriod(period.id, { status: 'submetido', submitted_at: new Date().toISOString() })
    setPeriod({ ...period, status: 'submetido' })
    setPeriods(ps => ps.map(p => (p.id === period.id ? { ...p, status: 'submetido' } : p)))
    toast('Contagem fechada')
  }

  /* -------------------------------- cálculos ------------------------------- */
  const list = useMemo(() => items.map(i => rows[i.id]).filter(Boolean), [items, rows])
  const entradas = (r: Row) => r.purchased_qty + (recebido[r.item_id]?.qty ?? 0)
  const usado = (r: Row) => r.opening_qty + entradas(r) - r.closing_qty

  const totals = useMemo(() => {
    let cost = 0, paid = 0, negativos = 0, comEncomenda = 0, porContar = 0
    for (const r of list) {
      const used = usado(r)
      if (used < 0) negativos++
      if (!r.id && !r.closing_counted) porContar++
      if (r.item.unit_price_eur != null) cost += used * Number(r.item.unit_price_eur)
      paid += r.amount_paid_eur + (recebido[r.item_id]?.valor ?? 0)
      if (recebido[r.item_id]) comEncomenda++
    }
    return { cost, paid, negativos, comEncomenda, porContar }
  }, [list, recebido])

  const rooms = period?.occupied_rooms ?? null
  const etiqueta = (p: Period) =>
    `Contagem de ${dmy(p.end_date)}${p.status === 'submetido' ? ' ✓' : ''}`

  if (loading) return <Loading />

  return (
    <div className="space-y-4">
      {/* periodicidade */}
      <div className="flex flex-wrap items-center gap-2">
        {FREQ.map(f => {
          const n = items.length
          return (
            <button
              key={f.value}
              onClick={() => setFreq(f.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                freq === f.value ? 'bg-slate-800 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              title={f.nota}
            >
              {f.label}{freq === f.value && n > 0 && <span className="ml-1.5 opacity-70">{n}</span>}
            </button>
          )
        })}
        <span className="text-xs text-slate-400">
          a periodicidade de cada item define-se em <em>Itens</em>
        </span>
      </div>

      {/* barra de período */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[210px] flex-1">
          <label className="label">Contagem</label>
          <select
            className="input"
            value={period?.id ?? ''}
            onChange={e => setPeriod(periods.find(p => p.id === e.target.value) ?? null)}
          >
            {periods.length === 0 && <option value="">— ainda sem contagens —</option>}
            {periods.map(p => <option key={p.id} value={p.id}>{etiqueta(p)}</option>)}
          </select>
        </div>

        <div className="w-36">
          <label className="label">Quartos ocupados</label>
          <NumInput
            value={rooms ?? 0}
            disabled={!editable || !period}
            onChange={n => {
              if (!period) return
              setPeriod({ ...period, occupied_rooms: n || null })
              updatePeriod(period.id, { occupied_rooms: n || null }).catch(e => toast(e.message, 'erro'))
            }}
          />
        </div>

        <button className="btn-ghost" onClick={abrirNova} disabled={!editable}>
          + Nova contagem
        </button>

        {period && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            {saving > 0 && <span className="flex items-center gap-1 text-slate-500"><Spinner /> a guardar</span>}
            <span className={`chip ${period.status === 'submetido'
              ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-800'}`}>
              {period.status === 'submetido' ? 'Fechada' : 'Em curso'}
            </span>
            {editable && period.status !== 'submetido' && (
              <button className="btn-primary" onClick={submeter}>Fechar contagem</button>
            )}
          </div>
        )}
      </div>

      {!period ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          {items.length === 0
            ? <>Não há itens {freq === 'mensal' ? 'mensais' : 'semanais'} neste departamento.
                Define a periodicidade dos itens em <Link to="/itens" className="text-brand-600 hover:underline">Itens</Link>.</>
            : <>Ainda não há contagens {freq === 'mensal' ? 'mensais' : 'semanais'} para este hotel.
                <div className="mt-3"><button className="btn-primary" onClick={abrirNova}>Criar primeira contagem</button></div></>}
        </div>
      ) : (
        <>
          {/* cabeçalho do período */}
          <div className="card flex flex-wrap items-baseline justify-between gap-2 bg-slate-50 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">
                Contada a {dmy(period.end_date)}
              </div>
              <div className="text-xs text-slate-500">
                Cobre o consumo de {dmy(period.start_date)} a {dmy(period.end_date)}
                {' · '}{Math.round((Date.parse(period.end_date) - Date.parse(period.start_date)) / 86400000) + 1} dias
              </div>
            </div>
            <div className="text-xs text-slate-500">
              A próxima contagem começa a {dmy(addDays(period.end_date, 1))}
            </div>
          </div>

          {/* resumo */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-3">
              <div className="text-xs text-slate-500">Custo consumido</div>
              <div className="text-lg font-semibold tabular-nums">{money(totals.cost)}</div>
            </div>
            <div className="card p-3">
              <div className="text-xs text-slate-500">Custo / quarto</div>
              <div className="text-lg font-semibold tabular-nums">
                {rooms ? money(totals.cost / rooms) : '—'}
              </div>
            </div>
            <div className="card p-3">
              <div className="text-xs text-slate-500">Por contar</div>
              <div className="text-lg font-semibold tabular-nums">{totals.porContar}</div>
            </div>
            <div className={`card p-3 ${totals.negativos ? 'border-red-200 bg-red-50' : ''}`}>
              <div className="text-xs text-slate-500">Inconsistentes</div>
              <div className={`text-lg font-semibold tabular-nums ${totals.negativos ? 'text-red-600' : ''}`}>
                {totals.negativos}
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-500">
            O inventário inicial vem da contagem anterior e a coluna <strong>Recebido</strong> soma as
            encomendas que chegaram entre {dmy(period.start_date)} e {dmy(period.end_date)}
            {totals.comEncomenda > 0 && ` (${totals.comEncomenda} ${totals.comEncomenda === 1 ? 'item' : 'itens'})`}.{' '}
            <Link to="/encomendas" className="text-brand-600 hover:underline">Gerir encomendas</Link>
          </div>

          {/* tabela */}
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Item</th>
                  <th className="th text-right">Inv. inicial</th>
                  <th className="th text-right" title="Encomendas que chegaram dentro deste período">Recebido</th>
                  <th className="th text-right" title="Entradas sem encomenda registada">Outras entradas</th>
                  <th className="th text-right">Valor pago</th>
                  <th className="th text-right">Inv. final</th>
                  <th className="th text-right">Utilizado</th>
                  <th className="th text-right">Custo</th>
                  <th className="th text-right">€/quarto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map(r => {
                  const used = usado(r)
                  const rec = recebido[r.item_id]
                  const price = r.item.unit_price_eur == null ? null : Number(r.item.unit_price_eur)
                  const cost = price == null ? null : used * price
                  return (
                    <tr key={r.item_id} className={used < 0 ? 'bg-red-50/60' : ''}>
                      <td className="td">
                        <div className="font-medium text-slate-800">{r.item.name}</div>
                        <div className="text-xs text-slate-400">
                          {price == null ? 'sem preço' : `${money(price)} / ${r.item.unit}`}
                        </div>
                      </td>
                      <td className="td w-24">
                        <NumInput
                          value={r.opening_qty}
                          disabled={!editable || !isAdmin}
                          title={isAdmin ? '' : 'Vem da contagem anterior — só o administrador altera'}
                          onChange={n => save(r.item_id, { opening_qty: n })}
                        />
                      </td>
                      <td className="td w-24 text-right">
                        {rec ? (
                          <span
                            className="inline-flex items-center rounded-md bg-brand-50 px-2 py-1 text-sm font-medium tabular-nums text-brand-700"
                            title={`${rec.encomendas} ${rec.encomendas === 1 ? 'encomenda chegou' : 'encomendas chegaram'} neste período`}
                          >{qty(rec.qty)}</span>
                        ) : <span className="text-sm text-slate-300">—</span>}
                      </td>
                      <td className="td w-24">
                        <NumInput value={r.purchased_qty} disabled={!editable}
                                  onChange={n => save(r.item_id, { purchased_qty: n })} />
                      </td>
                      <td className="td w-28">
                        <NumInput value={r.amount_paid_eur} disabled={!editable}
                                  onChange={n => save(r.item_id, { amount_paid_eur: n })} />
                        {rec && rec.valor > 0 && (
                          <div className="mt-0.5 text-right text-[10px] text-slate-400">
                            +{money(rec.valor)} encomendas
                          </div>
                        )}
                      </td>
                      <td className="td w-24">
                        <NumInput value={r.closing_qty} disabled={!editable}
                                  onChange={n => save(r.item_id, { closing_qty: n })} />
                      </td>
                      <td className={`td text-right tabular-nums ${used < 0 ? 'font-semibold text-red-600' : ''}`}>
                        {qty(used)}
                      </td>
                      <td className="td text-right tabular-nums">{money(cost)}</td>
                      <td className="td text-right tabular-nums">
                        {rooms && cost != null ? money(cost / rooms) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totals.negativos > 0 && (
            <p className="text-sm text-red-600">
              {totals.negativos} {totals.negativos === 1 ? 'linha tem' : 'linhas têm'} consumo negativo
              (inventário final maior do que inicial + entradas). Confirma a contagem.
            </p>
          )}
        </>
      )}

      {/* modal nova contagem */}
      <Modal open={!!nova} onClose={() => setNova(null)} title="Nova contagem">
        {nova && (
          <div className="space-y-3">
            {nova.primeira && (
              <div>
                <label className="label">Primeiro dia do período</label>
                <input type="date" className="input" value={nova.inicio}
                       onChange={e => setNova({ ...nova, inicio: e.target.value })} />
                <p className="mt-1 text-xs text-slate-500">
                  Como é a primeira contagem deste tipo, indica onde começa o período.
                  Nas seguintes isto é automático.
                </p>
              </div>
            )}
            <div>
              <label className="label">Data da contagem *</label>
              <input type="date" className="input" value={nova.data}
                     onChange={e => setNova({ ...nova, data: e.target.value })} />
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              O período vai de <strong>{dmy(nova.primeira ? nova.inicio : nova.inicio)}</strong> a{' '}
              <strong>{dmy(nova.data)}</strong>.
              <div className="mt-1 text-xs text-slate-500">
                O inventário inicial é copiado do inventário final da contagem anterior, e as encomendas
                que chegarem dentro destas datas entram automaticamente.
              </div>
            </div>
            {nova.data < nova.inicio && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                A data da contagem tem de ser igual ou posterior a {dmy(nova.inicio)}.
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setNova(null)}>Cancelar</button>
              <button className="btn-primary" onClick={criar} disabled={nova.data < nova.inicio}>
                Criar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
