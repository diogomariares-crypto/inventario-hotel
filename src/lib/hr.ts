/**
 * Recursos Humanos — pessoas, contratos e custo de empresa.
 *
 * O cálculo do custo vive todo aqui, em TypeScript, e não na base de dados:
 * assim a ficha mostra os números a mudar enquanto se escreve, e os totais
 * por empresa/hotel/departamento saem exatamente da mesma fórmula. As taxas
 * e limites não estão no código — vêm de `hr_parametros`, por ano.
 */
import { supabase } from './supabase'
import { todayISO } from './format'

export type Estado = 'activo' | 'baixa' | 'saiu'

export const ESTADOS: { v: Estado; rot: string; desc: string }[] = [
  { v: 'activo', rot: 'Activo', desc: 'ao serviço — custo completo' },
  { v: 'baixa', rot: 'Baixa médica', desc: 'a Segurança Social paga o vencimento; à empresa só fica a acumulação de férias e Natal' },
  { v: 'saiu', rot: 'Saiu', desc: 'já não conta para o custo' },
]

export const estadoRotulo = (e: Estado) => ESTADOS.find(x => x.v === e)?.rot ?? e

export interface Empresa { id: string; nome: string; ordem: number; ativa: boolean }
export interface Departamento { id: string; nome: string; ordem: number }

export interface Parametros {
  ano: number
  tsu: number
  seguro_at: number
  fundos: number
  limite_alim_dinheiro: number
  limite_alim_cartao: number
  meses_alimentacao: number
  meses_complementos: number
  meses_abono: number
  isencao_abono_pct: number
}

export interface Empregado {
  id: string
  numero: number | null
  nome: string
  empresa_id: string
  hotel_id: string | null
  departamento_id: string | null
  funcao: string | null
  estado: Estado
  data_entrada: string | null
  data_saida: string | null
  tipo_contrato: string | null
  vencimento_base: number
  sub_alim_dia: number
  sub_alim_cartao: boolean
  sub_alim_dias_mes: number
  meses_ferias: number
  meses_natal: number
  sub_linguas: number
  isencao_horario: number
  abono_falhas: number
  outros_subsidios: number
  outros_desc: string | null
  taxa_tsu: number | null
  encargos_manual: number | null
  notas: string | null
}

export const TIPOS_CONTRATO = [
  'Sem termo', 'Termo certo', 'Termo incerto', 'Muito curta duração',
  'Prestação de serviços', 'Estágio',
]

/* ------------------------------------------------------------------ cálculo */

export interface Custo {
  /** Vencimento base já espalhado por 12 meses, incluindo férias e Natal. */
  base: number
  /** Línguas, isenção de horário e outros. */
  complementos: number
  abono: number
  alimentacao: number
  /** O que a pessoa recebe, por mês médio. */
  bruto: number
  /** Parcela sobre a qual incidem TSU, seguro e fundos. */
  baseTsu: number
  taxa: number
  encargos: number
  /** Bruto + encargos: o que a empresa gasta por mês médio. */
  total: number
  /** O que custaria se estivesse ao serviço — para se ver o efeito da baixa. */
  pleno: number
  encargosManuais: boolean
}

const ZERO = { base: 0, complementos: 0, abono: 0, alimentacao: 0, bruto: 0, baseTsu: 0 }

/** Já saiu se está marcado como tal ou se a data de saída já passou. */
export const jaSaiu = (e: Empregado) =>
  e.estado === 'saiu' || (!!e.data_saida && e.data_saida < todayISO())

/** Ainda cá está mas com saída marcada para os próximos `dias`. */
export const vaiSair = (e: Empregado, dias = 60) => {
  if (!e.data_saida || jaSaiu(e)) return false
  const limite = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10)
  return e.data_saida <= limite
}

export function custo(e: Empregado, p: Parametros): Custo {
  const mes = (anual: number) => anual / 12
  const taxa = (e.taxa_tsu ?? p.tsu) + p.seguro_at + p.fundos

  // ── ao serviço ────────────────────────────────────────────────────────────
  const base = mes(e.vencimento_base * (12 + e.meses_ferias + e.meses_natal))
  const complementos = mes(
    (e.sub_linguas + e.isencao_horario + e.outros_subsidios) * p.meses_complementos)
  const abono = mes(e.abono_falhas * p.meses_abono)
  const alimentacao = mes(e.sub_alim_dia * e.sub_alim_dias_mes * p.meses_alimentacao)

  // O subsídio de alimentação e o abono para falhas só pagam TSU na parte que
  // ultrapassa os limites isentos — daí não entrarem inteiros na base.
  const limiteDia = e.sub_alim_cartao ? p.limite_alim_cartao : p.limite_alim_dinheiro
  const alimTributavel = mes(
    Math.max(e.sub_alim_dia - limiteDia, 0) * e.sub_alim_dias_mes * p.meses_alimentacao)
  const abonoTributavel = mes(
    Math.max(e.abono_falhas - e.vencimento_base * p.isencao_abono_pct, 0) * p.meses_abono)

  const aoServico = montar(
    { base, complementos, abono, alimentacao,
      bruto: base + complementos + abono + alimentacao,
      baseTsu: base + complementos + abonoTributavel + alimTributavel },
    taxa, e.encargos_manual)
  const pleno = aoServico.total

  if (jaSaiu(e)) return { ...montar(ZERO, taxa, 0), pleno }

  if (e.estado === 'baixa') {
    // Durante a baixa a empresa não paga vencimento nem alimentação, mas os
    // subsídios de férias e Natal continuam a formar-se.
    const acumulado = mes(e.vencimento_base * (e.meses_ferias + e.meses_natal))
    return {
      ...montar({ ...ZERO, base: acumulado, bruto: acumulado, baseTsu: acumulado },
                taxa, e.encargos_manual),
      pleno,
    }
  }

  return { ...aoServico, pleno }
}

