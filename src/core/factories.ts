import type { ContractInterface } from '@orkestrel/contract'
import type {
	GuideInterface,
	ManifestEntry,
	MethodGroup,
	SourceInterface,
	SourceOptions,
	SurfaceSymbol,
} from './types.js'
import { createContract } from '@orkestrel/contract'
import { Guide } from './Guide.js'
import { Source } from './Source.js'
import { manifestEntryShape, methodGroupShape, surfaceSymbolShape } from './shapers.js'

/**
 * Create a structured {@link GuideInterface} view over one guide's markdown
 * source — parses once and caches its `sections` / `surface` / `methods` /
 * `links` / `tests` projections.
 *
 * @param source - The guide's markdown source text
 * @returns A working {@link GuideInterface}
 *
 * @example
 * ```ts
 * import { createGuide } from '@orkestrel/guide'
 *
 * const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `X` | class |')
 * guide.surface() // [{ name: 'X', kind: 'class' }]
 * ```
 */
export function createGuide(source: string): GuideInterface {
	return new Guide(source)
}

/**
 * Create a pure {@link SourceInterface} over a consumer-supplied file
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
 * source.exports() // [{ name: 'Guide', kind: 'class' }]
 * ```
 */
export function createSource(options: SourceOptions): SourceInterface {
	return new Source(options)
}

/**
 * Compile the {@link surfaceSymbolShape} into a {@link ContractInterface} for
 * {@link SurfaceSymbol} — a guard, coercing parser, JSON Schema, and seeded
 * generator from one shape declaration (AGENTS §14).
 *
 * @returns A `SurfaceSymbol` contract bundling `schema` / `is` / `parse` / `generate`
 *
 * @example
 * ```ts
 * import { createSurfaceSymbolContract } from '@orkestrel/guide/core'
 *
 * const surfaceSymbol = createSurfaceSymbolContract()
 * surfaceSymbol.is({ name: 'Markdown', kind: 'class' }) // true
 * ```
 */
export function createSurfaceSymbolContract(): ContractInterface<SurfaceSymbol> {
	return createContract(surfaceSymbolShape)
}

/**
 * Compile the {@link methodGroupShape} into a {@link ContractInterface} for
 * {@link MethodGroup} — a guard, coercing parser, JSON Schema, and seeded
 * generator from one shape declaration (AGENTS §14).
 *
 * @returns A `MethodGroup` contract bundling `schema` / `is` / `parse` / `generate`
 *
 * @example
 * ```ts
 * import { createMethodGroupContract } from '@orkestrel/guide/core'
 *
 * const methodGroup = createMethodGroupContract()
 * methodGroup.is({ interface: 'MarkdownInterface', methods: ['walk'] }) // true
 * ```
 */
export function createMethodGroupContract(): ContractInterface<MethodGroup> {
	return createContract(methodGroupShape)
}

/**
 * Compile the {@link manifestEntryShape} into a {@link ContractInterface} for
 * {@link ManifestEntry} — a guard, coercing parser, JSON Schema, and seeded
 * generator from one shape declaration (AGENTS §14).
 *
 * @returns A `ManifestEntry` contract bundling `schema` / `is` / `parse` / `generate`
 *
 * @example
 * ```ts
 * import { createManifestEntryContract } from '@orkestrel/guide/core'
 *
 * const manifestEntry = createManifestEntryContract()
 * manifestEntry.is({ concept: 'Markdown', spec: 'guides/src/markdown.md', source: 'src/core', tests: 'tests/src/core' }) // true
 * ```
 */
export function createManifestEntryContract(): ContractInterface<ManifestEntry> {
	return createContract(manifestEntryShape)
}
