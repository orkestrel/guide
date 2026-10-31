import type {
	BlockNode,
	BlockquoteNode,
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
	ParityFinding,
	SourceComment,
	SourceExample,
	SourceInterface,
	SourceLine,
	SourceProjection,
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
	walkMarkdownNodes,
} from '@orkestrel/markdown'
import { escapeRegExp, isNonEmptyString, isString } from '@orkestrel/contract'
import {
	EXTERNAL_SCHEMES,
	KIND,
	METHODS,
	NAME,
	SIGNATURE,
	SUMMARY,
	SURFACE,
	SURFACE_HEADER,
	TESTS,
	WRAP_WIDTH,
} from './constants.js'
import { GuideError } from './errors.js'
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
	const tokens: Array<{ readonly code: string; readonly jsdoc?: string }> = []
	const identifier = /#?[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*/uy
	const numeric = /[A-Za-z0-9_$.]+/y
	const final = source.split('').reduce<SourceProjection>(
		(state, character, offset) => {
			if (offset < state.offset) return state
			const next = source[offset + 1]
			const crlf = character === '\r' && next === '\n'
			if (character === '\n' || crlf) {
				const parts = tokens.slice(state.token)
				const code = parts.map((part) => part.code).join('')
				lines.push({
					source: source.slice(state.start, offset),
					code,
					jsdoc:
						state.present || state.jsdoc
							? parts.map((part) => part.jsdoc ?? ' '.repeat(part.code.length)).join('')
							: undefined,
				})
				const regular = state.mode === 'single' || state.mode === 'double'
				const quoted = state.mode === 'templateSingle' || state.mode === 'templateDouble'
				const reset =
					state.mode === 'regex' || state.mode === 'templateLine' || state.mode === 'templateRegex'
				const mode =
					state.mode === 'line'
						? state.line
							? 'templateCode'
							: 'code'
						: state.mode === 'regex'
							? 'code'
							: state.mode === 'templateLine' || state.mode === 'templateRegex'
								? 'templateCode'
								: regular && !state.escaped
									? 'code'
									: quoted && !state.escaped
										? 'templateCode'
										: state.mode
				return {
					...state,
					offset: offset + (crlf ? 2 : 1),
					start: offset + (crlf ? 2 : 1),
					token: tokens.length,
					mode,
					escaped: false,
					regex: reset ? false : state.regex,
					operand:
						state.restricted !== undefined || reset || ((regular || quoted) && !state.escaped)
							? true
							: state.operand,
					member: state.restricted !== undefined ? false : state.member,
					role: state.restricted !== undefined ? undefined : state.role,
					restricted: undefined,
					separated: state.mode !== 'template' ? true : state.separated,
					present: state.jsdoc,
				}
			}
			if (state.mode === 'line' || state.mode === 'templateLine') {
				tokens.push({ code: ' ' })
				return state
			}
			if (state.mode === 'block' || state.mode === 'templateBlock') {
				const closes = character === '*' && next === '/'
				tokens.push({
					code: closes ? '  ' : ' ',
					...(state.jsdoc ? { jsdoc: closes ? '*/' : character } : {}),
				})
				return closes
					? {
							...state,
							offset: offset + 2,
							jsdoc: false,
							mode: state.block ? 'templateCode' : 'code',
						}
					: state
			}
			if (
				state.mode === 'single' ||
				state.mode === 'double' ||
				state.mode === 'templateSingle' ||
				state.mode === 'templateDouble'
			) {
				const template = state.mode === 'templateSingle' || state.mode === 'templateDouble'
				tokens.push({ code: template ? ' ' : character })
				if (state.escaped) return { ...state, escaped: false }
				if (character === '\\') return { ...state, escaped: true }
				const closes =
					state.mode === 'single' || state.mode === 'templateSingle'
						? character === "'"
						: character === '"'
				return closes
					? { ...state, mode: template ? 'templateCode' : 'code', operand: false }
					: state
			}
			if (state.mode === 'regex' || state.mode === 'templateRegex') {
				tokens.push({ code: state.mode === 'templateRegex' ? ' ' : character })
				if (state.escaped) return { ...state, escaped: false }
				if (character === '\\') return { ...state, escaped: true }
				if (character === '[') return { ...state, regex: true }
				if (character === ']') return { ...state, regex: false }
				if (character === '/' && !state.regex)
					return {
						...state,
						mode: state.mode === 'templateRegex' ? 'templateCode' : 'code',
						operand: false,
					}
				return state
			}
			if (state.mode === 'template') {
				const interpolation = !state.escaped && character === '$' && next === '{'
				tokens.push({ code: interpolation ? '  ' : ' ' })
				if (state.escaped) return { ...state, escaped: false }
				if (character === '\\') return { ...state, escaped: true }
				if (interpolation)
					return {
						...state,
						offset: offset + 2,
						templates: state.templates === undefined ? undefined : { ...state.templates, depth: 1 },
						mode: 'templateCode',
						operand: true,
						member: false,
						role: undefined,
					}
				if (character === '\x60') {
					const templates = state.templates?.previous
					return {
						...state,
						templates,
						mode: templates === undefined ? 'code' : 'templateCode',
						operand: false,
					}
				}
				return state
			}
			const template = state.mode === 'templateCode'
			if (character === '/' && next === '/') {
				tokens.push({ code: '  ' })
				return {
					...state,
					offset: offset + 2,
					line: template,
					mode: template ? 'templateLine' : 'line',
				}
			}
			if (character === '/' && next === '*') {
				const jsdoc = !template && source[offset + 2] === '*'
				tokens.push({ code: '  ', ...(jsdoc ? { jsdoc: '/*' } : {}) })
				return {
					...state,
					offset: offset + 2,
					block: template,
					mode: template ? 'templateBlock' : 'block',
					jsdoc: jsdoc || state.jsdoc,
					present: jsdoc || state.present,
				}
			}
			if (character === "'" || character === '"' || character === '\x60') {
				tokens.push({ code: template || character === '\x60' ? ' ' : character })
				return {
					...state,
					mode:
						character === '\x60'
							? 'template'
							: character === "'"
								? template
									? 'templateSingle'
									: 'single'
								: template
									? 'templateDouble'
									: 'double',
					templates:
						character === '\x60' ? { depth: 0, previous: state.templates } : state.templates,
					escaped: false,
					separated: false,
					restricted: undefined,
				}
			}
			const visible = template ? ' ' : character
			if (character === '/' && next === '=' && !state.operand) {
				tokens.push({ code: template ? '  ' : '/=' })
				return {
					...state,
					offset: offset + 2,
					operand: true,
					member: false,
					role: undefined,
					separated: false,
					restricted: undefined,
				}
			}
			if (character === '/') {
				tokens.push({ code: visible })
				return state.operand
					? {
							...state,
							mode: template ? 'templateRegex' : 'regex',
							escaped: false,
							regex: false,
							separated: false,
							restricted: undefined,
						}
					: {
							...state,
							operand: true,
							member: false,
							role: undefined,
							separated: false,
							restricted: undefined,
						}
			}
			identifier.lastIndex = offset
			const matched = identifier.exec(source)
			if (matched !== null) {
				const token = matched[0]
				tokens.push({ code: template ? ' '.repeat(token.length) : token })
				const stepped = {
					...state,
					offset: offset + token.length,
					restricted: undefined,
					separated: false,
				}
				const frame = state.parentheses
				if (token.startsWith('#'))
					return { ...stepped, operand: false, member: false, role: undefined }
				if (state.member) return { ...stepped, member: false, operand: false, role: undefined }
				if (state.restricted === 'label')
					return { ...stepped, operand: false, role: undefined, restricted: 'complete' }
				if (/^(?:if|while|with)$/.test(token))
					return { ...stepped, role: 'statement', operand: true }
				if (token === 'for') return { ...stepped, role: 'for', operand: true }
				if (token === 'export') return { ...stepped, role: 'export', operand: true }
				if (token === 'default' && state.role === 'export')
					return { ...stepped, role: undefined, operand: true }
				if (/^(?:switch|catch)$/.test(token)) return { ...stepped, role: 'block', operand: true }
				if (token === 'await' && state.role === 'for') return { ...stepped, operand: true }
				if (
					/^(?:return|throw|case|delete|void|typeof|new|await|yield|else|do|extends|in|instanceof)$/.test(
						token,
					)
				)
					return { ...stepped, role: undefined, operand: true }
				if (/^(?:break|continue)$/.test(token))
					return { ...stepped, role: undefined, operand: false, restricted: 'label' }
				if (token === 'debugger')
					return { ...stepped, role: undefined, operand: false, restricted: 'complete' }
				if (
					token === 'of' &&
					frame?.role === 'for' &&
					frame.phase === 'left' &&
					!frame.binding &&
					!state.operand
				)
					return {
						...stepped,
						parentheses: { ...frame, phase: 'right' },
						operand: true,
						role: undefined,
					}
				if (/^(?:const|let|var)$/.test(token) && frame?.role === 'for' && frame.phase === 'left')
					return {
						...stepped,
						parentheses: { ...frame, binding: true },
						operand: true,
						role: undefined,
					}
				return {
					...stepped,
					parentheses: frame?.binding === true ? { ...frame, binding: false } : frame,
					operand: false,
					role: undefined,
				}
			}
			if (/[0-9]/.test(character)) {
				numeric.lastIndex = offset
				const token = numeric.exec(source)?.[0] ?? character
				tokens.push({ code: template ? ' '.repeat(token.length) : token })
				return {
					...state,
					offset: offset + token.length,
					operand: false,
					member: false,
					role: undefined,
					restricted: undefined,
					separated: false,
				}
			}
			if ((character === '!' || character === '=') && next === '=') {
				const width = source[offset + 2] === '=' ? 3 : 2
				tokens.push({ code: template ? ' '.repeat(width) : source.slice(offset, offset + width) })
				return {
					...state,
					offset: offset + width,
					operand: true,
					member: false,
					role: undefined,
					restricted: undefined,
					separated: false,
				}
			}
			if ((character === '+' && next === '+') || (character === '-' && next === '-')) {
				tokens.push({ code: template ? '  ' : character + next })
				return {
					...state,
					offset: offset + 2,
					operand: state.separated ? true : state.operand,
					member: false,
					role: undefined,
					restricted: undefined,
					separated: false,
				}
			}
			if (character === '.' && next === '.' && source[offset + 2] === '.') {
				tokens.push({ code: template ? '   ' : '...' })
				return {
					...state,
					offset: offset + 3,
					operand: true,
					member: false,
					role: undefined,
					restricted: undefined,
					separated: false,
				}
			}
			if (character === '?' && next === '.') {
				tokens.push({ code: template ? '  ' : '?.' })
				return {
					...state,
					offset: offset + 2,
					operand: false,
					member: true,
					role: undefined,
					restricted: undefined,
					separated: false,
				}
			}
			tokens.push({ code: visible })
			if (/\s/.test(character)) return state
			const stepped = {
				...state,
				separated: false,
				restricted: undefined,
				role: undefined,
				member: false,
			}
			const frame = state.parentheses
			if (character === '(')
				return {
					...stepped,
					parentheses: {
						role: state.role ?? 'plain',
						phase: 'left',
						binding: false,
						previous: frame,
					},
					operand: true,
				}
			if (character === ')')
				return {
					...stepped,
					parentheses: frame?.previous,
					operand: frame?.role === 'statement' || frame?.role === 'for',
				}
			if (character === ';')
				return {
					...stepped,
					parentheses:
						frame?.role === 'for' && frame.phase === 'left'
							? { ...frame, phase: 'classic' }
							: frame,
					operand: true,
				}
			if (character === '.') return { ...stepped, operand: false, member: true }
			const parentheses =
				(character === ']' || character === '}') &&
				frame?.role === 'for' &&
				frame.phase === 'left' &&
				frame.binding
					? { ...frame, binding: false }
					: frame
			if (character === ']') return { ...stepped, parentheses, operand: false }
			const top = state.templates
			if (character === '}')
				return {
					...stepped,
					parentheses,
					operand: false,
					templates: template && top !== undefined ? { ...top, depth: top.depth - 1 } : top,
					mode: template && top?.depth === 1 ? 'template' : state.mode,
				}
			if (character === '{')
				return {
					...stepped,
					parentheses,
					operand: true,
					templates: template && top !== undefined ? { ...top, depth: top.depth + 1 } : top,
				}
			return { ...stepped, parentheses, operand: character !== '!' ? true : state.operand }
		},
		{
			offset: 0,
			start: 0,
			token: 0,
			mode: 'code',
			escaped: false,
			regex: false,
			operand: true,
			member: false,
			role: undefined,
			restricted: undefined,
			separated: false,
			block: false,
			line: false,
			jsdoc: false,
			present: false,
			parentheses: undefined,
			templates: undefined,
		},
	)
	const parts = tokens.slice(final.token)
	const code = parts.map((part) => part.code).join('')
	lines.push({
		source: source.slice(final.start),
		code,
		jsdoc:
			final.present || final.jsdoc
				? parts.map((part) => part.jsdoc ?? ' '.repeat(part.code.length)).join('')
				: undefined,
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
	for (const value of isString(module) ? [module] : module) {
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
 * findMissingSymbols([{ name: 'X', keyword: 'class', signature: '`new () => X`' }], []) // ['class X']
 * ```
 */
export function findMissingSymbols(
	symbols: readonly SurfaceSymbol[],
	source: readonly SurfaceSymbol[],
): readonly string[] {
	return findMissing(symbols.map(computeSymbolKey), source.map(computeSymbolKey))
}

/**
 * Checks whether a source declares at least one behavioural member — a `class` or `interface`
 * in its surface that carries a call-signature member — so a guide owes a `## Methods` group only
 * where the source has one to document.
 *
 * @param source - The reflected source under parity
 * @returns True if a surface `class` or `interface` declares a member; false otherwise
 *
 * @example
 * ```ts
 * hasBehaviouralSurface(createSource({ files: { 'src/types.ts': 'export interface Widget { render(): void }' }, module: 'src' })) // true
 * hasBehaviouralSurface(createSource({ files: { 'src/constants.ts': 'export const NAMES = Object.freeze({})' }, module: 'src' })) // false
 * ```
 */
export function hasBehaviouralSurface(source: SourceInterface): boolean {
	return source
		.surface()
		.some(
			(symbol) =>
				(symbol.keyword === 'class' || symbol.keyword === 'interface') &&
				source.methods(symbol.name).length > 0,
		)
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

	for (const match of fence.matchAll(pattern)) {
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
	for (const node of walkMarkdownNodes({ element: 'paragraph', children: cell })) {
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
 * Extracts compared inline content — the text of a table cell or candidate entity heading
 * flattened with every code span kept as a code span, so `` `Widget` `` reads the same wherever
 * the parity reader compares it. Emphasis drops to its text, a link drops to its text, an image
 * drops to its alternative text, and the markdown parser has already unescaped `\|`.
 *
 * @param cell - The inline nodes to flatten
 * @returns The compared text, code spans included
 *
 * @example
 * ```ts
 * extractCellText([{ element: 'codeSpan', value: 'Widget' }]) // '`Widget`'
 * ```
 */
export function extractCellText(cell: readonly InlineNode[]): string {
	return Iterator.from(cell)
		.map((node) => {
			if (isCodeSpanNode(node)) return `\`${node.value}\``
			if (isEmphasisNode(node) || isLinkNode(node) || isImageNode(node)) {
				return extractCellText(node.children)
			}
			return flattenText(node)
		})
		.toArray()
		.join('')
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
	const cursor = Iterator.from(text.matchAll(/`([^`]+)`/g)).reduce((previous, span) => {
		const value = span[1]
		if (value === undefined) return previous
		if (span.index > previous) {
			nodes.push({ element: 'text', value: text.slice(previous, span.index) })
		}
		nodes.push(
			value.trim() === value ? { element: 'codeSpan', value } : { element: 'text', value: span[0] },
		)
		return span.index + span[0].length
	}, 0)
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
	for (const index of table.header.keys()) {
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
 * Computes the bracket depth of every character of projected declaration code: an opening `(`,
 * `[`, `{`, or `<` and its closing partner carry the depth outside the pair, the characters
 * between them one more, and every character of a quoted string, its quotes included, `-1`.
 *
 * @remarks
 * The `>` of an `=>` arrow closes nothing. A backslash escapes the next character inside a
 * quoted string. Template literal text is outside the reading, because
 * {@link extractSourceLines} masks it to spaces in the code this function reads.
 *
 * @param code - The projected code of one declaration
 * @returns One depth per UTF-16 code unit of `code`
 *
 * @example
 * ```ts
 * computeDepths("f(a, 'b')") // [0, 0, 1, 1, 1, -1, -1, -1, 0]
 * ```
 */
export function computeDepths(code: string): readonly number[] {
	const depths: number[] = []
	code.split('').reduce<{
		readonly depth: number
		readonly quote: string | undefined
		readonly escaped: boolean
	}>(
		(state, character, index) => {
			if (state.quote !== undefined) {
				depths.push(-1)
				if (state.escaped) return { ...state, escaped: false }
				if (character === '\\') return { ...state, escaped: true }
				return character === state.quote ? { ...state, quote: undefined } : state
			}
			if (character === "'" || character === '"') {
				depths.push(-1)
				return { ...state, quote: character }
			}
			if (')]}'.includes(character) || (character === '>' && code[index - 1] !== '=')) {
				const depth = Math.max(0, state.depth - 1)
				depths.push(depth)
				return { ...state, depth }
			}
			depths.push(state.depth)
			return '([{<'.includes(character) ? { ...state, depth: state.depth + 1 } : state
		},
		{ depth: 0, quote: undefined, escaped: false },
	)
	return depths
}

/**
 * Finds the index of the bracket closing the opener at `start`: the first later character whose
 * {@link computeDepths} depth equals the opener's.
 *
 * @param depths - The depths {@link computeDepths} returned for the code
 * @param start - The index of an opening `(`, `[`, `{`, or `<`
 * @returns The closing bracket's index, or `undefined` when the opener never closes
 *
 * @example
 * ```ts
 * findClosing(computeDepths('<T>(x: T)'), 3) // 8
 * ```
 */
export function findClosing(depths: readonly number[], start: number): number | undefined {
	const depth = depths[start]
	if (depth === undefined || depth < 0) return undefined
	const index = depths.findIndex((value, position) => position > start && value === depth)
	return index < 0 ? undefined : index
}

/**
 * Finds every index at which `separator` sits at `depth` outside quoted text, in code order.
 *
 * @param code - The projected code to search
 * @param depths - The depths {@link computeDepths} returned for `code`
 * @param separator - The single character to find
 * @param depth - The bracket depth the separator must sit at
 * @returns The separator indices, in code order
 *
 * @example
 * ```ts
 * findSeparators('a, f(b, c)', computeDepths('a, f(b, c)'), ',', 0) // [1]
 * ```
 */
export function findSeparators(
	code: string,
	depths: readonly number[],
	separator: string,
	depth: number,
): readonly number[] {
	return depths
		.keys()
		.filter((index) => depths[index] === depth && code[index] === separator)
		.toArray()
}

/**
 * Renders one emitted interface member as its signature entry: a property as its name, an
 * optional one with `?`, a method as `name()` or `name?()`, an accessor as its name, and a call,
 * construct, or index signature as its own text with whitespace collapsed.
 *
 * @remarks
 * `code` is the member's projected code and `source` its text at the same columns, both without
 * the terminating `;`. A leading `readonly` modifier never enters a name. A computed name keeps
 * its brackets, and a quoted name keeps its quotes.
 *
 * @param code - The member's projected code
 * @param source - The member's source text, aligned with `code`
 * @returns The member's entry, or `undefined` when the member is empty
 *
 * @example
 * ```ts
 * renderMember('readonly name?: string', 'readonly name?: string') // 'name?'
 * renderMember('walk(depth: number): void', 'walk(depth: number): void') // 'walk()'
 * renderMember('[key: string]: number', '[key: string]: number') // '[key: string]: number'
 * ```
 */
export function renderMember(code: string, source: string): string | undefined {
	const text = source.replace(/\s+/g, ' ').trim()
	if (text.length === 0) return undefined
	const leading = code.length - code.trimStart().length
	const modifier = leading + (/^readonly\s+/.exec(code.slice(leading))?.[0].length ?? 0)
	const rest = code.slice(modifier)
	if (/^(?:new\s*)?[(<]/.test(rest)) return text
	const depths = computeDepths(rest)
	const bracket = rest.startsWith('[') ? findClosing(depths, 0) : undefined
	if (
		bracket !== undefined &&
		findSeparators(rest, depths, ':', 1).some((index) => index < bracket)
	) {
		return text
	}

	const accessor = /^(?:get|set)\s+(?=[^\s(:?<])/.exec(rest)?.[0].length ?? 0
	const named = rest.slice(accessor)
	const computed = named.startsWith('[') ? findClosing(computeDepths(named), 0) : undefined
	const length =
		computed === undefined
			? (/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s?(:<]+)/.exec(named)?.[0].length ?? 0)
			: computed + 1
	if (length === 0) return text

	const offset = modifier + accessor
	const tail = named.slice(length)
	const optional = tail.startsWith('?')
	const method = accessor === 0 && /^\??\s*[(<]/.test(tail)
	return `${source.slice(offset, offset + length)}${optional ? '?' : ''}${method ? '()' : ''}`
}

/**
 * Extracts one emitted declaration's signature: the symbol its column-zero `export` head names,
 * carrying the type text the compiler emitted for it.
 *
 * @remarks
 * `code` is the declaration's projected code and `source` its text at the same columns, each
 * physical line trimmed and the lines joined with single spaces. The forms:
 *
 * - `function`: `<T>(params) => RET` from `NAME<T>(params): RET`.
 * - `class`: `new <T>(params) => YIELD` per `constructor(params)`, several as an intersection of
 *   parenthesized signatures, none as `new <T>() => YIELD`. `YIELD` is the first `implements`
 *   type, else the class's own name with its type parameter names. Every other member is ignored.
 * - `interface`: `{ entries }` from {@link renderMember} over its own members, in emitted order,
 *   each entry once, or `{}` when it declares none. The `extends` clause is not read.
 * - `type`: the text after `=` to the terminating `;`, type parameters omitted.
 * - `const`: the text after `NAME:` to the `;`, or after `NAME =` for a literal the compiler
 *   emitted as the constant's type.
 *
 * @param code - The declaration's projected code
 * @param source - The declaration's source text, aligned with `code`
 * @returns The declared symbol with its signature, or `undefined` when no supported head opens it
 *
 * @example
 * ```ts
 * const text = 'export declare function walk<T>(node: T): void;'
 * extractSignature(text, text) // { name: 'walk', keyword: 'function', signature: '<T>(node: T) => void' }
 * ```
 */
export function extractSignature(code: string, source: string): SurfaceSymbol | undefined {
	const head =
		/^export (?:declare )?(?:abstract )?(function|class|interface|type|const(?! enum\b)) ([^\s<(:=;{]+)/.exec(
			code,
		)
	const keyword = head?.[1]
	const name = head?.[2]
	if (head === null || name === undefined || !isExportKeyword(keyword)) return undefined

	const depths = computeDepths(code)
	const start = head[0].length
	const generic = code[start] === '<' ? findClosing(depths, start) : undefined
	const typed = generic === undefined ? start : generic + 1
	const generics = source.slice(start, typed)
	const end = findSeparators(code, depths, ';', 0).find((index) => index >= typed) ?? code.length

	if (keyword === 'function') {
		const close = code[typed] === '(' ? findClosing(depths, typed) : undefined
		if (close === undefined) return undefined
		const colon = /^\s*:/.exec(code.slice(close + 1))?.[0].length
		if (colon === undefined) return undefined
		const returns = source.slice(close + 1 + colon, end).trim()
		return {
			name,
			keyword,
			signature: `${generics}(${source.slice(typed + 1, close)}) => ${returns}`,
		}
	}

	if (keyword === 'const' || keyword === 'type') {
		// The separator alone, because the spaces after it can be masked template text.
		const assigned = (keyword === 'const' ? /^\s*[:=]/ : /^\s*=/).exec(code.slice(typed))
		if (assigned === null) return undefined
		return { name, keyword, signature: source.slice(typed + assigned[0].length, end).trim() }
	}

	const open = findSeparators(code, depths, '{', 0).find((index) => index >= typed)
	const close = open === undefined ? undefined : findClosing(depths, open)
	if (open === undefined || close === undefined) return undefined
	const boundaries = [
		open,
		...findSeparators(code, depths, ';', 1).filter((index) => index > open && index < close),
		close,
	]
	const members = boundaries.slice(0, -1).map((boundary, position) => {
		const next = boundaries[position + 1] ?? close
		return { code: code.slice(boundary + 1, next), source: source.slice(boundary + 1, next) }
	})

	if (keyword === 'interface') {
		const entries = Array.from(
			new Set(
				members
					.map((member) => renderMember(member.code, member.source))
					.filter((entry) => entry !== undefined),
			),
		)
		return { name, keyword, signature: entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }` }
	}

	const heritage = /\bimplements\b/.exec(code.slice(typed, open))
	const implemented =
		heritage === null || depths[typed + heritage.index] !== 0
			? undefined
			: typed + heritage.index + heritage[0].length
	const comma =
		implemented === undefined
			? undefined
			: findSeparators(code, depths, ',', 0).find((index) => index > implemented && index < open)
	const parameters =
		generic === undefined
			? []
			: [start, ...findSeparators(code, depths, ',', 1).filter((index) => index < generic)].map(
					(boundary, position, list) =>
						/^\s*(?:(?:const|in|out)\s+)*([^\s=,>]+)/.exec(
							code.slice(boundary + 1, list[position + 1] ?? generic),
						)?.[1] ?? '',
				)
	const yielded =
		implemented === undefined
			? `${name}${parameters.length === 0 ? '' : `<${parameters.join(', ')}>`}`
			: source.slice(implemented, comma ?? open).trim()
	const constructors = members
		.filter((member) =>
			/^\s*(?:(?:public|private|protected)\s+)?constructor\s*\(/.test(member.code),
		)
		.map((member) => {
			const parenthesis = member.code.indexOf('(')
			const closed = findClosing(computeDepths(member.code), parenthesis) ?? member.code.length
			return `new ${generics}(${member.source.slice(parenthesis + 1, closed)}) => ${yielded}`
		})
	return {
		name,
		keyword,
		signature:
			constructors.length === 0
				? `new ${generics}() => ${yielded}`
				: constructors.length === 1
					? (constructors[0] ?? '')
					: constructors.map((entry) => `(${entry})`).join(' & '),
	}
}

/**
 * Extracts every signature one compiler-emitted declaration file declares: each column-zero
 * `export` head read through {@link extractSignature}, an overload set's emitted heads joined in
 * order as an intersection of parenthesized signatures.
 *
 * @remarks
 * The text is read through {@link extractSourceLines}, so comment and template payload never
 * opens or closes a bracket. Each physical line is trimmed and a declaration's lines are joined
 * with single spaces, so a multi-line emitted type reads as one line. A head the projector does
 * not support, such as an `enum` or a re-export, contributes nothing. Every other repeated head
 * keeps its first signature.
 *
 * @param declaration - The emitted `.d.ts` text
 * @returns The declared symbols with their signatures, in first-seen order
 *
 * @example
 * ```ts
 * extractSignatures('export declare function open(id: string): boolean;\nexport declare function open(ids: readonly string[]): boolean;\n')
 * // [{ name: 'open', keyword: 'function', signature: '((id: string) => boolean) & ((ids: readonly string[]) => boolean)' }]
 * ```
 */
export function extractSignatures(declaration: string): readonly SurfaceSymbol[] {
	const records = extractSourceLines(declaration)
		.map((line) => {
			const start = line.code.length - line.code.trimStart().length
			const end = line.code.trimEnd().length
			return {
				code: line.code.slice(start, end),
				source: line.source.slice(start, end),
				head: start === 0 && line.code.startsWith('export '),
			}
		})
		.filter((record) => record.code.length > 0)
	const heads = records
		.keys()
		.filter((index) => records[index]?.head === true)
		.toArray()
	const symbols = heads
		.map((head, position) => {
			const segment = records.slice(head, heads[position + 1] ?? records.length)
			return extractSignature(
				segment.map((record) => record.code).join(' '),
				segment.map((record) => record.source).join(' '),
			)
		})
		.filter((symbol) => symbol !== undefined)

	return Array.from(new Set(symbols.map(computeSymbolKey))).flatMap((key) => {
		const declared = symbols.filter((symbol) => computeSymbolKey(symbol) === key)
		const [first] = declared
		if (first === undefined) return []
		if (first.keyword !== 'function' || declared.length === 1) return [first]
		return [
			{
				...first,
				signature: declared.map((symbol) => `(${symbol.signature ?? ''})`).join(' & '),
			},
		]
	})
}

/**
 * Joins the declaration head starting at `start` into one space-separated
 * line, consuming lines until the first that opens a body: one that ends with
 * `{`, or one that closes an empty body with `{}` or `{ }`.
 *
 * @remarks
 * A line ending with `{}` closes an empty body only when every angle, round,
 * and square bracket the head opened outside quoted text has closed; inside
 * one, `{}` is a type or an argument, and an arrow's `=>` closes nothing. A
 * head that reaches the next column-zero `export` line opens no body.
 *
 * @param lines - The file's source lines
 * @param start - The index of the head's first line
 * @returns The joined head, or `undefined` when no line opens a body
 *
 * @example
 * ```ts
 * joinHead(['export class X {'], 0) // { text: 'export class X {', end: 0 }
 * joinHead(['export interface Y extends X {}'], 0) // { text: 'export interface Y extends X {}', end: 0 }
 * ```
 */
export function joinHead(lines: readonly string[], start: number): DeclarationHead | undefined {
	const parts: string[] = []
	for (const distance of Array.prototype.keys.call({
		get length() {
			return Math.max(0, Math.ceil(lines.length - start))
		},
	})) {
		const index = start + distance
		const line = lines[index]
		if (line === undefined) break
		const text = line.trimEnd()
		if (index > start && text.startsWith('export ')) return undefined
		parts.push(index === start ? text : text.trimStart())
		if (text.endsWith('{')) return { text: parts.join(' '), end: index }
		const bare = parts.join(' ').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '')
		const closed =
			(bare.match(/</g)?.length ?? 0) <= (bare.match(/(?<!=)>/g)?.length ?? 0) &&
			(bare.match(/\(/g)?.length ?? 0) <= (bare.match(/\)/g)?.length ?? 0) &&
			(bare.match(/\[/g)?.length ?? 0) <= (bare.match(/\]/g)?.length ?? 0)
		if (closed && /\{\s*\}$/.test(text)) return { text: parts.join(' '), end: index }
	}
	return undefined
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
 * keeping JSDoc evidence intact; a head whose last line closes its own body with `{}` or `{ }`
 * records an empty body. Every balanced `<...>` span is removed from the head before its
 * `extends` clause is read, so a `T extends Base` type parameter is never a base and `Base<T>`
 * reads as `Base`; a class's `implements` clause and everything after it is excluded, and a
 * qualified base such as `namespace.Base` is returned verbatim. The first head of a key that opens
 * a column-zero close answers for that key: a head that opens none records nothing, and a later
 * head of a key already collected adds nothing unless the earlier head recorded neither a body
 * nor bases, which declares nothing as {@link Source} reads it, so the later head replaces it.
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
	const grammar = /^export (class|interface) ([^\s<]+)(?:<.*>)?(?: .*)? \{(?:\s*\})?$/
	const lines = extractSourceLines(source)
	const projected = lines.map((line) => line.code)

	for (const index of projected.keys()) {
		const line = projected[index]
		if (line === undefined || !opener.test(line)) continue

		const head = joinHead(projected, index)
		if (head === undefined) continue
		const declared = grammar.exec(head.text)
		const keyword = declared?.[1]
		const name = declared?.[2]
		if (keyword === undefined || name === undefined) continue

		const key = `${keyword} ${name}`
		const known = declarations.get(key)
		// A head with neither a body nor bases declares nothing, as Source reads it, so a later head answers.
		if (known !== undefined && (known.body.length > 0 || known.bases.length > 0)) continue

		const visible: string[] = []
		Iterator.from(head.text.slice(`export ${key}`.length, head.text.lastIndexOf('{'))).reduce(
			(depth, character) => {
				if (character === '<') return depth + 1
				if (character === '>') return Math.max(0, depth - 1)
				if (depth === 0) visible.push(character)
				return depth
			},
			0,
		)
		const flat = visible.join('')
		const clause = flat.replace(/\bimplements\b[\s\S]*$/, '').match(/\bextends\b([\s\S]*)$/)?.[1]
		const bases =
			clause === undefined
				? []
				: clause
						.split(',')
						.map((base) => base.trim())
						.filter(isNonEmptyString)

		// joinHead ends a head on `}` only where its line closes an empty body, so no close follows it.
		if (head.text.endsWith('}')) {
			declarations.set(key, { body: [], bases })
			continue
		}

		const close = Array.prototype.keys
			.call({ length: projected.length - head.end - 1 })
			.map((distance) => head.end + 1 + distance)
			.find((candidate) => projected[candidate] === '}')
		if (close !== undefined)
			declarations.set(key, {
				body: lines.slice(head.end + 1, close).map((record) => record.source),
				bases,
			})

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
 * window, and the base reading. This lookup spells the map's `${keyword} ${name}` key for its
 * caller, so a consumer reading one name never writes that convention itself. `name` is compared
 * as literal text against the identifier the head itself carries, so a metacharacter in `name`
 * names that character rather than matching text it does not name. Every call collects the whole
 * file afresh: a consumer reading many names from one file calls {@link collectDeclarations} once
 * and reads the map, and {@link Source} holds one such map per module scope.
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
	const scanned: Array<{
		readonly block: BlockNode
		readonly active: boolean
		readonly heading: boolean
	}> = []
	for (const block of document.children) {
		const active = scanned.at(-1)?.active ?? false
		if (isHeadingNode(block) && block.level <= 2) {
			if (block.level === 2 && flattenText(block).trim() === heading) {
				scanned.push({ block, active: true, heading: true })
				continue
			}
			if (active) break
		}
		scanned.push({ block, active, heading: false })
	}
	return scanned.filter((entry) => entry.active && !entry.heading).map((entry) => entry.block)
}

/**
 * Validates every `## Surface` table a guide carries: each header must be exactly
 * {@link SURFACE_HEADER}, and each row that keys a symbol must carry a non-empty `Signature` cell.
 *
 * @remarks
 * Reads each `## Surface` section through {@link selectSectionBlocks}, a repeated section
 * included, and refuses at the first offending table in document order, through {@link GuideError} with code
 * `header` for a nonuniform header and `signature` for a keyed empty cell. Header and row text in
 * the message is JSON-encoded and capped at 200 characters.
 *
 * @param document - The parsed guide document
 * @throws {@link GuideError} at the first nonuniform header or keyed empty Signature cell
 *
 * @example
 * ```ts
 * validateSurface(createMarkdown('## Surface\n\n| Name | Kind |\n| --- | --- |').document)
 * // throws GuideError: ## Surface table 1 has header "Name | Kind"; expected "Name | Kind | Signature | Summary".
 * ```
 */
export function validateSurface(document: MarkdownDocument): void {
	const expected = SURFACE_HEADER.join(' | ')
	const signed = SURFACE_HEADER.indexOf(SIGNATURE)
	const tables = new Set(
		document.children
			.flatMap((block, start) =>
				isHeadingNode(block) && block.level === 2 && flattenText(block).trim() === SURFACE
					? selectSectionBlocks({ ...document, children: document.children.slice(start) }, SURFACE)
					: [],
			)
			.filter(isTableNode),
	)
	for (const [index, table] of Array.from(tables).entries()) {
		const header = table.header.map((children) =>
			flattenText({ element: 'paragraph', children }).trim(),
		)
		if (
			header.length !== SURFACE_HEADER.length ||
			!SURFACE_HEADER.every((name, column) => header[column] === name)
		) {
			throw new GuideError(
				`## Surface table ${index + 1} has header ${JSON.stringify(header.join(' | ').slice(0, 200))}; expected ${JSON.stringify(expected)}.`,
				'header',
			)
		}
		for (const position of table.rows.keys()) {
			const symbol = extractRowSymbol(table, position)
			if (symbol === undefined) continue
			const cell = table.rows[position]?.[signed]
			if (
				cell !== undefined &&
				flattenText({ element: 'paragraph', children: cell }).trim().length > 0
			)
				continue
			throw new GuideError(
				`## Surface table ${index + 1} row ${position + 1} (${JSON.stringify(`${symbol.keyword} ${symbol.name}`.slice(0, 200))}) has an empty Signature cell; expected a non-empty TypeScript signature code span under ${JSON.stringify(expected)}.`,
				'signature',
			)
		}
	}
}

/**
 * Validates that the modules one manifest entry spans declare disjoint exports: one name exported
 * from two modules, whatever its keyword, is one capability split across environments.
 *
 * @remarks
 * Each source file answers for the most specific listed module directory that contains it, so a
 * nested module listed beside its parent never collides with itself. Logic that serves several
 * environments lives once in its layer's `core` directory, such as `src/core` or `app/core`;
 * environments whose internals differ each export a distinct name. Every colliding name is
 * reported in one refusal, in key order, each with every module that declares it; name and module
 * text is JSON-encoded and capped at 200 characters.
 *
 * @param files - The workspace-relative inventory the modules are read from
 * @param module - The manifest entry's source scope
 * @throws {@link GuideError} with code `collision` naming each name and the modules that declare it
 *
 * @example
 * ```ts
 * validateModules(
 * 	{ 'src/core/a.ts': 'export function open() {}', 'src/server/a.ts': 'export function open() {}' },
 * 	['src/core', 'src/server'],
 * )
 * // throws GuideError: "open" is declared in "src/core" and "src/server"; …
 * ```
 */
export function validateModules(
	files: Readonly<Record<string, string>>,
	module: GuideModule,
): void {
	const directories = normalizeDirectories(module)
	const declared = selectModuleKeys(files, directories).flatMap((key) => {
		const owner = directories
			.filter((directory) => directory === '.' || key.startsWith(`${directory}/`))
			.reduce((current, directory) => (directory.length > current.length ? directory : current), '')
		return extractExports(files[key] ?? '').map((symbol) => ({
			key: symbol.name,
			owner,
		}))
	})
	const collisions = Array.from(new Set(declared.map((entry) => entry.key)))
		.sort()
		.map((key) => ({
			key,
			owners: directories.filter((directory) =>
				declared.some((entry) => entry.key === key && entry.owner === directory),
			),
		}))
		.filter((collision) => collision.owners.length > 1)
	if (collisions.length === 0) return
	const named = collisions.map(
		(collision) =>
			`${JSON.stringify(collision.key.slice(0, 200))} is declared in ${collision.owners.map((owner) => JSON.stringify(owner.slice(0, 200))).join(' and ')}`,
	)
	const cores = Array.from(
		new Set(
			collisions.flatMap((collision) =>
				collision.owners
					.filter((owner) => owner !== '.')
					.map((owner) => `${owner.replace(/\/.*$/u, '').slice(0, 200)}/core`),
			),
		),
	).sort()
	throw new GuideError(
		`${named.join('; ')}; one name exported from two environments is a conflict. Declare logic both environments share once in ${cores.join(' or ')}, and give each environment's own logic a distinct name.`,
		'collision',
		{
			context: {
				collisions: collisions.map((collision) => ({
					name: collision.key,
					modules: collision.owners,
				})),
			},
		},
	)
}

/**
 * Extracts one `## Surface` table row's symbol — its column 0 code span as the name, its
 * {@link KIND} column as the keyword, and its exact `Signature` and {@link SUMMARY} columns as
 * normalized text when those columns exist. Empty cells remain absent. A row with no code-span
 * name and a row whose `Kind` text is
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
	const signed = findColumnIndex(table, SIGNATURE)
	const signatureCell = signed === undefined ? undefined : cells[signed]
	const signature =
		signatureCell === undefined ? '' : normalizeSummary(extractCellText(signatureCell))
	return {
		name,
		keyword,
		...(signature.length === 0 ? {} : { signature }),
		...(summary === undefined ? {} : { summary }),
	}
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
 * code span (the name) paired with its `Kind` column (located by header text), unioned with every
 * H3 entity heading whose trimmed compared inline content is exactly its backticked code-span
 * name, deduped by {@link computeSymbolKey}. A row with no code-span name has no name to key a
 * symbol on, so this reader skips it and {@link extractUnnamed} reports it; a row with an
 * unrecognized `Kind` text is skipped. A row also carries its {@link SUMMARY} column's compared
 * text when the table has that column; a table without it leaves every row's summary absent,
 * which {@link findDrift} reports. The exact `Signature` column contributes normalized signature
 * text, including code spans, when present and non-empty; no other header supplies it.
 *
 * @remarks
 * The heading boundary compares {@link extractCellText} with the raw value from
 * {@link findFirstCode} before {@link normalizeIdentifier} strips a generic annotation.
 * Surrounding spaces, emphasis, and links preserve that identity. This reader refuses a heading
 * carrying any other visible text or an additional code span. Entries retain encounter order, and
 * the first-seen name + keyword wins: a genuine heading before its table row keeps the heading's
 * class entry without signature or summary, while a preceding table row keeps both cells.
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
			for (const row of block.rows.keys()) {
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
			if (rawName === undefined || extractCellText(block.children).trim() !== `\`${rawName}\``) {
				continue
			}
			const name = normalizeIdentifier(rawName)
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
		for (const row of table.rows.keys()) {
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
	const groups: Array<readonly [TableNode, string]> = []
	selectSectionBlocks(document, METHODS).reduce<string | undefined>((current, block) => {
		if (isHeadingNode(block) && block.level === 4) {
			const name = findFirstCode(block.children)
			return name === undefined ? undefined : normalizeIdentifier(name)
		}
		if (isTableNode(block) && current !== undefined) {
			groups.push([block, current])
			return undefined
		}
		return current
	}, undefined)
	return new Map(groups)
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
	for (const node of walkMarkdownNodes(document)) {
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
		for (const node of walkMarkdownNodes(block)) {
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
 * Returns the canonical compared form of a description paragraph. `{@link Target}` and
 * `{@link Target | label}` become the code token of the target text, or of the label where one is
 * written; a target's module part — the inline import form `import('./module.js').` and TSDoc's
 * package-qualified form `@scope/pkg#` — is dropped first. Every run of whitespace, including a
 * collapsed continuation marker and a line break, becomes one space, the ends trim, and a code
 * span keeps its delimiters while its own boundary whitespace goes. The guide's side and the
 * source's side read through this one form.
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
 * A target's module part is the inline import form `import('./module.js').` or TSDoc's
 * package-qualified form `@scope/pkg#`, and the expansion drops it, so a cross-file link and the
 * code token a guide cell documents it with reach the same text. A package qualifier carries `@`
 * or `/`; text before a `#` carrying neither is JSDoc's member reference, so `{@link Owner#member}`
 * and `{@link #member}` travel whole and a guide cell documents each as written. An unscoped
 * package name is spelled like an owner, so `{@link pkg#Name}` travels whole too — write the
 * scoped or the path form where a cell must drop the package. Everything after a module part
 * travels: `Owner.member` keeps its owner, and a dotted target no module part precedes is
 * untouched. A label is text rather than a target, so `{@link Target | label}` renders its label
 * whole.
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
 * normalizeSummary('Reads {@link @scope/widgets#Widget}.') // 'Reads `Widget`.'
 * normalizeSummary('Reads {@link Widget#render}.') // 'Reads `Widget#render`.'
 * normalizeSummary('cells joined by ` | `.') // 'cells joined by `|`.'
 * ```
 */
export function normalizeSummary(text: string): string {
	const normalized = text
		.split(/((?<!`)`[^`]+`(?!`))/)
		.map((part, index) => {
			if (index % 2 === 0) {
				return part
					.replace(/\{@link\s+[^}|]*\|\s*([^}]*?)\s*\}/g, '`$1`')
					.replace(
						/\{@link\s+(?:import\([^)]*\)\.|[^}|#\s]*[@/][^}|#\s]*#)?([^}|]*?)\s*\}/g,
						'`$1`',
					)
			}
			const value = part.slice(1, -1).replace(/\s+/g, ' ').trim()
			return `\`${value.length === 0 ? ' ' : value}\``
		})
		.join('')
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
	const words = text.split(/\s+/).filter((word) => word.length > 0)
	const lines: string[] = []
	const final = words.reduce(
		(previous, word, index) => {
			if (index === previous.start) return { start: index, length: word.length }
			if (previous.length + 1 + word.length <= width) {
				return { start: previous.start, length: previous.length + 1 + word.length }
			}
			lines.push(words.slice(previous.start, index).join(' '))
			return { start: index, length: word.length }
		},
		{ start: 0, length: 0 },
	)
	if (words.length > 0) lines.push(words.slice(final.start).join(' '))
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
	text.split('\n').reduce<string | undefined>((marker, line) => {
		const fence = /^[ \t]*(`{3,}|~{3,})/.exec(line)?.[1]
		if (marker === undefined) {
			masked.push(line)
			return fence
		}
		const closed = fence !== undefined && fence.startsWith(marker)
		masked.push(closed ? line : ' '.repeat(line.length))
		return closed ? undefined : marker
	}, undefined)
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
	Iterator.from(lines).reduce<{
		readonly block: boolean
		readonly eligible: boolean
		readonly span: string[]
		readonly pending: string | undefined
	}>(
		(previous, line) => {
			const projection = line.jsdoc
			const first = projection?.indexOf('/**') ?? -1
			if (
				previous.pending !== undefined &&
				!(!previous.block && first >= 0 && line.source.slice(0, first).trim() === '')
			) {
				comments.push({ text: previous.pending, line })
			}
			const state = { ...previous, pending: undefined }
			if (projection === undefined) return state
			const close = state.block ? projection.indexOf('*/') : -1
			const end = close < 0 ? projection.length : close + 2
			if (state.block) state.span.push(projection.slice(0, end))
			if (state.block && close < 0) return state
			const opener = state.block ? projection.indexOf('/**', close + 2) : first
			const whitespace = state.block
				? line.source.slice(close + 2, opener < 0 ? line.source.length : opener).trim() === ''
				: line.source.slice(0, first).trim() === ''
			const eligible = state.block ? state.eligible && whitespace : whitespace
			if (opener < 0)
				return state.block
					? {
							...state,
							block: false,
							pending: eligible ? normalizeComment(state.span.join('\n')) : undefined,
						}
					: state
			const spans = /\/\*(?=\*)[\s\S]*?(?:\*\/|$)/g
			spans.lastIndex = opener
			return Iterator.from(projection.matchAll(spans)).reduce<typeof previous>(
				(current, match) => {
					const cursor = match.index
					const closing = projection.indexOf('*/', cursor + 2)
					const finish = closing < 0 ? projection.length : closing + 2
					const span = [projection.slice(cursor, finish)]
					if (closing < 0) return { ...current, span, block: true }
					const next = projection.indexOf('/**', closing + 2)
					const gap =
						line.source.slice(closing + 2, next < 0 ? line.source.length : next).trim() === ''
					if (next < 0)
						return {
							...current,
							span,
							block: false,
							pending: current.eligible && gap ? normalizeComment(span.join('\n')) : undefined,
						}
					return { ...current, span, block: false, eligible: current.eligible && gap }
				},
				{ ...state, block: false, eligible },
			)
		},
		{ block: false, eligible: false, span: [], pending: undefined },
	)
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
 * An owner opens at a column-zero `export class`, `export abstract class`, or `export interface`
 * head and closes at the
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
	const keys: Array<readonly [SourceLine, string]> = []
	Iterator.from(lines).reduce<string | undefined>((owner, line) => {
		const head =
			/^export (?:async )?(?:abstract )?(function\*?|class|const|interface|type) (\w+)/.exec(
				line.code,
			)
		const keyword = head?.[1]?.replace(/\*$/, '')
		const name = head?.[2]
		if (isNonEmptyString(keyword) && isNonEmptyString(name) && isExportKeyword(keyword)) {
			keys.push([line, computeSymbolKey({ name, keyword })])
			return keyword === 'class' || keyword === 'interface' ? name : undefined
		}
		if (line.code === '}') return undefined
		const member = /^\t(?:async )?\*?(\w+)\??(?:<.*>)?\(/.exec(line.code)?.[1]
		if (owner !== undefined && isNonEmptyString(member)) keys.push([line, `${owner}.${member}`])
		return owner
	}, undefined)
	return new Map(keys)
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

	for (const tag of masked.matchAll(tags)) {
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
	const fences: Array<readonly [CodeBlockNode, GuideFence]> = []
	Iterator.from(walkMarkdownNodes(document)).reduce((title, node) => {
		if (isHeadingNode(node)) return flattenText(node).trim()
		if (isCodeBlockNode(node)) {
			fences.push([
				node,
				{
					language: node.lang,
					code: node.code,
					...(title.length === 0 ? {} : { title }),
				},
			])
		}
		return title
	}, '')
	return new Map(fences)
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
	const scanned: Array<{
		readonly block: BlockNode
		readonly opened: boolean
		readonly selected: BlockquoteNode | undefined
	}> = []
	for (const block of document.children) {
		const opened = scanned.at(-1)?.opened ?? false
		if (isHeadingNode(block)) {
			if (opened) break
			scanned.push({ block, opened: block.level === 1, selected: undefined })
			continue
		}
		const selected = opened && isBlockquoteNode(block) ? block : undefined
		scanned.push({ block, opened, selected })
		if (selected !== undefined) break
	}
	const selected = scanned.find((entry) => entry.selected !== undefined)?.selected
	if (selected === undefined) return undefined
	const text = normalizeSummary(
		selected.children
			.filter(isParagraphNode)
			.map((paragraph) => extractCellText(paragraph.children))
			.join(' '),
	)
	return text.length === 0 ? undefined : text
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
 * @param category - The compared site the drift came from
 * @param guide - The guide's text there, or `undefined` when it carries none
 * @param source - The source's text there, or `undefined` when it carries none
 * @returns The drift, or `undefined` when both sides carry the same text
 *
 * @example
 * ```ts
 * computeDrift('function walk', 'summary', 'Walks the tree.', 'Walks a tree.')
 * // { key: 'function walk', category: 'summary', guide: 'Walks the tree.', source: 'Walks a tree.' }
 * ```
 */
export function computeDrift(
	key: string,
	category: Drift['category'],
	guide: string | undefined,
	source: string | undefined,
): Drift | undefined {
	if (guide !== undefined && guide === source) return undefined
	return {
		key,
		category,
		...(guide === undefined ? {} : { guide }),
		...(source === undefined ? {} : { source }),
	}
}

/**
 * Compares documented and declared membership exactly after sorting copies, preserving duplicates.
 *
 * @param spec - The guide inventory key the finding belongs to
 * @param name - The declaration whose membership is compared
 * @param documented - The documented member names
 * @param declared - The declared member names
 * @returns The membership finding, or `undefined` when the sorted populations match
 *
 * @example Compare declaration membership
 * ```ts
 * import { compareMembership } from '@orkestrel/guide'
 *
 * compareMembership('guides/widget.md', 'WidgetInterface', ['open'], ['open']) // undefined
 * ```
 */
export function compareMembership(
	spec: string,
	name: string,
	documented: readonly string[],
	declared: readonly string[],
): ParityFinding | undefined {
	const left = [...documented].sort()
	const right = [...declared].sort()
	if (JSON.stringify(left) === JSON.stringify(right)) return undefined
	return {
		spec,
		text: `${spec} ${name} documents ${JSON.stringify(left)} and declares ${JSON.stringify(right)}.`,
	}
}

/**
 * Computes a category-separated identity for a guide finding.
 *
 * @param spec - The guide inventory key the drift belongs to
 * @param drift - The categorized disagreement
 * @returns The inventory key, category, and compared key separated by line feeds
 *
 * @example Identify categorized drift
 * ```ts
 * import { identifyDrift } from '@orkestrel/guide'
 *
 * identifyDrift('guides/widget.md', { category: 'summary', key: 'function open' })
 * // 'guides/widget.md\nsummary\nfunction open'
 * ```
 */
export function identifyDrift(spec: string, drift: Drift): string {
	return `${spec}\n${drift.category}\n${drift.key}`
}

/**
 * Formats present parity text as a JSON string and absent text as `absent`.
 *
 * @param value - The compared side's text, or `undefined` when absent
 * @returns The developer-facing side text
 *
 * @example Format a parity side
 * ```ts
 * import { formatSide } from '@orkestrel/guide'
 *
 * formatSide('Walks.') // '"Walks."'
 * formatSide(undefined) // 'absent'
 * ```
 */
export function formatSide(value: string | undefined): string {
	return value === undefined ? 'absent' : JSON.stringify(value)
}

/**
 * Formats a categorized drift with its guide and source sides.
 *
 * @param drift - The categorized disagreement to format
 * @returns The complete developer-facing drift text
 *
 * @example Format categorized drift
 * ```ts
 * import { formatDrift } from '@orkestrel/guide'
 *
 * formatDrift({ category: 'summary', key: 'function walk', guide: 'Walks.', source: 'Walks a tree.' })
 * // 'summary function walk: guide "Walks." source "Walks a tree."'
 * ```
 */
export function formatDrift(drift: Drift): string {
	return `${drift.category} ${drift.key}: guide ${formatSide(drift.guide)} source ${formatSide(drift.source)}`
}

/**
 * Finds every disagreement between a guide and the source it documents, naming both sites:
 * each `## Surface` row against its declaration's description paragraph, each present
 * `Signature` cell against the declaration's computed signature written as a code span, each
 * `## Methods` row against its member's, and the first titled guide fence of a heading against the
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
 * whether it sits under the same heading or under a second heading of the same text. A signature
 * is compared only when both sides carry one, so an H3 entity heading, which carries no cell, and
 * a source reflected without emitted declarations stay outside that comparison.
 *
 * @param guide - The parsed guide
 * @param source - The reflected source the guide documents
 * @returns One entry per disagreement: each Surface row's summary then signature, then Methods
 * rows, then examples
 *
 * @example
 * ```ts
 * findDrift(guide, source) // [{ key: 'function walk', category: 'summary', guide: 'Walks.', source: 'Walks a tree.' }]
 * ```
 */
export function findDrift(guide: GuideInterface, source: SourceInterface): readonly Drift[] {
	const drifts: Drift[] = []
	const declared = new Map(source.surface().map((symbol) => [computeSymbolKey(symbol), symbol]))

	for (const symbol of guide.surface()) {
		const key = computeSymbolKey(symbol)
		const match = declared.get(key)
		if (match === undefined) continue
		const drift = computeDrift(key, 'summary', symbol.summary, match.summary)
		if (drift !== undefined) drifts.push(drift)
		if (symbol.signature === undefined || match.signature === undefined) continue
		const computed = normalizeSummary(
			extractCellText([{ element: 'codeSpan', value: match.signature }]),
		)
		const signed = computeDrift(key, 'signature', symbol.signature, computed)
		if (signed !== undefined) drifts.push(signed)
	}

	for (const group of guide.methods()) {
		const members = new Map(source.methods(group.interface).map((entry) => [entry.name, entry]))
		for (const entry of group.methods) {
			const member = members.get(entry.name)
			if (member === undefined) continue
			const drift = computeDrift(
				`${group.interface}.${entry.name}`,
				'summary',
				entry.summary,
				member.summary,
			)
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
			'example',
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
 * Builds a copy of `table` with one cell's inline content replaced by `cell`. Every other cell
 * keeps its own nodes, so a rewrite touches the one cell it names and the header and the
 * alignment row travel unchanged.
 *
 * @param table - The table to copy
 * @param row - The index of the row to rewrite within {@link TableNode.rows}
 * @param column - The index of the cell to rewrite within that row
 * @param cell - The cell's new inline content, such as {@link buildCell} returns
 * @returns The rewritten table
 *
 * @example
 * ```ts
 * buildTable(table, 0, 3, buildCell('Walks the tree.')).rows[0]?.[3] // [{ element: 'text', value: 'Walks the tree.' }]
 * ```
 */
export function buildTable(
	table: TableNode,
	row: number,
	column: number,
	cell: readonly InlineNode[],
): TableNode {
	return {
		element: 'table',
		header: table.header,
		rows: table.rows.map((cells, index) =>
			index === row
				? cells.map((current, position) => (position === column ? cell : current))
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
 * Renders a uniform `Name | Kind | Signature | Summary` table with one row per symbol, the name
 * as a code span, the keyword as text, and the signature and summary through {@link buildCell}.
 * An absent signature or summary renders an empty cell, which {@link extractSurface} reads back
 * as absent. Guide construction refuses an empty signature cell.
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
 * // '| Name | Kind | Signature | Summary |\n| --- | --- | --- | --- |\n| `walk` | function |  | Walks the tree. |'
 * ```
 */
export function renderSurface(symbols: readonly SurfaceSymbol[]): string {
	return renderMarkdown({
		element: 'table',
		header: [
			[{ element: 'text', value: NAME }],
			[{ element: 'text', value: KIND }],
			[{ element: 'text', value: SIGNATURE }],
			[{ element: 'text', value: SUMMARY }],
		],
		rows: symbols.map((symbol) => [
			[{ element: 'codeSpan', value: symbol.name }],
			[{ element: 'text', value: symbol.keyword }],
			buildCell(symbol.signature ?? ''),
			buildCell(symbol.summary ?? ''),
		]),
		align: [null, null, null, null],
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
				header: [[{ element: 'text', value: NAME }], [{ element: 'text', value: SUMMARY }]],
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
 * an `Owner.member` key for a `## Methods` row — and the row's cell under the `column` header
 * becomes `cell`. Only the table's own source region is rewritten, so every byte outside it
 * travels unchanged; a key reaching no cell returns `undefined`, and a row already carrying that
 * cell returns the guide byte for byte.
 *
 * @remarks
 * A row the key does not reach, a table carrying no `column` header, and a document whose parse
 * recorded no region for the table are each a miss, and a miss returns `undefined` rather than
 * throwing, so a caller reports the key it could not place — the one meaning `undefined` carries
 * in every replacer here. A row already carrying `cell` returns the guide byte for byte, because
 * a rewrite would re-pad the whole table for no change; that identity reads both cells through
 * {@link extractCellText} and {@link normalizeSummary}, so a caller passing text the compared form
 * still moves is a fixed point on the second run rather than a row rewritten forever. The
 * rewritten table renders one-space padded whatever padding it carried, so the checkout's
 * formatter re-aligns it, and a code span renders with every `|` written `\|` and a longer
 * backtick fence when its text holds a backtick.
 *
 * @param guide - The guide's markdown source
 * @param key - The compared key naming the row
 * @param column - The header text of the column to write, {@link SUMMARY} or {@link SIGNATURE}
 * @param cell - The cell's new inline content, such as {@link buildCell} returns
 * @returns The guide's text with that cell replaced, or `undefined` when the key reaches no cell
 *
 * @example
 * ```ts
 * replaceCell('## Surface\n\n| Name | Kind | Signature | Summary |\n| --- | --- | --- | --- |\n| `walk` | function | `() => void` | Walks. |', 'function walk', SUMMARY, buildCell('Walks a tree.'))
 * // '## Surface\n\n| Name | Kind | Signature | Summary |\n| --- | --- | --- | --- |\n| `walk` | function | `() => void` | Walks a tree. |'
 * ```
 */
export function replaceCell(
	guide: string,
	key: string,
	column: string,
	cell: readonly InlineNode[],
): string | undefined {
	const markdown = createMarkdown(guide)
	const document = markdown.document
	const surface = Iterator.from(selectSectionBlocks(document, SURFACE))
		.filter(isTableNode)
		.flatMap((table) =>
			table.rows.keys().map((index) => ({ table, index, symbol: extractRowSymbol(table, index) })),
		)
		.find((row) => row.symbol !== undefined && computeSymbolKey(row.symbol) === key)
	const groups = collectGroups(document)
	const selected =
		surface ??
		Iterator.from(groups)
			.flatMap(([table, owner]) =>
				table.rows.keys().map((index) => ({
					table,
					index,
					owner,
					entry: extractRowEntry(table, index),
				})),
			)
			.find((row) => row.entry !== undefined && `${row.owner}.${row.entry.name}` === key)
	if (selected === undefined) return undefined
	const { table, index } = selected
	const position = findColumnIndex(table, column)
	if (position === undefined) return undefined
	const current = normalizeSummary(extractCellText(table.rows[index]?.[position] ?? []))
	if (current === normalizeSummary(extractCellText(cell))) return guide
	const span = markdown.span(table)
	if (span === undefined) return undefined
	return spliceSpan(guide, span, renderMarkdown(buildTable(table, index, position, cell)))
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
	const selected = Iterator.from(collectFences(markdown.document)).find(
		([, fence]) => fence.title === title,
	)
	if (selected === undefined) return undefined
	const [located, current] = selected
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
	const tag = masked.findIndex((line) => /^[ \t]*@\w/.test(line))

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
	const start = masked.findIndex((line) => {
		const tag = /^[ \t]*@example(?=[ \t]|$)[ \t]*(.*)$/.exec(line)
		return tag !== null && (tag[1] ?? '').trim() === title
	})
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

	const next = masked.findIndex((line, index) => index > start && /^[ \t]*@\w/.test(line))
	const boundary = next < 0 ? content.length : next
	const last = content.findLastIndex(
		(line, index) => index > start && index < boundary && line.length > 0,
	)
	const end = last < 0 ? start + 1 : last + 1

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
	const records: Array<{
		readonly line: SourceLine
		readonly index: number
		readonly offset: number
		readonly next: number
	}> = []
	for (const [index, line] of lines.entries()) {
		const offset = records.at(-1)?.next ?? 0
		const after = offset + line.source.length
		records.push({ line, index, offset, next: after + (text.startsWith('\r\n', after) ? 2 : 1) })
	}
	const offsets = records.map((record) => record.offset)
	const positions = new Map(records.map((record) => [record.line, record.index]))
	for (const comment of extractSourceComments(lines)) {
		if (keys.get(comment.line) !== key) continue
		const close = (positions.get(comment.line) ?? 0) - 1
		const closing = lines[close]?.jsdoc
		const end = closing === undefined ? -1 : closing.lastIndexOf('*/')
		if (end < 0) continue
		const first =
			lines
				.keys()
				.take(close)
				.map((index) => close - index)
				.find((index) => lines[index - 1]?.jsdoc === undefined) ?? 0
		const found = Array.prototype.keys
			.call({ length: close - first + 1 })
			.map((distance) => first + distance)
			.reduce(
				(state, index) => {
					const projection = lines[index]?.jsdoc ?? ''
					return Iterator.from(projection.matchAll(/(?=\/\*\*|\*\/)/g)).reduce(
						(current, match) => {
							const at = match.index
							if (at < current.cursor || !projection.startsWith(current.inside ? '*/' : '/**', at))
								return current
							return {
								inside: !current.inside,
								line: current.inside ? current.line : index,
								column: current.inside ? current.column : at,
								cursor: at + (current.inside ? 2 : 3),
							}
						},
						{ ...state, cursor: 0 },
					)
				},
				{ inside: false, line: -1, column: -1, cursor: 0 },
			)
		if (found.line < 0) continue
		const source = lines[found.line]?.source ?? ''
		const start = source.slice(0, found.column).trim() === '' ? 0 : found.column
		return { start: (offsets[found.line] ?? 0) + start, end: (offsets[close] ?? 0) + end + 2 }
	}
	return undefined
}
