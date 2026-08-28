import type { Guard } from '@orkestrel/contract'
import type { ExportKind, ManifestEntry, MethodGroup, SurfaceSymbol } from './types.js'
import { arrayOf, isString, literalOf, recordOf, unionOf } from '@orkestrel/contract'
import { EXPORT_KINDS } from './constants.js'

// AGENTS section 14: guards are total. Every guard here validates an arbitrary
// `unknown` value crossing an untrusted boundary (parsed guide/manifest data)
// against a data type's full shape, composed from @orkestrel/contract
// combinators and hoisted as module-level values (compiled once, not per call).

/**
 * Whether `value` is one of the five documented {@link ExportKind} literals — the
 * guard behind extracting a Surface table's `Kind` cell into a typed symbol.
 *
 * @param value - The candidate value
 * @returns `true` when `value` is a valid {@link ExportKind}
 *
 * @example
 * ```ts
 * isExportKind('class') // true
 * isExportKind('enum')  // false
 * ```
 */
export const isExportKind: Guard<ExportKind> = literalOf(EXPORT_KINDS)

/**
 * Whether `value` is a well-formed {@link SurfaceSymbol} — a `name` string
 * paired with a valid {@link ExportKind}.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed {@link SurfaceSymbol}
 *
 * @example
 * ```ts
 * isSurfaceSymbol({ name: 'Markdown', kind: 'class' }) // true
 * isSurfaceSymbol({ name: 'Markdown', kind: 'enum' })   // false
 * ```
 */
export const isSurfaceSymbol: Guard<SurfaceSymbol> = recordOf({
	name: isString,
	kind: isExportKind,
})

/**
 * Whether `value` is a well-formed {@link MethodGroup} — a backticked
 * `interface` name paired with its documented `methods`.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed {@link MethodGroup}
 *
 * @example
 * ```ts
 * isMethodGroup({ interface: 'MarkdownInterface', methods: ['walk'] }) // true
 * isMethodGroup({ interface: 'MarkdownInterface', methods: [1] })      // false
 * ```
 */
export const isMethodGroup: Guard<MethodGroup> = recordOf({
	interface: isString,
	methods: arrayOf(isString),
})

/**
 * Whether `value` is a well-formed {@link ManifestEntry} — a `## By concept`
 * manifest row, its `source` accepting either a single directory or several.
 *
 * @param value - The value to test
 * @returns `true` when `value` is a well-formed {@link ManifestEntry}
 *
 * @example
 * ```ts
 * isManifestEntry({ concept: 'Markdown', spec: 'guides/src/markdown.md', source: 'src/core', tests: 'tests/src/core' }) // true
 * isManifestEntry({ concept: 1 }) // false
 * ```
 */
export const isManifestEntry: Guard<ManifestEntry> = recordOf({
	concept: isString,
	spec: isString,
	source: unionOf(isString, arrayOf(isString)),
	tests: isString,
})
