/**
 * Contagem de dinheiro.
 *
 * A pergunta é sempre a mesma: o dinheiro que temos em mãos corresponde ao que
 * recebemos, menos as faturas que foram pagas com ele? Três colunas e uma
 * diferença:
 *
 *   recebido − saídas = o que devia estar no envelope
 *   contado + depositado = o que está
 *
 * Substitui a Contagem de Dinheiro, as Saídas de Caixa, o CAJA OPORTO e o
 * CAJAS VALENTINAS, que hoje são quatro ficheiros a dizer partes da mesma coisa.
 */
import { supabase } from './supabase'

export interface Caixa {
  id: string
  nome: string
  hotel_id: string | null
  empresa_id: string | null
  /** 'pms' = o recebido vem do relatório; 'manual' = escreve-se ao fecho do dia. */
  fonte: 'pms' | 'manual'
  ordem: number
  ativa: boolean
}

export interface Recebido {
  id: string
  dia: string
  valor: number
  origem: 'pms' | 'manual'
  cliente: string | null
  criador: string | null
  documento: string | null
  momento: string | null
}

export interface Saida {
  id: string
  dia: string
  fornecedor: string | null
  descricao: string | null
  documento: string | null
  valor: number
  ficheiro: string | null
}

export interface Envelope {
  id: string
  dia: string
  responsavel: string | null
  valor: number
  denominacoes: Record<string, number>
  nota: string | null
}

export interface Deposito {
  id: string
  dia: string
  valor: number
  referencia: string | null
}

/* --------------------------------------------------------------- notas e moedas */

/** Do maior para o mais pequeno, como se conta na mão. */
export const DENOMINACOES = [
  500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01,
]

export const ehNota = (v: number) => v >= 5

/** Soma da contagem nota a nota, arredondada ao cêntimo. */
export function somaDenominacoes(d: Record<string, number>): number {
  let t = 0
  for (const v of DENOMINACOES) t += v * (d[String(v)] || 0)
  return Math.round(t * 100) / 100
}

/* ------------------------------------------------------------------ balanço */

export interface Balanco {
  recebido: number
  saidas: number
  /** Recebido menos as faturas pagas por caixa: o que devia vir no envelope. */
  esperado: number
  contado: number
  depositado: number
  /** Contado menos esperado. Positivo sobra, negativo falta. */
  diferenca: number
  /** O que ainda está no cofre por depositar. */
  emCofre: number
  envelopes: number
  faturas: number
}

export function balanco(
  recebido: Recebido[], saidas: Saida[], envelopes: Envelope[], depositos: Deposito[],
): Balanco {
  const soma = <T,>(xs: T[], f: (x: T) => number) =>
    Math.round(xs.reduce((s, x) => s + f(x), 0) * 100) / 100
  const r = soma(recebido, x => x.valor)
  const s = soma(saidas, x => x.valor)
  const c = soma(envelopes, x => x.valor)
  const d = soma(depositos, x => x.valor)
  const esperado = Math.round((r - s) * 100) / 100
  return {
    recebido: r, saidas: s, esperado, contado: c, depositado: d,
    diferenca: Math.round((c - esperado) * 100) / 100,
    emCofre: Math.round((c - d) * 100) / 100,
    envelopes: envelopes.length, faturas: saidas.length,
  }
}

/**
 * Uma diferença de cêntimos é troco; uma de dezenas é um envelope por abrir ou
 * uma fatura por lançar. O limiar evita alarme onde não há problema.
 */
export const TOLERANCIA = 1
export const estaCerto = (b: Balanco) => Math.abs(b.diferenca) <= TOLERANCIA

/* --------------------------------------------------- relatório de pagamentos */

export interface LinhaPms {
  dia: string
  momento: string | null
  valor: number
  cliente: string | null
  criador: string | null
  documento: string | null
  chave: string
}

/**
 * Lê a folha "Cash payments" do relatório de pagamentos do Mews.
 *
 * As colunas vêm com nomes em inglês e a folha traz colunas vazias pelo meio,
 * por isso procura-se pelo cabeçalho em vez de contar posições — o Mews muda
 * o relatório de vez em quando e isto sobrevive a isso.
 */
export function lerRelatorioPms(linhas: Record<string, unknown>[]): LinhaPms[] {
  const fora: LinhaPms[] = []
  for (const l of linhas) {
    const col = (...nomes: string[]) => {
      for (const n of nomes) {
        const k = Object.keys(l).find(x => x.trim().toLowerCase() === n.toLowerCase())
        if (k != null && l[k] != null && String(l[k]).trim() !== '') return l[k]
      }
      return null
    }
    const valor = Number(col('Value', 'Amount', 'Valor', 'Original amount'))
    if (!Number.isFinite(valor) || valor === 0) continue

    const bruto = col('Created', 'Date', 'Data')
    const momento = paraMomento(bruto)
    if (!momento) continue

    const cliente = txt(col('Customer', 'Cliente'))
    const criador = txt(col('Creator', 'User', 'Utilizador'))
    const documento = txt(col('Bill', 'Conta', 'Document'))

    fora.push({
      dia: momento.slice(0, 10),
      momento,
      valor: Math.round(valor * 100) / 100,
      cliente, criador, documento,
      // o mesmo pagamento reimportado tem de cair na mesma chave
      chave: `${momento}|${documento ?? ''}|${valor.toFixed(2)}|${cliente ?? ''}`.slice(0, 220),
    })
  }
  return fora
}

