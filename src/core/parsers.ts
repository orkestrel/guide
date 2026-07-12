import type { BlockNode, MarkdownDocument } from '@orkestrel/markdown'
import {
	createMarkdown,
	flattenText,
	isHeadingNode,
	isLinkNode,
	isTableNode,
	walkNodes,
} from '@orkestrel/markdown'
import { isEmptyString, isNonEmptyArray, isNonEmptyString } from '@orkestrel/contract'
import type { DeclarationHead, ManifestEntry, MethodGroup, SurfaceSymbol } from './types.js'
import { MANIFEST, METHODS, SURFACE, TESTS } from './constants.js'
import { cellLinks, firstCode, identifierOf, kindIndex, resolveLink, symbolKey } from './helpers.js'
import { isExportKind } from './validators.js'

/**
 * The module-scope exports declared in one file's source text — matches
 * `export (async)? (function(\*)?|class|const|interface|type) Name`, deduped
 * by (kind, name). A generator export (`export function* walk`) scans as kind
 * `function` — its trailing `*` is stripped before the {@link ExportKind} check.
 *
 * @param source - The file's source text
 * @returns The file's exported symbols, in file order
 *
 * @example
 * ```ts
 * exportsFrom('export class Markdown {}\n') // [{ name: 'Markdown', kind: 'class' }]
 * exportsFrom('export function* walk() {}\n') // [{ name: 'walk', kind: 'function' }]
 * ```
 */
export function exportsFrom(source: string): readonly SurfaceSymbol[] {
	const symbols: SurfaceSymbol[] = []
	const seen = new Set<string>()

	for (const line of source.split(/\r?\n/)) {
		const match = line.match(/^export (?:async )?(function\*?|class|const|interface|type) (\w+)/)
		const rawKind = match?.[1]
		const name = match?.[2]
		const kind = rawKind === undefined ? undefined : rawKind.replace(/\*$/, '')
		if (!isNonEmptyString(kind) || !isNonEmptyString(name) || !isExportKind(kind)) continue

		const key = `${kind} ${name}`
		if (seen.has(key)) continue
		seen.add(key)
		symbols.push({ name, kind })
	}

	return symbols
}

/**
 * The module-scope declarations LACKING the `export` keyword in one file's
 * source text — the mirror image of {@link exportsFrom}'s grammar, anchored
 * the same way (column 0, so an indented inner declaration never matches).
 * Scans only the five {@link ExportKind} keywords (`function` / `class` /
 * `const` / `interface` / `type`) — a module-scope `let` or `var` is a
 * different violation class (AGENTS §1 bans `var`; a bare `let` is not a
 * declaration kind this scanner's five-kind grammar covers) and is out of
 * this check's contract.
 *
 * @param source - The file's source text
 * @returns The file's hidden (non-exported) symbols, in file order
 *
 * @example
 * ```ts
 * hiddenFrom('function secretHelper() {}\n') // [{ name: 'secretHelper', kind: 'function' }]
 * hiddenFrom('export class X {}\n') // []
 * ```
 */
export function hiddenFrom(source: string): readonly SurfaceSymbol[] {
	const symbols: SurfaceSymbol[] = []
	const seen = new Set<string>()

	for (const line of source.split(/\r?\n/)) {
		if (line.startsWith('export ')) continue
		const match = line.match(/^(?:async )?(function\*?|class|const|interface|type) (\w+)/)
		const rawKind = match?.[1]
		const name = match?.[2]
		const kind = rawKind === undefined ? undefined : rawKind.replace(/\*$/, '')
		if (!isNonEmptyString(kind) || !isNonEmptyString(name) || !isExportKind(kind)) continue

		const key = `${kind} ${name}`
		if (seen.has(key)) continue
		seen.add(key)
		symbols.push({ name, kind })
	}

	return symbols
}

/**
 * Join the declaration head starting at `start` into one space-separated
 * line, consuming lines until the first that ends with `{`.
 *
 * @param lines - The file's source lines
 * @param start - The index of the head's first line
 * @returns The joined head, or `undefined` when no line opens a body
 *
 * @example
 * ```ts
 * joinHead(['export class X {'], 0) // { text: 'export class X {', end: 0 }
 * ```
 */
export function joinHead(lines: readonly string[], start: number): DeclarationHead | undefined {
	const parts: string[] = []

	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index]
		if (line === undefined) break
		parts.push(index === start ? line.trimEnd() : line.trim())
		if (line.trimEnd().endsWith('{')) return { text: parts.join(' '), end: index }
	}

	return undefined
}

