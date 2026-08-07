import type { InlineNode, TableNode } from '@orkestrel/markdown'
import {
	flattenText,
	isCodeSpanNode,
	isEmphasisNode,
	isImageNode,
	isLinkNode,
	walkNodes,
} from '@orkestrel/markdown'
import type { GuideModule, SourceLine, SurfaceSymbol } from './types.js'
import { EXTERNAL_SCHEMES } from './constants.js'

/**
 * Extract aligned physical source-line records in one character traversal.
 * Real line and block comments and complete template tokens become spaces in
 * {@link SourceLine.code}, while ordinary code, quoted strings, and recognized
 * regex literals retain their columns. Genuine JSDoc opened from reflection
 * code is retained span by span at its exact physical column in
 * {@link SourceLine.jsdoc}; faux openers in comments and templates are
 * excluded. Membership remains each consumer's separate anchored grammar.
 *
 * @remarks
 * Regex recognition is a bounded lexical goal rather than TypeScript parser
 * grammar. Literal ECMAScript Unicode identifiers participate in slash-state
 * recognition, including private identifiers, without decoding escaped
 * identifier spellings. Slash after bare `}` is division, and a post-brace
 * regex statement requires an explicit `;`. General semicolonless
 * declaration/ASI classification is outside this finite projector, so callers
 * place an explicit `;` before a slash-leading statement after such a
 * declaration.
 *
 * @param source - The TypeScript source text to project
 * @returns One aligned terminator-free record per LF or CRLF physical line, including the final line
 *
 * @example
 * ```ts
 * extractSourceLines('export const visible = true // note\n')
 * // [{ source: 'export const visible = true // note', code: 'export const visible = true        ', jsdoc: undefined }, ...]
 * ```
 */
