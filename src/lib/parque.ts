import { supabase } from './supabase'

/**
 * Parque de estacionamento — 16 lugares de carro e 2 de mota, partilhados
 * pelos hotéis.
 *
 * Não há horas. Uma reserva ocupa noites: entra no dia de início e sai no dia
 * de fim, e o dia da saída fica livre para outro carro. Por isso o intervalo é
 * [início, fim) e o número de noites é a diferença entre as duas datas.
 * A base de dados garante isto com uma restrição de exclusão — duas reservas
 * no mesmo lugar não podem partilhar nenhuma noite, aconteça o que acontecer
 * no ecrã.
 */

export interface Lugar {
  id: string
  tipo: 'carro' | 'mota'
  ordem: number
  ativo: boolean
}

export interface Reserva {
  id: string
  hotel_id: string
  space_id: string
  reservation_number: string | null
  guest_name: string
  room: string | null
  plate: string | null
  start_date: string
  end_date: string
  notes: string | null
}

/** Hotéis que usam o parque, por slug. */
export const HOTEIS_PARQUE = ['gravity', 'tokyo', 'concrete'] as const

export const COR_HOTEL: Record<string, string> = {
  gravity: '#1a6b4a',
  tokyo: '#b45309',
  concrete: '#475569',
}
export const corDoHotel = (slug: string | undefined) =>
  (slug && COR_HOTEL[slug]) || '#64748b'

/* ------------------------------- datas ------------------------------- */
/** 'yyyy-mm-dd' → Date local (sem apanhar com fusos como o new Date(iso) apanha). */
export const aData = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const aIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const hojeIso = () => aIso(new Date())

export const somaDias = (iso: string, n: number) => {
  const d = aData(iso)
  d.setDate(d.getDate() + n)
  return aIso(d)
}

/** Noites entre duas datas. Tolerante às mudanças de hora. */
export const diffDias = (a: string, b: string) =>
  Math.round((aData(b).getTime() - aData(a).getTime()) / 86400000)

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export const diaSemana = (iso: string) => DIAS_SEMANA[aData(iso).getDay()]
export const diaMes = (iso: string) => aData(iso).getDate()
export const dataCurta = (iso: string) => `${diaMes(iso)} ${MESES[aData(iso).getMonth()]}`
export const dataLonga = (iso: string) =>
  `${diaSemana(iso)}, ${diaMes(iso)} ${MESES[aData(iso).getMonth()]} ${aData(iso).getFullYear()}`

/** Uma reserva ocupa a noite de `dia` se dia ∈ [início, fim). */
export const ocupaNoite = (r: Reserva, dia: string) => r.start_date <= dia && r.end_date > dia

/** Duas reservas chocam se partilharem alguma noite. */
export const chocam = (a: { start_date: string; end_date: string },
                       b: { start_date: string; end_date: string }) =>
  a.start_date < b.end_date && b.start_date < a.end_date

/* ------------------------------- dados ------------------------------- */
export async function fetchLugares(): Promise<Lugar[]> {
  const { data, error } = await supabase
    .from('parking_spaces').select('*').order('ordem')
  if (error) throw error
  return (data ?? []) as Lugar[]
}

/** Reservas que tocam a janela [de, ate). */
export async function fetchReservas(de: string, ate: string): Promise<Reserva[]> {
  const { data, error } = await supabase
    .from('parking_reservations')
    .select('id, hotel_id, space_id, reservation_number, guest_name, room, plate, start_date, end_date, notes')
    .lt('start_date', ate)
    .gt('end_date', de)
    .order('start_date')
  if (error) throw error
  return (data ?? []) as Reserva[]
}

/** Procura livre por nome, quarto, nº de reserva ou matrícula. */
export async function procurarReservas(termo: string): Promise<Reserva[]> {
  const t = termo.trim()
  if (t.length < 2) return []
  const escapado = t.replace(/[%,()]/g, ' ')
  const { data, error } = await supabase
    .from('parking_reservations')
    .select('id, hotel_id, space_id, reservation_number, guest_name, room, plate, start_date, end_date, notes')
    .or(
      `guest_name.ilike.%${escapado}%,room.ilike.%${escapado}%,` +
      `plate.ilike.%${escapado}%,reservation_number.ilike.%${escapado}%`,
    )
    .order('start_date', { ascending: false })
    .limit(12)
  if (error) throw error
  return (data ?? []) as Reserva[]
}

export async function guardarReserva(
  r: Omit<Reserva, 'id'> & { id?: string },
  email: string | null,
) {
  const corpo = { ...r, updated_by: email }
  const { error } = r.id
    ? await supabase.from('parking_reservations').update(corpo).eq('id', r.id)
    : await supabase.from('parking_reservations').insert(corpo)
  if (error) throw error
}

export async function apagarReserva(id: string) {
  const { error } = await supabase.from('parking_reservations').delete().eq('id', id)
  if (error) throw error
}

/**
 * A base de dados devolve o erro cru da restrição de exclusão. Traduz para
 * algo que a receção perceba.
 */
export function mensagemDeErro(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  if (/parque_sem_sobreposicao|exclusion constraint/i.test(m)) {
    return 'Esse lugar já está ocupado em pelo menos uma dessas noites.'
  }
  if (/parque_datas_coerentes/i.test(m)) {
    return 'A data de saída tem de ser depois da data de entrada.'
  }
  if (/row-level security|permission denied/i.test(m)) {
    return 'Não tens permissão para alterar reservas do parque.'
  }
  return m
}
