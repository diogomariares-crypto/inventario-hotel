/**
 * Housekeeping — o mês inteiro numa tabela.
 *
 * O Registo serve para o dia de hoje, com todo o detalhe à volta. Esta página é
 * para o outro caso: sentar-se e preencher (ou corrigir) um mês de uma vez.
 * Cada linha é um dia; os quartos e as saídas já vêm do relatório de turno e
 * só se escreve o que a app não pode saber — quantas pessoas estavam e que
 * limpezas gerais se fizeram.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import {
  balanco, corDoBalanco, definirLimpezaDoDia, fetchDias, fetchDoTurno, fetchLimpezas,
  fetchOutsourcing, fetchParametros, guardarDias, horas, minutosDoTurno, pessoasTexto,
  type Dia, type DoTurno, type Limpeza, type Parametros, type Turno,
} from '../lib/housekeeping'
import { diaSemanaCurto, lastDayOfMonth, qty, todayISO } from '../lib/format'
import { Loading, NumInput, Spinner, StatCard, useToast } from '../components/ui'

/** Uma linha da tabela: o que está gravado, o que o turno diz, e o que se escreveu. */
interface Linha {
  dia: string
  /** A linha já existe em hk_dias? */
  existe: boolean
  quartos: number
  saidas: number
  staff: number
  limpezasMin: number
  /** Limpezas discriminadas: mais do que uma não se deixa esmagar por um número. */
  limpezasDetalhadas: Limpeza[]
  outsourcingMin: number
  nota: string | null
  min_por_quarto: number
  min_por_saida: number
  horas_por_turno: number
  /** O que o relatório de turno diz, para se ver quando o que está escrito difere. */
  doTurno: DoTurno | null
}

