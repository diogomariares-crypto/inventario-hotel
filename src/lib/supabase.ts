import { createClient } from '@supabase/supabase-js'

// A chave "anon"/publishable é pública por definição — o que protege os dados
// é o Row Level Security definido na base de dados, não o segredo desta chave.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://vaicrwwjjjrurylkjvyf.supabase.co'
const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'sb_publishable_5ewHvyT1o6uGq7DlobE6fA_XIFOL7YB'

export const supabase = createClient(url, key, {
  // detectSessionInUrl fica desligado de propósito: ver a nota abaixo.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

/*
 * Links de recuperação e de convite voltam com os tokens no fragmento:
 *   .../operacoes/#access_token=...&refresh_token=...&type=recovery
 * Só que a app usa HashRouter, que trata o fragmento como se fosse a rota.
 * Ao arrancar, o router não reconhece "#access_token=..." e reescreve o hash
 * para "#/", deitando os tokens fora antes de alguém os ler — o link parecia
 * funcionar e a pessoa caía outra vez no ecrã de entrada.
 *
 * Por isso lemos o fragmento aqui, de forma síncrona, no momento em que este
 * módulo é importado — antes de o React montar seja o que for — e só depois
 * devolvemos o hash a uma rota normal.
 */
const bruto = window.location.hash.startsWith('#/') ? '' : window.location.hash.slice(1)
const parametros = new URLSearchParams(bruto)
const accessToken = parametros.get('access_token')
const refreshToken = parametros.get('refresh_token')

/** Mensagem do Supabase quando o link expirou ou já tinha sido usado. */
export const erroDoLink = parametros.get('error_description')

if (accessToken || erroDoLink) {
  const destino = parametros.get('type') === 'recovery' ? '#/conta' : '#/'
  history.replaceState(null, '', window.location.pathname + window.location.search + destino)
}

/** Resolve quando a sessão vinda do link já está instalada (ou logo, se não havia). */
export const sessaoDoLink: Promise<void> =
  accessToken && refreshToken
    ? supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(() => undefined)
    : Promise.resolve()
