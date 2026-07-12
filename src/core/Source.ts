import type { GuideModule, SourceInterface, SourceOptions, SurfaceSymbol } from './types.js'
import { moduleKeys, symbolKey } from './helpers.js'
import {
	declarationBody,
	exampleMethods,
	examplesFrom,
	exportsFrom,
	hiddenFrom,
	memberMethods,
} from './parsers.js'

/**
 * A pure `SourceInterface` — reflects a module scope's exports and member
 * methods over a consumer-supplied file inventory (AGENTS §22, `PROPOSAL.md`
 * §7), using text-only line scanners rather than the TypeScript compiler API
 * or the filesystem. `Source` never touches disk: the consumer gathers the
 * inventory however their environment allows (`node:fs` in a Node script,
 * `import.meta.glob` in a browser/vitest run) and passes it in as `files`.
 *
 * @example
 * ```ts
 * import { Source } from '@orkestrel/guide'
 *
 * const source = new Source({
 * 	files: {
 * 		'src/core/Guide.ts': 'export class Guide {}\n',
 * 		'src/core/types.ts': 'export interface GuideInterface {\n\tsections(): void\n}\n',
 * 	},
 * 	module: 'src/core',
 * })
 * source.exports() // [{ name: 'Guide', kind: 'class' }, { name: 'GuideInterface', kind: 'interface' }]
 * source.methods('GuideInterface') // ['sections']
 * source.exists('src/core/Guide.ts') // true
 * ```
 */
export class Source implements SourceInterface {
	readonly #files: Readonly<Record<string, string>>
	readonly #module: GuideModule
	#exports: readonly SurfaceSymbol[] | undefined
	#hidden: readonly SurfaceSymbol[] | undefined
	#examples: readonly string[] | undefined

	constructor(options: SourceOptions) {
		this.#files = options.files
		this.#module = options.module
	}

	// The module's exports are computed once on first access and cached —
	// every subsequent call reuses the same scan of an immutable inventory.
	exports(): readonly SurfaceSymbol[] {
		if (this.#exports === undefined) this.#exports = this.#scanSymbols(exportsFrom)
		return this.#exports
	}

	methods(name: string): readonly string[] {
		const interfaceBody = this.#declarationBody('interface', name)
		if (interfaceBody.length > 0) return memberMethods(interfaceBody)

		const classBody = this.#declarationBody('class', name)
		return memberMethods(classBody).filter((method) => method !== 'constructor')
	}

	exists(relative: string): boolean {
		const keys = Object.keys(this.#files)
		return keys.some((key) => key === relative || key.startsWith(`${relative}/`))
	}

	// The module's hidden declarations are computed once on first access and
	// cached — mirrors `exports()`'s caching.
	hidden(): readonly SurfaceSymbol[] {
		if (this.#hidden === undefined) this.#hidden = this.#scanSymbols(hiddenFrom)
		return this.#hidden
	}

	examples(): readonly string[]
	examples(name: string): readonly string[]
	examples(name?: string): readonly string[] {
		if (name === undefined) {
			if (this.#examples === undefined) this.#examples = this.#scanExamples()
			return this.#examples
		}

		return this.#exampleMembers(name)
	}

	// The union of exported-function `@example` names across the module's
	// files, deduped in first-seen order — mirrors `#scanSymbols`, but over a
	// plain string scanner (`examplesFrom`) rather than a `SurfaceSymbol` one.
	#scanExamples(): readonly string[] {
		const names: string[] = []
		const seen = new Set<string>()

		for (const key of moduleKeys(this.#files, this.#module)) {
			const text = this.#files[key]
			if (text === undefined) continue

			for (const name of examplesFrom(text)) {
				if (seen.has(name)) continue
				seen.add(name)
				names.push(name)
			}
		}

		return names
	}

	// The `@example`-carrying members of the interface-or-class declaration
	// body named `name`, unioning both shapes (an implementer may carry its
	// own `@example` a documented interface member does not, or vice versa).
	#exampleMembers(name: string): readonly string[] {
		const interfaceBody = this.#declarationBody('interface', name)
		const classBody = this.#declarationBody('class', name)
		const members = new Set<string>([
			...exampleMethods(interfaceBody),
			...exampleMethods(classBody),
		])
		return Array.from(members).sort()
	}

	// The pure union-and-dedupe-and-sort composition behind `exports()` and
	// `hidden()` — kept as a private method because it orchestrates a scanner
	// across every file of the module scope rather than being a self-contained
	// leaf.
	#scanSymbols(scan: (source: string) => readonly SurfaceSymbol[]): readonly SurfaceSymbol[] {
		const symbols: SurfaceSymbol[] = []
		const seen = new Set<string>()

		for (const key of moduleKeys(this.#files, this.#module)) {
			const text = this.#files[key]
			if (text === undefined) continue

			for (const symbol of scan(text)) {
				const identity = symbolKey(symbol)
				if (seen.has(identity)) continue
				seen.add(identity)
				symbols.push(symbol)
			}
		}

		return symbols.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1))
	}

	// The first non-empty declaration body found across the module scope's
	// files, searched in sorted file order until one file declares `name`.
	#declarationBody(keyword: 'class' | 'interface', name: string): readonly string[] {
		for (const key of moduleKeys(this.#files, this.#module)) {
			const text = this.#files[key]
			if (text === undefined) continue

			const body = declarationBody(text, keyword, name)
			if (body.length > 0) return body
		}

		return []
	}
}
