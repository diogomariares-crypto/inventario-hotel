import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useApp } from '../lib/appState'
import {
  ensureWeek, fetchCounts, fetchItems, fetchPeriods, fetchPreviousClosing,
  updatePeriod, upsertCount,
} from '../lib/data'
import type { Count, Department, Item, Period } from '../lib/types'
import { addDays, dmy, money, qty, todayISO, weekLabel } from '../lib/format'
import { Loading, NumInput, Spinner, useToast } from '../components/ui'
import { supabase } from '../lib/supabase'

type Row = Count & { item: Item }

export default function ContagemSemanal({ dept }: { dept: Department }) {
  const { hotelId } = useApp()
  const { canWrite, isAdmin, email } = useAuth()
  const toast = useToast()
  const editable = canWrite(dept)

  const [periods, setPeriods] = useState<Period[]>([])
  const [period, setPeriod] = useState<Period | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(0)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // espelho sempre atualizado de `rows`, para o gravador diferido nunca ler estado velho
  const rowsRef = useRef<Record<string, Row>>({})
  rowsRef.current = rows

  /* ------------------------------ carregamento ----------------------------- */
  useEffect(() => {
    if (!hotelId) return
    setLoading(true)
    Promise.all([fetchPeriods(dept, hotelId), fetchItems(dept, hotelId)])
      .then(([ps, its]) => {
        setPeriods(ps)
        setItems(its)
        setPeriod(ps[0] ?? null)
      })
      .finally(() => setLoading(false))
  }, [hotelId, dept])

  useEffect(() => {
    if (!period) { setRows({}); return }
    let alive = true
    ;(async () => {
      const [cs, prev] = await Promise.all([
        fetchCounts(period.id),
        fetchPreviousClosing(dept, period.hotel_id, period.start_date),
      ])
      if (!alive) return
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
          period_id: period.id,
          item_id: itemId,
          opening_qty: r.opening_qty,
          purchased_qty: r.purchased_qty,
          amount_paid_eur: r.amount_paid_eur,
          closing_qty: r.closing_qty,
          closing_counted: true,
          updated_by: email,
        })
      } catch (e) {
        toast((e as Error).message, 'erro')
      } finally {
        setSaving(s => s - 1)
      }
    }, 700)
  }

  const novaSemana = async () => {
    if (!hotelId) return
    const hoje = todayISO()
    const p = await ensureWeek(dept, hotelId, hoje)
    const ps = await fetchPeriods(dept, hotelId)
    setPeriods(ps)
    setPeriod(ps.find(x => x.id === p.id) ?? p)
    toast('Semana pronta')
  }

  const submeter = async () => {
    if (!period) return
    const faltam = Object.values(rows).filter(r => !r.closing_counted && !r.id).length
    if (faltam && !confirm(`${faltam} itens ainda sem contagem. Submeter na mesma?`)) return
    await updatePeriod(period.id, { status: 'submetido', submitted_at: new Date().toISOString() })
    setPeriod({ ...period, status: 'submetido' })
    setPeriods(ps => ps.map(p => (p.id === period.id ? { ...p, status: 'submetido' } : p)))
    toast('Semana submetida')
  }

  /* -------------------------------- cálculos ------------------------------- */
  const list = useMemo(
    () => items.map(i => rows[i.id]).filter(Boolean),
    [items, rows],
  )
  const totals = useMemo(() => {
    let cost = 0, paid = 0, negativos = 0
    for (const r of list) {
      const used = r.opening_qty + r.purchased_qty - r.closing_qty
      if (used < 0) negativos++
      if (r.item.unit_price_eur != null) cost += used * Number(r.item.unit_price_eur)
      paid += r.amount_paid_eur
    }
    return { cost, paid, negativos }
  }, [list])

  const rooms = period?.occupied_rooms ?? null

  if (loading) return <Loading />

  return (
    <div className="space-y-4">
      {/* barra de período */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[190px] flex-1">
          <label className="label">Semana</label>
          <select
            className="input"
            value={period?.id ?? ''}
            onChange={e => setPeriod(periods.find(p => p.id === e.target.value) ?? null)}
          >
            {periods.length === 0 && <option value="">— sem semanas —</option>}
            {periods.map(p => (
              <option key={p.id} value={p.id}>
                {weekLabel(p.start_date, p.end_date)}
                {p.status === 'submetido' ? ' ✓' : ''}
              </option>
            ))}
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

        <button className="btn-ghost" onClick={novaSemana} disabled={!editable}>
          + Semana atual
        </button>

        {period && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            {saving > 0 && <span className="flex items-center gap-1 text-slate-500"><Spinner /> a guardar</span>}
            <span className={`chip ${period.status === 'submetido'
              ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-800'}`}>
              {period.status === 'submetido' ? 'Submetida' : 'Rascunho'}
            </span>
            {editable && period.status !== 'submetido' && (
              <button className="btn-primary" onClick={submeter}>Submeter</button>
            )}
          </div>
        )}
      </div>

      {!period ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          Ainda não há semanas para este hotel e departamento.
          <div className="mt-3"><button className="btn-primary" onClick={novaSemana}>Criar semana atual</button></div>
        </div>
      ) : (
        <>
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
              <div className="text-xs text-slate-500">Valor pago (compras)</div>
              <div className="text-lg font-semibold tabular-nums">{money(totals.paid)}</div>
            </div>
            <div className={`card p-3 ${totals.negativos ? 'border-red-200 bg-red-50' : ''}`}>
              <div className="text-xs text-slate-500">Contagens inconsistentes</div>
              <div className={`text-lg font-semibold tabular-nums ${totals.negativos ? 'text-red-600' : ''}`}>
                {totals.negativos}
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-500">
            Período {dmy(period.start_date)} a {dmy(period.end_date)} · inventário inicial preenchido
            automaticamente com o inventário final da semana anterior.
          </div>

          {/* tabela */}
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Item</th>
                  <th className="th text-right">Inv. inicial</th>
                  <th className="th text-right">Comprado</th>
                  <th className="th text-right">Valor pago</th>
                  <th className="th text-right">Inv. final</th>
                  <th className="th text-right">Utilizado</th>
                  <th className="th text-right">Custo</th>
                  <th className="th text-right">€/quarto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map(r => {
                  const used = r.opening_qty + r.purchased_qty - r.closing_qty
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
                          title={isAdmin ? '' : 'Só o administrador altera o inventário inicial'}
                          onChange={n => save(r.item_id, { opening_qty: n })}
                        />
                      </td>
                      <td className="td w-24">
                        <NumInput value={r.purchased_qty} disabled={!editable}
                                  onChange={n => save(r.item_id, { purchased_qty: n })} />
                      </td>
                      <td className="td w-28">
                        <NumInput value={r.amount_paid_eur} disabled={!editable}
                                  onChange={n => save(r.item_id, { amount_paid_eur: n })} />
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
              {totals.negativos} {totals.negativos === 1 ? 'linha tem' : 'linhas têm'} consumo
              negativo (inventário final maior que inicial + compras). Confirma a contagem.
            </p>
          )}
          <p className="text-xs text-slate-400">
            Próxima semana começa a {dmy(addDays(period.end_date, 1))}.
          </p>
        </>
      )}
    </div>
  )
}
