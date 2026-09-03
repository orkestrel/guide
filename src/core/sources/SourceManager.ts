import type { SourceInterface, SourceManagerInterface, SourceManagerOptions } from '../types.js'
import { computeModuleKey } from '../helpers.js'
import { Source } from './Source.js'

/**
 * Resolves a consumer-owned import-specifier policy into pure source views and
 * caches those views by module, so aliases for one module share one entity.
 * Unmapped specifiers remain foreign to the consumer and return `undefined`.
 * `sources()` enumerates the same shared views, one per distinct module the
 * policy maps.
 *
 * @example
 * ```ts
 * import { SourceManager } from '@orkestrel/guide'
 *
 * const sources = new SourceManager({
 * 	files: { 'src/core/index.ts': "export * from './types.js'" },
 * 	modules: { '@scope/package': 'src/core' },
 * })
 * sources.source('@scope/package')?.surface()
 * sources.sources() // [the same shared view]
 * ```
 */
export class SourceManager implements SourceManagerInterface {
	readonly #files: Readonly<Record<string, string>>
	readonly #modules: SourceManagerOptions['modules']
	readonly #sources = new Map<string, SourceInterface>()

	constructor(options: SourceManagerOptions) {
		this.#files = options.files
		this.#modules = options.modules
	}

	source(specifier: string): SourceInterface | undefined {
		if (!Object.hasOwn(this.#modules, specifier)) return undefined
		const module = this.#modules[specifier]
		if (module === undefined) return undefined

		const key = computeModuleKey(module)
		const existing = this.#sources.get(key)
		if (existing !== undefined) return existing

		const source = new Source({ files: this.#files, module })
		this.#sources.set(key, source)
		return source
	}

	sources(): readonly SourceInterface[] {
		const views: SourceInterface[] = []
		const seen = new Set<SourceInterface>()

		for (const specifier of Object.keys(this.#modules)) {
			const view = this.source(specifier)
			if (view === undefined || seen.has(view)) continue
			seen.add(view)
			views.push(view)
		}

		return views
	}
}
