import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Plugin for live graph generation during development
 * Intercepts /api/graph.json requests and generates graph from live files
 */
function liveGraphPlugin(): Plugin {
  return {
    name: 'live-graph',
    apply: 'serve',
    async configResolved() {
      // Dynamic import to avoid issues
    },
    async resolveId(id) {
      if (id === 'virtual:live-graph') {
        return id
      }
    },
    async load(id) {
      if (id === 'virtual:live-graph') {
        return 'export const liveGraph = true'
      }
    },
    configureServer(server) {
      return () => {
        server.middlewares.use('/api/graph.json', async (req, res) => {
          try {
            const { CodeTreeBuilder } = await import('./scripts/CodeTreeBuilder.js')
            const srcDir = path.join(__dirname, 'src')
            const builder = new CodeTreeBuilder(srcDir)
            const graph = builder.build()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(graph))
          } catch (error) {
            console.error('Error generating graph:', error)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ 
              error: 'Failed to generate graph',
              message: error instanceof Error ? error.message : String(error)
            }))
          }
        })
      }
    }
  }
}

export default defineConfig({
  base: '/unitcircle/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    open: true,
  },
  plugins: [liveGraphPlugin()],
})
