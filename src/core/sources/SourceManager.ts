import type { SourceInterface, SourceManagerInterface, SourceManagerOptions } from '../types.js'
import { moduleKey } from '../helpers.js'
import { Source } from './Source.js'

/**
 * Resolves a consumer-owned import-specifier policy into pure source views and
 * caches those views by module, so aliases for one module share one entity.
 * Unmapped specifiers remain foreign to the consumer and return `undefined`.
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

		const key = moduleKey(module)
		const existing = this.#sources.get(key)
		if (existing !== undefined) return existing

		const source = new Source({ files: this.#files, module })
		this.#sources.set(key, source)
		return source
	}
}
