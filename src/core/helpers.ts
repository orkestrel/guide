import type { BlockNode, InlineNode, MarkdownDocument, TableNode } from '@orkestrel/markdown'
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
	walkNodes,
} from '@orkestrel/markdown'
import { isNonEmptyString } from '@orkestrel/contract'
import { EXTERNAL_SCHEMES, KIND, METHODS, SUMMARY, SURFACE, TESTS } from './constants.js'
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
 * Computes the bijection key for a surface symbol — its keyword and name combined — so a
 * symbol-set comparison diffs (name, keyword) pairs rather than names alone.
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
 * Parses a fence's `import` statements into per-specifier imported identifier
 * names — handles `import type`, mixed multiline braces, and `x as y` aliases,
 * resolving each alias to the exported name `x` because that is the name the
 * checked barrel surface must hold.
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
 * Extracts the link hrefs within one table cell's inline content.
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
 * Extracts the module-scope exports declared in one file's source text — matches
 * `export (async)? (function(\*)?|class|const|interface|type) Name`, deduped
 * by (keyword, name). A generator export (`export function* walk`) scans as the
 * `function` keyword — its trailing `*` is stripped before the
 * {@link ExportKeyword} check.
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
 * extractExports('export class Markdown {}\n') // [{ name: 'Markdown', keyword: 'class' }]
 * extractExports('export function* walk() {}\n') // [{ name: 'walk', keyword: 'function' }]
 * ```
 */
export function extractExports(source: string): readonly SurfaceSymbol[] {
	const symbols: SurfaceSymbol[] = []
	const seen = new Set<string>()
	const lines = extractSourceLines(source)
	const summaries = collectSummaries(lines)

	for (const line of lines) {
		const match = line.code.match(
			/^export (?:async )?(function\*?|class|const|interface|type) (\w+)/,
		)
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
 * Extracts the module-scope declarations lacking the `export` keyword in one file's
 * source text — the mirror image of {@link extractExports}'s grammar, anchored
 * the same way (column 0, so an indented inner declaration never matches).
 * Scans only the {@link ExportKeyword} keywords (`function` / `class` /
 * `const` / `interface` / `type`) — a module-scope `let` or `var` is outside
 * this scanner's declaration-keyword grammar and out of this check's contract.
 * Scanning uses {@link extractSourceLines}, so comment
 * and template payload is excluded while its uninterrupted column-zero head
 * remains required; preserved columns do not widen membership. `enum` is likewise outside this reflection population, not
 * forbidden by general package policy.
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
 * Every caller-supplied name reaches a `RegExp` through this: {@link
 * extractDeclaration} splices it into the head grammar and {@link
 * findUnexampled} into a word-boundary search, so a name carrying `$`, `(`,
 * `[`, or `.` matches that character literally instead of throwing or matching
 * text it does not name. Pure and total; never throws.
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
 * Locates the named `export class` / `export interface` declaration in one
 * file's source text and returns its body lines and its base identifiers read
 * from that one head, so a body and a heritage clause always come from the same
 * declaration.
 *
 * @remarks
 * The head is matched on projected lines (column 0, an oxfmt-wrapped signature
 * joined through {@link joinHead}), with an optional generic parameter list and
 * an optional heritage clause between the identifier and the opening `{`; the
 * identifier matches exactly and is escaped through {@link escapeRegExp}, so a
 * metacharacter in `name` is literal text. The returned body lines are the raw
 * source between that head and the first projected column-zero `}`, keeping
 * JSDoc evidence intact. Every balanced `<...>` span is removed from the head
 * before its `extends` clause is read, so a `T extends Base` type parameter is
 * never a base and `Base<T>` reads as `Base`; a class's `implements` clause and
 * everything after it is excluded, and a qualified base such as
 * `namespace.Base` is returned verbatim. A head that opens no column-zero close
 * is skipped and the scan continues, so a later real declaration still answers.
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
	const opener = `export ${keyword} ${name}`
	const grammar = new RegExp(`^${escapeRegExp(opener)}(?:<.*>)?(?: .*)? \\{$`)
	const lines = extractSourceLines(source)
	const projected = lines.map((line) => line.code)

	for (let index = 0; index < projected.length; index += 1) {
		const line = projected[index]
		if (line === undefined || !line.startsWith(opener)) continue

		const head = joinHead(projected, index)
		if (head === undefined || !grammar.test(head.text)) continue

		let depth = 0
		let flat = ''
		for (const character of head.text.slice(opener.length, -1)) {
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
			return { body: lines.slice(head.end + 1, close).map((record) => record.source), bases }
		}

		// Unterminated body — keep scanning in case a later head closes.
	}

	return undefined
}

/**
 * Selects the member lines declaring a callable member: plain, `async`, generator
 * (`*`), and optional (`records?(`) methods all count; getters, setters,
 * `static` members, and `#` privates never do (their keyword or `#` breaks
 * the `name(` shape). Matching runs once over projected lines so commented
 * method-like payload never becomes eligible. Each member carries its own doc block's
 * description paragraph, read through {@link collectSummaries}; the first declaration of a
 * name answers for it.
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
	const projected = extractSourceLines(lines.join('\n'))
	const summaries = collectSummaries(projected)

	for (const line of projected) {
		const method = line.code.match(/^\t(?:async )?\*?(\w+)\??(<.*>)?\(/)
		const name = method?.[1]
		if (name === undefined || methods.has(name)) continue

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
			const column = findColumnIndex(block, KIND)
			const described = findColumnIndex(block, SUMMARY)
			for (const row of block.rows) {
				const nameCell = row[0]
				const rawName = nameCell === undefined ? undefined : findFirstCode(nameCell)
				const name = rawName === undefined ? undefined : normalizeIdentifier(rawName)
				if (name === undefined) continue

				const kindCell = column === undefined ? undefined : row[column]
				const kindText =
					kindCell === undefined
						? ''
						: flattenText({ element: 'paragraph', children: kindCell }).trim()
				if (!isExportKeyword(kindText)) continue

				const summaryCell = described === undefined ? undefined : row[described]
				const summary =
					summaryCell === undefined ? '' : normalizeSummary(extractCellText(summaryCell))
				const symbol: SurfaceSymbol = {
					name,
					keyword: kindText,
					...(summary.length === 0 ? {} : { summary }),
				}
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
	let current: string | undefined

	for (const block of selectSectionBlocks(document, METHODS)) {
		if (isHeadingNode(block) && block.level === 4) {
			const rawInterface = findFirstCode(block.children)
			current = rawInterface === undefined ? undefined : normalizeIdentifier(rawInterface)
			continue
		}

		if (isTableNode(block) && current !== undefined) {
			const methods: MethodEntry[] = []
			const described = findColumnIndex(block, SUMMARY)
			for (const row of block.rows) {
				const cell = row[0]
				const rawName = cell === undefined ? undefined : findFirstCode(cell)
				const name = rawName === undefined ? undefined : normalizeIdentifier(rawName)
				if (name === undefined) continue

				const summaryCell = described === undefined ? undefined : row[described]
				const summary =
					summaryCell === undefined ? '' : normalizeSummary(extractCellText(summaryCell))
				methods.push({ name, ...(summary.length === 0 ? {} : { summary }) })
			}
			groups.push({ interface: current, methods })
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
	const body = /^[ \t]*\/\*([\s\S]*?)\*\/[ \t]*$/.exec(comment)?.[1] ?? comment
	return body
		.split('\n')
		.map((line) => line.replace(/^[ \t]*\*[ \t]?/, '').replace(/[ \t]+$/, ''))
		.join('\n')
		.replace(/^\n+/, '')
		.replace(/\n+$/, '')
}

/**
 * Returns the canonical compared form of a description paragraph — `{@link Target}` and
 * `{@link Target | label}` become the code token of the label or the target text, and every
 * run of whitespace, including a collapsed continuation marker and a line break, becomes one
 * space, with the ends trimmed. A code span stays a code span. The guide's side and the
 * source's side read through this one form.
 *
 * @param text - A doc block's description paragraph, or a guide cell's flattened text
 * @returns The compared form of that text
 *
 * @example
 * ```ts
 * normalizeSummary('Creates a\n{@link Widget}.') // 'Creates a `Widget`.'
 * ```
 */
export function normalizeSummary(text: string): string {
	return text
		.replace(/\{@link\s+[^}|]*\|\s*([^}]*?)\s*\}/g, '`$1`')
		.replace(/\{@link\s+([^}|]*?)\s*\}/g, '`$1`')
		.replace(/\s+/g, ' ')
		.trim()
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
 * An opener is eligible only when it is the first non-whitespace source material of its
 * record; a leading whitespace-separated span chain is last-span authoritative; intervening
 * source material severs association, while a leading JSDoc on the next record replaces
 * pending state. Any other next physical record is returned once and consumes it. This
 * parser walks aligned records without rescanning source syntax or applying
 * declaration/member grammar, and every reader of a doc block's text — the description
 * paragraph, the `@example` blocks, the member summaries — reads it through this one walk.
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
 * Extracts the `@example` blocks carried by the exported functions in one file's source text,
 * each named for the function its block documents. Shared adjacency comes from
 * {@link extractSourceComments} and each block is read by {@link collectExamples};
 * exported-function membership is matched against the aligned code projection, so comment and
 * template payload cannot qualify. A function carrying several blocks contributes each.
 *
 * @param source - The file's source text
 * @returns The exported functions' `@example` blocks, in file order, deduplicated by name and title
 *
 * @example
 * ```ts
 * const block = ['/**', ' * @example', ' * walk()', ' *' + '/', 'export function walk() {}', ''].join('\n')
 * extractExamples(block) // [{ name: 'walk', code: 'walk()' }]
 * extractExamples('export function walk() {}\n') // []
 * ```
 */
export function extractExamples(source: string): readonly SourceExample[] {
	const examples: SourceExample[] = []
	const seen = new Set<string>()

	for (const comment of extractSourceComments(extractSourceLines(source))) {
		const match = comment.line.code.match(/^export (?:async )?function\*? (\w+)/)
		const name = match?.[1]
		if (!isNonEmptyString(name)) continue

		for (const example of collectExamples(comment.text, name)) {
			const key = `${name}\n${example.title ?? ''}`
			if (seen.has(key)) continue
			seen.add(key)
			examples.push(example)
		}
	}

	return examples
}

/**
 * Extracts the `@example` blocks carried by the callable members of a declaration body (per
 * {@link extractMemberMethods}' grammar), each named for the member its block documents.
 * Shared adjacency comes from {@link extractSourceComments} and each block is read by
 * {@link collectExamples}; member membership is matched against aligned projected code.
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

	for (const comment of extractSourceComments(extractSourceLines(lines.join('\n')))) {
		const method = comment.line.code.match(/^\t(?:async )?\*?(\w+)\??(<.*>)?\(/)
		const name = method?.[1]
		if (!isNonEmptyString(name)) continue

		for (const example of collectExamples(comment.text, name)) {
			const key = `${name}\n${example.title ?? ''}`
			if (seen.has(key)) continue
			seen.add(key)
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
	const fences: GuideFence[] = []
	let title = ''

	for (const node of walkNodes(document)) {
		if (isHeadingNode(node)) {
			title = flattenText(node).trim()
			continue
		}
		if (isCodeBlockNode(node)) {
			fences.push({
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
 * exported functions, plus the own members of every documented `class` and `interface` —
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