function montar(
  p: typeof ZERO, taxa: number, manual: number | null,
): Omit<Custo, 'pleno'> {
  const encargos = manual ?? p.baseTsu * taxa
  return { ...p, taxa, encargos, total: p.bruto + encargos, encargosManuais: manual != null }
}

/** Junta uma lista de pessoas num só total. */
export function somar(es: Empregado[], p: Parametros) {
  const t = { pessoas: es.length, bruto: 0, encargos: 0, total: 0, pleno: 0 }
  for (const e of es) {
    const c = custo(e, p)
    t.bruto += c.bruto; t.encargos += c.encargos; t.total += c.total; t.pleno += c.pleno
  }
  return t
}

export type Grupo = ReturnType<typeof somar> & { id: string; nome: string }

/** Agrupa por empresa, hotel ou departamento, já ordenado do mais caro. */
export function agrupar(
  es: Empregado[], p: Parametros,
  chave: (e: Empregado) => string | null,
  nomes: Record<string, string>,
  semNome: string,
): Grupo[] {
  const baldes: Record<string, Empregado[]> = {}
  for (const e of es) (baldes[chave(e) ?? '—'] ??= []).push(e)
  return Object.entries(baldes)
    .map(([id, lista]) => ({ id, nome: id === '—' ? semNome : (nomes[id] ?? semNome), ...somar(lista, p) }))
    .sort((a, b) => b.total - a.total)
}

/* -------------------------------------------------------------------- dados */

export async function fetchEmpresas(): Promise<Empresa[]> {
  const { data, error } = await supabase.from('hr_empresas').select('*').order('ordem')
  if (error) throw error
  return data as Empresa[]
}

export async function fetchDepartamentos(): Promise<Departamento[]> {
  const { data, error } = await supabase.from('hr_departamentos').select('*').order('ordem')
  if (error) throw error
  return data as Departamento[]
}

export async function fetchEmpregados(): Promise<Empregado[]> {
  const { data, error } = await supabase.from('hr_empregados').select('*').order('nome')
  if (error) throw error
  return (data ?? []).map(normalizar)
}

/** O PostgREST devolve `numeric` como texto — passamos tudo a número à entrada. */
function normalizar(r: Record<string, unknown>): Empregado {
  const n = (k: string) => Number(r[k] ?? 0)
  const on = (k: string) => (r[k] == null ? null : Number(r[k]))
  return {
    ...(r as unknown as Empregado),
    numero: on('numero'),
    vencimento_base: n('vencimento_base'),
    sub_alim_dia: n('sub_alim_dia'),
    sub_alim_dias_mes: n('sub_alim_dias_mes'),
    meses_ferias: n('meses_ferias'),
    meses_natal: n('meses_natal'),
    sub_linguas: n('sub_linguas'),
    isencao_horario: n('isencao_horario'),
    abono_falhas: n('abono_falhas'),
    outros_subsidios: n('outros_subsidios'),
    taxa_tsu: on('taxa_tsu'),
    encargos_manual: on('encargos_manual'),
  }
}

export async function fetchParametros(ano: number): Promise<Parametros> {
  const { data, error } = await supabase
    .from('hr_parametros').select('*').lte('ano', ano).order('ano', { ascending: false }).limit(1)
  if (error) throw error
  const r = data?.[0]
  if (!r) throw new Error('Não há parâmetros de cálculo definidos. Vai a RH → Definições.')
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, Number(v)]),
  ) as unknown as Parametros
}

export async function guardarEmpregado(id: string, patch: Partial<Empregado>, por: string | null) {
  const { error } = await supabase
    .from('hr_empregados').update({ ...patch, atualizado_por: por }).eq('id', id)
  if (error) throw error
}

export async function criarEmpregado(e: Partial<Empregado> & { nome: string; empresa_id: string }) {
  const { data, error } = await supabase.from('hr_empregados').insert(e).select('*').single()
  if (error) throw error
  return normalizar(data)
}

export async function apagarEmpregado(id: string) {
  const { error } = await supabase.from('hr_empregados').delete().eq('id', id)
  if (error) throw error
}

export async function guardarParametros(p: Parametros) {
  const { error } = await supabase.from('hr_parametros').upsert(p, { onConflict: 'ano' })
  if (error) throw error
}

export const pct = (v: number) =>
  `${(v * 100).toLocaleString('pt-PT', { maximumFractionDigits: 3 })}%`
