import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BUCKET_FEEDBACK, type FeedbackImage } from '../lib/turno'
import { useToast } from '../components/ui'

/**
 * Ferramenta de uso único: copia as imagens de feedback que ficaram no
 * armazenamento da app antiga para o Supabase próprio.
 *
 * Corre no browser porque só o browser alcança os dois lados. Pode ser
 * executada várias vezes — o que já foi copiado é ignorado.
 */
const ORIGEM = 'https://palvdmxlkjiqwxytbjpi.supabase.co/storage/v1/object/public/feedback-images'

export default function MigrarImagens() {
  const toast = useToast()
  const [imagens, setImagens] = useState<FeedbackImage[] | null>(null)
  const [existentes, setExistentes] = useState<Set<string>>(new Set())
  const [aCorrer, setACorrer] = useState(false)
  const [feito, setFeito] = useState(0)
  const [falhas, setFalhas] = useState<string[]>([])

  const carregar = async () => {
    const { data } = await supabase.from('feedback_images').select('*').order('report_date')
    const linhas = (data ?? []) as FeedbackImage[]
    setImagens(linhas)

    // que caminhos já existem no bucket novo
    const pastas = [...new Set(linhas.map(i => i.storage_path.split('/').slice(0, 2).join('/')))]
    const achados = new Set<string>()
    for (const pasta of pastas) {
      const { data: lista } = await supabase.storage.from(BUCKET_FEEDBACK).list(pasta, { limit: 1000 })
      for (const f of lista ?? []) achados.add(`${pasta}/${f.name}`)
    }
    setExistentes(achados)
  }
  useEffect(() => { carregar() }, [])

  const migrar = async () => {
    if (!imagens) return
    setACorrer(true); setFeito(0); setFalhas([])
    const erros: string[] = []
    let n = 0
    for (const img of imagens) {
      if (existentes.has(img.storage_path)) { n++; setFeito(n); continue }
      try {
        const r = await fetch(`${ORIGEM}/${img.storage_path}`)
        if (!r.ok) throw new Error(`origem respondeu ${r.status}`)
        const blob = await r.blob()
        const { error } = await supabase.storage.from(BUCKET_FEEDBACK)
          .upload(img.storage_path, blob, { contentType: blob.type || 'image/png', upsert: true })
        if (error) throw new Error(error.message)
      } catch (e) {
        erros.push(`${img.storage_path}: ${(e as Error).message}`)
      }
      n++; setFeito(n)
    }
    setFalhas(erros)
    setACorrer(false)
    await carregar()
    toast(erros.length ? `Terminado com ${erros.length} falhas` : 'Imagens migradas', erros.length ? 'erro' : 'ok')
  }

  const porCopiar = imagens?.filter(i => !existentes.has(i.storage_path)).length ?? 0

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Migrar imagens da app antiga</h1>
        <p className="text-sm text-slate-500">
          Copia as imagens de feedback que ainda estão no armazenamento do Lovable para o teu Supabase.
        </p>
      </div>

      {imagens === null ? (
        <p className="text-sm text-slate-500">A verificar…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3">
              <div className="text-xs text-slate-500">Imagens registadas</div>
              <div className="text-lg font-semibold tabular-nums">{imagens.length}</div>
            </div>
            <div className="card p-3">
              <div className="text-xs text-slate-500">Já copiadas</div>
              <div className="text-lg font-semibold tabular-nums">{imagens.length - porCopiar}</div>
            </div>
            <div className={`card p-3 ${porCopiar ? 'border-amber-200 bg-amber-50' : ''}`}>
              <div className="text-xs text-slate-500">Por copiar</div>
              <div className="text-lg font-semibold tabular-nums">{porCopiar}</div>
            </div>
          </div>

          <button className="btn-primary" onClick={migrar} disabled={aCorrer || porCopiar === 0}>
            {aCorrer ? `A copiar… ${feito}/${imagens.length}` : porCopiar ? 'Copiar imagens' : 'Nada por copiar'}
          </button>

          {aCorrer && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-brand-500 transition-all"
                   style={{ width: `${(feito / imagens.length) * 100}%` }} />
            </div>
          )}

          {falhas.length > 0 && (
            <div className="card max-h-64 overflow-y-auto p-4">
              <h2 className="mb-2 text-sm font-semibold text-red-600">
                {falhas.length} imagens não copiadas
              </h2>
              <pre className="whitespace-pre-wrap text-xs text-slate-600">{falhas.join('\n')}</pre>
            </div>
          )}

          <p className="text-xs text-slate-400">
            Podes correr isto as vezes que quiseres — o que já está copiado é ignorado. Quando
            estiver tudo a zero, avisa-me para eu voltar a fechar o armazenamento antigo.
          </p>
        </>
      )}
    </div>
  )
}
