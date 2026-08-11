import { supabase } from './supabase'
import type {
  Count, Department, Hotel, Item, Period, PeriodKind, Purchase, StockRow, VCount,
} from './types'
import { addDays, lastDayOfMonth } from './format'

export async function fetchHotels(): Promise<Hotel[]> {
  const { data, error } = await supabase.from('hotels').select('*').order('name')
  if (error) throw error
  return data as Hotel[]
}

/** Itens do departamento: FO/HSK são por hotel, F&B é catálogo partilhado. */
export async function fetchItems(
  dept: Department, hotelId: string, freq?: PeriodKind,
): Promise<Item[]> {
  let q = supabase.from('items').select('*').eq('department', dept).eq('active', true)
  q = dept === 'FB' ? q.is('hotel_id', null) : q.eq('hotel_id', hotelId)
  if (freq) q = q.eq('count_frequency', freq)
  const { data, error } = await q.order('name')
  if (error) throw error
  return data as Item[]
}

export async function fetchPeriods(
  dept: Department, hotelId: string, kind?: PeriodKind,
): Promise<Period[]> {
  let q = supabase.from('periods').select('*').eq('department', dept).eq('hotel_id', hotelId)
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q.order('end_date', { ascending: false })
  if (error) throw error
  return data as Period[]
}

/** Última contagem do mesmo tipo — define onde começa o período seguinte. */
export async function fetchLastPeriod(
  dept: Department, hotelId: string, kind: PeriodKind, before?: string,
): Promise<Period | null> {
  let q = supabase.from('periods').select('*')
    .eq('department', dept).eq('hotel_id', hotelId).eq('kind', kind)
  if (before) q = q.lt('end_date', before)
  const { data } = await q.order('end_date', { ascending: false }).limit(1).maybeSingle()
  return (data as Period) ?? null
}

/**
 * Cria um período que termina na data da contagem.
 * O início é sempre o dia seguinte à contagem anterior do mesmo tipo.
 */
export async function createPeriodAt(
  dept: Department, hotelId: string, kind: PeriodKind,
  countDate: string, startOverride?: string,
): Promise<Period> {
  const anterior = await fetchLastPeriod(dept, hotelId, kind, countDate)
  const start = startOverride
    ?? (anterior ? addDays(anterior.end_date, 1) : countDate)
  if (start > countDate) {
    throw new Error(
      `A contagem anterior terminou a ${anterior!.end_date}. A data da contagem tem de ser posterior.`,
    )
  }
  const { data, error } = await supabase
    .from('periods')
    .insert({
      hotel_id: hotelId, department: dept, kind,
      start_date: start, end_date: countDate,
      label: kind === 'mensal' ? countDate.slice(0, 7) : countDate,
    })
    .select().single()
  if (error) {
    if (error.code === '23505') throw new Error('Já existe uma contagem que começa nesse dia.')
    throw error
  }
  return data as Period
}

export async function fetchCounts(periodId: string): Promise<Count[]> {
  const { data, error } = await supabase.from('counts').select('*').eq('period_id', periodId)
  if (error) throw error
  return data as Count[]
}

/** Cria (ou devolve) o mês indicado ('2026-08'). */
export async function ensureMonth(dept: Department, hotelId: string, month: string) {
  const start = `${month}-01`
  const { data: existing } = await supabase
    .from('periods').select('*')
    .eq('hotel_id', hotelId).eq('department', dept).eq('kind', 'mensal')
    .eq('start_date', start).maybeSingle()
  if (existing) return existing as Period

  const { data, error } = await supabase
    .from('periods')
    .insert({
      hotel_id: hotelId, department: dept, kind: 'mensal',
      start_date: start, end_date: lastDayOfMonth(month), label: month,
    })
    .select().single()
  if (error) throw error
  return data as Period
}

/** Inventário final da contagem anterior do mesmo tipo — serve de inventário inicial. */
export async function fetchPreviousClosing(
  dept: Department, hotelId: string, kind: PeriodKind, beforeDate: string,
): Promise<Record<string, number>> {
  const { data: prev } = await supabase
    .from('periods').select('id')
    .eq('hotel_id', hotelId).eq('department', dept).eq('kind', kind)
    .lt('start_date', beforeDate)
    .order('end_date', { ascending: false })
    .limit(1).maybeSingle()

  if (prev) {
    const { data } = await supabase.from('counts').select('item_id, closing_qty').eq('period_id', prev.id)
    const out: Record<string, number> = {}
    for (const r of data ?? []) out[r.item_id] = Number(r.closing_qty)
    return out
  }

  // Primeira contagem deste tipo (por exemplo, um item que passou de semanal a
  // mensal): usa o último inventário final conhecido, seja de que tipo for.
  const { data } = await supabase
    .from('counts')
    .select('item_id, closing_qty, periods!inner(hotel_id, department, end_date)')
    .eq('periods.hotel_id', hotelId)
    .eq('periods.department', dept)
    .lt('periods.end_date', beforeDate)
    .order('periods(end_date)', { ascending: false })
    .limit(4000)
  const out: Record<string, number> = {}
  for (const r of (data ?? []) as unknown as { item_id: string; closing_qty: number }[]) {
    if (!(r.item_id in out)) out[r.item_id] = Number(r.closing_qty)
  }
  return out
}

