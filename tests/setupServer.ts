import type { SpawnSyncReturns } from 'node:child_process'
import { parseSync } from 'vite'
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

export class ChangingResult {
	#reads = 0

	get testModules(): ReadonlyArray<{ readonly state: () => string }> {
		this.#reads += 1
		return this.#reads === 1 ? [new ResultModule('failed')] : []
	}

	get unhandledErrors(): readonly unknown[] {
		return []
	}

	get reads(): number {
		return this.#reads
	}
}

export function readParsedSummaries(source: string): ReadonlyMap<string, string> {
	const parsed = parseSync('control.ts', source)
	const summaries = new Map<string, string>()

	for (const statement of parsed.program.body) {
		if (statement.type !== 'ExportNamedDeclaration') continue
		const declaration = statement.declaration
		if (declaration === null || declaration === undefined) continue

		const names =
			declaration.type === 'VariableDeclaration'
				? declaration.declarations.map((entry) =>
						entry.id.type === 'Identifier' ? entry.id.name : '',
					)
				: declaration.type === 'FunctionDeclaration' ||
					  declaration.type === 'TSDeclareFunction' ||
					  declaration.type === 'ClassDeclaration' ||
					  declaration.type === 'TSInterfaceDeclaration' ||
					  declaration.type === 'TSTypeAliasDeclaration'
					? [declaration.id?.name ?? '']
					: []

		const preceding = parsed.comments.filter(
			(comment) =>
				comment.type === 'Block' &&
				comment.value.startsWith('*') &&
				comment.end <= statement.start &&
				source.slice(comment.end, statement.start).trim() === '',
		)
		const attached = preceding[preceding.length - 1]
		if (attached === undefined) continue

		// The control's own unwrapping, deliberately independent of the reader's.
		const body = attached.value
			.replace(/^\*/, '')
			.split('\n')
			.map((line) => line.replace(/^\s*\*\s?/, ''))
			.join('\n')
		const tag = body.search(/(?:^|\n)@\w/)
		const description = (tag < 0 ? body : body.slice(0, tag)).replace(/\s+/g, ' ').trim()

		// An overload set declares one name several times; the first declaration
		// answers for it, which is the reader's rule too.
		for (const name of names) {
			if (name.length === 0 || summaries.has(name)) continue
			if (description.length > 0) summaries.set(name, description)
		}
	}

	return summaries
}

export class ResultModule {
	readonly extra = 'retained'
	readonly #status: string

	constructor(status: string) {
		this.#status = status
	}

	state(): string {
		return this.#status
	}
}
