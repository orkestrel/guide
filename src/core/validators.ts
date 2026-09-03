import type { Guard } from '@orkestrel/contract'
import type { ExportKeyword, ManifestEntry, MethodGroup, SurfaceSymbol } from './types.js'
import { arrayOf, isString, literalOf, recordOf, unionOf } from '@orkestrel/contract'
import { EXPORT_KEYWORDS } from './constants.js'

// AGENTS.md § Design laws: guards are total. Every guard here validates an arbitrary
// `unknown` value crossing an untrusted boundary (parsed guide/manifest data)
// against a data type's full shape, composed from @orkestrel/contract
// combinators and hoisted as module-level values (compiled once, not per call).

/**
 * Checks whether `value` is one of the documented {@link ExportKeyword}
 * literals — the guard behind extracting a Surface table's `Kind` cell into a
 * typed symbol.
 *
 * @param value - The candidate value
 * @returns True if `value` is a valid {@link ExportKeyword}; false otherwise
 *
 * @example
 * ```ts
 * isExportKeyword('class') // true
 * isExportKeyword('enum')  // false
 * ```
 */
export const isExportKeyword: Guard<ExportKeyword> = literalOf(EXPORT_KEYWORDS)

/**
 * Checks whether `value` is a well-formed {@link SurfaceSymbol} — a `name`
 * string paired with a valid {@link ExportKeyword}.
 *
 * @param value - The value to test
 * @returns True if `value` is a well-formed {@link SurfaceSymbol}; false otherwise
 *
 * @example
 * ```ts
 * isSurfaceSymbol({ name: 'Markdown', keyword: 'class' }) // true
 * isSurfaceSymbol({ name: 'Markdown', keyword: 'enum' })   // false
 * ```
 */
export const isSurfaceSymbol: Guard<SurfaceSymbol> = recordOf({
	name: isString,
	keyword: isExportKeyword,
})

/**
 * Checks whether `value` is a well-formed {@link MethodGroup} — a backticked
 * `interface` name paired with its documented `methods`.
 *
 * @param value - The value to test
 * @returns True if `value` is a well-formed {@link MethodGroup}; false otherwise
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
 * Checks whether `value` is a well-formed {@link ManifestEntry} — a
 * `## By concept` manifest row, its `source` accepting either a single directory
 * or several.
 *
 * @param value - The value to test
 * @returns True if `value` is a well-formed {@link ManifestEntry}; false otherwise
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
