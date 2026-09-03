import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// O site é servido em https://<utilizador>.github.io/operacoes/, por isso os
// ficheiros são procurados a partir de '/operacoes/' e não da raiz.
//
// No GitHub Pages quem manda é a variável VITE_BASE, que o workflow calcula do
// nome do repositório — se ele voltar a mudar de nome, a publicação acompanha
// sozinha. Este valor aqui só serve para compilar fora do GitHub.
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  base: process.env.VITE_BASE ?? '/operacoes/',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