export default function HkMes() {
  const { hotelId } = useApp()
  const { email, canWrite } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const podeEscrever = canWrite('HSK')

  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7))
  const [param, setParam] = useState<Parametros | null>(null)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [original, setOriginal] = useState<Record<string, Linha>>({})
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

      const porDia = <T extends { dia: string }>(xs: T[]) => {
        const m: Record<string, T[]> = {}
        for (const x of xs) (m[x.dia] ??= []).push(x)
        return m
      }
      const dm = Object.fromEntries(ds.map(d => [d.dia, d]))
      const lm = porDia(ls)
      const tm = porDia<Turno>(ts)

      const nDias = Number(ate.slice(8))
      const novas: Linha[] = Array.from({ length: nDias }, (_, i) => {
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
          limpezasDetalhadas: limp,
          outsourcingMin: (tm[dia] ?? []).reduce((s, x) => s + minutosDoTurno(x), 0),
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

  /** Um dia mudou se algum dos campos que se escrevem aqui difere do que se leu. */
  const mudou = (l: Linha) => {
    const o = original[l.dia]
    if (!o) return false
    return l.staff !== o.staff || l.quartos !== o.quartos ||
           l.saidas !== o.saidas || l.limpezasMin !== o.limpezasMin
  }
  const alterados = linhas.filter(mudou)

  const gravar = async () => {
    if (!hotelId || !param || !alterados.length) return
    setAGravar(true)
    try {
      // os dias: um upsert só, cada linha com os seus rácios
      await guardarDias(hotelId, alterados.map(l => ({
        dia: l.dia,
        quartos_ocupados: l.quartos,
        saidas: l.saidas,
        staff: l.staff,
        nota: l.nota,
        min_por_quarto: l.min_por_quarto,
        min_por_saida: l.min_por_saida,
        horas_por_turno: l.horas_por_turno,
      })), email)

      // as limpezas: só os dias em que o número mexeu
      for (const l of alterados) {
        if (l.limpezasMin === original[l.dia].limpezasMin) continue
        await definirLimpezaDoDia(hotelId, l.dia, l.limpezasMin, l.limpezasDetalhadas)
      }
      toast(`${alterados.length} ${alterados.length === 1 ? 'dia gravado' : 'dias gravados'}`)
      await carregar()
    } catch (e) {
      toast((e as Error).message, 'erro')
    } finally { setAGravar(false) }
  }

  const contas = useMemo(() => linhas.map(l => ({
    l,
    b: balanco(
      { quartos_ocupados: l.quartos, saidas: l.saidas, staff: l.staff,
        min_por_quarto: l.min_por_quarto, min_por_saida: l.min_por_saida,
        horas_por_turno: l.horas_por_turno, id: '', dia: l.dia, nota: l.nota },
      l.limpezasMin, l.outsourcingMin),
  })), [linhas])

  const T = useMemo(() => {
    const t = { quartos: 0, saidas: 0, staff: 0, necessarios: 0, disponiveis: 0,
                pessoas: 0, dias: 0, porPreencher: 0 }
    for (const { l, b } of contas) {
      t.quartos += l.quartos; t.saidas += l.saidas; t.staff += l.staff
      t.necessarios += b.necessarios; t.disponiveis += b.disponiveis
      // só os dias com alguma coisa entram nas médias
      if (l.existe || l.staff > 0) { t.pessoas += b.pessoas; t.dias += 1 }
      else if (l.quartos > 0 || l.saidas > 0) t.porPreencher += 1
    }
    return t
  }, [contas])

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
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">Mês</label>
          <input type="month" className="input w-auto" value={mes}
                 onChange={e => setMes(e.target.value)} />
        </div>
        {podeEscrever && (
          <PreencherVazios
            onAplicar={n => setLinhas(ls => ls.map(l =>
              // só os dias que ainda não têm nada escrito e que já aconteceram
              (!l.existe && l.staff === 0 && l.dia <= hoje ? { ...l, staff: n } : l)))}
          />
        )}
        <p className="min-w-[200px] flex-1 text-xs text-slate-500">
          Os quartos e as saídas vêm do relatório de turno — só se escrevem para
          corrigir. Escreve-se aqui quantos turnos de pessoal houve e quantos minutos
          foram para limpezas gerais.
        </p>
        {!podeEscrever && <span className="chip bg-amber-100 text-amber-800">só consulta</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Quartos no mês" value={qty(T.quartos)}
                  hint={`${qty(T.saidas)} saídas`} />
        <StatCard label="Turnos de pessoal" value={qty(T.staff)}
                  hint={T.porPreencher
                    ? `${T.porPreencher} dias com quartos e sem pessoal escrito`
                    : 'todos os dias com movimento estão preenchidos'} />
        <StatCard label="Diferença no mês" value={horas(T.necessarios - T.disponiveis)}
                  tone={T.necessarios > T.disponiveis ? 'warn' : 'default'}
                  hint={`${horas(T.necessarios)} a fazer · ${horas(T.disponiveis)} disponíveis`} />
        <StatCard label="Pessoas ± por dia"
                  value={T.dias ? pessoasTexto(T.pessoas / T.dias) : '—'}
                  hint={`média dos ${T.dias} dias preenchidos`} />
      </div>

      {/* --------------------------------------------------------- a tabela */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="sticky top-[var(--cab-h,0px)] z-10 bg-white">
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="th">Dia</th>
              <th className="th text-right">Quartos</th>
              <th className="th text-right">Saídas</th>
              <th className="th text-right">Turnos de pessoal</th>
              <th className="th text-right">Limpezas gerais</th>
              <th className="th text-right">Outsourcing</th>
              <th className="th text-right">A fazer</th>
              <th className="th text-right">Disponível</th>
              <th className="th text-right">Pessoas ±</th>
            </tr>
          </thead>
          <tbody>
            {contas.map(({ l, b }) => {
              const fds = ['sáb', 'dom'].includes(diaSemanaCurto(l.dia))
              const vazio = !l.existe && l.staff === 0
              return (
                <tr key={l.dia}
                    className={`border-b border-slate-100 ${fds ? 'bg-slate-50/60' : ''} ${
                      mudou(l) ? 'bg-brand-50/60' : ''}`}>
                  <td className="td whitespace-nowrap">
                    <button className="text-left hover:text-brand-700 hover:underline"
                            onClick={() => nav(`/hk?dia=${l.dia}`)}
                            title="abrir o dia no Registo">
                      <span className={`tabular-nums ${l.dia === hoje
                        ? 'font-semibold text-brand-700' : 'text-slate-700'}`}>
                        {l.dia.slice(8)}
                      </span>
                      <span className="ml-1 text-[11px] uppercase text-slate-400">
                        {diaSemanaCurto(l.dia)}
                      </span>
                    </button>
                  </td>

                  <Celula dia={l.dia} campo="quartos" valor={l.quartos}
                          doTurno={l.doTurno?.quartos} podeEscrever={podeEscrever}
                          onChange={n => mudar(l.dia, { quartos: n })} />
                  <Celula dia={l.dia} campo="saidas" valor={l.saidas}
                          doTurno={l.doTurno?.saidas} podeEscrever={podeEscrever}
                          onChange={n => mudar(l.dia, { saidas: n })} />
                  <Celula dia={l.dia} campo="staff" valor={l.staff}
                          podeEscrever={podeEscrever}
                          onChange={n => mudar(l.dia, { staff: n })} />

                  <td className="td text-right">
                    {l.limpezasDetalhadas.length > 1 ? (
                      <button
                        className="text-xs text-slate-500 underline decoration-dotted"
                        title={l.limpezasDetalhadas.map(x => `${x.descricao}: ${horas(x.minutos)}`).join('\n')}
                        onClick={() => nav(`/hk?dia=${l.dia}`)}
                      >{horas(l.limpezasMin)} · {l.limpezasDetalhadas.length} linhas</button>
                    ) : (
                      <NumInput
                        id={`limpezasMin-${l.dia}`}
                        className="h-8 w-20 text-right text-sm"
                        value={l.limpezasMin} disabled={!podeEscrever}
                        onKeyDown={seguinte('limpezasMin', l.dia)}
                        onChange={n => mudar(l.dia, { limpezasMin: Math.max(0, n) })}
                      />
                    )}
                  </td>

                  <td className="td text-right tabular-nums text-slate-500">
                    {l.outsourcingMin ? horas(l.outsourcingMin)
                                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-right tabular-nums text-slate-600">
                    {b.necessarios ? horas(b.necessarios) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-right tabular-nums text-slate-600">
                    {b.disponiveis ? horas(b.disponiveis) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-right font-semibold tabular-nums text-slate-900"
                      style={{ backgroundColor: vazio ? undefined : corDoBalanco(b.pessoas) }}>
                    {vazio ? <span className="font-normal text-slate-300">por preencher</span>
                           : pessoasTexto(b.pessoas)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Um quarto vale {param.min_por_quarto}min e uma saída {param.min_por_saida}min; cada
        turno de pessoal traz {param.horas_por_turno}h. Meios turnos escrevem-se 0,5. Os dias
        que já têm linha gravada mantêm os rácios com que nasceram.
      </p>

      {/* ------------------------------------------------- barra de gravação */}
      {podeEscrever && alterados.length > 0 && (
        <div className="sticky bottom-16 z-20 md:bottom-4">
          <div className="card flex flex-wrap items-center gap-3 border-brand-200 bg-white p-3 shadow-lg">
            <span className="text-sm text-slate-700">
              <strong>{alterados.length}</strong>{' '}
              {alterados.length === 1 ? 'dia alterado' : 'dias alterados'}
              <span className="ml-1.5 text-slate-400">
                {alterados.map(l => l.dia.slice(8)).join(', ')}
              </span>
            </span>
            <button className="btn-ghost ml-auto" disabled={aGravar}
                    onClick={() => { setLinhas(Object.values(original).map(l => ({ ...l }))) }}>
              Descartar
            </button>
            <button className="btn-primary" disabled={aGravar} onClick={gravar}>
              {aGravar ? <span className="flex items-center gap-1.5"><Spinner /> a gravar…</span>
                       : 'Gravar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Enter salta para o mesmo campo do dia seguinte, que é como se preenche uma
 * coluna inteira sem tirar as mãos do teclado.
 */
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
  // quando o que está escrito não é o que o turno diz, marca-se — pode ser uma
  // correcção de propósito, ou um número que ficou para trás
  const difere = doTurno != null && doTurno !== valor
  return (
    <td className="td text-right">
      <NumInput
        id={`${campo}-${dia}`}
        className={`h-8 w-20 text-right text-sm ${difere ? 'border-amber-400' : ''}`}
        value={valor} disabled={!podeEscrever}
        title={difere ? `O relatório de turno diz ${qty(doTurno)}` : undefined}
        onKeyDown={seguinte(campo, dia)}
        onChange={n => onChange(Math.max(0, n))}
      />
    </td>
  )
}

function PreencherVazios({ onAplicar }: { onAplicar: (n: number) => void }) {
  const [n, setN] = useState(0)
  return (
    <div>
      <label className="label">Preencher os dias vazios</label>
      <div className="flex items-center gap-1.5">
        <NumInput className="h-9 w-20 text-sm" value={n} onChange={setN} />
        <button className="btn-ghost shrink-0" disabled={n <= 0}
                onClick={() => onAplicar(n)}>
          turnos
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400">
        só os dias já passados e ainda por escrever
      </p>
    </div>
  )
}
