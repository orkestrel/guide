import { arrayShape, literalShape, objectShape, stringShape, unionShape } from '@orkestrel/contract'
import { EXPORT_KEYWORDS } from './constants.js'

// AGENTS.md § Design laws: shapers are `ContractShape` values, not functions
// or types - a JSON-Schema blueprint the compilers (factories.ts) turn into a
// guard / parser / schema / generator in lockstep. Every documented data type
// here is non-recursive, so each shapes directly (no `lazyOf` gate needed).

/**
 * Shapes a {@link SurfaceSymbol} — a documented / exported symbol's `name`
 * paired with its {@link ExportKeyword}.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { surfaceSymbolShape } from '@orkestrel/guide'
 *
 * const surfaceSymbol = createContract(surfaceSymbolShape)
 * surfaceSymbol.is({ name: 'Markdown', keyword: 'class' }) // true
 * ```
 */
export const surfaceSymbolShape = objectShape({
	name: stringShape(),
	keyword: literalShape(EXPORT_KEYWORDS),
})

/**
 * Shapes a {@link MethodGroup} — a backticked `interface` name paired with
 * its documented `methods`.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { methodGroupShape } from '@orkestrel/guide'
 *
 * const methodGroup = createContract(methodGroupShape)
 * methodGroup.is({ interface: 'MarkdownInterface', methods: ['walk'] }) // true
 * ```
 */
export const methodGroupShape = objectShape({
	interface: stringShape(),
	methods: arrayShape(stringShape()),
})

/**
 * Shapes a {@link ManifestEntry} — one `## By concept` manifest row, `source`
 * accepting either a single directory or several.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { manifestEntryShape } from '@orkestrel/guide'
 *
 * const manifestEntry = createContract(manifestEntryShape)
 * manifestEntry.is({ concept: 'Markdown', spec: 'guides/src/markdown.md', source: 'src/core', tests: 'tests/src/core' }) // true
 * ```
 */
export const manifestEntryShape = objectShape({
	concept: stringShape(),
	spec: stringShape(),
	source: unionShape(stringShape(), arrayShape(stringShape())),
	tests: stringShape(),
})
