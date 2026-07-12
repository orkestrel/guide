import type { BlockNode, InlineNode, MarkdownDocument, TableNode } from '@orkestrel/markdown'
import { createMarkdown, flattenText, isHeadingNode, isLinkNode, isTableNode, walkNodes } from '@orkestrel/markdown'
import { isEmptyString, isNonEmptyArray } from '@orkestrel/contract'
import type { ManifestEntry, MethodGroup, SurfaceSymbol } from './types.js'
import { MANIFEST, METHODS, SURFACE, TESTS } from './constants.js'
import { firstCode, kindIndex, resolveLink, symbolKey } from './helpers.js'
import { isExportKind } from './validators.js'

/**
 * The block nodes under the named `##` heading, up to the next `##`-or-higher
 * heading (or the document's end) — the section-scoping window `extractSurface` /
 * `extractMethods` walk over.
 *
 * @param document - The parsed guide document
 * @param heading - The `##` heading text to scope to (e.g. `Surface`)
 * @returns The blocks belonging to that section, in document order
 *
 * @example
 * ```ts
 * sectionBlocks(document, 'Surface') // the blocks between `## Surface` and the next `##`
 * ```
 */
export function sectionBlocks(document: MarkdownDocument, heading: string): readonly BlockNode[] {
	const blocks: BlockNode[] = []
	let active = false

	for (const block of document.children) {
		if (isHeadingNode(block) && block.level <= 2) {
			if (block.level === 2 && flattenText(block).trim() === heading) {
				active = true
				continue
			}
			if (active) break
		}

		if (active) blocks.push(block)
	}

	return blocks
}

/**
 * The (name, kind) symbols a `## Surface` table documents — column 0's code span
 * is the name, the `Kind` column (located by header text) is the kind. A row with
 * no code-span name, or an unrecognized `Kind` text, is skipped.
 *
 * @param table - The Surface table to read
 * @returns The table's documented symbols, in row order
 */
function tableSymbols(table: TableNode): readonly SurfaceSymbol[] {
	const column = kindIndex(table)
	const symbols: SurfaceSymbol[] = []

	for (const row of table.rows) {
		const nameCell = row[0]
		const name = nameCell === undefined ? undefined : firstCode(nameCell)
		if (name === undefined) continue

		const kindCell = column === undefined ? undefined : row[column]
		const kindText = kindCell === undefined ? '' : flattenText({ element: 'paragraph', children: kindCell }).trim()
		if (!isExportKind(kindText)) continue

		symbols.push({ name, kind: kindText })
	}

	return symbols
}

/**
 * Every `## Surface` identifier the guide documents — each table's rows (via
 * {@link tableSymbols}) UNION every backticked H3 entity heading in the section
 * (`{name: <codeSpan>, kind: 'class'}`), deduped by {@link symbolKey}.
 *
 * @param document - The parsed guide document
 * @returns The documented surface, in encounter order
 *
 * @example
 * ```ts
 * extractSurface(document) // [{ name: 'Markdown', kind: 'class' }, ...]
 * ```
 */
export function extractSurface(document: MarkdownDocument): readonly SurfaceSymbol[] {
	const symbols: SurfaceSymbol[] = []
	const seen = new Set<string>()

	for (const block of sectionBlocks(document, SURFACE)) {
		if (isTableNode(block)) {
			for (const symbol of tableSymbols(block)) {
				const key = symbolKey(symbol)
				if (seen.has(key)) continue
				seen.add(key)
				symbols.push(symbol)
			}
			continue
		}

		if (isHeadingNode(block) && block.level === 3) {
			const name = firstCode(block.children)
			if (name === undefined) continue
			const symbol: SurfaceSymbol = { name, kind: 'class' }
			const key = symbolKey(symbol)
			if (seen.has(key)) continue
			seen.add(key)
			symbols.push(symbol)
		}
	}

	return symbols
}

/**
 * One {@link MethodGroup} per documented behavioral interface in `## Methods` —
 * an H4 with a code span sets the current interface, and the table immediately
 * following becomes its documented methods.
 *
 * @param document - The parsed guide document
 * @returns The documented method groups, in document order
 *
 * @example
 * ```ts
 * extractMethods(document) // [{ interface: 'MarkdownInterface', methods: ['walk', ...] }]
 * ```
 */