/**
 * The body lines of the named `export class` / `export interface` declaration
 * within one file's source text — everything between the head's opening `{`
 * and the column-0 closing `}`.
 *
 * @param source - The file's source text to search
 * @param keyword - Whether to look for a `class` or an `interface`
 * @param name - The declaration's identifier
 * @returns The declaration's body lines, or an empty array when `source` does not declare it
 *
 * @example
 * ```ts
 * declarationBody('export interface X {\n\twalk(): void\n}\n', 'interface', 'X') // ['\twalk(): void']
 * ```
 */
export function declarationBody(
	source: string,
	keyword: 'class' | 'interface',
	name: string,
): readonly string[] {
	const opener = `export ${keyword} ${name}`
	const declaration = new RegExp(`^export ${keyword} ${name}(?:<.*>)?(?: .*)? \\{$`)
	const lines = source.split(/\r?\n/)

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]
		if (line === undefined || !line.startsWith(opener)) continue

		const head = joinHead(lines, index)
		if (head === undefined || !declaration.test(head.text)) continue

		const body: string[] = []
		for (const member of lines.slice(head.end + 1)) {
			if (member === '}') return body
			body.push(member)
		}

		// Unterminated body — keep scanning in case a later match succeeds.
	}

	return []
}

/**
 * The member lines declaring a callable member: plain, `async`, generator
 * (`*`), and optional (`records?(`) methods all count; getters, setters,
 * `static` members, and `#` privates never do (their keyword or `#` breaks
 * the `name(` shape).
 *
 * @param lines - A declaration's body lines
 * @returns The declared method names, deduped and sorted
 *
 * @example
 * ```ts
 * memberMethods(['\tmap(): void', '\tfilter(): void']) // ['filter', 'map']
 * ```
 */
export function memberMethods(lines: readonly string[]): readonly string[] {
	const methods: string[] = []

	for (const line of lines) {
		const method = line.match(/^\t(?:async )?\*?(\w+)(<.*>)?\??\(/)
		if (method?.[1] !== undefined) methods.push(method[1])
	}

	return Array.from(new Set(methods)).sort()
}

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
 * Every `## Surface` identifier the guide documents — each table row's column 0
 * code span (the name) paired with its `Kind` column (located by header text)
 * UNION every backticked H3 entity heading in the section
 * (`{name: <codeSpan>, kind: 'class'}`), deduped by {@link symbolKey}. A row with
 * no code-span name, or an unrecognized `Kind` text, is skipped.
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
			const column = kindIndex(block)
			for (const row of block.rows) {
				const nameCell = row[0]
				const rawName = nameCell === undefined ? undefined : firstCode(nameCell)
				const name = rawName === undefined ? undefined : identifierOf(rawName)
				if (name === undefined) continue

				const kindCell = column === undefined ? undefined : row[column]
				const kindText =
					kindCell === undefined
						? ''
						: flattenText({ element: 'paragraph', children: kindCell }).trim()
				if (!isExportKind(kindText)) continue

				const symbol: SurfaceSymbol = { name, kind: kindText }
				const key = symbolKey(symbol)
				if (seen.has(key)) continue
				seen.add(key)
				symbols.push(symbol)
			}
			continue
		}

		if (isHeadingNode(block) && block.level === 3) {
			const rawName = firstCode(block.children)
			const name = rawName === undefined ? undefined : identifierOf(rawName)
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
			const rawInterface = firstCode(block.children)
			current = rawInterface === undefined ? undefined : identifierOf(rawInterface)
			continue
		}

		if (isTableNode(block) && current !== undefined) {
			const methods: string[] = []
			for (const row of block.rows) {
				const cell = row[0]
				const rawName = cell === undefined ? undefined : firstCode(cell)
				const name = rawName === undefined ? undefined : identifierOf(rawName)
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
 * Parse a `## By concept` manifest table into its {@link ManifestEntry} rows —
 * each row's Concept cell (flattened text), Spec / Tests cells (a single link
 * href, resolved against `base`), and Source cell (every link href, resolved
 * against `base`; one directory collapses to a `string`, several become a
 * `readonly string[]`). A row missing a concept, spec link, tests link, or
 * source link is skipped as malformed.
 *
 * @param markdown - The manifest markdown source (e.g. `guides/README.md`'s content)
 * @param base - A single directory name relative to the workspace root that the manifest's
 *   links are resolved against (e.g. `'guides'`) — {@link resolveLink}'s arithmetic supports
 *   only one path segment, so a deeper or nested base is not supported
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
			if (
				conceptCell === undefined ||
				specCell === undefined ||
				sourceCell === undefined ||
				testsCell === undefined
			) {
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
