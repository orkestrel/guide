import type { SourceInterface, SurfaceSymbol } from '../core/index.js'
import { symbolKey } from '../core/index.js'
import type { SourceOptions } from './types.js'
import { declarationBody, exportsFrom, memberMethods, moduleFiles, pathExists, readText } from './helpers.js'

/**
 * The disk-backed reflection of a `SourceInterface` — reads a module scope's
 * exports and member methods off the filesystem with line scanners (AGENTS
 * §22, `PROPOSAL.md` §7), rather than the TypeScript compiler API.
 *
 * @example
 * ```ts
 * const source = new Source({ root: '/repo', module: 'src/core' })
 * source.exports() // [{ name: 'Guide', kind: 'class' }, ...]
 * source.methods('GuideInterface') // ['links', 'methods', ...]
 * source.exists('src/core/Guide.ts') // true
 * ```
 */
export class Source implements SourceInterface {
	readonly #root: string
	readonly #module: SourceOptions['module']
	#exports: readonly SurfaceSymbol[] | undefined

	constructor(options: SourceOptions) {
		this.#root = options.root
		this.#module = options.module
	}

	// The module's exports are computed once on first access and cached —
	// every subsequent call reuses the same scan of an immutable file tree.
	exports(): readonly SurfaceSymbol[] {
		if (this.#exports === undefined) this.#exports = this.#scanExports()
		return this.#exports
	}

	methods(name: string): readonly string[] {
		const interfaceBody = declarationBody(this.#root, this.#module, 'interface', name)
		if (interfaceBody.length > 0) return memberMethods(interfaceBody)

		const classBody = declarationBody(this.#root, this.#module, 'class', name)
		return memberMethods(classBody).filter((method) => method !== 'constructor')
	}

	exists(relative: string): boolean {
		return pathExists(this.#root, relative)
	}

	// The pure union-and-dedupe-and-sort composition behind `exports()` — kept
	// as a private method because it orchestrates `exportsFrom` across every
	// file of the module scope rather than being a self-contained leaf.
	#scanExports(): readonly SurfaceSymbol[] {
		const symbols: SurfaceSymbol[] = []
		const seen = new Set<string>()

		for (const file of moduleFiles(this.#root, this.#module)) {
			for (const symbol of exportsFrom(readText(this.#root, file))) {
				const key = symbolKey(symbol)
				if (seen.has(key)) continue
				seen.add(key)
				symbols.push(symbol)
			}
		}

		return symbols.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1))
	}
}
