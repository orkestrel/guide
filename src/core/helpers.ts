import type {
	BlockNode,
	CodeBlockNode,
	InlineNode,
	MarkdownDocument,
	MarkdownSpan,
	TableNode,
} from '@orkestrel/markdown'
import type {
	Declaration,
	DeclarationHead,
	DeclarationKeyword,
	Drift,
	FenceImport,
	GuideFence,
	GuideInterface,
	GuideModule,
	MethodEntry,
	MethodGroup,
	SourceComment,
	SourceExample,
	SourceInterface,
	SourceLine,
	SurfaceSymbol,
} from './types.js'
import {
	coalesceText,
	createMarkdown,
	flattenText,
	isBlockquoteNode,
	isCodeBlockNode,
	isCodeSpanNode,
	isEmphasisNode,
	isHeadingNode,
	isImageNode,
	isLinkNode,
	isParagraphNode,
	isTableNode,
	renderMarkdown,
	walkNodes,
} from '@orkestrel/markdown'
import { isNonEmptyString } from '@orkestrel/contract'
import {
	EXTERNAL_SCHEMES,
	KIND,
	METHODS,
	SUMMARY,
	SURFACE,
	TESTS,
	WRAP_WIDTH,
} from './constants.js'
import { isExportKeyword } from './validators.js'

/**
 * Extracts aligned physical source-line records in one character traversal.
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
 * @example Project source into physical code lines
 * ```ts
 * import { extractSourceLines } from '@orkestrel/guide'
 *
 * extractSourceLines('export const visible = true // note\n')
 * // [{ source: 'export const visible = true // note', code: 'export const visible = true        ', jsdoc: undefined }]
 * // … one record per remaining line
 * ```
 */
