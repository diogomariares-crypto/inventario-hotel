/**
 * Housekeeping — produção e pessoal.
 *
 * A pergunta é sempre a mesma: o trabalho que o dia exige cabe nas pessoas que
 * há? De um lado, os quartos ocupados e as saídas, cada um com o seu tempo. Do
 * outro, os turnos de pessoal mais o outsourcing, menos as limpezas gerais —
 * que saem do mesmo bolo de horas mas não são quartos.
 *
 * Os quartos e as saídas não se escrevem: vêm dos relatórios de turno.
 */
import { supabase } from './supabase'

export interface Parametros {
  hotel_id: string
  min_por_quarto: number
  min_por_saida: number
  horas_por_turno: number
  preco_hora_outsourcing: number
  taxa_iva: number
  multiplicador_feriado: number
  horas_dia_completo: number
}

export const PARAMETROS_BASE: Omit<Parametros, 'hotel_id'> = {
  min_por_quarto: 20,
  min_por_saida: 45,
  horas_por_turno: 7,
  preco_hora_outsourcing: 8.7,
  taxa_iva: 0.23,
  multiplicador_feriado: 2,
  horas_dia_completo: 8,
}

export interface Dia {
  id: string
  dia: string
  quartos_ocupados: number
  saidas: number
  staff: number
  /** Os rácios em vigor no dia, congelados para o histórico não se reescrever. */
  min_por_quarto: number
  min_por_saida: number
  horas_por_turno: number
  nota: string | null
}

export interface Limpeza {
  id: string
  dia: string
  descricao: string
  minutos: number
}

export interface Turno {
  id: string
  dia: string
  nome: string
  feriado: boolean
  hora_inicio: string
  hora_fim: string
  almoco_min: number
}

/* ------------------------------------------------------------------ cálculo */

export const minutosNecessarios = (d: Pick<Dia,
  'quartos_ocupados' | 'saidas' | 'min_por_quarto' | 'min_por_saida'>) =>
  d.quartos_ocupados * d.min_por_quarto + d.saidas * d.min_por_saida

/** O que sobra para os quartos: turnos + outsourcing − limpezas gerais. */
export const minutosDisponiveis = (
  d: Pick<Dia, 'staff' | 'horas_por_turno'>, limpezasMin: number, outsourcingMin = 0,
) => Math.max(0, d.staff * d.horas_por_turno * 60 + outsourcingMin - limpezasMin)

export interface Balanco {
  necessarios: number
  disponiveis: number
  /** Positivo = falta tempo; negativo = sobra. */
  diferenca: number
  /** A diferença traduzida em pessoas de um turno. */
  pessoas: number
  limpezasMin: number
  outsourcingMin: number
}

export function balanco(d: Dia, limpezasMin: number, outsourcingMin = 0): Balanco {
  const necessarios = minutosNecessarios(d)
  const disponiveis = minutosDisponiveis(d, limpezasMin, outsourcingMin)
  const diferenca = necessarios - disponiveis
  const base = d.horas_por_turno * 60
  return {
    necessarios, disponiveis, diferenca,
    pessoas: base > 0 ? diferenca / base : 0,
    limpezasMin, outsourcingMin,
  }
}

/* -------------------------------------------------------------- outsourcing */

const paraMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export const minutosDoTurno = (t: Pick<Turno, 'hora_inicio' | 'hora_fim' | 'almoco_min'>) =>
  Math.max(0, paraMinutos(t.hora_fim) - paraMinutos(t.hora_inicio) - (t.almoco_min || 0))

export const horasDoTurno = (t: Pick<Turno, 'hora_inicio' | 'hora_fim' | 'almoco_min'>) =>
  minutosDoTurno(t) / 60

export function custoDoTurno(t: Turno, p: Parametros) {
  const horas = horasDoTurno(t)
  const precoHora = t.feriado
    ? p.preco_hora_outsourcing * p.multiplicador_feriado
    : p.preco_hora_outsourcing
  const semIva = horas * precoHora
  return {
    horas,
    precoHora,
    semIva,
    comIva: semIva * (1 + p.taxa_iva),
    diasEquivalentes: p.horas_dia_completo > 0 ? horas / p.horas_dia_completo : 0,
  }
}

/* ------------------------------------------------------------------- cores */

/**
 * Escala divergente para o "pessoas ±": azul quando sobra gente, vermelho
 * quando falta, cinzento no equilíbrio. A cor é sempre acompanhada do número
 * na própria célula, por isso nunca é a cor sozinha a dizer o que se passa.
 */
