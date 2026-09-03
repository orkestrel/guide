import type { SourceLine, SurfaceSymbol } from '@src/core'
import * as core from '@src/core'
import {
	extractCellLinks,
	extractDeclaration,
	extractExampleMethods,
	extractExamples,
	extractExports,
	extractExampleLines,
	extractLinks,
	extractMethods,
	extractFences,
	extractSourceLines,
	extractSurface,
	extractTests,
	extractFenceImports,
	findMissing,
	findUnexampled,
	findUnlisted,
	findFirstCode,
	normalizeIdentifier,
	isExternalLink,
	hasCanonicalSegments,
	extractHidden,
	joinHead,
	escapeRegExp,
	findKindIndex,
	extractMemberMethods,
	findMissingSymbols,
	normalizeDirectories,
	resolveLink,
	resolvePath,
	selectSectionBlocks,
	selectModuleKeys,
	computeSymbolKey,
} from '@src/core'
import { createMarkdown } from '@orkestrel/markdown'
import { describe, expect, it } from 'vitest'
import { requireTable } from '../../setup.js'
import { readInventory } from '@orkestrel/test/server'
import { requireText } from '../../setupServer.js'

const FIXTURES = readInventory(new URL('../../fixtures/', import.meta.url), ['.'])

// Every pure leaf behind the guides-parity scanners — the source-line
// projection and its declaration/member/JSDoc grammars, the guide-markdown
// section scoping and Surface/Methods/Links/Tests/Patterns extraction, symbol
// keying, set-difference, link classification/resolution, generic-name
// normalization, and table-column/inline lookups. Pure and total; each mirrors
// one exported helpers.ts symbol (AGENTS §16).

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

