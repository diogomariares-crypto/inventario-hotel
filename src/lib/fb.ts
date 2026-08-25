import { supabase } from './supabase'

/**
 * Faturação diária do F&B — o que era o ficheiro do Valentinas.
 *
 * Um registo por hotel e por dia de serviço. Os números que o relatório de
 * turno mostra na secção F&B saem daqui automaticamente: gravar aqui atualiza
 * lá, sem ninguém ter de copiar nada.
 */

export type Tipo = 'n' | 'e' | 't' | 'c'   // número, euros, texto, calculado

export interface Campo { k: string; rot: string; t: Tipo }
export interface Bloco { head?: string; campos: Campo[] }
export interface Grupo { key: string; titulo: string; escaloes?: boolean; blocos: Bloco[] }

export interface Escalao { nome: string; pax: number; preco: number }

/** Um registo é um saco de valores — as chaves são as colunas da tabela. */
export type Registo = Record<string, number | string | null | Escaloes>
export type Escaloes = Record<string, { pax: number; price: number }>

export const IVA = 1.13
export const IVA_BEBIDA = 1.23

export const GRUPOS: Grupo[] = [
  { key: 'bf', titulo: 'Pequeno-almoço', escaloes: true, blocos: [
    { campos: [
      { k: 'bf_offcheck', rot: 'Off checks (nº)', t: 'n' },
      { k: 'bf_pax', rot: 'Total PAX', t: 'c' },
      { k: 'bf_revenue', rot: 'Total €', t: 'c' },
    ] },
  ] },

  { key: 'vip', titulo: 'VIPs + Lanche', blocos: [
    { head: 'VIPs', campos: [
      { k: 'vip_pax', rot: 'Nº VIPs', t: 'n' },
      { k: 'vip_revenue', rot: 'Total €', t: 'e' },
    ] },
    { head: 'Lanche', campos: [
      { k: 'lanche_pax', rot: 'Nº PAX lanche', t: 'n' },
      { k: 'lanche_revenue', rot: 'Total €', t: 'e' },
    ] },
    { head: 'Off check', campos: [
      { k: 'vip_offcheck_value', rot: 'Valor €', t: 'e' },
    ] },
  ] },

  { key: 'lunch', titulo: 'Almoço', blocos: [
    { head: 'Pax', campos: [
      { k: 'lunch_in', rot: 'IN (hóspedes)', t: 'n' },
      { k: 'lunch_out', rot: 'OUT (externos)', t: 'n' },
      { k: 'lunch_pax', rot: 'Total PAX', t: 'c' },
    ] },
    { head: 'Faturação', campos: [{ k: 'lunch_total', rot: 'TOTAL almoço €', t: 'e' }] },
    { head: 'Off check', campos: [
      { k: 'lunch_offcheck_name', rot: 'Nome', t: 't' },
      { k: 'lunch_offcheck_pax', rot: 'PAX', t: 'n' },
      { k: 'lunch_offcheck_value', rot: 'Valor €', t: 'e' },
    ] },
    { head: 'Delivery', campos: [
      { k: 'lunch_bolt_qty', rot: 'Bolt (nº)', t: 'n' },
      { k: 'lunch_bolt_value', rot: 'Bolt €', t: 'e' },
      { k: 'lunch_uber_qty', rot: 'Uber (nº)', t: 'n' },
      { k: 'lunch_uber_value', rot: 'Uber €', t: 'e' },
    ] },
    { head: 'Fecho', campos: [{ k: 'lunch_transfer', rot: 'Transferência bancária €', t: 'e' }] },
  ] },

  { key: 'dinner', titulo: 'Jantar', blocos: [
    { head: 'Pax', campos: [
      { k: 'dinner_in', rot: 'IN (hóspedes)', t: 'n' },
      { k: 'dinner_out', rot: 'OUT (externos)', t: 'n' },
      { k: 'dinner_pax', rot: 'Total PAX', t: 'c' },
    ] },
    { head: 'Faturação', campos: [{ k: 'dinner_total', rot: 'TOTAL jantar €', t: 'e' }] },
    { head: 'Off check', campos: [
      { k: 'dinner_offcheck_name', rot: 'Nome', t: 't' },
      { k: 'dinner_offcheck_pax', rot: 'PAX', t: 'n' },
      { k: 'dinner_offcheck_value', rot: 'Valor €', t: 'e' },
    ] },
    { head: 'Delivery', campos: [
      { k: 'dinner_bolt_qty', rot: 'Bolt (nº)', t: 'n' },
      { k: 'dinner_bolt_value', rot: 'Bolt €', t: 'e' },
      { k: 'dinner_uber_qty', rot: 'Uber (nº)', t: 'n' },
      { k: 'dinner_uber_value', rot: 'Uber €', t: 'e' },
    ] },
    { head: 'Fecho', campos: [
      { k: 'dinner_transfer', rot: 'Transferência bancária €', t: 'e' },
      { k: 'pax_refused', rot: 'PAX recusados', t: 'n' },
      { k: 'refused_reason', rot: 'Motivo', t: 't' },
    ] },
  ] },

  { key: 'bar', titulo: 'Bar', blocos: [
    { campos: [
      { k: 'bar_in', rot: 'IN', t: 'n' },
      { k: 'bar_out', rot: 'OUT', t: 'n' },
      { k: 'bar_pax', rot: 'Total PAX', t: 'c' },
      { k: 'bar_total', rot: 'TOTAL €', t: 'e' },
    ] },
  ] },

  { key: 'hh', titulo: 'Happy Hour', blocos: [
    { campos: [
      { k: 'hh_in', rot: 'IN', t: 'n' },
      { k: 'hh_out', rot: 'OUT', t: 'n' },
      { k: 'hh_pax', rot: 'Total PAX', t: 'c' },
      { k: 'hh_total', rot: 'TOTAL €', t: 'e' },
    ] },
  ] },

  { key: 'oth', titulo: 'Outros', blocos: [
    { head: 'Room service', campos: [
      { k: 'rs_orders', rot: 'Nº pedidos', t: 'n' },
      { k: 'rs_total', rot: 'Total €', t: 'e' },
    ] },
    { head: 'Meia pensão', campos: [
      { k: 'hb_pax', rot: 'Nº PAX', t: 'n' }, { k: 'hb_value', rot: 'Valor €', t: 'e' },
    ] },
    { head: 'Pensão completa', campos: [
      { k: 'fb_pax', rot: 'Nº PAX', t: 'n' }, { k: 'fb_value', rot: 'Valor €', t: 'e' },
    ] },
    { head: 'Coffee break', campos: [
      { k: 'cb_pax', rot: 'Nº PAX', t: 'n' }, { k: 'cb_total', rot: 'Total €', t: 'e' },
    ] },
    { head: 'Evento almoço', campos: [
      { k: 'ev_lunch_pax', rot: 'Nº PAX', t: 'n' }, { k: 'ev_lunch_total', rot: 'Total €', t: 'e' },
    ] },
    { head: 'Evento jantar', campos: [
      { k: 'ev_dinner_pax', rot: 'Nº PAX', t: 'n' }, { k: 'ev_dinner_total', rot: 'Total €', t: 'e' },
    ] },
    { head: 'VIPs românticos', campos: [
      { k: 'vip_rom_pax', rot: 'Nº', t: 'n' }, { k: 'vip_rom_value', rot: 'Valor €', t: 'e' },
    ] },
    { head: 'Menu de snacks', campos: [
      { k: 'snacks_qty', rot: 'Nº pedidos', t: 'n' }, { k: 'snacks_value', rot: 'Valor €', t: 'e' },
    ] },
    { head: 'Notas', campos: [{ k: 'notes', rot: 'Observações do dia', t: 't' }] },
  ] },
]

