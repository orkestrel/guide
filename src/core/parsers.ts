import type { BlockNode, MarkdownDocument } from '@orkestrel/markdown'
import {
	createMarkdown,
	flattenText,
	isCodeBlockNode,
	isHeadingNode,
	isLinkNode,
	isTableNode,
	walkNodes,
} from '@orkestrel/markdown'
import { isEmptyString, isNonEmptyArray, isNonEmptyString } from '@orkestrel/contract'
import type {
	DeclarationHead,
	ManifestEntry,
	MethodGroup,
	SourceLine,
	SurfaceSymbol,
} from './types.js'
import { MANIFEST, METHODS, SURFACE, TESTS } from './constants.js'
import {
	cellLinks,
	extractSourceLines,
	firstCode,
	identifierOf,
	kindIndex,
	normalizeDirectories,
	resolvePath,
	symbolKey,
} from './helpers.js'
import { isExportKind } from './validators.js'

/**
 * The module-scope exports declared in one file's source text — matches
 * `export (async)? (function(\*)?|class|const|interface|type) Name`, deduped
 * by (kind, name). A generator export (`export function* walk`) scans as kind
 * `function` — its trailing `*` is stripped before the {@link ExportKind} check.
 * Scanning uses {@link extractSourceLines}, so comment and template payload is
 * excluded while its uninterrupted column-zero head remains required; preserved
 * columns do not grant membership to leading/interrupted comment forms. The population is
 * exactly `type`, `interface`, `const`, `function`, and `class`; `enum` is
 * outside this reflection contract, not forbidden by general package policy.
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

	for (const line of extractSourceLines(source)) {
		const match = line.code.match(
			/^export (?:async )?(function\*?|class|const|interface|type) (\w+)/,
		)
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
 * this check's contract. Scanning uses {@link extractSourceLines}, so comment
 * and template payload is excluded while its uninterrupted column-zero head
 * remains required; preserved columns do not widen membership. `enum` is likewise outside this reflection population, not
 * forbidden by general package policy.
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

	for (const line of extractSourceLines(source)) {
		if (line.code.startsWith('export ')) continue
		const match = line.code.match(/^(?:async )?(function\*?|class|const|interface|type) (\w+)/)
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
 * within one file's source text — everything between a projected real head and
 * projected column-0 closing `}`. Structural eligibility is projected while the
 * corresponding returned body lines remain raw for JSDoc evidence.
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
	const lines = extractSourceLines(source)
	const projected = lines.map((line) => line.code)

	for (let index = 0; index < projected.length; index += 1) {
		const line = projected[index]
		if (line === undefined || !line.startsWith(opener)) continue

		const head = joinHead(projected, index)
		if (head === undefined || !declaration.test(head.text)) continue

		for (let close = head.end + 1; close < projected.length; close += 1) {
			if (projected[close] === '}') {
				return lines.slice(head.end + 1, close).map((record) => record.source)
			}
		}

		// Unterminated body — keep scanning in case a later match succeeds.
	}

	return []
}

/**
 * The member lines declaring a callable member: plain, `async`, generator
 * (`*`), and optional (`records?(`) methods all count; getters, setters,
 * `static` members, and `#` privates never do (their keyword or `#` breaks
 * the `name(` shape). Matching runs once over projected lines so commented
 * method-like payload never becomes eligible.
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

	for (const line of extractSourceLines(lines.join('\n'))) {
		const method = line.code.match(/^\t(?:async )?\*?(\w+)(<.*>)?\??\(/)
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
 * Select the next physical record after an eligible genuine JSDoc whose final
 * authoritative span carries an exact block-position `@example` tag. Title
 * text is allowed. A leading whitespace-separated span chain is last-span
 * authoritative; intervening source material severs association, while a
 * leading JSDoc on the next record replaces pending state. Any other next
 * physical record is returned once and consumes it. This parser walks aligned
 * records without rescanning source syntax or applying declaration/member
 * grammar.
 *
 * @param lines - Aligned physical source-line records
 * @returns The immediately following candidate lines, in source order
 *
 * @example
 * ```ts
 * extractExampleLines(extractSourceLines('/** @example *' + '/\nexport function walk() {}'))
 * // the `export function walk() {}` SourceLine
 * ```
 */
