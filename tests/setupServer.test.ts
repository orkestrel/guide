import { createScratch } from '@orkestrel/test/server'
import { readdirSync, readFileSync, utimesSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GUIDE_ROOT, readGuideBuild, runNativeGuide } from './setupServer.js'

// Proves the server setup helpers the server project relies on: the workspace root and the
// isolated native carrier. A carrier source that exits before the command runs reads the
// child's own process facts, so no assertion repeats GuideCommand's behavior.

describe('GUIDE_ROOT', () => {
	it('names the directory that holds the guide package manifest', () => {
		const manifest: unknown = JSON.parse(readFileSync(join(GUIDE_ROOT, 'package.json'), 'utf8'))
		expect(manifest).toMatchObject({ name: '@orkestrel/guide' })
	})
})

describe('readGuideBuild', () => {
	it('returns the built server entry when the build is newer than every source', () => {
		const scratch = createScratch({
			files: {
				'src/core/index.ts': '',
				'src/server/index.ts': '',
				'dist/src/core/index.js': '',
				'dist/src/server/index.js': '',
			},
		})
		try {
			for (const path of ['src/core/index.ts', 'src/server/index.ts']) {
				utimesSync(join(scratch.path, path), new Date('2026-10-01'), new Date('2026-10-01'))
			}
			for (const path of ['dist/src/core/index.js', 'dist/src/server/index.js']) {
				utimesSync(join(scratch.path, path), new Date('2026-10-02'), new Date('2026-10-02'))
			}
			expect(readGuideBuild(scratch.path)).toBe(
				pathToFileURL(join(scratch.path, 'dist', 'src', 'server', 'index.js')).href,
			)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a build older than a source it was built from, naming the source and the rebuild', () => {
		const scratch = createScratch({
			files: {
				'src/core/index.ts': '',
				'src/server/index.ts': '',
				'dist/src/core/index.js': '',
				'dist/src/server/index.js': '',
			},
		})
		try {
			utimesSync(
				join(scratch.path, 'src/core/index.ts'),
				new Date('2026-10-01'),
				new Date('2026-10-01'),
			)
			utimesSync(
				join(scratch.path, 'dist/src/core/index.js'),
				new Date('2026-10-02'),
				new Date('2026-10-02'),
			)
			utimesSync(
				join(scratch.path, 'src/server/index.ts'),
				new Date('2026-10-03'),
				new Date('2026-10-03'),
			)
			utimesSync(
				join(scratch.path, 'dist/src/server/index.js'),
				new Date('2026-10-04'),
				new Date('2026-10-04'),
			)
			expect(() => readGuideBuild(scratch.path)).toThrow(
				'The build under dist/src is older than src/server/index.ts; run npm run build before the native-command cases.',
			)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a workspace with no built server entry, naming the rebuild', () => {
		const scratch = createScratch({ files: { 'src/core/index.ts': '' } })
		try {
			expect(() => readGuideBuild(scratch.path)).toThrow(
				'dist/src/server/index.js is absent; run npm run build before the native-command cases.',
			)
		} finally {
			scratch.destroy()
		}
	})
})

describe('runNativeGuide', () => {
	it('runs the inserted source in a child process at the root without the Vitest marker', () => {
		const result = runNativeGuide(`
process.stdout.write(JSON.stringify({ cwd: process.cwd(), vitest: process.env.VITEST ?? null }) + '\\n')
process.exit(7)
`)
		expect(result.error).toBeUndefined()
		expect(result.status).toBe(7)
		const reading: unknown = JSON.parse(result.stdout.trim())
		expect(reading).toEqual({ cwd: resolve(GUIDE_ROOT), vitest: null })
	})

	it('passes the root, module map, and arguments it is given to the child', () => {
		const result = runNativeGuide(
			`
process.stdout.write(JSON.stringify({ root, modules, args: process.argv.slice(2) }) + '\\n')
process.exit(7)
`,
			{ root: GUIDE_ROOT, modules: { '@scope/widget': 'src/core' }, args: ['--to', 'guide'] },
		)
		expect(result.error).toBeUndefined()
		expect(result.status).toBe(7)
		const reading: unknown = JSON.parse(result.stdout.trim())
		expect(reading).toEqual({
			root: GUIDE_ROOT,
			modules: { '@scope/widget': 'src/core' },
			args: ['--to', 'guide'],
		})
	})

	it('removes its carrier file after the child fails', () => {
		const result = runNativeGuide(`throw new Error('carrier source failed')\n`)
		expect(result.status).toBe(1)
		expect(result.stderr).toContain('carrier source failed')
		expect(
			readdirSync(join(GUIDE_ROOT, 'tests')).filter((name) => name.startsWith('.guide-command-')),
		).toEqual([])
	})
})
