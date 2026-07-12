import { arrayShape, literalShape, objectShape, stringShape, unionShape } from '@orkestrel/contract'

// AGENTS section 14 / 4.6.1: shapers are `ContractShape` VALUES, not functions
// or types - a JSON-Schema blueprint the compilers (factories.ts) turn into a
// guard / parser / schema / generator in lockstep. Every documented data type
// here is non-recursive, so each shapes directly (no `lazyOf` gate needed).

/**
 * The shape of a {@link SurfaceSymbol} — a documented / exported symbol's
 * `name` paired with its {@link ExportKind}.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { surfaceSymbolShape } from '@orkestrel/guide/core'
 *
 * const surfaceSymbol = createContract(surfaceSymbolShape)
 * surfaceSymbol.is({ name: 'Markdown', kind: 'class' }) // true
 * ```
 */
export const surfaceSymbolShape = objectShape({
	name: stringShape(),
	kind: literalShape(['type', 'interface', 'const', 'function', 'class']),
})

/**
 * The shape of a {@link MethodGroup} — a backticked `interface` name paired
 * with its documented `methods`.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { methodGroupShape } from '@orkestrel/guide/core'
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
 * The shape of a {@link ManifestEntry} — one `## By concept` manifest row,
 * `source` accepting either a single directory or several.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { manifestEntryShape } from '@orkestrel/guide/core'
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