export const TODAS_AS_CHAVES = GRUPOS.flatMap(g => g.blocos.flatMap(b => b.campos.map(c => c.k)))

/* ----------------------------- contas do dia ----------------------------- */
const n = (v: unknown) => {
  if (v === null || v === undefined || v === '') return 0
  const x = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(x) ? x : 0
}
const soma = (...xs: unknown[]) => xs.reduce<number>((a, b) => a + n(b), 0)
const cent = (x: number) => Math.round(x * 100) / 100

/**
 * Peso médio da bebida em cada serviço, medido nos dias com repartição
 * registada. Serve para estimar o IVA nos dias em que só há o total.
 */
const PESO_BEBIDA: Record<string, number> = { lunch: 0.144, dinner: 0.248, bar: 0.957, oth: 0.10 }

const bebidaDe = (r: Registo, key: string, bruto: number) => {
  const tem = (...ks: string[]) => ks.some(k => r[k] !== null && r[k] !== undefined && r[k] !== '')
  if (key === 'lunch' && tem('lunch_drink', 'lunch_food', 'lunch_menu_drink', 'lunch_menu_food'))
    return soma(r.lunch_drink, r.lunch_menu_drink)
  if (key === 'dinner' && tem('dinner_drink', 'dinner_food')) return soma(r.dinner_drink)
  if (key === 'bar' && tem('bar_drink', 'bar_food')) return soma(r.bar_drink)
  if (key === 'oth' && tem('rs_drink', 'rs_food', 'cb_drink', 'cb_food',
                           'ev_lunch_drink', 'ev_lunch_food', 'ev_dinner_drink', 'ev_dinner_food'))
    return soma(r.rs_drink, r.cb_drink, r.ev_lunch_drink, r.ev_dinner_drink)
  return bruto * (PESO_BEBIDA[key] ?? 0)
}