const NEUTRO = '#f0efec'
const POLO_FALTA = '227, 73, 72'    // #e34948
const POLO_SOBRA = '57, 135, 229'   // #3987e5

export function corDoBalanco(pessoas: number | null): string {
  if (pessoas == null || !Number.isFinite(pessoas)) return 'transparent'
  // acima de uma pessoa e meia a cor satura; o número continua a diferenciar
  const forca = Math.min(Math.abs(pessoas) / 1.5, 1) * 0.65
  if (forca < 0.02) return NEUTRO
  return `rgba(${pessoas > 0 ? POLO_FALTA : POLO_SOBRA}, ${forca.toFixed(3)})`
}

export const pessoasTexto = (p: number) =>
  `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toLocaleString('pt-PT', {
    minimumFractionDigits: 1, maximumFractionDigits: 1 })}`

/** Minutos em "3h20" — ninguém raciocina em 200 minutos. */
export function horas(min: number): string {
  const sinal = min < 0 ? '−' : ''
  const t = Math.abs(Math.round(min))
  const h = Math.floor(t / 60)
  const m = t % 60
  if (h === 0) return `${sinal}${m}min`
  return m === 0 ? `${sinal}${h}h` : `${sinal}${h}h${String(m).padStart(2, '0')}`
}

/* -------------------------------------------------------------------- dados */

export async function fetchParametros(hotelId: string): Promise<Parametros> {
  const { data, error } = await supabase
    .from('hk_parametros').select('*').eq('hotel_id', hotelId).maybeSingle()
  if (error) throw error
  if (!data) return { hotel_id: hotelId, ...PARAMETROS_BASE }
  return {
    hotel_id: data.hotel_id,
    min_por_quarto: Number(data.min_por_quarto),
    min_por_saida: Number(data.min_por_saida),
    horas_por_turno: Number(data.horas_por_turno),
    preco_hora_outsourcing: Number(data.preco_hora_outsourcing),
    taxa_iva: Number(data.taxa_iva),
    multiplicador_feriado: Number(data.multiplicador_feriado),
    horas_dia_completo: Number(data.horas_dia_completo),
  }
}

export async function guardarParametros(p: Parametros) {
  const { error } = await supabase.from('hk_parametros')
    .upsert({ ...p, atualizado_em: new Date().toISOString() }, { onConflict: 'hotel_id' })
  if (error) throw error
}

const num = (v: unknown, d = 0) => (v == null ? d : Number(v))

export async function fetchDias(hotelId: string, de: string, ate: string): Promise<Dia[]> {
  const { data, error } = await supabase
    .from('hk_dias').select('*').eq('hotel_id', hotelId)
    .gte('dia', de).lte('dia', ate).order('dia')
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id, dia: r.dia, nota: r.nota,
    quartos_ocupados: num(r.quartos_ocupados),
    saidas: num(r.saidas),
    staff: num(r.staff),
    min_por_quarto: num(r.min_por_quarto, 20),
    min_por_saida: num(r.min_por_saida, 45),
    horas_por_turno: num(r.horas_por_turno, 7),
  }))
}

export async function fetchLimpezas(hotelId: string, de: string, ate: string): Promise<Limpeza[]> {
  const { data, error } = await supabase
    .from('hk_limpezas').select('*').eq('hotel_id', hotelId)
    .gte('dia', de).lte('dia', ate).order('dia')
  if (error) throw error
  return (data ?? []).map(r => ({ ...r, minutos: num(r.minutos) })) as Limpeza[]
}

export async function fetchOutsourcing(hotelId: string, de: string, ate: string): Promise<Turno[]> {
  const { data, error } = await supabase
    .from('hk_outsourcing').select('*').eq('hotel_id', hotelId)
    .gte('dia', de).lte('dia', ate).order('dia')
  if (error) throw error
  return (data ?? []).map(r => ({
    ...r, almoco_min: num(r.almoco_min), feriado: !!r.feriado,
    hora_inicio: String(r.hora_inicio).slice(0, 5),
    hora_fim: String(r.hora_fim).slice(0, 5),
  })) as Turno[]
}

