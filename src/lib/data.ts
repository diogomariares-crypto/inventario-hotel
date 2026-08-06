import { supabase } from './supabase'
import type { Count, Department, Hotel, Item, Period, VCount } from './types'
import { addDays, lastDayOfMonth, mondayOf } from './format'

export async function fetchHotels(): Promise<Hotel[]> {
  const { data, error } = await supabase.from('hotels').select('*').order('name')
  if (error) throw error
  return data as Hotel[]
}

/** Itens do departamento: FO/HSK são por hotel, F&B é catálogo partilhado. */
export async function fetchItems(dept: Department, hotelId: string): Promise<Item[]> {
  let q = supabase.from('items').select('*').eq('department', dept).eq('active', true)
  q = dept === 'FB' ? q.is('hotel_id', null) : q.eq('hotel_id', hotelId)
  const { data, error } = await q.order('name')
  if (error) throw error
  return data as Item[]
}

export async function fetchPeriods(dept: Department, hotelId: string): Promise<Period[]> {
  const { data, error } = await supabase
    .from('periods')
    .select('*')
    .eq('department', dept)
    .eq('hotel_id', hotelId)
    .order('start_date', { ascending: false })
  if (error) throw error
  return data as Period[]
}

export async function fetchCounts(periodId: string): Promise<Count[]> {
  const { data, error } = await supabase.from('counts').select('*').eq('period_id', periodId)
  if (error) throw error
  return data as Count[]
}

/** Cria (ou devolve) a semana que contém a data indicada. */
export async function ensureWeek(dept: Department, hotelId: string, anyDate: string) {
  const start = mondayOf(new Date(anyDate + 'T00:00:00'))
  const end = addDays(start, 6)
  const { data: existing } = await supabase
    .from('periods').select('*')
    .eq('hotel_id', hotelId).eq('department', dept).eq('start_date', start).maybeSingle()
  if (existing) return existing as Period

  const { data, error } = await supabase
    .from('periods')
    .insert({
      hotel_id: hotelId, department: dept, kind: 'semanal',
      start_date: start, end_date: end, label: start,
    })
    .select().single()
  if (error) throw error
  return data as Period
}

/** Cria (ou devolve) o mês indicado ('2026-08'). */
export async function ensureMonth(dept: Department, hotelId: string, month: string) {
  const start = `${month}-01`
  const { data: existing } = await supabase
    .from('periods').select('*')
    .eq('hotel_id', hotelId).eq('department', dept).eq('start_date', start).maybeSingle()
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

/** Inventário final da semana/mês anterior, por item — serve de inventário inicial. */
export async function fetchPreviousClosing(
  dept: Department, hotelId: string, beforeDate: string,
): Promise<Record<string, number>> {
  const { data: prev } = await supabase
    .from('periods').select('id')
    .eq('hotel_id', hotelId).eq('department', dept)
    .lt('start_date', beforeDate)
    .order('start_date', { ascending: false })
    .limit(1).maybeSingle()
  if (!prev) return {}
  const { data } = await supabase.from('counts').select('item_id, closing_qty').eq('period_id', prev.id)
  const out: Record<string, number> = {}
  for (const r of data ?? []) out[r.item_id] = Number(r.closing_qty)
  return out
}

export async function upsertCount(row: Partial<Count> & { period_id: string; item_id: string }) {
  const { error } = await supabase.from('counts').upsert(row, { onConflict: 'period_id,item_id' })
  if (error) throw error
}

export async function updatePeriod(id: string, patch: Partial<Period>) {
  const { error } = await supabase.from('periods').update(patch).eq('id', id)
  if (error) throw error
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
