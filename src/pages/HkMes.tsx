/**
 * Housekeeping — o mês inteiro numa tabela.
 *
 * Uma linha por dia. Os quartos e as saídas vêm do relatório de turno e só se
 * escrevem para corrigir; escreve-se aqui quantos turnos de pessoal houve e
 * quanto tempo foi para limpezas gerais.
 *
 * Cada dia abre para o detalhe — a nota, as limpezas discriminadas e o
 * outsourcing — para não ser preciso sair da tabela para tratar de um dia.
 */
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import {
  apagarLimpeza, apagarTurno, balanco, corDoBalanco, custoDoTurno, definirLimpezaDoDia,
  fetchDias, fetchDoTurno, fetchLimpezas, fetchOutsourcing, fetchParametros, guardarDias,
  horas, juntarLimpeza, juntarTurno, minutosDoTurno, pessoasTexto,
  type Dia, type DoTurno, type Limpeza, type Parametros, type Turno,
} from '../lib/housekeeping'
import { diaSemanaCurto, dmy, lastDayOfMonth, money, qty, todayISO } from '../lib/format'
import { Loading, NumInput, Spinner, StatCard, useToast } from '../components/ui'
import BulkEdit, { Caixa, type CampoBulk } from '../components/BulkEdit'
import { useSeleccao } from '../lib/seleccao'
import { ehMes, mesCorrente, useLembrado } from '../lib/lembrar'

interface Linha {
  dia: string
  /** A linha já existe em hk_dias? */
  existe: boolean
  quartos: number
  saidas: number
  staff: number
  limpezasMin: number
  /** Limpezas discriminadas: mais do que uma não se deixa esmagar por um número. */
  limpezas: Limpeza[]
  outsourcing: Turno[]
  nota: string | null
  min_por_quarto: number
  min_por_saida: number
  horas_por_turno: number
  /** O que o relatório de turno diz, para se ver quando o escrito difere. */
  doTurno: DoTurno | null
}

