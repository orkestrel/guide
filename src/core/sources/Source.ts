import type { Declaration, SourceInterface, SourceOptions, SurfaceSymbol } from '../types.js'
import {
	computeSymbolKey,
	extractDeclaration,
	extractExampleMethods,
	extractExamples,
	extractExports,
	extractHidden,
	extractMemberMethods,
	extractSourceLines,
	hasCanonicalSegments,
	normalizeDirectories,
	resolveLink,
	resolvePath,
	selectModuleKeys,
} from '../helpers.js'

/**
 * A pure `SourceInterface` — reflects a module scope's intentional direct
 * declarations, conventional barrel-reachable surface, and member methods over
 * a consumer-supplied file inventory, using text-only line scanners rather than
 * the TypeScript compiler API or the filesystem. `Source` never touches disk:
 * the consumer gathers the inventory however their environment allows
 * (`node:fs` in a Node script, `import.meta.glob` in a browser/vitest run) and
 * passes it in as `files`. Conventional barrel traversal recurses through both
 * exact workspace-root `index.ts` and nested `/index.ts` targets. `'.'` is the
 * canonical workspace-root module, module spellings normalize once at
 * construction, and exact opaque inventory keys are never rewritten; keys with
 * empty, `.` or `..` segments stay outside both initial and resolved barrel
 * inventory entrances after relative-row reduction; canonical parent hops
 * remain valid. `methods` resolves a declaration's members through its
 * `extends` chain within the same module scope, keeping the keyword it started
 * from; a base the scope does not declare contributes nothing. One declaration
 * answers for a name: the first file in sorted key order that declares the head
 * supplies its members and its bases, and a second file declaring the same name
 * adds nothing. Source projection preserves columns without widening
 * direct/hidden column-zero heads. Literal ECMAScript Unicode identifiers
 * participate in bounded slash-state recognition without escape decoding.
 * Regex recognition is bounded: slash after bare `}` is division, so a
 * post-brace regex statement requires an explicit `;`. General semicolonless
 * declaration/ASI classification is also outside the finite projector, so a
 * slash-leading statement after such a declaration requires an explicit `;`.
 *
 * @example
 * ```ts
 * import { Source } from '@orkestrel/guide'
 *
 * const source = new Source({
 * 	files: {
 * 		'src/core/index.ts': "export * from './Guide.js'\nexport * from './types.js'\n",
 * 		'src/core/Guide.ts': 'export class Guide {}\n',
 * 		'src/core/types.ts': 'export interface GuideInterface {\n\tsections(): void\n}\n',
 * 	},
 * 	module: 'src/core',
 * })
 * source.exports() // [{ name: 'Guide', kind: 'class' }, { name: 'GuideInterface', kind: 'interface' }]
 * source.surface() // [{ name: 'Guide', kind: 'class' }, { name: 'GuideInterface', kind: 'interface' }]
 * source.methods('GuideInterface') // ['sections']
 * source.exists('src/core/Guide.ts') // true
 * ```
 */
export class Source implements SourceInterface {
	readonly #files: Readonly<Record<string, string>>
	readonly #directories: readonly string[]
	#exports: readonly SurfaceSymbol[] | undefined
	#surface: readonly SurfaceSymbol[] | undefined
	#hidden: readonly SurfaceSymbol[] | undefined
	#examples: readonly string[] | undefined

	constructor(options: SourceOptions) {
		this.#files = options.files
		this.#directories = normalizeDirectories(options.module)
	}

