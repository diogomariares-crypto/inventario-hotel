import { createClient } from '@supabase/supabase-js'

// A chave "anon"/publishable é pública por definição — o que protege os dados
// é o Row Level Security definido na base de dados, não o segredo desta chave.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://vaicrwwjjjrurylkjvyf.supabase.co'
const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'sb_publishable_5ewHvyT1o6uGq7DlobE6fA_XIFOL7YB'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})