const semIva = (bruto: number, bebida: number) => {
  const b = Math.max(0, Math.min(bebida, bruto))
  return (bruto - b) / IVA + b / IVA_BEBIDA
}

export const escaloesDe = (r: Registo): Escaloes =>
  (r.bf_tiers && typeof r.bf_tiers === 'object' ? r.bf_tiers as Escaloes : {})

/** Recalcula tudo o que é derivado. Chamar sempre antes de gravar. */
export function recalcular(r: Registo): Registo {
  const esc = escaloesDe(r)
  const bfPax = Object.values(esc).reduce((a, t) => a + n(t.pax), 0)
  const bfEur = Object.values(esc).reduce((a, t) => a + n(t.pax) * n(t.price), 0)

  const out: Registo = { ...r }
  out.bf_pax = bfPax
  out.bf_revenue = cent(bfEur)
  out.lunch_pax = soma(r.lunch_in, r.lunch_out)
  out.dinner_pax = soma(r.dinner_in, r.dinner_out)
  out.bar_pax = soma(r.bar_in, r.bar_out)
  out.hh_pax = soma(r.hh_in, r.hh_out)

  const outros = soma(r.rs_total, r.hb_value, r.fb_value, r.cb_total,
                      r.ev_lunch_total, r.ev_dinner_total, r.vip_rom_value, r.snacks_value)
  out.others_total = cent(outros)

  const brutos: Record<string, number> = {
    bf: cent(bfEur),
    vip: soma(r.vip_revenue, r.lanche_revenue),
    lunch: soma(r.lunch_total, r.lunch_bolt_value, r.lunch_uber_value),
    dinner: soma(r.dinner_total, r.dinner_bolt_value, r.dinner_uber_value),
    bar: soma(r.bar_total),
    hh: soma(r.hh_total),
    oth: outros,
  }

  out.day_total = cent(Object.values(brutos).reduce((a, b) => a + b, 0))
  out.day_total_net = cent(
    Object.entries(brutos).reduce((a, [k, g]) => a + semIva(g, bebidaDe(r, k, g)), 0),
  )
  out.bf_revenue_net = cent(bfEur / IVA)
  out.vip_revenue_net = cent(n(r.vip_revenue) / IVA)
  out.lanche_revenue_net = cent(n(r.lanche_revenue) / IVA)
  out.pax_lunch_dinner = n(out.lunch_pax) + n(out.dinner_pax)
  out.eur_lunch_dinner = cent(soma(r.lunch_total, r.dinner_total))
  return out
}

