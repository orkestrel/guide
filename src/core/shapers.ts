import {
	arrayShape,
	literalShape,
	objectShape,
	optionalShape,
	stringShape,
	unionShape,
} from '@orkestrel/contract'
import { EXPORT_KEYWORDS } from './constants.js'

// AGENTS.md § Design laws: shapers are `ContractShape` values, not functions
// or types - a JSON-Schema blueprint the compilers (factories.ts) turn into a
// guard / parser / schema / generator in lockstep. Every documented data type
// here is non-recursive, so each shapes directly (no `lazyOf` gate needed).

/**
 * Shapes a {@link SurfaceSymbol} — a documented / exported symbol's `name`
 * paired with its {@link ExportKeyword} and its optional compared `summary`.
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
	summary: optionalShape(stringShape()),
})

/**
 * Shapes a {@link MethodEntry} — one documented method's `name` paired with its optional
 * compared `summary`.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { methodEntryShape } from '@orkestrel/guide'
 *
 * const methodEntry = createContract(methodEntryShape)
 * methodEntry.is({ name: 'walk' }) // true
 * ```
 */
export const methodEntryShape = objectShape({
	name: stringShape(),
	summary: optionalShape(stringShape()),
})

/**
 * Shapes a {@link SourceExample} — one `@example` block's `name`, its optional pairing
 * `title`, its `code`, and its optional fence `language`.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { sourceExampleShape } from '@orkestrel/guide'
 *
 * const sourceExample = createContract(sourceExampleShape)
 * sourceExample.is({ name: 'walk', code: 'walk()' }) // true
 * ```
 */
export const sourceExampleShape = objectShape({
	name: stringShape(),
	title: optionalShape(stringShape()),
	code: stringShape(),
	language: optionalShape(stringShape()),
})

/**
 * Shapes a {@link Drift} — one disagreement's compared `key` with the optional text each
 * side carries there.
 *
 * @example
 * ```ts
 * import { createContract } from '@orkestrel/contract'
 * import { driftShape } from '@orkestrel/guide'
 *
 * const drift = createContract(driftShape)
 * drift.is({ key: 'class Widget', guide: 'A widget.' }) // true
 * ```
 */
export const driftShape = objectShape({
	key: stringShape(),
	guide: optionalShape(stringShape()),
	source: optionalShape(stringShape()),
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
	methods: arrayShape(methodEntryShape),
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
