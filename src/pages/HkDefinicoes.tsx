import { useEffect, useState } from 'react'
import { useApp } from '../lib/appState'
import {
  balanco, fetchParametros, guardarParametros, horas, pessoasTexto,
  type Parametros,
} from '../lib/housekeeping'
import { money } from '../lib/format'
import { Loading, NumInput, useToast } from '../components/ui'

export default function HkDefinicoes() {
  const { hotelId } = useApp()
  const toast = useToast()
  const [p, setP] = useState<Parametros | null>(null)
  const [loading, setLoading] = useState(true)
  const [aGravar, setAGravar] = useState(false)

  useEffect(() => {
    if (!hotelId) return
    fetchParametros(hotelId).then(setP).finally(() => setLoading(false))
  }, [hotelId])

  const mudar = (patch: Partial<Parametros>) => setP(x => (x ? { ...x, ...patch } : x))

  if (loading || !p) return <Loading />

  // Um dia típico, para se ver o efeito de mexer nos números.
  const exemplo = {
    id: '', dia: '', nota: null, quartos_ocupados: 73, saidas: 25, staff: 5,
    min_por_quarto: p.min_por_quarto, min_por_saida: p.min_por_saida,
    horas_por_turno: p.horas_por_turno,
  }
  const b = balanco(exemplo, 0, 0)

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Tempos de trabalho</h3>
          <button
            className="btn-primary"
            disabled={aGravar}
            onClick={async () => {
              setAGravar(true)
              try { await guardarParametros(p); toast('Parâmetros guardados') }
              catch (e) { toast((e as Error).message, 'erro') }
              finally { setAGravar(false) }
            }}
          >{aGravar ? 'A guardar…' : 'Guardar'}</button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Minutos por quarto ocupado</label>
            <NumInput value={p.min_por_quarto} onChange={n => mudar({ min_por_quarto: n })} />
            <p className="mt-0.5 text-[11px] text-slate-400">arrumo de continuação</p>
          </div>
          <div>
            <label className="label">Minutos por saída</label>
            <NumInput value={p.min_por_saida} onChange={n => mudar({ min_por_saida: n })} />
            <p className="mt-0.5 text-[11px] text-slate-400">limpeza completa do quarto</p>
          </div>
          <div>
            <label className="label">Horas por turno</label>
            <NumInput value={p.horas_por_turno} onChange={n => mudar({ horas_por_turno: n })} />
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <strong className="text-slate-800">Num dia com 73 quartos, 25 saídas e 5 turnos:</strong>{' '}
          precisa de {horas(b.necessarios)} e tem {horas(b.disponiveis)} —{' '}
          {b.diferenca === 0 ? 'fecha certo'
            : b.diferenca > 0 ? `faltam ${horas(b.diferenca)}` : `sobram ${horas(-b.diferenca)}`}
          , ou seja <strong>{pessoasTexto(b.pessoas)} pessoas</strong>.
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Estes valores só se aplicam aos dias novos. Cada dia guarda os rácios que estavam
          em vigor quando foi registado, para o histórico não se reescrever sempre que se
          afina um número.
        </p>
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-semibold text-slate-700">Outsourcing</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Preço/hora sem IVA</label>
            <NumInput value={p.preco_hora_outsourcing}
                      onChange={n => mudar({ preco_hora_outsourcing: n })} />
          </div>
          <div>
            <label className="label">IVA (%)</label>
            <NumInput value={p.taxa_iva * 100} onChange={n => mudar({ taxa_iva: n / 100 })} />
          </div>
          <div>
            <label className="label">Multiplicador de feriado</label>
            <NumInput value={p.multiplicador_feriado}
                      onChange={n => mudar({ multiplicador_feriado: n })} />
          </div>
          <div>
            <label className="label">Horas de um dia completo</label>
            <NumInput value={p.horas_dia_completo}
                      onChange={n => mudar({ horas_dia_completo: n })} />
            <p className="mt-0.5 text-[11px] text-slate-400">para converter horas em dias</p>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Um turno das 9h00 às 17h30 com 30min de almoço são 8 horas:{' '}
          <strong className="text-slate-800">
            {money(8 * p.preco_hora_outsourcing * (1 + p.taxa_iva))}
          </strong>{' '}
          com IVA, ou {money(8 * p.preco_hora_outsourcing * p.multiplicador_feriado * (1 + p.taxa_iva))}{' '}
          se for feriado.
        </div>
      </div>
    </div>
  )
}
