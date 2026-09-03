import type { ContractInterface } from '@orkestrel/contract'
import type {
	GuideInterface,
	ManifestEntry,
	MethodGroup,
	SourceInterface,
	SourceManagerInterface,
	SourceManagerOptions,
	SourceOptions,
	SurfaceSymbol,
} from './types.js'
import { createContract } from '@orkestrel/contract'
import { Guide } from './Guide.js'
import { manifestEntryShape, methodGroupShape, surfaceSymbolShape } from './shapers.js'
import { Source } from './sources/Source.js'
import { SourceManager } from './sources/SourceManager.js'

/**
 * Creates a structured {@link GuideInterface} view over one guide's markdown
 * source — parses once and caches its `sections` / `surface` / `methods` /
 * `links` / `tests` / `fences` projections.
 *
 * @param source - The guide's markdown source text
 * @returns A working {@link GuideInterface}
 *
 * @example
 * ```ts
 * import { createGuide } from '@orkestrel/guide'
 *
 * const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `X` | class |')
 * guide.surface() // [{ name: 'X', keyword: 'class' }]
 * ```
 */
export function createGuide(source: string): GuideInterface {
	return new Guide(source)
}

/**
 * Creates a pure {@link SourceInterface} over a consumer-supplied file
 * inventory — see {@link Source}.
 *
 * @param options - The file inventory and module scope to reflect
 * @returns A `SourceInterface` reflecting the given module scope
 *
 * @example
 * ```ts
 * import { createSource } from '@orkestrel/guide'
 *
 * const source = createSource({
 * 	files: { 'src/core/Guide.ts': 'export class Guide {}\n' },
 * 	module: 'src/core',
 * })
 * source.exports() // [{ name: 'Guide', keyword: 'class' }]
 * ```
 */
export function createSource(options: SourceOptions): SourceInterface {
	return new Source(options)
}

/**
 * Creates a {@link SourceManagerInterface} that resolves the consumer's local
 * import specifiers and shares one source view per module.
 *
 * @param options - The shared file inventory and specifier-to-module policy
 * @returns A source manager over the supplied policy
 *
 * @example
 * ```ts
 * import { createSourceManager } from '@orkestrel/guide'
 *
 * const sources = createSourceManager({
 * 	files: { 'src/core/index.ts': "export * from './types.js'" },
 * 	modules: { '@scope/package': 'src/core' },
 * })
 * sources.source('@scope/package')?.surface()
 * ```
 */
export function createSourceManager(options: SourceManagerOptions): SourceManagerInterface {
	return new SourceManager(options)
}

/**
 * Compiles the {@link surfaceSymbolShape} into a {@link ContractInterface} for
 * {@link SurfaceSymbol} — a guard, coercing parser, JSON Schema, and seeded
 * generator from one shape declaration (AGENTS.md § Design laws).
 *
 * @returns A `SurfaceSymbol` contract bundling `schema` / `is` / `parse` / `generate`
 *
 * @example
 * ```ts
 * import { createSurfaceSymbolContract } from '@orkestrel/guide'
 *
 * const surfaceSymbol = createSurfaceSymbolContract()
 * surfaceSymbol.is({ name: 'Markdown', keyword: 'class' }) // true
 * ```
 */
export function createSurfaceSymbolContract(): ContractInterface<SurfaceSymbol> {
	return createContract(surfaceSymbolShape)
}

/**
 * Compiles the {@link methodGroupShape} into a {@link ContractInterface} for
 * {@link MethodGroup} — a guard, coercing parser, JSON Schema, and seeded
 * generator from one shape declaration (AGENTS.md § Design laws).
 *
 * @returns A `MethodGroup` contract bundling `schema` / `is` / `parse` / `generate`
 *
 * @example
 * ```ts
 * import { createMethodGroupContract } from '@orkestrel/guide'
 *
 * const methodGroup = createMethodGroupContract()
 * methodGroup.is({ interface: 'MarkdownInterface', methods: ['walk'] }) // true
 * ```
 */
export function createMethodGroupContract(): ContractInterface<MethodGroup> {
	return createContract(methodGroupShape)
}

/**
 * Compiles the {@link manifestEntryShape} into a {@link ContractInterface} for
 * {@link ManifestEntry} — a guard, coercing parser, JSON Schema, and seeded
 * generator from one shape declaration (AGENTS.md § Design laws).
 *
 * @returns A `ManifestEntry` contract bundling `schema` / `is` / `parse` / `generate`
 *
 * @example
 * ```ts
 * import { createManifestEntryContract } from '@orkestrel/guide'
 *
 * const manifestEntry = createManifestEntryContract()
 * manifestEntry.is({ concept: 'Markdown', spec: 'guides/src/markdown.md', source: 'src/core', tests: 'tests/src/core' }) // true
 * ```
 */
export function createManifestEntryContract(): ContractInterface<ManifestEntry> {
	return createContract(manifestEntryShape)
}