export function extractMethods(document: MarkdownDocument): readonly MethodGroup[] {
	const groups: MethodGroup[] = []
	let current: string | undefined

	for (const block of sectionBlocks(document, METHODS)) {
		if (isHeadingNode(block) && block.level === 4) {
			current = firstCode(block.children)
			continue
		}

		if (isTableNode(block) && current !== undefined) {
			const methods: string[] = []
			for (const row of block.rows) {
				const cell = row[0]
				const name = cell === undefined ? undefined : firstCode(cell)
				if (name !== undefined) methods.push(name)
			}
			groups.push({ interface: current, methods })
			current = undefined
		}
	}

	return groups
}

/**
 * Every link href in the guide document, including table cells — a full,
 * depth-first walk of the whole AST.
 *
 * @param document - The parsed guide document
 * @returns Every link's href, in walk order
 *
 * @example
 * ```ts
 * extractLinks(document) // ['../../src/core/helpers.ts', 'https://example.com']
 * ```
 */
export function extractLinks(document: MarkdownDocument): readonly string[] {
	const links: string[] = []
	for (const node of walkNodes(document)) {
		if (isLinkNode(node)) links.push(node.href)
	}
	return links
}

/**
 * The relative test links declared under `## Tests` — every link href found
 * within that section only.
 *
 * @param document - The parsed guide document
 * @returns The `## Tests` section's link hrefs, in walk order
 *
 * @example
 * ```ts
 * extractTests(document) // ['../../tests/src/core/Markdown.test.ts', ...]
 * ```
 */
export function extractTests(document: MarkdownDocument): readonly string[] {
	const links: string[] = []
	for (const block of sectionBlocks(document, TESTS)) {
		for (const node of walkNodes(block)) {
			if (isLinkNode(node)) links.push(node.href)
		}
	}
	return links
}

/**
 * The link hrefs found within one table cell's inline content.
 *
 * @param cell - The cell's inline nodes
 * @returns The cell's link hrefs, in walk order
 */
function cellLinks(cell: readonly InlineNode[]): readonly string[] {
	const links: string[] = []
	for (const node of walkNodes({ element: 'paragraph', children: cell })) {
		if (isLinkNode(node)) links.push(node.href)
	}
	return links
}

/**
 * Parse a `## By concept` manifest table into its {@link ManifestEntry} rows —
 * each row's Concept cell (flattened text), Spec / Tests cells (a single link
 * href, resolved against `base`), and Source cell (every link href, resolved
 * against `base`; one directory collapses to a `string`, several become a
 * `readonly string[]`). A row missing a concept, spec link, tests link, or
 * source link is skipped as malformed.
 *
 * @param markdown - The manifest markdown source (e.g. `guides/README.md`'s content)
 * @param base - The directory the manifest's links are resolved against
 * @returns The manifest's entries, in row order
 *
 * @example
 * ```ts
 * parseManifest(readme, 'guides') // [{ concept: 'Markdown', spec: 'guides/src/markdown.md', ... }]
 * ```
 */
export function parseManifest(markdown: string, base: string): readonly ManifestEntry[] {
	const document = createMarkdown(markdown).document
	const entries: ManifestEntry[] = []

	for (const block of sectionBlocks(document, MANIFEST)) {
		if (!isTableNode(block)) continue

		for (const row of block.rows) {
			const conceptCell = row[0]
			const specCell = row[1]
			const sourceCell = row[2]
			const testsCell = row[3]
			if (conceptCell === undefined || specCell === undefined || sourceCell === undefined || testsCell === undefined) {
				continue
			}

			const concept = flattenText({ element: 'paragraph', children: conceptCell }).trim()
			if (isEmptyString(concept)) continue

			const specHref = cellLinks(specCell)[0]
			const testsHref = cellLinks(testsCell)[0]
			if (specHref === undefined || testsHref === undefined) continue

			const sourceHrefs = cellLinks(sourceCell).map((href) => resolveLink(base, href))
			if (!isNonEmptyArray<string>(sourceHrefs)) continue
			const [firstSource] = sourceHrefs
			const source = sourceHrefs.length === 1 ? firstSource : sourceHrefs

			entries.push({
				concept,
				spec: resolveLink(base, specHref),
				source,
				tests: resolveLink(base, testsHref),
			})
		}
	}

	return entries
}
