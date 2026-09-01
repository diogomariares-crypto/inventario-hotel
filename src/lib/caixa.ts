/**
 * Contagem de dinheiro.
 *
 * A unidade é o turno, não o dia: um envelope é o que uma equipa fechou entre a
 * hora a que abriu a caixa e a hora a que a fechou. Dado esse intervalo, o
 * relatório do Mews diz sozinho quanto dinheiro lá devia estar:
 *
 *     o que o turno anterior deixou na caixa
 *   + o cobrado em dinheiro entre o início e o fim do turno
 *   − as faturas que vieram dentro deste envelope
 *   − o troco que fica na caixa para o turno seguinte
 *   ─────────────────────────────────────────────────
 *   = o que devia estar no envelope,  que se compara com o contado nota a nota
 *
 * Um turno pode fechar torto de propósito — não havia trocos — e nesse caso o
 * que ficou na caixa abre o turno seguinte e a conta continua a fechar. Por
 * isso o número que importa no fim do mês é a diferença acumulada.
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
  /** Em que envelope veio esta fatura. Nula enquanto ninguém o disser. */
  envelope_id: string | null
}

export interface Envelope {
  id: string
  /** Dia do fecho — o dia do fim do turno. Serve para arrumar por mês. */
  dia: string
  /** Princípio do turno, com hora. */
  inicio: string
  /** Fim do turno, com hora. */
  fim: string
  responsavel: string | null
  valor: number
  denominacoes: Record<string, number>
  /** Troco que não coube no envelope e ficou na caixa para o turno seguinte. */
  transporte: number
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

/**
 * Uma diferença de cêntimos é troco; uma de dezenas é um envelope por abrir ou
 * uma fatura por lançar. O limiar evita alarme onde não há problema.
 */
export const TOLERANCIA = 1
const cents = (n: number) => Math.round(n * 100) / 100
const somar = <T,>(xs: T[], f: (x: T) => number) => cents(xs.reduce((s, x) => s + f(x), 0))

/**
 * As horas da caixa são horas de relógio de parede — o Mews imprime «11:11» e o
 * turno fecha «às 15:00». Não há fuso nenhum nisto, por isso nunca passam por
 * um Date: comparam-se como texto, que em ISO já dá a ordem cronológica certa.
 * Só é preciso pôr todas do mesmo tamanho, porque o input do turno vem sem
 * segundos (2026-09-01T23:00) e o Mews vem com eles.
 */
export const instante = (t: string) => `${t.slice(0, 19)}:00:00`.slice(0, 19)

/** Um pagamento pertence ao turno [início, fim[ — o fim é já do turno seguinte. */
export const dentroDoTurno = (momento: string | null, inicio: string, fim: string) =>
  momento != null &&
  instante(momento) >= instante(inicio) && instante(momento) < instante(fim)

export function recebidoDoTurno(recebido: Recebido[], inicio: string, fim: string) {
  return recebido.filter(r => dentroDoTurno(r.momento, inicio, fim))
}

/* ---------------------------------------------------------------- o envelope */

/**
 * As contas de um envelope. É a pergunta do fecho de turno, por ordem:
 *
 *   o que estava na caixa quando o turno começou   (deixado pelo turno anterior)
 * + o que o Mews registou em dinheiro neste turno
 * − as faturas que vieram dentro deste envelope
 * − o troco que fica na caixa para o turno seguinte
 * ────────────────────────────────────────────────
 * = o que devia estar no envelope
 */
export interface ContasDoEnvelope {
  abertura: number
  recebido: number
  faturas: number
  transporte: number
  esperado: number
  contado: number
  /** Contado menos esperado. Positivo sobra, negativo falta. */
  diferenca: number
  certo: boolean
  nPagamentos: number
  nFaturas: number
}

export function contasDoEnvelope(
  env: Pick<Envelope, 'inicio' | 'fim' | 'valor' | 'transporte'>,
  abertura: number,
  recebido: Recebido[],
  faturas: Saida[],
): ContasDoEnvelope {
  const doTurno = recebidoDoTurno(recebido, env.inicio, env.fim)
  const r = somar(doTurno, x => x.valor)
  const f = somar(faturas, x => x.valor)
  const esperado = cents(abertura + r - f - env.transporte)
  const diferenca = cents(env.valor - esperado)
  return {
    abertura: cents(abertura), recebido: r, faturas: f, transporte: env.transporte,
    esperado, contado: env.valor, diferenca,
    certo: Math.abs(diferenca) <= TOLERANCIA,
    nPagamentos: doTurno.length, nFaturas: faturas.length,
  }
}

/* ------------------------------------------------------------------- o mês */

export interface LinhaDoMes {
  envelope: Envelope
  contas: ContasDoEnvelope
  faturas: Saida[]
  /** Soma das diferenças até este turno, inclusive. É esta que tem de fechar. */
  acumulado: number
}

export interface Balanco {
  linhas: LinhaDoMes[]
  recebido: number
  saidas: number
  contado: number
  depositado: number
  /** Soma das diferenças de todos os turnos do mês. */
  diferenca: number
  /** O que ainda está no cofre por depositar. */
  emCofre: number
  envelopes: number
  faturas: number
  /** Faturas que ainda não foram atribuídas a nenhum envelope. */
  faturasSoltas: Saida[]
  /** Pagamentos que não caem dentro de nenhum turno fechado. */
  foraDeTurno: Recebido[]
  /** Turnos que se sobrepõem — o mesmo dinheiro contado duas vezes. */
  sobrepostos: [Envelope, Envelope][]
}

export function balanco(
  recebido: Recebido[], saidas: Saida[], envelopes: Envelope[], depositos: Deposito[],
  /** Último envelope antes deste mês: o que deixou na caixa é a abertura do primeiro. */
  anterior?: Envelope | null,
): Balanco {
  const ordenados = [...envelopes]
    .sort((a, b) => instante(a.inicio).localeCompare(instante(b.inicio)))
  const porEnvelope = new Map<string, Saida[]>()
  for (const s of saidas) {
    if (!s.envelope_id) continue
    const l = porEnvelope.get(s.envelope_id) ?? []
    l.push(s); porEnvelope.set(s.envelope_id, l)
  }

  const linhas: LinhaDoMes[] = []
  let abertura = anterior?.transporte ?? 0
  let acumulado = 0
  for (const env of ordenados) {
    const faturas = porEnvelope.get(env.id) ?? []
    const contas = contasDoEnvelope(env, abertura, recebido, faturas)
    acumulado = cents(acumulado + contas.diferenca)
    linhas.push({ envelope: env, contas, faturas, acumulado })
    abertura = env.transporte
  }

  const cobertos = new Set<string>()
  for (const env of ordenados)
    for (const r of recebidoDoTurno(recebido, env.inicio, env.fim)) cobertos.add(r.id)

  const sobrepostos: [Envelope, Envelope][] = []
  for (let i = 1; i < ordenados.length; i++)
    if (instante(ordenados[i].inicio) < instante(ordenados[i - 1].fim))
      sobrepostos.push([ordenados[i - 1], ordenados[i]])

  return {
    linhas,
    recebido: somar(recebido, x => x.valor),
    saidas: somar(saidas, x => x.valor),
    contado: somar(envelopes, x => x.valor),
    depositado: somar(depositos, x => x.valor),
    diferenca: acumulado,
    emCofre: cents(somar(envelopes, x => x.valor) - somar(depositos, x => x.valor)),
    envelopes: envelopes.length,
    faturas: saidas.length,
    faturasSoltas: saidas.filter(s => !s.envelope_id),
    foraDeTurno: recebido.filter(r => !cobertos.has(r.id)),
    sobrepostos,
  }
}

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

/** Um dia para cada lado, para os turnos que atravessam a meia-noite do mês. */
const desviar = (dia: string, dias: number) => {
  const d = new Date(`${dia}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

export async function fetchMes(caixaId: string, de: string, ate: string) {
  const [r, s, e, d, ant] = await Promise.all([
    // o turno da noite de 31 vai buscar pagamentos do dia 1 seguinte, e vice-versa
    supabase.from('cx_recebido').select('*').eq('caixa_id', caixaId)
      .gte('dia', desviar(de, -1)).lte('dia', desviar(ate, 1)).order('momento'),
    supabase.from('cx_saidas').select('*').eq('caixa_id', caixaId)
      .gte('dia', de).lte('dia', ate).order('dia'),
    supabase.from('cx_envelopes').select('*').eq('caixa_id', caixaId)
      .gte('dia', de).lte('dia', ate).order('inicio'),
    supabase.from('cx_depositos').select('*').eq('caixa_id', caixaId)
      .gte('dia', de).lte('dia', ate).order('dia'),
    // o último turno antes do mês: o que deixou na caixa abre o primeiro turno
    supabase.from('cx_envelopes').select('*').eq('caixa_id', caixaId)
      .lt('dia', de).order('inicio', { ascending: false }).limit(1).maybeSingle(),
  ])
  for (const x of [r, s, e, d]) if (x.error) throw x.error
  const env = (x: Record<string, unknown>) => ({
    ...x, valor: num(x.valor), transporte: num(x.transporte),
    denominacoes: x.denominacoes ?? {},
  }) as Envelope
  return {
    recebido: (r.data ?? []).map(x => ({ ...x, valor: num(x.valor) })) as Recebido[],
    saidas: (s.data ?? []).map(x => ({ ...x, valor: num(x.valor) })) as Saida[],
    envelopes: (e.data ?? []).map(env),
    depositos: (d.data ?? []).map(x => ({ ...x, valor: num(x.valor) })) as Deposito[],
    anterior: ant.data ? env(ant.data) : null,
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
    // sem hora a que se agarrar, fica ao meio-dia: cai dentro de qualquer
    // turno que cubra este dia
    momento: `${dia}T12:00:00`,
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

/**
 * Grava o envelope e prende-lhe as faturas que vieram lá dentro. As que
 * deixarem de estar seleccionadas voltam a ficar soltas — a fatura não se perde,
 * só deixa de pertencer a este turno.
 */
export async function juntarEnvelope(
  caixaId: string, e: Omit<Envelope, 'id'>, faturas: string[], por: string | null,
) {
  const { data, error } = await supabase.from('cx_envelopes')
    .insert({ ...e, caixa_id: caixaId, atualizado_por: por }).select('id').single()
  if (error) throw error
  await atribuirFaturas(data.id as string, faturas, caixaId)
  return data.id as string
}

export async function guardarEnvelope(
  id: string, caixaId: string, e: Omit<Envelope, 'id'>, faturas: string[], por: string | null,
) {
  const { error } = await supabase.from('cx_envelopes')
    .update({ ...e, atualizado_por: por }).eq('id', id)
  if (error) throw error
  await atribuirFaturas(id, faturas, caixaId)
}

async function atribuirFaturas(envelopeId: string, faturas: string[], caixaId: string) {
  // soltar as que já lá não pertencem
  const soltar = supabase.from('cx_saidas').update({ envelope_id: null })
    .eq('envelope_id', envelopeId)
  const { error: e1 } = faturas.length
    ? await soltar.not('id', 'in', `(${faturas.join(',')})`)
    : await soltar
  if (e1) throw e1
  if (!faturas.length) return
  const { error: e2 } = await supabase.from('cx_saidas')
    .update({ envelope_id: envelopeId }).eq('caixa_id', caixaId).in('id', faturas)
  if (e2) throw e2
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
export function lerColagem(texto: string): Omit<Saida, 'id' | 'ficheiro' | 'envelope_id'>[] {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim())
  if (!linhas.length) return []

  const parte = (l: string) => l.split(/\t|;/).map(x => x.trim())
  const mapa = cabecalho(parte(linhas[0]))
  const corpo = mapa ? linhas.slice(1) : linhas

  const fora: Omit<Saida, 'id' | 'ficheiro' | 'envelope_id'>[] = []
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
