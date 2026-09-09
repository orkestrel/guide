import type {
	GuideCommandContext,
	GuideCommandHandler,
	GuideCommandInterface,
	GuideCommandOptions,
	GuideReadFunction,
	GuideRunnerFunction,
} from './types.js'
import type { GuideModule, ParityFinding, ParityOptions } from '../core/types.js'
import { isFunction, isObject } from '@orkestrel/contract'
import { globSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { Parity } from '../core/Parity.js'
import { parseManifest } from '../core/parsers.js'
import { GUIDE_INDEX, GUIDE_MANIFEST, GUIDE_README, GUIDE_USAGE } from './constants.js'
import {
	formatGuideFinding,
	matchesGuideResult,
	resolveGuideRoot,
	selectGuidePitch,
} from './helpers.js'
import { parseGuideDirection, parsePackageName } from './parsers.js'

/**
 * Drives native checking and explicit rewrites or registers package assertions in the guides
 * worker.
 *
 * @param options - The workspace policy and direct host ports
 *
 * @example
 * ```ts
 * import { GuideCommand } from '@orkestrel/guide/server'
 * import { readInventory } from '@orkestrel/test/server'
 * import { createVitest } from 'vitest/node'
 *
 * await new GuideCommand({
 * 	root: new URL('../', import.meta.url),
 * 	patterns: ['src/**\/*.ts', 'tests/**\/*.ts', 'guides/*.md', '*.md'],
 * 	modules: { '@scope/widget': 'src/core' },
 * 	languages: ['ts'],
 * 	language: 'ts',
 * 	reader: readInventory,
 * 	runner: createVitest,
 * }).execute(async ({ files, report, root, rows }) => {
 * 	const { expect, it } = await import('vitest')
 * 	it('checks the documented inventory', () => {
 * 		expect(root.length).toBeGreaterThan(0)
 * 		expect(Object.keys(files).length).toBeGreaterThan(0)
 * 		expect(rows.length).toBeGreaterThan(0)
 * 		expect(report.input).toEqual([])
 * 	})
 * })
 * ```
 */
export class GuideCommand implements GuideCommandInterface {
	readonly #root: string
	readonly #patterns: readonly string[]
	readonly #modules: Readonly<Record<string, GuideModule>>
	readonly #languages: readonly string[]
	readonly #language: string
	readonly #reader: GuideReadFunction
	readonly #runner: GuideRunnerFunction

	constructor(options: GuideCommandOptions) {
		this.#root = resolveGuideRoot(options.root)
		this.#patterns = Object.freeze([...options.patterns])
		this.#modules = Object.freeze({ ...options.modules })
		this.#languages = Object.freeze([...options.languages])
		this.#language = options.language
		this.#reader = options.reader
		this.#runner = options.runner
	}

	/**
	 * Runs the native command or registers package assertions with fresh worker inventory and parity.
	 *
	 * @param register - The package-owned assertion registration callback
	 * @returns A promise that resolves after the selected command path finishes
	 * @throws When worker inventory reading or package assertion registration fails. Native failures
	 * are reported through stderr and process exit status before this promise resolves.
	 */
	async execute(register: GuideCommandHandler): Promise<void> {
		if (process.env.VITEST === 'true') {
			await this.#register(register)
			return
		}
		try {
			await this.#executeNative()
		} catch (error) {
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
			this.#raise(1)
		}
	}

	#createOptions(): ParityOptions | undefined {
		const files = this.#readInventory()
		const manifest = files[GUIDE_INDEX]
		if (manifest === undefined) return undefined
		const entries = Object.freeze([...parseManifest(manifest, 'guides')])
		const packageFiles = Object.freeze({ ...this.#reader(this.#root, [GUIDE_MANIFEST]) })
		const packageManifest = packageFiles[GUIDE_MANIFEST]
		const pitch = selectGuidePitch(
			entries,
			packageManifest === undefined ? undefined : parsePackageName(packageManifest),
		)
		return {
			files,
			entries,
			modules: this.#modules,
			languages: this.#languages,
			language: this.#language,
			...(pitch === undefined
				? {}
				: { pitch: Object.freeze({ readme: GUIDE_README, spec: pitch }) }),
		}
	}

	async #executeNative(): Promise<void> {
		const args = process.argv.slice(2)
		const direction = parseGuideDirection(args)
		if (direction === undefined && args.length > 0) {
			process.stdout.write(`${GUIDE_USAGE}\n`)
			this.#raise(2)
			return
		}
		if (direction === undefined) {
			if (!(await this.#executeRunner())) this.#raise(1)
			return
		}

		const options = this.#createOptions()
		if (options === undefined) {
			this.#reportMissing()
			return
		}
		const parity = new Parity(options)
		if (this.#report(parity.inspect().input)) {
			this.#raise(2)
			return
		}
		const rewritten = direction === 'guide' ? parity.document() : parity.annotate()
		for (const change of rewritten.changes) {
			writeFileSync(resolve(this.#root, change.path), change.content)
			process.stdout.write(`wrote ${change.path}\n`)
		}

		const freshOptions = this.#createOptions()
		if (freshOptions === undefined) {
			this.#reportMissing()
			return
		}
		const freshParity = new Parity(freshOptions)
		const freshReport = freshParity.inspect()
		if (this.#report(freshReport.input)) {
			this.#raise(2)
			return
		}
		const remaining =
			direction === 'guide' ? freshParity.document().findings : freshParity.annotate().findings
		if (this.#report(remaining)) this.#raise(1)
		if (this.#report(freshReport.pitch)) this.#raise(1)
		if (rewritten.changes.length > 0) process.stdout.write('next: npm run format\n')
		if (!(await this.#executeRunner())) this.#raise(1)
	}

	#readInventory(): Readonly<Record<string, string>> {
		const targets = globSync([...this.#patterns], { cwd: this.#root }).map((path) =>
			path.replaceAll('\\', '/'),
		)
		return Object.freeze({ ...this.#reader(this.#root, targets) })
	}

	async #register(register: GuideCommandHandler): Promise<void> {
		const options = this.#createOptions()
		if (options === undefined) {
			throw new Error('The inventory carries no guides/README.md to index from')
		}
		const parity = new Parity(options)
		const context: GuideCommandContext = Object.freeze({
			root: this.#root,
			files: options.files,
			rows: parity.rows(),
			report: parity.inspect(),
		})
		await register(context)
	}

	#report(findings: readonly ParityFinding[]): boolean {
		for (const finding of findings) {
			process.stdout.write(`${formatGuideFinding(finding)}\n`)
		}
		return findings.length > 0
	}

	#reportMissing(): void {
		process.stdout.write(`${GUIDE_INDEX}: the workspace carries no concept index to read\n`)
		this.#raise(2)
	}

	async #executeRunner(): Promise<boolean> {
		const runner = await this.#runner('test', {
			root: this.#root,
			config: resolve(this.#root, 'vite.config.ts'),
			project: 'guides',
			reporters: 'dot',
			cache: false,
			watch: false,
		})
		if (!isObject(runner)) throw new Error('The guides runner is not an object')
		const close = Reflect.get(runner, 'close')
		if (!isFunction(close)) throw new Error('The guides runner has no callable close member')
		try {
			const start = Reflect.get(runner, 'start')
			if (!isFunction(start)) throw new Error('The guides runner has no callable start member')
			return matchesGuideResult(await Reflect.apply(start, runner, []))
		} finally {
			await Reflect.apply(close, runner, [])
		}
	}

	#raise(code: number): void {
		const current = process.exitCode
		const numeric = typeof current === 'string' ? Number.parseInt(current, 10) : current
		if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < code) {
			process.exitCode = code
		}
	}
}