describe('computeSymbolKey', () => {
	it('joins kind and name with a space', () => {
		expect(computeSymbolKey({ name: 'Markdown', kind: 'class' })).toBe('class Markdown')
	})

	it('differs when kind differs', () => {
		expect(computeSymbolKey({ name: 'X', kind: 'type' })).not.toBe(
			computeSymbolKey({ name: 'X', kind: 'class' }),
		)
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

describe('findUnlisted', () => {
	it('returns fences whose language is absent from the allowed list', () => {
		const document = createMarkdown('```typescript\nwalk()\n```\n').document
		const fences = extractFences(document)
		expect(findUnlisted(fences, ['ts'])).toEqual([{ language: 'typescript', code: 'walk()' }])
	})

	it('always returns an untagged fence', () => {
		const document = createMarkdown('```\nwalk()\n```\n').document
		const fences = extractFences(document)
		expect(findUnlisted(fences, [])).toEqual([{ language: undefined, code: 'walk()' }])
		expect(findUnlisted(fences, ['ts', 'typescript'])).toEqual([
			{ language: undefined, code: 'walk()' },
		])
	})

	it('returns an empty array when every fence language is listed', () => {
		const document = createMarkdown('```ts\nwalk()\n```\n\n```json\n{}\n```\n').document
		expect(findUnlisted(extractFences(document), ['ts', 'json'])).toEqual([])
	})
})

describe('findMissingSymbols', () => {
	const widget: SurfaceSymbol = { name: 'Widget', kind: 'class' }
	const kind: SurfaceSymbol = { name: 'WidgetKind', kind: 'type' }

	it('returns an empty array when symbols is empty', () => {
		expect(findMissingSymbols([], [widget])).toEqual([])
	})

	it('returns symbol keys present in symbols but absent from source', () => {
		expect(findMissingSymbols([widget, kind], [widget])).toEqual(['type WidgetKind'])
	})

	it('treats same-name different-kind symbols as distinct (both directions)', () => {
		const asConst: SurfaceSymbol = { name: 'Widget', kind: 'const' }
		expect(findMissingSymbols([asConst], [widget])).toEqual(['const Widget'])
		expect(findMissingSymbols([widget], [asConst])).toEqual(['class Widget'])
	})

	it('returns an empty array when both lists match exactly', () => {
		expect(findMissingSymbols([widget, kind], [widget, kind])).toEqual([])
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

describe('normalizeIdentifier', () => {
	it('returns a bare identifier unchanged', () => {
		expect(normalizeIdentifier('fold')).toBe('fold')
	})

	it('strips a single generic parameter list', () => {
		expect(normalizeIdentifier('MarkdownHandler<TNode, T>')).toBe('MarkdownHandler')
	})

	it('strips nested generic parameter lists', () => {
		expect(normalizeIdentifier('A<B<C>>')).toBe('A')
	})

	it('trims whitespace around the identifier', () => {
		expect(normalizeIdentifier('  Widget  <T>')).toBe('Widget')
	})

	it('returns an empty string for empty input', () => {
		expect(normalizeIdentifier('')).toBe('')
	})
})

describe('findKindIndex', () => {
	it('finds the Kind column when present', () => {
		const table = requireTable('| Name | Kind |\n| --- | --- |\n| `X` | class |\n')
		expect(findKindIndex(table)).toBe(1)
	})

	it('returns undefined when no Kind header exists', () => {
		const table = requireTable('| Name | Description |\n| --- | --- |\n| `X` | none |\n')
		expect(findKindIndex(table)).toBeUndefined()
	})

	it('finds the Kind column when the header is reordered', () => {
		const table = requireTable('| Kind | Name |\n| --- | --- |\n| class | `X` |\n')
		expect(findKindIndex(table)).toBe(0)
	})
})

describe('findFirstCode', () => {
	it('returns a plain code span value', () => {
		expect(findFirstCode([{ element: 'codeSpan', value: 'Widget' }])).toBe('Widget')
	})

	it('finds a code span nested inside emphasis', () => {
		expect(
			findFirstCode([
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
			findFirstCode([
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
			findFirstCode([
				{
					element: 'image',
					src: 'widget.png',
					children: [{ element: 'codeSpan', value: 'Widget' }],
				},
			]),
		).toBe('Widget')
	})

	it('returns undefined when no code span is present', () => {
		expect(findFirstCode([{ element: 'text', value: 'Widget' }])).toBeUndefined()
	})
})

describe('extractCellLinks', () => {
	it('returns a plain link cell href', () => {
		expect(
			extractCellLinks([
				{ element: 'link', href: 'x.ts', children: [{ element: 'text', value: 'x' }] },
			]),
		).toEqual(['x.ts'])
	})

	it('returns multiple link hrefs in order', () => {
		expect(
			extractCellLinks([
				{ element: 'link', href: 'a.ts', children: [{ element: 'text', value: 'a' }] },
				{ element: 'text', value: ' ' },
				{ element: 'link', href: 'b.ts', children: [{ element: 'text', value: 'b' }] },
			]),
		).toEqual(['a.ts', 'b.ts'])
	})

	it('returns an empty array when the cell has no links', () => {
		expect(extractCellLinks([{ element: 'text', value: 'plain' }])).toEqual([])
	})

	it('finds a link nested inside emphasis', () => {
		expect(
			extractCellLinks([
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

	it('reads a regex metacharacter in a name as literal text', () => {
		expect(findUnexampled(['widget.render'], ['widgetxrender()'], [])).toEqual(['widget.render'])
	})

	it('keeps a name carrying a bracket instead of throwing', () => {
		expect(findUnexampled(['widget['], ['widget()'], [])).toEqual(['widget['])
	})
})

describe('extractFenceImports', () => {
	it('parses a single named import', () => {
		expect(extractFenceImports("import { a } from 'x'\n")).toEqual([
			{ specifier: 'x', names: ['a'] },
		])
	})

	it('parses multiple names from one specifier', () => {
		expect(extractFenceImports("import { a, b } from 'x'\n")).toEqual([
			{ specifier: 'x', names: ['a', 'b'] },
		])
	})

	it('strips the type keyword from a mixed import', () => {
		expect(extractFenceImports("import { type A, b } from 'x'\n")).toEqual([
			{ specifier: 'x', names: ['A', 'b'] },
		])
	})

	it('resolves import type { ... } to the plain names', () => {
		expect(extractFenceImports("import type { A, B } from 'x'\n")).toEqual([
			{ specifier: 'x', names: ['A', 'B'] },
		])
	})

	it('resolves an aliased import to its original exported name', () => {
		expect(extractFenceImports("import { a as c } from 'x'\n")).toEqual([
			{ specifier: 'x', names: ['a'] },
		])
	})

	it('parses a multiline import statement', () => {
		expect(extractFenceImports("import {\n\ta,\n\tb,\n} from 'x'\n")).toEqual([
			{ specifier: 'x', names: ['a', 'b'] },
		])
	})

	it('returns one entry per specifier across multiple import statements', () => {
		expect(extractFenceImports("import { a } from 'x'\nimport { b } from 'y'\n")).toEqual([
			{ specifier: 'x', names: ['a'] },
			{ specifier: 'y', names: ['b'] },
		])
	})

	it('returns an empty array for a fence with no imports', () => {
		expect(extractFenceImports('const x = 1\n')).toEqual([])
	})
})

describe('selectSectionBlocks', () => {
	it('scopes to the blocks between a heading and the next ## heading', () => {
		const document = createMarkdown('## A\n\npara-a\n\n## B\n\npara-b\n').document
		const blocks = selectSectionBlocks(document, 'A')
		expect(blocks).toHaveLength(1)
	})

	it('runs to the document end when no later ## heading exists', () => {
		const document = createMarkdown('## A\n\npara-a\n\npara-a2\n').document
		expect(selectSectionBlocks(document, 'A')).toHaveLength(2)
	})

	it('returns an empty array when the heading is missing', () => {
		const document = createMarkdown('## A\n\npara-a\n').document
		expect(selectSectionBlocks(document, 'B')).toEqual([])
	})

	it('stops at a level-1 or level-2 heading but not a level-3 heading', () => {
		const document = createMarkdown('## A\n\n### Sub\n\npara\n\n## B\n\npara-b\n').document
		const blocks = selectSectionBlocks(document, 'A')
		expect(blocks).toHaveLength(2)
	})
})

describe('successor lexical and reflection boundaries', () => {
	it('extractExports carries every hostile lexical transition to direct reflection', () => {
		for (const source of [
			'const ratio = count++ / total /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'const ratio = count-- / total /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'const ratio = count! / total /* open\nexport const ghost = true\n*/\nexport const visible = true',
			"if (true) /[/*]/.test('*')\nexport const visible = true",
			'const values = [... /[/*]/]\nexport const visible = true',
			'for (const value of /[/*]/) value\nexport const visible = true',
		]) {
			expect(extractExports(source)).toEqual([{ name: 'visible', kind: 'const' }])
		}
	})

	it('extractExports excludes comments after ordinary and private literal Unicode identifiers', () => {
		const sources = [
			'const ratio = object.\u03c0 / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'class Counter {\n\t#\u03c0 = 1\n\tratio(): number { return this.#\u03c0 / 2 /* open\nexport const ghost = true\n*/ }\n}\nexport const visible = true',
		]
		expect(sources.map(extractExports)).toEqual(
			sources.map(() => [{ name: 'visible', kind: 'const' }]),
		)
	})

	it('extractExports preserves declarations after empty and elided for-of bindings', () => {
		const sources = [
			'for (const {} of /[/*]/ as unknown as readonly object[]) {}\nexport const visible = true',
			'for (const [] of /[/*]/ as unknown as readonly unknown[][]) {}\nexport const visible = true',
			'for (const [,,] of /[/*]/ as unknown as readonly unknown[][]) {}\nexport const visible = true',
			'for (const [{}, []] of /[/*]/ as unknown as readonly [object, unknown[]][]) {}\nexport const visible = true',
		]
		expect(sources.map(extractExports)).toEqual(
			sources.map(() => [{ name: 'visible', kind: 'const' }]),
		)
	})

	it('keeps leading and interrupted comment payload outside anchored declaration membership', () => {
		const source = [
			'/* hidden */ export const interrupted = true',
			'/*',
			'export const leading = true',
			'*/',
			'export const visible = true /* trailing */',
		].join('\n')
		expect(extractExports(source)).toEqual([{ name: 'visible', kind: 'const' }])
		expect(extractHidden(source.replaceAll('export ', ''))).toEqual([
			{ name: 'visible', kind: 'const' },
		])
	})

	it('extractDeclaration ignores commented declarations and commented closes', () => {
		const source = [
			'/*',
			'export interface Ghost {',
			'\tphantom(): void',
			'}',
			'*/',
			'export interface Ghost {',
			'\t/*',
			'}',
			'\t*/',
			'\tvisible(): void',
			'}',
		].join('\n')
		expect(extractDeclaration(source, 'interface', 'Ghost')?.body).toEqual([
			'\t/*',
			'}',
			'\t*/',
			'\tvisible(): void',
		])
	})

	it('extractMemberMethods excludes commented candidates', () => {
		expect(extractMemberMethods(['\t/*', '\tghost(): void', '\t*/', '\tvisible(): void'])).toEqual([
			'visible',
		])
	})

	it('extractExampleMethods keeps raw JSDoc evidence but rejects commented candidates', () => {
		const lines = [
			'\t/** @example */',
			'\tvisible(): void',
			'\t/** @example */',
			'\t/* ghost(): void */',
		]
		expect(extractExampleMethods(lines)).toEqual(['visible'])
	})
})

describe('extractSurface', () => {
	it("extracts the good fixture guide's exact 6-symbol surface", () => {
		const document = createMarkdown(requireText(FIXTURES, 'good/guides/src/widget.md')).document
		const surface = extractSurface(document)
		expect(surface).toEqual([
			{ name: 'WidgetInterface', kind: 'interface' },
			{ name: 'WidgetKind', kind: 'type' },
			{ name: 'createLabel', kind: 'function' },
			{ name: 'loadWidget', kind: 'function' },
			{ name: 'DEFAULT_COUNT', kind: 'const' },
			{ name: 'Widget', kind: 'class' },
		])
	})

	it('normalizes a generic-annotated table row to its bare identifier', () => {
		const document = createMarkdown(requireText(FIXTURES, 'good/guides/src/widget.md')).document
		const surface = extractSurface(document)
		expect(surface.some((symbol) => symbol.name === 'WidgetInterface')).toBe(true)
		expect(surface.some((symbol) => symbol.name.includes('<'))).toBe(false)
	})

	it('unions a backticked H3 entity heading as a class symbol', () => {
		const document = createMarkdown(requireText(FIXTURES, 'good/guides/src/widget.md')).document
		const surface = extractSurface(document)
		expect(surface).toContainEqual({ name: 'Widget', kind: 'class' })
	})

	it('extracts empty when the Surface heading was renamed', () => {
		const document = createMarkdown(
			requireText(FIXTURES, 'broken/renamed-surface/widget.md'),
		).document
		expect(extractSurface(document)).toEqual([])
	})
})

describe('extractMethods', () => {
	it('extracts one group of inspect/render/reset from the good fixture', () => {
		const document = createMarkdown(requireText(FIXTURES, 'good/guides/src/widget.md')).document
		expect(extractMethods(document)).toEqual([
			{ interface: 'WidgetInterface', methods: ['inspect', 'render', 'reset'] },
		])
	})

	it('reflects a missing method row (missing-interface-method fixture)', () => {
		const document = createMarkdown(
			requireText(FIXTURES, 'broken/missing-interface-method/widget.md'),
		).document
		expect(extractMethods(document)).toEqual([
			{ interface: 'WidgetInterface', methods: ['inspect', 'render'] },
		])
	})

	it('reflects a phantom method row (phantom-method fixture)', () => {
		const document = createMarkdown(
			requireText(FIXTURES, 'broken/phantom-method/widget.md'),
		).document
		expect(extractMethods(document)).toEqual([
			{ interface: 'WidgetInterface', methods: ['inspect', 'render', 'reset', 'destroy'] },
		])
	})
})

describe('extractLinks', () => {
	it('includes links found inside table cells', () => {
		const markdown = '| Name | Link |\n| --- | --- |\n| a | [x](./x.ts) |\n'
		const document = createMarkdown(markdown).document
		expect(extractLinks(document)).toEqual(['./x.ts'])
	})

	it('includes external hrefs as raw text', () => {
		const markdown = '[site](https://example.com)\n'
		const document = createMarkdown(markdown).document
		expect(extractLinks(document)).toEqual(['https://example.com'])
	})

	it('walks the whole document, not one section', () => {
		const markdown = '## A\n\n[a](a.md)\n\n## B\n\n[b](b.md)\n'
		const document = createMarkdown(markdown).document
		expect(extractLinks(document)).toEqual(['a.md', 'b.md'])
	})

	it('extracts every link in the good fixture guide, including the See-also style extra', () => {
		const document = createMarkdown(requireText(FIXTURES, 'broken/broken-link/widget.md')).document
		expect(extractLinks(document)).toContain('../../good/module/gone.ts')
	})
})

describe('extractTests', () => {
	it("extracts only the Tests section's links", () => {
		const document = createMarkdown(requireText(FIXTURES, 'good/guides/src/widget.md')).document
		expect(extractTests(document)).toEqual(['../../tests/widget.test.ts'])
	})

	it('excludes links outside the Tests section', () => {
		const document = createMarkdown(requireText(FIXTURES, 'broken/broken-link/widget.md')).document
		expect(extractTests(document)).toEqual(['../../good/tests/widget.test.ts'])
	})

	it('returns empty when the Tests heading is missing', () => {
		const document = createMarkdown('## Surface\n\npara\n').document
		expect(extractTests(document)).toEqual([])
	})
})

describe('extractExports', () => {
	it('excludes five-kind declarations inside a multiline block comment', () => {
		const source = [
			'/*',
			'export type GhostType = string',
			'export interface GhostInterface {}',
			'export const ghostConst = true',
			'export function ghostFunction(): void {}',
			'export class GhostClass {}',
			'*/',
			'export const visible = true',
			'',
		].join('\n')
		expect(extractExports(source)).toEqual([{ name: 'visible', kind: 'const' }])
	})

	it('retains five-kind code with literal initializers and comments while excluding enum', () => {
		const source = [
			'export type VisibleType = string // note',
			'export interface VisibleInterface {} /* note */',
			"export const stringValue = '/* data */' // note",
			'export const regexValue = /[/*]/ // note',
			'export const templateValue = `payload ${1}` // note',
			'export function visibleFunction(): void {} /* note */',
			'export class VisibleClass {} // note',
			'export enum Outside { Value }',
		].join('\n')
		expect(extractExports(source)).toEqual([
			{ name: 'VisibleType', kind: 'type' },
			{ name: 'VisibleInterface', kind: 'interface' },
			{ name: 'stringValue', kind: 'const' },
			{ name: 'regexValue', kind: 'const' },
			{ name: 'templateValue', kind: 'const' },
			{ name: 'visibleFunction', kind: 'function' },
			{ name: 'VisibleClass', kind: 'class' },
		])
	})

	it('scans all five ExportKind declarations from the good fixture types.ts', () => {
		const symbols = extractExports(requireText(FIXTURES, 'good/module/types.ts'))
		expect(symbols).toEqual([
			{ name: 'WidgetInterface', kind: 'interface' },
			{ name: 'WidgetKind', kind: 'type' },
		])
	})

	it('scans a plain function, an async function, a class, and a const', () => {
		const source =
			'export function a() {}\nexport async function b() {}\nexport class C {}\nexport const D = 1\n'
		expect(extractExports(source)).toEqual([
			{ name: 'a', kind: 'function' },
			{ name: 'b', kind: 'function' },
			{ name: 'C', kind: 'class' },
			{ name: 'D', kind: 'const' },
		])
	})

	it('scans a generator function as kind function', () => {
		expect(extractExports('export function* walk() {}\n')).toEqual([
			{ name: 'walk', kind: 'function' },
		])
	})

	it('dedupes a repeated (kind, name) pair', () => {
		const source = 'export class X {}\nexport class X {}\n'
		expect(extractExports(source)).toEqual([{ name: 'X', kind: 'class' }])
	})

	it('ignores non-export lines', () => {
		const source = 'const local = 1\nfunction helper() {}\nexport class Real {}\n'
		expect(extractExports(source)).toEqual([{ name: 'Real', kind: 'class' }])
	})
})

describe('extractHidden', () => {
	it('excludes five-kind declarations inside a multiline block comment', () => {
		const source = [
			'/*',
			'type GhostType = string',
			'interface GhostInterface {}',
			'const ghostConst = true',
			'function ghostFunction(): void {}',
			'class GhostClass {}',
			'*/',
			'const visible = true',
			'',
		].join('\n')
		expect(extractHidden(source)).toEqual([{ name: 'visible', kind: 'const' }])
	})

	it('retains hidden five-kind code with literal initializers and comments while excluding enum', () => {
		const source = [
			'type VisibleType = string // note',
			'interface VisibleInterface {} /* note */',
			"const stringValue = '/* data */' // note",
			'const regexValue = /[/*]/ // note',
			'const templateValue = `payload ${1}` // note',
			'function visibleFunction(): void {} /* note */',
			'class VisibleClass {} // note',
			'enum Outside { Value }',
		].join('\n')
		expect(extractHidden(source)).toEqual([
			{ name: 'VisibleType', kind: 'type' },
			{ name: 'VisibleInterface', kind: 'interface' },
			{ name: 'stringValue', kind: 'const' },
			{ name: 'regexValue', kind: 'const' },
			{ name: 'templateValue', kind: 'const' },
			{ name: 'visibleFunction', kind: 'function' },
			{ name: 'VisibleClass', kind: 'class' },
		])
	})

	it('detects a hidden function declaration', () => {
		expect(extractHidden('function secretHelper() {}\n')).toEqual([
			{ name: 'secretHelper', kind: 'function' },
		])
	})

	it('detects a hidden async function declaration', () => {
		expect(extractHidden('async function loadSecret() {}\n')).toEqual([
			{ name: 'loadSecret', kind: 'function' },
		])
	})

	it('detects a hidden generator declaration as kind function', () => {
		expect(extractHidden('function* walkSecret() {}\n')).toEqual([
			{ name: 'walkSecret', kind: 'function' },
		])
	})

	it('detects a hidden class declaration', () => {
		expect(extractHidden('class Secret {}\n')).toEqual([{ name: 'Secret', kind: 'class' }])
	})

	it('detects a hidden const declaration', () => {
		expect(extractHidden('const SECRET = 1\n')).toEqual([{ name: 'SECRET', kind: 'const' }])
	})

	it('detects a hidden interface declaration', () => {
		expect(extractHidden('interface Secret {}\n')).toEqual([{ name: 'Secret', kind: 'interface' }])
	})

	it('detects a hidden type declaration', () => {
		expect(extractHidden('type Secret = string\n')).toEqual([{ name: 'Secret', kind: 'type' }])
	})

	it('ignores exported lines', () => {
		const source = 'export function a() {}\nexport class C {}\nexport const D = 1\n'
		expect(extractHidden(source)).toEqual([])
	})

	it('ignores an indented declaration inside a body (column-0 anchor)', () => {
		const source = 'export class X {\n\tfunction inner() {}\n}\n'
		expect(extractHidden(source)).toEqual([])
	})

	it('returns empty for the good fixture types.ts (fully exported)', () => {
		expect(extractHidden(requireText(FIXTURES, 'good/module/types.ts'))).toEqual([])
	})

	it('finds the hidden-declaration fixture Widget.ts secretHelper', () => {
		const symbols = extractHidden(
			requireText(FIXTURES, 'broken/hidden-declaration/module/Widget.ts'),
		)
		expect(symbols).toEqual([{ name: 'secretHelper', kind: 'function' }])
	})
})

describe('joinHead', () => {
	it('joins a single-line head', () => {
		const lines = ['export class X {']
		expect(joinHead(lines, 0)).toEqual({ text: 'export class X {', end: 0 })
	})

	it('joins an oxfmt-wrapped multi-line head', () => {
		const lines = [
			'export interface WidgetInterface<',
			'\tT = Record<string, unknown>,',
			'> {',
			'\treadonly count: number',
			'}',
		]
		const head = joinHead(lines, 0)
		expect(head?.text).toBe('export interface WidgetInterface< T = Record<string, unknown>, > {')
	})

	it('joins a wrapped head with nested generics', () => {
		const lines = [
			'export interface BoxInterface<',
			'\tT = Record<string, Map<string, unknown>>,',
			'> {',
			'\treadonly count: number',
			'}',
		]
		const head = joinHead(lines, 0)
		expect(head?.text).toBe(
			'export interface BoxInterface< T = Record<string, Map<string, unknown>>, > {',
		)
	})

	it('joins the single-line head from the fixture types.ts text', () => {
		const lines = requireText(FIXTURES, 'good/module/types.ts').split(/\r?\n/)
		const start = lines.findIndex((line) => line.startsWith('export interface WidgetInterface'))
		const head = joinHead(lines, start)
		expect(head?.text).toBe('export interface WidgetInterface<T = Record<string, unknown>> {')
	})

	it('returns undefined when no line opens a body', () => {
		const lines = ['export const X = 1', 'export const Y = 2']
		expect(joinHead(lines, 0)).toBeUndefined()
	})
})

describe('escapeRegExp', () => {
	it('escapes every regex metacharacter', () => {
		expect(escapeRegExp('a.b+c*d?e^f$g(h)i[j]k{l}m|n\\o')).toBe(
			'a\\.b\\+c\\*d\\?e\\^f\\$g\\(h\\)i\\[j\\]k\\{l\\}m\\|n\\\\o',
		)
	})

	it('leaves an ordinary identifier unchanged', () => {
		expect(escapeRegExp('WidgetInterface')).toBe('WidgetInterface')
	})

	it('makes an escaped string match itself and nothing else', () => {
		const pattern = new RegExp(`^${escapeRegExp('A.B')}$`)
		expect({ literal: pattern.test('A.B'), wildcard: pattern.test('AxB') }).toEqual({
			literal: true,
			wildcard: false,
		})
	})

	it('escapes a metacharacter-only name into a pattern that matches that text', () => {
		expect(new RegExp(`^${escapeRegExp('.*')}$`).test('.*')).toBe(true)
	})
})

describe('extractDeclaration', () => {
	it('reads an interface body', () => {
		const source = 'export interface X {\n\twalk(): void\n}\n'
		expect(extractDeclaration(source, 'interface', 'X')).toEqual({
			body: ['\twalk(): void'],
			bases: [],
		})
	})

	it('reads a class body', () => {
		const source = 'export class X {\n\twalk(): void {}\n}\n'
		expect(extractDeclaration(source, 'class', 'X')).toEqual({
			body: ['\twalk(): void {}'],
			bases: [],
		})
	})

	it('reads a body from the fixture types.ts text', () => {
		const declaration = extractDeclaration(
			requireText(FIXTURES, 'good/module/types.ts'),
			'interface',
			'WidgetInterface',
		)
		expect(declaration?.body).toEqual([
			'\treadonly count: number',
			'\tinspect(): string',
			'\trender(label: string, data?: T): string',
			'\treset(): void',
		])
	})

	it('reads the body and the bases from one head', () => {
		const source = 'export interface B extends A {\n\twalk(): void\n}\n'
		expect(extractDeclaration(source, 'interface', 'B')).toEqual({
			body: ['\twalk(): void'],
			bases: ['A'],
		})
	})

	it('returns undefined when the named declaration is missing', () => {
		expect(extractDeclaration('export class X {\n}\n', 'interface', 'Y')).toBeUndefined()
	})

	it('separates an empty declared body from an absent declaration', () => {
		expect({
			declared: extractDeclaration('export interface X {\n}\n', 'interface', 'X'),
			absent: extractDeclaration('export interface X {\n}\n', 'interface', 'Y'),
		}).toEqual({ declared: { body: [], bases: [] }, absent: undefined })
	})

	it('accepts a generic head', () => {
		expect(extractDeclaration('export interface X<T> {\n}\n', 'interface', 'X')).toEqual({
			body: [],
			bases: [],
		})
	})

	it('rejects a longer identifier sharing the prefix', () => {
		expect(extractDeclaration('export interface Xtra {\n}\n', 'interface', 'X')).toBeUndefined()
	})

	it('rejects the other keyword', () => {
		expect(extractDeclaration('export class X {\n}\n', 'interface', 'X')).toBeUndefined()
	})

	it('rejects a head that opens no body', () => {
		expect(extractDeclaration('export interface X\n', 'interface', 'X')).toBeUndefined()
	})

	it('reads a regex metacharacter in the name as literal text', () => {
		expect(
			extractDeclaration('export interface Anything {\n}\n', 'interface', '.*'),
		).toBeUndefined()
	})

	it('reads a qualified name literally rather than as a wildcard', () => {
		expect({
			literal: extractDeclaration('export interface A.B {\n}\n', 'interface', 'A.B'),
			wildcard: extractDeclaration('export interface AxB {\n}\n', 'interface', 'A.B'),
		}).toEqual({ literal: { body: [], bases: [] }, wildcard: undefined })
	})

	it('returns undefined rather than throwing for a name carrying an unbalanced bracket', () => {
		expect(
			extractDeclaration('export interface Widget {\n}\n', 'interface', 'Widget['),
		).toBeUndefined()
	})

	it('returns undefined rather than throwing for a name carrying an open group', () => {
		expect(
			extractDeclaration('export interface Widget {\n}\n', 'interface', 'Widget('),
		).toBeUndefined()
	})

	it('reads a name carrying a dollar sign', () => {
		const source = 'export interface Widget$ {\n\twalk(): void\n}\n'
		expect(extractDeclaration(source, 'interface', 'Widget$')).toEqual({
			body: ['\twalk(): void'],
			bases: [],
		})
	})

	it('returns no base when the declaration extends nothing', () => {
		expect(extractDeclaration('export interface X {\n}\n', 'interface', 'X')?.bases).toEqual([])
	})

	it('returns every base in head order and strips generic arguments', () => {
		const source = 'export interface B extends A, C<T, U> {\n}\n'
		expect(extractDeclaration(source, 'interface', 'B')?.bases).toEqual(['A', 'C'])
	})

	it('reads past a type parameter that carries its own extends', () => {
		const source = 'export interface B<T extends A> extends C {\n}\n'
		expect(extractDeclaration(source, 'interface', 'B')?.bases).toEqual(['C'])
	})

	it('excludes a class implements clause', () => {
		const source = 'export class B extends A implements I, J {\n}\n'
		expect(extractDeclaration(source, 'class', 'B')?.bases).toEqual(['A'])
	})

	it('reads a head oxfmt wrapped across lines', () => {
		const source = ['export interface B', '\textends A,', '\t\tC {', '}', ''].join('\n')
		expect(extractDeclaration(source, 'interface', 'B')?.bases).toEqual(['A', 'C'])
	})

	it('ignores a commented declaration', () => {
		const source = [
			'/*',
			'export interface B extends Ghost {',
			'}',
			'*/',
			'export interface B extends A {',
			'}',
			'',
		].join('\n')
		expect(extractDeclaration(source, 'interface', 'B')?.bases).toEqual(['A'])
	})

	it('pairs the body and the bases of the one head it locates', () => {
		const source = [
			'export interface B extends Ghost {',
			'export interface B extends A {',
			'\twalk(): void',
			'}',
			'',
		].join('\n')
		expect(extractDeclaration(source, 'interface', 'B')).toEqual({
			body: ['export interface B extends A {', '\twalk(): void'],
			bases: ['Ghost'],
		})
	})

	it('reports no declaration for a head that opens no column-zero close', () => {
		const source = ['export interface B extends A {', '\twalk(): void', ''].join('\n')
		expect(extractDeclaration(source, 'interface', 'B')).toBeUndefined()
	})
})

describe('extractMemberMethods', () => {
	it('counts a plain method', () => {
		expect(extractMemberMethods(['\tmap(): void'])).toEqual(['map'])
	})

	it('counts an async method', () => {
		expect(extractMemberMethods(['\tasync load(): Promise<void>'])).toEqual(['load'])
	})

	it('counts a generator method', () => {
		expect(extractMemberMethods(['\t*walk(): Generator<void>'])).toEqual(['walk'])
	})

	it('counts an optional method', () => {
		expect(extractMemberMethods(['\trecords?(): void'])).toEqual(['records'])
	})

	it('counts a method whose type params nest generics', () => {
		expect(extractMemberMethods(['\tfold<T extends X<Y>>(value: T): T'])).toEqual(['fold'])
	})

	it('counts an optional method whose type params precede the parameter list', () => {
		expect(extractMemberMethods(['\ttransaction?<R>(scope: DriverScope<R>): Promise<R>'])).toEqual([
			'transaction',
		])
	})

	it('excludes a getter', () => {
		expect(extractMemberMethods(['\tget label(): string'])).toEqual([])
	})

	it('excludes a setter', () => {
		expect(extractMemberMethods(['\tset label(value: string)'])).toEqual([])
	})

	it('excludes a static member', () => {
		expect(extractMemberMethods(['\tstatic create(): X'])).toEqual([])
	})

	it('excludes a #-private member', () => {
		expect(extractMemberMethods(['\t#describe(): string'])).toEqual([])
	})

	it('counts a constructor line as a member (Source excludes it downstream, not extractMemberMethods)', () => {
		expect(extractMemberMethods(['\tconstructor(label: string)'])).toEqual(['constructor'])
	})

	it('excludes a plain data member', () => {
		expect(extractMemberMethods(['\treadonly count: number'])).toEqual([])
	})

	it('dedupes and sorts the results', () => {
		expect(extractMemberMethods(['\tzeta(): void', '\talpha(): void', '\tzeta(): void'])).toEqual([
			'alpha',
			'zeta',
		])
	})

	it("reproduces the good fixture Widget class's exact three methods (excluding the trap members)", () => {
		const declaration = extractDeclaration(
			requireText(FIXTURES, 'good/module/Widget.ts'),
			'class',
			'Widget',
		)
		expect(
			extractMemberMethods(declaration?.body ?? []).filter((method) => method !== 'constructor'),
		).toEqual(['inspect', 'render', 'reset'])
	})
})

describe('extractExamples', () => {
	it('excludes template and outer-comment faux JSDoc while preserving genuine examples', () => {
		const source = [
			'export const text = `',
			'/**',
			' * @example',
			' */',
			'export function templateGhost() {}',
			'`',
			'/*',
			'/** @example */',
			'export function outerVisible(): void {}',
			'/**',
			' * @example',
			' */',
			'export function genuine(): void {}',
			'',
		].join('\n')
		expect(extractExamples(source)).toEqual(['genuine'])
	})

	it('collects a function immediately preceded by an @example JSDoc block', () => {
		const source = ['/**', ' * @example', ' */', 'export function walk() {}', ''].join('\n')
		expect(extractExamples(source)).toEqual(['walk'])
	})

	it('skips a function with no preceding JSDoc block', () => {
		expect(extractExamples('export function walk() {}\n')).toEqual([])
	})

	it('skips a function whose JSDoc block has no @example tag', () => {
		const source = ['/**', ' * Just a description.', ' */', 'export function walk() {}', ''].join(
			'\n',
		)
		expect(extractExamples(source)).toEqual([])
	})

	it('resets the pending block on a blank line between the JSDoc and the export', () => {
		const source = ['/**', ' * @example', ' */', '', 'export function walk() {}', ''].join('\n')
		expect(extractExamples(source)).toEqual([])
	})

	it('collects an async function', () => {
		const source = ['/**', ' * @example', ' */', 'export async function load() {}', ''].join('\n')
		expect(extractExamples(source)).toEqual(['load'])
	})

	it('collects a generator function', () => {
		const source = ['/**', ' * @example', ' */', 'export function* walk() {}', ''].join('\n')
		expect(extractExamples(source)).toEqual(['walk'])
	})

	it('handles a single-line JSDoc comment', () => {
		const source = '/** @example */\nexport function walk() {}\n'
		expect(extractExamples(source)).toEqual(['walk'])
	})

	it('dedupes a repeated export', () => {
		const source = [
			'/**',
			' * @example',
			' */',
			'export function walk() {}',
			'/**',
			' * @example',
			' */',
			'export function walk() {}',
			'',
		].join('\n')
		expect(extractExamples(source)).toEqual(['walk'])
	})
})

describe('extractExampleLines exact tags and physical adjacency', () => {
	it('accepts exact tags with optional titles and rejects suffixes or embedded prose', () => {
		const sources = [
			'/** @example */\nexport function exact(): void {}',
			'/** @example titled usage */\nexport function titled(): void {}',
			'/** @examples */\nexport function plural(): void {}',
			'/** @exampled */\nexport function suffixed(): void {}',
			'/** text @example prose */\nexport function embedded(): void {}',
		]
		expect(
			sources.map((source) =>
				extractExampleLines(extractSourceLines(source)).map((line) => line.source),
			),
		).toEqual([
			['export function exact(): void {}'],
			['export function titled(): void {}'],
			[],
			[],
			[],
		])
		expect(sources.map(extractExamples)).toEqual([['exact'], ['titled'], [], [], []])
	})

	it('makes the last whitespace-separated leading JSDoc span authoritative', () => {
		const taggedThenPlain = '/** @example */ /** plain */\nexport function candidate(): void {}'
		const plainThenTagged =
			'/** plain */ /** @example title */\nexport function candidate(): void {}'
		expect(
			[taggedThenPlain, plainThenTagged].map((source) =>
				extractExampleLines(extractSourceLines(source)).map((line) => line.source),
			),
		).toEqual([[], ['export function candidate(): void {}']])
		expect([taggedThenPlain, plainThenTagged].map(extractExamples)).toEqual([[], ['candidate']])
	})

	it('recognizes a later exact span after a minimal JSDoc span', () => {
		expect(
			extractExamples('/**/ /** @example title */\nexport function candidate(): void {}'),
		).toEqual(['candidate'])
	})

	it('replaces a minimal JSDoc span with a next-line exact span', () => {
		expect(
			extractExamples('/**/\n/** @example title */\nexport function candidate(): void {}'),
		).toEqual(['candidate'])
	})

	it('excludes a tagged span replaced by a final minimal JSDoc span', () => {
		expect(extractExamples('/** @example */ /**/\nexport function candidate(): void {}')).toEqual(
			[],
		)
	})

	it('severs or replaces pending association at the next physical record boundary', () => {
		const sources = [
			'/** @example */ const intervening = true\nexport function candidate(): void {}',
			'/** @example */ // intervening\nexport function candidate(): void {}',
			'/** @example */ /* intervening */\nexport function candidate(): void {}',
			'/** @example */ export function sameLine(): void {}\nexport function candidate(): void {}',
			'/** @example */\n\nexport function candidate(): void {}',
			'/** @example */\n// intervening\nexport function candidate(): void {}',
			'/** @example */\n/** plain */\nexport function candidate(): void {}',
			'/** plain */\n/**\n * @example title\n */\nexport function candidate(): void {}',
		]
		expect(sources.map(extractExamples)).toEqual([[], [], [], [], [], [], [], ['candidate']])
	})
})

describe('extractExampleMethods', () => {
	it('excludes faux JSDoc inside an outer comment while preserving a genuine member example', () => {
		const lines = [
			'\t/*',
			'\t/** @example */',
			'\touterVisible(): void',
			'\t/**',
			'\t * @example',
			'\t */',
			'\tgenuine(): void',
		]
		expect(extractExampleMethods(lines)).toEqual(['genuine'])
	})

	it('collects a method immediately preceded by an @example JSDoc block', () => {
		const lines = ['\t/**', '\t * @example', '\t */', '\twalk(): void']
		expect(extractExampleMethods(lines)).toEqual(['walk'])
	})

	it('skips a method with no preceding JSDoc block', () => {
		expect(extractExampleMethods(['\twalk(): void'])).toEqual([])
	})

	it('dedupes and sorts the results', () => {
		const lines = [
			'\t/**',
			'\t * @example',
			'\t */',
			'\tzeta(): void',
			'\t/**',
			'\t * @example',
			'\t */',
			'\talpha(): void',
		]
		expect(extractExampleMethods(lines)).toEqual(['alpha', 'zeta'])
	})

	it('handles a single-line JSDoc comment on an interface member', () => {
		expect(extractExampleMethods(['\t/** @example */', '\twalk(): void'])).toEqual(['walk'])
	})

	it('uses exact titled tags and last-span authority for members', () => {
		const lines = [
			'\t/** @example title */',
			'\texact(): void',
			'\t/** @examples */',
			'\tplural(): void',
			'\t/** text @example prose */',
			'\tembedded(): void',
			'\t/** @example */ /** plain */',
			'\treplaced(): void',
			'\t/** plain */ /** @example title */',
			'\tauthoritative(): void',
		]
		expect(extractExampleMethods(lines)).toEqual(['authoritative', 'exact'])
	})

	it('applies minimal JSDoc span replacement to members', () => {
		const lines = [
			'\t/**/ /** @example title */',
			'\tsameLine(): void',
			'\t/**/',
			'\t/** @example title */',
			'\tnextLine(): void',
			'\t/** @example */ /**/',
			'\treplaced(): void',
		]
		expect(extractExampleMethods(lines)).toEqual(['nextLine', 'sameLine'])
	})

	it('collects an optional method whose type params precede the parameter list', () => {
		const lines = [
			'\t/**',
			'\t * @example',
			'\t */',
			'\ttransaction?<R>(scope: DriverScope<R>): Promise<R>',
		]
		expect(extractExampleMethods(lines)).toEqual(['transaction'])
	})
})

describe('extractFences', () => {
	it("extracts a ```ts fence's language and code body", () => {
		const document = createMarkdown('## Patterns\n\n```ts\nwalk()\n```\n').document
		expect(extractFences(document)).toEqual([{ language: 'ts', code: 'walk()' }])
	})

	it('returns an empty array when the document has no fence', () => {
		const document = createMarkdown('## Patterns\n\nno fences here\n').document
		expect(extractFences(document)).toEqual([])
	})

	it('extracts an untagged fence with an undefined language', () => {
		const document = createMarkdown('```\nwalk()\n```\n').document
		expect(extractFences(document)).toEqual([{ language: undefined, code: 'walk()' }])
	})

	it('uses the first info-string word as the language', () => {
		const document = createMarkdown('```ts twoslash\nwalk()\n```\n').document
		expect(extractFences(document)).toEqual([{ language: 'ts', code: 'walk()' }])
	})

	it('preserves an uppercase language tag', () => {
		const document = createMarkdown('```TS\nwalk()\n```\n').document
		expect(extractFences(document)).toEqual([{ language: 'TS', code: 'walk()' }])
	})

	it('collects a fence nested inside a blockquote during the full AST walk', () => {
		const document = createMarkdown('> ```ts\n> walk()\n> ```\n').document
		expect(extractFences(document)).toEqual([{ language: 'ts', code: 'walk()' }])
	})

	it('collects every fence in the document, in walk order', () => {
		const document = createMarkdown('```ts\na()\n```\n\n```json\n{}\n```\n').document
		expect(extractFences(document)).toEqual([
			{ language: 'ts', code: 'a()' },
			{ language: 'json', code: '{}' },
		])
	})

	it("extracts the good fixture guide's empty fence list", () => {
		const document = createMarkdown(requireText(FIXTURES, 'good/guides/src/widget.md')).document
		expect(extractFences(document)).toEqual([])
	})
})

// ── EX / FI broken-fixture matrix ───────────────────────────────────────────

describe('broken fixture: missing-example', () => {
	it('finds farewell unexampled (has neither a fence mention nor an @example) while greet is clean', () => {
		const guideDocument = createMarkdown(
			requireText(FIXTURES, 'broken/missing-example/guides/src/widget.md'),
		).document
		const fences = extractFences(guideDocument).map((fence) => fence.code)
		const surfaceNames = ['greet', 'farewell']
		const examples = extractExamples(
			requireText(FIXTURES, 'broken/missing-example/module/helpers.ts'),
		)

		const unexampled = surfaceNames.filter((name) => {
			if (examples.includes(name)) return false
			const boundary = new RegExp(`\\b${name}\\b`)
			return !fences.some((fence) => boundary.test(fence))
		})
		expect(unexampled).toEqual(['farewell'])
	})
})

describe('broken fixture: phantom-import', () => {
	it("finds ghost as a phantom import (real exists, ghost doesn't)", () => {
		const guideDocument = createMarkdown(
			requireText(FIXTURES, 'broken/phantom-import/guides/src/widget.md'),
		).document
		const fences = extractFences(guideDocument).map((fence) => fence.code)
		const exportNames = extractExports(
			requireText(FIXTURES, 'broken/phantom-import/module/helpers.ts'),
		).map((symbol) => symbol.name)

		const phantom = fences.flatMap((fence) =>
			extractFenceImports(fence)
				.filter((entry) => entry.specifier === '@src/core')
				.flatMap((entry) => findMissing(entry.names, exportNames)),
		)
		expect(phantom).toEqual(['ghost'])
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