export default function HkMes() {
  const { hotelId } = useApp()
  const { email, canWrite } = useAuth()
  const toast = useToast()
  const podeEscrever = canWrite('HSK')

  const [mes, setMes] = useLembrado('hk.mes', mesCorrente, ehMes)
  const [param, setParam] = useState<Parametros | null>(null)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [original, setOriginal] = useState<Record<string, Linha>>({})
  const [aberto, setAberto] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [aGravar, setAGravar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = async () => {
    if (!hotelId) return
    setLoading(true)
    try {
      const de = `${mes}-01`, ate = lastDayOfMonth(mes)
      const [p, ds, ls, ts, occ] = await Promise.all([
        fetchParametros(hotelId),
        fetchDias(hotelId, de, ate),
        fetchLimpezas(hotelId, de, ate),
        fetchOutsourcing(hotelId, de, ate),
        fetchDoTurno(hotelId, de, ate),
      ])
      setParam(p)

      const agrupar = <T extends { dia: string }>(xs: T[]) => {
        const m: Record<string, T[]> = {}
        for (const x of xs) (m[x.dia] ??= []).push(x)
        return m
      }
      const dm = Object.fromEntries(ds.map(d => [d.dia, d]))
      const lm = agrupar(ls)
      const tm = agrupar(ts)

      const novas: Linha[] = Array.from({ length: Number(ate.slice(8)) }, (_, i) => {
        const dia = `${mes}-${String(i + 1).padStart(2, '0')}`
        const d: Dia | undefined = dm[dia]
        const o = occ[dia] ?? null
        const limp = lm[dia] ?? []
        return {
          dia,
          existe: !!d,
          // sem linha gravada, o dia arranca com o que o turno diz
          quartos: d?.quartos_ocupados ?? o?.quartos ?? 0,
          saidas: d?.saidas ?? o?.saidas ?? 0,
          staff: d?.staff ?? 0,
          limpezasMin: limp.reduce((s, x) => s + x.minutos, 0),
          limpezas: limp,
          outsourcing: tm[dia] ?? [],
          nota: d?.nota ?? null,
          min_por_quarto: d?.min_por_quarto ?? p.min_por_quarto,
          min_por_saida: d?.min_por_saida ?? p.min_por_saida,
          horas_por_turno: d?.horas_por_turno ?? p.horas_por_turno,
          doTurno: o,
        }
      })
      setLinhas(novas)
      setOriginal(Object.fromEntries(novas.map(l => [l.dia, { ...l }])))
    } catch (e) {
      setErro((e as Error).message)
    } finally { setLoading(false) }
  }
  useEffect(() => { carregar() }, [hotelId, mes])

  const mudar = (dia: string, patch: Partial<Linha>) =>
    setLinhas(ls => ls.map(l => (l.dia === dia ? { ...l, ...patch } : l)))

  const mudou = (l: Linha) => {
    const o = original[l.dia]
    if (!o) return false
    return l.staff !== o.staff || l.quartos !== o.quartos || l.saidas !== o.saidas ||
           l.limpezasMin !== o.limpezasMin || l.nota !== o.nota
  }
  const alterados = linhas.filter(mudou)

  /** Grava o que estiver pendente. Sem recarregar nem avisar — quem chama decide. */
  const gravarPendentes = async () => {
    if (!hotelId || !param) return 0
    const pend = linhas.filter(mudou)
    if (!pend.length) return 0
    await guardarDias(hotelId, pend.map(l => ({
      dia: l.dia,
      quartos_ocupados: l.quartos,
      saidas: l.saidas,
      staff: l.staff,
      nota: l.nota,
      min_por_quarto: l.min_por_quarto,
      min_por_saida: l.min_por_saida,
      horas_por_turno: l.horas_por_turno,
    })), email)
    for (const l of pend) {
      if (l.limpezasMin === original[l.dia].limpezasMin) continue
      await definirLimpezaDoDia(hotelId, l.dia, l.limpezasMin, l.limpezas)
    }
    return pend.length
  }

  const gravar = async () => {
    setAGravar(true)
    try {
      const n = await gravarPendentes()
      toast(`${n} ${n === 1 ? 'dia gravado' : 'dias gravados'}`)
      await carregar()
    } catch (e) { toast((e as Error).message, 'erro') }
    finally { setAGravar(false) }
  }

  /**
   * As limpezas e o outsourcing vivem em tabelas próprias e gravam-se logo. Para
   * não deixar cair o que estava escrito na grelha, grava-se primeiro o pendente.
   */
  const comPendentes = async (accao: () => Promise<void>) => {
    setAGravar(true)
    try {
      await gravarPendentes()
      await accao()
      await carregar()
    } catch (e) { toast((e as Error).message, 'erro') }
    finally { setAGravar(false) }
  }

  const contas = useMemo(() => linhas.map(l => ({
    l,
    b: balanco(
      { id: '', dia: l.dia, nota: l.nota, quartos_ocupados: l.quartos, saidas: l.saidas,
        staff: l.staff, min_por_quarto: l.min_por_quarto, min_por_saida: l.min_por_saida,
        horas_por_turno: l.horas_por_turno },
      l.limpezasMin,
      l.outsourcing.reduce((s, t) => s + minutosDoTurno(t), 0)),
  })), [linhas])

  const T = useMemo(() => {
    const t = { quartos: 0, saidas: 0, staff: 0, necessarios: 0, disponiveis: 0,
                pessoas: 0, dias: 0, porPreencher: 0 }
    for (const { l, b } of contas) {
      // os quartos e as saídas são do mês inteiro: vêm do turno e sabem-se sempre
      t.quartos += l.quartos; t.saidas += l.saidas; t.staff += l.staff
      // já o trabalho e a diferença só contam onde há pessoal escrito — senão um
      // mês por preencher parecia um mês em falta de gente
      if (l.existe || l.staff > 0) {
        t.necessarios += b.necessarios; t.disponiveis += b.disponiveis
        t.pessoas += b.pessoas; t.dias += 1
      } else if (l.quartos > 0 || l.saidas > 0) t.porPreencher += 1
    }
    return t
  }, [contas])

  const dias = useMemo(() => linhas.map(l => l.dia), [linhas])
  const sel = useSeleccao(dias)

  /** Os dias que já aconteceram, têm movimento e ainda não têm pessoal escrito. */
  const escolherPorPreencher = () => {
    const alvo = linhas.filter(l =>
      l.dia <= todayISO() && !l.existe && l.staff === 0 && (l.quartos > 0 || l.saidas > 0))
    sel.nenhum()
    for (const l of alvo) sel.alternar(l.dia)
  }

  const camposBulk: CampoBulk[] = [
    { chave: 'staff', rotulo: 'Turnos de pessoal', tipo: 'numero',
      patch: v => ({ staff: Math.max(0, Number(v)) }) },
    { chave: 'limpezasMin', rotulo: 'Limpezas gerais (min)', tipo: 'numero',
      nota: 'Os dias que tenham várias limpezas discriminadas ficam como estão — '
          + 'um número só não as pode substituir.',
      patch: v => ({ limpezasMin: Math.max(0, Number(v)) }) },
    { chave: 'quartos', rotulo: 'Quartos ocupados', tipo: 'numero',
      nota: 'Isto costuma vir do relatório de turno; só se mexe para corrigir.',
      patch: v => ({ quartos: Math.max(0, Number(v)) }) },
    { chave: 'saidas', rotulo: 'Saídas', tipo: 'numero',
      nota: 'Isto costuma vir do relatório de turno; só se mexe para corrigir.',
      patch: v => ({ saidas: Math.max(0, Number(v)) }) },
  ]

  /** Escreve o campo nas linhas escolhidas. Fica por gravar, como tudo o resto. */
  const aplicarBulk = (patch: Record<string, unknown>, campo: CampoBulk) => {
    const escolhidos = new Set(sel.escolhidos())
    const intocaveis = (l: Linha) => campo.chave === 'limpezasMin' && l.limpezas.length > 1
    const alvo = new Set(
      linhas.filter(l => escolhidos.has(l.dia) && !intocaveis(l)).map(l => l.dia))
    const saltados = escolhidos.size - alvo.size
    setLinhas(ls => ls.map(l => (alvo.has(l.dia) ? { ...l, ...patch } as Linha : l)))
    toast(saltados
      ? `Aplicado a ${alvo.size} dias · ${saltados} com limpezas discriminadas ficaram como estavam`
      : `Aplicado a ${alvo.size} ${alvo.size === 1 ? 'dia' : 'dias'}`)
  }

  if (erro) {
    return (
      <div className="card p-6 text-sm">
        <h2 className="mb-2 font-semibold text-red-600">Não foi possível abrir o mês</h2>
        <p className="text-slate-600">{erro}</p>
      </div>
    )
  }
  if (loading || !param) return <Loading />

  const hoje = todayISO()

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <label className="label">Mês</label>
            <input type="month" className="input w-auto" value={mes}
                   onChange={e => setMes(e.target.value)} />
          </div>
          {podeEscrever && (
            <div className="mb-1 flex flex-wrap gap-1.5 sm:border-l sm:border-slate-200 sm:pl-6">
              <button className="btn-ghost" onClick={() => sel.todos()}>Escolher o mês</button>
              <button className="btn-ghost" onClick={escolherPorPreencher}>
                Escolher os que faltam
              </button>
            </div>
          )}
          {!podeEscrever && (
            <span className="chip mb-2 bg-amber-100 text-amber-800">só consulta</span>
          )}
        </div>
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          Os quartos e as saídas vêm do relatório de turno — só se escrevem para corrigir.
          Toca no dia para abrir a nota, as limpezas e o outsourcing.
          {podeEscrever && ' Para mexer em vários dias de uma vez, escolhe-os na primeira coluna'
            + ' — o shift-clique apanha o intervalo todo.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Quartos no mês" value={qty(T.quartos)}
                  hint={`${qty(T.saidas)} saídas`} />
        <StatCard label="Turnos de pessoal" value={qty(T.staff)}
                  hint={T.porPreencher
                    ? `${T.porPreencher} dias com quartos e sem pessoal escrito`
                    : 'todos os dias com movimento preenchidos'} />
        <StatCard label="Diferença" value={T.dias ? horas(T.necessarios - T.disponiveis) : '—'}
                  tone={T.necessarios > T.disponiveis ? 'warn' : 'default'}
                  hint={T.dias
                    ? `${horas(T.necessarios)} a fazer · ${horas(T.disponiveis)} disponíveis, nos ${T.dias} dias escritos`
                    : 'ainda não há dias escritos'} />
        <StatCard label="Pessoas ± por dia"
                  value={T.dias ? pessoasTexto(T.pessoas / T.dias) : '—'}
                  hint={`média dos ${T.dias} dias preenchidos`} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[880px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[4%]" /><col className="w-[15%]" />
            <col className="w-[9%]" /><col className="w-[9%]" />
            <col className="w-[10%]" /><col className="w-[10%]" />
            <col className="w-[9%]" />
            <col className="w-[8%]" /><col className="w-[8%]" />
            <col className="w-[10%]" /><col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200">
              <th className="th">
                {podeEscrever && (
                  <Caixa
                    ligada={sel.n > 0 && sel.n === linhas.length}
                    titulo={sel.n ? 'desescolher tudo' : 'escolher o mês inteiro'}
                    onAlternar={() => (sel.n ? sel.nenhum() : sel.todos())}
                  />
                )}
              </th>
              <th className="th">Dia</th>
              <th className="th !text-right">Quartos</th>
              <th className="th !text-right">Saídas</th>
              <th className="th !text-right">Turnos</th>
              <th className="th !text-right">Limpezas</th>
              <th className="th !text-right">Outsourc.</th>
              <th className="th !text-right">A fazer</th>
              <th className="th !text-right">Dispon.</th>
              <th className="th !text-right">Pessoas ±</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {contas.map(({ l, b }) => {
              const fds = ['sáb', 'dom'].includes(diaSemanaCurto(l.dia))
              const vazio = !l.existe && l.staff === 0
              const detalhe = aberto === l.dia
              const outMin = l.outsourcing.reduce((s, t) => s + minutosDoTurno(t), 0)
              return [
                <tr key={l.dia}
                    className={`border-b border-slate-100 ${
                      sel.tem(l.dia) ? 'bg-brand-50'
                        : mudou(l) ? 'bg-brand-50/70' : fds ? 'bg-slate-50/70' : ''}`}>
                  <td className="td">
                    {podeEscrever && (
                      <Caixa ligada={sel.tem(l.dia)}
                             onAlternar={com => sel.alternar(l.dia, com)} />
                    )}
                  </td>
                  <td className="td whitespace-nowrap">
                    <span className={`tabular-nums ${l.dia === hoje
                      ? 'font-semibold text-brand-700' : 'text-slate-700'}`}>
                      {l.dia.slice(8)}
                    </span>
                    <span className="ml-1 text-[11px] uppercase text-slate-400">
                      {diaSemanaCurto(l.dia)}
                    </span>
                    {l.nota && <span className="ml-1 text-slate-300" title={l.nota}>✎</span>}
                  </td>

                  <Celula campo="quartos" dia={l.dia} valor={l.quartos}
                          doTurno={l.doTurno?.quartos} podeEscrever={podeEscrever}
                          onChange={n => mudar(l.dia, { quartos: n })} />
                  <Celula campo="saidas" dia={l.dia} valor={l.saidas}
                          doTurno={l.doTurno?.saidas} podeEscrever={podeEscrever}
                          onChange={n => mudar(l.dia, { saidas: n })} />
                  <Celula campo="staff" dia={l.dia} valor={l.staff}
                          podeEscrever={podeEscrever}
                          onChange={n => mudar(l.dia, { staff: n })} />

                  <td className="td text-right">
                    {l.limpezas.length > 1 ? (
                      <button className="text-xs text-slate-500 underline decoration-dotted"
                              onClick={() => setAberto(detalhe ? null : l.dia)}
                              title="várias linhas — abre o dia">
                        {horas(l.limpezasMin)}
                      </button>
                    ) : (
                      <NumInput id={`limpezasMin-${l.dia}`}
                                className="ml-auto h-8 w-full max-w-[84px] px-2 text-sm"
                                value={l.limpezasMin} disabled={!podeEscrever}
                                onKeyDown={seguinte('limpezasMin', l.dia)}
                                onChange={n => mudar(l.dia, { limpezasMin: Math.max(0, n) })} />
                    )}
                  </td>

                  <td className="td text-right tabular-nums text-slate-500">
                    {outMin ? horas(outMin) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-right tabular-nums text-slate-600">
                    {b.necessarios ? horas(b.necessarios) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-right tabular-nums text-slate-600">
                    {b.disponiveis ? horas(b.disponiveis) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-right font-semibold tabular-nums text-slate-900"
                      style={{ backgroundColor: vazio ? undefined : corDoBalanco(b.pessoas) }}>
                    {vazio ? <span className="text-xs font-normal text-slate-300">—</span>
                           : pessoasTexto(b.pessoas)}
                  </td>
                  <td className="td text-right">
                    <button
                      className={`rounded px-1.5 text-xs ${detalhe
                        ? 'text-brand-700' : 'text-slate-400 hover:text-slate-700'}`}
                      title="nota, limpezas e outsourcing deste dia"
                      onClick={() => setAberto(detalhe ? null : l.dia)}
                    >{detalhe ? '▴' : '▾'}</button>
                  </td>
                </tr>,

                detalhe && (
                  <tr key={`${l.dia}-d`} className="border-b border-slate-200 bg-slate-50/80">
                    <td className="px-3 py-3" colSpan={11}>
                      <Detalhe
                        l={l} param={param} podeEscrever={podeEscrever} ocupado={aGravar}
                        onNota={t => mudar(l.dia, { nota: t })}
                        onJuntarLimpeza={(descricao, minutos) => comPendentes(async () => {
                          if (hotelId) await juntarLimpeza(hotelId, { dia: l.dia, descricao, minutos })
                        })}
                        onApagarLimpeza={id => comPendentes(() => apagarLimpeza(id))}
                        onJuntarTurno={t => comPendentes(async () => {
                          if (hotelId) await juntarTurno(hotelId, { ...t, dia: l.dia })
                        })}
                        onApagarTurno={id => comPendentes(() => apagarTurno(id))}
                      />
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Um quarto vale {param.min_por_quarto}min e uma saída {param.min_por_saida}min; cada turno
        de pessoal traz {param.horas_por_turno}h e os meios turnos escrevem-se 0,5. O Enter salta
        para o dia seguinte. Os dias já gravados mantêm os rácios com que nasceram.
      </p>

      {podeEscrever && (sel.n > 0 || alterados.length > 0) && (
        <div className="sticky bottom-16 z-20 space-y-2 md:bottom-4">
          {sel.n > 0 && (
            <BulkEdit n={sel.n} campos={camposBulk} aGravar={aGravar}
                      onAplicar={aplicarBulk} onLimpar={sel.nenhum} />
          )}
          {alterados.length > 0 && (
            <div className="card flex flex-wrap items-center gap-3 border-brand-200 p-3 shadow-lg">
              <span className="text-sm text-slate-700">
                <strong>{alterados.length}</strong>{' '}
                {alterados.length === 1 ? 'dia alterado' : 'dias alterados'}
                <span className="ml-1.5 text-slate-400">
                  {alterados.map(l => l.dia.slice(8)).join(', ')}
                </span>
              </span>
              <button className="btn-ghost ml-auto" disabled={aGravar}
                      onClick={() => setLinhas(Object.values(original).map(l => ({ ...l })))}>
                Descartar
              </button>
              <button className="btn-primary" disabled={aGravar} onClick={gravar}>
                {aGravar ? <span className="flex items-center gap-1.5"><Spinner /> a gravar…</span>
                         : 'Gravar'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Enter salta para o mesmo campo do dia seguinte. */
const seguinte = (campo: string, dia: string) => (e: React.KeyboardEvent) => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const d = new Date(`${dia}T12:00:00`)
  d.setDate(d.getDate() + 1)
  const alvo = document.getElementById(`${campo}-${d.toISOString().slice(0, 10)}`)
  if (alvo instanceof HTMLInputElement) { alvo.focus(); alvo.select() }
}

function Celula({
  dia, campo, valor, doTurno, podeEscrever, onChange,
}: {
  dia: string
  campo: string
  valor: number
  doTurno?: number
  podeEscrever: boolean
  onChange: (n: number) => void
}) {
  // quando o escrito não é o que o turno diz, marca-se: pode ser correcção de
  // propósito, ou um número que ficou para trás
  const difere = doTurno != null && doTurno !== valor
  return (
    <td className="td text-right">
      <NumInput
        id={`${campo}-${dia}`}
        className={`ml-auto h-8 w-full max-w-[84px] px-2 text-sm ${
          difere ? 'border-amber-400 bg-amber-50/60' : ''}`}
        value={valor} disabled={!podeEscrever}
        title={difere ? `O relatório de turno diz ${qty(doTurno)}` : undefined}
        onKeyDown={seguinte(campo, dia)}
        onChange={n => onChange(Math.max(0, n))}
      />
    </td>
  )
}

/* ------------------------------------------------------------- o dia aberto */

function Detalhe({
  l, param, podeEscrever, ocupado,
  onNota, onJuntarLimpeza, onApagarLimpeza, onJuntarTurno, onApagarTurno,
}: {
  l: Linha
  param: Parametros
  podeEscrever: boolean
  ocupado: boolean
  onNota: (t: string | null) => void
  onJuntarLimpeza: (descricao: string, minutos: number) => Promise<void>
  onApagarLimpeza: (id: string) => Promise<void>
  onJuntarTurno: (t: Omit<Turno, 'id' | 'dia'>) => Promise<void>
  onApagarTurno: (id: string) => Promise<void>
}) {
  const custoTotal = l.outsourcing.reduce((s, t) => s + custoDoTurno(t, param).comIva, 0)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-slate-700">{dmy(l.dia)}</h4>
        {l.doTurno && (
          <span className="text-xs text-slate-500">
            o turno diz {qty(l.doTurno.quartos)} quartos e {qty(l.doTurno.saidas)} saídas
          </span>
        )}
        {ocupado && <span className="flex items-center gap-1 text-xs text-slate-500">
          <Spinner /> a guardar
        </span>}
      </div>

      <div>
        <label className="label">Nota do dia</label>
        <input className="input h-9 text-sm" value={l.nota ?? ''} disabled={!podeEscrever}
               placeholder="o que aconteceu neste dia"
               onChange={e => onNota(e.target.value || null)} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ----------------------------------------------- limpezas gerais */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Limpezas gerais
            </h5>
            <span className="text-xs tabular-nums text-slate-500">{horas(l.limpezasMin)}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Trabalho que sai das mesmas horas mas não são quartos.
          </p>
          <div className="mt-2 space-y-1">
            {l.limpezas.map(x => (
              <div key={x.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-700">{x.descricao}</span>
                <span className="shrink-0 tabular-nums text-slate-500">{horas(x.minutos)}</span>
                {podeEscrever && (
                  <button className="shrink-0 rounded px-1 text-slate-400 hover:text-red-600"
                          disabled={ocupado} onClick={() => onApagarLimpeza(x.id)}>✕</button>
                )}
              </div>
            ))}
            {l.limpezas.length === 0 && (
              <p className="py-1 text-sm text-slate-400">
                Nenhuma. O número na tabela cria a primeira.
              </p>
            )}
          </div>
          {podeEscrever && <NovaLimpeza ocupado={ocupado} onJuntar={onJuntarLimpeza} />}
        </div>

        {/* ---------------------------------------------------- outsourcing */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Outsourcing
            </h5>
            <span className="text-xs tabular-nums text-slate-500">
              {horas(l.outsourcing.reduce((s, t) => s + minutosDoTurno(t), 0))}
              {custoTotal > 0 && ` · ${money(custoTotal)} c/IVA`}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Gente de fora que veio ajudar neste dia.
          </p>
          <div className="mt-2 space-y-1">
            {l.outsourcing.map(t => {
              const c = custoDoTurno(t, param)
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-slate-700">
                    {t.nome}
                    {t.feriado && <span className="ml-1.5 chip bg-amber-100 text-amber-800">feriado</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {t.hora_inicio}–{t.hora_fim}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-700">{money(c.comIva)}</span>
                  {podeEscrever && (
                    <button className="shrink-0 rounded px-1 text-slate-400 hover:text-red-600"
                            disabled={ocupado} onClick={() => onApagarTurno(t.id)}>✕</button>
                  )}
                </div>
              )
            })}
            {l.outsourcing.length === 0 && (
              <p className="py-1 text-sm text-slate-400">Ninguém de fora neste dia.</p>
            )}
          </div>
          {podeEscrever && <NovoTurno ocupado={ocupado} onJuntar={onJuntarTurno} />}
        </div>
      </div>
    </div>
  )
}

function NovaLimpeza({
  ocupado, onJuntar,
}: {
  ocupado: boolean
  onJuntar: (d: string, m: number) => Promise<void>
}) {
  const [descricao, setDescricao] = useState('')
  const [minutos, setMinutos] = useState(0)
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2">
      <div className="min-w-[120px] flex-1">
        <label className="label">O que foi feito</label>
        <input className="input h-8 text-sm" value={descricao}
               onChange={e => setDescricao(e.target.value)} />
      </div>
      <div className="w-20">
        <label className="label">Minutos</label>
        <NumInput className="h-8 px-2 text-sm" value={minutos} onChange={setMinutos} />
      </div>
      <button className="btn-ghost shrink-0" disabled={ocupado || !descricao.trim() || minutos <= 0}
              onClick={async () => {
                await onJuntar(descricao.trim(), minutos)
                setDescricao(''); setMinutos(0)
              }}>Juntar</button>
    </div>
  )
}

function NovoTurno({
  ocupado, onJuntar,
}: {
  ocupado: boolean
  onJuntar: (t: Omit<Turno, 'id' | 'dia'>) => Promise<void>
}) {
  const [t, setT] = useState({
    nome: '', feriado: false, hora_inicio: '09:00', hora_fim: '17:30', almoco_min: 30,
  })
  const minutos = minutosDoTurno(t)
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2">
      <div className="min-w-[110px] flex-1">
        <label className="label">Nome</label>
        <input className="input h-8 text-sm" value={t.nome}
               onChange={e => setT({ ...t, nome: e.target.value })} />
      </div>
      <div>
        <label className="label">Entrada</label>
        <input type="time" className="input h-8 w-auto text-sm" value={t.hora_inicio}
               onChange={e => setT({ ...t, hora_inicio: e.target.value })} />
      </div>
      <div>
        <label className="label">Saída</label>
        <input type="time" className="input h-8 w-auto text-sm" value={t.hora_fim}
               onChange={e => setT({ ...t, hora_fim: e.target.value })} />
      </div>
      <div className="w-16">
        <label className="label">Almoço</label>
        <NumInput className="h-8 px-2 text-sm" value={t.almoco_min}
                  onChange={n => setT({ ...t, almoco_min: n })} />
      </div>
      <label className="flex items-center gap-1.5 pb-1.5 text-sm text-slate-600">
        <input type="checkbox" checked={t.feriado}
               onChange={e => setT({ ...t, feriado: e.target.checked })} />
        feriado
      </label>
      <span className="pb-1.5 text-sm text-slate-500">{horas(minutos)}</span>
      <button className="btn-ghost shrink-0" disabled={ocupado || !t.nome.trim() || minutos <= 0}
              onClick={async () => {
                await onJuntar({ ...t, nome: t.nome.trim() })
                setT({ ...t, nome: '' })
              }}>Juntar</button>
    </div>
  )
}
