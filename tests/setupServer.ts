import type { SpawnSyncReturns } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Holds the canonical Guide workspace root. */
export const GUIDE_ROOT = fileURLToPath(new URL('../', import.meta.url))

/**
 * Runs a native Guide command carrier in an isolated process under the package's public scope.
 *
 * @param source - The real runner setup to insert into the shared carrier
 * @returns The completed native process result
 */
export function runNativeGuide(source: string): SpawnSyncReturns<string> {
	const entry = resolve(GUIDE_ROOT, 'tests', `.guide-command-${randomUUID()}.ts`)
	writeFileSync(
		entry,
		`import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

const events = []
${source}
const command = new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md'],
	modules: { '@orkestrel/guide': ['src/core', 'src/server'] },
	languages: ['ts'],
	language: 'ts',
	reader: readInventory,
	runner,
})
await command.execute(async () => {})
process.stdout.write(JSON.stringify({ events, exitCode: process.exitCode ?? 0 }) + '\\n')
`,
	)
	try {
		return spawnSync(process.execPath, ['--experimental-strip-types', entry], {
			cwd: GUIDE_ROOT,
			encoding: 'utf8',
			env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'VITEST')),
			timeout: 30_000,
			windowsHide: true,
		})
	} finally {
		unlinkSync(entry)
	}
}
