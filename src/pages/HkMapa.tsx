import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/appState'
import {
  balanco, corDoBalanco, fetchDias, fetchLimpezas, fetchOutsourcing, fetchParametros,
  horas, minutosDoTurno, pessoasTexto,
  type Balanco, type Dia, type Parametros,
} from '../lib/housekeeping'
import { MESES, dmy, lastDayOfMonth, qty } from '../lib/format'
import { Loading, StatCard } from '../components/ui'
import { ehMes, mesCorrente, useLembrado } from '../lib/lembrar'
import BarrasAno from '../components/BarrasAno'

type Linha = { d: Dia; b: Balanco }

export default function HkMapa() {
  const { hotelId } = useApp()
  const nav = useNavigate()
  const [mes, setMes] = useLembrado('hk.mes', mesCorrente, ehMes)
  const [param, setParam] = useState<Parametros | null>(null)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [ano, setAno] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!hotelId) return
    setLoading(true)
    const de = `${mes}-01`, ate = lastDayOfMonth(mes)
    // Doze meses para trás, para o gráfico ter com que comparar.
    const anoDe = `${Number(mes.slice(0, 4)) - 1}-01-01`
    const juntar = (ds: Dia[], ls: { dia: string; minutos: number }[],
                    ts: { dia: string; hora_inicio: string; hora_fim: string; almoco_min: number }[]) => {
      const porDia = <T extends { dia: string }>(xs: T[]) => {
        const m: Record<string, T[]> = {}
        for (const x of xs) (m[x.dia] ??= []).push(x)
        return m
      }
      const lm = porDia(ls), tm = porDia(ts)
      return ds.map(d => ({
        d,
        b: balanco(d,
          (lm[d.dia] ?? []).reduce((s, x) => s + x.minutos, 0),
          (tm[d.dia] ?? []).reduce((s, x) => s + minutosDoTurno(x), 0)),
      }))
    }

    Promise.all([
      fetchParametros(hotelId),
      fetchDias(hotelId, de, ate), fetchLimpezas(hotelId, de, ate), fetchOutsourcing(hotelId, de, ate),
      fetchDias(hotelId, anoDe, ate), fetchLimpezas(hotelId, anoDe, ate), fetchOutsourcing(hotelId, anoDe, ate),
    ])
      .then(([p, ds, ls, ts, ds2, ls2, ts2]) => {
        setParam(p)
        setLinhas(juntar(ds, ls, ts))
        setAno(juntar(ds2, ls2, ts2))
      })
      .finally(() => setLoading(false))
  }, [hotelId, mes])

  const porDia = useMemo(
    () => Object.fromEntries(linhas.map(l => [l.d.dia, l])), [linhas])

  const T = useMemo(() => {
    const t = { dias: linhas.length, necessarios: 0, disponiveis: 0, pessoas: 0,
                quartos: 0, saidas: 0, staff: 0, limpezas: 0, outsourcing: 0 }
    for (const { d, b } of linhas) {
      t.necessarios += b.necessarios; t.disponiveis += b.disponiveis; t.pessoas += b.pessoas
      t.quartos += d.quartos_ocupados; t.saidas += d.saidas; t.staff += d.staff
      t.limpezas += b.limpezasMin; t.outsourcing += b.outsourcingMin
    }
    return t
  }, [linhas])

  /** Média de pessoas ± por mês, este ano contra o anterior. */
  const mensal = useMemo(() => {
    const m: Record<string, { soma: number; n: number }> = {}
    for (const { d, b } of ano) {
      const k = d.dia.slice(0, 7)
      const e = (m[k] ??= { soma: 0, n: 0 })
      e.soma += b.pessoas; e.n += 1
    }
    const anoAtual = mes.slice(0, 4)
    const anoAnt = String(Number(anoAtual) - 1)
    return MESES.map((rot, i) => {
      const mm = String(i + 1).padStart(2, '0')
      const a = m[`${anoAtual}-${mm}`], b = m[`${anoAnt}-${mm}`]
      return {
        rot: rot.slice(0, 3),
        tit: rot,
        a: a ? a.soma / a.n : null,
        b: b ? b.soma / b.n : null,
        destaque: `${anoAtual}-${mm}` === mes,
      }
    })
  }, [ano, mes])

  const temComparacao = mensal.some(p => p.b != null)

  if (loading) return <Loading />
  if (!param) return null

  // A grelha começa à segunda-feira, como as semanas de trabalho.
  const primeiro = new Date(`${mes}-01T12:00:00`)
  const vazias = (primeiro.getDay() + 6) % 7
  const nDias = Number(lastDayOfMonth(mes).slice(8))

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">Mês</label>
          <input type="month" className="input w-auto" value={mes}
                 onChange={e => setMes(e.target.value)} />
        </div>
        <p className="flex-1 text-xs text-slate-500">
          Cada dia mostra quantas pessoas faltaram ou sobraram. Vermelho é falta,
          azul é sobra, cinzento é o dia a fechar certo.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Dias registados" value={T.dias}
                  hint={`${qty(T.quartos)} quartos · ${qty(T.saidas)} saídas`} />
        <StatCard label="Trabalho a fazer" value={horas(T.necessarios)}
                  hint={`${horas(T.disponiveis)} disponíveis`} />
        <StatCard label="Diferença no mês" value={horas(T.necessarios - T.disponiveis)}
                  tone={T.necessarios > T.disponiveis ? 'warn' : 'default'}
                  hint={`${qty(T.staff)} turnos de pessoal`} />
        <StatCard label="Pessoas ± por dia"
                  value={T.dias ? pessoasTexto(T.pessoas / T.dias) : '—'}
                  hint={T.outsourcing ? `${horas(T.outsourcing)} de outsourcing no mês` : 'sem outsourcing'} />
      </div>

      {/* ------------------------------------------------------------- mapa */}
      <div className="card p-4">
        <div className="grid grid-cols-7 gap-1.5">
          {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map(d => (
            <div key={d} className="pb-1 text-center text-[11px] uppercase tracking-wide text-slate-400">
              {d}
            </div>
          ))}
          {Array.from({ length: vazias }, (_, i) => <div key={`v${i}`} />)}
          {Array.from({ length: nDias }, (_, i) => {
            const iso = `${mes}-${String(i + 1).padStart(2, '0')}`
            const l = porDia[iso]
            return (
              <button
                key={iso}
                onClick={() => nav('/hk')}
                title={l
                  ? `${dmy(iso)} · ${qty(l.d.quartos_ocupados)} quartos, ${qty(l.d.saidas)} saídas, ${qty(l.d.staff)} turnos · ${horas(l.b.diferenca)}`
                  : `${dmy(iso)} — por registar`}
                className={`aspect-square rounded-lg border p-1.5 text-left ${
                  l ? 'border-slate-200' : 'border-dashed border-slate-200'}`}
                style={{ backgroundColor: l ? corDoBalanco(l.b.pessoas) : undefined }}
              >
                <div className="text-[11px] text-slate-500">{i + 1}</div>
                {l ? (
                  <>
                    <div className="text-sm font-semibold tabular-nums leading-tight text-slate-900">
                      {pessoasTexto(l.b.pessoas)}
                    </div>
                    <div className="text-[10px] leading-tight text-slate-600">
                      {qty(l.d.staff)} turnos
                    </div>
                  </>
                ) : (
                  <div className="text-[10px] text-slate-300">—</div>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded" style={{ backgroundColor: corDoBalanco(-1.5) }} />
            sobra gente
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded" style={{ backgroundColor: corDoBalanco(0) }} />
            equilibrado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded" style={{ backgroundColor: corDoBalanco(1.5) }} />
            falta gente
          </span>
          <span className="ml-auto">
            {linhas.length} de {nDias} dias registados
          </span>
        </div>
      </div>

      {/* --------------------------------------------------- evolução mensal */}
      <div className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">
            Pessoas ± por dia, média de cada mês
          </h3>
          <span className="text-xs text-slate-400">
            {temComparacao
              ? `${mes.slice(0, 4)} vs ${Number(mes.slice(0, 4)) - 1}`
              : mes.slice(0, 4)}
          </span>
        </div>
        <BarrasAno
          dados={mensal}
          ano={mes.slice(0, 4)}
          ant={String(Number(mes.slice(0, 4)) - 1)}
          fmt={v => pessoasTexto(v)}
          altura={220}
        />
        <p className="mt-1 text-xs text-slate-400">
          Acima de zero faltou gente; abaixo, sobrou.
        </p>
      </div>
    </div>
  )
}