const txt = (v: unknown) => {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}

/** Aceita a data como texto, como Date, ou como número de série do Excel. */
function paraMomento(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return semFuso(v)
  if (typeof v === 'number') {
    // O Excel conta dias desde 1899-12-30
    return semFuso(new Date(Math.round((v - 25569) * 86400000)))
  }
  const s = String(v).trim()
  const pt = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})(?:[ T](\d{2}):(\d{2}))?/)
  if (pt) return `${pt[3]}-${pt[2]}-${pt[1]}T${pt[4] ?? '00'}:${pt[5] ?? '00'}:00`
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4] ?? '00'}:${iso[5] ?? '00'}:00`
  const d = new Date(s)
  return Number.isNaN(d.valueOf()) ? null : semFuso(d)
}

const semFuso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
         `T${p(d.getHours())}:${p(d.getMinutes())}:00`
}

/* -------------------------------------------------------------------- dados */

const num = (v: unknown, d = 0) => (v == null ? d : Number(v))

export async function fetchCaixas(): Promise<Caixa[]> {
  const { data, error } = await supabase
    .from('cx_caixas').select('*').eq('ativa', true).order('ordem')
  if (error) throw error
  return (data ?? []) as Caixa[]
}

export async function fetchMes(caixaId: string, de: string, ate: string) {
  const [r, s, e, d] = await Promise.all([
    supabase.from('cx_recebido').select('*').eq('caixa_id', caixaId)
      .gte('dia', de).lte('dia', ate).order('dia'),
    supabase.from('cx_saidas').select('*').eq('caixa_id', caixaId)
      .gte('dia', de).lte('dia', ate).order('dia'),
    supabase.from('cx_envelopes').select('*').eq('caixa_id', caixaId)
      .gte('dia', de).lte('dia', ate).order('dia'),
    supabase.from('cx_depositos').select('*').eq('caixa_id', caixaId)
      .gte('dia', de).lte('dia', ate).order('dia'),
  ])
  for (const x of [r, s, e, d]) if (x.error) throw x.error
  return {
    recebido: (r.data ?? []).map(x => ({ ...x, valor: num(x.valor) })) as Recebido[],
    saidas: (s.data ?? []).map(x => ({ ...x, valor: num(x.valor) })) as Saida[],
    envelopes: (e.data ?? []).map(x => ({
      ...x, valor: num(x.valor), denominacoes: x.denominacoes ?? {},
    })) as Envelope[],
    depositos: (d.data ?? []).map(x => ({ ...x, valor: num(x.valor) })) as Deposito[],
  }
}

/** Importa as linhas do relatório sem duplicar as que já lá estavam. */
export async function importarRecebido(caixaId: string, linhas: LinhaPms[]) {
  if (!linhas.length) return { novas: 0, repetidas: 0 }
  const { data, error } = await supabase.from('cx_recebido')
    .upsert(linhas.map(l => ({
      caixa_id: caixaId, dia: l.dia, valor: l.valor, origem: 'pms',
      cliente: l.cliente, criador: l.criador, documento: l.documento,
      momento: l.momento, chave: l.chave,
    })), { onConflict: 'caixa_id,chave', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  const novas = data?.length ?? 0
  return { novas, repetidas: linhas.length - novas }
}

export async function juntarRecebidoManual(
  caixaId: string, dia: string, valor: number, nota: string | null,
) {
  const { error } = await supabase.from('cx_recebido').insert({
    caixa_id: caixaId, dia, valor, origem: 'manual', cliente: nota,
    chave: `manual|${dia}|${valor.toFixed(2)}|${Date.now()}`,
  })
  if (error) throw error
}

export async function juntarSaida(caixaId: string, s: Omit<Saida, 'id'>, por: string | null) {
  const { data, error } = await supabase.from('cx_saidas')
    .insert({ ...s, caixa_id: caixaId, atualizado_por: por }).select('id').single()
  if (error) throw error
  return data.id as string
}

export async function guardarSaida(id: string, patch: Partial<Saida>) {
  const { error } = await supabase.from('cx_saidas').update(patch).eq('id', id)
  if (error) throw error
}

export async function juntarEnvelope(
  caixaId: string, e: Omit<Envelope, 'id'>, por: string | null,
) {
  const { error } = await supabase.from('cx_envelopes')
    .insert({ ...e, caixa_id: caixaId, atualizado_por: por })
  if (error) throw error
}

export async function juntarDeposito(caixaId: string, d: Omit<Deposito, 'id'>) {
  const { error } = await supabase.from('cx_depositos').insert({ ...d, caixa_id: caixaId })
  if (error) throw error
}

export async function apagar(tabela: 'cx_saidas' | 'cx_envelopes' | 'cx_depositos' | 'cx_recebido',
                             id: string) {
  const { error } = await supabase.from(tabela).delete().eq('id', id)
  if (error) throw error
}

/* ---------------------------------------------------------------- ficheiros */

const BALDE = 'caixa-faturas'

/** "2026-08-15 - Auchan Cedofeita - 1161032026080001-001.pdf" */
export function nomeDaFatura(s: Pick<Saida, 'dia' | 'fornecedor' | 'documento'>, original: string) {
  const ext = original.includes('.') ? original.slice(original.lastIndexOf('.')) : ''
  const limpo = (t: string | null, alt: string) =>
    (t || alt).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9 .-]/g, '-').replace(/-+/g, '-').trim().slice(0, 60)
  return `${s.dia} - ${limpo(s.fornecedor, 'sem fornecedor')} - ${limpo(s.documento, 'sem numero')}${ext}`
}

export async function guardarFicheiro(
  caixaId: string, s: Pick<Saida, 'dia' | 'fornecedor' | 'documento'>, f: File,
): Promise<string> {
  const caminho = `${caixaId}/${s.dia.slice(0, 7)}/${nomeDaFatura(s, f.name)}`
  const { error } = await supabase.storage.from(BALDE)
    .upload(caminho, f, { upsert: true, contentType: f.type || undefined })
  if (error) throw error
  return caminho
}

/** Link temporário para abrir a fatura; o balde é privado. */
export async function linkDaFatura(caminho: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BALDE).createSignedUrl(caminho, 300)
  if (error) return null
  return data.signedUrl
}

export async function apagarFicheiro(caminho: string) {
  await supabase.storage.from(BALDE).remove([caminho])
}

/**
 * Lê o bloco de faturas colado a partir de uma tabela — uma linha por fatura,
 * campos separados por tabulação ou ponto e vírgula:
 *   data · fornecedor · descrição · nº documento · valor
 *
 * Se a colagem trouxer a linha de cabeçalho, as colunas são identificadas pelo
 * nome em vez da posição. É o que permite colar as Saídas de Caixa tal como
 * estão no Excel, onde a ordem é outra (Data · Descrição · Nº · Fornecedor).
 */
export function lerColagem(texto: string): Omit<Saida, 'id' | 'ficheiro'>[] {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim())
  if (!linhas.length) return []

  const parte = (l: string) => l.split(/\t|;/).map(x => x.trim())
  const mapa = cabecalho(parte(linhas[0]))
  const corpo = mapa ? linhas.slice(1) : linhas

  const fora: Omit<Saida, 'id' | 'ficheiro'>[] = []
  for (const linha of corpo) {
    const c = parte(linha)
    if (c.length < 3) continue

    const em = (k: keyof typeof POSICOES, posicao: number) =>
      mapa ? (mapa[k] != null ? c[mapa[k]!] : undefined) : c[posicao]

    const dia = paraDia(em('dia', 0) ?? '')
    const bruto = em('valor', c.length - 1) ?? c[c.length - 1]
    const valor = Number(String(bruto).replace(/[^0-9,.-]/g, '').replace(',', '.'))
    if (!dia || !Number.isFinite(valor) || valor === 0) continue

    // sem cabeçalho e só com 4 colunas, a do meio é o nº do documento
    const curto = !mapa && c.length < 5
    fora.push({
      dia,
      fornecedor: (em('fornecedor', 1) || null) ?? null,
      descricao: curto ? null : (em('descricao', 2) || null) ?? null,
      documento: (curto ? c[2] : em('documento', 3)) || null,
      valor: Math.round(Math.abs(valor) * 100) / 100,
    })
  }
  return fora
}

/** Nomes que se reconhecem numa linha de cabeçalho, por campo. */
const POSICOES = {
  dia: ['data', 'dia', 'date', 'fecha'],
  fornecedor: ['fornecedor', 'proveedor', 'supplier'],
  descricao: ['descricao', 'descrição', 'concepto', 'descrition', 'description'],
  documento: ['no documento', 'nº documento', 'n documento', 'numero', 'nº', 'documento', 'fatura'],
  valor: ['saida', 'saída', 'salidas', 'valor', 'total', 'importe', 'montante'],
}

/** Devolve o índice de cada campo, ou null se a linha não for um cabeçalho. */
function cabecalho(c: string[]): Record<keyof typeof POSICOES, number | null> | null {
  const limpo = c.map(x => x.toLowerCase().replace(/[º°.]/g, '').trim())
  const achar = (nomes: string[]) => {
    const i = limpo.findIndex(x => nomes.some(n => x === n.replace(/[º°.]/g, '')))
    return i < 0 ? null : i
  }
  const m = {
    dia: achar(POSICOES.dia),
    fornecedor: achar(POSICOES.fornecedor),
    descricao: achar(POSICOES.descricao),
    documento: achar(POSICOES.documento),
    valor: achar(POSICOES.valor),
  }
  // é cabeçalho se reconheceu a data e o valor — senão é já uma linha de dados
  return m.dia != null && m.valor != null ? m : null
}

function paraDia(s: string): string | null {
  const m = paraMomento(s)
  return m ? m.slice(0, 10) : null
}