/** O que a secção de F&B do turno vai mostrar — para se ver antes de gravar. */
export function espelhoDoTurno(r: Registo) {
  const esc = escaloesDe(r)
  const bfOut = Object.values(esc).reduce((a, t) => a + (n(t.price) === 15 ? n(t.pax) : 0), 0)
  const bfPax = Object.values(esc).reduce((a, t) => a + n(t.pax), 0)
  const entregas = soma(r.lunch_bolt_qty, r.lunch_uber_qty, r.dinner_bolt_qty, r.dinner_uber_qty)
  return [
    { coluna: 'Pequeno-almoço', ins: Math.max(bfPax - bfOut, 0), outs: bfOut,
      pax: bfPax, eur: cent(n(recalcular(r).bf_revenue)) },
    { coluna: 'Pensões', ins: soma(r.hb_pax, r.fb_pax), outs: 0,
      pax: soma(r.hb_pax, r.fb_pax), eur: cent(soma(r.hb_value, r.fb_value)) },
    { coluna: 'Delivery (Bolt/UBER)', ins: 0, outs: entregas, pax: entregas,
      eur: cent(soma(r.lunch_bolt_value, r.lunch_uber_value,
                     r.dinner_bolt_value, r.dinner_uber_value)) },
    { coluna: 'Room Service', ins: soma(r.rs_orders), outs: 0,
      pax: soma(r.rs_orders), eur: cent(soma(r.rs_total)) },
    { coluna: 'Almoço', ins: soma(r.lunch_in), outs: soma(r.lunch_out),
      pax: soma(r.lunch_in, r.lunch_out), eur: cent(soma(r.lunch_total)) },
    { coluna: 'Jantar', ins: soma(r.dinner_in), outs: soma(r.dinner_out),
      pax: soma(r.dinner_in, r.dinner_out), eur: cent(soma(r.dinner_total)) },
    { coluna: 'Bar', ins: soma(r.bar_in, r.hh_in), outs: soma(r.bar_out, r.hh_out),
      pax: soma(r.bar_pax, r.hh_pax), eur: cent(soma(r.bar_total, r.hh_total)) },
    { coluna: 'VIPS + Lanche', ins: soma(r.vip_pax, r.lanche_pax), outs: 0,
      pax: soma(r.vip_pax, r.lanche_pax), eur: cent(soma(r.vip_revenue, r.lanche_revenue)) },
  ]
}

/* -------------------------------- dados --------------------------------- */
export async function fetchRegisto(hotelId: string, dia: string): Promise<Registo | null> {
  const { data, error } = await supabase
    .from('fb_billing').select('*')
    .eq('hotel_id', hotelId).eq('service_date', dia).maybeSingle()
  if (error) throw error
  return (data as Registo) ?? null
}

/** Último registo antes de `dia` — serve para herdar os escalões de preço. */
export async function fetchUltimosEscaloes(hotelId: string, dia: string): Promise<Escaloes | null> {
  const { data, error } = await supabase
    .from('fb_billing').select('bf_tiers')
    .eq('hotel_id', hotelId).lt('service_date', dia)
    .not('bf_tiers', 'is', null)
    .order('service_date', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  const t = data?.bf_tiers as Escaloes | undefined
  if (!t) return null
  const limpo: Escaloes = {}
  for (const [k, v] of Object.entries(t)) limpo[k] = { pax: 0, price: n(v.price) }
  return limpo
}

export async function gravarRegisto(hotelId: string, dia: string, r: Registo, email: string | null) {
  const calc = recalcular(r)
  const corpo: Record<string, unknown> = {
    hotel_id: hotelId, service_date: dia, updated_by: email, filled_by: email,
  }
  for (const [k, v] of Object.entries(calc)) {
    if (['id', 'hotel_id', 'service_date', 'created_at', 'updated_at', 'updated_by'].includes(k)) continue
    corpo[k] = v === '' ? null : v
  }
  const { error } = await supabase
    .from('fb_billing').upsert(corpo, { onConflict: 'hotel_id,service_date' })
  if (error) throw error
}

export interface LinhaMes { mes: string; dias: number; total: number; pax: number }

export async function fetchResumoMensal(hotelId: string, ano: string): Promise<LinhaMes[]> {
  const { data, error } = await supabase
    .from('fb_billing')
    .select('service_date, day_total, pax_lunch_dinner, bf_pax')
    .eq('hotel_id', hotelId)
    .gte('service_date', `${ano}-01-01`).lte('service_date', `${ano}-12-31`)
    .order('service_date')
  if (error) throw error
  const m = new Map<string, LinhaMes>()
  for (const r of data ?? []) {
    const mes = String(r.service_date).slice(0, 7)
    const l = m.get(mes) ?? { mes, dias: 0, total: 0, pax: 0 }
    l.dias += 1
    l.total += n(r.day_total)
    l.pax += n(r.pax_lunch_dinner) + n(r.bf_pax)
    m.set(mes, l)
  }
  return [...m.values()]
}

export const eur = (v: unknown) =>
  n(v).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
