import type { SourceLine, SurfaceSymbol } from '@src/core'
import * as core from '@src/core'
import {
	cellLinks,
	extractExampleLines,
	extractSourceLines,
	fenceImports,
	findMissing,
	findUnexampled,
	firstCode,
	identifierOf,
	isExternalLink,
	hasCanonicalSegments,
	kindIndex,
	missingSymbols,
	normalizeDirectories,
	resolveLink,
	resolvePath,
	selectModuleKeys,
	symbolKey,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { requireTable } from '../../setup.js'

// The bijection helpers behind the guides-parity scanners — symbol keying,
// set-difference, link classification/resolution, generic-name normalization,
// and table-column/inline lookups. Pure and total; each mirrors one exported
// helpers.ts symbol (AGENTS §16).

describe('extractSourceLines', () => {
	it('treats LF, CRLF, and block-comment linebreaks before increment and decrement as prefix boundaries', () => {
		const sources = [
			'let count = 0\n++/[/*]/.lastIndex\nexport const visible = true',
			'let count = 0\r\n--/[/*]/.lastIndex\r\nexport const visible = true',
			'let count = 0 /* separated\n*/ ++/[/*]/.lastIndex\nexport const visible = true',
			'let count = 0 /* separated\r\n*/ --/[/*]/.lastIndex\r\nexport const visible = true',
		]
		expect(sources.map((source) => extractSourceLines(source).at(-1)?.code)).toEqual([
			'export const visible = true',
			'export const visible = true',
			'export const visible = true',
			'export const visible = true',
		])
	})

	it('consumes keyword-shaped private identifiers atomically in code and template substitutions', () => {
		const sources = [
			[
				'class Counter {',
				'\t#if = 1',
				'\tratio(total: number): number {',
				'\t\treturn this.#if / total /* open',
				'export const ghost = true',
				'*/',
				'\t}',
				'}',
				'export const visible = true',
			].join('\n'),
			[
				'class Counter {',
				'\t#if = 1',
				'\trender(): string { return `${this.#if / 2 /* note */}` }',
				'}',
				'export const visible = true',
			].join('\n'),
		]
		expect(
			sources.map((source) =>
				extractSourceLines(source)
					.filter((line) => line.code.startsWith('export const'))
					.map((line) => line.code),
			),
		).toEqual([['export const visible = true'], ['export const visible = true']])
	})

	it('keeps literal ECMAScript identifiers operand-complete before division', () => {
		const sources = [
			'const ratio = object.\u03c0 / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'class Counter {\n\t#\u03c0 = 1\n\tratio(): number { return this.#\u03c0 / 2 /* open\nexport const ghost = true\n*/ }\n}\nexport const visible = true',
			'const text = `${object.\u03c0 / 2 /* open\nexport const ghost = true\n*/}`\nexport const visible = true',
			'const \u{10400} = 1\nconst ratio = \u{10400} / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'const e\u0301 = 1\nconst ratio = e\u0301 / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'const a\u200C = 1\nconst ratio = a\u200C / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'const a\u200D = 1\nconst ratio = a\u200D / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'const $ = 1\nconst ratio = $ / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'const _ = 1\nconst ratio = _ / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'const value = object.\\u03c0 / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
		]
		expect(
			sources.map((source) =>
				extractSourceLines(source)
					.filter((line) => line.code.startsWith('export const'))
					.map((line) => line.code),
			),
		).toEqual(sources.map(() => ['export const visible = true']))
	})

	it('recognizes empty and elided for-of binding completion without disturbing controls', () => {
		const sources = [
			'for (const {} of /[/*]/ as unknown as readonly object[]) {}\nexport const visible = true',
			'for (const [] of /[/*]/ as unknown as readonly unknown[][]) {}\nexport const visible = true',
			'for (const [,,] of /[/*]/ as unknown as readonly unknown[][]) {}\nexport const visible = true',
			'for (const [{}, []] of /[/*]/ as unknown as readonly [object, unknown[]][]) {}\nexport const visible = true',
			'for (const { value } of /[/*]/ as unknown as readonly { value: string }[]) {}\nexport const visible = true',
			'for (const [{ value }] of /[/*]/ as unknown as readonly [{ value: string }][]) {}\nexport const visible = true',
			'for (const [value = /[/*]/] of [[]]) {}\nexport const visible = true',
			'for (const { [/x/.source]: value } of [{}]) {}\nexport const visible = true',
			'for (let index = 0; index < 1; index++) value\nexport const visible = true',
			'async function run() { for await (const value of /[/*]/ as unknown as readonly RegExp[]) value }\nexport const visible = true',
			'const ratio = object.of / total /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'for (const value of nested(call(/[/*]/))) value\nexport const visible = true',
			'for (const [{}, []] of of) {}\nexport const visible = true',
			'for (const [{}, of] of values) {}\nexport const visible = true',
		]
		expect(sources.map((source) => extractSourceLines(source).at(-1)?.code)).toEqual(
			sources.map(() => 'export const visible = true'),
		)
	})

	it('recognizes for-await, export-default, and extends expression positions', () => {
		const sources = [
			[
				'async function run() {',
				'\tfor await (const value of /[/*]/ as unknown as readonly RegExp[]) value',
				'}',
				'export const visible = true',
			].join('\n'),
			'export default /[/*]/\nexport const visible = true',
			'class Derived extends /[/*]/.constructor {}\nexport const visible = true',
		]
		expect(sources.map((source) => extractSourceLines(source).at(-1)?.code)).toEqual([
			'export const visible = true',
			'export const visible = true',
			'export const visible = true',
		])
	})

	it('recognizes restricted-statement and debugger linebreaks before slash-leading statements', () => {
		const sources = [
			"while (true) { break\n/[/*]/.test('') }\nexport const visible = true",
			"outer: while (true) { break outer\n/[/*]/.test('') }\nexport const visible = true",
			"for (;;) { continue\n/[/*]/.test('') }\nexport const visible = true",
			"outer: for (;;) { continue outer\n/[/*]/.test('') }\nexport const visible = true",
			"debugger\n/[/*]/.test('')\nexport const visible = true",
		]
		expect(sources.map((source) => extractSourceLines(source).at(-1)?.code)).toEqual([
			'export const visible = true',
			'export const visible = true',
			'export const visible = true',
			'export const visible = true',
			'export const visible = true',
		])
	})

	it('retains every adjacent lexical preservation control', () => {
		const sources = [
			'const value = !/[/*]/.test("x")\nexport const visible = true',
			'const value = left != /[/*]/.source\nexport const visible = true',
			'const value = left !== /[/*]/.source\nexport const visible = true',
			'const value = object.of / total /* open\nghost */\nexport const visible = true',
			'const value = object?.of / total /* open\nghost */\nexport const visible = true',
			'for (let index = 0; index < 1; index++) value\nexport const visible = true',
			'for (const value of /[/*]/) value\nexport const visible = true',
			'for (const value of nested(call(/[/*]/))) value\nexport const visible = true',
			"if (true) /[/*]/.test('')\nexport const visible = true",
			'const value = total / count /* note */\nexport const visible = true',
			'const value = /a\\/b[/*]/gi\nexport const visible = true',
			'const value = ({ count: 1 }) / total /* note */\nexport const visible = true',
			'const value = (() => ({ count: 1 }))() / total /* note */\nexport const visible = true',
			"if (true) {}; /[/*]/.test('')\nexport const visible = true",
			"let value;\n/[/*]/.test('')\nexport const visible = true",
			"var value;\n/[/*]/.test('')\nexport const visible = true",
			'const value = `raw /* ${/[/*]/.source}`\nexport const visible = true',
			"if (true) /[/*]/.test('')\r\nexport const visible = true",
		]
		expect(
			sources.every(
				(source) => extractSourceLines(source).at(-1)?.code === 'export const visible = true',
			),
		).toBe(true)
		const eofSource = 'export const visible = true /* open'
		const eofProjection = extractSourceLines(eofSource).at(-1)?.code
		expect(eofProjection?.length).toBe(eofSource.length)
		expect(eofProjection?.trimEnd()).toBe('export const visible = true')
	})

	it('keeps real block comments after postfix division from leaking declarations', () => {
		for (const operator of ['++', '--']) {
			const source = [
				`const ratio = count${operator} / total /* open`,
				'export const ghost = true',
				'*/',
				'export const visible = true',
			].join('\n')
			const declarations = extractSourceLines(source)
				.filter((line) => line.code.startsWith('export '))
				.map((line) => line.code)
			expect(declarations).toEqual(['export const visible = true'])
		}
	})

	it('keeps a real block comment after postfix non-null division', () => {
		const source = [
			'const ratio = count! / total /* open',
			'export const ghost = true',
			'*/',
			'export const visible = true',
		].join('\n')
		expect(
			extractSourceLines(source)
				.filter((line) => line.code.startsWith('export '))
				.map((line) => line.code),
		).toEqual(['export const visible = true'])
	})

	it('preserves regex literals after statement controls, spread, and contextual for-of', () => {
		for (const source of [
			"if (true) /[/*]/.test('*')\nexport const visible = true",
			'const values = [... /[/*]/]\nexport const visible = true',
			'for (const value of /[/*]/) value\nexport const visible = true',
		]) {
			expect(extractSourceLines(source).at(-1)?.code).toBe('export const visible = true')
		}
	})

	it('retains adjacent expression, member, for, and post-brace controls', () => {
		const sources = [
			'const a = !/[/*]/.test("x")\nexport const visible = true',
			'const a = value!! / total /* open\nghost */\nexport const visible = true',
			'const a = left != /[/*]/.source\nexport const visible = true',
			'const a = left !== /[/*]/.source\nexport const visible = true',
			'const a = object.of / total /* open\nghost */\nexport const visible = true',
			'const a = object?.of / total /* open\nghost */\nexport const visible = true',
			'for (let of = 0; of < 1; of++) value\nexport const visible = true',
			'for (const value of nested(call(/[/*]/))) value\nexport const visible = true',
			'const value = ({ count: 1 }) / total /* open\nghost */\nexport const visible = true',
			'if (true) {}; /[/*]/.test("x")\nexport const visible = true',
		]
		for (const source of sources) {
			expect(extractSourceLines(source).at(-1)?.code).toBe('export const visible = true')
		}
	})

	it('preserves LF and CRLF physical line counts and lengths', () => {
		for (const source of ['code // note\n/* block */\n', 'code // note\r\n/* block */\r\n']) {
			const original = source.split(/\r?\n/)
			const projected = extractSourceLines(source)
			expect(projected).toHaveLength(original.length)
			for (let index = 0; index < original.length; index += 1) {
				expect(projected[index]?.code.length).toBe(original[index]?.length)
			}
		}
	})

	it('masks multiline and same-line block spans while preserving surrounding code', () => {
		const source = ['const before = true /* open', 'hidden */ const after = true', ''].join('\n')
		expect(extractSourceLines(source).map((line) => line.code)).toEqual([
			'const before = true        ',
			'          const after = true',
			'',
		])
	})

	it('masks line comments through the physical line end', () => {
		expect(
			extractSourceLines('const visible = true // hidden\nconst next = true').map(
				(line) => line.code,
			),
		).toEqual(['const visible = true          ', 'const next = true'])
	})

	it('preserves single and double strings, escapes, inactive delimiters, and quoted markers', () => {
		const source = [
			`const single = '" // /* \\' still data'`,
			'const double = "\' // /* \\" still data"',
			"export * from './block/*comment.js' // trailing",
		].join('\n')
		expect(extractSourceLines(source).map((line) => line.code)).toEqual([
			`const single = '" // /* \\' still data'`,
			'const double = "\' // /* \\" still data"',
			"export * from './block/*comment.js'            ",
		])
	})

	it('masks multiline and nested templates while traversing substitutions', () => {
		const source = [
			'export const value = `outer ${',
			'{ nested: `inner ${/[/*]/.test(\'x\') ? `${1}` : "}"}` }',
			'} tail`',
			'export const after = true',
		].join('\n')
		const projected = extractSourceLines(source)
		expect(projected[0]?.code.startsWith('export const value = ')).toBe(true)
		expect(projected[0]?.code.slice('export const value = '.length).trim()).toBe('')
		expect(projected[1]?.code.trim()).toBe('')
		expect(projected[2]?.code.trim()).toBe('')
		expect(projected[3]?.code).toBe('export const after = true')
	})

	it('preserves regex escapes and classes, distinguishes division, and masks trailing comments', () => {
		const source = [
			'const pattern = /a\\/b[/*]/gi // regex note',
			'const ratio = total / count // division note',
		].join('\n')
		expect(extractSourceLines(source).map((line) => line.code)).toEqual([
			'const pattern = /a\\/b[/*]/gi              ',
			'const ratio = total / count                 ',
		])
	})

	it('preserves declarations adjacent to JSDoc and after a closed block', () => {
		const source = [
			'/** @example */',
			'export const documented = true',
			'/* closed */ export const following = true',
		].join('\n')
		expect(extractSourceLines(source).map((line) => line.code)).toEqual([
			'               ',
			'export const documented = true',
			'             export const following = true',
		])
	})

	it('masks unterminated blocks through EOF', () => {
		expect(
			extractSourceLines('const visible = true /* open\nhidden').map((line) => line.code),
		).toEqual(['const visible = true        ', '      '])
	})

	it('isolates malformed quote and regex state at unescaped line breaks', () => {
		const source = [
			"const malformed = 'open",
			'export const afterQuote = true',
			'const pattern = /open',
			'export const afterRegex = true',
		].join('\n')
		expect(extractSourceLines(source).map((line) => line.code)).toEqual(source.split('\n'))
	})
})

describe('symbolKey', () => {
	it('joins kind and name with a space', () => {
		expect(symbolKey({ name: 'Markdown', kind: 'class' })).toBe('class Markdown')
	})

	it('differs when kind differs', () => {
		expect(symbolKey({ name: 'X', kind: 'type' })).not.toBe(symbolKey({ name: 'X', kind: 'class' }))
	})
})

describe('SourceLine projections', () => {
	it('returns exact source, aligned code and genuine JSDoc for every physical line', () => {
		const source = [
			'/**',
			'',
			' * @example',
			' */',
			'export function visible(): void {} // note',
			'',
		].join('\r\n')
		const lines: readonly SourceLine[] = extractSourceLines(source)
		const raw = source.split(/\r?\n/)
		expect(lines.map((line) => line.source)).toEqual(raw)
		expect(lines.every((line) => line.code.length === line.source.length)).toBe(true)
		expect(
			lines.every((line) => line.jsdoc === undefined || line.jsdoc.length === line.source.length),
		).toBe(true)
		expect(lines[1]?.jsdoc).toBe('')
		expect(lines[4]?.jsdoc).toBeUndefined()
		expect(extractExampleLines(lines).map((line) => line.source)).toEqual([
			'export function visible(): void {} // note',
		])
	})

	it('retains every genuine JSDoc span at its physical column and source length', () => {
		const sources = [
			'const value = 1; /** first */',
			'identifier /** first */ /** second */',
			'  /** first */   /** second */',
			'before /** first */ between /** second */ after',
			['/**', ' * first', ' */ /** second */', ''].join('\r\n'),
			'/** first */\n',
			'/** unterminated',
		]

		for (const source of sources) {
			for (const line of extractSourceLines(source)) {
				expect(line.code.length).toBe(line.source.length)
				if (line.jsdoc === undefined) continue
				expect(line.jsdoc.length).toBe(line.source.length)
				expect(Array.from(line.jsdoc.matchAll(/\/\*\*/g), (match) => match.index)).toEqual(
					Array.from(line.source.matchAll(/\/\*\*/g), (match) => match.index),
				)
			}
		}
	})
})

describe('findMissing', () => {
	it('returns an empty array when names is empty', () => {
		expect(findMissing([], ['a'])).toEqual([])
	})

	it('returns every name when source is empty', () => {
		expect(findMissing(['a', 'b'], [])).toEqual(['a', 'b'])
	})

	it('returns names in names but not in source (partial overlap)', () => {
		expect(findMissing(['a', 'b'], ['a'])).toEqual(['b'])
	})

	it('returns every name when the sets are disjoint', () => {
		expect(findMissing(['a', 'b'], ['c', 'd'])).toEqual(['a', 'b'])
	})

	it('keeps duplicate names present in names but absent from source', () => {
		expect(findMissing(['a', 'a', 'b'], [])).toEqual(['a', 'a', 'b'])
	})

	it('drops a duplicate name once it appears in source', () => {
		expect(findMissing(['a', 'a', 'b'], ['a'])).toEqual(['b'])
	})
})

describe('missingSymbols', () => {
	const widget: SurfaceSymbol = { name: 'Widget', kind: 'class' }
	const kind: SurfaceSymbol = { name: 'WidgetKind', kind: 'type' }

	it('returns an empty array when symbols is empty', () => {
		expect(missingSymbols([], [widget])).toEqual([])
	})

	it('returns symbol keys present in symbols but absent from source', () => {
		expect(missingSymbols([widget, kind], [widget])).toEqual(['type WidgetKind'])
	})

	it('treats same-name different-kind symbols as distinct (both directions)', () => {
		const asConst: SurfaceSymbol = { name: 'Widget', kind: 'const' }
		expect(missingSymbols([asConst], [widget])).toEqual(['const Widget'])
		expect(missingSymbols([widget], [asConst])).toEqual(['class Widget'])
	})

	it('returns an empty array when both lists match exactly', () => {
		expect(missingSymbols([widget, kind], [widget, kind])).toEqual([])
	})
})

describe('isExternalLink', () => {
	it('treats http links as external', () => {
		expect(isExternalLink('http://example.com')).toBe(true)
	})

	it('treats https links as external', () => {
		expect(isExternalLink('https://example.com')).toBe(true)
	})

	it('treats mailto links as external', () => {
		expect(isExternalLink('mailto:person@example.com')).toBe(true)
	})

	it('treats tel links as external', () => {
		expect(isExternalLink('tel:+15551234567')).toBe(true)
	})

	it('treats a bare in-document anchor as external', () => {
		expect(isExternalLink('#section')).toBe(true)
	})

	it('treats a relative path as not external', () => {
		expect(isExternalLink('../../src/core/helpers.ts')).toBe(false)
	})
})

describe('resolvePath', () => {
	it("canonicalizes a fully cancelled path to '.'", () => {
		expect(resolvePath('guides', '..')).toBe('.')
	})

	it('resolves from the workspace root and nested directories', () => {
		expect(resolvePath('.', './root.ts')).toBe('root.ts')
		expect(resolvePath('guides/nested', './spec.md')).toBe('guides/nested/spec.md')
	})

	it('treats dotted directory names as ordinary path components', () => {
		expect(resolvePath('guides/.draft', '../src/guide.md')).toBe('guides/src/guide.md')
	})

	it('retains every excess parent from root and nested directories', () => {
		expect(resolvePath('.', '../../outside.ts')).toBe('../../outside.ts')
		expect(resolvePath('guides/nested', '../../../outside.ts')).toBe('../outside.ts')
	})
})

describe('resolveLink', () => {
	it('resolves against the directory of a same-dir file', () => {
		expect(resolveLink('guides/src/widget.md', 'helpers.ts')).toBe('guides/src/helpers.ts')
	})

	it('resolves a ../ chain up through multiple directories', () => {
		expect(resolveLink('guides/src/widget.md', '../../src/core/helpers.ts')).toBe(
			'src/core/helpers.ts',
		)
	})

	it('resolves a target from a workspace-root file', () => {
		expect(resolveLink('index.ts', './root.ts')).toBe('root.ts')
	})

	it('drops ./ segments', () => {
		expect(resolveLink('guides/src/widget.md', './helpers.ts')).toBe('guides/src/helpers.ts')
	})

	it('resolves from dotted and extensionless declaring files', () => {
		expect(resolveLink('guides/.draft/guide.md', './helpers.ts')).toBe('guides/.draft/helpers.ts')
		expect(resolveLink('guides/README', './src/guide.md')).toBe('guides/src/guide.md')
	})

	it('keeps a leading .. when it has nothing to pop', () => {
		expect(resolveLink('widget.md', '../../gone.ts')).toBe('../../gone.ts')
	})

	it('preserves every excess leading parent instead of cancelling them', () => {
		expect(resolveLink('module/index.ts', '../../../outside.ts')).toBe('../../outside.ts')
	})
})

describe('identifierOf', () => {
	it('returns a bare identifier unchanged', () => {
		expect(identifierOf('fold')).toBe('fold')
	})

	it('strips a single generic parameter list', () => {
		expect(identifierOf('MarkdownHandler<TNode, T>')).toBe('MarkdownHandler')
	})

	it('strips nested generic parameter lists', () => {
		expect(identifierOf('A<B<C>>')).toBe('A')
	})

	it('trims whitespace around the identifier', () => {
		expect(identifierOf('  Widget  <T>')).toBe('Widget')
	})

	it('returns an empty string for empty input', () => {
		expect(identifierOf('')).toBe('')
	})
})

describe('kindIndex', () => {
	it('finds the Kind column when present', () => {
		const table = requireTable('| Name | Kind |\n| --- | --- |\n| `X` | class |\n')
		expect(kindIndex(table)).toBe(1)
	})

	it('returns undefined when no Kind header exists', () => {
		const table = requireTable('| Name | Description |\n| --- | --- |\n| `X` | none |\n')
		expect(kindIndex(table)).toBeUndefined()
	})

	it('finds the Kind column when the header is reordered', () => {
		const table = requireTable('| Kind | Name |\n| --- | --- |\n| class | `X` |\n')
		expect(kindIndex(table)).toBe(0)
	})
})

describe('firstCode', () => {
	it('returns a plain code span value', () => {
		expect(firstCode([{ element: 'codeSpan', value: 'Widget' }])).toBe('Widget')
	})

	it('finds a code span nested inside emphasis', () => {
		expect(
			firstCode([
				{
					element: 'emphasis',
					strong: false,
					children: [{ element: 'codeSpan', value: 'Widget' }],
				},
			]),
		).toBe('Widget')
	})

	it('finds a code span nested inside a link', () => {
		expect(
			firstCode([
				{
					element: 'link',
					href: 'widget.md',
					children: [{ element: 'codeSpan', value: 'Widget' }],
				},
			]),
		).toBe('Widget')
	})

	it('finds a code span nested inside an image', () => {
		expect(
			firstCode([
				{
					element: 'image',
					src: 'widget.png',
					children: [{ element: 'codeSpan', value: 'Widget' }],
				},
			]),
		).toBe('Widget')
	})

	it('returns undefined when no code span is present', () => {
		expect(firstCode([{ element: 'text', value: 'Widget' }])).toBeUndefined()
	})
})

describe('cellLinks', () => {
	it('returns a plain link cell href', () => {
		expect(
			cellLinks([{ element: 'link', href: 'x.ts', children: [{ element: 'text', value: 'x' }] }]),
		).toEqual(['x.ts'])
	})

	it('returns multiple link hrefs in order', () => {
		expect(
			cellLinks([
				{ element: 'link', href: 'a.ts', children: [{ element: 'text', value: 'a' }] },
				{ element: 'text', value: ' ' },
				{ element: 'link', href: 'b.ts', children: [{ element: 'text', value: 'b' }] },
			]),
		).toEqual(['a.ts', 'b.ts'])
	})

	it('returns an empty array when the cell has no links', () => {
		expect(cellLinks([{ element: 'text', value: 'plain' }])).toEqual([])
	})

	it('finds a link nested inside emphasis', () => {
		expect(
			cellLinks([
				{
					element: 'emphasis',
					strong: false,
					children: [
						{ element: 'link', href: 'x.ts', children: [{ element: 'text', value: 'x' }] },
					],
				},
			]),
		).toEqual(['x.ts'])
	})
})

describe('normalizeDirectories', () => {
	it('canonicalizes root, trailing, and dot-segment spellings with first-seen deduplication', () => {
		expect(normalizeDirectories(['', '.', './', 'src/', './src', 'src/core/..'])).toEqual([
			'.',
			'src',
		])
	})

	it('wraps a single string module into a one-element list', () => {
		expect(normalizeDirectories('src/core')).toEqual(['src/core'])
	})

	it('returns a multi-directory module unchanged', () => {
		expect(normalizeDirectories(['src/core', 'src/browser'])).toEqual(['src/core', 'src/browser'])
	})
})

describe('selectModuleKeys', () => {
	it('rejects empty, dot, and parent segments anywhere while retaining dotfiles', () => {
		const files = {
			'src/../outside.ts': '',
			'src/./alias.ts': '',
			'src//double.ts': '',
			'src/.hidden.ts': '',
			'src/..file.ts': '',
			'src/visible.ts': '',
		}
		expect(selectModuleKeys(files, 'src')).toEqual([
			'src/..file.ts',
			'src/.hidden.ts',
			'src/visible.ts',
		])
	})

	it('uses exact canonical root membership without normalizing opaque inventory keys', () => {
		const files = {
			'root.ts': '',
			'index.ts': '',
			'./alias.ts': '',
			'../alias.ts': '',
			'/alias.ts': '',
		}
		expect(selectModuleKeys(files, '.')).toEqual(['root.ts'])
	})

	it('excludes every selected exact index independently of directory order', () => {
		const files = {
			'src/value.ts': '',
			'src/index.ts': '',
			'src/core/value.ts': '',
			'src/core/index.ts': '',
		}
		const expected = ['src/core/value.ts', 'src/value.ts']
		expect(selectModuleKeys(files, ['src', 'src/core'])).toEqual(expected)
		expect(selectModuleKeys(files, ['src/core', 'src'])).toEqual(expected)
	})

	it('filters to files under the scope directory ending in .ts', () => {
		const files = { 'src/core/Guide.ts': '', 'src/other/X.ts': '' }
		expect(selectModuleKeys(files, 'src/core')).toEqual(['src/core/Guide.ts'])
	})

	it("excludes the scope directory's index.ts", () => {
		const files = { 'src/core/Guide.ts': '', 'src/core/index.ts': '' }
		expect(selectModuleKeys(files, 'src/core')).toEqual(['src/core/Guide.ts'])
	})

	it('excludes .test.ts files', () => {
		const files = { 'src/core/Guide.ts': '', 'src/core/Guide.test.ts': '' }
		expect(selectModuleKeys(files, 'src/core')).toEqual(['src/core/Guide.ts'])
	})

	it('unions keys across multiple scope directories', () => {
		const files = { 'src/core/Guide.ts': '', 'src/browser/Widget.ts': '', 'src/other/X.ts': '' }
		expect(selectModuleKeys(files, ['src/core', 'src/browser'])).toEqual([
			'src/browser/Widget.ts',
			'src/core/Guide.ts',
		])
	})

	it('returns keys sorted', () => {
		const files = { 'src/core/b.ts': '', 'src/core/a.ts': '' }
		expect(selectModuleKeys(files, 'src/core')).toEqual(['src/core/a.ts', 'src/core/b.ts'])
	})

	it('ignores non-.ts files and non-matching directories', () => {
		const files = { 'src/core/Guide.ts': '', 'src/core/README.md': '', 'other/X.ts': '' }
		expect(selectModuleKeys(files, 'src/core')).toEqual(['src/core/Guide.ts'])
	})
})

describe('hasCanonicalSegments', () => {
	it('rejects empty, dot, and parent segments without rejecting dotfiles', () => {
		expect(['src/visible.ts', 'src/.hidden.ts', 'src/..file.ts'].every(hasCanonicalSegments)).toBe(
			true,
		)
		expect(
			['', '/root.ts', 'src/', 'src//alias.ts', 'src/./alias.ts', 'src/../alias.ts'].some(
				hasCanonicalSegments,
			),
		).toBe(false)
	})
})

describe('findUnexampled', () => {
	it('keeps a name absent from both fences and examples', () => {
		expect(findUnexampled(['walk', 'fold'], ['walk()'], [])).toEqual(['fold'])
	})

	it('drops a name present in examples even with no fence mention', () => {
		expect(findUnexampled(['walk'], [], ['walk'])).toEqual([])
	})

	it('drops a name found in a fence at a word boundary', () => {
		expect(findUnexampled(['walk'], ["import { walk } from 'x'"], [])).toEqual([])
	})

	it("does not match a name that is only a substring of a longer identifier ('walk' vs 'walkNodes')", () => {
		expect(findUnexampled(['walk'], ['walkNodes()'], [])).toEqual(['walk'])
	})

	it('checks every fence, not just the first', () => {
		expect(findUnexampled(['walk'], ['no match here', 'walk()'], [])).toEqual([])
	})

	it('returns an empty array when every name is exampled', () => {
		expect(findUnexampled(['a', 'b'], [], ['a', 'b'])).toEqual([])
	})
})

describe('fenceImports', () => {
	it('parses a single named import', () => {
		expect(fenceImports("import { a } from 'x'\n")).toEqual([{ specifier: 'x', names: ['a'] }])
	})

	it('parses multiple names from one specifier', () => {
		expect(fenceImports("import { a, b } from 'x'\n")).toEqual([
			{ specifier: 'x', names: ['a', 'b'] },
		])
	})

	it('strips the type keyword from a mixed import', () => {
		expect(fenceImports("import { type A, b } from 'x'\n")).toEqual([
			{ specifier: 'x', names: ['A', 'b'] },
		])
	})

	it('resolves import type { ... } to the plain names', () => {
		expect(fenceImports("import type { A, B } from 'x'\n")).toEqual([
			{ specifier: 'x', names: ['A', 'B'] },
		])
	})

	it('resolves an aliased import to its original exported name', () => {
		expect(fenceImports("import { a as c } from 'x'\n")).toEqual([{ specifier: 'x', names: ['a'] }])
	})

	it('parses a multiline import statement', () => {
		expect(fenceImports("import {\n\ta,\n\tb,\n} from 'x'\n")).toEqual([
			{ specifier: 'x', names: ['a', 'b'] },
		])
	})

	it('returns one entry per specifier across multiple import statements', () => {
		expect(fenceImports("import { a } from 'x'\nimport { b } from 'y'\n")).toEqual([
			{ specifier: 'x', names: ['a'] },
			{ specifier: 'y', names: ['b'] },
		])
	})

	it('returns an empty array for a fence with no imports', () => {
		expect(fenceImports('const x = 1\n')).toEqual([])
	})
})

describe('successor runtime surface', () => {
	it('exposes the final helpers and retires every replaced name', () => {
		expect({
			extractSourceLines: Object.hasOwn(core, 'extractSourceLines'),
			extractExampleLines: Object.hasOwn(core, 'extractExampleLines'),
			hasCanonicalSegments: Object.hasOwn(core, 'hasCanonicalSegments'),
			normalizeDirectories: Object.hasOwn(core, 'normalizeDirectories'),
			selectModuleKeys: Object.hasOwn(core, 'selectModuleKeys'),
			extractCodeLines: Object.hasOwn(core, 'extractCodeLines'),
			moduleDirs: Object.hasOwn(core, 'moduleDirs'),
			moduleKeys: Object.hasOwn(core, 'moduleKeys'),
		}).toEqual({
			extractSourceLines: true,
			extractExampleLines: true,
			hasCanonicalSegments: true,
			normalizeDirectories: true,
			selectModuleKeys: true,
			extractCodeLines: false,
			moduleDirs: false,
			moduleKeys: false,
		})
	})
})
