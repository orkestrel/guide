import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUIDE_ROOT, runNativeGuide } from './setupServer.js'

// Proves the server setup helpers the server project relies on: the workspace root and the
// isolated native carrier. A carrier source that exits before the command runs reads the
// child's own process facts, so no assertion repeats GuideCommand's behavior.

describe('GUIDE_ROOT', () => {
	it('names the directory that holds the guide package manifest', () => {
		const manifest: unknown = JSON.parse(readFileSync(join(GUIDE_ROOT, 'package.json'), 'utf8'))
		expect(manifest).toMatchObject({ name: '@orkestrel/guide' })
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

	it('removes its carrier file after the child fails', () => {
		const result = runNativeGuide(`throw new Error('carrier source failed')\n`)
		expect(result.status).toBe(1)
		expect(result.stderr).toContain('carrier source failed')
		expect(
			readdirSync(join(GUIDE_ROOT, 'tests')).filter((name) => name.startsWith('.guide-command-')),
		).toEqual([])
	})
})