export function extractSourceLines(source: string): readonly SourceLine[] {
	const lines: SourceLine[] = []
	let characters: string[] = []
	let jsdocCharacters: string[] = []
	const identifier = /#?[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*/uy
	const templates: number[] = []
	const parentheses: { role: string; phase: string; binding: boolean }[] = []
	let start = 0
	let mode = 'code'
	let escaped = false
	let regexClass = false
	let operandExpected = true
	let memberExpected = false
	let pendingRole: string | undefined
	let restricted: string | undefined
	let separated = false
	let blockTemplate = false
	let lineTemplate = false
	let jsdoc = false
	let jsdocPresent = false

	for (let offset = 0; offset < source.length; offset += 1) {
		const character = source[offset]
		if (character === undefined) continue
		const next = source[offset + 1]
		const crlf = character === '\r' && next === '\n'
		if (character === '\n' || crlf) {
			const code = characters.join('')
			const present = jsdocPresent || jsdoc
			lines.push({
				source: source.slice(start, offset),
				code,
				jsdoc: present ? jsdocCharacters.join('').padEnd(code.length, ' ') : undefined,
			})
			characters = []
			jsdocCharacters = []
			jsdocPresent = jsdoc
			if (mode !== 'template') separated = true
			if (restricted !== undefined) {
				operandExpected = true
				memberExpected = false
				pendingRole = undefined
				restricted = undefined
			}
			if (crlf) offset += 1
			start = offset + 1

			if (mode === 'line') mode = lineTemplate ? 'templateCode' : 'code'
			else if (mode === 'regex') {
				mode = 'code'
				operandExpected = true
				regexClass = false
			} else if (mode === 'templateLine' || mode === 'templateRegex') {
				mode = 'templateCode'
				operandExpected = true
				regexClass = false
			} else if (mode === 'single' || mode === 'double') {
				if (!escaped) {
					mode = 'code'
					operandExpected = true
				}
			} else if (mode === 'templateSingle' || mode === 'templateDouble') {
				if (!escaped) {
					mode = 'templateCode'
					operandExpected = true
				}
			}
			escaped = false
			continue
		}

		if (mode === 'line' || mode === 'templateLine') {
			characters.push(' ')
			continue
		}

		if (mode === 'block' || mode === 'templateBlock') {
			characters.push(' ')
			if (jsdoc) jsdocCharacters.push(character)
			if (character === '*' && next === '/') {
				characters.push(' ')
				if (jsdoc) {
					jsdocCharacters.push('/')
					jsdoc = false
				}
				offset += 1
				mode = blockTemplate ? 'templateCode' : 'code'
			}
			continue
		}

		if (mode === 'single' || mode === 'double') {
			characters.push(character)
			if (escaped) {
				escaped = false
				continue
			}
			if (character === '\\') {
				escaped = true
				continue
			}
			if ((mode === 'single' && character === "'") || (mode === 'double' && character === '"')) {
				mode = 'code'
				operandExpected = false
			}
			continue
		}

		if (mode === 'regex') {
			characters.push(character)
			if (escaped) {
				escaped = false
				continue
			}
			if (character === '\\') {
				escaped = true
				continue
			}
			if (character === '[') regexClass = true
			else if (character === ']') regexClass = false
			else if (character === '/' && !regexClass) {
				mode = 'code'
				operandExpected = false
			}
			continue
		}

		if (mode === 'templateSingle' || mode === 'templateDouble') {
			characters.push(' ')
			if (escaped) {
				escaped = false
				continue
			}
			if (character === '\\') {
				escaped = true
				continue
			}
			if (
				(mode === 'templateSingle' && character === "'") ||
				(mode === 'templateDouble' && character === '"')
			) {
				mode = 'templateCode'
				operandExpected = false
			}
			continue
		}

		if (mode === 'templateRegex') {
			characters.push(' ')
			if (escaped) {
				escaped = false
				continue
			}
			if (character === '\\') {
				escaped = true
				continue
			}
			if (character === '[') regexClass = true
			else if (character === ']') regexClass = false
			else if (character === '/' && !regexClass) {
				mode = 'templateCode'
				operandExpected = false
			}
			continue
		}

		if (mode === 'template') {
			characters.push(' ')
			if (escaped) {
				escaped = false
				continue
			}
			if (character === '\\') {
				escaped = true
				continue
			}
			if (character === '$' && next === '{') {
				characters.push(' ')
				offset += 1
				const index = templates.length - 1
				if (index >= 0) templates[index] = 1
				mode = 'templateCode'
				operandExpected = true
				memberExpected = false
				pendingRole = undefined
				continue
			}
			if (character === '`') {
				templates.pop()
				mode = templates.length === 0 ? 'code' : 'templateCode'
				operandExpected = false
			}
			continue
		}

		const templateCode = mode === 'templateCode'
		if (character === '/' && next === '/') {
			characters.push(' ', ' ')
			offset += 1
			lineTemplate = templateCode
			mode = templateCode ? 'templateLine' : 'line'
			continue
		}
		if (character === '/' && next === '*') {
			characters.push(' ', ' ')
			if (!templateCode && source[offset + 2] === '*') {
				const column = offset - start
				const width = jsdocCharacters.join('').length
				jsdocCharacters.push(' '.repeat(column - width), '/', '*')
				jsdoc = true
				jsdocPresent = true
			}
			offset += 1
			blockTemplate = templateCode
			mode = templateCode ? 'templateBlock' : 'block'
			continue
		}

		if (character === "'") {
			characters.push(templateCode ? ' ' : character)
			mode = templateCode ? 'templateSingle' : 'single'
			escaped = false
			separated = false
			restricted = undefined
			continue
		}
		if (character === '"') {
			characters.push(templateCode ? ' ' : character)
			mode = templateCode ? 'templateDouble' : 'double'
			escaped = false
			separated = false
			restricted = undefined
			continue
		}
		if (character === '`') {
			characters.push(' ')
			templates.push(0)
			mode = 'template'
			escaped = false
			separated = false
			restricted = undefined
			continue
		}

		const visible = templateCode ? ' ' : character
		if (character === '/' && next === '=' && !operandExpected) {
			characters.push(visible, templateCode ? ' ' : '=')
			offset += 1
			operandExpected = true
			memberExpected = false
			pendingRole = undefined
			separated = false
			restricted = undefined
			continue
		}
		if (character === '/') {
			characters.push(visible)
			if (operandExpected) {
				mode = templateCode ? 'templateRegex' : 'regex'
				escaped = false
				regexClass = false
			} else {
				operandExpected = true
				memberExpected = false
				pendingRole = undefined
			}
			separated = false
			restricted = undefined
			continue
		}

		identifier.lastIndex = offset
		const identifierMatch = identifier.exec(source)
		if (identifierMatch !== null) {
			const token = identifierMatch[0]
			characters.push(templateCode ? ' '.repeat(token.length) : token)
			if (token.startsWith('#')) {
				operandExpected = false
				memberExpected = false
				pendingRole = undefined
				restricted = undefined
				separated = false
				offset += token.length - 1
				continue
			}
			const frame = parentheses[parentheses.length - 1]
			const label = restricted === 'label'
			restricted = undefined
			separated = false
			if (memberExpected) {
				memberExpected = false
				operandExpected = false
				pendingRole = undefined
			} else if (label) {
				operandExpected = false
				pendingRole = undefined
				restricted = 'complete'
			} else if (/^(?:if|while|with)$/.test(token)) {
				pendingRole = 'statement'
				operandExpected = true
			} else if (token === 'for') {
				pendingRole = 'for'
				operandExpected = true
			} else if (token === 'export') {
				pendingRole = 'export'
				operandExpected = true
			} else if (token === 'default' && pendingRole === 'export') {
				pendingRole = undefined
				operandExpected = true
			} else if (/^(?:switch|catch)$/.test(token)) {
				pendingRole = 'block'
				operandExpected = true
			} else if (token === 'await' && pendingRole === 'for') {
				operandExpected = true
			} else if (
				/^(?:return|throw|case|delete|void|typeof|new|await|yield|else|do|extends)$/.test(token)
			) {
				pendingRole = undefined
				operandExpected = true
			} else if (/^(?:in|instanceof)$/.test(token)) {
				pendingRole = undefined
				operandExpected = true
			} else if (/^(?:break|continue)$/.test(token)) {
				pendingRole = undefined
				operandExpected = false
				restricted = 'label'
			} else if (token === 'debugger') {
				pendingRole = undefined
				operandExpected = false
				restricted = 'complete'
			} else if (
				token === 'of' &&
				frame?.role === 'for' &&
				frame.phase === 'left' &&
				!frame.binding &&
				!operandExpected
			) {
				frame.phase = 'right'
				operandExpected = true
				pendingRole = undefined
			} else if (
				/^(?:const|let|var)$/.test(token) &&
				frame?.role === 'for' &&
				frame.phase === 'left'
			) {
				frame.binding = true
				operandExpected = true
				pendingRole = undefined
			} else {
				if (frame?.binding === true) frame.binding = false
				operandExpected = false
				pendingRole = undefined
			}
			offset += token.length - 1
			continue
		}
		if (/[0-9]/.test(character)) {
			let end = offset + 1
			while (end < source.length) {
				const part = source[end]
				if (part === undefined || !/[A-Za-z0-9_$.]/.test(part)) break
				end += 1
			}
			const token = source.slice(offset, end)
			characters.push(templateCode ? ' '.repeat(token.length) : token)
			operandExpected = false
			memberExpected = false
			pendingRole = undefined
			restricted = undefined
			separated = false
			offset = end - 1
			continue
		}

		if (
			(character === '!' && next === '=' && source[offset + 2] === '=') ||
			(character === '=' && next === '=' && source[offset + 2] === '=')
		) {
			characters.push(visible, templateCode ? '  ' : source.slice(offset + 1, offset + 3))
			offset += 2
			operandExpected = true
			memberExpected = false
			pendingRole = undefined
			restricted = undefined
			separated = false
			continue
		}
		if ((character === '!' || character === '=') && next === '=') {
			characters.push(visible, templateCode ? ' ' : '=')
			offset += 1
			operandExpected = true
			memberExpected = false
			pendingRole = undefined
			restricted = undefined
			separated = false
			continue
		}
		if ((character === '+' && next === '+') || (character === '-' && next === '-')) {
			characters.push(visible, templateCode ? ' ' : next)
			offset += 1
			if (separated) operandExpected = true
			memberExpected = false
			pendingRole = undefined
			restricted = undefined
			separated = false
			continue
		}
		if (character === '.' && next === '.' && source[offset + 2] === '.') {
			characters.push(visible, templateCode ? '  ' : '..')
			offset += 2
			operandExpected = true
			memberExpected = false
			pendingRole = undefined
			restricted = undefined
			separated = false
			continue
		}
		if (character === '?' && next === '.') {
			characters.push(visible, templateCode ? ' ' : '.')
			offset += 1
			operandExpected = false
			memberExpected = true
			pendingRole = undefined
			restricted = undefined
			separated = false
			continue
		}

		characters.push(visible)
		if (/\s/.test(character)) continue
		separated = false
		restricted = undefined
		if (character === '(') {
			parentheses.push({ role: pendingRole ?? 'plain', phase: 'left', binding: false })
			operandExpected = true
			memberExpected = false
			pendingRole = undefined
			continue
		}
		if (character === ')') {
			const frame = parentheses.pop()
			operandExpected = frame?.role === 'statement' || frame?.role === 'for'
			memberExpected = false
			pendingRole = undefined
			continue
		}
		if (character === ';') {
			const frame = parentheses[parentheses.length - 1]
			if (frame?.role === 'for' && frame.phase === 'left') frame.phase = 'classic'
			operandExpected = true
			memberExpected = false
			pendingRole = undefined
			continue
		}
		if (character === '.') {
			operandExpected = false
			memberExpected = true
			pendingRole = undefined
			continue
		}
		if (character === ']' || character === '}') {
			const frame = parentheses[parentheses.length - 1]
			if (frame?.role === 'for' && frame.phase === 'left' && frame.binding) {
				frame.binding = false
			}
		}
		if (character === ']') operandExpected = false
		else if (character === '}') {
			const index = templates.length - 1
			const depth = templates[index]
			if (templateCode && index >= 0 && depth !== undefined) {
				templates[index] = depth - 1
				if (depth === 1) mode = 'template'
			}
			operandExpected = false
		} else if (character === '{') {
			const index = templates.length - 1
			const depth = templates[index]
			if (templateCode && index >= 0 && depth !== undefined) templates[index] = depth + 1
			operandExpected = true
		} else if (character !== '!') operandExpected = true
		memberExpected = false
		pendingRole = undefined
	}

	const code = characters.join('')
	const present = jsdocPresent || jsdoc
	lines.push({
		source: source.slice(start),
		code,
		jsdoc: present ? jsdocCharacters.join('').padEnd(code.length, ' ') : undefined,
	})
	return lines
}

