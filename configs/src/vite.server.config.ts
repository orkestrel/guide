import { defineConfig } from 'vite'
import { srcServer, resolveWorkspacePath } from '../../vite.config'

export default defineConfig(
	srcServer({
		build: {
			lib: {
				entry: resolveWorkspacePath('src/server/index.ts'),
				formats: ['es'],
				fileName: () => 'index.js',
			},
			outDir: 'dist/src/server',
			rollupOptions: {
				external: [/^node:/, /^@orkestrel\//],
			},
		},
	}),
)
