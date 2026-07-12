import type { InlineNode, TableNode } from '@orkestrel/markdown'
import { flattenText, isCodeSpanNode, isEmphasisNode, isLinkNode } from '@orkestrel/markdown'
import type { SurfaceSymbol } from './types.js'
import { EXTERNAL_SCHEMES } from './constants.js'

/**
 * The bijection key for a surface symbol — its kind and name combined — so a
 * symbol-set comparison diffs (name, kind) pairs rather than names alone.
 *
 * @param symbol - The symbol to key
 * @returns The `${kind} ${name}` key
 *
 * @example
 * ```ts
 * symbolKey({ name: 'Markdown', kind: 'class' }) // 'class Markdown'
 * ```
 */
export function symbolKey(symbol: SurfaceSymbol): string {
	return `${symbol.kind} ${symbol.name}`
}

/**
 * The names present in `names` but absent from `source` — the set-difference
 * behind a both-directions bijection assertion.
 *
 * @param names - The candidate names
 * @param source - The names to compare against
 * @returns The names in `names` that are not in `source`
 *
 * @example
 * ```ts
 * findMissing(['a', 'b'], ['a']) // ['b']
 * ```
 */
export function findMissing(names: readonly string[], source: readonly string[]): readonly string[] {
	const existing = new Set(source)
	return names.filter((name) => !existing.has(name))
}

/**
 * The symbol-key set-difference between two symbol lists — `symbols` present but
 * absent from `source`, compared by {@link symbolKey} so a symbol can drift in
 * neither name nor kind.
 *
 * @param symbols - The candidate symbols
 * @param source - The symbols to compare against
 * @returns The symbol keys in `symbols` that are not in `source`
 *
 * @example
 * ```ts
 * missingSymbols([{ name: 'X', kind: 'class' }], []) // ['class X']
 * ```
 */
export function missingSymbols(
	symbols: readonly SurfaceSymbol[],
	source: readonly SurfaceSymbol[],
): readonly string[] {
	return findMissing(symbols.map(symbolKey), source.map(symbolKey))
}

/**
 * Whether a link `href` should be skipped by the guides-parity link checks — an
 * external scheme ({@link EXTERNAL_SCHEMES}) or a bare in-document `#` anchor.
 *
 * @param href - The link destination
 * @returns `true` when the link should not be resolved against the filesystem
 *
 * @example
 * ```ts
 * isExternalLink('https://example.com') // true
 * isExternalLink('../helpers.ts')       // false
 * ```
 */
export function isExternalLink(href: string): boolean {
	if (href.startsWith('#')) return true
	return EXTERNAL_SCHEMES.some((scheme) => href.startsWith(scheme))
}

/**
 * Resolve a relative link `target` against `from` and normalize the result — `from`
 * is treated as a file (its directory is everything before the last `/`) when it
 * carries a `/`, or as a bare directory itself when it does not; `.` segments drop
 * and `..` segments pop the preceding component, purely (no `node:path`).
 *
 * @param from - The declaring guide path (a file) or manifest base (a directory)
 * @param target - The relative link destination to resolve
 * @returns The normalized, workspace-root-relative path
 *
 * @example
 * ```ts
 * resolveLink('guides/src/markdown.md', '../../src/core/helpers.ts') // 'src/core/helpers.ts'
 * resolveLink('guides', '../src/core') // 'src/core'
 * ```
 */
export function resolveLink(from: string, target: string): string {
	const index = from.lastIndexOf('/')
	const dir = index < 0 ? from : from.slice(0, index)
	const combined = dir === '' ? target : `${dir}/${target}`
	const segments: string[] = []

	for (const segment of combined.split('/')) {
		if (segment === '' || segment === '.') continue
		if (segment === '..') {
			if (segments.length > 0) segments.pop()
			else segments.push(segment)
			continue
		}
		segments.push(segment)
	}

	return segments.join('/')
}

/**
 * The first code-span value found by descending an inline node list, following
 * into `emphasis` / `link` children — the extraction rule behind a Surface or
 * Methods table row's first-column identifier.
 *
 * @param nodes - The inline nodes to search
 * @returns The first code span's literal text, or `undefined` when none is found
 *
 * @example
 * ```ts
 * firstCode([{ element: 'codeSpan', value: 'Markdown' }]) // 'Markdown'
 * ```
 */
export function firstCode(nodes: readonly InlineNode[]): string | undefined {
	for (const node of nodes) {
		if (isCodeSpanNode(node)) return node.value
		if (isEmphasisNode(node) || isLinkNode(node)) {
			const value = firstCode(node.children)
			if (value !== undefined) return value
		}
	}
	return undefined
}

/**
 * The index of a table's `Kind` column, found by its header text so it survives
 * column reordering.
 *
 * @param table - The table to inspect
 * @returns The `Kind` column's index, or `undefined` when the table has no `Kind` header
 *
 * @example
 * ```ts
 * kindIndex(table) // 1, or undefined
 * ```
 */
export function kindIndex(table: TableNode): number | undefined {
	for (let index = 0; index < table.header.length; index += 1) {
		const cell = table.header[index]
		if (cell !== undefined && flattenText({ element: 'paragraph', children: cell }).trim() === 'Kind') {
			return index
		}
	}
	return undefined
}
