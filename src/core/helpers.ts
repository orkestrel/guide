import type { InlineNode, TableNode } from '@orkestrel/markdown'
import {
	flattenText,
	isCodeSpanNode,
	isEmphasisNode,
	isImageNode,
	isLinkNode,
	walkNodes,
} from '@orkestrel/markdown'
import type { GuideModule, SurfaceSymbol } from './types.js'
import { EXTERNAL_SCHEMES } from './constants.js'

/**
 * A module scope normalized to its directory list — a single directory
 * becomes a one-element list so every scanner walks the same shape.
 *
 * @param module - The module scope to normalize
 * @returns The directory list `module` denotes
 *
 * @example
 * ```ts
 * moduleDirs('src/core')                       // ['src/core']
 * moduleDirs(['src/core', 'src/browser'])       // ['src/core', 'src/browser']
 * ```
 */
export function moduleDirs(module: GuideModule): readonly string[] {
	return typeof module === 'string' ? [module] : module
}

/**
 * The file inventory's keys belonging to a {@link GuideModule} scope, sorted —
 * a key belongs when it starts with one of the scope's directories, ends in
 * `.ts`, and is neither that directory's `index.ts` nor a `.test.ts` file.
 *
 * @param files - The workspace file inventory, root-relative path → file text
 * @param module - The module scope to filter to
 * @returns The scope's file keys, root-relative and sorted
 *
 * @example
 * ```ts
 * moduleKeys({ 'src/core/Guide.ts': '', 'src/core/index.ts': '' }, 'src/core') // ['src/core/Guide.ts']
 * ```
 */
export function moduleKeys(
	files: Readonly<Record<string, string>>,
	module: GuideModule,
): readonly string[] {
	const dirs = moduleDirs(module)
	const keys: string[] = []

	for (const key of Object.keys(files)) {
		if (!key.endsWith('.ts')) continue
		if (key.endsWith('.test.ts')) continue

		const dir = dirs.find((candidate) => key.startsWith(`${candidate}/`))
		if (dir === undefined) continue
		if (key === `${dir}/index.ts`) continue

		keys.push(key)
	}

	return keys.sort()
}

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
export function findMissing(
	names: readonly string[],
	source: readonly string[],
): readonly string[] {
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
 * The names in `names` that have no example — a fence containing the name at a
 * word boundary in `fences`, or a membership in `examples`, both count as
 * "has an example"; presence-only, fence and JSDoc content are never checked.
 *
 * @param names - The candidate symbol/member names to check
 * @param fences - The guide's ```ts Patterns fence bodies to search
 * @param examples - The names already known to carry an `@example` JSDoc block
 * @returns The names in `names` with no fence mention and no `@example`
 *
 * @example
 * ```ts
 * findUnexampled(['walk', 'fold'], ['walk()'], []) // ['fold']
 * findUnexampled(['walk'], [], ['walk']) // []
 * ```
 */
export function findUnexampled(
	names: readonly string[],
	fences: readonly string[],
	examples: readonly string[],
): readonly string[] {
	const exampled = new Set(examples)
	return names.filter((name) => {
		if (exampled.has(name)) return false
		const boundary = new RegExp(`\\b${name}\\b`)
		return !fences.some((fence) => boundary.test(fence))
	})
}

/**
 * Parse a fence's `import` statements into per-specifier imported identifier
 * names — handles `import type`, mixed multiline braces, and `x as y` aliases
 * (resolved to the local name `x`... the ORIGINAL exported name, since it is
 * the export that must exist in `source.exports()`).
 *
 * @param fence - A ```ts Patterns fence's verbatim body text
 * @returns One entry per `import ... from 'specifier'` statement, in fence order
 *
 * @example
 * ```ts
 * fenceImports("import { a, b as c } from 'x'\n") // [{ specifier: 'x', names: ['a', 'b'] }]
 * ```
 */
export function fenceImports(
	fence: string,
): readonly { specifier: string; names: readonly string[] }[] {
	const results: { specifier: string; names: readonly string[] }[] = []
	const pattern = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs

	let match: RegExpExecArray | null
	while ((match = pattern.exec(fence)) !== null) {
		const body = match[1]
		const specifier = match[2]
		if (body === undefined || specifier === undefined) continue

		const names = body
			.split(',')
			.map((part) => part.trim())
			.filter((part) => part.length > 0)
			.map((part) => part.replace(/^type\s+/, ''))
			.map((part) => {
				const asMatch = part.match(/^(\w+)\s+as\s+\w+$/)
				return asMatch?.[1] ?? part
			})
			.filter((part) => /^\w+$/.test(part))

		results.push({ specifier, names })
	}

	return results
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
 * into `emphasis` / `link` / `image` children — the extraction rule behind a
 * Surface or Methods table row's first-column identifier.
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
		if (isEmphasisNode(node) || isLinkNode(node) || isImageNode(node)) {
			const value = firstCode(node.children)
			if (value !== undefined) return value
		}
	}
	return undefined
}

/**
 * The link hrefs found within one table cell's inline content.
 *
 * @param cell - The cell's inline nodes
 * @returns The cell's link hrefs, in walk order
 *
 * @example
 * ```ts
 * cellLinks([{ element: 'link', href: 'x.ts', children: [] }]) // ['x.ts']
 * ```
 */
export function cellLinks(cell: readonly InlineNode[]): readonly string[] {
	const links: string[] = []
	for (const node of walkNodes({ element: 'paragraph', children: cell })) {
		if (isLinkNode(node)) links.push(node.href)
	}
	return links
}

/**
 * The identifier prefix of a code-span text — everything before its first `<`,
 * trimmed. Guide cells and headings may annotate a generic-parameterized name
 * (`MarkdownHandler<TNode, T>`) for readability, but the bijection key is the
 * bare identifier the source scanner captures, so both sides must normalize
 * the same way.
 *
 * @param code - A code span's literal text
 * @returns The identifier prefix, or an empty string when `code` is empty
 *
 * @example
 * ```ts
 * identifierOf('MarkdownHandler<TNode, T>') // 'MarkdownHandler'
 * identifierOf('fold')                      // 'fold'
 * ```
 */
export function identifierOf(code: string): string {
	const index = code.indexOf('<')
	return (index < 0 ? code : code.slice(0, index)).trim()
}

/**
 * The index of a table's `Kind` column, found by its header text so it survives
 * column reordering. The match is exact and case-sensitive (`'Kind'`) — a table
 * without that exact header contributes no symbols to the surface it feeds.
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
		if (
			cell !== undefined &&
			flattenText({ element: 'paragraph', children: cell }).trim() === 'Kind'
		) {
			return index
		}
	}
	return undefined
}
