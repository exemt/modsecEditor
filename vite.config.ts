import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages отдаёт проект из подкаталога /modsecEditor/, dev-сервер — из корня.
  base: command === 'build' ? '/modsecEditor/' : '/',
}))