export function extractExampleLines(lines: readonly SourceLine[]): readonly SourceLine[] {
	const examples: SourceLine[] = []
	let block = false
	let eligible = false
	let example = false
	let pending = false

	for (const line of lines) {
		const projection = line.jsdoc
		const first = projection?.indexOf('/**') ?? -1

		if (pending) {
			if (!block && first >= 0 && line.source.slice(0, first).trim() === '') pending = false
			else {
				examples.push(line)
				pending = false
			}
		}

		if (projection === undefined) continue

		let cursor = 0
		if (block) {
			const close = projection.indexOf('*/')
			const end = close < 0 ? projection.length : close + 2
			if (eligible && /^\s*\*?\s*@example(?=\s|\*\/|$)/.test(projection.slice(0, end))) {
				example = true
			}
			if (close < 0) continue

			block = false
			const opener = projection.indexOf('/**', close + 2)
			const endOfGap = opener < 0 ? line.source.length : opener
			const whitespace = line.source.slice(close + 2, endOfGap).trim() === ''
			if (opener < 0) {
				pending = eligible && example && whitespace
				continue
			}

			eligible = eligible && whitespace
			example = false
			cursor = opener
		} else {
			if (first < 0) continue
			eligible = line.source.slice(0, first).trim() === ''
			example = false
			cursor = first
		}

		while (cursor < projection.length) {
			const close = projection.indexOf('*/', cursor + 2)
			const end = close < 0 ? projection.length : close + 2
			if (eligible && /^\s*\*?\s*@example(?=\s|\*\/|$)/.test(projection.slice(cursor + 3, end))) {
				example = true
			}

			if (close < 0) {
				block = true
				break
			}

			const opener = projection.indexOf('/**', close + 2)
			const endOfGap = opener < 0 ? line.source.length : opener
			const whitespace = line.source.slice(close + 2, endOfGap).trim() === ''
			if (opener < 0) {
				pending = eligible && example && whitespace
				break
			}

			eligible = eligible && whitespace
			example = false
			cursor = opener
		}
	}

	return examples
}

/**
 * The exported functions in one file's source text whose immediately preceding
 * eligible genuine JSDoc block carries `@example`. Shared adjacency comes from
 * {@link extractExampleLines}; exported-function membership is matched against
 * the aligned code projection, so comment and template payload cannot qualify.
 *
 * @param source - The file's source text
 * @returns The exported function names with an `@example`, in file order
 *
 * @example
 * ```ts
 * const block = ['/**', ' * @example', ' *' + '/', 'export function walk() {}', ''].join('\n')
 * examplesFrom(block) // ['walk']
 * examplesFrom('export function walk() {}\n') // []
 * ```
 */
export function examplesFrom(source: string): readonly string[] {
	const names: string[] = []
	const seen = new Set<string>()

	for (const line of extractExampleLines(extractSourceLines(source))) {
		const match = line.code.match(/^export (?:async )?function\*? (\w+)/)
		const name = match?.[1]
		if (isNonEmptyString(name) && !seen.has(name)) {
			seen.add(name)
			names.push(name)
		}
	}

	return names
}

/**
 * The callable-member names in a declaration body (per {@link memberMethods}'
 * grammar) whose immediately preceding eligible genuine JSDoc block, within
 * the same body, carries `@example`. Shared adjacency comes from
 * {@link extractExampleLines}; member membership is matched against aligned
 * projected code.
 *
 * @param lines - A declaration's body lines
 * @returns The exemplified member names, deduped and sorted
 *
 * @example
 * ```ts
 * exampleMethods(['\t/**', '\t * @example', '\t *' + '/', '\twalk(): void']) // ['walk']
 * ```
 */
export function exampleMethods(lines: readonly string[]): readonly string[] {
	const methods: string[] = []
	const seen = new Set<string>()

	for (const line of extractExampleLines(extractSourceLines(lines.join('\n')))) {
		const method = line.code.match(/^\t(?:async )?\*?(\w+)(<.*>)?\??\(/)
		const name = method?.[1]
		if (isNonEmptyString(name) && !seen.has(name)) {
			seen.add(name)
			methods.push(name)
		}
	}

	return Array.from(new Set(methods)).sort()
}

/**
 * Every ```ts fenced code block's body text anywhere in the guide document —
 * a full AST walk so a fence nested inside a blockquote or list still counts.
 *
 * @param document - The parsed guide document
 * @returns Every `ts`-lang fence's verbatim code, in walk order
 *
 * @example
 * ```ts
 * extractPatterns(document) // ["import { X } from './x.js'\nX()"]
 * ```
 */
export function extractPatterns(document: MarkdownDocument): readonly string[] {
	const patterns: string[] = []
	for (const node of walkNodes(document)) {
		if (isCodeBlockNode(node) && node.lang === 'ts') patterns.push(node.code)
	}
	return patterns
}

/**
 * Parse a `## By concept` manifest table into its {@link ManifestEntry} rows —
 * each row's Concept cell (flattened text), Spec / Tests cells (a single link
 * href, resolved against `directory`), and Source cell (every link href,
 * resolved against `directory`; Source links canonicalize through
 * {@link normalizeDirectories}, one directory collapses to a `string`, and several become
 * a `readonly string[]`). A row missing a concept, spec link, tests link, or
 * source link is skipped as malformed.
 *
 * @param markdown - The manifest markdown source (e.g. `guides/README.md`'s content)
 * @param directory - The root-relative directory containing the manifest
 * @returns The manifest's entries, in row order
 *
 * @example
 * ```ts
 * parseManifest(readme, 'guides') // [{ concept: 'Markdown', spec: 'guides/src/markdown.md', ... }]
 * ```
 */
export function parseManifest(markdown: string, directory: string): readonly ManifestEntry[] {
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

			const sourceHrefs = normalizeDirectories(
				cellLinks(sourceCell).map((href) => resolvePath(directory, href)),
			)
			if (!isNonEmptyArray<string>(sourceHrefs)) continue
			const [firstSource] = sourceHrefs
			const source = sourceHrefs.length === 1 ? firstSource : sourceHrefs

			entries.push({
				concept,
				spec: resolvePath(directory, specHref),
				source,
				tests: resolvePath(directory, testsHref),
			})
		}
	}

	return entries
}
