import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useApp } from '../lib/appState'
import { ensureMonth, fetchCounts, fetchItems, fetchPeriods, updatePeriod, upsertCount } from '../lib/data'
import type { Count, Item, Period } from '../lib/types'
import { MOTIVOS } from '../lib/types'
import { money, monthLabel, monthRange, qty } from '../lib/format'
import { Loading, NumInput, Spinner, useToast } from '../components/ui'
import { supabase } from '../lib/supabase'

type Entry = { qty: number; quebras: number; motivo: string | null; comentario: string | null }

export default function ContagemMensal() {
  const { hotelId } = useApp()
  const { canWrite, email } = useAuth()
  const toast = useToast()
  const editable = canWrite('FB')

  const [items, setItems] = useState<Item[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7))
  const [period, setPeriod] = useState<Period | null>(null)
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(0)
  const [cat, setCat] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // espelho sempre atualizado de `entries`, para o gravador diferido nunca ler estado velho
  const entriesRef = useRef<Record<string, Entry>>({})
  entriesRef.current = entries

  const meses = useMemo(() => {
    const base = monthRange(12, 1)
    const extra = periods.map(p => p.label)
    return [...new Set([...base, ...extra])].sort().reverse()
  }, [periods])

  useEffect(() => {
    if (!hotelId) return
    setLoading(true)
    Promise.all([fetchItems('FB', hotelId), fetchPeriods('FB', hotelId)])
      .then(([its, ps]) => { setItems(its); setPeriods(ps) })
      .finally(() => setLoading(false))
  }, [hotelId])

  useEffect(() => {
    if (!hotelId) return
    const p = periods.find(x => x.label === month) ?? null
    setPeriod(p)
    if (!p) { setEntries({}); return }
    fetchCounts(p.id).then(cs => {
      const e: Record<string, Entry> = {}
      for (const c of cs) {
        e[c.item_id] = {
          qty: Number(c.closing_qty),
          quebras: Number(c.quebras),
          motivo: c.motivo,
          comentario: c.comentario,
        }
      }
      setEntries(e)
    })
  }, [month, periods, hotelId])

  useEffect(() => {
    if (!period) return
    const ch = supabase
      .channel(`fb-${period.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'counts', filter: `period_id=eq.${period.id}` },
        payload => {
          const c = payload.new as Count
          if (!c?.item_id) return
          setEntries(e => ({
            ...e,
            [c.item_id]: {
              qty: Number(c.closing_qty), quebras: Number(c.quebras),
              motivo: c.motivo, comentario: c.comentario,
            },
          }))
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [period?.id])

  const categorias = useMemo(
    () => [...new Set(items.map(i => i.category ?? 'Sem categoria'))].sort(),
    [items],
  )
  useEffect(() => { if (!cat && categorias.length) setCat(categorias[0]) }, [categorias])

  const set = async (itemId: string, patch: Partial<Entry>) => {
    if (!editable || !hotelId) return
    const atual = entriesRef.current[itemId] ?? { qty: 0, quebras: 0, motivo: null, comentario: null }
    const novo = { ...atual, ...patch }
    setEntries(e => {
      const next = { ...e, [itemId]: novo }
      entriesRef.current = next
      return next
    })

    clearTimeout(timers.current[itemId])
    timers.current[itemId] = setTimeout(async () => {
      setSaving(s => s + 1)
      try {
        let p = period
        if (!p) {
          p = await ensureMonth('FB', hotelId, month)
          setPeriod(p)
          setPeriods(ps => [p!, ...ps])
        }
        await upsertCount({
          period_id: p.id,
          item_id: itemId,
          closing_qty: novo.qty,
          closing_counted: true,
          quebras: novo.quebras,
          motivo: novo.motivo,
          comentario: novo.comentario,
          updated_by: email,
        })
      } catch (e) {
        toast((e as Error).message, 'erro')
      } finally {
        setSaving(s => s - 1)
      }
    }, 700)
  }

  const valor = (i: Item, e?: Entry) => (e?.qty ?? 0) * Number(i.unit_price_eur ?? 0)

  const totaisPorCategoria = useMemo(() => {
    const t: Record<string, number> = {}
    for (const i of items) {
      const k = i.category ?? 'Sem categoria'
      t[k] = (t[k] ?? 0) + valor(i, entries[i.id])
    }
    return t
  }, [items, entries])
  const totalGeral = Object.values(totaisPorCategoria).reduce((a, b) => a + b, 0)

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (q) {
      return items.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.ref ?? '').toLowerCase().includes(q) ||
        (i.supplier ?? '').toLowerCase().includes(q))
    }
    return items.filter(i => (i.category ?? 'Sem categoria') === cat)
  }, [items, busca, cat])

  const grupos = useMemo(() => {
    if (busca.trim()) return [{ fornecedor: '', itens: filtrados }]
    const map: Record<string, Item[]> = {}
    for (const i of filtrados) {
      const f = i.supplier || 'Sem fornecedor'
      ;(map[f] ??= []).push(i)
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b, 'pt'))
      .map(([fornecedor, itens]) => ({ fornecedor, itens }))
  }, [filtrados, busca])

  if (loading) return <Loading />

  return (
    <div className="space-y-3">
      {/* cabeçalho */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[170px]">
          <label className="label">Mês</label>
          <select className="input" value={month} onChange={e => setMonth(e.target.value)}>
            {meses.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {saving > 0 && <span className="flex items-center gap-1 text-slate-500"><Spinner /> a guardar</span>}
          {period && (
            <span className={`chip ${period.status === 'submetido'
              ? 'bg-brand-100 text-brand-700' : 'bg-amber-100 text-amber-800'}`}>
              {period.status === 'submetido' ? 'Fechado' : 'Em contagem'}
            </span>
          )}
          {editable && period && period.status !== 'submetido' && (
            <button
              className="btn-primary"
              onClick={async () => {
                await updatePeriod(period.id, { status: 'submetido', submitted_at: new Date().toISOString() })
                setPeriod({ ...period, status: 'submetido' })
                toast('Mês fechado')
              }}
            >
              Fechar mês
            </button>
          )}
        </div>
      </div>

      {/* totais */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <div className="card shrink-0 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Total</div>
          <div className="text-base font-semibold tabular-nums text-brand-700">{money(totalGeral)}</div>
        </div>
        {categorias.map(c => (
          <div key={c} className="card shrink-0 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{c}</div>
            <div className="text-base font-semibold tabular-nums">{money(totaisPorCategoria[c] ?? 0)}</div>
          </div>
        ))}
      </div>

      {/* pesquisa */}
      <input
        className="input"
        placeholder="Pesquisar em todas as categorias (nome, referência, fornecedor)…"
        value={busca}
        onChange={e => setBusca(e.target.value)}
      />

      {/* separadores */}
      {!busca.trim() && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {categorias.map(c => {
            const n = items.filter(i => (i.category ?? 'Sem categoria') === c).length
            return (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
                  cat === c ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 border border-slate-200'
                }`}
              >
                {c} <span className="opacity-70">{n}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* lista */}
      <div className="space-y-4">
        {grupos.map(g => (
          <div key={g.fornecedor || 'busca'}>
            {g.fornecedor && (
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.fornecedor}</h3>
                <span className="text-xs tabular-nums text-slate-500">
                  {money(g.itens.reduce((s, i) => s + valor(i, entries[i.id]), 0))}
                </span>
              </div>
            )}
            <div className="space-y-1.5">
              {g.itens.map(i => {
                const e = entries[i.id]
                const temQtd = (e?.qty ?? 0) > 0
                const temQuebra = (e?.quebras ?? 0) > 0
                return (
                  <div
                    key={i.id}
                    className={`card overflow-hidden border-l-4 ${
                      temQuebra ? 'border-l-red-500' : temQtd ? 'border-l-brand-500' : 'border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 p-2.5">
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setAberto(a => (a === i.id ? null : i.id))}
                      >
                        <div className="truncate text-sm font-medium text-slate-800">{i.name}</div>
                        <div className="truncate text-[11px] text-slate-400">
                          {i.ref} · {i.unit} · {i.supplier || 'sem fornecedor'} · {money(Number(i.unit_price_eur ?? 0))}
                        </div>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          className="h-9 w-9 rounded-lg border border-slate-200 text-lg leading-none text-slate-600 disabled:opacity-40"
                          disabled={!editable}
                          onClick={() => set(i.id, { qty: Math.max(0, (e?.qty ?? 0) - 1) })}
                        >–</button>
                        <NumInput
                          className="w-20"
                          value={e?.qty ?? 0}
                          disabled={!editable}
                          onChange={n => set(i.id, { qty: n })}
                        />
                        <button
                          className="h-9 w-9 rounded-lg border border-slate-200 text-lg leading-none text-slate-600 disabled:opacity-40"
                          disabled={!editable}
                          onClick={() => set(i.id, { qty: (e?.qty ?? 0) + 1 })}
                        >+</button>
                      </div>

                      <div className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-700">
                        {money(valor(i, e))}
                      </div>
                    </div>

                    {aberto === i.id && (
                      <div className="grid gap-3 border-t border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-3">
                        <div>
                          <label className="label">Quebras</label>
                          <NumInput value={e?.quebras ?? 0} disabled={!editable}
                                    onChange={n => set(i.id, { quebras: n })} />
                        </div>
                        <div>
                          <label className="label">Motivo</label>
                          <select
                            className="input"
                            value={e?.motivo ?? ''}
                            disabled={!editable}
                            onChange={ev => set(i.id, { motivo: ev.target.value || null })}
                          >
                            <option value="">—</option>
                            {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label">Comentário</label>
                          <input className="input" value={e?.comentario ?? ''} disabled={!editable}
                                 onChange={ev => set(i.id, { comentario: ev.target.value || null })} />
                        </div>
                        <div className="text-xs text-slate-500 sm:col-span-3">
                          {qty(e?.qty ?? 0)} {i.unit} × {money(Number(i.unit_price_eur ?? 0))} = <strong>{money(valor(i, e))}</strong>
                          {temQuebra && <> · quebras: {qty(e?.quebras ?? 0)} {i.unit}</>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {filtrados.length === 0 && (
          <div className="card p-8 text-center text-sm text-slate-500">Nenhum item encontrado.</div>
        )}
      </div>
    </div>
  )
}
