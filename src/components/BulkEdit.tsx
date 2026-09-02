/**
 * Mudar um campo a várias linhas de uma vez.
 *
 * Aparece em baixo quando há linhas escolhidas: escolhe-se o campo, escreve-se
 * o valor, e aplica-se só ao que está escolhido. Cada página diz que campos
 * deixa mexer — há coisas que não fazem sentido em bloco, como o nome de uma
 * pessoa, e essas simplesmente não vêm na lista.
 */
import { useMemo, useState } from 'react'
import { NumInput, Spinner } from './ui'

export interface CampoBulk {
  chave: string
  rotulo: string
  tipo: 'numero' | 'texto' | 'escolha' | 'data'
  /** Para o tipo 'escolha'. O valor vazio é sempre permitido e quer dizer «—». */
  opcoes?: { v: string; rot: string }[]
  /** Uma linha de aviso quando este campo está escolhido. */
  nota?: string
  /** O que escrever nas linhas escolhidas, a partir do valor introduzido. */
  patch: (valor: string) => Record<string, unknown>
}

export default function BulkEdit({
  n, campos, aGravar, onAplicar, onLimpar, extra,
}: {
  n: number
  campos: CampoBulk[]
  aGravar?: boolean
  onAplicar: (patch: Record<string, unknown>, campo: CampoBulk) => void | Promise<void>
  onLimpar: () => void
  /** Botões próprios da página, à esquerda do Aplicar. */
  extra?: React.ReactNode
}) {
  const [chave, setChave] = useState(campos[0]?.chave ?? '')
  const [texto, setTexto] = useState('')
  const [numero, setNumero] = useState(0)

  const campo = useMemo(
    () => campos.find(c => c.chave === chave) ?? campos[0], [campos, chave])

  if (!campo || n === 0) return null

  const valor = campo.tipo === 'numero' ? String(numero) : texto
  // num campo de escolha, o vazio é um valor legítimo — quer dizer «sem nada»
  const podeAplicar = campo.tipo === 'escolha' || valor.trim() !== ''

  return (
    <div className="card flex flex-wrap items-end gap-x-3 gap-y-2 border-brand-200 p-3 shadow-lg">
        <div className="flex items-baseline gap-1.5 pb-1.5">
          <strong className="text-sm text-slate-800">{n}</strong>
          <span className="text-sm text-slate-600">
            {n === 1 ? 'linha escolhida' : 'linhas escolhidas'}
          </span>
        </div>

        <div>
          <label className="label">Mudar</label>
          <select className="input h-9 w-auto text-sm" value={campo.chave}
                  onChange={e => { setChave(e.target.value); setTexto(''); setNumero(0) }}>
            {campos.map(c => <option key={c.chave} value={c.chave}>{c.rotulo}</option>)}
          </select>
        </div>

        <div>
          <label className="label">para</label>
          {campo.tipo === 'numero' ? (
            <NumInput className="h-9 w-24 text-sm" value={numero} onChange={setNumero} />
          ) : campo.tipo === 'escolha' ? (
            <select className="input h-9 w-auto text-sm" value={texto}
                    onChange={e => setTexto(e.target.value)}>
              <option value="">—</option>
              {(campo.opcoes ?? []).map(o => (
                <option key={o.v} value={o.v}>{o.rot}</option>
              ))}
            </select>
          ) : (
            <input
              type={campo.tipo === 'data' ? 'date' : 'text'}
              className="input h-9 w-auto text-sm"
              value={texto} onChange={e => setTexto(e.target.value)}
            />
          )}
        </div>

        <button className="btn-primary mb-0.5" disabled={!podeAplicar || aGravar}
                onClick={() => onAplicar(campo.patch(valor), campo)}>
          {aGravar ? <span className="flex items-center gap-1.5"><Spinner /> a aplicar…</span>
                   : `Aplicar a ${n}`}
        </button>

        {campo.nota && (
          <p className="w-full text-xs text-slate-500">{campo.nota}</p>
        )}

      <div className="ml-auto flex items-end gap-2">
        {extra}
        <button className="btn-ghost mb-0.5" onClick={onLimpar}>Limpar escolha</button>
      </div>
    </div>
  )
}

/** A caixinha de escolher, com shift-clique para intervalos. */
export function Caixa({
  ligada, onAlternar, titulo,
}: {
  ligada: boolean
  onAlternar: (comShift: boolean) => void
  titulo?: string
}) {
  return (
    <input
      type="checkbox"
      className="cursor-pointer"
      checked={ligada}
      title={titulo ?? 'shift-clique escolhe o intervalo'}
      onChange={() => {}}
      onClick={e => onAlternar((e as React.MouseEvent).shiftKey)}
    />
  )
}
