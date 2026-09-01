import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../lib/auth'
import {
  DENOMINACOES, apagar, apagarFicheiro, balanco, estaCerto, ehNota, fetchCaixas, fetchMes,
  guardarFicheiro, guardarSaida, importarRecebido, juntarDeposito, juntarEnvelope,
  juntarRecebidoManual, juntarSaida, lerColagem, lerRelatorioPms, linkDaFatura,
  somaDenominacoes, TOLERANCIA,
  type Balanco, type Caixa, type Deposito, type Envelope, type Recebido, type Saida,
} from '../lib/caixa'
import { dmy, lastDayOfMonth, money, todayISO } from '../lib/format'
import { Loading, Modal, NumInput, Spinner, StatCard, useToast } from '../components/ui'

type Dados = {
  recebido: Recebido[]; saidas: Saida[]; envelopes: Envelope[]; depositos: Deposito[]
}

export default function CaixaPage() {
  const { email } = useAuth()
  const toast = useToast()

  const [caixas, setCaixas] = useState<Caixa[]>([])
  const [caixaId, setCaixaId] = useState<string>('')
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7))
  const [d, setD] = useState<Dados | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [novoEnvelope, setNovoEnvelope] = useState(false)
  const [colar, setColar] = useState(false)

  useEffect(() => {
    fetchCaixas()
      .then(cs => { setCaixas(cs); setCaixaId(c => c || cs[0]?.id || '') })
      .catch(e => setErro((e as Error).message))
  }, [])

  const carregar = () => {
    if (!caixaId) return
    setLoading(true)
    fetchMes(caixaId, `${mes}-01`, lastDayOfMonth(mes))
      .then(setD)
      .catch(e => setErro((e as Error).message))
      .finally(() => setLoading(false))
  }
  useEffect(carregar, [caixaId, mes])

  const caixa = caixas.find(c => c.id === caixaId)
  const b: Balanco | null = useMemo(
    () => (d ? balanco(d.recebido, d.saidas, d.envelopes, d.depositos) : null), [d])

  if (erro) {
    return (
      <div className="card p-6 text-sm">
        <h2 className="mb-2 font-semibold text-red-600">Não foi possível abrir a caixa</h2>
        <p className="text-slate-600">{erro}</p>
      </div>
    )
  }
  if (loading || !d || !b || !caixa) return <Loading />

  const certo = estaCerto(b)

  return (
    <div className="space-y-4">
      {/* --------------------------------------------------------- cabeçalho */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">Caixa</label>
          <select className="input w-auto" value={caixaId} onChange={e => setCaixaId(e.target.value)}>
            {caixas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Mês</label>
          <input type="month" className="input w-auto" value={mes}
                 onChange={e => setMes(e.target.value)} />
        </div>
        <p className="flex-1 text-xs text-slate-500">
          {caixa.fonte === 'pms'
            ? 'O recebido vem do relatório de pagamentos do Mews — arrasta-o para a caixa lá em baixo.'
            : 'Aqui o recebido escreve-se ao fecho do dia; não há relatório de onde o ir buscar.'}
        </p>
      </div>

      {/* ---------------------------------------------------------- balanço */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Recebido em dinheiro" value={money(b.recebido)}
                  hint={`${d.recebido.length} ${d.recebido.length === 1 ? 'registo' : 'registos'}`} />
        <StatCard label="Pago em faturas" value={money(b.saidas)}
                  hint={`${b.faturas} ${b.faturas === 1 ? 'fatura' : 'faturas'}`} />
        <StatCard label="Devia estar em caixa" value={money(b.esperado)}
                  hint="recebido menos as faturas" />
        <StatCard label="Contado nos envelopes" value={money(b.contado)}
                  hint={`${b.envelopes} ${b.envelopes === 1 ? 'envelope' : 'envelopes'}`} />
        <div className={`card p-4 ${certo ? 'border-[#0ca30c]/40 bg-[#0ca30c]/5'
                                          : 'border-[#d03b3b]/40 bg-[#d03b3b]/5'}`}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Diferença</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${
            certo ? 'text-[#0a7d0a]' : 'text-[#b32d2d]'}`}>
            {b.diferenca > 0 ? '+' : ''}{money(b.diferenca)}
          </div>
          <div className="mt-0.5 text-xs text-slate-600">
            {certo ? 'bate certo'
              : b.diferenca > 0 ? 'contámos a mais do que o esperado'
              : 'falta dinheiro ou faltam faturas por lançar'}
          </div>
        </div>
      </div>

      {!certo && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Faltam {money(Math.abs(b.diferenca))} para fechar.</strong>{' '}
          Antes de procurar dinheiro perdido, vale a pena confirmar o costume: um envelope
          ainda por abrir, uma fatura que veio no envelope e não foi lançada, ou troco que
          ficou para o turno seguinte e vai aparecer no mês que vem.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ----------------------------------------------------- envelopes */}
        <div className="card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Envelopes contados</h3>
            <button className="btn-primary text-sm" onClick={() => setNovoEnvelope(true)}>
              + Contar envelope
            </button>
          </div>

          <div className="mt-3 space-y-1.5">
            {d.envelopes.map(e => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                <span className="w-20 shrink-0 text-sm tabular-nums text-slate-500">{dmy(e.dia)}</span>
                <span className="min-w-[80px] flex-1 truncate text-sm text-slate-700">
                  {e.responsavel || '—'}
                  {e.nota && <span className="ml-1.5 text-[11px] text-slate-400">{e.nota}</span>}
                </span>
                {Object.keys(e.denominacoes).length > 0 && (
                  <span className="chip bg-slate-100 text-slate-500" title="contado nota a nota">
                    {Object.values(e.denominacoes).reduce((s, n) => s + (n || 0), 0)} peças
                  </span>
                )}
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">
                  {money(e.valor)}
                </span>
                <button className="shrink-0 rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={async () => {
                          if (!confirm(`Apagar o envelope de ${dmy(e.dia)}?`)) return
                          await apagar('cx_envelopes', e.id); carregar()
                        }}>✕</button>
              </div>
            ))}
            {d.envelopes.length === 0 && (
              <p className="py-3 text-sm text-slate-400">Nenhum envelope contado neste mês.</p>
            )}
          </div>

          <Depositos
            depositos={d.depositos} emCofre={b.emCofre}
            onJuntar={async dep => { await juntarDeposito(caixaId, dep); carregar() }}
            onApagar={async id => { await apagar('cx_depositos', id); carregar() }}
          />
        </div>

        {/* -------------------------------------------------------- saídas */}
        <div className="card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">
              Faturas pagas em dinheiro
            </h3>
            <button className="btn-ghost text-sm" onClick={() => setColar(true)}>
              Colar várias
            </button>
          </div>
          <p className="text-xs text-slate-400">
            O que saiu do envelope. Podes anexar a fatura — fica guardada com o nome
            «data – fornecedor – nº».
          </p>

          <div className="mt-3 max-h-[320px] space-y-1.5 overflow-y-auto">
            {d.saidas.map(s => (
              <LinhaSaida key={s.id} s={s} caixaId={caixaId}
                          onMudou={carregar}
                          onApagar={async () => {
                            if (!confirm(`Apagar a fatura de ${s.fornecedor ?? dmy(s.dia)}?`)) return
                            if (s.ficheiro) await apagarFicheiro(s.ficheiro)
                            await apagar('cx_saidas', s.id); carregar()
                          }} />
            ))}
            {d.saidas.length === 0 && (
              <p className="py-3 text-sm text-slate-400">Nenhuma fatura paga por caixa.</p>
            )}
          </div>

          <NovaSaida onJuntar={async s => {
            await juntarSaida(caixaId, { ...s, ficheiro: null }, email)
            carregar()
          }} />
        </div>
      </div>

      {/* ------------------------------------------------------- recebido */}
      <Recebimentos
        caixa={caixa} recebido={d.recebido} total={b.recebido}
        onImportado={carregar}
        onJuntarManual={async (dia, valor, nota) => {
          await juntarRecebidoManual(caixaId, dia, valor, nota); carregar()
        }}
        onApagar={async id => { await apagar('cx_recebido', id); carregar() }}
      />

      {novoEnvelope && (
        <ContarEnvelope
          onFechar={() => setNovoEnvelope(false)}
          onGravar={async e => {
            await juntarEnvelope(caixaId, e, email)
            setNovoEnvelope(false); carregar(); toast('Envelope registado')
          }}
        />
      )}

      {colar && (
        <ColarFaturas
          onFechar={() => setColar(false)}
          onGravar={async linhas => {
            for (const l of linhas) await juntarSaida(caixaId, { ...l, ficheiro: null }, email)
            setColar(false); carregar(); toast(`${linhas.length} faturas lançadas`)
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ saídas */

function LinhaSaida({
  s, caixaId, onMudou, onApagar,
}: {
  s: Saida
  caixaId: string
  onMudou: () => void
  onApagar: () => void
}) {
  const toast = useToast()
  const [aEnviar, setAEnviar] = useState(false)
  const ficheiro = useRef<HTMLInputElement>(null)

  const anexar = async (f: File) => {
    setAEnviar(true)
    try {
      const caminho = await guardarFicheiro(caixaId, s, f)
      await guardarSaida(s.id, { ficheiro: caminho })
      onMudou()
    } catch (e) { toast((e as Error).message, 'erro') }
    finally { setAEnviar(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
      <span className="w-20 shrink-0 text-sm tabular-nums text-slate-500">{dmy(s.dia)}</span>
      <div className="min-w-[120px] flex-1">
        <div className="truncate text-sm text-slate-700">{s.fornecedor || '—'}</div>
        <div className="truncate text-[11px] text-slate-400">
          {[s.descricao, s.documento].filter(Boolean).join(' · ') || 'sem descrição'}
        </div>
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">
        {money(s.valor)}
      </span>
      {s.ficheiro ? (
        <button
          className="shrink-0 text-xs text-brand-600 hover:underline"
          onClick={async () => {
            const url = await linkDaFatura(s.ficheiro!)
            if (url) window.open(url, '_blank'); else toast('Não consegui abrir a fatura', 'erro')
          }}
        >ver fatura</button>
      ) : (
        <>
          <button className="shrink-0 text-xs text-slate-500 hover:underline"
                  disabled={aEnviar}
                  onClick={() => ficheiro.current?.click()}>
            {aEnviar ? '…' : 'anexar'}
          </button>
          <input ref={ficheiro} type="file" className="hidden"
                 accept=".pdf,.jpg,.jpeg,.png,.heic"
                 onChange={e => { const f = e.target.files?.[0]; if (f) anexar(f) }} />
        </>
      )}
      <button className="shrink-0 rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              onClick={onApagar}>✕</button>
    </div>
  )
}

function NovaSaida({
  onJuntar,
}: {
  onJuntar: (s: Omit<Saida, 'id' | 'ficheiro'>) => Promise<void>
}) {
  const [s, setS] = useState({
    dia: todayISO(), fornecedor: '', descricao: '', documento: '', valor: 0,
  })
  return (
    <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-6">
      <div className="sm:col-span-2">
        <label className="label">Data</label>
        <input type="date" className="input h-9 text-sm" value={s.dia}
               onChange={e => setS({ ...s, dia: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Fornecedor</label>
        <input className="input h-9 text-sm" value={s.fornecedor}
               onChange={e => setS({ ...s, fornecedor: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Descrição</label>
        <input className="input h-9 text-sm" value={s.descricao}
               onChange={e => setS({ ...s, descricao: e.target.value })} />
      </div>
      <div className="sm:col-span-3">
        <label className="label">Nº do documento</label>
        <input className="input h-9 text-sm" value={s.documento}
               onChange={e => setS({ ...s, documento: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Valor</label>
        <NumInput className="h-9 text-sm" value={s.valor}
                  onChange={n => setS({ ...s, valor: n })} />
      </div>
      <div className="flex items-end">
        <button
          className="btn-primary h-9 w-full text-sm"
          disabled={s.valor <= 0}
          onClick={async () => {
            await onJuntar({
              dia: s.dia,
              fornecedor: s.fornecedor.trim() || null,
              descricao: s.descricao.trim() || null,
              documento: s.documento.trim() || null,
              valor: s.valor,
            })
            setS({ ...s, fornecedor: '', descricao: '', documento: '', valor: 0 })
          }}
        >Juntar</button>
      </div>
    </div>
  )
}

function ColarFaturas({
  onFechar, onGravar,
}: {
  onFechar: () => void
  onGravar: (l: Omit<Saida, 'id' | 'ficheiro'>[]) => Promise<void>
}) {
  const [texto, setTexto] = useState('')
  const linhas = useMemo(() => lerColagem(texto), [texto])
  const total = linhas.reduce((s, l) => s + l.valor, 0)

  return (
    <Modal open onClose={onFechar} title="Colar várias faturas" wide>
      <p className="text-sm text-slate-600">
        Cola aqui uma tabela — do Excel, ou a que te devolvo no chat depois de ler as
        faturas. Uma linha por fatura:
      </p>
      <p className="mt-1 rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
        data · fornecedor · descrição · nº documento · valor
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Se trouxeres a linha de cabeçalho, a ordem das colunas deixa de importar —
        podes colar as Saídas de Caixa tal como estão no Excel.
      </p>
      <textarea
        className="input mt-3 min-h-[180px] font-mono text-xs"
        placeholder={'15/08/2026\tAuchan Cedofeita\tMaterial manutenção\t1161032026080001/001\t7,69'}
        value={texto}
        onChange={e => setTexto(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-600">
          {linhas.length
            ? <><strong>{linhas.length} faturas</strong> reconhecidas · {money(total)}</>
            : 'ainda nada reconhecido'}
        </span>
        <button className="btn-primary ml-auto" disabled={!linhas.length}
                onClick={() => onGravar(linhas)}>
          Lançar {linhas.length || ''}
        </button>
      </div>
      {linhas.length > 0 && (
        <div className="mt-3 max-h-[200px] overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="td w-24 tabular-nums text-slate-500">{dmy(l.dia)}</td>
                  <td className="td">{l.fornecedor}</td>
                  <td className="td text-slate-400">{l.documento}</td>
                  <td className="td text-right tabular-nums">{money(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

/* --------------------------------------------------------------- envelopes */

function ContarEnvelope({
  onFechar, onGravar,
}: {
  onFechar: () => void
  onGravar: (e: Omit<Envelope, 'id'>) => Promise<void>
}) {
  const [dia, setDia] = useState(todayISO())
  const [responsavel, setResponsavel] = useState('')
  const [nota, setNota] = useState('')
  const [qtd, setQtd] = useState<Record<string, number>>({})
  const [aGravar, setAGravar] = useState(false)

  const total = somaDenominacoes(qtd)
  const pecas = Object.values(qtd).reduce((s, n) => s + (n || 0), 0)

  return (
    <Modal open onClose={onFechar} title="Contar envelope" wide>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Dia do fecho</label>
          <input type="date" className="input" value={dia} onChange={e => setDia(e.target.value)} />
        </div>
        <div>
          <label className="label">Quem fechou</label>
          <input className="input" value={responsavel}
                 onChange={e => setResponsavel(e.target.value)} />
        </div>
        <div>
          <label className="label">Nota</label>
          <input className="input" value={nota} onChange={e => setNota(e.target.value)}
                 placeholder="ex.: sem trocos, ficou para o turno seguinte" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {[DENOMINACOES.filter(ehNota), DENOMINACOES.filter(v => !ehNota(v))].map((grupo, g) => (
          <div key={g}>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {g === 0 ? 'Notas' : 'Moedas'}
            </h4>
            <div className="space-y-1">
              {grupo.map(v => {
                const n = qtd[String(v)] || 0
                return (
                  <div key={v} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-right text-sm tabular-nums text-slate-600">
                      {v >= 1 ? `${v} €` : `${(v * 100).toFixed(0)} c`}
                    </span>
                    <NumInput
                      className="h-8 w-20 text-sm"
                      value={n}
                      onChange={x => setQtd(q => ({ ...q, [String(v)]: Math.max(0, Math.round(x)) }))}
                    />
                    <span className={`text-sm tabular-nums ${n ? 'text-slate-700' : 'text-slate-300'}`}>
                      {money(v * n)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Total do envelope</div>
          <div className="text-2xl font-semibold tabular-nums text-brand-700">{money(total)}</div>
          <div className="text-xs text-slate-400">{pecas} notas e moedas</div>
        </div>
        <button
          className="btn-primary ml-auto"
          disabled={total <= 0 || aGravar}
          onClick={async () => {
            setAGravar(true)
            await onGravar({
              dia, responsavel: responsavel.trim() || null, valor: total,
              denominacoes: Object.fromEntries(
                Object.entries(qtd).filter(([, n]) => n > 0)),
              nota: nota.trim() || null,
            })
          }}
        >{aGravar ? 'A gravar…' : 'Gravar envelope'}</button>
      </div>
    </Modal>
  )
}

function Depositos({
  depositos, emCofre, onJuntar, onApagar,
}: {
  depositos: Deposito[]
  emCofre: number
  onJuntar: (d: Omit<Deposito, 'id'>) => Promise<void>
  onApagar: (id: string) => Promise<void>
}) {
  const [dia, setDia] = useState(todayISO())
  const [valor, setValor] = useState(0)
  const [ref, setRef] = useState('')

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Depósitos</h4>
        <span className="text-xs tabular-nums text-slate-500">
          por depositar: <strong className="text-slate-700">{money(emCofre)}</strong>
        </span>
      </div>

      <div className="mt-2 space-y-1">
        {depositos.map(d => (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <span className="w-20 shrink-0 tabular-nums text-slate-500">{dmy(d.dia)}</span>
            <span className="min-w-0 flex-1 truncate text-slate-500">{d.referencia || '—'}</span>
            <span className="tabular-nums text-slate-700">{money(d.valor)}</span>
            <button className="rounded px-1.5 text-slate-400 hover:text-red-600"
                    onClick={() => onApagar(d.id)}>✕</button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <input type="date" className="input h-9 w-auto text-sm" value={dia}
               onChange={e => setDia(e.target.value)} />
        <NumInput className="h-9 w-24 text-sm" value={valor} onChange={setValor} />
        <input className="input h-9 w-32 text-sm" placeholder="referência" value={ref}
               onChange={e => setRef(e.target.value)} />
        <button className="btn-ghost shrink-0" disabled={valor <= 0}
                onClick={async () => {
                  await onJuntar({ dia, valor, referencia: ref.trim() || null })
                  setValor(0); setRef('')
                }}>Depositar</button>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- recebido */

function Recebimentos({
  caixa, recebido, total, onImportado, onJuntarManual, onApagar,
}: {
  caixa: Caixa
  recebido: Recebido[]
  total: number
  onImportado: () => void
  onJuntarManual: (dia: string, valor: number, nota: string | null) => Promise<void>
  onApagar: (id: string) => Promise<void>
}) {
  const toast = useToast()
  const [aLer, setALer] = useState(false)
  const [sobre, setSobre] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [dia, setDia] = useState(todayISO())
  const [valor, setValor] = useState(0)
  const [nota, setNota] = useState('')
  const ficheiro = useRef<HTMLInputElement>(null)

  const porDia = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of recebido) m[r.dia] = (m[r.dia] ?? 0) + r.valor
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
  }, [recebido])

  const ler = async (f: File) => {
    setALer(true)
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true })
      const folha = wb.SheetNames.find(n => /cash/i.test(n)) ?? wb.SheetNames[0]
      const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[folha])
      const pms = lerRelatorioPms(linhas)
      if (!pms.length) {
        toast('Não encontrei pagamentos em dinheiro nesse ficheiro', 'erro')
        return
      }
      const { novas, repetidas } = await importarRecebido(caixa.id, pms)
      toast(repetidas
        ? `${novas} pagamentos novos · ${repetidas} já estavam`
        : `${novas} pagamentos importados`)
      onImportado()
    } catch (e) {
      toast((e as Error).message, 'erro')
    } finally { setALer(false) }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">
          Recebido em dinheiro · {money(total)}
        </h3>
        <button className="text-sm text-brand-700 hover:underline"
                onClick={() => setAberto(a => !a)}>
          {aberto ? 'esconder detalhe' : `ver os ${recebido.length} registos`}
        </button>
      </div>

      {caixa.fonte === 'pms' ? (
        <div
          onDragOver={e => { e.preventDefault(); setSobre(true) }}
          onDragLeave={() => setSobre(false)}
          onDrop={e => {
            e.preventDefault(); setSobre(false)
            const f = e.dataTransfer.files?.[0]; if (f) ler(f)
          }}
          onClick={() => ficheiro.current?.click()}
          className={`mt-3 cursor-pointer rounded-xl border-2 border-dashed p-6 text-center ${
            sobre ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50/60'}`}
        >
          {aLer ? (
            <span className="flex items-center justify-center gap-2 text-sm text-slate-600">
              <Spinner /> a ler o relatório…
            </span>
          ) : (
            <>
              <div className="text-sm font-medium text-slate-700">
                Arrasta para aqui o relatório de pagamentos do Mews
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                Leio a folha «Cash payments». Podes voltar a largar o mesmo ficheiro —
                os pagamentos que já cá estiverem não se repetem.
              </div>
            </>
          )}
          <input ref={ficheiro} type="file" className="hidden" accept=".xlsx,.xls"
                 onChange={e => { const f = e.target.files?.[0]; if (f) ler(f) }} />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="label">Dia</label>
            <input type="date" className="input h-9 w-auto text-sm" value={dia}
                   onChange={e => setDia(e.target.value)} />
          </div>
          <div>
            <label className="label">Dinheiro do dia</label>
            <NumInput className="h-9 w-28 text-sm" value={valor} onChange={setValor} />
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="label">Nota</label>
            <input className="input h-9 text-sm" value={nota}
                   onChange={e => setNota(e.target.value)} />
          </div>
          <button className="btn-primary shrink-0" disabled={valor <= 0}
                  onClick={async () => {
                    await onJuntarManual(dia, valor, nota.trim() || null)
                    setValor(0); setNota('')
                  }}>Juntar</button>
        </div>
      )}

      {porDia.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {porDia.map(([d, v]) => (
            <span key={d} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
              <span className="text-slate-500">{d.slice(8)}</span>{' '}
              <span className="tabular-nums text-slate-700">{money(v)}</span>
            </span>
          ))}
        </div>
      )}

      {aberto && (
        <div className="mt-3 max-h-[280px] overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="th">Quando</th>
                <th className="th">Cliente</th>
                <th className="th">Quem recebeu</th>
                <th className="th">Conta</th>
                <th className="th text-right">Valor</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {recebido.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="td whitespace-nowrap tabular-nums text-slate-500">
                    {dmy(r.dia)}{r.momento && ` ${r.momento.slice(11, 16)}`}
                  </td>
                  <td className="td">{r.cliente || '—'}</td>
                  <td className="td text-slate-500">{r.criador || '—'}</td>
                  <td className="td text-slate-400">{r.documento || '—'}</td>
                  <td className="td text-right tabular-nums">{money(r.valor)}</td>
                  <td className="td text-right">
                    <button className="text-slate-400 hover:text-red-600"
                            onClick={() => onApagar(r.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        Uma diferença até {money(TOLERANCIA)} conta como troco e não levanta bandeira.
      </p>
    </div>
  )
}