	// The module's exports are computed once on first access and cached —
	// every subsequent call reuses the same scan of an immutable inventory.
	exports(): readonly SurfaceSymbol[] {
		if (this.#exports === undefined) this.#exports = this.#scanSymbols(extractExports)
		return this.#exports
	}

	// The conventional barrel surface is computed once on first access and
	// cached independently from the intentional direct-declaration inventory.
	surface(): readonly SurfaceSymbol[] {
		if (this.#surface === undefined) this.#surface = this.#scanSurface()
		return this.#surface
	}

	methods(name: string): readonly string[] {
		const declared = this.#members('interface', name, new Set<string>())
		if (declared !== undefined) return declared

		const inherited = this.#members('class', name, new Set<string>())
		return inherited === undefined ? [] : inherited.filter((method) => method !== 'constructor')
	}

	exists(relative: string): boolean {
		const keys = Object.keys(this.#files)
		return keys.some((key) => key === relative || key.startsWith(`${relative}/`))
	}

	// The module's hidden declarations are computed once on first access and
	// cached — mirrors `exports()`'s caching.
	hidden(): readonly SurfaceSymbol[] {
		if (this.#hidden === undefined) this.#hidden = this.#scanSymbols(extractHidden)
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
	// plain string scanner (`extractExamples`) rather than a `SurfaceSymbol` one.
	#scanExamples(): readonly string[] {
		const names: string[] = []
		const seen = new Set<string>()

		for (const key of selectModuleKeys(this.#files, this.#directories)) {
			const text = this.#files[key]
			if (text === undefined) continue

			for (const name of extractExamples(text)) {
				if (seen.has(name)) continue
				seen.add(name)
				names.push(name)
			}
		}

		return names
	}

	// The graph closure of each selected directory's conventional root barrel,
	// deduped with the same identity and ordering as the direct export scan.
	#scanSurface(): readonly SurfaceSymbol[] {
		const symbols: SurfaceSymbol[] = []
		const seen = new Set<string>()
		const visited = new Set<string>()

		for (const directory of this.#directories) {
			this.#collectSurface(resolvePath(directory, 'index.ts'), visited, symbols, seen)
		}

		return symbols.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1))
	}

	// Traverse one exact canonical index inventory key. Only complete
	// conventional relative `.js` star rows whose reduced targets are canonical
	// enter the graph; every other line is outside the reflected population and
	// remains validation-owned by policy and builds.
	#collectSurface(
		index: string,
		visited: Set<string>,
		symbols: SurfaceSymbol[],
		seen: Set<string>,
	): void {
		if (!hasCanonicalSegments(index)) return
		if (visited.has(index)) return
		visited.add(index)

		const source = this.#files[index]
		if (source === undefined) return

		for (const line of extractSourceLines(source)) {
			const row = line.code.match(
				/^\s*export\s+\*\s+from\s+(?:'(\.\.?\/[^']+\.js)'|"(\.\.?\/[^"]+\.js)")\s*;?\s*(?:\/\/.*)?$/,
			)
			const target = row?.[1] ?? row?.[2]
			if (target === undefined) continue

			const path = resolveLink(index, `${target.slice(0, -3)}.ts`)
			if (!hasCanonicalSegments(path)) continue
			if (path === 'index.ts' || path.endsWith('/index.ts')) {
				this.#collectSurface(path, visited, symbols, seen)
				continue
			}
			if (visited.has(path)) continue
			visited.add(path)

			const text = this.#files[path]
			if (text === undefined) continue
			for (const symbol of extractExports(text)) {
				const identity = computeSymbolKey(symbol)
				if (seen.has(identity)) continue
				seen.add(identity)
				symbols.push(symbol)
			}
		}
	}

	// The `@example`-carrying members of the interface-or-class declaration
	// body named `name`, unioning both shapes (an implementer may carry its
	// own `@example` a documented interface member does not, or vice versa).
	#exampleMembers(name: string): readonly string[] {
		const members = new Set<string>([
			...extractExampleMethods(this.#locate('interface', name)?.body ?? []),
			...extractExampleMethods(this.#locate('class', name)?.body ?? []),
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

		for (const key of selectModuleKeys(this.#files, this.#directories)) {
			const text = this.#files[key]
			if (text === undefined) continue

			for (const symbol of scan(text)) {
				const identity = computeSymbolKey(symbol)
				if (seen.has(identity)) continue
				seen.add(identity)
				symbols.push(symbol)
			}
		}

		return symbols.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1))
	}

	// The declared method names of the `keyword` declaration named `name`
	// unioned with those of every declaration it extends. `undefined` states one
	// fact only — the module scope declares no such head — which is what sends
	// `methods()` on to the class shape; a name already on the visit path is
	// declared and returns an empty union, so a cycle and a diamond each collapse
	// to one visit. A base the scope does not declare contributes nothing.
	#members(
		keyword: 'class' | 'interface',
		name: string,
		visited: Set<string>,
	): readonly string[] | undefined {
		if (visited.has(name)) return []
		visited.add(name)

		const declaration = this.#locate(keyword, name)
		if (declaration === undefined) return undefined

		const methods = new Set<string>(extractMemberMethods(declaration.body))
		for (const base of declaration.bases) {
			for (const member of this.#members(keyword, base, visited) ?? []) methods.add(member)
		}

		return Array.from(methods).sort()
	}

	// The one declaration that answers for `name` — the first file in sorted key
	// order whose located head has a body or bases, whose body and bases are
	// read together, so a later file declaring the same name contributes
	// nothing. A located head with neither a body nor bases does not declare;
	// the scan continues past it to a later file or falls through unanswered.
	#locate(keyword: 'class' | 'interface', name: string): Declaration | undefined {
		for (const key of selectModuleKeys(this.#files, this.#directories)) {
			const text = this.#files[key]
			if (text === undefined) continue

			const declaration = extractDeclaration(text, keyword, name)
			if (declaration === undefined) continue
			if (declaration.body.length === 0 && declaration.bases.length === 0) continue
			return declaration
		}

		return undefined
	}
}