export async function upsertCount(row: Partial<Count> & { period_id: string; item_id: string }) {
  const { error } = await supabase.from('counts').upsert(row, { onConflict: 'period_id,item_id' })
  if (error) throw error
}

export async function updatePeriod(id: string, patch: Partial<Period>) {
  const { error } = await supabase.from('periods').update(patch).eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error('Já existe outra contagem a começar nesse dia.')
    if (error.code === '23514') throw new Error('A data da contagem não pode ser anterior ao início do período.')
    throw error
  }
}

/** Apaga o período e, com ele, todas as contagens que lhe pertencem. */
export async function deletePeriod(id: string) {
  const { error } = await supabase.from('periods').delete().eq('id', id)
  if (error) throw error
}

/** Quantas linhas de contagem já foram registadas neste período. */
export async function countRowsIn(periodId: string): Promise<number> {
  const { count, error } = await supabase
    .from('counts').select('id', { count: 'exact', head: true }).eq('period_id', periodId)
  if (error) throw error
  return count ?? 0
}

/* ------------------------------- Encomendas ------------------------------- */

export async function fetchPurchases(hotelId: string, dept: Department) {
  const { data, error } = await supabase
    .from('purchases')
    .select('*, items!inner(id, name, department, unit, unit_price_eur)')
    .eq('hotel_id', hotelId)
    .eq('items.department', dept)
    .order('order_date', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as (Purchase & {
    items: { id: string; name: string; department: Department; unit: string; unit_price_eur: number | null }
  })[]
}

export async function fetchStock(hotelId: string, dept: Department): Promise<StockRow[]> {
  const { data, error } = await supabase
    .from('v_stock_atual')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('department', dept)
    .order('item_name')
  if (error) throw error
  return (data ?? []).map(r => ({
    ...r,
    par_qty: r.par_qty === null ? null : Number(r.par_qty),
    stock_atual: r.stock_atual === null ? null : Number(r.stock_atual),
    por_chegar: Number(r.por_chegar),
    sugerido: r.sugerido === null ? null : Number(r.sugerido),
    unit_price_eur: r.unit_price_eur === null ? null : Number(r.unit_price_eur),
  })) as StockRow[]
}

export async function createPurchase(p: {
  hotel_id: string; item_id: string; qty: number; amount_paid_eur: number
  order_date: string; supplier?: string | null; note?: string | null; created_by?: string | null
}) {
  const { error } = await supabase.from('purchases').insert(p)
  if (error) throw error
}

export async function receivePurchase(id: string, received_date: string, by: string | null, qty?: number) {
  const patch: Record<string, unknown> = { received_date, received_by: by }
  if (qty !== undefined) patch.qty = qty
  const { error } = await supabase.from('purchases').update(patch).eq('id', id)
  if (error) throw error
}

export async function deletePurchase(id: string) {
  const { error } = await supabase.from('purchases').delete().eq('id', id)
  if (error) throw error
}

/** Quantidades recebidas dentro de um período, por item. */
export async function fetchReceivedInPeriod(
  hotelId: string, start: string, end: string,
): Promise<Record<string, { qty: number; valor: number; encomendas: number }>> {
  const { data, error } = await supabase
    .from('purchases')
    .select('item_id, qty, amount_paid_eur')
    .eq('hotel_id', hotelId)
    .gte('received_date', start)
    .lte('received_date', end)
  if (error) throw error
  const out: Record<string, { qty: number; valor: number; encomendas: number }> = {}
  for (const r of data ?? []) {
    out[r.item_id] ??= { qty: 0, valor: 0, encomendas: 0 }
    out[r.item_id].qty += Number(r.qty)
    out[r.item_id].valor += Number(r.amount_paid_eur)
    out[r.item_id].encomendas++
  }
  return out
}

/** Linhas calculadas para dashboard / exportação. */
export async function fetchVCounts(filter: {
  hotelId?: string
  dept?: Department
  from?: string
  to?: string
  limit?: number
}): Promise<VCount[]> {
  let q = supabase.from('v_counts').select('*')
  if (filter.hotelId) q = q.eq('hotel_id', filter.hotelId)
  if (filter.dept) q = q.eq('department', filter.dept)
  if (filter.from) q = q.gte('start_date', filter.from)
  if (filter.to) q = q.lte('start_date', filter.to)
  const { data, error } = await q
    .order('start_date', { ascending: false })
    .limit(filter.limit ?? 20000)
  if (error) throw error
  return (data ?? []).map(r => ({
    ...r,
    opening_qty: Number(r.opening_qty),
    purchased_qty: Number(r.purchased_qty),
    received_qty: Number(r.received_qty),
    entradas_qty: Number(r.entradas_qty),
    par_qty: r.par_qty === null ? null : Number(r.par_qty),
    amount_paid_eur: Number(r.amount_paid_eur),
    closing_qty: Number(r.closing_qty),
    quebras: Number(r.quebras),
    used_qty: Number(r.used_qty),
    unit_price_eur: r.unit_price_eur === null ? null : Number(r.unit_price_eur),
    cost_used_eur: r.cost_used_eur === null ? null : Number(r.cost_used_eur),
    stock_value_eur: r.stock_value_eur === null ? null : Number(r.stock_value_eur),
    used_per_room: r.used_per_room === null ? null : Number(r.used_per_room),
    cost_per_room_eur: r.cost_per_room_eur === null ? null : Number(r.cost_per_room_eur),
  })) as VCount[]
}