/**
 * Whether an opaque inventory key contains only canonical slash-separated
 * segments. Empty, `.` and `..` segments are rejected without rewriting the
 * key; ordinary dotfile segments remain valid.
 *
 * @param key - The opaque inventory key to inspect
 * @returns `true` when every segment is canonical
 *
 * @example
 * ```ts
 * hasCanonicalSegments('src/.hidden.ts') // true
 * hasCanonicalSegments('src/../alias.ts') // false
 * ```
 */
export function hasCanonicalSegments(key: string): boolean {
	return key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * A module scope normalized to its canonical directory list. `'.'` represents
 * workspace root; empty, trailing, and dot-segment spellings reduce through
 * {@link resolvePath}, and duplicates are removed in first-seen order.
 *
 * @param module - The module scope to normalize
 * @returns The directory list `module` denotes
 *
 * @example
 * ```ts
 * normalizeDirectories('src/core')                       // ['src/core']
 * normalizeDirectories(['src/core', 'src/browser'])       // ['src/core', 'src/browser']
 * ```
 */
export function normalizeDirectories(module: GuideModule): readonly string[] {
	const directories: string[] = []
	const seen = new Set<string>()
	for (const value of typeof module === 'string' ? [module] : module) {
		const directory = resolvePath('.', value)
		if (seen.has(directory)) continue
		seen.add(directory)
		directories.push(directory)
	}
	return directories
}

/**
 * The exact opaque file-inventory keys belonging under any canonical
 * {@link GuideModule} directory, sorted. `'.'` selects canonical root-relative
 * keys without accepting `/`, `./`, or `../` aliases. Every selected exact
 * `index.ts` and every `.test.ts` key is excluded independent of scope order.
 *
 * @param files - The workspace file inventory, root-relative path → file text
 * @param module - The module scope to filter to
 * @returns The scope's file keys, root-relative and sorted
 *
 * @example
 * ```ts
 * selectModuleKeys({ 'src/core/Guide.ts': '', 'src/core/index.ts': '' }, 'src/core') // ['src/core/Guide.ts']
 * ```
 */
export function selectModuleKeys(
	files: Readonly<Record<string, string>>,
	module: GuideModule,
): readonly string[] {
	const dirs = normalizeDirectories(module)
	const indexes = new Set(dirs.map((directory) => resolvePath(directory, 'index.ts')))
	const keys: string[] = []

	for (const key of Object.keys(files)) {
		if (!hasCanonicalSegments(key)) continue
		if (!key.endsWith('.ts')) continue
		if (key.endsWith('.test.ts')) continue
		if (
			!dirs.some((directory) => directory === '.' || key.startsWith(`${directory}/`)) ||
			indexes.has(key)
		) {
			continue
		}

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
 * the export that must exist in the checked public/barrel surface).
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
 * Resolve a relative `target` from a root-relative `directory`, normalizing
 * forward-slash dot segments without filesystem or extension inference. A
 * parent pops only a retained real component; every excess leading parent is
 * preserved.
 *
 * @param directory - The root-relative directory to resolve from
 * @param target - The relative target to resolve
 * @returns The normalized path, or `'.'` when no segment remains, retaining every excess parent
 *
 * @example
 * ```ts
 * resolvePath('guides/src', '../../src/core/helpers.ts') // 'src/core/helpers.ts'
 * resolvePath('.', '../../outside.ts') // '../../outside.ts'
 * ```
 */
export function resolvePath(directory: string, target: string): string {
	const combined = `${directory}/${target}`
	const segments: string[] = []

	for (const segment of combined.split('/')) {
		if (segment === '' || segment === '.') continue
		if (segment === '..') {
			const previous = segments[segments.length - 1]
			if (previous !== undefined && previous !== '..') segments.pop()
			else segments.push(segment)
			continue
		}
		segments.push(segment)
	}

	return segments.length === 0 ? '.' : segments.join('/')
}

/**
 * Resolve a relative `target` from the directory containing a root-relative
 * declaring `file`. A slashless file belongs to the workspace root; path
 * reduction is delegated to {@link resolvePath}.
 *
 * @param file - The root-relative declaring file
 * @param target - The relative link destination to resolve
 * @returns The normalized path, retaining every excess leading parent
 *
 * @example
 * ```ts
 * resolveLink('guides/src/guide.md', '../../src/core/helpers.ts') // 'src/core/helpers.ts'
 * resolveLink('index.ts', './root.ts') // 'root.ts'
 * ```
 */
export function resolveLink(file: string, target: string): string {
	const index = file.lastIndexOf('/')
	const directory = index < 0 ? '.' : file.slice(0, index)
	return resolvePath(directory, target)
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
