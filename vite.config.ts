import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base '/inventario-hotel/' porque o site é servido em
// https://<utilizador>.github.io/inventario-hotel/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/inventario-hotel/',
  plugins: [react(), tailwindcss()],
})