export function extractSourceLines(source: string): readonly SourceLine[] {
	const lines: SourceLine[] = []
	let characters: string[] = []
	let jsdocCharacters: string[] = []
	const identifier = /#?[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*/uy
	const templates: number[] = []
	const parentheses: Array<{ role: string; phase: string; binding: boolean }> = []
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
 * Checks whether an opaque inventory key contains only canonical slash-separated
 * segments. Empty, `.` and `..` segments are rejected without rewriting the
 * key; ordinary dotfile segments remain valid.
 *
 * @param key - The opaque inventory key to inspect
 * @returns True if every segment is canonical; false otherwise
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
 * Normalizes a module scope to its canonical directory list. `'.'` represents
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
 * Computes the stable cache key for a {@link GuideModule}. Directories normalize before
 * joining, so equivalent module spellings share one key. The NUL separator
 * cannot occur in filesystem-backed canonical-segment inventory keys, so no
 * directory boundary can collide with directory text.
 *
 * @param module - The module scope to key
 * @returns The normalized directories joined by NUL
 *
 * @example
 * ```ts
 * computeModuleKey(['src/core', 'src/browser']) // 'src/core\0src/browser'
 * ```
 */
export function computeModuleKey(module: GuideModule): string {
	return normalizeDirectories(module).join('\0')
}

/**
 * Selects the exact opaque file-inventory keys belonging under any canonical
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
 * Computes the bijection key for a surface symbol — `${keyword} ${name}` — so a symbol-set
 * comparison diffs (name, keyword) pairs rather than names alone.
 *
 * @param symbol - The symbol to key
 * @returns The `${keyword} ${name}` key
 *
 * @example
 * ```ts
 * computeSymbolKey({ name: 'Markdown', keyword: 'class' }) // 'class Markdown'
 * ```
 */
export function computeSymbolKey(symbol: SurfaceSymbol): string {
	return `${symbol.keyword} ${symbol.name}`
}

/**
 * Finds the names present in `names` but absent from `source` — the set-difference
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
 * Finds the fences whose language is absent from the caller's listed languages.
 * Untagged fences are always returned because they have no language to list.
 *
 * @param fences - The guide fences to check
 * @param languages - The listed language tags
 * @returns The unlisted fences in input order
 *
 * @example
 * ```ts
 * findUnlisted([{ language: 'typescript', code: 'walk()' }], ['ts'])
 * // [{ language: 'typescript', code: 'walk()' }]
 * ```
 */
export function findUnlisted(
	fences: readonly GuideFence[],
	languages: readonly string[],
): readonly GuideFence[] {
	const listed = new Set(languages)
	return fences.filter((fence) => fence.language === undefined || !listed.has(fence.language))
}

/**
 * Finds the symbol-key set-difference between two symbol lists — `symbols` present but
 * absent from `source`, compared by {@link computeSymbolKey} so a symbol can drift in
 * neither name nor keyword.
 *
 * @param symbols - The candidate symbols
 * @param source - The symbols to compare against
 * @returns The symbol keys in `symbols` that are not in `source`
 *
 * @example
 * ```ts
 * findMissingSymbols([{ name: 'X', keyword: 'class' }], []) // ['class X']
 * ```
 */
export function findMissingSymbols(
	symbols: readonly SurfaceSymbol[],
	source: readonly SurfaceSymbol[],
): readonly string[] {
	return findMissing(symbols.map(computeSymbolKey), source.map(computeSymbolKey))
}

/**
 * Finds the names in `names` that have no example — a fence containing the name at a
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
		const boundary = new RegExp(`\\b${escapeRegExp(name)}\\b`)
		return !fences.some((fence) => boundary.test(fence))
	})
}

/**
 * Parses a fence's brace `import` statements into per-specifier imported identifier names —
 * `import type`, mixed multiline braces, and `x as y` aliases all count, each alias resolved to
 * the exported name `x` because that is the name the checked barrel surface must hold. Brace
 * bindings only: a default, namespace, side-effect, or mixed `import Default, { named }`
 * statement is not surfaced.
 *
 * @param fence - A ```ts Patterns fence's verbatim body text
 * @returns One entry per `import ... from 'specifier'` statement, in fence order
 *
 * @example
 * ```ts
 * extractFenceImports("import { a, b as c } from 'x'\n") // [{ specifier: 'x', names: ['a', 'b'] }]
 * ```
 */
export function extractFenceImports(fence: string): readonly FenceImport[] {
	const results: FenceImport[] = []
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
 * Checks whether a guides-parity link check skips a link `href` — an external
 * scheme ({@link EXTERNAL_SCHEMES}) or a bare in-document `#` anchor.
 *
 * @param href - The link destination
 * @returns True if a link check leaves the href unresolved against the filesystem; false otherwise
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
 * Resolves a relative `target` from a root-relative `directory`, normalizing
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
 * Resolves a relative `target` from the directory containing a root-relative
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
 * Finds the first code-span value by descending an inline node list, following
 * into `emphasis` / `link` / `image` children — the extraction rule behind a
 * Surface or Methods table row's first-column identifier.
 *
 * @param nodes - The inline nodes to search
 * @returns The first code span's literal text, or `undefined` when none is found
 *
 * @example
 * ```ts
 * findFirstCode([{ element: 'codeSpan', value: 'Markdown' }]) // 'Markdown'
 * ```
 */
export function findFirstCode(nodes: readonly InlineNode[]): string | undefined {
	for (const node of nodes) {
		if (isCodeSpanNode(node)) return node.value
		if (isEmphasisNode(node) || isLinkNode(node) || isImageNode(node)) {
			const value = findFirstCode(node.children)
			if (value !== undefined) return value
		}
	}
	return undefined
}

/**
 * Extracts the link hrefs within one table cell's inline content, in walk order.
 *
 * @param cell - The cell's inline nodes
 * @returns The cell's link hrefs, in walk order
 *
 * @example
 * ```ts
 * extractCellLinks([{ element: 'link', href: 'x.ts', children: [] }]) // ['x.ts']
 * ```
 */
export function extractCellLinks(cell: readonly InlineNode[]): readonly string[] {
	const links: string[] = []
	for (const node of walkNodes({ element: 'paragraph', children: cell })) {
		if (isLinkNode(node)) links.push(node.href)
	}
	return links
}

/**
 * Returns the identifier prefix of a code-span text — everything before its first `<`,
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
 * normalizeIdentifier('MarkdownHandler<TNode, T>') // 'MarkdownHandler'
 * normalizeIdentifier('fold')                      // 'fold'
 * ```
 */
export function normalizeIdentifier(code: string): string {
	const index = code.indexOf('<')
	return (index < 0 ? code : code.slice(0, index)).trim()
}

/**
 * Extracts one table cell's compared text — the inline content flattened with every code
 * span kept as a code span, so `` `Widget` `` reads the same on both sides of the parity
 * comparison. Emphasis drops to its text, a link drops to its text, an image drops to its
 * alternative text, and the markdown parser has already unescaped `\|`.
 *
 * @param cell - The cell's inline nodes
 * @returns The cell's text, code spans included
 *
 * @example
 * ```ts
 * extractCellText([{ element: 'codeSpan', value: 'Widget' }]) // '`Widget`'
 * ```
 */
export function extractCellText(cell: readonly InlineNode[]): string {
	let text = ''
	for (const node of cell) {
		if (isCodeSpanNode(node)) text += `\`${node.value}\``
		else if (isEmphasisNode(node) || isLinkNode(node) || isImageNode(node)) {
			text += extractCellText(node.children)
		} else text += flattenText(node)
	}
	return text
}

/**
 * Builds one table cell's inline content from its compared text — the inverse of
 * {@link extractCellText}. A single-backtick run whose text carries no inner backtick and
 * neither a leading nor a trailing space becomes a code span; every other character, a backtick
 * included, becomes literal text, which `renderMarkdown` escapes so the rendered cell parses back
 * to the text this function was given.
 *
 * @remarks
 * The compared form spells every code span with one backtick per side, because
 * {@link extractCellText} emits `` `${value}` `` whatever delimiter the source used. A run this
 * function refuses is therefore a run no parsed cell produced, and emitting it as text is what
 * keeps the projection total: reading the rendered cell back through {@link extractCellText}
 * returns the text, so a rendered row and a hand-written row compare the same. A code span whose
 * own text carries a backtick or a boundary space is outside the compared form's fidelity in
 * either direction, and this function writes it as text rather than guessing a delimiter.
 *
 * @param text - The cell's compared text, as {@link extractCellText} returns it
 * @returns The cell's inline nodes, in text order
 *
 * @example
 * ```ts
 * buildCell('Holds a `Widget`.')
 * // [{ element: 'text', value: 'Holds a ' }, { element: 'codeSpan', value: 'Widget' }, { element: 'text', value: '.' }]
 * ```
 */
export function buildCell(text: string): readonly InlineNode[] {
	const nodes: InlineNode[] = []
	const spans = /`([^`]+)`/g
	let cursor = 0
	let span: RegExpExecArray | null

	while ((span = spans.exec(text)) !== null) {
		const value = span[1]
		if (value === undefined) continue
		if (span.index > cursor) nodes.push({ element: 'text', value: text.slice(cursor, span.index) })
		if (value.trim() === value) nodes.push({ element: 'codeSpan', value })
		else nodes.push({ element: 'text', value: span[0] })
		cursor = span.index + span[0].length
	}
	if (cursor < text.length) nodes.push({ element: 'text', value: text.slice(cursor) })

	return coalesceText(nodes)
}

/**
 * Finds the index of the column whose header text is `header` so a table's columns survive
 * reordering. The match is exact and case-sensitive — a table without that exact header
 * contributes nothing to the projection reading it, so a `## Surface` table with no
 * {@link SUMMARY} column leaves every row's summary absent and {@link findDrift} reports each
 * of those rows, never agreement.
 *
 * @param table - The table to inspect
 * @param header - The exact header text to locate, for example `Kind`
 * @returns The column's index, or `undefined` when the table has no such header
 *
 * @example
 * ```ts
 * findColumnIndex(table, 'Kind') // 1, or undefined
 * ```
 */
export function findColumnIndex(table: TableNode, header: string): number | undefined {
	for (let index = 0; index < table.header.length; index += 1) {
		const cell = table.header[index]
		if (
			cell !== undefined &&
			flattenText({ element: 'paragraph', children: cell }).trim() === header
		) {
			return index
		}
	}
	return undefined
}

/**
 * Extracts the module-scope exports declared in one file's source text — the declaration keys
 * {@link collectKeys} reports, each split back into the keyword and name that built it, deduped by
 * (keyword, name).
 *
 * @remarks
 * That one grammar matches `export (async)? (function(\*)?|class|const|interface|type) Name`; a
 * generator export (`export function* walk`) keys as the `function` keyword, its trailing `*`
 * stripped before the {@link ExportKeyword} check. Scanning uses {@link extractSourceLines}, so
 * comment and template payload is excluded while its uninterrupted column-zero head remains
 * required; preserved columns do not grant membership to leading/interrupted comment forms. The
 * population is exactly `type`, `interface`, `const`, `function`, and `class`; `enum` is outside
 * this reflection contract, not forbidden by general package policy.
 *
 * @param source - The file's source text
 * @returns The file's exported symbols, in file order
 *
 * @example
 * ```ts
 * extractExports('export class Markdown {}\n') // [{ name: 'Markdown', keyword: 'class' }]
 * extractExports('export function* walk() {}\n') // [{ name: 'walk', keyword: 'function' }]
 * ```
 */
export function extractExports(source: string): readonly SurfaceSymbol[] {
	const symbols: SurfaceSymbol[] = []
	const seen = new Set<string>()
	const lines = extractSourceLines(source)
	const summaries = collectSummaries(lines)
	const keys = collectKeys(lines)

	for (const line of lines) {
		const key = keys.get(line)
		if (key === undefined || seen.has(key)) continue

		// A declaration key is `${keyword} ${name}`, so its one space splits it back into the pair
		// that built it. A member key carries no space, so its keyword reads empty and the keyword
		// guard drops it here — no second head pattern excludes it.
		const space = key.indexOf(' ')
		const keyword = key.slice(0, Math.max(space, 0))
		if (!isExportKeyword(keyword)) continue

		seen.add(key)
		const name = key.slice(space + 1)
		const summary = summaries.get(line)
		symbols.push({ name, keyword, ...(summary === undefined ? {} : { summary }) })
	}

	return symbols
}

/**
 * Extracts the module-scope declarations lacking the `export` keyword in one file's source text —
 * the mirror image of {@link extractExports}'s grammar, anchored the same way (column 0, so an
 * indented inner declaration never matches).
 *
 * @remarks
 * Scans only the {@link ExportKeyword} keywords (`function` / `class` / `const` / `interface` /
 * `type`) — a module-scope `let` or `var` is outside this scanner's declaration-keyword grammar
 * and out of this check's contract. Scanning uses {@link extractSourceLines}, so comment and
 * template payload is excluded while its uninterrupted column-zero head remains required;
 * preserved columns do not widen membership. `enum` is likewise outside this reflection
 * population, not forbidden by general package policy.
 *
 * @param source - The file's source text
 * @returns The file's hidden (non-exported) symbols, in file order
 *
 * @example
 * ```ts
 * extractHidden('function secretHelper() {}\n') // [{ name: 'secretHelper', keyword: 'function' }]
 * extractHidden('export class X {}\n') // []
 * ```
 */
export function extractHidden(source: string): readonly SurfaceSymbol[] {
	const symbols: SurfaceSymbol[] = []
	const seen = new Set<string>()
	const lines = extractSourceLines(source)
	const summaries = collectSummaries(lines)

	for (const line of lines) {
		if (line.code.startsWith('export ')) continue
		const match = line.code.match(/^(?:async )?(function\*?|class|const|interface|type) (\w+)/)
		const rawKeyword = match?.[1]
		const name = match?.[2]
		const keyword = rawKeyword === undefined ? undefined : rawKeyword.replace(/\*$/, '')
		if (!isNonEmptyString(keyword) || !isNonEmptyString(name) || !isExportKeyword(keyword)) continue

		const key = `${keyword} ${name}`
		if (seen.has(key)) continue
		seen.add(key)
		const summary = summaries.get(line)
		symbols.push({ name, keyword, ...(summary === undefined ? {} : { summary }) })
	}

	return symbols
}

/**
 * Joins the declaration head starting at `start` into one space-separated
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
 * Escapes every regex metacharacter in a literal string so it reads as text
 * inside a larger `RegExp` source rather than as syntax.
 *
 * @remarks
 * A caller-supplied name reaches a `RegExp` through this: {@link
 * findUnexampled} splices it into a word-boundary search, so a name carrying
 * `$`, `(`, `[`, or `.` matches that character literally instead of throwing or
 * matching text it does not name. Pure and total; never throws.
 *
 * @param value - The literal string to escape
 * @returns `value` with every regex metacharacter backslash-escaped
 *
 * @example
 * ```ts
 * escapeRegExp('A.B') // 'A\\.B'
 * new RegExp(`^${escapeRegExp('A.B')}$`).test('AxB') // false
 * ```
 */
export function escapeRegExp(value: string): string {
	return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

/**
 * Collects every `export class` / `export interface` declaration one file's source text declares,
 * each keyed `${keyword} ${name}` and carrying the body lines and the base identifiers read from
 * its own head, so a body and a heritage clause always come from the same declaration.
 *
 * @remarks
 * The whole file is projected once through {@link extractSourceLines} and every head is read from
 * that one projection, so a scope resolving many names reads each file once rather than once per
 * name. A head is a column-zero `export class` / `export interface` line, an oxfmt-wrapped
 * signature joined through {@link joinHead}, with an optional generic parameter list and an
 * optional heritage clause between the identifier and the opening `{`; the identifier is the head's
 * own run up to that list or clause, so it enters the key as literal text and no name reaches a
 * `RegExp`. Body lines are the raw source between the head and the first projected column-zero `}`,
 * keeping JSDoc evidence intact. Every balanced `<...>` span is removed from the head before its
 * `extends` clause is read, so a `T extends Base` type parameter is never a base and `Base<T>`
 * reads as `Base`; a class's `implements` clause and everything after it is excluded, and a
 * qualified base such as `namespace.Base` is returned verbatim. The first head of a key that opens
 * a column-zero close answers for that key: a head that opens none records nothing, and a later
 * head of a key already collected adds nothing.
 *
 * @param source - The file's source text to read
 * @returns One entry per collected declaration, keyed `${keyword} ${name}`
 *
 * @example
 * ```ts
 * collectDeclarations('export interface X extends Y {\n\twalk(): void\n}\n').get('interface X')
 * // { body: ['\twalk(): void'], bases: ['Y'] }
 * ```
 */
export function collectDeclarations(source: string): ReadonlyMap<string, Declaration> {
	const declarations = new Map<string, Declaration>()
	const opener = /^export (?:class|interface) /
	const grammar = /^export (class|interface) ([^\s<]+)(?:<.*>)?(?: .*)? \{$/
	const lines = extractSourceLines(source)
	const projected = lines.map((line) => line.code)

	for (let index = 0; index < projected.length; index += 1) {
		const line = projected[index]
		if (line === undefined || !opener.test(line)) continue

		const head = joinHead(projected, index)
		if (head === undefined) continue
		const declared = grammar.exec(head.text)
		const keyword = declared?.[1]
		const name = declared?.[2]
		if (keyword === undefined || name === undefined) continue

		const key = `${keyword} ${name}`
		if (declarations.has(key)) continue

		let depth = 0
		let flat = ''
		for (const character of head.text.slice(`export ${key}`.length, -1)) {
			if (character === '<') depth += 1
			else if (character === '>') depth = Math.max(0, depth - 1)
			else if (depth === 0) flat += character
		}
		const clause = flat.replace(/\bimplements\b[\s\S]*$/, '').match(/\bextends\b([\s\S]*)$/)?.[1]
		const bases =
			clause === undefined
				? []
				: clause
						.split(',')
						.map((base) => base.trim())
						.filter(isNonEmptyString)

		for (let close = head.end + 1; close < projected.length; close += 1) {
			if (projected[close] !== '}') continue
			declarations.set(key, {
				body: lines.slice(head.end + 1, close).map((record) => record.source),
				bases,
			})
			break
		}

		// An unterminated body records nothing — keep scanning in case a later head closes.
	}

	return declarations
}

/**
 * Locates the named `export class` / `export interface` declaration in one file's source text
 * and returns its body lines and its base identifiers read from that one head, so a body and a
 * heritage clause always come from the same declaration, or `undefined` when the file declares
 * no such head.
 *
 * @remarks
 * The one named lookup over {@link collectDeclarations}, which owns the head grammar, the body
 * window, and the base reading. `name` is compared as literal text against the identifier the head
 * itself carries, so a metacharacter in `name` names that character rather than matching text it
 * does not name, and a caller reading many names from one file collects once instead.
 *
 * @param source - The file's source text to search
 * @param keyword - Whether to look for a `class` or an `interface`
 * @param name - The declaration's identifier
 * @returns Its body and bases, or `undefined` when `source` declares no such head
 *
 * @example
 * ```ts
 * extractDeclaration('export interface X extends Y {\n\twalk(): void\n}\n', 'interface', 'X')
 * // { body: ['\twalk(): void'], bases: ['Y'] }
 * ```
 */
export function extractDeclaration(
	source: string,
	keyword: DeclarationKeyword,
	name: string,
): Declaration | undefined {
	return collectDeclarations(source).get(`${keyword} ${name}`)
}

/**
 * Selects the member lines declaring a callable member: plain, `async`, generator
 * (`*`), and optional (`records?(`) methods all count; getters, setters,
 * `static` members, and `#` privates never do (their keyword or `#` breaks
 * the `name(` shape). The grammar is {@link collectKeys}'s, read once over
 * {@link extractBodyLines}'s projection of the body, so commented method-like payload never
 * becomes eligible and each member keys to the owner head that projection supplies. Each member
 * carries its own doc block's description paragraph, read through {@link collectSummaries}; the
 * first declaration of a name answers for it.
 *
 * @param lines - A declaration's body lines
 * @returns The declared members, deduplicated by name and sorted by name
 *
 * @example
 * ```ts
 * extractMemberMethods(['\tmap(): void', '\tfilter(): void']) // [{ name: 'filter' }, { name: 'map' }]
 * ```
 */
export function extractMemberMethods(lines: readonly string[]): readonly MethodEntry[] {
	const methods = new Map<string, MethodEntry>()
	const projected = extractBodyLines(lines)
	const summaries = collectSummaries(projected)
	const keys = collectKeys(projected)

	for (const line of projected) {
		// A member key is `${owner}.${member}`, so its dot splits the member name back out and a
		// declaration key, which carries none, drops out here.
		const key = keys.get(line) ?? ''
		const dot = key.indexOf('.')
		if (dot < 0) continue

		const name = key.slice(dot + 1)
		if (methods.has(name)) continue
		const summary = summaries.get(line)
		methods.set(name, { name, ...(summary === undefined ? {} : { summary }) })
	}

	return Array.from(methods.values()).sort((a, b) =>
		a.name === b.name ? 0 : a.name < b.name ? -1 : 1,
	)
}

/**
 * Selects the block nodes under the named `##` heading, up to the next `##`-or-higher
 * heading (or the document's end) — the section-scoping window `extractSurface` /
 * `extractMethods` walk over.
 *
 * @param document - The parsed guide document
 * @param heading - The `##` heading text to scope to, for example `Surface`
 * @returns The blocks belonging to that section, in document order
 *
 * @example
 * ```ts
 * selectSectionBlocks(document, 'Surface') // the blocks between `## Surface` and the next `##`
 * ```
 */
export function selectSectionBlocks(
	document: MarkdownDocument,
	heading: string,
): readonly BlockNode[] {
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
 * Extracts one `## Surface` table row's symbol — its column 0 code span as the name, its
 * {@link KIND} column as the keyword, and its {@link SUMMARY} column as the compared summary
 * when the table has that column. A row with no code-span name and a row whose `Kind` text is
 * no {@link ExportKeyword} have no symbol to key, so each returns `undefined`.
 *
 * @param table - The table to read
 * @param row - The index of the row within {@link TableNode.rows}
 * @returns The row's symbol, or `undefined` when the row keys none
 *
 * @example
 * ```ts
 * extractRowSymbol(table, 0) // { name: 'walk', keyword: 'function', summary: 'Walks the tree.' }
 * ```
 */
export function extractRowSymbol(table: TableNode, row: number): SurfaceSymbol | undefined {
	const cells = table.rows[row]
	if (cells === undefined) return undefined

	const nameCell = cells[0]
	const rawName = nameCell === undefined ? undefined : findFirstCode(nameCell)
	const name = rawName === undefined ? undefined : normalizeIdentifier(rawName)
	if (name === undefined) return undefined

	const column = findColumnIndex(table, KIND)
	const kindCell = column === undefined ? undefined : cells[column]
	const keyword =
		kindCell === undefined ? '' : flattenText({ element: 'paragraph', children: kindCell }).trim()
	if (!isExportKeyword(keyword)) return undefined

	const summary = extractRowSummary(table, row)
	return { name, keyword, ...(summary === undefined ? {} : { summary }) }
}

/**
 * Extracts one `## Methods` table row's entry — its column 0 code span as the name and its
 * {@link SUMMARY} column as the compared summary when the table has that column. A row with no
 * code-span name has no member to key, so it returns `undefined`.
 *
 * @param table - The table to read
 * @param row - The index of the row within {@link TableNode.rows}
 * @returns The row's entry, or `undefined` when the row keys none
 *
 * @example
 * ```ts
 * extractRowEntry(table, 0) // { name: 'walk', summary: 'Walks the tree.' }
 * ```
 */
export function extractRowEntry(table: TableNode, row: number): MethodEntry | undefined {
	const cells = table.rows[row]
	if (cells === undefined) return undefined

	const cell = cells[0]
	const rawName = cell === undefined ? undefined : findFirstCode(cell)
	const name = rawName === undefined ? undefined : normalizeIdentifier(rawName)
	if (name === undefined) return undefined

	const summary = extractRowSummary(table, row)
	return { name, ...(summary === undefined ? {} : { summary }) }
}

/**
 * Extracts one row's compared summary — its {@link SUMMARY} column read through
 * {@link extractCellText} and {@link normalizeSummary}. A table with no such column and a row
 * whose cell is empty each carry no summary and return `undefined` rather than an empty string,
 * so {@link findDrift} reports the absence.
 *
 * @param table - The table to read
 * @param row - The index of the row within {@link TableNode.rows}
 * @returns The row's compared summary, or `undefined` when it carries none
 *
 * @example
 * ```ts
 * extractRowSummary(table, 0) // 'Walks the tree.'
 * ```
 */
export function extractRowSummary(table: TableNode, row: number): string | undefined {
	const described = findColumnIndex(table, SUMMARY)
	const cells = table.rows[row]
	const cell = described === undefined || cells === undefined ? undefined : cells[described]
	const summary = cell === undefined ? '' : normalizeSummary(extractCellText(cell))
	return summary.length === 0 ? undefined : summary
}

/**
 * Extracts every `## Surface` identifier the guide documents — each table row's column 0
 * code span (the name) paired with its `Kind` column (located by header text)
 * unioned with every backticked H3 entity heading in the section
 * (`{name: <codeSpan>, keyword: 'class'}`), deduped by {@link computeSymbolKey}. A row with no
 * code-span name has no name to key a symbol on, so this reader skips it and
 * {@link extractUnnamed} reports it; a row with an unrecognized `Kind` text is skipped. A row
 * also carries its {@link SUMMARY} column's compared text when the table has that column; a
 * table without it leaves every row's summary absent, which {@link findDrift} reports.
 *
 * @param document - The parsed guide document
 * @returns The documented surface, in encounter order
 *
 * @example
 * ```ts
 * extractSurface(document) // [{ name: 'Markdown', keyword: 'class' }, ...]
 * ```
 */
export function extractSurface(document: MarkdownDocument): readonly SurfaceSymbol[] {
	const symbols: SurfaceSymbol[] = []
	const seen = new Set<string>()

	for (const block of selectSectionBlocks(document, SURFACE)) {
		if (isTableNode(block)) {
			for (let row = 0; row < block.rows.length; row += 1) {
				const symbol = extractRowSymbol(block, row)
				if (symbol === undefined) continue
				const key = computeSymbolKey(symbol)
				if (seen.has(key)) continue
				seen.add(key)
				symbols.push(symbol)
			}
			continue
		}

		if (isHeadingNode(block) && block.level === 3) {
			const rawName = findFirstCode(block.children)
			const name = rawName === undefined ? undefined : normalizeIdentifier(rawName)
			if (name === undefined) continue
			const symbol: SurfaceSymbol = { name, keyword: 'class' }
			const key = computeSymbolKey(symbol)
			if (seen.has(key)) continue
			seen.add(key)
			symbols.push(symbol)
		}
	}

	return symbols
}

/**
 * Extracts one {@link MethodGroup} per documented behavioral interface in `## Methods` —
 * an H4 with a code span sets the current interface, and the table immediately
 * following becomes its documented methods. A row with no code-span name has no name to key a
 * member on, so this reader skips it and {@link extractUnnamed} reports it. Each row carries its
 * {@link SUMMARY} column's compared text when the table has that column.
 *
 * @param document - The parsed guide document
 * @returns The documented method groups, in document order
 *
 * @example
 * ```ts
 * extractMethods(document) // [{ interface: 'MarkdownInterface', methods: [{ name: 'walk' }] }]
 * ```
 */
export function extractMethods(document: MarkdownDocument): readonly MethodGroup[] {
	const groups: MethodGroup[] = []

	for (const [table, name] of collectGroups(document)) {
		const methods: MethodEntry[] = []
		for (let row = 0; row < table.rows.length; row += 1) {
			const entry = extractRowEntry(table, row)
			if (entry !== undefined) methods.push(entry)
		}
		groups.push({ interface: name, methods })
	}

	return groups
}

/**
 * Collects each `## Methods` table keyed to the interface its `####` heading names — an H4
 * carrying a code span sets the current interface and the table immediately following claims it,
 * so a heading with no table and a table with no heading before it contribute nothing. The map
 * iterates in document order and a node keys itself, so a repeated identical table keeps its own
 * entry.
 *
 * @param document - The parsed guide document
 * @returns One entry per documented `## Methods` table, in document order
 *
 * @example
 * ```ts
 * collectGroups(document).values().next().value // 'GuideInterface'
 * ```
 */
export function collectGroups(document: MarkdownDocument): ReadonlyMap<TableNode, string> {
	const groups = new Map<TableNode, string>()
	let current: string | undefined

	for (const block of selectSectionBlocks(document, METHODS)) {
		if (isHeadingNode(block) && block.level === 4) {
			const rawInterface = findFirstCode(block.children)
			current = rawInterface === undefined ? undefined : normalizeIdentifier(rawInterface)
			continue
		}

		if (isTableNode(block) && current !== undefined) {
			groups.set(block, current)
			current = undefined
		}
	}

	return groups
}

/**
 * Extracts every `## Surface` or `## Methods` table row whose first cell carries no code span.
 * {@link extractSurface} and {@link extractMethods} skip such a row, because a row with no
 * name gives them nothing to key a symbol or a member on, and this projection is what reports
 * the skip. Each entry is the row's cells read through {@link extractCellText} and joined
 * by ` | `, so a reader can locate the row in the guide; the `## Surface` rows come first,
 * then the `## Methods` rows, each in document order. {@link GuideInterface.unnamed} caches it.
 *
 * @param document - The parsed guide document
 * @returns One entry per row carrying no code-span name
 *
 * @example
 * ```ts
 * extractUnnamed(document) // ['Widget | class | Represents a widget.']
 * ```
 */
export function extractUnnamed(document: MarkdownDocument): readonly string[] {
	const unnamed: string[] = []

	for (const heading of [SURFACE, METHODS]) {
		for (const block of selectSectionBlocks(document, heading)) {
			if (!isTableNode(block)) continue
			for (const row of block.rows) {
				const cell = row[0]
				if (cell !== undefined && findFirstCode(cell) !== undefined) continue
				unnamed.push(row.map((content) => extractCellText(content)).join(' | '))
			}
		}
	}

	return unnamed
}

/**
 * Extracts every link href in the guide document, including table cells — a full,
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
 * Extracts the relative test links declared under `## Tests` — every link href found
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
	for (const block of selectSectionBlocks(document, TESTS)) {
		for (const node of walkNodes(block)) {
			if (isLinkNode(node)) links.push(node.href)
		}
	}
	return links
}

/**
 * Returns the canonical body of one genuine JSDoc span — the `/**` opener, the closing
 * marker, each line's continuation marker, and the block's leading indentation removed,
 * with per-line trailing whitespace trimmed and the surrounding blank lines dropped. A
 * line's own indentation beyond the marker is kept, so an `@example` fence body keeps the
 * shape it was written in.
 *
 * @param comment - One complete genuine JSDoc span's raw text
 * @returns The span's unwrapped body
 *
 * @example
 * ```ts
 * normalizeComment('/**' + ' Creates a widget. *' + '/') // 'Creates a widget.'
 * ```
 */
export function normalizeComment(comment: string): string {
	return unwrapComment(comment).join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
}

/**
 * Unwraps one genuine JSDoc span into one content line per physical line — the `/**` opener,
 * the closing marker, each line's continuation marker, and per-line trailing whitespace removed,
 * with a line's own indentation past the marker kept. The result is aligned with
 * `comment.split('\n')`, so an index found in it addresses the same physical line of the span it
 * was built from, which is what lets a rewrite keep every line it does not replace.
 * {@link normalizeComment} is this projection joined and trimmed at its ends.
 *
 * @param comment - One complete genuine JSDoc span's raw text
 * @returns One content line per physical line of the span
 *
 * @example
 * ```ts
 * unwrapComment('/**' + '\n * Walks.\n *' + '/') // ['', 'Walks.', '']
 * ```
 */
export function unwrapComment(comment: string): readonly string[] {
	const body = /^[ \t]*\/\*([\s\S]*?)\*\/[ \t]*$/.exec(comment)?.[1] ?? comment
	return body.split('\n').map((line) => line.replace(/^[ \t]*\*[ \t]?/, '').replace(/[ \t]+$/, ''))
}

/**
 * Returns the canonical compared form of a description paragraph — `{@link Target}` and
 * `{@link Target | label}` become the code token of the label or the target text with the
 * target's `import('./module.js').` or `module#` module part dropped, every run of whitespace,
 * including a collapsed continuation marker and a line break, becomes one space, the ends trim,
 * and a code span keeps its delimiters while its own boundary whitespace goes. The guide's side
 * and the source's side read through this one form.
 *
 * @remarks
 * The clauses land in a fixed order, because each one decides what the next one sees. Every
 * single-backtick code span — one backtick per side, no inner backtick, no adjacent backtick —
 * is located first, so a delimiter the `{@link}` expansion inserts afterwards is never mistaken
 * for an authored one. The expansion then runs outside those spans
 * only, so a `{@link}` written inside a code span stays literal on both sides. Whitespace
 * collapses next, which is what makes a span wrapped across two physical lines comparable at
 * all. The boundary trim runs last, inside each located span: the markdown parser strips one
 * space from each end of a code span it reads, and this trim is the symmetric rule that meets
 * it, so `` ` | ` ``, `` ` |` ``, and `` `|` `` all reach `` `|` `` from either side. A span
 * whose content is all whitespace keeps one space, because a parser strips nothing from that
 * one.
 *
 * A target's module part is the inline import form `import('<specifier>').` or the declaration
 * reference form `<module>#`, and the expansion drops it, so a cross-file link and the code
 * token a guide cell documents it with reach the same text. Everything after that part travels:
 * `Owner.member` keeps its owner, and a dotted target no module part precedes is untouched. A
 * label is text rather than a target, so `{@link Target | label}` renders its label whole.
 *
 * A code span delimited by more than one backtick is outside the compared form's representable
 * set and travels untouched, as does a code span whose own text carries a backtick: the form
 * spells every span with one backtick per side, so neither can be written back. A summary that
 * needs one of those constructs takes another shape: name the construct in prose rather than
 * expecting the comparison to converge it.
 *
 * @param text - A doc block's description paragraph, or a guide cell's flattened text
 * @returns The compared form of that text
 *
 * @example
 * ```ts
 * normalizeSummary('Creates a\n{@link Widget}.') // 'Creates a `Widget`.'
 * normalizeSummary("Reads {@link import('./widgets.js').Widget}.") // 'Reads `Widget`.'
 * normalizeSummary('cells joined by ` | `.') // 'cells joined by `|`.'
 * ```
 */
export function normalizeSummary(text: string): string {
	const parts = text.split(/((?<!`)`[^`]+`(?!`))/)
	let normalized = ''

	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index] ?? ''
		if (index % 2 === 0) {
			normalized += part
				.replace(/\{@link\s+[^}|]*\|\s*([^}]*?)\s*\}/g, '`$1`')
				.replace(/\{@link\s+(?:import\([^)]*\)\.|[^}|#\s]*#)?([^}|]*?)\s*\}/g, '`$1`')
			continue
		}
		const value = part.slice(1, -1).replace(/\s+/g, ' ').trim()
		normalized += `\`${value.length === 0 ? ' ' : value}\``
	}

	return normalized.replace(/\s+/g, ' ').trim()
}

/**
 * Wraps one paragraph into greedy lines no longer than `width` characters. Every run of
 * whitespace separates words, and a word longer than `width` takes its own line rather than
 * being split, so a long code token or URL survives the wrap intact.
 *
 * @param text - The paragraph to wrap
 * @param width - The greatest length a returned line may reach
 * @returns The wrapped lines, in order, or an empty list when `text` carries no word
 *
 * @example
 * ```ts
 * wrapText('one two three', 8) // ['one two', 'three']
 * ```
 */
export function wrapText(text: string, width: number): readonly string[] {
	const lines: string[] = []
	let current = ''

	for (const word of text.split(/\s+/)) {
		if (word.length === 0) continue
		if (current.length === 0) current = word
		else if (current.length + 1 + word.length <= width) current += ` ${word}`
		else {
			lines.push(current)
			current = word
		}
	}
	if (current.length > 0) lines.push(current)

	return lines
}

/**
 * Builds one genuine JSDoc span from its content lines — the inverse of {@link unwrapComment}.
 * Each line is emitted at `indent` behind a continuation marker, an empty line as the bare
 * marker so no line carries trailing whitespace, and the leading and trailing empty lines are
 * dropped because the opener and the closer take those physical lines.
 *
 * @param lines - The span's content lines, as {@link unwrapComment} returns them
 * @param indent - The whitespace the span opens at
 * @returns The span's raw text, opener and closer included
 *
 * @example
 * ```ts
 * buildComment(['Walks.'], '') // '/**\n * Walks.\n *' + '/'
 * ```
 */
export function buildComment(lines: readonly string[], indent: string): string {
	const content = [...lines]
	while (content[0] === '') content.shift()
	while (content[content.length - 1] === '') content.pop()

	const raw = [`${indent}/**`]
	for (const line of content) raw.push(line.length === 0 ? `${indent} *` : `${indent} * ${line}`)
	raw.push(`${indent} */`)

	return raw.join('\n')
}

/**
 * Returns one doc block's unwrapped text with every fenced body replaced by aligned spaces,
 * so a tag search reads the block's structure and never its example code. A line opening with
 * three or more backticks or tildes opens a body, the first line opening with a run of the same
 * character at least as long closes it, an unclosed body runs to the end, and the marker lines
 * themselves stay. The projection preserves every line and every column, so an index found in
 * it addresses the same character of the text it was built from.
 *
 * @param text - One doc block's unwrapped text, as {@link normalizeComment} returns it
 * @returns The same text with each fenced body's characters replaced by spaces
 *
 * @example
 * ```ts
 * maskFences('@example\n~~~\n@decorator()\n~~~').split('\n')[2] // '            '
 * ```
 */
export function maskFences(text: string): string {
	const masked: string[] = []
	let marker: string | undefined

	for (const line of text.split('\n')) {
		const fence = /^[ \t]*(`{3,}|~{3,})/.exec(line)?.[1]
		if (marker === undefined) {
			masked.push(line)
			marker = fence
			continue
		}
		const closing = fence !== undefined && fence.startsWith(marker)
		masked.push(closing ? line : ' '.repeat(line.length))
		if (closing) marker = undefined
	}

	return masked.join('\n')
}

/**
 * Extracts every eligible genuine JSDoc block paired with the physical record it documents.
 *
 * @remarks
 * An opener is eligible only when it is the first non-whitespace source material of its record; a
 * leading whitespace-separated span chain is last-span authoritative; intervening source material
 * severs association, while a leading JSDoc on the next record replaces pending state. Any other
 * next physical record is returned once and consumes it. This parser walks aligned records without
 * rescanning source syntax or applying declaration/member grammar, and every reader of a doc
 * block's text — the description paragraph, the `@example` blocks, the member summaries — reads it
 * through this one walk.
 *
 * @param lines - Aligned physical source-line records
 * @returns One record per documented physical line, in source order
 *
 * @example
 * ```ts
 * extractSourceComments(extractSourceLines('/**' + ' Walks. *' + '/\nexport function walk() {}'))
 * // [{ text: 'Walks.', line: the `export function walk() {}` SourceLine }]
 * ```
 */
export function extractSourceComments(lines: readonly SourceLine[]): readonly SourceComment[] {
	const comments: SourceComment[] = []
	let block = false
	let eligible = false
	let span: string[] = []
	let pending: string | undefined

	for (const line of lines) {
		const projection = line.jsdoc
		const first = projection?.indexOf('/**') ?? -1

		if (pending !== undefined) {
			if (!block && first >= 0 && line.source.slice(0, first).trim() === '') pending = undefined
			else {
				comments.push({ text: pending, line })
				pending = undefined
			}
		}

		if (projection === undefined) continue

		let cursor = 0
		if (block) {
			const close = projection.indexOf('*/')
			const end = close < 0 ? projection.length : close + 2
			span.push(projection.slice(0, end))
			if (close < 0) continue

			block = false
			const opener = projection.indexOf('/**', close + 2)
			const endOfGap = opener < 0 ? line.source.length : opener
			const whitespace = line.source.slice(close + 2, endOfGap).trim() === ''
			if (opener < 0) {
				pending = eligible && whitespace ? normalizeComment(span.join('\n')) : undefined
				continue
			}

			eligible = eligible && whitespace
			span = []
			cursor = opener
		} else {
			if (first < 0) continue
			eligible = line.source.slice(0, first).trim() === ''
			span = []
			cursor = first
		}

		while (cursor < projection.length) {
			const close = projection.indexOf('*/', cursor + 2)
			const end = close < 0 ? projection.length : close + 2
			span.push(projection.slice(cursor, end))

			if (close < 0) {
				block = true
				break
			}

			const opener = projection.indexOf('/**', close + 2)
			const endOfGap = opener < 0 ? line.source.length : opener
			const whitespace = line.source.slice(close + 2, endOfGap).trim() === ''
			if (opener < 0) {
				pending = eligible && whitespace ? normalizeComment(span.join('\n')) : undefined
				break
			}

			eligible = eligible && whitespace
			span = []
			cursor = opener
		}
	}

	return comments
}

/**
 * Selects the next physical record after an eligible genuine JSDoc whose final
 * authoritative span carries an `@example` tag opening a line at its first non-blank column —
 * the {@link extractSourceComments} walk filtered to the blocks that carry one. Title
 * text is allowed, and {@link maskFences} keeps a fenced body's own lines out of the search.
 *
 * @param lines - Aligned physical source-line records
 * @returns The immediately following candidate lines, in source order
 *
 * @example
 * ```ts
 * extractExampleLines(extractSourceLines('/**' + ' @example *' + '/\nexport function walk() {}'))
 * // the `export function walk() {}` SourceLine
 * ```
 */
export function extractExampleLines(lines: readonly SourceLine[]): readonly SourceLine[] {
	return extractSourceComments(lines)
		.filter((comment) => /^[ \t]*@example(?=[ \t]|$)/m.test(maskFences(comment.text)))
		.map((comment) => comment.line)
}

/**
 * Collects the description paragraph of every documented physical record — a doc block's
 * text before its first block tag, in {@link normalizeSummary}'s compared form — keyed by the
 * record it documents. A record whose block carries no description contributes no entry, so
 * an absent summary stays absent rather than becoming an empty string.
 *
 * @param lines - Aligned physical source-line records
 * @returns One entry per documented record carrying a description paragraph
 *
 * @example
 * ```ts
 * collectSummaries(extractSourceLines('/**' + ' Walks. *' + '/\nexport function walk() {}')).size // 1
 * ```
 */
export function collectSummaries(lines: readonly SourceLine[]): ReadonlyMap<SourceLine, string> {
	const summaries = new Map<SourceLine, string>()

	for (const comment of extractSourceComments(lines)) {
		const tag = maskFences(comment.text).search(/^[ \t]*@\w/m)
		const summary = normalizeSummary(tag < 0 ? comment.text : comment.text.slice(0, tag))
		if (summary.length > 0) summaries.set(comment.line, summary)
	}

	return summaries
}

/**
 * Extracts the aligned physical records of a declaration's body, read inside an owner head this
 * function supplies, so a callable member in the body carries the `Owner.member` key
 * {@link collectKeys} reports for it, and that head's own record opens the projection. A body
 * read on its own carries no head, and the member grammar attaches a member to the head
 * enclosing it.
 *
 * @remarks
 * The supplied head is an `export interface` line, so the projection opens with that head's own
 * record and every body line follows it in order. A column-zero `}` among the body lines closes
 * the supplied head and leaves every later member unkeyed; a body {@link extractDeclaration}
 * returns carries none, because that reader ends a body at the first one.
 *
 * @param lines - A declaration's body lines
 * @returns The supplied head's record, then one record per body line
 *
 * @example
 * ```ts
 * extractBodyLines(['\twalk(): void'])[1]?.code // '\twalk(): void'
 * ```
 */
export function extractBodyLines(lines: readonly string[]): readonly SourceLine[] {
	return extractSourceLines(['export interface Owner {', ...lines].join('\n'))
}

/**
 * Collects the compared key of every physical record a key names — a {@link computeSymbolKey}
 * symbol key for a column-zero `export` declaration head, an `Owner.member` key for a one-tab
 * callable member inside one — keyed by the record itself. The owner closes at the first
 * column-zero `}` or at a column-zero `export` declaration carrying another keyword, and a
 * record no key names contributes no entry.
 *
 * @remarks
 * This is the package's one key grammar, and each keyed reader projects its own part back out of
 * it: {@link extractExports} splits a declaration key at its one space,
 * {@link extractMemberMethods} and {@link extractExampleMethods} split a member key at its dot,
 * and {@link locateComment} matches a caller's key against the whole map. A change to the head
 * shape or to the member shape reaches every one of them at once.
 *
 * An owner opens at a column-zero `export class` or `export interface` head and closes at the
 * first column-zero `}`, so a member declared past that brace keys nothing. A column-zero `export` declaration carrying any other keyword closes the owner it follows,
 * because a member belongs to the head enclosing it. Reading runs over {@link extractSourceLines}'s
 * projection, so a head or
 * a member written inside a comment or a template literal keys nothing.
 *
 * @param lines - Aligned physical source-line records
 * @returns One entry per record a key names, in file order
 *
 * @example
 * ```ts
 * const keys = collectKeys(extractSourceLines('export class Widget {\n\twalk(): void\n}'))
 * Array.from(keys.values()) // ['class Widget', 'Widget.walk']
 * ```
 */
export function collectKeys(lines: readonly SourceLine[]): ReadonlyMap<SourceLine, string> {
	const keys = new Map<SourceLine, string>()
	let owner: string | undefined

	for (const line of lines) {
		const head = /^export (?:async )?(function\*?|class|const|interface|type) (\w+)/.exec(line.code)
		const keyword = head?.[1]?.replace(/\*$/, '')
		const name = head?.[2]
		if (isNonEmptyString(keyword) && isNonEmptyString(name) && isExportKeyword(keyword)) {
			keys.set(line, computeSymbolKey({ name, keyword }))
			owner = keyword === 'class' || keyword === 'interface' ? name : undefined
			continue
		}
		if (line.code === '}') {
			owner = undefined
			continue
		}
		const member = /^\t(?:async )?\*?(\w+)\??(?:<.*>)?\(/.exec(line.code)?.[1]
		if (owner !== undefined && isNonEmptyString(member)) keys.set(line, `${owner}.${member}`)
	}

	return keys
}

/**
 * Collects the `@example` blocks one doc block's unwrapped text carries, each named for the
 * declaration or member the block documents. The text after the tag becomes the block's
 * `title`; a body opening with a fence contributes that fence's language and its verbatim
 * body, and a body with no fence contributes its own trimmed text as the code.
 *
 * @param comment - One doc block's unwrapped text, as {@link normalizeComment} returns it
 * @param name - The declaration or member the block documents
 * @returns The block's `@example` entries, in block order
 *
 * @example
 * ```ts
 * collectExamples('@example Walking\n```ts\nwalk()\n```', 'walk')
 * // [{ name: 'walk', title: 'Walking', code: 'walk()', language: 'ts' }]
 * ```
 */
export function collectExamples(comment: string, name: string): readonly SourceExample[] {
	const examples: SourceExample[] = []
	const masked = maskFences(comment)
	const tags = /^[ \t]*@example(?=[ \t]|$)[ \t]*(.*)$/gm

	let tag: RegExpExecArray | null
	while ((tag = tags.exec(masked)) !== null) {
		const title = (tag[1] ?? '').trim()
		const start = tag.index + tag[0].length
		const rest = comment.slice(start).replace(/^\n/, '')
		const next = masked
			.slice(start)
			.replace(/^\n/, '')
			.search(/^[ \t]*@\w+/m)
		const body = (next < 0 ? rest : rest.slice(0, next)).replace(/^\n+/, '').replace(/\n+$/, '')
		const fence = /^```(\S*)\n([\s\S]*?)\n?```/.exec(body)
		const language = fence?.[1] ?? ''
		const code = fence?.[2] ?? body

		examples.push({
			name,
			...(title.length === 0 ? {} : { title }),
			code,
			...(language.length === 0 ? {} : { language }),
		})
	}

	return examples
}

/**
 * Extracts the `@example` blocks carried by the exported declaration heads in one file's source
 * text, each named for the declaration its block documents. Shared adjacency comes from
 * {@link extractSourceComments} and each block is read by {@link collectExamples}; head
 * membership is the {@link collectKeys} key of the documented record under every keyword that
 * grammar admits at column zero, so comment and template payload cannot qualify and the head
 * grammar stays the one every reader here shares. A member key carries a dot and a head key
 * does not, so a member's block belongs to {@link extractExampleMethods} instead. A head
 * carrying several blocks contributes each.
 *
 * @param source - The file's source text
 * @returns The exported declaration heads' `@example` blocks, in file order, deduplicated by name and title
 *
 * @example
 * ```ts
 * const block = ['/**', ' * @example', ' * new Widget()', ' *' + '/', 'export class Widget {}', ''].join('\n')
 * extractExamples(block) // [{ name: 'Widget', code: 'new Widget()' }]
 * extractExamples('export class Widget {}\n') // []
 * ```
 */
export function extractExamples(source: string): readonly SourceExample[] {
	const examples: SourceExample[] = []
	const seen = new Set<string>()
	const lines = extractSourceLines(source)
	const keys = collectKeys(lines)

	for (const comment of extractSourceComments(lines)) {
		// A head key is `${keyword} ${name}` and a member key is `Owner.member`, so the dot is
		// what separates them and the block's name is the text past the head's one space.
		const key = keys.get(comment.line)
		if (key === undefined || key.includes('.')) continue

		const name = key.slice(key.indexOf(' ') + 1)
		for (const example of collectExamples(comment.text, name)) {
			const entry = `${name}\n${example.title ?? ''}`
			if (seen.has(entry)) continue
			seen.add(entry)
			examples.push(example)
		}
	}

	return examples
}

/**
 * Extracts the `@example` blocks carried by the callable members of a declaration body (per
 * {@link collectKeys}' grammar, the same one {@link extractMemberMethods} reads), each named for
 * the member its block documents. Shared adjacency comes from {@link extractSourceComments} and
 * each block is read by {@link collectExamples}; member membership is the key
 * {@link extractBodyLines}'s projection gives the documented record.
 *
 * @param lines - A declaration's body lines
 * @returns The members' `@example` blocks, deduplicated by name and title and sorted by name
 *
 * @example
 * ```ts
 * extractExampleMethods(['\t/**', '\t * @example', '\t * walk()', '\t *' + '/', '\twalk(): void'])
 * // [{ name: 'walk', code: 'walk()' }]
 * ```
 */
export function extractExampleMethods(lines: readonly string[]): readonly SourceExample[] {
	const examples: SourceExample[] = []
	const seen = new Set<string>()
	const projected = extractBodyLines(lines)
	const keys = collectKeys(projected)

	for (const comment of extractSourceComments(projected)) {
		const key = keys.get(comment.line) ?? ''
		const dot = key.indexOf('.')
		if (dot < 0) continue

		const name = key.slice(dot + 1)
		for (const example of collectExamples(comment.text, name)) {
			const entry = `${name}\n${example.title ?? ''}`
			if (seen.has(entry)) continue
			seen.add(entry)
			examples.push(example)
		}
	}

	return examples.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1))
}

/**
 * Extracts every fenced code block anywhere in the guide document. A full AST walk
 * includes fences nested inside blockquotes and lists, and the same walk carries each
 * fence's nearest preceding heading as its `title` — the key an `@example` block pairs on.
 * A heading's text is flattened, so a title written with a code span pairs with a plain
 * `@example` title.
 *
 * @param document - The parsed guide document
 * @returns Every fence's language, verbatim code, and title, in document order
 *
 * @example
 * ```ts
 * extractFences(document) // [{ language: 'ts', code: "import { X } from './x.js'\nX()" }]
 * ```
 */
export function extractFences(document: MarkdownDocument): readonly GuideFence[] {
	return Array.from(collectFences(document).values())
}

/**
 * Collects each fenced code block keyed by its own node, paired with the {@link GuideFence}
 * {@link extractFences} reports for it — the node-addressed form a rewrite needs, so a caller
 * that located a fence by title can read that node's source region back from the parser. The map
 * iterates in document order and a node keys itself, so a repeated identical fence keeps its own
 * entry.
 *
 * @param document - The parsed guide document
 * @returns One entry per fenced code block, in document order
 *
 * @example
 * ```ts
 * Array.from(collectFences(document).values()) // [{ language: 'ts', code: 'walk()' }]
 * ```
 */
export function collectFences(document: MarkdownDocument): ReadonlyMap<CodeBlockNode, GuideFence> {
	const fences = new Map<CodeBlockNode, GuideFence>()
	let title = ''

	for (const node of walkNodes(document)) {
		if (isHeadingNode(node)) {
			title = flattenText(node).trim()
			continue
		}
		if (isCodeBlockNode(node)) {
			fences.set(node, {
				language: node.lang,
				code: node.code,
				...(title.length === 0 ? {} : { title }),
			})
		}
	}

	return fences
}

/**
 * Extracts the guide's tagline — the text of the blockquote following the document's H1,
 * with every code span kept as a code span and whitespace collapsed. A heading before the
 * blockquote ends the window, so a blockquote elsewhere in the document is not the tagline.
 *
 * @param document - The parsed guide document
 * @returns The tagline, or `undefined` when no blockquote follows an H1 before the next heading
 *
 * @example
 * ```ts
 * extractTagline(document) // 'A pure, I/O-free guides-parity toolkit'
 * ```
 */
export function extractTagline(document: MarkdownDocument): string | undefined {
	let opened = false

	for (const block of document.children) {
		if (isHeadingNode(block)) {
			if (opened) return undefined
			opened = block.level === 1
			continue
		}
		if (!opened || !isBlockquoteNode(block)) continue

		const text = normalizeSummary(
			block.children
				.filter(isParagraphNode)
				.map((paragraph) => extractCellText(paragraph.children))
				.join(' '),
		)
		return text.length === 0 ? undefined : text
	}

	return undefined
}

/**
 * Computes the drift between one compared key's guide text and source text. A pair agrees
 * only when both sides carry the same text, and every other state is a drift: guide text
 * alone reports the guide's side, source text alone reports the source's, and neither side
 * carrying text reports the key by itself. A side carrying no text is absent from the result,
 * so a documented symbol with no doc block reports as a drift naming the guide's text alone,
 * and a row a table has no `Summary` column for against a declaration with no doc block
 * reports as `{ key }`.
 *
 * @param key - The compared pair's key
 * @param guide - The guide's text there, or `undefined` when it carries none
 * @param source - The source's text there, or `undefined` when it carries none
 * @returns The drift, or `undefined` when both sides carry the same text
 *
 * @example
 * ```ts
 * computeDrift('function walk', 'Walks the tree.', 'Walks a tree.')
 * // { key: 'function walk', guide: 'Walks the tree.', source: 'Walks a tree.' }
 * ```
 */
export function computeDrift(
	key: string,
	guide: string | undefined,
	source: string | undefined,
): Drift | undefined {
	if (guide !== undefined && guide === source) return undefined
	return {
		key,
		...(guide === undefined ? {} : { guide }),
		...(source === undefined ? {} : { source }),
	}
}

/**
 * Finds every disagreement between a guide and the source it documents, naming both sites:
 * each `## Surface` row against its declaration's description paragraph, each `## Methods`
 * row against its member's, and the first titled guide fence of a heading against the
 * `@example` block of the same title. An example's compared text is its language on the first
 * line and its body beneath, so a fence that names another language drifts on its own.
 *
 * @remarks
 * Only a pair present on both sides is compared, so a symbol, a member, or a title one side
 * lacks entirely is left to the bijection checks that own it and is never reported twice.
 * {@link computeDrift} rules each compared pair, so a pair whose sides carry different text, a
 * pair where one side carries none, and a pair where neither side carries text are all drift.
 * The pairing is per title across the whole document, not per heading: the first fence a title
 * reaches is the compared one, and every later fence of that title is outside the comparison,
 * whether it sits under the same heading or under a second heading of the same text.
 *
 * @param guide - The parsed guide
 * @param source - The reflected source the guide documents
 * @returns One entry per disagreement: Surface rows, then Methods rows, then examples
 *
 * @example
 * ```ts
 * findDrift(guide, source) // [{ key: 'function walk', guide: 'Walks.', source: 'Walks a tree.' }]
 * ```
 */
export function findDrift(guide: GuideInterface, source: SourceInterface): readonly Drift[] {
	const drifts: Drift[] = []
	const declared = new Map(source.surface().map((symbol) => [computeSymbolKey(symbol), symbol]))

	for (const symbol of guide.surface()) {
		const key = computeSymbolKey(symbol)
		const match = declared.get(key)
		if (match === undefined) continue
		const drift = computeDrift(key, symbol.summary, match.summary)
		if (drift !== undefined) drifts.push(drift)
	}

	for (const group of guide.methods()) {
		const members = new Map(source.methods(group.interface).map((entry) => [entry.name, entry]))
		for (const entry of group.methods) {
			const member = members.get(entry.name)
			if (member === undefined) continue
			const drift = computeDrift(`${group.interface}.${entry.name}`, entry.summary, member.summary)
			if (drift !== undefined) drifts.push(drift)
		}
	}

	const examples = collectTitles(guide, source)
	const compared = new Set<string>()
	for (const fence of guide.fences()) {
		if (fence.title === undefined || compared.has(fence.title)) continue
		compared.add(fence.title)
		const example = examples.get(fence.title)
		if (example === undefined) continue
		const drift = computeDrift(
			fence.title,
			`${fence.language ?? ''}\n${fence.code}`,
			`${example.language ?? ''}\n${example.code}`,
		)
		if (drift !== undefined) drifts.push(drift)
	}

	return drifts
}

/**
 * Collects the titled `@example` blocks a guide's documented surface reaches — the module's
 * exported declaration heads, plus the own members of every documented `class` and `interface` —
 * keyed by title, the first block of a title answering for it.
 *
 * @param guide - The parsed guide naming the documented declarations
 * @param source - The reflected source to read the blocks from
 * @returns One entry per distinct `@example` title
 *
 * @example
 * ```ts
 * collectTitles(guide, source).get('Walk a tree') // { name: 'walk', title: 'Walk a tree', code: 'walk()' }
 * ```
 */
export function collectTitles(
	guide: GuideInterface,
	source: SourceInterface,
): ReadonlyMap<string, SourceExample> {
	const titled = new Map<string, SourceExample>()
	const owners = guide
		.surface()
		.filter((symbol) => symbol.keyword === 'class' || symbol.keyword === 'interface')
	const examples = [
		...source.examples(),
		...owners.flatMap((symbol) => source.examples(symbol.name)),
	]

	for (const example of examples) {
		if (example.title === undefined || titled.has(example.title)) continue
		titled.set(example.title, example)
	}

	return titled
}

/**
 * Builds a copy of `table` with one cell's inline content rebuilt from `text` through
 * {@link buildCell}. Every other cell keeps its own nodes, so a rewrite touches the one cell it
 * names and the header and the alignment row travel unchanged.
 *
 * @param table - The table to copy
 * @param row - The index of the row to rewrite within {@link TableNode.rows}
 * @param column - The index of the cell to rewrite within that row
 * @param text - The cell's new compared text
 * @returns The rewritten table
 *
 * @example
 * ```ts
 * buildTable(table, 0, 2, 'Walks the tree.').rows[0]?.[2] // [{ element: 'text', value: 'Walks the tree.' }]
 * ```
 */
export function buildTable(table: TableNode, row: number, column: number, text: string): TableNode {
	return {
		element: 'table',
		header: table.header,
		rows: table.rows.map((cells, index) =>
			index === row
				? cells.map((cell, position) => (position === column ? buildCell(text) : cell))
				: cells,
		),
		align: table.align,
	}
}

/**
 * Builds the fenced code block one `@example` block renders as — its code inside a fence
 * carrying its language, and an untagged fence when the block names none.
 *
 * @param example - The block to render
 * @returns The fence node
 *
 * @example
 * ```ts
 * buildFence({ name: 'walk', code: 'walk()', language: 'ts' }) // { element: 'codeBlock', code: 'walk()', lang: 'ts' }
 * ```
 */
export function buildFence(example: SourceExample): CodeBlockNode {
	return {
		element: 'codeBlock',
		code: example.code,
		...(example.language === undefined ? {} : { lang: example.language }),
	}
}

/**
 * Splices `replacement` into `source` over the region `span` addresses, and returns the result.
 * The text before the region and the text after it travel byte for byte, so a rewrite that
 * addresses one node's region changes nothing else in the document.
 *
 * @param source - The text to rewrite
 * @param span - The half-open region to replace: the region `MarkdownInterface.span` reports
 * for a markdown node, or the one {@link locateComment} reports for a doc block
 * @param replacement - The text to write over that region
 * @returns The rewritten text
 *
 * @example
 * ```ts
 * spliceSpan('one two three', { start: 4, end: 7 }, 'TWO') // 'one TWO three'
 * ```
 */
export function spliceSpan(source: string, span: MarkdownSpan, replacement: string): string {
	return source.slice(0, span.start) + replacement + source.slice(span.end)
}

/**
 * Renders a `## Surface` table from the symbols a source declares — a `Name`, {@link KIND}, and
 * {@link SUMMARY} table with one row per symbol, the name as a code span, the keyword as its
 * text, and the summary through {@link buildCell}. A symbol carrying no summary renders an empty
 * cell, which {@link extractSurface} reads back as an absent summary.
 *
 * @remarks
 * The render carries no `## Surface` heading, because a guide documents its surface in several
 * tables under their own sub-headings and one of them is what this function produces. Reading the
 * render back therefore parses it under that heading. `renderMarkdown` pads every cell to one
 * space, so the render is not the committed column-aligned bytes; the checkout's formatter
 * re-aligns the table and the reader compares parsed entries rather than bytes.
 *
 * @param symbols - The symbols to document, in row order
 * @returns The table's markdown source, with no trailing newline
 *
 * @example
 * ```ts
 * renderSurface([{ name: 'walk', keyword: 'function', summary: 'Walks the tree.' }])
 * // '| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks the tree. |'
 * ```
 */
export function renderSurface(symbols: readonly SurfaceSymbol[]): string {
	return renderMarkdown({
		element: 'table',
		header: [
			[{ element: 'text', value: 'Name' }],
			[{ element: 'text', value: KIND }],
			[{ element: 'text', value: SUMMARY }],
		],
		rows: symbols.map((symbol) => [
			[{ element: 'codeSpan', value: symbol.name }],
			[{ element: 'text', value: symbol.keyword }],
			buildCell(symbol.summary ?? ''),
		]),
		align: [null, null, null],
	})
}

/**
 * Renders one `## Methods` group — the `####` heading naming the interface as a code span, then
 * a `Name` and {@link SUMMARY} table with one row per documented member. A member carrying no
 * summary renders an empty cell, which {@link extractMethods} reads back as an absent summary.
 *
 * @remarks
 * The render carries no `## Methods` heading, for the reason {@link renderSurface} states:
 * a guide documents one group per interface under that one section heading.
 *
 * @param group - The interface and its members
 * @returns The heading and table's markdown source, with no trailing newline
 *
 * @example
 * ```ts
 * renderMethods({ interface: 'WidgetInterface', methods: [{ name: 'walk', summary: 'Walks.' }] })
 * // '#### `WidgetInterface`\n\n| Name | Summary |\n| --- | --- |\n| `walk` | Walks. |'
 * ```
 */
export function renderMethods(group: MethodGroup): string {
	return renderMarkdown({
		element: 'document',
		children: [
			{ element: 'heading', level: 4, children: [{ element: 'codeSpan', value: group.interface }] },
			{
				element: 'table',
				header: [[{ element: 'text', value: 'Name' }], [{ element: 'text', value: SUMMARY }]],
				rows: group.methods.map((entry) => [
					[{ element: 'codeSpan', value: entry.name }],
					buildCell(entry.summary ?? ''),
				]),
				align: [null, null],
			},
		],
	})
}

/**
 * Renders one `@example` block as the guide fence it pairs with — an H3 heading carrying the
 * block's title, then a fence carrying its language and its code. An untitled block renders the
 * fence alone, because a fence pairs on its nearest preceding heading and an untitled block
 * claims none.
 *
 * @remarks
 * The title renders as literal text rather than markdown, so a title carrying backticks or
 * emphasis reads back through {@link extractFences} as the text the `@example` tag carried.
 * The heading level is 3 because a guide documents its examples one level under a `##` section;
 * {@link extractFences} pairs on the nearest preceding heading of any level, so the level is
 * presentation rather than pairing.
 *
 * @param example - The block to render
 * @returns The heading and fence's markdown source, with no trailing newline
 *
 * @example
 * ```ts
 * renderExample({ name: 'walk', title: 'Walk a tree', code: 'walk()', language: 'ts' })
 * // an H3 heading of 'Walk a tree', then a fence tagged `ts` carrying `walk()`
 * ```
 */
export function renderExample(example: SourceExample): string {
	const fence = buildFence(example)
	return renderMarkdown({
		element: 'document',
		children:
			example.title === undefined
				? [fence]
				: [
						{
							element: 'heading',
							level: 3,
							children: [{ element: 'text', value: example.title }],
						},
						fence,
					],
	})
}

/**
 * Replaces one compared cell in a guide's text and returns the whole guide back. `key` names the
 * row the way {@link findDrift} names it — a {@link computeSymbolKey} key for a `## Surface` row,
 * an `Owner.member` key for a `## Methods` row — and the row's {@link SUMMARY} cell becomes
 * `summary`. Only the table's own source region is rewritten, so every byte outside it travels
 * unchanged; a key reaching no cell returns `undefined`, and a row already carrying the summary
 * returns the guide byte for byte.
 *
 * @remarks
 * A row the key does not reach, a table carrying no {@link SUMMARY} column, and a document whose
 * parse recorded no region for the table are each a miss, and a miss returns `undefined` rather
 * than throwing, so a caller reports the key it could not place — the one meaning `undefined`
 * carries in every replacer here. A row already carrying `summary` returns the guide byte for
 * byte, because a rewrite would re-pad the whole table for no change; that identity reads both
 * sides through {@link normalizeSummary}, so a caller passing text the compared form still moves
 * is a fixed point on the second run rather than a row rewritten forever. The rewritten table
 * renders one-space padded whatever padding it carried, so the checkout's formatter re-aligns it.
 *
 * @param guide - The guide's markdown source
 * @param key - The compared key naming the row
 * @param summary - The row's new compared text
 * @returns The guide's text with that cell replaced, or `undefined` when the key reaches no cell
 *
 * @example
 * ```ts
 * replaceCell('## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks. |', 'function walk', 'Walks a tree.')
 * // '## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks a tree. |'
 * ```
 */
export function replaceCell(guide: string, key: string, summary: string): string | undefined {
	const markdown = createMarkdown(guide)
	const document = markdown.document
	let located: TableNode | undefined
	let index = -1

	for (const block of selectSectionBlocks(document, SURFACE)) {
		if (located !== undefined || !isTableNode(block)) continue
		for (let row = 0; row < block.rows.length && located === undefined; row += 1) {
			const symbol = extractRowSymbol(block, row)
			if (symbol === undefined || computeSymbolKey(symbol) !== key) continue
			located = block
			index = row
		}
	}

	for (const [table, owner] of collectGroups(document)) {
		if (located !== undefined) break
		for (let row = 0; row < table.rows.length && located === undefined; row += 1) {
			const entry = extractRowEntry(table, row)
			if (entry === undefined || `${owner}.${entry.name}` !== key) continue
			located = table
			index = row
		}
	}

	if (located === undefined) return undefined
	const column = findColumnIndex(located, SUMMARY)
	if (column === undefined) return undefined
	if ((extractRowSummary(located, index) ?? '') === normalizeSummary(summary)) return guide

	const span = markdown.span(located)
	if (span === undefined) return undefined
	return spliceSpan(guide, span, renderMarkdown(buildTable(located, index, column, summary)))
}

/**
 * Replaces one titled fence in a guide's text and returns the whole guide back. The first fence
 * carrying `title` — the pairing {@link findDrift} compares on — takes `example`'s language and
 * code. Only the fence's own source region is rewritten, so every byte outside it travels
 * unchanged; a title no fence carries returns `undefined`, and a fence already carrying that
 * body returns the guide byte for byte.
 *
 * @remarks
 * A title no fence carries and a document whose parse recorded no region for the fence are each a
 * miss, and a miss returns `undefined` rather than throwing — the one meaning `undefined` carries
 * in every replacer here. A fence already carrying that language and code returns the guide
 * byte for byte. A later fence of the same title is outside the pairing and is never rewritten,
 * which is the rule {@link findDrift} compares under.
 *
 * @param guide - The guide's markdown source
 * @param title - The heading text the fence pairs on
 * @param example - The block whose language and code the fence takes
 * @returns The guide's text with that fence replaced, or `undefined` when no fence carries the title
 *
 * @example
 * ```ts
 * replaceFence(guide, 'Walk', { name: 'walk', title: 'Walk', code: 'walk()', language: 'ts' })
 * // the guide's text with the fence under its `### Walk` heading carrying `walk()`
 * ```
 */
export function replaceFence(
	guide: string,
	title: string,
	example: SourceExample,
): string | undefined {
	const markdown = createMarkdown(guide)
	let located: CodeBlockNode | undefined
	let current: GuideFence | undefined

	for (const [node, fence] of collectFences(markdown.document)) {
		if (located !== undefined || fence.title !== title) continue
		located = node
		current = fence
	}

	if (located === undefined || current === undefined) return undefined
	if (current.code === example.code && current.language === example.language) return guide

	const span = markdown.span(located)
	if (span === undefined) return undefined
	return spliceSpan(guide, span, renderMarkdown(buildFence(example)))
}

/**
 * Replaces one doc block's description paragraph with `summary` and returns the whole block back.
 * The paragraph is the block's text before its first block tag, and it re-wraps inside `width`;
 * the blank line before the first tag, every tag line, the block's indentation, and its
 * continuation markers all survive. A block already carrying the summary returns byte for byte,
 * and a text that is no doc block and a summary carrying no word each return `undefined`.
 *
 * @remarks
 * A miss returns `undefined`, the one meaning `undefined` carries in every replacer here, so a
 * caller reports the block it could not rewrite. Text that opens with no
 * `/**` is no doc block: a single-star `/*` comment reaches this function only by a caller's
 * mistake, and reshaping it into a doc block would be a silent edit. A `summary` carrying no word
 * names no paragraph to write, and deleting the block's description on that argument would erase
 * documentation on the strength of an absent value — a caller with nothing to write writes
 * nothing.
 *
 * A block already carrying `summary` returns byte for byte, which is what keeps a propagation
 * that finds no drift from rewriting the file: a doc block's own wrapping is not recoverable from
 * its text, so re-wrapping an unchanged paragraph would move most blocks this package's source
 * carries. That identity reads both sides through {@link normalizeSummary}, and it holds for a
 * block carrying no tag as much as for a block carrying several. A block written on one physical
 * line stays on one line while `summary` still fits inside `width`, and expands otherwise.
 *
 * `width` counts characters from the line's first, a tab counting as one, so a wrapped line reads
 * `${indent} * ${text}` and never passes that count. A caller whose formatter measures a tab as
 * more than one column passes a smaller width rather than taking the default.
 *
 * @param comment - One complete genuine JSDoc span's raw text, as it sits in the file
 * @param summary - The block's new description paragraph
 * @param width - The character budget a re-wrapped line stays inside. Default: {@link WRAP_WIDTH}
 * @returns The block's raw text with that paragraph replaced, or `undefined` for a text that is
 * no doc block and for a `summary` carrying no word
 *
 * @example
 * ```ts
 * replaceSummary('/**' + ' Walks. *' + '/', 'Walks a tree.') // '/**' + ' Walks a tree. *' + '/'
 * ```
 */
export function replaceSummary(
	comment: string,
	summary: string,
	width: number = WRAP_WIDTH,
): string | undefined {
	if (!/^[ \t]*\/\*\*/.test(comment)) return undefined
	const content = unwrapComment(comment)
	const indent = /^[ \t]*/.exec(comment)?.[0] ?? ''
	const wrapped = wrapText(summary, width - indent.length - 3)
	if (wrapped.length === 0) return undefined

	const masked = maskFences(content.join('\n')).split('\n')
	let tag = -1
	for (let index = 0; index < masked.length && tag < 0; index += 1) {
		if (/^[ \t]*@\w/.test(masked[index] ?? '')) tag = index
	}

	const described = content.slice(0, tag < 0 ? content.length : tag).join('\n')
	if (normalizeSummary(described) === normalizeSummary(summary)) return comment

	const tail = tag < 0 ? [] : content.slice(tag)
	if (tail.length === 0 && wrapped.length === 1 && content.length === 1) {
		const single = `${indent}/** ${wrapped[0] ?? ''} */`
		if (single.length <= width) return single
	}

	const lines = [...wrapped]
	if (tail.length > 0) lines.push('')
	return buildComment([...lines, ...tail], indent)
}

/**
 * Replaces the body of one titled `@example` tag in a doc block's raw text and returns the whole
 * block back. The tag carrying `example`'s title takes a fence of its language and its code;
 * every other tag, the description paragraph, the block's indentation, and its continuation
 * markers all survive. A text that is no doc block, a title no tag carries, and a language or
 * code the emitted three-backtick fence cannot enclose or the doc block cannot hold each return
 * `undefined`.
 *
 * @remarks
 * A miss returns `undefined`, the one meaning `undefined` carries in every replacer here, so a
 * caller reports the block it could not rewrite. Text that opens with no
 * `/**` is no doc block, for the reason {@link replaceSummary} states. A block carrying no
 * `@example` tag of that title has nowhere to write, so an untitled tag and a tag carrying
 * another title are each left alone, and an `example` naming no title misses a block whose tags
 * all carry one. Code carrying a run of three or more backticks is a body the emitted fence
 * cannot enclose: the fence is three backticks, {@link maskFences} ends a body at the first line
 * opening a run at least as long, and {@link collectExamples} reads to the first such run
 * whatever column it sits at, so writing that body would truncate it and turn a following
 * `@`-line into a tag. A language or code carrying the doc-comment terminator is a body the
 * block itself cannot hold: the terminator closes the block where it lands and the file stops
 * parsing there. Refusing keeps the rewrite total over the bodies it can spell.
 *
 * A tag already carrying that language and code returns byte for byte. {@link maskFences} keeps
 * the current body's own lines out of the tag search, so a fenced body carrying a tag-shaped line
 * does not end the body early. The body ends at its last line carrying text, so the blank line
 * separating it from the next tag survives.
 *
 * @param comment - One complete genuine JSDoc span's raw text, as it sits in the file
 * @param example - The block whose language and code the tag's body takes
 * @returns The block's raw text with that body replaced, or `undefined` for a text that is no
 * doc block, for a title no `@example` tag carries, and for a language or code the emitted
 * fence cannot enclose or the doc block cannot hold — a body carrying the doc-comment terminator
 *
 * @example
 * ```ts
 * replaceExample('/**' + '\n * @example Walk\n * old()\n *' + '/', { name: 'walk', title: 'Walk', code: 'walk()', language: 'ts' })
 * // the same block, its `@example Walk` body now a fence tagged `ts` carrying `walk()`
 * ```
 */
export function replaceExample(comment: string, example: SourceExample): string | undefined {
	if (!/^[ \t]*\/\*\*/.test(comment)) return undefined
	const spelled = [example.language ?? '', ...example.code.split('\n')]
	if (spelled.some((line) => line.includes('```') || line.includes('*/'))) return undefined
	const content = unwrapComment(comment)
	const masked = maskFences(content.join('\n')).split('\n')
	const title = example.title ?? ''
	let start = -1

	for (let index = 0; index < masked.length && start < 0; index += 1) {
		const tag = /^[ \t]*@example(?=[ \t]|$)[ \t]*(.*)$/.exec(masked[index] ?? '')
		if (tag !== null && (tag[1] ?? '').trim() === title) start = index
	}
	if (start < 0) return undefined

	const current = collectExamples(content.join('\n'), example.name).find(
		(entry) => (entry.title ?? '') === title,
	)
	if (
		current !== undefined &&
		current.code === example.code &&
		current.language === example.language
	) {
		return comment
	}

	let end = content.length
	for (let index = start + 1; index < masked.length && end === content.length; index += 1) {
		if (/^[ \t]*@\w/.test(masked[index] ?? '')) end = index
	}
	while (end > start + 1 && (content[end - 1] ?? '').length === 0) end -= 1

	const indent = /^[ \t]*/.exec(comment)?.[0] ?? ''
	const body = [`\`\`\`${example.language ?? ''}`, ...example.code.split('\n'), '```']
	return buildComment([...content.slice(0, start + 1), ...body, ...content.slice(end)], indent)
}

/**
 * Locates the doc block a compared key attaches to inside one file's text and returns the block's
 * own character region, so a caller can `slice` the block, rewrite it through
 * {@link replaceSummary} or {@link replaceExample}, and write the result back through
 * {@link spliceSpan}. `key` names the pair the way {@link findDrift} names it — a
 * {@link computeSymbolKey} key for a declaration, an `Owner.member` key for an interface or class
 * member; the region covers the block's own indentation, and no block carrying the key returns
 * `undefined`.
 *
 * @remarks
 * Attachment is {@link extractSourceComments}'s, not a second reading of the file: that walk
 * pairs each eligible block with the physical record it documents, and this function keeps the
 * record {@link collectKeys} gives `key`. The keys are that one grammar's — the map
 * {@link extractExports} and {@link extractMemberMethods} each read their own part out of — so
 * this function runs no head pattern, no member pattern, and no owner-close rule of its own, and
 * a change to any of them reaches the locator too. Every block {@link collectSummaries} reports
 * a summary for is reachable by its key, and a block carrying only block tags is reachable too although it carries no summary.
 * A block it misses is one the comparison never had: a block a blank line separates from its
 * declaration attaches to the blank line, and a block written inside a template literal or a
 * string is no genuine span at all. The first block whose record carries the key answers for it,
 * as the first declaration of a name does everywhere else.
 *
 * The region runs from the start of the opener's line, the block's indentation included, to the
 * character past its closing marker — the raw text {@link replaceSummary} and
 * {@link replaceExample} each document as the span "as it sits in the file", so a caller slices,
 * rewrites, and splices with no adjustment and the rewrite keeps the indentation it found. A
 * block that source material precedes on its own line starts at the opener instead. The region
 * is read off the aligned JSDoc projection rather than searched for in the text, so an opener
 * written inside a string never yields one, and line offsets come from
 * {@link extractSourceLines}'s own records under its stated LF-or-CRLF terminator rule, so a
 * CRLF file reports the offsets its own bytes carry.
 *
 * @param text - One file's whole source text
 * @param key - The compared key naming the declaration or the member
 * @returns The block's half-open character region, or `undefined` when no block carries the key
 *
 * @example
 * ```ts
 * const text = '/**' + ' Walks. *' + '/\nexport function walk(): void {}\n'
 * locateComment(text, 'function walk') // { start: 0, end: 13 }
 * ```
 */
export function locateComment(text: string, key: string): MarkdownSpan | undefined {
	const lines = extractSourceLines(text)
	const keys = collectKeys(lines)
	const offsets: number[] = []
	const positions = new Map<SourceLine, number>()
	let offset = 0

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]
		if (line === undefined) continue
		offsets.push(offset)
		positions.set(line, index)
		const after = offset + line.source.length
		offset = after + (text.startsWith('\r\n', after) ? 2 : 1)
	}

	for (const comment of extractSourceComments(lines)) {
		if (keys.get(comment.line) !== key) continue
		const close = (positions.get(comment.line) ?? 0) - 1
		const closing = lines[close]?.jsdoc
		const end = closing === undefined ? -1 : closing.lastIndexOf('*/')
		if (end < 0) continue

		let first = close
		while (first > 0 && lines[first - 1]?.jsdoc !== undefined) first -= 1

		// The run's spans are read forward, because an opener written inside a span — an
		// `@example` quoting one — is body text rather than a second block, and a backward
		// search would stop at it. The authoritative span is the last one the run opens.
		let inside = false
		let line = -1
		let column = -1
		for (let index = first; index <= close; index += 1) {
			const projection = lines[index]?.jsdoc ?? ''
			let cursor = 0
			while (cursor < projection.length) {
				const at = projection.indexOf(inside ? '*/' : '/**', cursor)
				if (at < 0) break
				if (!inside) {
					line = index
					column = at
				}
				cursor = at + (inside ? 2 : 3)
				inside = !inside
			}
		}
		if (line < 0) continue

		const source = lines[line]?.source ?? ''
		const start = source.slice(0, column).trim() === '' ? 0 : column
		return { start: (offsets[line] ?? 0) + start, end: (offsets[close] ?? 0) + end + 2 }
	}

	return undefined
}
