/**
 * Escolhas que não se perdem ao mudar de página.
 *
 * O mês que se está a ver, o departamento em que se está a trabalhar, o filtro
 * que se escolheu — nada disto é informação da operação, mas perder-se de cada
 * vez que se muda de separador dá um trabalho enorme a quem está a lançar um
 * mês inteiro.
 *
 * Fica em sessionStorage e não em localStorage de propósito: aguenta mudar de
 * página e recarregar, mas quando se fecha o separador do browser a app volta
 * ao mês corrente. Guardar para sempre daria o efeito contrário — abrir a app
 * em Outubro e estar em Setembro sem se perceber porquê.
 *
 * Páginas do mesmo módulo partilham a chave: passar do Mês para o Mapa mantém
 * o mês, porque é o mesmo mês que se está a olhar.
 */
import { useCallback, useState } from 'react'

const PREFIXO = 'cb.'

function ler<T>(chave: string): T | undefined {
  try {
    const guardado = sessionStorage.getItem(PREFIXO + chave)
    return guardado == null ? undefined : (JSON.parse(guardado) as T)
  } catch {
    // browser em modo privado, armazenamento cheio ou desligado: segue sem memória
    return undefined
  }
}

function escrever(chave: string, valor: unknown) {
  try { sessionStorage.setItem(PREFIXO + chave, JSON.stringify(valor)) } catch { /* paciência */ }
}

/**
 * Como o `useState`, mas lembrado. `valido` serve para recusar um valor
 * guardado que já não faz sentido — um hotel que saiu da lista, por exemplo.
 */
export function useLembrado<T>(
  chave: string,
  inicial: T | (() => T),
  valido?: (v: T) => boolean,
) {
  const [v, setV] = useState<T>(() => {
    const guardado = ler<T>(chave)
    if (guardado !== undefined && (!valido || valido(guardado))) return guardado
    return typeof inicial === 'function' ? (inicial as () => T)() : inicial
  })

  const definir = useCallback((novo: T | ((anterior: T) => T)) => {
    setV(anterior => {
      const x = typeof novo === 'function' ? (novo as (a: T) => T)(anterior) : novo
      escrever(chave, x)
      return x
    })
  }, [chave])

  return [v, definir] as const
}

/** O mês corrente em "2026-09", que é o arranque de quase todos os ecrãs. */
export const mesCorrente = () => new Date().toISOString().slice(0, 7)

/** Um mês só é aceitável se tiver mesmo a forma de um mês. */
export const ehMes = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
