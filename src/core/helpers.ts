import type { BlockNode, InlineNode, MarkdownDocument, TableNode } from '@orkestrel/markdown'
import type {
	Declaration,
	DeclarationHead,
	FenceImport,
	GuideFence,
	GuideModule,
	MethodGroup,
	SourceLine,
	SurfaceSymbol,
} from './types.js'
import {
	flattenText,
	isCodeBlockNode,
	isCodeSpanNode,
	isEmphasisNode,
	isHeadingNode,
	isImageNode,
	isLinkNode,
	isTableNode,
	walkNodes,
} from '@orkestrel/markdown'
import { isNonEmptyString } from '@orkestrel/contract'
import { EXTERNAL_SCHEMES, METHODS, SURFACE, TESTS } from './constants.js'
import { isExportKind } from './validators.js'

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
 * The stable cache key for a {@link GuideModule}. Directories normalize before
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
 * computeSymbolKey({ name: 'Markdown', kind: 'class' }) // 'class Markdown'
 * ```
 */
export function computeSymbolKey(symbol: SurfaceSymbol): string {
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
 * The fences whose language is absent from the caller's listed languages.
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
 * The symbol-key set-difference between two symbol lists — `symbols` present but
 * absent from `source`, compared by {@link computeSymbolKey} so a symbol can drift in
 * neither name nor kind.
 *
 * @param symbols - The candidate symbols
 * @param source - The symbols to compare against
 * @returns The symbol keys in `symbols` that are not in `source`
 *
 * @example
 * ```ts
 * findMissingSymbols([{ name: 'X', kind: 'class' }], []) // ['class X']
 * ```
 */
export function findMissingSymbols(
	symbols: readonly SurfaceSymbol[],
	source: readonly SurfaceSymbol[],
): readonly string[] {
	return findMissing(symbols.map(computeSymbolKey), source.map(computeSymbolKey))
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
		const boundary = new RegExp(`\\b${escapeRegExp(name)}\\b`)
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
 * The link hrefs found within one table cell's inline content.
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
 * normalizeIdentifier('MarkdownHandler<TNode, T>') // 'MarkdownHandler'
 * normalizeIdentifier('fold')                      // 'fold'
 * ```
 */
export function normalizeIdentifier(code: string): string {
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
 * findKindIndex(table) // 1, or undefined
 * ```
 */
export function findKindIndex(table: TableNode): number | undefined {
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
 * extractExports('export class Markdown {}\n') // [{ name: 'Markdown', kind: 'class' }]
 * extractExports('export function* walk() {}\n') // [{ name: 'walk', kind: 'function' }]
 * ```
 */
export function extractExports(source: string): readonly SurfaceSymbol[] {
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
 * source text — the mirror image of {@link extractExports}'s grammar, anchored
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
 * extractHidden('function secretHelper() {}\n') // [{ name: 'secretHelper', kind: 'function' }]
 * extractHidden('export class X {}\n') // []
 * ```
 */
export function extractHidden(source: string): readonly SurfaceSymbol[] {
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
	keyword: 'class' | 'interface',
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
 * extractMemberMethods(['\tmap(): void', '\tfilter(): void']) // ['filter', 'map']
 * ```
 */
export function extractMemberMethods(lines: readonly string[]): readonly string[] {
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
 * Every `## Surface` identifier the guide documents — each table row's column 0
 * code span (the name) paired with its `Kind` column (located by header text)
 * UNION every backticked H3 entity heading in the section
 * (`{name: <codeSpan>, kind: 'class'}`), deduped by {@link computeSymbolKey}. A row with
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

	for (const block of selectSectionBlocks(document, SURFACE)) {
		if (isTableNode(block)) {
			const column = findKindIndex(block)
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
				if (!isExportKind(kindText)) continue

				const symbol: SurfaceSymbol = { name, kind: kindText }
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
			const symbol: SurfaceSymbol = { name, kind: 'class' }
			const key = computeSymbolKey(symbol)
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

	for (const block of selectSectionBlocks(document, METHODS)) {
		if (isHeadingNode(block) && block.level === 4) {
			const rawInterface = findFirstCode(block.children)
			current = rawInterface === undefined ? undefined : normalizeIdentifier(rawInterface)
			continue
		}

		if (isTableNode(block) && current !== undefined) {
			const methods: string[] = []
			for (const row of block.rows) {
				const cell = row[0]
				const rawName = cell === undefined ? undefined : findFirstCode(cell)
				const name = rawName === undefined ? undefined : normalizeIdentifier(rawName)
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
	for (const block of selectSectionBlocks(document, TESTS)) {
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
 * extractExamples(block) // ['walk']
 * extractExamples('export function walk() {}\n') // []
 * ```
 */
export function extractExamples(source: string): readonly string[] {
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
 * The callable-member names in a declaration body (per {@link extractMemberMethods}'
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
 * extractExampleMethods(['\t/**', '\t * @example', '\t *' + '/', '\twalk(): void']) // ['walk']
 * ```
 */
export function extractExampleMethods(lines: readonly string[]): readonly string[] {
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
 * Every fenced code block anywhere in the guide document. A full AST walk
 * includes fences nested inside blockquotes and lists.
 *
 * @param document - The parsed guide document
 * @returns Every fence's language and verbatim code, in document order
 *
 * @example
 * ```ts
 * extractFences(document) // [{ language: 'ts', code: "import { X } from './x.js'\nX()" }]
 * ```
 */
export function extractFences(document: MarkdownDocument): readonly GuideFence[] {
	const fences: GuideFence[] = []
	for (const node of walkNodes(document)) {
		if (isCodeBlockNode(node)) fences.push({ language: node.lang, code: node.code })
	}
	return fences
}
