import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import {
  apagarTurno, custoDoTurno, fetchOutsourcing, fetchParametros, horas, juntarTurno,
  minutosDoTurno, type Parametros, type Turno,
} from '../lib/housekeeping'
import { MESES, diaSemanaCurto, dmy, lastDayOfMonth, money, todayISO } from '../lib/format'
import { Loading, NumInput, StatCard, useToast } from '../components/ui'
import { ehMes, mesCorrente, useLembrado } from '../lib/lembrar'

export default function HkOutsourcing() {
  const { hotelId } = useApp()
  const { canWrite } = useAuth()
  const toast = useToast()
  const podeEscrever = canWrite('HSK')

  const [mes, setMes] = useLembrado('hk.mes', mesCorrente, ehMes)
  const [ano, setAno] = useLembrado('hk.ano', false)
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [param, setParam] = useState<Parametros | null>(null)
  const [loading, setLoading] = useState(true)

  const carregar = () => {
    if (!hotelId) return
    setLoading(true)
    const de = ano ? `${mes.slice(0, 4)}-01-01` : `${mes}-01`
    const ate = ano ? `${mes.slice(0, 4)}-12-31` : lastDayOfMonth(mes)
    Promise.all([fetchParametros(hotelId), fetchOutsourcing(hotelId, de, ate)])
      .then(([p, ts]) => { setParam(p); setTurnos(ts) })
      .catch(e => toast((e as Error).message, 'erro'))
      .finally(() => setLoading(false))
  }
  useEffect(carregar, [hotelId, mes, ano])

  const T = useMemo(() => {
    const t = { turnos: turnos.length, horas: 0, semIva: 0, comIva: 0, dias: 0, feriados: 0 }
    if (!param) return t
    for (const x of turnos) {
      const c = custoDoTurno(x, param)
      t.horas += c.horas; t.semIva += c.semIva; t.comIva += c.comIva
      t.dias += c.diasEquivalentes
      if (x.feriado) t.feriados += 1
    }
    return t
  }, [turnos, param])

  const porPessoa = useMemo(() => {
    if (!param) return []
    const m: Record<string, { horas: number; comIva: number; turnos: number }> = {}
    for (const t of turnos) {
      const c = custoDoTurno(t, param)
      const e = (m[t.nome] ??= { horas: 0, comIva: 0, turnos: 0 })
      e.horas += c.horas; e.comIva += c.comIva; e.turnos += 1
    }
    return Object.entries(m).map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.comIva - a.comIva)
  }, [turnos, param])

  const porMes = useMemo(() => {
    if (!param || !ano) return []
    const m: Record<string, { horas: number; comIva: number }> = {}
    for (const t of turnos) {
      const c = custoDoTurno(t, param)
      const e = (m[t.dia.slice(0, 7)] ??= { horas: 0, comIva: 0 })
      e.horas += c.horas; e.comIva += c.comIva
    }
    const max = Math.max(...Object.values(m).map(v => v.comIva), 1)
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ mes: k, ...v, peso: v.comIva / max }))
  }, [turnos, param, ano])

  if (loading) return <Loading />
  if (!param) return null

  const h1 = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 1 })

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">{ano ? 'Ano' : 'Mês'}</label>
          <input type="month" className="input w-auto" value={mes}
                 onChange={e => setMes(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-600">
          <input type="checkbox" checked={ano} onChange={e => setAno(e.target.checked)} />
          o ano inteiro
        </label>
        <p className="flex-1 text-xs text-slate-500">
          A {money(param.preco_hora_outsourcing)}/hora, ×{param.multiplicador_feriado} em
          feriados, com IVA a {(param.taxa_iva * 100).toLocaleString('pt-PT')}%.
          Lança-se aqui em baixo, ou dentro do dia no separador Mês.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Horas" value={h1(T.horas)}
                  hint={`${T.turnos} turnos · ${h1(T.dias)} dias de trabalho`} />
        <StatCard label="Custo c/ IVA" value={money(T.comIva)} tone="brand"
                  hint={`${money(T.semIva)} sem IVA`} />
        <StatCard label="Custo por hora"
                  value={T.horas ? money(T.comIva / T.horas) : '—'}
                  hint={T.feriados ? `${T.feriados} turnos em feriado` : 'nenhum feriado'} />
        <StatCard label="Pessoas diferentes" value={porPessoa.length}
                  hint={porPessoa[0] ? `mais horas: ${porPessoa[0].nome}` : ''} />
      </div>

      {ano && porMes.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-700">Por mês</h3>
          <div className="mt-3 space-y-1.5">
            {porMes.map(m => (
              <div key={m.mes} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-slate-500">
                  {MESES[Number(m.mes.slice(5)) - 1].slice(0, 3)}
                </span>
                <div className="h-2 flex-1 rounded-sm bg-slate-100">
                  <div className="h-2 rounded-sm bg-[#2a78d6]"
                       style={{ width: `${Math.max(1, m.peso * 100)}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-500">
                  {h1(m.horas)}h
                </span>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-700">
                  {money(m.comIva)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {podeEscrever && hotelId && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-700">Juntar um turno</h3>
          <NovoTurno
            mes={mes}
            onJuntar={async t => { await juntarTurno(hotelId, t); carregar() }}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="th">Dia</th>
                <th className="th">Nome</th>
                <th className="th">Horário</th>
                <th className="th text-right">Almoço</th>
                <th className="th text-right">Horas</th>
                <th className="th text-right">c/ IVA</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {turnos.map(t => {
                const c = custoDoTurno(t, param)
                return (
                  <tr key={t.id} className="border-b border-slate-100">
                    <td className="td whitespace-nowrap">
                      {dmy(t.dia)}
                      <span className="ml-1 text-[11px] text-slate-400">{diaSemanaCurto(t.dia)}</span>
                    </td>
                    <td className="td">
                      {t.nome}
                      {t.feriado && <span className="ml-1.5 chip bg-amber-100 text-amber-800">feriado</span>}
                    </td>
                    <td className="td tabular-nums text-slate-500">
                      {t.hora_inicio}–{t.hora_fim}
                    </td>
                    <td className="td text-right tabular-nums text-slate-500">{t.almoco_min}min</td>
                    <td className="td text-right tabular-nums">{h1(c.horas)}</td>
                    <td className="td text-right font-semibold tabular-nums">{money(c.comIva)}</td>
                    <td className="td text-right">
                      {podeEscrever && (
                        <button
                          className="text-slate-400 hover:text-red-600"
                          title="Apagar"
                          onClick={async () => {
                            if (!confirm(`Apagar o turno de ${t.nome} em ${dmy(t.dia)}?`)) return
                            await apagarTurno(t.id); carregar()
                          }}
                        >✕</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {turnos.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              Nenhum turno de outsourcing neste período.
            </div>
          )}
        </div>

        <div className="card h-fit p-4">
          <h3 className="text-sm font-semibold text-slate-700">Por pessoa</h3>
          <dl className="mt-2 space-y-1.5 text-sm">
            {porPessoa.map(p => (
              <div key={p.nome} className="flex items-baseline justify-between gap-2">
                <dt className="min-w-0 truncate text-slate-700">{p.nome}</dt>
                <dd className="shrink-0 tabular-nums text-slate-500">
                  {h1(p.horas)}h · {money(p.comIva)}
                </dd>
              </div>
            ))}
            {porPessoa.length === 0 && <p className="text-sm text-slate-400">Ninguém.</p>}
          </dl>
        </div>
      </div>
    </div>
  )
}

/**
 * Um turno de gente de fora. O dia arranca no mês que se está a ver, para não
 * ser preciso navegar até lá — mas se o mês for o corrente arranca em hoje.
 */
function NovoTurno({
  mes, onJuntar,
}: {
  mes: string
  onJuntar: (t: Omit<Turno, 'id'>) => Promise<void>
}) {
  const hoje = todayISO()
  const [t, setT] = useState({
    dia: hoje.slice(0, 7) === mes ? hoje : `${mes}-01`,
    nome: '', feriado: false, hora_inicio: '09:00', hora_fim: '17:30', almoco_min: 30,
  })
  const [aGravar, setAGravar] = useState(false)
  const minutos = minutosDoTurno(t)

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div>
        <label className="label">Dia</label>
        <input type="date" className="input h-9 w-auto text-sm" value={t.dia}
               onChange={e => setT({ ...t, dia: e.target.value })} />
      </div>
      <div className="min-w-[140px] flex-1">
        <label className="label">Nome</label>
        <input className="input h-9 text-sm" value={t.nome}
               placeholder="quem veio"
               onChange={e => setT({ ...t, nome: e.target.value })} />
      </div>
      <div>
        <label className="label">Entrada</label>
        <input type="time" className="input h-9 w-auto text-sm" value={t.hora_inicio}
               onChange={e => setT({ ...t, hora_inicio: e.target.value })} />
      </div>
      <div>
        <label className="label">Saída</label>
        <input type="time" className="input h-9 w-auto text-sm" value={t.hora_fim}
               onChange={e => setT({ ...t, hora_fim: e.target.value })} />
      </div>
      <div className="w-20">
        <label className="label">Almoço</label>
        <NumInput className="h-9 text-sm" value={t.almoco_min}
                  onChange={n => setT({ ...t, almoco_min: n })} />
      </div>
      <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-600">
        <input type="checkbox" checked={t.feriado}
               onChange={e => setT({ ...t, feriado: e.target.checked })} />
        feriado
      </label>
      <span className="pb-2 text-sm tabular-nums text-slate-500">{horas(minutos)}</span>
      <button
        className="btn-primary shrink-0"
        disabled={aGravar || !t.nome.trim() || minutos <= 0}
        onClick={async () => {
          setAGravar(true)
          try {
            await onJuntar({ ...t, nome: t.nome.trim() })
            setT({ ...t, nome: '' })
          } finally { setAGravar(false) }
        }}
      >{aGravar ? 'A juntar…' : 'Juntar'}</button>
    </div>
  )
}