export async function guardarDia(
  hotelId: string, dia: string, patch: Partial<Dia>, p: Parametros, por: string | null,
) {
  const { error } = await supabase.from('hk_dias').upsert({
    hotel_id: hotelId, dia,
    // os rácios só se escrevem quando a linha nasce; depois ficam do dia
    min_por_quarto: p.min_por_quarto,
    min_por_saida: p.min_por_saida,
    horas_por_turno: p.horas_por_turno,
    ...patch,
    atualizado_por: por,
  }, { onConflict: 'hotel_id,dia' })
  if (error) throw error
}

/**
 * Grava vários dias de uma vez, para se poder preencher o mês numa tabela em vez
 * de dia a dia.
 *
 * Cada linha leva os seus próprios rácios: as que já existem levam os que têm
 * gravados, as novas levam os que estão em vigor. É o mesmo princípio de sempre
 * — afinar os rácios em Definições não reescreve o que já passou — só que aqui
 * é preciso dizê-lo linha a linha, porque um upsert em bloco escreve todas as
 * colunas que lhe damos.
 */
export async function guardarDias(
  hotelId: string,
  linhas: Pick<Dia, 'dia' | 'quartos_ocupados' | 'saidas' | 'staff' | 'nota'
                  | 'min_por_quarto' | 'min_por_saida' | 'horas_por_turno'>[],
  por: string | null,
) {
  if (!linhas.length) return
  const { error } = await supabase.from('hk_dias').upsert(
    linhas.map(l => ({
      hotel_id: hotelId,
      dia: l.dia,
      quartos_ocupados: l.quartos_ocupados,
      saidas: l.saidas,
      staff: l.staff,
      nota: l.nota,
      min_por_quarto: l.min_por_quarto,
      min_por_saida: l.min_por_saida,
      horas_por_turno: l.horas_por_turno,
      atualizado_por: por,
    })),
    { onConflict: 'hotel_id,dia' },
  )
  if (error) throw error
}

/**
 * As limpezas gerais são uma lista com descrição — na tabela do mês há só um
 * número por dia. Enquanto o dia tiver uma linha só, o número mexe-a; a zero,
 * apaga-a. Um dia com várias linhas discriminadas não se deixa esmagar por um
 * número: esse edita-se no Registo.
 */
export async function definirLimpezaDoDia(
  hotelId: string, dia: string, minutos: number, existentes: Limpeza[],
) {
  if (existentes.length > 1) throw new Error(
    `${dmyCurto(dia)} tem várias limpezas discriminadas — edita-as no Registo do dia.`)
  const actual = existentes[0]
  if (minutos <= 0) {
    if (actual) await apagarLimpeza(actual.id)
    return
  }
  if (actual) {
    const { error } = await supabase.from('hk_limpezas')
      .update({ minutos }).eq('id', actual.id)
    if (error) throw error
    return
  }
  await juntarLimpeza(hotelId, { dia, descricao: 'Limpezas gerais', minutos })
}

const dmyCurto = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`

export async function juntarLimpeza(hotelId: string, l: Omit<Limpeza, 'id'>) {
  const { error } = await supabase.from('hk_limpezas').insert({ ...l, hotel_id: hotelId })
  if (error) throw error
}

export async function apagarLimpeza(id: string) {
  const { error } = await supabase.from('hk_limpezas').delete().eq('id', id)
  if (error) throw error
}

export async function juntarTurno(hotelId: string, t: Omit<Turno, 'id'>) {
  const { error } = await supabase.from('hk_outsourcing').insert({ ...t, hotel_id: hotelId })
  if (error) throw error
}

export async function guardarTurno(id: string, patch: Partial<Turno>) {
  const { error } = await supabase.from('hk_outsourcing').update(patch).eq('id', id)
  if (error) throw error
}

export async function apagarTurno(id: string) {
  const { error } = await supabase.from('hk_outsourcing').delete().eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------ quartos e saídas do turno */

export interface DoTurno { quartos: number; saidas: number }

/**
 * Quartos ocupados e saídas por dia, vindos do relatório de turno. O
 * `day_offset` zero é o próprio dia; os outros são previsão e não servem.
 */
export async function fetchDoTurno(
  hotelId: string, de: string, ate: string,
): Promise<Record<string, DoTurno>> {
  const { data, error } = await supabase
    .from('occupancy').select('report_date, occ_rooms, departures')
    .eq('hotel_id', hotelId).eq('day_offset', 0)
    .gte('report_date', de).lte('report_date', ate)
  if (error) throw error
  const fora: Record<string, DoTurno> = {}
  for (const r of data ?? []) {
    fora[r.report_date] = { quartos: num(r.occ_rooms), saidas: num(r.departures) }
  }
  return fora
}
