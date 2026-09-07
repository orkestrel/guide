import type { MethodGroup, SourceExample, SourceLine, SurfaceSymbol } from '@src/core'
import {
	buildCell,
	buildComment,
	buildFence,
	buildTable,
	collectExamples,
	collectFences,
	collectGroups,
	collectKeys,
	collectSummaries,
	collectTitles,
	computeDrift,
	createGuide,
	createSource,
	extractBodyLines,
	extractCellLinks,
	extractCellText,
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
	extractRowEntry,
	extractRowSummary,
	extractRowSymbol,
	extractSourceComments,
	extractTagline,
	extractUnnamed,
	findDrift,
	findMissing,
	findUnexampled,
	findUnlisted,
	findFirstCode,
	maskFences,
	normalizeComment,
	normalizeIdentifier,
	normalizeSummary,
	isExternalLink,
	hasCanonicalSegments,
	extractHidden,
	joinHead,
	locateComment,
	escapeRegExp,
	findColumnIndex,
	renderExample,
	renderMethods,
	renderSurface,
	replaceCell,
	replaceExample,
	replaceFence,
	replaceSummary,
	spliceSpan,
	unwrapComment,
	wrapText,
	WRAP_WIDTH,
	extractMemberMethods,
	findMissingSymbols,
	normalizeDirectories,
	resolveLink,
	resolvePath,
	selectSectionBlocks,
	selectModuleKeys,
	computeSymbolKey,
} from '@src/core'
import { createMarkdown, isTableNode, renderMarkdown } from '@orkestrel/markdown'
import { parseSync } from 'vite'
import { describe, expect, it } from 'vitest'
import { requireTable, requireText } from '../../setup.js'
import { readInventory } from '@orkestrel/test/server'

const FIXTURES = readInventory(new URL('../../fixtures/', import.meta.url), ['.'])

// Every pure leaf behind the guides-parity scanners — the source-line
// projection and its declaration/member/JSDoc grammars, the guide-markdown
// section scoping and Surface/Methods/Links/Tests/Patterns extraction, symbol
// keying, set-difference, link classification/resolution, generic-name
// normalization, and table-column/inline lookups. Pure and total; each mirrors
// one exported helpers.ts symbol (.claude/rules/tests.md § Test contract).

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
	it('joins keyword and name with a space', () => {
		expect(computeSymbolKey({ name: 'Markdown', keyword: 'class' })).toBe('class Markdown')
	})

	it('differs when the keyword differs', () => {
		expect(computeSymbolKey({ name: 'X', keyword: 'type' })).not.toBe(
			computeSymbolKey({ name: 'X', keyword: 'class' }),
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
	const widget: SurfaceSymbol = { name: 'Widget', keyword: 'class' }
	const kind: SurfaceSymbol = { name: 'WidgetKind', keyword: 'type' }

	it('returns an empty array when symbols is empty', () => {
		expect(findMissingSymbols([], [widget])).toEqual([])
	})

	it('returns symbol keys present in symbols but absent from source', () => {
		expect(findMissingSymbols([widget, kind], [widget])).toEqual(['type WidgetKind'])
	})

	it('treats same-name different-keyword symbols as distinct (both directions)', () => {
		const asConst: SurfaceSymbol = { name: 'Widget', keyword: 'const' }
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

describe('findColumnIndex', () => {
	it('finds the Kind column when present', () => {
		const table = requireTable('| Name | Kind |\n| --- | --- |\n| `X` | class |\n')
		expect(findColumnIndex(table, 'Kind')).toBe(1)
	})

	it('returns undefined when no Kind header exists', () => {
		const table = requireTable('| Name | Description |\n| --- | --- |\n| `X` | none |\n')
		expect(findColumnIndex(table, 'Kind')).toBeUndefined()
	})

	it('finds the Kind column when the header is reordered', () => {
		const table = requireTable('| Kind | Name |\n| --- | --- |\n| class | `X` |\n')
		expect(findColumnIndex(table, 'Kind')).toBe(0)
	})

	it('finds the Summary column beside the Kind column', () => {
		const table = requireTable(
			'| Name | Summary | Kind |\n| --- | --- | --- |\n| `X` | Holds a widget. | class |\n',
		)
		expect(findColumnIndex(table, 'Summary')).toBe(1)
	})

	it('refuses a header that differs in case', () => {
		const table = requireTable('| Name | summary |\n| --- | --- |\n| `X` | Holds a widget. |\n')
		expect(findColumnIndex(table, 'Summary')).toBeUndefined()
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
			expect(extractExports(source)).toEqual([{ name: 'visible', keyword: 'const' }])
		}
	})

	it('extractExports excludes comments after ordinary and private literal Unicode identifiers', () => {
		const sources = [
			'const ratio = object.\u03c0 / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'class Counter {\n\t#\u03c0 = 1\n\tratio(): number { return this.#\u03c0 / 2 /* open\nexport const ghost = true\n*/ }\n}\nexport const visible = true',
		]
		expect(sources.map(extractExports)).toEqual(
			sources.map(() => [{ name: 'visible', keyword: 'const' }]),
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
			sources.map(() => [{ name: 'visible', keyword: 'const' }]),
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
		expect(extractExports(source)).toEqual([{ name: 'visible', keyword: 'const' }])
		expect(extractHidden(source.replaceAll('export ', ''))).toEqual([
			{ name: 'visible', keyword: 'const' },
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
			{ name: 'visible' },
		])
	})

	it('extractExampleMethods keeps raw JSDoc evidence but rejects commented candidates', () => {
		const lines = [
			'\t/** @example */',
			'\tvisible(): void',
			'\t/** @example */',
			'\t/* ghost(): void */',
		]
		expect(extractExampleMethods(lines).map((example) => example.name)).toEqual(['visible'])
	})
})

describe('extractSurface', () => {
	it("extracts the good fixture guide's exact 6-symbol surface", () => {
		const document = createMarkdown(requireText(FIXTURES, 'good/guides/src/widget.md')).document
		const surface = extractSurface(document)
		expect(surface).toEqual([
			{ name: 'WidgetInterface', keyword: 'interface' },
			{ name: 'WidgetKind', keyword: 'type' },
			{ name: 'createLabel', keyword: 'function' },
			{ name: 'loadWidget', keyword: 'function' },
			{ name: 'DEFAULT_COUNT', keyword: 'const' },
			{ name: 'Widget', keyword: 'class' },
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
		expect(surface).toContainEqual({ name: 'Widget', keyword: 'class' })
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
			{
				interface: 'WidgetInterface',
				methods: [{ name: 'inspect' }, { name: 'render' }, { name: 'reset' }],
			},
		])
	})

	it('reflects a missing method row (missing-interface-method fixture)', () => {
		const document = createMarkdown(
			requireText(FIXTURES, 'broken/missing-interface-method/widget.md'),
		).document
		expect(extractMethods(document)).toEqual([
			{ interface: 'WidgetInterface', methods: [{ name: 'inspect' }, { name: 'render' }] },
		])
	})

	it('reflects a phantom method row (phantom-method fixture)', () => {
		const document = createMarkdown(
			requireText(FIXTURES, 'broken/phantom-method/widget.md'),
		).document
		expect(extractMethods(document)).toEqual([
			{
				interface: 'WidgetInterface',
				methods: [{ name: 'inspect' }, { name: 'render' }, { name: 'reset' }, { name: 'destroy' }],
			},
		])
	})
})

// `extractSurface` and `extractMethods` skip a row whose first cell carries no
// code span, because they have no name to key it on. `extractUnnamed` is the
// projection that reports the skip instead of letting the row leave the guide's
// surface in silence.
describe('extractUnnamed', () => {
	it('reports a row with no code-span name in each documented section', () => {
		const nameless = [
			'## Surface',
			'',
			'| Name | Kind | Summary |',
			'| --- | --- | --- |',
			'| `Widget` | class | Represents a widget. |',
			'| Widget | class | Represents a widget. |',
			'',
			'## Methods',
			'',
			'#### `WidgetInterface`',
			'',
			'| Method | Summary |',
			'| --- | --- |',
			'| `render` | Renders the widget. |',
			'| render | Renders the widget. |',
			'',
		].join('\n')
		expect(extractUnnamed(createMarkdown(nameless).document)).toEqual([
			'Widget | class | Represents a widget.',
			'render | Renders the widget.',
		])
	})

	// The negative control, drawn from outside the membership rule: a name written
	// as a code span inside emphasis is a name `findFirstCode` reads, so the row is
	// no finding and the symbol still reaches the documented surface.
	it('reports no row whose name is a code span inside emphasis', () => {
		const emphasized = [
			'## Surface',
			'',
			'| Name | Kind |',
			'| --- | --- |',
			'| **`Widget`** | class |',
			'',
		].join('\n')
		const document = createMarkdown(emphasized).document
		expect(extractUnnamed(document)).toEqual([])
		expect(extractSurface(document)).toEqual([{ name: 'Widget', keyword: 'class' }])
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
	it('excludes declaration-keyword declarations inside a multiline block comment', () => {
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
		expect(extractExports(source)).toEqual([{ name: 'visible', keyword: 'const' }])
	})

	it('retains declaration-keyword code with literal initializers and comments while excluding enum', () => {
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
			{ name: 'VisibleType', keyword: 'type' },
			{ name: 'VisibleInterface', keyword: 'interface' },
			{ name: 'stringValue', keyword: 'const' },
			{ name: 'regexValue', keyword: 'const' },
			{ name: 'templateValue', keyword: 'const' },
			{ name: 'visibleFunction', keyword: 'function' },
			{ name: 'VisibleClass', keyword: 'class' },
		])
	})

	it('scans every ExportKeyword declaration from the good fixture types.ts', () => {
		const symbols = extractExports(requireText(FIXTURES, 'good/module/types.ts'))
		expect(symbols).toEqual([
			{ name: 'WidgetInterface', keyword: 'interface' },
			{ name: 'WidgetKind', keyword: 'type' },
		])
	})

	it('scans a plain function, an async function, a class, and a const', () => {
		const source =
			'export function a() {}\nexport async function b() {}\nexport class C {}\nexport const D = 1\n'
		expect(extractExports(source)).toEqual([
			{ name: 'a', keyword: 'function' },
			{ name: 'b', keyword: 'function' },
			{ name: 'C', keyword: 'class' },
			{ name: 'D', keyword: 'const' },
		])
	})

	it('scans a generator function under the function keyword', () => {
		expect(extractExports('export function* walk() {}\n')).toEqual([
			{ name: 'walk', keyword: 'function' },
		])
	})

	it('dedupes a repeated (keyword, name) pair', () => {
		const source = 'export class X {}\nexport class X {}\n'
		expect(extractExports(source)).toEqual([{ name: 'X', keyword: 'class' }])
	})

	it('ignores non-export lines', () => {
		const source = 'const local = 1\nfunction helper() {}\nexport class Real {}\n'
		expect(extractExports(source)).toEqual([{ name: 'Real', keyword: 'class' }])
	})
})

describe('extractHidden', () => {
	it('excludes declaration-keyword declarations inside a multiline block comment', () => {
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
		expect(extractHidden(source)).toEqual([{ name: 'visible', keyword: 'const' }])
	})

	it('retains hidden declaration-keyword code with literal initializers and comments while excluding enum', () => {
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
			{ name: 'VisibleType', keyword: 'type' },
			{ name: 'VisibleInterface', keyword: 'interface' },
			{ name: 'stringValue', keyword: 'const' },
			{ name: 'regexValue', keyword: 'const' },
			{ name: 'templateValue', keyword: 'const' },
			{ name: 'visibleFunction', keyword: 'function' },
			{ name: 'VisibleClass', keyword: 'class' },
		])
	})

	it('detects a hidden function declaration', () => {
		expect(extractHidden('function secretHelper() {}\n')).toEqual([
			{ name: 'secretHelper', keyword: 'function' },
		])
	})

	it('detects a hidden async function declaration', () => {
		expect(extractHidden('async function loadSecret() {}\n')).toEqual([
			{ name: 'loadSecret', keyword: 'function' },
		])
	})

	it('detects a hidden generator declaration under the function keyword', () => {
		expect(extractHidden('function* walkSecret() {}\n')).toEqual([
			{ name: 'walkSecret', keyword: 'function' },
		])
	})

	it('detects a hidden class declaration', () => {
		expect(extractHidden('class Secret {}\n')).toEqual([{ name: 'Secret', keyword: 'class' }])
	})

	it('detects a hidden const declaration', () => {
		expect(extractHidden('const SECRET = 1\n')).toEqual([{ name: 'SECRET', keyword: 'const' }])
	})

	it('detects a hidden interface declaration', () => {
		expect(extractHidden('interface Secret {}\n')).toEqual([
			{ name: 'Secret', keyword: 'interface' },
		])
	})

	it('detects a hidden type declaration', () => {
		expect(extractHidden('type Secret = string\n')).toEqual([{ name: 'Secret', keyword: 'type' }])
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
		expect(symbols).toEqual([{ name: 'secretHelper', keyword: 'function' }])
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
		expect(extractMemberMethods(['\tmap(): void'])).toEqual([{ name: 'map' }])
	})

	it('counts an async method', () => {
		expect(extractMemberMethods(['\tasync load(): Promise<void>'])).toEqual([{ name: 'load' }])
	})

	it('counts a generator method', () => {
		expect(extractMemberMethods(['\t*walk(): Generator<void>'])).toEqual([{ name: 'walk' }])
	})

	it('counts an optional method', () => {
		expect(extractMemberMethods(['\trecords?(): void'])).toEqual([{ name: 'records' }])
	})

	it('counts a method whose type params nest generics', () => {
		expect(extractMemberMethods(['\tfold<T extends X<Y>>(value: T): T'])).toEqual([
			{ name: 'fold' },
		])
	})

	it('counts an optional method whose type params precede the parameter list', () => {
		expect(extractMemberMethods(['\ttransaction?<R>(scope: DriverScope<R>): Promise<R>'])).toEqual([
			{ name: 'transaction' },
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
		expect(extractMemberMethods(['\tconstructor(label: string)'])).toEqual([
			{ name: 'constructor' },
		])
	})

	it('excludes a plain data member', () => {
		expect(extractMemberMethods(['\treadonly count: number'])).toEqual([])
	})

	it('dedupes and sorts the results', () => {
		expect(extractMemberMethods(['\tzeta(): void', '\talpha(): void', '\tzeta(): void'])).toEqual([
			{ name: 'alpha' },
			{ name: 'zeta' },
		])
	})

	it("reproduces the good fixture Widget class's exact methods (excluding the trap members)", () => {
		const declaration = extractDeclaration(
			requireText(FIXTURES, 'good/module/Widget.ts'),
			'class',
			'Widget',
		)
		expect(
			extractMemberMethods(declaration?.body ?? [])
				.filter((entry) => entry.name !== 'constructor')
				.map((entry) => entry.name),
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
		expect(extractExamples(source).map((example) => example.name)).toEqual(['genuine'])
	})

	it('collects a function immediately preceded by an @example JSDoc block', () => {
		const source = ['/**', ' * @example', ' */', 'export function walk() {}', ''].join('\n')
		expect(extractExamples(source).map((example) => example.name)).toEqual(['walk'])
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
		expect(extractExamples(source).map((example) => example.name)).toEqual(['load'])
	})

	it('collects a generator function', () => {
		const source = ['/**', ' * @example', ' */', 'export function* walk() {}', ''].join('\n')
		expect(extractExamples(source).map((example) => example.name)).toEqual(['walk'])
	})

	it('handles a single-line JSDoc comment', () => {
		const source = '/** @example */\nexport function walk() {}\n'
		expect(extractExamples(source).map((example) => example.name)).toEqual(['walk'])
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
		expect(extractExamples(source).map((example) => example.name)).toEqual(['walk'])
	})

	// The axis is the declaration head against the member, with no keyword carve-out: every
	// `collectKeys` head key contributes its blocks, and a member key belongs to the member
	// reader beside this one.
	it('collects a titled block above a class head, named for the class', () => {
		const source = [
			'/**',
			' * @example Build a widget',
			' * ```ts',
			' * new Widget()',
			' * ```',
			' */',
			'export class Widget {}',
			'',
		].join('\n')
		expect(extractExamples(source)).toEqual([
			{ name: 'Widget', title: 'Build a widget', code: 'new Widget()', language: 'ts' },
		])
	})

	it('collects an untitled class-head block, which carries no title', () => {
		const source = [
			'/**',
			' * @example',
			' * new Widget()',
			' */',
			'export class Widget {}',
			'',
		].join('\n')
		expect(extractExamples(source)).toStrictEqual([{ name: 'Widget', code: 'new Widget()' }])
		expect(extractExamples('export class Widget {}\n')).toEqual([])
	})

	it('collects a titled block above a type head and above an interface head', () => {
		const source = [
			'/**',
			' * @example Name a widget',
			' * ```ts',
			" * const side: WidgetSide = 'left'",
			' * ```',
			' */',
			"export type WidgetSide = 'left' | 'right'",
			'/**',
			' * @example Render a widget',
			' * ```ts',
			' * widget.render()',
			' * ```',
			' */',
			'export interface WidgetInterface {',
			'\trender(): void',
			'}',
			'',
		].join('\n')
		expect(extractExamples(source)).toEqual([
			{
				name: 'WidgetSide',
				title: 'Name a widget',
				code: "const side: WidgetSide = 'left'",
				language: 'ts',
			},
			{
				name: 'WidgetInterface',
				title: 'Render a widget',
				code: 'widget.render()',
				language: 'ts',
			},
		])
	})

	it('collects a block above a const head', () => {
		const source = [
			'/**',
			' * @example',
			' * LANGUAGES.size',
			' */',
			'export const LANGUAGES = new Set()',
			'',
		].join('\n')
		expect(extractExamples(source).map((example) => example.name)).toEqual(['LANGUAGES'])
	})

	it('skips a member block, which the member reader collects instead', () => {
		const body = ['\t/**', '\t * @example', '\t * widget.render()', '\t */', '\trender(): void']
		const source = ['export interface WidgetInterface {', ...body, '}', ''].join('\n')
		expect(extractExamples(source)).toEqual([])
		expect(extractExampleMethods(body).map((example) => example.name)).toEqual(['render'])
	})

	it('skips a block attached to a declaration no key names', () => {
		const source = ['/**', ' * @example', ' * hidden()', ' */', 'const hidden = true', ''].join(
			'\n',
		)
		expect(extractExamples(source)).toEqual([])
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
		expect(sources.map((source) => extractExamples(source).map((example) => example.name))).toEqual(
			[['exact'], ['titled'], [], [], []],
		)
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
		expect(
			[taggedThenPlain, plainThenTagged].map((source) =>
				extractExamples(source).map((example) => example.name),
			),
		).toEqual([[], ['candidate']])
	})

	it('recognizes a later exact span after a minimal JSDoc span', () => {
		expect(
			extractExamples('/**/ /** @example title */\nexport function candidate(): void {}').map(
				(example) => example.name,
			),
		).toEqual(['candidate'])
	})

	it('replaces a minimal JSDoc span with a next-line exact span', () => {
		expect(
			extractExamples('/**/\n/** @example title */\nexport function candidate(): void {}').map(
				(example) => example.name,
			),
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
		expect(sources.map((source) => extractExamples(source).map((example) => example.name))).toEqual(
			[[], [], [], [], [], [], [], ['candidate']],
		)
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
		expect(extractExampleMethods(lines).map((example) => example.name)).toEqual(['genuine'])
	})

	it('collects a method immediately preceded by an @example JSDoc block', () => {
		const lines = ['\t/**', '\t * @example', '\t */', '\twalk(): void']
		expect(extractExampleMethods(lines).map((example) => example.name)).toEqual(['walk'])
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
		expect(extractExampleMethods(lines).map((example) => example.name)).toEqual(['alpha', 'zeta'])
	})

	it('handles a single-line JSDoc comment on an interface member', () => {
		expect(
			extractExampleMethods(['\t/** @example */', '\twalk(): void']).map((example) => example.name),
		).toEqual(['walk'])
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
		expect(extractExampleMethods(lines).map((example) => example.name)).toEqual([
			'authoritative',
			'exact',
		])
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
		expect(extractExampleMethods(lines).map((example) => example.name)).toEqual([
			'nextLine',
			'sameLine',
		])
	})

	it('collects an optional method whose type params precede the parameter list', () => {
		const lines = [
			'\t/**',
			'\t * @example',
			'\t */',
			'\ttransaction?<R>(scope: DriverScope<R>): Promise<R>',
		]
		expect(extractExampleMethods(lines).map((example) => example.name)).toEqual(['transaction'])
	})
})

describe('extractFences', () => {
	it("extracts a ```ts fence's language and code body", () => {
		const document = createMarkdown('## Patterns\n\n```ts\nwalk()\n```\n').document
		expect(extractFences(document)).toEqual([{ language: 'ts', code: 'walk()', title: 'Patterns' }])
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
		).map((example) => example.name)

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

// ── The compared form ────────────────────────────────────────────────────────
// Both sides of the guide/TSDoc comparison are read into one normalized form.
// Each clause of the stated transform gets its own case, on the side that owns
// it: `{@link}` rendering and whitespace collapse on the source side, emphasis,
// link, and escaped-pipe reduction on the guide side, and code spans on both.

describe('normalizeSummary', () => {
	it('renders a bare link target as a code token', () => {
		expect(normalizeSummary('Creates a {@link Widget}.')).toBe('Creates a `Widget`.')
	})

	it('renders a qualified link target as a code token', () => {
		expect(normalizeSummary('Reads {@link Widget.render}.')).toBe('Reads `Widget.render`.')
	})

	it('renders a labelled link as the code token of its label', () => {
		expect(normalizeSummary('Creates {@link Widget | a widget}.')).toBe('Creates `a widget`.')
	})

	it('renders several links in one paragraph', () => {
		expect(normalizeSummary('{@link A} and {@link B | b}.')).toBe('`A` and `b`.')
	})

	it('collapses a line break and its continuation whitespace into one space', () => {
		expect(normalizeSummary('Creates a widget\nfrom a name.')).toBe('Creates a widget from a name.')
	})

	it('trims the ends and leaves a code span a code span', () => {
		expect(normalizeSummary('  Returns a `Widget`.  ')).toBe('Returns a `Widget`.')
	})

	it('leaves text carrying none of the transform unchanged', () => {
		expect(normalizeSummary('Represents one documented symbol.')).toBe(
			'Represents one documented symbol.',
		)
	})

	// The code-span clause. The markdown parser strips one space from each end of a code span
	// it reads, and only when both ends carry one; the clause is the symmetric rule that meets
	// it from either side, so a padded span, a one-sided span, and a bare span converge.
	it('converges a padded, a one-sided, and a bare code span on the same form', () => {
		const forms = ['` | `', '` |`', '`| `', '`|`'].map((span) =>
			normalizeSummary(`cells joined by ${span}, in order.`),
		)
		expect(forms).toEqual(Array.from({ length: 4 }, () => 'cells joined by `|`, in order.'))
	})

	// The guide side reaches the clause after the parser has already stripped a code span's
	// symmetric boundary space, and the source side reaches it with that space still in the
	// text. Both spellings must land on the same form, or a doc block and the cell documenting
	// it drift for as long as either carries a padded span. A raw `|` cannot ride in a
	// hand-written cell — it splits the row at parse time — so the padded span here is a name.
	it('converges the guide side and the source side on a padded and a one-sided span', () => {
		for (const written of ['a ` Widget ` span', 'a ` Widget` span', 'a `Widget ` span']) {
			const cell = requireTable(
				['| Name | Summary |', '| --- | --- |', `| \`a\` | ${written} |`, ''].join('\n'),
			).rows[0]?.[1]
			expect(cell).toBeDefined()
			expect(normalizeSummary(extractCellText(cell ?? []))).toBe('a `Widget` span')
			expect(normalizeSummary(written)).toBe('a `Widget` span')
		}
	})

	it('keeps one space for a span whose content is all whitespace', () => {
		expect(normalizeSummary('a ` ` span')).toBe('a ` ` span')
		expect(normalizeSummary('a `   ` span')).toBe('a ` ` span')
	})

	it('leaves a link token inside a code span literal and expands the one outside it', () => {
		expect(normalizeSummary('a `{@link Widget}` token and a {@link Widget} token')).toBe(
			'a `{@link Widget}` token and a `Widget` token',
		)
	})

	it('leaves a span delimited by more than one backtick untouched', () => {
		expect(normalizeSummary('a ``Target`` span')).toBe('a ``Target`` span')
		expect(normalizeSummary('a `` Target `` span')).toBe('a `` Target `` span')
	})

	it('collapses a span wrapped across two physical lines before trimming its boundary', () => {
		expect(normalizeSummary('reads ` a\nb ` back')).toBe('reads `a b` back')
	})

	it('is a fixed point on its own output', () => {
		const texts = [
			'cells joined by ` | `, in order.',
			'a ` ` span',
			'a `{@link Widget}` token and a {@link Widget} token',
			'a ``Target`` span',
			'reads ` a\nb ` back',
		]
		expect(texts.map((text) => normalizeSummary(normalizeSummary(text)))).toEqual(
			texts.map((text) => normalizeSummary(text)),
		)
	})
})

describe('extractCellText', () => {
	it('keeps a code span backticked', () => {
		expect(extractCellText([{ element: 'codeSpan', value: 'Widget' }])).toBe('`Widget`')
	})

	it('drops strong and light emphasis to their text', () => {
		const cell = requireTable('| Summary |\n| --- |\n| **Creates** a _widget_. |\n').rows[0]?.[0]
		expect(extractCellText(cell ?? [])).toBe('Creates a widget.')
	})

	it('drops a link to its text', () => {
		const cell = requireTable(
			'| Summary |\n| --- |\n| Creates a [widget](../src/core/Widget.ts). |\n',
		).rows[0]?.[0]
		expect(extractCellText(cell ?? [])).toBe('Creates a widget.')
	})

	it('unescapes an escaped pipe and keeps the cell text either side of it', () => {
		const cell = requireTable(
			'| Summary |\n| --- |\n| Returns `string \\| undefined` for a miss. |\n',
		).rows[0]?.[0]
		expect(extractCellText(cell ?? [])).toBe('Returns `string | undefined` for a miss.')
	})

	it('returns an empty string for an empty cell', () => {
		expect(extractCellText([])).toBe('')
	})
})

describe('normalizeComment', () => {
	it('unwraps a single-line block', () => {
		expect(normalizeComment('/** Creates a widget. */')).toBe('Creates a widget.')
	})

	it('unwraps a multi-line block and drops its blank opening and closing lines', () => {
		const comment = ['/**', ' * Creates a widget.', ' *', ' * @remarks', ' * Twice.', ' */'].join(
			'\n',
		)
		expect(normalizeComment(comment)).toBe('Creates a widget.\n\n@remarks\nTwice.')
	})

	it("keeps a body line's own indentation past the continuation marker", () => {
		const comment = [
			'\t/**',
			'\t * @example',
			'\t * ```ts',
			'\t * \twidget.render()',
			'\t * ```',
			'\t */',
		].join('\n')
		expect(normalizeComment(comment)).toBe('@example\n```ts\n\twidget.render()\n```')
	})

	it('trims per-line trailing whitespace', () => {
		expect(normalizeComment('/**\n * Creates a widget.   \n */')).toBe('Creates a widget.')
	})

	it('returns an empty body for a minimal block', () => {
		expect(normalizeComment('/**/')).toBe('')
	})
})

describe('collectSummaries', () => {
	it('reads the description paragraph of the record a block documents', () => {
		const source = [
			'/**',
			' * Creates a widget.',
			' */',
			'export function createWidget() {}',
			'',
		].join('\n')
		const lines = extractSourceLines(source)
		const summaries = collectSummaries(lines)
		const documented = lines.filter((line) => line.code.startsWith('export function'))
		expect(Array.from(summaries.values())).toEqual(['Creates a widget.'])
		expect(documented.map((line) => summaries.get(line))).toEqual(['Creates a widget.'])
	})

	it('stops the description at the first block tag', () => {
		const source = [
			'/**',
			' * Creates a widget.',
			' *',
			' * @param name - The name',
			' * @returns The widget',
			' */',
			'export function createWidget() {}',
			'',
		].join('\n')
		expect(Array.from(collectSummaries(extractSourceLines(source)).values())).toEqual([
			'Creates a widget.',
		])
	})

	it('contributes no entry for a block that opens with a tag', () => {
		const source = ['/** @example */', 'export function createWidget() {}', ''].join('\n')
		expect(collectSummaries(extractSourceLines(source)).size).toBe(0)
	})

	it('renders a link target in the description it collects', () => {
		const source = [
			'/**',
			' * Creates a {@link Widget}.',
			' */',
			'export function make() {}',
			'',
		].join('\n')
		expect(Array.from(collectSummaries(extractSourceLines(source)).values())).toEqual([
			'Creates a `Widget`.',
		])
	})
})

describe('extractSourceComments', () => {
	it('pairs a block with the record it documents', () => {
		const source = ['/**', ' * Creates a widget.', ' */', 'export function make() {}', ''].join(
			'\n',
		)
		const comments = extractSourceComments(extractSourceLines(source))
		expect(comments.map((comment) => comment.text)).toEqual(['Creates a widget.'])
		expect(comments.map((comment) => comment.line.source)).toEqual(['export function make() {}'])
	})

	it('returns a block carrying no example, which the example projection filters out', () => {
		const source = ['/**', ' * Creates a widget.', ' */', 'export function make() {}', ''].join(
			'\n',
		)
		const lines = extractSourceLines(source)
		expect(extractSourceComments(lines)).toHaveLength(1)
		expect(extractExampleLines(lines)).toEqual([])
	})
})

describe('collectExamples', () => {
	it('reads a titled fenced block into its title, language, and body', () => {
		const comment = ['@example Render a widget', '```ts', 'widget.render()', '```'].join('\n')
		expect(collectExamples(comment, 'render')).toEqual([
			{ name: 'render', title: 'Render a widget', code: 'widget.render()', language: 'ts' },
		])
	})

	it('reads an untitled block with no fence as its own text', () => {
		expect(collectExamples('@example\nwidget.render()', 'render')).toEqual([
			{ name: 'render', code: 'widget.render()' },
		])
	})

	it('stops a block body at the next block tag', () => {
		const comment = ['@example', '```ts', 'widget.render()', '```', '@remarks', 'Twice.'].join('\n')
		expect(collectExamples(comment, 'render')).toEqual([
			{ name: 'render', code: 'widget.render()', language: 'ts' },
		])
	})

	it('reads two blocks from one comment, in block order', () => {
		const comment = ['@example First', 'one()', '@example Second', 'two()'].join('\n')
		expect(collectExamples(comment, 'walk')).toEqual([
			{ name: 'walk', title: 'First', code: 'one()' },
			{ name: 'walk', title: 'Second', code: 'two()' },
		])
	})

	it('refuses a tag whose name only starts with example', () => {
		expect(collectExamples('@examples\nwalk()', 'walk')).toEqual([])
	})
})

// A block tag written past one space after the continuation marker survives
// `normalizeComment`'s unwrapping with its own indentation, so every tag reader
// matches the first non-blank column of a line rather than column zero.
describe('an over-indented block tag', () => {
	const BLOCK = [
		'/**',
		' * Renders the widget.',
		' *',
		' *   @param value - The value',
		' *',
		' *   @example Render a widget',
		' *   widget.render()',
		' */',
	].join('\n')
	const INDENTED = [BLOCK, 'export function render(): void {}', ''].join('\n')

	it('ends the description paragraph at the indented tag', () => {
		expect(Array.from(collectSummaries(extractSourceLines(INDENTED)).values())).toEqual([
			'Renders the widget.',
		])
	})

	it('reads the indented example, keeping the body indentation the block was written with', () => {
		expect(collectExamples(normalizeComment(BLOCK), 'render')).toEqual([
			{ name: 'render', title: 'Render a widget', code: '  widget.render()' },
		])
		expect(extractExamples(INDENTED)).toEqual([
			{ name: 'render', title: 'Render a widget', code: '  widget.render()' },
		])
	})

	it('projects the indented example onto the record its block documents', () => {
		expect(extractExampleLines(extractSourceLines(INDENTED)).map((line) => line.source)).toEqual([
			'export function render(): void {}',
		])
	})
})

// The fenced-body projection every tag search reads through. It replaces a body's
// characters with spaces rather than removing them, so an index found in it
// addresses the same character of the text it was built from.
describe('maskFences', () => {
	it('blanks a body while keeping its markers, its line count, and every column', () => {
		const text = ['@example', '```ts', '@decorator()', '```', '@remarks'].join('\n')
		expect(maskFences(text).split('\n')).toEqual([
			'@example',
			'```ts',
			'            ',
			'```',
			'@remarks',
		])
		expect(maskFences(text).length).toBe(text.length)
	})

	it('blanks to the end of the text when a body is never closed', () => {
		expect(maskFences(['```', '@example', ''].join('\n')).split('\n')).toEqual([
			'```',
			'        ',
			'',
		])
	})

	it('closes a body only on its own marker character and length', () => {
		expect(
			maskFences(['~~~~', '```', '@example', '~~~~', '@remarks'].join('\n')).split('\n'),
		).toEqual(['~~~~', '   ', '        ', '~~~~', '@remarks'])
	})

	it('opens a body from an indented marker, as the unwrapped block writes it', () => {
		expect(maskFences(['  ```ts', '  @decorator()', '  ```'].join('\n')).split('\n')).toEqual([
			'  ```ts',
			'              ',
			'  ```',
		])
	})

	it('leaves text carrying no marker untouched', () => {
		const text = 'Renders the widget.\n\n@example\nwidget.render()'
		expect(maskFences(text)).toBe(text)
	})
})

// A fenced body inside a doc block is example code, not doc-block structure, so a
// line inside it that looks like a block tag is outside every tag search: it ends
// no description paragraph, opens no example, and closes no example body.
describe('a tag-shaped line inside a fenced body', () => {
	const DECORATED = [
		'/**',
		' * Renders the widget.',
		' *',
		' * @example Render a widget',
		' * ```ts',
		' * class Widget {',
		' *   @decorator()',
		' *   render() {}',
		' * }',
		' * ```',
		' *',
		' * @remarks Nothing else.',
		' */',
	].join('\n')
	const RENDERED = [DECORATED, 'export function render(): void {}', ''].join('\n')
	const EXAMPLE = {
		name: 'render',
		title: 'Render a widget',
		code: 'class Widget {\n  @decorator()\n  render() {}\n}',
		language: 'ts',
	}
	const QUOTED = [
		'/**',
		' * Documents the tag:',
		' *',
		' * ```ts',
		' * @example Not a tag',
		' * ```',
		' */',
	].join('\n')
	const EXPLAINED = [QUOTED, 'export function explain(): void {}', ''].join('\n')

	it('keeps the decorator line in the example code and still ends the body at the next tag', () => {
		expect(collectExamples(normalizeComment(DECORATED), 'render')).toEqual([EXAMPLE])
		expect(extractExamples(RENDERED)).toEqual([EXAMPLE])
	})

	it('ends the description paragraph at the example tag, not at the decorator line', () => {
		expect(Array.from(collectSummaries(extractSourceLines(RENDERED)).values())).toEqual([
			'Renders the widget.',
		])
	})

	it('opens no example from a quoted tag, and keeps it in the description paragraph', () => {
		expect(collectExamples(normalizeComment(QUOTED), 'explain')).toEqual([])
		expect(extractExampleLines(extractSourceLines(EXPLAINED))).toEqual([])
		expect(Array.from(collectSummaries(extractSourceLines(EXPLAINED)).values())).toEqual([
			'Documents the tag: ```ts @example Not a tag ```',
		])
	})
})

describe('extractTagline', () => {
	it('reads the H1 blockquote, keeping its code spans', () => {
		const document = createMarkdown('# Widget\n\n> A `Widget` toolkit.\n\n## Surface\n').document
		expect(extractTagline(document)).toBe('A `Widget` toolkit.')
	})

	it('joins a two-paragraph blockquote into one line', () => {
		const document = createMarkdown('# Widget\n\n> One.\n>\n> Two.\n').document
		expect(extractTagline(document)).toBe('One. Two.')
	})

	it('returns undefined when a heading intervenes before the blockquote', () => {
		const document = createMarkdown('# Widget\n\n## Surface\n\n> A note.\n').document
		expect(extractTagline(document)).toBeUndefined()
	})

	it('returns undefined for a document with no H1', () => {
		const document = createMarkdown('> A note.\n\n## Surface\n').document
		expect(extractTagline(document)).toBeUndefined()
	})

	it("reads this repository's own guide tagline from the good fixture", () => {
		const document = createMarkdown(requireText(FIXTURES, 'good/guides/src/widget.md')).document
		expect(extractTagline(document)).toBe(
			'A tiny fixture module exercising every ExportKeyword for guides-parity tests.',
		)
	})
})

// ── The Summary column ───────────────────────────────────────────────────────
// The compared column is located by header text, the way the Kind column is, so
// a reordered table still reads and a table without the column reports the gap
// rather than agreeing silently.

describe('the Summary column', () => {
	const REORDERED = [
		'## Surface',
		'',
		'| Name | Summary | Kind |',
		'| --- | --- | --- |',
		'| `Widget` | Represents a widget. | class |',
		'',
	].join('\n')
	const ABSENT = [
		'## Surface',
		'',
		'| Name | Kind | Shape |',
		'| --- | --- | --- |',
		'| `Widget` | class | `{ render }` |',
		'',
	].join('\n')

	it('reads the Summary cell wherever the column sits', () => {
		expect(extractSurface(createMarkdown(REORDERED).document)).toEqual([
			{ name: 'Widget', keyword: 'class', summary: 'Represents a widget.' },
		])
	})

	it('leaves the summary absent when the table carries no Summary column', () => {
		expect(extractSurface(createMarkdown(ABSENT).document)).toEqual([
			{ name: 'Widget', keyword: 'class' },
		])
	})

	it('reads a Methods table the same way', () => {
		const markdown = [
			'## Methods',
			'',
			'#### `WidgetInterface`',
			'',
			'| Method | Returns | Summary |',
			'| --- | --- | --- |',
			'| `render` | `void` | Renders the widget. |',
			'',
		].join('\n')
		expect(extractMethods(createMarkdown(markdown).document)).toEqual([
			{
				interface: 'WidgetInterface',
				methods: [{ name: 'render', summary: 'Renders the widget.' }],
			},
		])
	})
})

// ── Fence titles ─────────────────────────────────────────────────────────────

describe('fence titles', () => {
	it('carries the nearest preceding heading, flattening its code spans', () => {
		const markdown = [
			'## Patterns',
			'',
			'### Construct a `Widget`',
			'',
			'```ts',
			'new Widget()',
			'```',
			'',
			'### Render it',
			'',
			'```ts',
			'widget.render()',
			'```',
			'',
		].join('\n')
		expect(extractFences(createMarkdown(markdown).document)).toEqual([
			{ language: 'ts', code: 'new Widget()', title: 'Construct a Widget' },
			{ language: 'ts', code: 'widget.render()', title: 'Render it' },
		])
	})

	it('leaves the title absent for a fence no heading precedes', () => {
		expect(extractFences(createMarkdown('```ts\nwalk()\n```\n').document)).toEqual([
			{ language: 'ts', code: 'walk()' },
		])
	})
})

// ── Drift ────────────────────────────────────────────────────────────────────
// `findDrift` compares only the pairs both sides carry: a symbol, a member, or
// a title one side lacks belongs to the bijection checks and is never reported
// twice. The negative control is drawn from outside that membership rule — a
// symbol the SB legs already report — and the positive control plants one
// disagreement of each kind and reads both sites back.

describe('findDrift', () => {
	const AGREEING_GUIDE = [
		'# Widget',
		'',
		'> A widget module.',
		'',
		'## Surface',
		'',
		'| Name | Kind | Summary |',
		'| --- | --- | --- |',
		'| `WidgetInterface` | interface | Represents a widget. |',
		'| `createWidget` | function | Creates a widget. |',
		'',
		'## Methods',
		'',
		'#### `WidgetInterface`',
		'',
		'| Method | Summary |',
		'| --- | --- |',
		'| `render` | Renders the widget. |',
		'',
		'## Patterns',
		'',
		'### Render a widget',
		'',
		'```ts',
		'widget.render()',
		'```',
		'',
	].join('\n')
	const FILES = {
		'module/index.ts': "export * from './types.js'\nexport * from './factories.js'\n",
		'module/types.ts': [
			'/**',
			' * Represents a widget.',
			' */',
			'export interface WidgetInterface {',
			'\t/**',
			'\t * Renders the widget.',
			'\t *',
			'\t * @example Render a widget',
			'\t * ```ts',
			'\t * widget.render()',
			'\t * ```',
			'\t */',
			'\trender(): void',
			'}',
			'',
		].join('\n'),
		'module/factories.ts': [
			'/**',
			' * Creates a widget.',
			' */',
			'export function createWidget(): void {}',
			'',
		].join('\n'),
	}
	const source = createSource({ files: FILES, module: 'module' })

	it('reports nothing when every compared pair agrees', () => {
		expect(findDrift(createGuide(AGREEING_GUIDE), source)).toEqual([])
	})

	it('reports one drift per kind, naming both sites', () => {
		const drifted = AGREEING_GUIDE.replace('Creates a widget.', 'Constructs a widget.')
			.replace('Renders the widget.', 'Draws the widget.')
			.replace('widget.render()', 'widget.render(true)')
		expect(findDrift(createGuide(drifted), source)).toEqual([
			{
				key: 'function createWidget',
				guide: 'Constructs a widget.',
				source: 'Creates a widget.',
			},
			{
				key: 'WidgetInterface.render',
				guide: 'Draws the widget.',
				source: 'Renders the widget.',
			},
			{
				key: 'Render a widget',
				guide: 'ts\nwidget.render(true)',
				source: 'ts\nwidget.render()',
			},
		])
	})

	it('reports the guide side absent when the table carries no Summary column', () => {
		const stripped = AGREEING_GUIDE.replace(
			'| Name | Kind | Summary |\n| --- | --- | --- |\n| `WidgetInterface` | interface | Represents a widget. |\n| `createWidget` | function | Creates a widget. |',
			'| Name | Kind |\n| --- | --- |\n| `WidgetInterface` | interface |\n| `createWidget` | function |',
		)
		expect(findDrift(createGuide(stripped), source)).toEqual([
			{ key: 'interface WidgetInterface', source: 'Represents a widget.' },
			{ key: 'function createWidget', source: 'Creates a widget.' },
		])
	})

	it('reports the source side absent when the declaration carries no doc block', () => {
		const undocumented = createSource({
			files: { ...FILES, 'module/factories.ts': 'export function createWidget(): void {}\n' },
			module: 'module',
		})
		expect(findDrift(createGuide(AGREEING_GUIDE), undocumented)).toEqual([
			{ key: 'function createWidget', guide: 'Creates a widget.' },
		])
	})

	it('reports the key alone when neither the table nor the declaration carries text', () => {
		const stripped = AGREEING_GUIDE.replace(
			'| Name | Kind | Summary |\n| --- | --- | --- |\n| `WidgetInterface` | interface | Represents a widget. |\n| `createWidget` | function | Creates a widget. |',
			'| Name | Kind |\n| --- | --- |\n| `WidgetInterface` | interface |\n| `createWidget` | function |',
		)
		const undocumented = createSource({
			files: { ...FILES, 'module/factories.ts': 'export function createWidget(): void {}\n' },
			module: 'module',
		})
		expect(findDrift(createGuide(stripped), undocumented)).toEqual([
			{ key: 'interface WidgetInterface', source: 'Represents a widget.' },
			{ key: 'function createWidget' },
		])
	})

	it('reports a fence whose language the block does not share', () => {
		const relanguaged = AGREEING_GUIDE.replace('```ts\nwidget.render()', '```js\nwidget.render()')
		expect(findDrift(createGuide(relanguaged), source)).toEqual([
			{ key: 'Render a widget', guide: 'js\nwidget.render()', source: 'ts\nwidget.render()' },
		])
	})

	it('compares the first fence under a heading and leaves a later one outside', () => {
		const later = AGREEING_GUIDE.replace(
			'```ts\nwidget.render()\n```\n',
			'```ts\nwidget.render()\n```\n\n```ts\nwidget.render(true)\n```\n',
		)
		expect(findDrift(createGuide(later), source)).toEqual([])
	})

	it('reports the first fence under a heading when a later fence agrees with the block', () => {
		const first = AGREEING_GUIDE.replace(
			'```ts\nwidget.render()\n```\n',
			'```ts\nwidget.render(true)\n```\n\n```ts\nwidget.render()\n```\n',
		)
		expect(findDrift(createGuide(first), source)).toEqual([
			{ key: 'Render a widget', guide: 'ts\nwidget.render(true)', source: 'ts\nwidget.render()' },
		])
	})

	// The negative control. Both unpaired symbols sit outside `findDrift`'s
	// membership rule, and the SB legs beside it prove the run is not vacuous.
	it('reports neither a symbol the guide alone documents nor one the barrel alone exports', () => {
		const phantomGuide = AGREEING_GUIDE.replace(
			'| `createWidget` | function | Creates a widget. |',
			'| `createWidget` | function | Creates a widget. |\n| `phantom` | function | Names nothing. |',
		)
		const stranded = createSource({
			files: {
				...FILES,
				'module/index.ts':
					"export * from './types.js'\nexport * from './factories.js'\nexport * from './stranded.js'\n",
				'module/stranded.ts': [
					'/**',
					' * Strands a widget.',
					' */',
					'export function strandWidget(): void {}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		const guide = createGuide(phantomGuide)

		expect(findMissingSymbols(guide.surface(), stranded.surface())).toEqual(['function phantom'])
		expect(findMissingSymbols(stranded.surface(), guide.surface())).toEqual([
			'function strandWidget',
		])
		expect(findDrift(guide, stranded)).toEqual([])
	})

	it('reports neither a member the guide alone documents nor a title one side alone carries', () => {
		const extra = AGREEING_GUIDE.replace(
			'| `render` | Renders the widget. |',
			'| `render` | Renders the widget. |\n| `destroy` | Tears the widget down. |',
		).replace('### Render a widget', '### Render a widget elsewhere')
		expect(findDrift(createGuide(extra), source)).toEqual([])
	})

	// A titled block on a declaration head that is not a function enters the comparison the
	// same way a member's block does, so the `class` head below pairs with the guide fence of
	// its title.
	const HEAD_GUIDE = [
		'# Widget',
		'',
		'> A widget module.',
		'',
		'## Surface',
		'',
		'| Name | Kind | Summary |',
		'| --- | --- | --- |',
		'| `Widget` | class | Represents a widget. |',
		'',
		'## Patterns',
		'',
		'### Build a widget',
		'',
		'```ts',
		'new Widget()',
		'```',
		'',
	].join('\n')
	const headSource = createSource({
		files: {
			'module/index.ts': "export * from './Widget.js'\n",
			'module/Widget.ts': [
				'/**',
				' * Represents a widget.',
				' *',
				' * @example Build a widget',
				' * ```ts',
				' * new Widget()',
				' * ```',
				' */',
				'export class Widget {}',
				'',
			].join('\n'),
		},
		module: 'module',
	})

	it('reports nothing when a class-head block and the fence of its title agree', () => {
		expect(findDrift(createGuide(HEAD_GUIDE), headSource)).toEqual([])
	})

	it('reports a class-head block against a same-titled fence carrying another body', () => {
		const drifted = HEAD_GUIDE.replace('```ts\nnew Widget()\n```', '```ts\nnew Widget(1)\n```')
		expect(findDrift(createGuide(drifted), headSource)).toEqual([
			{ key: 'Build a widget', guide: 'ts\nnew Widget(1)', source: 'ts\nnew Widget()' },
		])
	})
})

describe('computeDrift', () => {
	it('returns undefined when both sides carry the same text', () => {
		expect(computeDrift('function walk', 'Walks.', 'Walks.')).toBeUndefined()
	})

	it('reports the key alone when neither side carries text', () => {
		expect(computeDrift('function walk', undefined, undefined)).toEqual({ key: 'function walk' })
	})

	it('names both sides when they differ', () => {
		expect(computeDrift('function walk', 'Walks.', 'Walks a tree.')).toEqual({
			key: 'function walk',
			guide: 'Walks.',
			source: 'Walks a tree.',
		})
	})

	it('omits the side carrying no text', () => {
		expect(computeDrift('function walk', undefined, 'Walks a tree.')).toEqual({
			key: 'function walk',
			source: 'Walks a tree.',
		})
	})
})

describe('collectTitles', () => {
	it('keys the titled blocks a documented interface carries and skips an untitled one', () => {
		const guide = createGuide(
			'## Surface\n\n| Name | Kind |\n| --- | --- |\n| `WidgetInterface` | interface |\n',
		)
		const source = createSource({
			files: {
				'module/index.ts': "export * from './types.js'\nexport * from './helpers.js'\n",
				'module/types.ts': [
					'export interface WidgetInterface {',
					'\t/**',
					'\t * @example Render a widget',
					'\t * widget.render()',
					'\t */',
					'\trender(): void',
					'}',
					'',
				].join('\n'),
				'module/helpers.ts': [
					'/**',
					' * @example',
					' * walk()',
					' */',
					'export function walk(): void {}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect(Array.from(collectTitles(guide, source).keys())).toEqual(['Render a widget'])
	})
})

// ── The parser control ───────────────────────────────────────────────────────
// The text reader claims to attach a doc block to the declaration it documents.
// `parseSync` from `vite` answers the same question with a real parser — comments
// by range against declaration positions — so the two readings can disagree, and
// the following cases say exactly where the text reader is allowed to. `vite` is a
// development dependency and this import never reaches `src/**`, which stays
// free of a compiler and a parser.

/** The parser's reading: each block comment's description against the export it precedes. */
function readParsedSummaries(source: string): ReadonlyMap<string, string> {
	const parsed = parseSync('control.ts', source)
	const summaries = new Map<string, string>()

	for (const statement of parsed.program.body) {
		if (statement.type !== 'ExportNamedDeclaration') continue
		const declaration = statement.declaration
		if (declaration === null || declaration === undefined) continue

		const names =
			declaration.type === 'VariableDeclaration'
				? declaration.declarations.map((entry) =>
						entry.id.type === 'Identifier' ? entry.id.name : '',
					)
				: declaration.type === 'FunctionDeclaration' ||
					  declaration.type === 'TSDeclareFunction' ||
					  declaration.type === 'ClassDeclaration' ||
					  declaration.type === 'TSInterfaceDeclaration' ||
					  declaration.type === 'TSTypeAliasDeclaration'
					? [declaration.id?.name ?? '']
					: []

		const preceding = parsed.comments.filter(
			(comment) =>
				comment.type === 'Block' &&
				comment.value.startsWith('*') &&
				comment.end <= statement.start &&
				source.slice(comment.end, statement.start).trim() === '',
		)
		const attached = preceding[preceding.length - 1]
		if (attached === undefined) continue

		// The control's own unwrapping, deliberately independent of the reader's.
		const body = attached.value
			.replace(/^\*/, '')
			.split('\n')
			.map((line) => line.replace(/^\s*\*\s?/, ''))
			.join('\n')
		const tag = body.search(/(?:^|\n)@\w/)
		const description = (tag < 0 ? body : body.slice(0, tag)).replace(/\s+/g, ' ').trim()

		// An overload set declares one name several times; the first declaration
		// answers for it, which is the reader's rule too.
		for (const name of names) {
			if (name.length === 0 || summaries.has(name)) continue
			if (description.length > 0) summaries.set(name, description)
		}
	}

	return summaries
}

/** The text reader's reading, over the same source. */
function readTextSummaries(source: string): ReadonlyMap<string, string> {
	const summaries = new Map<string, string>()
	for (const symbol of extractExports(source)) {
		if (symbol.summary !== undefined && !summaries.has(symbol.name)) {
			summaries.set(symbol.name, symbol.summary)
		}
	}
	return summaries
}

// The control fixtures both key readings and the locator run against: an overload set, a block a
// blank line separates from its declaration, a block written inside a template literal, a
// re-export-only barrel, and an owner carrying documented members followed by a declaration
// outside it. One copy, because the two readings must meet the same text to be comparable.
const OVERLOADS = [
	'/**',
	' * Reads one value.',
	' */',
	'export function read(): string',
	'export function read(name: string): string',
	'export function read(name?: string): string {',
	"\treturn name ?? ''",
	'}',
	'',
].join('\n')
const SEPARATED = [
	'/**',
	' * Walks the tree.',
	' */',
	'',
	'export function walk(): void {}',
	'',
].join('\n')
const TEMPLATE = [
	'/**',
	' * Holds a sample module.',
	' */',
	'export const sample = `',
	'/**',
	' * Ghosts a widget.',
	' */',
	'export function ghost() {}',
	'`',
	'',
].join('\n')
const BARREL = [
	'/**',
	' * Re-exports the widget module.',
	' */',
	"export * from './types.js'",
	"export * from './helpers.js'",
	'',
].join('\n')
const MEMBERS = [
	'/**',
	' * Represents a widget.',
	' */',
	'export interface WidgetInterface {',
	'\t/**',
	'\t * Walks the tree.',
	'\t */',
	'\twalk(): void',
	'\t/**',
	'\t * Renders the widget.',
	'\t */',
	'\trender(): string',
	'}',
	'',
	'/**',
	' * Reads a widget.',
	' */',
	'export function read(): void {}',
	'',
].join('\n')

describe('the doc-block reader against the parser', () => {
	it('agrees with the parser on an overload set', () => {
		expect(readTextSummaries(OVERLOADS)).toEqual(readParsedSummaries(OVERLOADS))
		expect(readParsedSummaries(OVERLOADS)).toEqual(new Map([['read', 'Reads one value.']]))
	})

	it('agrees with the parser on a doc block inside a template literal', () => {
		expect(readTextSummaries(TEMPLATE)).toEqual(readParsedSummaries(TEMPLATE))
		expect(readParsedSummaries(TEMPLATE)).toEqual(new Map([['sample', 'Holds a sample module.']]))
	})

	it('agrees with the parser on a re-export-only barrel: neither reads a declaration', () => {
		expect(readTextSummaries(BARREL)).toEqual(readParsedSummaries(BARREL))
		expect(readParsedSummaries(BARREL)).toEqual(new Map())
	})

	// The one allowed miss. The reader pairs a block with the next physical
	// record, so a blank line takes the block; the parser skips whitespace and
	// attaches it. A package whose gate reads a summary writes the block against
	// its declaration, which every other case here already requires.
	it('misses a doc block a blank line separates from its declaration, which the parser attaches', () => {
		expect(readParsedSummaries(SEPARATED)).toEqual(new Map([['walk', 'Walks the tree.']]))
		expect(readTextSummaries(SEPARATED)).toEqual(new Map())
	})

	it('has no miss beyond the blank-line shape across the cases it covers', () => {
		const missed = [OVERLOADS, TEMPLATE, BARREL, SEPARATED].filter((source) => {
			const parsed = readParsedSummaries(source)
			const read = readTextSummaries(source)
			return Array.from(parsed.keys()).some((name) => read.get(name) !== parsed.get(name))
		})
		expect(missed).toEqual([SEPARATED])
	})
})

// ── The renderers and the replacers ───────────────────────────────────────────
// `renderSurface` / `renderMethods` / `renderExample` produce guide text from source
// entries; `replaceCell` / `replaceFence` rewrite one located node inside an existing
// guide's text; `locateComment` finds one doc block's region inside a file and
// `replaceSummary` / `replaceExample` rewrite that block's text. Every one returns text or
// offsets and writes nothing. The following cases prove each round trip through the reader
// that owns it, and prove the properties a propagation depends on: a rewrite changes no byte
// outside the node it names, a rewrite whose target already carries the value changes no byte
// at all, and a miss reports itself as `undefined` rather than as a silent no-op.

// This package's own source, read as the corpus the compared form must survive. A summary
// invented for a test proves the case it was written for; the doc blocks the package ships
// prove the population a propagation actually meets.
const SOURCE = readInventory(new URL('../../../src/', import.meta.url), ['.'], {
	extensions: ['.ts'],
})

// Every genuine doc block this package ships, at its raw span — the whole physical lines the
// block occupies, so the indentation and the continuation markers a rewrite must preserve are
// in the corpus. The boundaries come from `extractSourceLines`'s own aligned JSDoc projection,
// which retains a real span at its exact columns and withholds an opener written inside a
// string or a template literal; a scan of the file text cannot tell those apart. The case
// `covers every doc block extractSourceComments attaches` is what proves this walk and the
// reader that attaches blocks agree on the population.
function extractBlocks(text: string): readonly string[] {
	const blocks: string[] = []
	const lines = extractSourceLines(text)
	let open = -1

	for (let index = 0; index < lines.length; index += 1) {
		const projection = lines[index]?.jsdoc
		if (projection === undefined) {
			open = -1
			continue
		}
		if (open < 0) open = index
		if (!projection.includes('*/')) continue
		blocks.push(
			lines
				.slice(open, index + 1)
				.map((line) => line.source)
				.join('\n'),
		)
		open = -1
	}

	return blocks
}

const CORPUS = Object.values(SOURCE).flatMap((text) => extractBlocks(text))

// The floors are read from what `src/` ships, so the corpus cannot silently collapse to a
// handful of blocks and leave every case over it passing on nothing. They are floors rather
// than totals: this package's source gains doc blocks, and a total would reprice itself on
// every edit. The run that set them read 173 blocks, every one of them described.
const CORPUS_FLOOR = 150
const DESCRIBED_FLOOR = 150

// The same kind of floor for the documented members `extractDeclaration` and
// `extractMemberMethods` report over `src/`, which is the population the member half of the
// locator's control runs over. The run that set it read 16 such members.
const MEMBER_FLOOR = 12

function extractSummary(comment: string): string {
	const content = unwrapComment(comment)
	const masked = maskFences(content.join('\n')).split('\n')
	const tag = masked.findIndex((line) => /^[ \t]*@\w/.test(line))
	return normalizeSummary(content.slice(0, tag < 0 ? content.length : tag).join('\n'))
}

// A column-aligned copy of `@orkestrel/scaffold`'s committed guide: the head of its
// `## Surface` types table and its whole `CompilerInterface` methods table, with the prose
// between them. Column alignment is the point — a rewrite re-pads the table it rewrites,
// so the bytes outside that one table are what prove the splice stayed inside its span.
const GUIDE = [
	'# Scaffold',
	'',
	'> Generates and audits a workspace.',
	'',
	'## Surface',
	'',
	'### Core',
	'',
	'#### Types',
	'',
	'| Name               | Kind | Summary                                                                                          |',
	'| ------------------ | ---- | ------------------------------------------------------------------------------------------------ |',
	'| `Artifact`         | type | One file in a plan, discriminated by how its content is produced and what scaffold claims of it. |',
	'| `BuildFormat`      | type | One module format a published library environment builds.                                        |',
	'| `CatalogEntry`     | type | One package row of the fleet catalog.                                                            |',
	'| `CompileStage`     | type | The compile phases, in the order they run.                                                       |',
	"| `CompilerEventMap` | type | The compiler's observation channel.                                                              |",
	'',
	'## Methods',
	'',
	"`Compiler` implements `CompilerInterface`. Each class exposes exactly its interface's members.",
	'',
	'#### `CompilerInterface`',
	'',
	'| Method    | Summary                                                                      |',
	'| --------- | ---------------------------------------------------------------------------- |',
	'| `compile` | Compile a blueprint into a plan through the draft, gate, and pin stages.     |',
	"| `audit`   | Compile a blueprint and compare its plan to a target's current content.      |",
	'| `destroy` | Tear the compiler down. Every later call throws, and teardown is idempotent. |',
	'',
].join('\n')

// The same guide with the compared column renamed, so `findColumnIndex` locates nothing —
// the shape a package that has not adopted the column yet still carries.
const UNCOMPARED = GUIDE.replace(/Summary  /g, 'Behavior ').replace(
	'| Method    | Summary  ',
	'| Method    | Behavior ',
)

describe('the corpus this package ships', () => {
	it('carries a floor of blocks and of described blocks', () => {
		expect(CORPUS.length).toBeGreaterThanOrEqual(CORPUS_FLOOR)
		expect(
			CORPUS.filter((comment) => extractSummary(comment).length > 0).length,
		).toBeGreaterThanOrEqual(DESCRIBED_FLOOR)
	})

	it('covers every doc block extractSourceComments attaches', () => {
		const missed = Object.entries(SOURCE).flatMap(([key, text]) => {
			const read = new Set(extractBlocks(text).map((comment) => normalizeComment(comment)))
			return extractSourceComments(extractSourceLines(text))
				.filter((comment) => !read.has(comment.text))
				.map((comment) => `${key}: ${comment.text.slice(0, 40)}`)
		})
		expect(missed).toEqual([])
	})

	// The instrument must be able to fail: a walk that took whole lines from the file text
	// rather than from the JSDoc projection reads an opener inside a template literal as a
	// block, and the reader that attaches blocks never reports it.
	it('leaves an opener written inside a template literal out of the corpus', () => {
		const text = [
			'/**',
			' * Holds a sample module.',
			' */',
			'export const sample = `',
			'/**',
			' * Ghosts a widget.',
			' */',
			'export function ghost() {}',
			'`',
			'',
		].join('\n')
		expect(extractBlocks(text)).toEqual([['/**', ' * Holds a sample module.', ' */'].join('\n')])
		expect(text.split('\n').filter((line) => line === '/**').length).toBe(2)
	})
})

describe('buildCell', () => {
	it('inverts extractCellText on plain text and on a code span', () => {
		expect(buildCell('Holds a `Widget`.')).toEqual([
			{ element: 'text', value: 'Holds a ' },
			{ element: 'codeSpan', value: 'Widget' },
			{ element: 'text', value: '.' },
		])
	})

	it('reads a leading and a trailing code span', () => {
		expect(buildCell('`a` and `b`')).toEqual([
			{ element: 'codeSpan', value: 'a' },
			{ element: 'text', value: ' and ' },
			{ element: 'codeSpan', value: 'b' },
		])
	})

	it('keeps a run whose text carries a boundary space as literal text', () => {
		expect(buildCell('joined by ` | `.')).toEqual([{ element: 'text', value: 'joined by ` | `.' }])
		expect(buildCell('` | `')).toEqual([{ element: 'text', value: '` | `' }])
	})

	it('keeps a lone backtick and an empty run as literal text', () => {
		expect(buildCell('a ` here')).toEqual([{ element: 'text', value: 'a ` here' }])
		expect(buildCell('an `` empty')).toEqual([{ element: 'text', value: 'an `` empty' }])
	})

	it('reads the inner delimiter of a doubled run and leaves the outer backticks as text', () => {
		expect(buildCell('``Target``')).toEqual([
			{ element: 'text', value: '`' },
			{ element: 'codeSpan', value: 'Target' },
			{ element: 'text', value: '`' },
		])
	})

	it('renders every doc block summary this package ships back to itself', () => {
		const moved = CORPUS.map(extractSummary)
			.filter((summary) => summary.length > 0)
			.filter((summary) => {
				const rendered = renderSurface([{ name: 'walk', keyword: 'function', summary }])
				const [read] = extractSurface(createMarkdown(`## Surface\n\n${rendered}`).document)
				return read?.summary !== summary
			})
		expect(moved).toEqual([])
	})

	it('reads a summary the compared form cannot spell back as the text it was given', () => {
		// The control: `*stars*` is emphasis to a markdown parser and literal text to a doc
		// block, so a cell built by parsing the summary as markdown would lose the markers.
		const summary = 'A summary with *stars* and _underscores_ and [brackets].'
		const rendered = renderSurface([{ name: 'walk', keyword: 'function', summary }])
		expect(rendered).toContain('\\*stars\\*')
		const [read] = extractSurface(createMarkdown(`## Surface\n\n${rendered}`).document)
		expect(read?.summary).toBe(summary)
	})
})

describe('wrapText', () => {
	it('fills greedily to the width', () => {
		expect(wrapText('one two three', 8)).toEqual(['one two', 'three'])
	})

	it('gives a word longer than the width its own line rather than splitting it', () => {
		expect(wrapText('a longwordbeyondthewidth b', 6)).toEqual(['a', 'longwordbeyondthewidth', 'b'])
	})

	// The boundary the over-length clause turns on, and the consequence a caller inherits: a
	// token the width cannot hold stands alone and passes the width, so "every line stays
	// inside the width" holds for a text whose longest token fits and for no other.
	it('stands an over-length token alone and lets that one line pass the width', () => {
		expect(wrapText('abcdef gh', 6)).toEqual(['abcdef', 'gh'])
		expect(wrapText('abcdefg hi', 6)).toEqual(['abcdefg', 'hi'])
		expect(Math.max(...wrapText('abcdefg hi', 6).map((line) => line.length))).toBe(7)
	})

	it('collapses every whitespace run and returns nothing for a wordless text', () => {
		expect(wrapText('  one \n two  ', 40)).toEqual(['one two'])
		expect(wrapText('  \n  ', 40)).toEqual([])
	})
})

describe('unwrapComment and buildComment', () => {
	it('projects and rebuilds the shortest span it is given', () => {
		expect(unwrapComment(['/**', ' * Walks.', ' */'].join('\n'))).toEqual(['', 'Walks.', ''])
		expect(buildComment(['Walks.'], '')).toBe(['/**', ' * Walks.', ' */'].join('\n'))
	})

	it('projects one content line per physical line', () => {
		const comment = ['\t/**', '\t * Walks.', '\t *', '\t * @param x - A value', '\t */'].join('\n')
		expect(unwrapComment(comment)).toEqual(['', 'Walks.', '', '@param x - A value', ''])
		expect(unwrapComment(comment).length).toBe(comment.split('\n').length)
	})

	// `buildComment` writes the opener and the closer on their own lines, so the population is
	// every block this package writes across several lines. A block written on one line is
	// `replaceSummary`'s own shape decision, proven over the same corpus there.
	it('rebuilds every doc block this package writes across several lines, byte for byte', () => {
		const spans = CORPUS.filter((comment) => comment.includes('\n'))
		expect(spans.length).toBeGreaterThan(0)
		const moved = spans.filter((comment) => {
			const indent = /^[ \t]*/.exec(comment)?.[0] ?? ''
			return buildComment(unwrapComment(comment), indent) !== comment
		})
		expect(moved).toEqual([])
	})

	it('emits an empty content line as a bare marker, so no line carries trailing whitespace', () => {
		expect(buildComment(['Walks.', '', '@returns Nothing'], '')).toBe(
			['/**', ' * Walks.', ' *', ' * @returns Nothing', ' */'].join('\n'),
		)
	})
})

describe('extractRowSymbol, extractRowEntry, and extractRowSummary', () => {
	const table = requireTable(
		[
			'| Name | Kind | Summary |',
			'| --- | --- | --- |',
			'| `walk` | function | Walks the tree. |',
			'| `Widget` | class | |',
			'| no name | type | Absent. |',
			'| `Wrong` | enum | Absent. |',
		].join('\n'),
	)

	it('reads a row as a symbol with its keyword and its summary', () => {
		expect(extractRowSymbol(table, 0)).toEqual({
			name: 'walk',
			keyword: 'function',
			summary: 'Walks the tree.',
		})
	})

	it('leaves an empty summary cell absent rather than empty', () => {
		expect(extractRowSymbol(table, 1)).toEqual({ name: 'Widget', keyword: 'class' })
		expect(extractRowSummary(table, 1)).toBeUndefined()
	})

	it('keys no symbol for a row with no code-span name and none for an unknown keyword', () => {
		expect(extractRowSymbol(table, 2)).toBeUndefined()
		expect(extractRowSymbol(table, 3)).toBeUndefined()
	})

	it('reads a member entry from the same row grammar', () => {
		expect(extractRowEntry(table, 0)).toEqual({ name: 'walk', summary: 'Walks the tree.' })
		expect(extractRowEntry(table, 2)).toBeUndefined()
	})

	it('reads no summary from a table with no Summary column', () => {
		const uncompared = requireTable(
			['| Name | Kind | Behavior |', '| --- | --- | --- |', '| `walk` | function | Walks. |'].join(
				'\n',
			),
		)
		expect(extractRowSummary(uncompared, 0)).toBeUndefined()
		expect(extractRowSymbol(uncompared, 0)).toEqual({ name: 'walk', keyword: 'function' })
	})

	it('reads no row past the last row of the table', () => {
		expect(extractRowSymbol(table, 9)).toBeUndefined()
		expect(extractRowEntry(table, 9)).toBeUndefined()
		expect(extractRowSummary(table, 9)).toBeUndefined()
	})
})

describe('collectGroups and collectFences', () => {
	it('keys each Methods table to the interface its H4 names, in document order', () => {
		const document = createMarkdown(GUIDE).document
		const groups = Array.from(collectGroups(document).values())
		expect(groups).toEqual(['CompilerInterface'])
	})

	it('keeps two identical tables and two identical fences as two entries', () => {
		const document = createMarkdown(
			[
				'## Methods',
				'',
				'#### `A`',
				'',
				'| Name | Summary |',
				'| --- | --- |',
				'| `walk` | Walks. |',
				'',
				'#### `B`',
				'',
				'| Name | Summary |',
				'| --- | --- |',
				'| `walk` | Walks. |',
				'',
				'### One',
				'',
				'```ts',
				'same()',
				'```',
				'',
				'### Two',
				'',
				'```ts',
				'same()',
				'```',
				'',
			].join('\n'),
		).document
		expect(Array.from(collectGroups(document).values())).toEqual(['A', 'B'])
		expect(Array.from(collectFences(document).values())).toEqual([
			{ language: 'ts', code: 'same()', title: 'One' },
			{ language: 'ts', code: 'same()', title: 'Two' },
		])
	})

	it('reports the same fences extractFences returns, in the same order', () => {
		const document = createMarkdown(requireText(FIXTURES, 'good/guides/src/widget.md')).document
		expect(Array.from(collectFences(document).values())).toEqual(extractFences(document))
	})
})

describe('spliceSpan, buildTable, and buildFence', () => {
	it('writes over the region and keeps every byte outside it', () => {
		expect(spliceSpan('one two three', { start: 4, end: 7 }, 'TWO')).toBe('one TWO three')
	})

	it('rebuilds one cell and shares every other cell of the table', () => {
		const table = requireTable(
			['| Name | Kind | Summary |', '| --- | --- | --- |', '| `walk` | function | Walks. |'].join(
				'\n',
			),
		)
		const rebuilt = buildTable(table, 0, 2, 'Walks a tree.')
		expect(rebuilt.rows[0]?.[2]).toEqual([{ element: 'text', value: 'Walks a tree.' }])
		expect(rebuilt.rows[0]?.[0]).toBe(table.rows[0]?.[0])
		expect(rebuilt.header).toBe(table.header)
		expect(table.rows[0]?.[2]).toEqual([{ element: 'text', value: 'Walks.' }])
	})

	it('builds a tagged fence and an untagged one', () => {
		expect(buildFence({ name: 'walk', code: 'walk()', language: 'ts' })).toEqual({
			element: 'codeBlock',
			code: 'walk()',
			lang: 'ts',
		})
		expect(buildFence({ name: 'walk', code: 'walk()' })).toEqual({
			element: 'codeBlock',
			code: 'walk()',
		})
	})
})

describe('renderSurface', () => {
	const symbols: readonly SurfaceSymbol[] = [
		{ name: 'walk', keyword: 'function', summary: 'Walks the tree.' },
		{ name: 'Widget', keyword: 'class', summary: 'Represents one `Widget` in a plan.' },
		{ name: 'DEFAULT', keyword: 'const' },
	]

	it('round-trips every symbol back through extractSurface', () => {
		const rendered = renderSurface(symbols)
		expect(extractSurface(createMarkdown(`## Surface\n\n${rendered}`).document)).toEqual(symbols)
	})

	it('renders the header the reader locates its columns by', () => {
		expect(renderSurface([{ name: 'walk', keyword: 'function', summary: 'Walks the tree.' }])).toBe(
			'| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks the tree. |',
		)
	})

	it('re-renders its own output byte for byte', () => {
		const rendered = renderSurface(symbols)
		expect(renderMarkdown(createMarkdown(rendered).document)).toBe(rendered)
	})

	// The render pads every cell to one space while the committed guide is column-aligned, so
	// the reader must be blind to the padding — which is why the equality gate compares parsed
	// entries and never bytes.
	it('reads the padded render and the column-aligned table to the same symbols', () => {
		const aligned = extractSurface(createMarkdown(GUIDE).document)
		const rendered = renderSurface(aligned)
		expect(rendered).toContain('| `Artifact` | type |')
		expect(GUIDE).toContain('| `Artifact`         | type |')
		expect(extractSurface(createMarkdown(`## Surface\n\n${rendered}`).document)).toEqual(aligned)
	})

	it('renders no row for an empty symbol list', () => {
		expect(extractSurface(createMarkdown(`## Surface\n\n${renderSurface([])}`).document)).toEqual(
			[],
		)
	})
})

describe('renderMethods', () => {
	const group: MethodGroup = {
		interface: 'WidgetInterface',
		methods: [{ name: 'walk', summary: 'Walks the tree.' }, { name: 'reset' }],
	}

	it('round-trips the group back through extractMethods', () => {
		const rendered = renderMethods(group)
		expect(extractMethods(createMarkdown(`## Methods\n\n${rendered}`).document)).toEqual([group])
	})

	it('renders the interface as the H4 code span the reader keys on', () => {
		expect(
			renderMethods({
				interface: 'WidgetInterface',
				methods: [{ name: 'walk', summary: 'Walks.' }],
			}),
		).toBe('#### `WidgetInterface`\n\n| Name | Summary |\n| --- | --- |\n| `walk` | Walks. |')
	})

	it('re-renders its own output byte for byte', () => {
		const rendered = renderMethods(group)
		expect(renderMarkdown(createMarkdown(rendered).document)).toBe(rendered)
	})
})

describe('renderExample', () => {
	it('round-trips a titled block back through extractFences', () => {
		const example: SourceExample = {
			name: 'walk',
			title: 'Walk a tree',
			code: 'walk()\nwalk()',
			language: 'ts',
		}
		expect(extractFences(createMarkdown(renderExample(example)).document)).toEqual([
			{ language: 'ts', code: example.code, title: example.title },
		])
	})

	it('renders no heading for an untitled block', () => {
		const example: SourceExample = { name: 'walk', code: 'walk()', language: 'ts' }
		expect(renderExample(example)).toBe('```ts\nwalk()\n```')
		expect(extractFences(createMarkdown(renderExample(example)).document)).toEqual([
			{ language: 'ts', code: 'walk()' },
		])
	})

	it('keeps a title carrying backticks as the text the tag carried', () => {
		const example: SourceExample = {
			name: 'walk',
			title: 'Construct a `Guide`',
			code: 'walk()',
			language: 'ts',
		}
		const [fence] = extractFences(createMarkdown(renderExample(example)).document)
		expect(fence?.title).toBe('Construct a `Guide`')
	})

	it('widens the fence past a fenced body the code carries', () => {
		const example: SourceExample = { name: 'walk', code: '```\ninner\n```', language: 'md' }
		expect(extractFences(createMarkdown(renderExample(example)).document)).toEqual([
			{ language: 'md', code: '```\ninner\n```' },
		])
	})
})

describe('replaceCell', () => {
	it('replaces one Surface cell and keeps every byte outside the table', () => {
		const markdown = createMarkdown(GUIDE)
		const [table] = markdown.filter(isTableNode)
		const span = table === undefined ? undefined : markdown.span(table)
		expect(span).toBeDefined()

		const result = replaceCell(GUIDE, 'type Artifact', 'Names one file in a plan.')
		expect(result).toBeDefined()
		expect(result?.slice(0, span?.start)).toBe(GUIDE.slice(0, span?.start))
		expect(result?.slice((result?.length ?? 0) - (GUIDE.length - (span?.end ?? 0)))).toBe(
			GUIDE.slice(span?.end),
		)
	})

	it('changes the one row it names and no other row', () => {
		const result = replaceCell(GUIDE, 'type Artifact', 'Names one file in a plan.') ?? ''
		const before = extractSurface(createMarkdown(GUIDE).document)
		const after = extractSurface(createMarkdown(result).document)
		expect(after[0]).toEqual({
			name: 'Artifact',
			keyword: 'type',
			summary: 'Names one file in a plan.',
		})
		expect(after.slice(1)).toEqual(before.slice(1))
	})

	it('replaces one Methods cell by its Owner.member key', () => {
		const result = replaceCell(GUIDE, 'CompilerInterface.audit', 'Audits a target.') ?? ''
		expect(extractMethods(createMarkdown(result).document)).toEqual([
			{
				interface: 'CompilerInterface',
				methods: [
					{
						name: 'compile',
						summary: 'Compile a blueprint into a plan through the draft, gate, and pin stages.',
					},
					{ name: 'audit', summary: 'Audits a target.' },
					{
						name: 'destroy',
						summary: 'Tear the compiler down. Every later call throws, and teardown is idempotent.',
					},
				],
			},
		])
		expect(result).toContain('| `Artifact`         | type |')
	})

	it('returns the guide byte for byte when the row already carries the summary', () => {
		expect(replaceCell(GUIDE, 'type CatalogEntry', 'One package row of the fleet catalog.')).toBe(
			GUIDE,
		)
	})

	// The identity reads both sides through the compared form, so a caller handing over text
	// the form still moves writes once and stops. Comparing the argument raw against a
	// normalized cell would rewrite the row on every run, and no case passing compared-form
	// text can see that.
	it('is a fixed point on the second run for a summary the compared form moves', () => {
		for (const summary of [
			'One  package  row  of  the fleet catalog,  in order.',
			'One package row of the {@link Fleet} catalog, in order.',
			'One package row of the ` | ` fleet catalog, in order.',
		]) {
			const first = replaceCell(GUIDE, 'type CatalogEntry', summary)
			expect(first).toBeDefined()
			expect(first).not.toBe(GUIDE)
			expect(replaceCell(first ?? '', 'type CatalogEntry', summary)).toBe(first)
		}
	})

	it('returns undefined for a key no row carries', () => {
		expect(replaceCell(GUIDE, 'type Phantom', 'Absent.')).toBeUndefined()
		expect(replaceCell(GUIDE, 'CompilerInterface.phantom', 'Absent.')).toBeUndefined()
		expect(replaceCell(GUIDE, 'class Artifact', 'Absent.')).toBeUndefined()
	})

	it('returns undefined for a table carrying no Summary column', () => {
		expect(extractSurface(createMarkdown(UNCOMPARED).document)[0]?.summary).toBeUndefined()
		expect(replaceCell(UNCOMPARED, 'type Artifact', 'Absent.')).toBeUndefined()
		expect(replaceCell(UNCOMPARED, 'CompilerInterface.audit', 'Absent.')).toBeUndefined()
	})

	// The control, drawn from outside the membership rule "a row of a Surface or Methods
	// table": a class documented by a backticked H3 entity heading enters `guide.surface()`
	// through a heading rather than a row, so it keys a symbol no cell answers for.
	it('returns undefined for a symbol the guide documents outside a table', () => {
		const heading = GUIDE.replace(
			'## Methods',
			'### `Compiler`\n\nThe implementing class.\n\n## Methods',
		)
		expect(extractSurface(createMarkdown(heading).document)).toContainEqual({
			name: 'Compiler',
			keyword: 'class',
		})
		expect(replaceCell(heading, 'class Compiler', 'Absent.')).toBeUndefined()
	})
})

describe('replaceFence', () => {
	const FENCED = [
		'# Guide',
		'',
		'### Walk a tree',
		'',
		'```ts',
		'old()',
		'```',
		'',
		'Prose between the fences.',
		'',
		'```ts',
		'later()',
		'```',
		'',
	].join('\n')

	it('replaces the fence of that title and keeps every byte outside it', () => {
		const result = replaceFence(FENCED, 'Walk a tree', {
			name: 'walk',
			title: 'Walk a tree',
			code: 'walk()',
			language: 'ts',
		})
		expect(result).toBe(FENCED.replace('old()', 'walk()'))
	})

	it('leaves a later fence of the same title outside the pairing', () => {
		const repeated = FENCED.replace('Prose between the fences.', '### Walk a tree')
		const result =
			replaceFence(repeated, 'Walk a tree', {
				name: 'walk',
				title: 'Walk a tree',
				code: 'walk()',
				language: 'ts',
			}) ?? ''
		expect(result).toContain('walk()')
		expect(result).toContain('later()')
	})

	it('replaces the fence language with the body', () => {
		const result =
			replaceFence(FENCED, 'Walk a tree', {
				name: 'walk',
				title: 'Walk a tree',
				code: 'walk()',
				language: 'js',
			}) ?? ''
		expect(extractFences(createMarkdown(result).document)[0]).toEqual({
			language: 'js',
			code: 'walk()',
			title: 'Walk a tree',
		})
	})

	it('returns the guide byte for byte when the fence already carries that body', () => {
		expect(
			replaceFence(FENCED, 'Walk a tree', {
				name: 'walk',
				title: 'Walk a tree',
				code: 'old()',
				language: 'ts',
			}),
		).toBe(FENCED)
	})

	// The control, drawn from outside the membership rule "a fence carrying that title":
	// a fence no heading precedes carries none, so no title reaches it.
	it('returns undefined for a title no fence carries and for a fence with no title', () => {
		expect(
			replaceFence(FENCED, 'Absent', { name: 'walk', code: 'walk()', language: 'ts' }),
		).toBeUndefined()
		const untitled = '```ts\nold()\n```\n'
		expect(extractFences(createMarkdown(untitled).document)[0]?.title).toBeUndefined()
		expect(
			replaceFence(untitled, 'Walk a tree', { name: 'walk', code: 'walk()', language: 'ts' }),
		).toBeUndefined()
	})
})

describe('replaceSummary', () => {
	const TAGGED = [
		'\t/**',
		'\t * Walks the tree.',
		'\t *',
		'\t * @remarks',
		'\t * The walk is depth-first.',
		'\t *',
		'\t * @param tree - The tree to walk',
		'\t * @returns Nothing',
		'\t *',
		'\t * @example First',
		'\t * ```ts',
		'\t * walk(tree)',
		'\t * ```',
		'\t *',
		'\t * @example Second',
		'\t * ```ts',
		'\t * walk(other)',
		'\t * ```',
		'\t */',
	].join('\n')

	it('replaces the description and leaves every tag line, the separator, and the markers', () => {
		const result = replaceSummary(TAGGED, 'Walks a tree depth-first, yielding every node it meets.')
		expect(result?.split('\n').slice(0, 4)).toEqual([
			'\t/**',
			'\t * Walks a tree depth-first, yielding every node it meets.',
			'\t *',
			'\t * @remarks',
		])
		expect(result?.split('\n').slice(3)).toEqual(TAGGED.split('\n').slice(3))
	})

	it('reads the new description back through the reader that compares it', () => {
		const summary = 'Walks a tree depth-first, yielding every node it meets.'
		expect(extractSummary(replaceSummary(TAGGED, summary) ?? '')).toBe(summary)
	})

	it('wraps a long description inside the default budget', () => {
		const summary = Array.from({ length: 40 }, (_unused, index) => `word${index}`).join(' ')
		const result = replaceSummary(TAGGED, summary) ?? ''
		const wrapped = result.split('\n').filter((line) => line.startsWith('\t * word'))
		expect(wrapped.length).toBeGreaterThan(1)
		expect(Math.max(...result.split('\n').map((line) => line.length))).toBeLessThanOrEqual(
			WRAP_WIDTH,
		)
		expect(extractSummary(result)).toBe(summary)
	})

	it('wraps at the width its caller names instead of the default', () => {
		const summary = Array.from({ length: 40 }, (_unused, index) => `word${index}`).join(' ')
		const narrow = replaceSummary(TAGGED, summary, 40) ?? ''
		const wide = replaceSummary(TAGGED, summary) ?? ''
		expect(Math.max(...narrow.split('\n').map((line) => line.length))).toBeLessThanOrEqual(40)
		expect(narrow.split('\n').length).toBeGreaterThan(wide.split('\n').length)
		expect(extractSummary(narrow)).toBe(summary)
	})

	// The width is a character budget, and a token it cannot hold stands on its own line and
	// passes it — `wrapText`'s documented exception, reaching the caller here.
	it('lets a token longer than the budget pass it on its own line', () => {
		const token = 'a'.repeat(WRAP_WIDTH)
		const result = replaceSummary('/** Short. */', `Holds ${token}.`) ?? ''
		expect(result.split('\n')).toContain(` * ${token}.`)
		expect(Math.max(...result.split('\n').map((line) => line.length))).toBeGreaterThan(WRAP_WIDTH)
	})

	it('returns every described doc block this package ships byte for byte when the summary is its own', () => {
		const described = CORPUS.filter((comment) => extractSummary(comment).length > 0)
		expect(described.length).toBeGreaterThanOrEqual(DESCRIBED_FLOOR)
		const moved = described.filter(
			(comment) => replaceSummary(comment, extractSummary(comment)) !== comment,
		)
		expect(moved).toEqual([])
	})

	// The instrument must be able to fail: the same corpus with a summary that is not the
	// block's own must move every block that carries a description.
	it('moves every doc block carrying a description when the summary is not its own', () => {
		const described = CORPUS.filter((comment) => extractSummary(comment).length > 0)
		expect(described.length).toBeGreaterThanOrEqual(DESCRIBED_FLOOR)
		const kept = described.filter(
			(comment) => replaceSummary(comment, 'A different summary.') === comment,
		)
		expect(kept).toEqual([])
	})

	it('keeps a one-line block on one line while the summary still fits', () => {
		expect(replaceSummary('\t/** Holds the identifier. */', 'Holds the name.')).toBe(
			'\t/** Holds the name. */',
		)
		expect(replaceSummary('/** Walks. */', 'Walks a tree.')).toBe('/** Walks a tree. */')
	})

	it('expands a one-line block whose new summary passes the width', () => {
		const summary = Array.from({ length: 20 }, (_unused, index) => `word${index}`).join(' ')
		const result = replaceSummary('/** Short. */', summary) ?? ''
		expect(result.split('\n')[0]).toBe('/**')
		expect(extractSummary(result)).toBe(summary)
	})

	it('writes the description into a block that carries only tags', () => {
		const tagsOnly = ['/**', ' * @returns Nothing', ' */'].join('\n')
		expect(replaceSummary(tagsOnly, 'Walks the tree.')).toBe(
			['/**', ' * Walks the tree.', ' *', ' * @returns Nothing', ' */'].join('\n'),
		)
	})

	it('returns a block carrying no tag byte for byte when the summary is its own', () => {
		const tagless = ['/**', ' * Walks the tree.', ' */'].join('\n')
		expect(replaceSummary(tagless, 'Walks the tree.')).toBe(tagless)
		expect(replaceSummary(tagless, 'Walks a tree.')).toBe(
			['/**', ' * Walks a tree.', ' */'].join('\n'),
		)
	})

	// A summary carrying no word names no paragraph to write, so the block keeps the
	// documentation it has. Deleting the description on an absent value is the erasure this
	// refusal exists to stop, and a block carrying no tag is where it did the most damage.
	it('returns undefined for a summary carrying no word and deletes no description', () => {
		const tagless = ['/**', ' * Walks the tree.', ' */'].join('\n')
		expect(replaceSummary(TAGGED, '')).toBeUndefined()
		expect(replaceSummary(TAGGED, '   \n  ')).toBeUndefined()
		expect(replaceSummary(tagless, '')).toBeUndefined()
	})

	// The control, drawn from outside the membership rule "a genuine JSDoc span": a
	// single-star block comment is not one, and reshaping it into one would be a silent edit.
	it('returns undefined for a single-star block comment and for a line comment', () => {
		expect(replaceSummary('/* Walks the tree. */', 'Walks a tree.')).toBeUndefined()
		expect(replaceSummary('// Walks the tree.', 'Walks a tree.')).toBeUndefined()
	})
})

describe('replaceExample', () => {
	const TAGGED = [
		'\t/**',
		'\t * Walks the tree.',
		'\t *',
		'\t * @param tree - The tree to walk',
		'\t *',
		'\t * @example First',
		'\t * ```ts',
		'\t * walk(tree)',
		'\t * ```',
		'\t *',
		'\t * @example Second',
		'\t * ```ts',
		'\t * walk(other)',
		'\t * ```',
		'\t */',
	].join('\n')

	it('replaces the body of the tag carrying that title and leaves the other tag alone', () => {
		const result = replaceExample(TAGGED, {
			name: 'walk',
			title: 'First',
			code: 'walk(root)\nwalk(leaf)',
			language: 'js',
		})
		expect(result).toBe(
			[
				'\t/**',
				'\t * Walks the tree.',
				'\t *',
				'\t * @param tree - The tree to walk',
				'\t *',
				'\t * @example First',
				'\t * ```js',
				'\t * walk(root)',
				'\t * walk(leaf)',
				'\t * ```',
				'\t *',
				'\t * @example Second',
				'\t * ```ts',
				'\t * walk(other)',
				'\t * ```',
				'\t */',
			].join('\n'),
		)
	})

	it('reads the new body back through the reader that compares it', () => {
		const example: SourceExample = {
			name: 'walk',
			title: 'Second',
			code: 'walk(root)',
			language: 'ts',
		}
		const result = replaceExample(TAGGED, example)
		expect(collectExamples(normalizeComment(result ?? ''), 'walk')).toContainEqual(example)
	})

	it('returns the block byte for byte when the tag already carries that body', () => {
		expect(
			replaceExample(TAGGED, {
				name: 'walk',
				title: 'First',
				code: 'walk(tree)',
				language: 'ts',
			}),
		).toBe(TAGGED)
	})

	it('returns undefined for a title no tag carries and for an untitled request', () => {
		expect(
			replaceExample(TAGGED, { name: 'walk', title: 'Third', code: 'walk()', language: 'ts' }),
		).toBeUndefined()
		expect(replaceExample(TAGGED, { name: 'walk', code: 'walk()', language: 'ts' })).toBeUndefined()
		expect(TAGGED).toContain('@example First')
		expect(TAGGED).toContain('@example Second')
	})

	// The emitted fence is three backticks, and `collectExamples` reads a body to the first
	// such run. Writing a body that carries one would truncate it and turn the `@returns` line
	// after it into the body's end, so the replacement refuses instead of writing a block the
	// reader cannot read back.
	it('returns undefined for code the emitted fence cannot enclose', () => {
		const example: SourceExample = {
			name: 'walk',
			title: 'First',
			code: '```md\ninner\n```',
			language: 'md',
		}
		expect(replaceExample(TAGGED, example)).toBeUndefined()
		expect(replaceExample(TAGGED, { ...example, code: '~~~md\ninner\n~~~' })).toBeDefined()
	})

	// A doc block ends at its first `*/`, so a body carrying that terminator would close the
	// block early and leave the tags after it outside the comment. The replacement refuses
	// instead of writing a block the parser reads back as something else.
	it('returns undefined for code carrying the comment terminator the block cannot hold', () => {
		const example: SourceExample = {
			name: 'walk',
			title: 'First',
			code: '/**\n * Walks.\n */',
			language: 'ts',
		}
		expect(replaceExample(TAGGED, example)).toBeUndefined()
	})

	it('returns undefined for a language the fence line cannot carry', () => {
		const example: SourceExample = {
			name: 'walk',
			title: 'First',
			code: 'walk()',
			language: 'ts */',
		}
		expect(replaceExample(TAGGED, example)).toBeUndefined()
		expect(replaceExample(TAGGED, { ...example, language: `ts ${'```'}` })).toBeUndefined()
	})

	it('replaces the untitled tag of a block whose tag carries no title', () => {
		const untitled = ['/**', ' * @example', ' * ```ts', ' * old()', ' * ```', ' */'].join('\n')
		expect(replaceExample(untitled, { name: 'walk', code: 'walk()', language: 'ts' })).toBe(
			['/**', ' * @example', ' * ```ts', ' * walk()', ' * ```', ' */'].join('\n'),
		)
	})

	it('keeps a tag-shaped line inside the current body out of the tag search', () => {
		const masked = [
			'/**',
			' * @example First',
			' * ```ts',
			' * // @param is example code, not a tag',
			' * old()',
			' * ```',
			' *',
			' * @returns Nothing',
			' */',
		].join('\n')
		expect(
			replaceExample(masked, { name: 'walk', title: 'First', code: 'walk()', language: 'ts' }),
		).toBe(
			[
				'/**',
				' * @example First',
				' * ```ts',
				' * walk()',
				' * ```',
				' *',
				' * @returns Nothing',
				' */',
			].join('\n'),
		)
	})

	// The controls, drawn from outside the membership rule "a genuine JSDoc span carrying an
	// `@example` tag of that title": a block with no such tag, and a single-star comment.
	it('returns undefined for a block with no @example tag and for a single-star block comment', () => {
		const none = ['/**', ' * Walks the tree.', ' *', ' * @returns Nothing', ' */'].join('\n')
		expect(replaceExample(none, { name: 'walk', title: 'First', code: 'walk()' })).toBeUndefined()
		expect(
			replaceExample('/* @example First */', { name: 'walk', title: 'First', code: 'walk()' }),
		).toBeUndefined()
	})
})

// A one-tab callable inside a declaration that owns no members: the head keyword decides, so the
// owner the interface opened is closed by the `const` head and the member under it keys nothing.
const UNOWNED = [
	'export interface Widget {',
	'\twalk(): void',
	'}',
	'export const table = {',
	'\tghost(): void {},',
	'}',
	'',
].join('\n')

describe('extractBodyLines', () => {
	it('opens the projection with the owner head it supplies', () => {
		const projected = extractBodyLines(['\twalk(): void'])
		expect(projected.map((line) => line.code)).toEqual([
			'export interface Owner {',
			'\twalk(): void',
		])
	})

	it('gives a body member the owner key the supplied head names', () => {
		const keys = collectKeys(extractBodyLines(['\twalk(): void', '\trender(): string']))
		expect(Array.from(keys.values())).toEqual(['interface Owner', 'Owner.walk', 'Owner.render'])
	})

	// The one boundary the supplied head carries: a column-zero `}` closes it, the same rule
	// `collectKeys` runs over a whole file. `extractDeclaration` ends a body at the first one, so a
	// body it returns never reaches this.
	it('leaves a member past a column-zero brace unkeyed, because that brace closes the head', () => {
		const keys = collectKeys(extractBodyLines(['\twalk(): void', '}', '\tghost(): void']))
		expect(Array.from(keys.values())).toEqual(['interface Owner', 'Owner.walk'])
		expect(extractMemberMethods(['\twalk(): void', '}', '\tghost(): void'])).toEqual([
			{ name: 'walk' },
		])
		expect(
			extractExampleMethods([
				'\t/** @example */',
				'\twalk(): void',
				'}',
				'\t/** @example */',
				'\tghost(): void',
			]).map((example) => example.name),
		).toEqual(['walk'])
	})
})

describe('collectKeys', () => {
	// Every head of an overload set keys, because the map addresses physical records rather than
	// names; deduping by (keyword, name) is `extractExports`'s own step over these values.
	it('keys every column-zero export head by its symbol key, one entry per record', () => {
		expect(Array.from(collectKeys(extractSourceLines(OVERLOADS)).values())).toEqual([
			'function read',
			'function read',
			'function read',
		])
	})

	it('keys a declaration a blank line separates from its block, which the block reader misses', () => {
		expect(Array.from(collectKeys(extractSourceLines(SEPARATED)).values())).toEqual([
			'function walk',
		])
	})

	it('keys no head written inside a template literal', () => {
		expect(Array.from(collectKeys(extractSourceLines(TEMPLATE)).values())).toEqual(['const sample'])
	})

	it('keys nothing in a re-export-only barrel, which declares no head', () => {
		expect(Array.from(collectKeys(extractSourceLines(BARREL)).values())).toEqual([])
	})

	it('keys a one-tab callable member by Owner.member and closes the owner at its brace', () => {
		expect(Array.from(collectKeys(extractSourceLines(MEMBERS)).values())).toEqual([
			'interface WidgetInterface',
			'WidgetInterface.walk',
			'WidgetInterface.render',
			'function read',
		])
	})

	it('keys a class and its member the way its own documented example states', () => {
		const keys = collectKeys(extractSourceLines('export class Widget {\n\twalk(): void\n}'))
		expect(Array.from(keys.values())).toEqual(['class Widget', 'Widget.walk'])
	})

	it('closes an owner at a head carrying any other keyword', () => {
		expect(Array.from(collectKeys(extractSourceLines(UNOWNED)).values())).toEqual([
			'interface Widget',
			'Widget.walk',
			'const table',
		])
	})

	it('strips a generator marker before keying, as the symbol key spells it', () => {
		const source = 'export async function* walk() {}\nexport class Widget {}\n'
		expect(Array.from(collectKeys(extractSourceLines(source)).values())).toEqual([
			'function walk',
			'class Widget',
		])
	})

	// The projection each reader splits back out of the key it reads. A test named for the split
	// rather than for one reader, because the same key serves all of them.
	it('carries the keyword and the member name each reader splits back out of it', () => {
		expect(extractExports(MEMBERS)).toEqual([
			{ name: 'WidgetInterface', keyword: 'interface', summary: 'Represents a widget.' },
			{ name: 'read', keyword: 'function', summary: 'Reads a widget.' },
		])
		expect(
			extractMemberMethods(extractDeclaration(MEMBERS, 'interface', 'WidgetInterface')?.body ?? []),
		).toEqual([
			{ name: 'render', summary: 'Renders the widget.' },
			{ name: 'walk', summary: 'Walks the tree.' },
		])
	})
})

describe('locateComment', () => {
	it('reports the region of the block its declaration key names', () => {
		const text = ['/**', ' * Walks. ', ' */', 'export function walk(): void {}', ''].join('\n')
		const span = locateComment(text, 'function walk')
		expect(span).toBeDefined()
		expect(text.slice(span?.start, span?.end)).toBe(['/**', ' * Walks. ', ' */'].join('\n'))
	})

	it('reports the region its own documented example states', () => {
		const text = '/** Walks. */\nexport function walk(): void {}\n'
		expect(locateComment(text, 'function walk')).toEqual({ start: 0, end: 13 })
	})

	it('reaches the first head of an overload set', () => {
		const span = locateComment(OVERLOADS, 'function read')
		expect(OVERLOADS.slice(span?.start, span?.end)).toBe(
			['/**', ' * Reads one value.', ' */'].join('\n'),
		)
	})

	it('reports a member region with its indentation, keyed by Owner.member', () => {
		const walk = locateComment(MEMBERS, 'WidgetInterface.walk')
		const render = locateComment(MEMBERS, 'WidgetInterface.render')
		expect(MEMBERS.slice(walk?.start, walk?.end)).toBe(
			['\t/**', '\t * Walks the tree.', '\t */'].join('\n'),
		)
		expect(MEMBERS.slice(render?.start, render?.end)).toBe(
			['\t/**', '\t * Renders the widget.', '\t */'].join('\n'),
		)
	})

	it('closes an owner at its column-zero brace, so a later declaration keys no member', () => {
		expect(locateComment(MEMBERS, 'interface WidgetInterface')).toBeDefined()
		expect(locateComment(MEMBERS, 'function read')).toBeDefined()
		expect(locateComment(MEMBERS, 'WidgetInterface.read')).toBeUndefined()
	})

	// The misses this locator inherits from the reader that attaches blocks, each already
	// recorded as that reader's own boundary. A block a blank line separates from its
	// declaration attaches to the blank line; a block written inside a template literal is no
	// genuine span; a re-export row declares nothing to key.
	it('misses the shapes the attaching reader misses, and no others here', () => {
		expect(locateComment(SEPARATED, 'function walk')).toBeUndefined()
		expect(locateComment(TEMPLATE, 'function ghost')).toBeUndefined()
		expect(locateComment(BARREL, 'const types')).toBeUndefined()
		expect(TEMPLATE.slice(0, 3)).toBe('/**')
		const outer = locateComment(TEMPLATE, 'const sample')
		expect(TEMPLATE.slice(outer?.start, outer?.end)).toBe(
			['/**', ' * Holds a sample module.', ' */'].join('\n'),
		)
	})

	it('returns undefined for a key nothing in the file carries', () => {
		expect(locateComment(OVERLOADS, 'function phantom')).toBeUndefined()
		expect(locateComment(OVERLOADS, 'const read')).toBeUndefined()
		expect(locateComment(OVERLOADS, 'Phantom.read')).toBeUndefined()
	})

	it('reports offsets a CRLF file carries', () => {
		const text = ['/**', ' * Walks.', ' */', 'export function walk(): void {}', ''].join('\r\n')
		const span = locateComment(text, 'function walk')
		expect(text.slice(span?.start, span?.end)).toBe(['/**', ' * Walks.', ' */'].join('\r\n'))
	})

	it('locates the last block of a contiguous run, which is the one the reader attaches', () => {
		const text = [
			'/**',
			' * First.',
			' */',
			'/**',
			' * Second.',
			' */',
			'export function walk(): void {}',
			'',
		].join('\n')
		const span = locateComment(text, 'function walk')
		expect(text.slice(span?.start, span?.end)).toBe(['/**', ' * Second.', ' */'].join('\n'))
	})

	// The seed's source-writing direction over a head that is not a function: the key names a
	// `class`, the locator reaches its block, `replaceExample` rewrites the body, and the
	// reader the gate compares on reads the rewritten block back.
	it('carries an example rewrite back into a class head, read by the reader the gate compares on', () => {
		const text = [
			'/**',
			' * Represents a widget.',
			' *',
			' * @example Build a widget',
			' * ```ts',
			' * new Widget()',
			' * ```',
			' */',
			'export class Widget {}',
			'',
		].join('\n')
		const span = locateComment(text, 'class Widget')
		expect(span).toBeDefined()
		const block = text.slice(span?.start, span?.end)
		expect(block).toBe(
			[
				'/**',
				' * Represents a widget.',
				' *',
				' * @example Build a widget',
				' * ```ts',
				' * new Widget()',
				' * ```',
				' */',
			].join('\n'),
		)

		const example: SourceExample = {
			name: 'Widget',
			title: 'Build a widget',
			code: 'new Widget(1)',
			language: 'ts',
		}
		const rewritten = replaceExample(block, example)
		expect(rewritten).toBeDefined()
		const written = spliceSpan(text, span ?? { start: 0, end: 0 }, rewritten ?? '')
		expect(extractExamples(written)).toEqual([example])
	})

	// The end-to-end the seed runs: locate the block, rewrite it, splice it back, and read the
	// new description through `collectSummaries` over `extractSourceLines` — the reader the
	// parity gate compares on, rather than a projection re-derived in this file.
	it('carries a rewrite back into the file, read by the reader the gate compares on', () => {
		const span = locateComment(MEMBERS, 'WidgetInterface.walk')
		expect(span).toBeDefined()
		const block = MEMBERS.slice(span?.start, span?.end)
		const rewritten = replaceSummary(block, 'Walks a tree depth-first.')
		expect(rewritten).toBeDefined()
		const written = spliceSpan(MEMBERS, span ?? { start: 0, end: 0 }, rewritten ?? '')

		expect(Array.from(collectSummaries(extractSourceLines(written)).values())).toContain(
			'Walks a tree depth-first.',
		)
		expect(written.split('\n')).toContain('\t * Walks a tree depth-first.')
		expect(written.slice(0, span?.start)).toBe(MEMBERS.slice(0, span?.start))
		expect(written.slice((written.length ?? 0) - (MEMBERS.length - (span?.end ?? 0)))).toBe(
			MEMBERS.slice(span?.end),
		)
	})

	// Over this package's own source: every export the reader gives a summary must have a
	// locatable block, and the block's own description must be that summary. A locator that
	// found the wrong block, or the block of the declaration before it, reddens here.
	it('locates the block behind every summary this package ships', () => {
		const missed = Object.entries(SOURCE).flatMap(([key, text]) =>
			extractExports(text)
				.filter((symbol) => symbol.summary !== undefined)
				.filter((symbol) => {
					const span = locateComment(text, computeSymbolKey(symbol))
					if (span === undefined) return true
					return extractSummary(text.slice(span.start, span.end)) !== symbol.summary
				})
				.map((symbol) => `${key}: ${computeSymbolKey(symbol)}`),
		)
		expect(missed).toEqual([])
		expect(
			Object.values(SOURCE).flatMap((text) =>
				extractExports(text).filter((symbol) => symbol.summary !== undefined),
			).length,
		).toBeGreaterThan(0)
	})

	// The member half of the same control, at the same scale. This control proves the located
	// region for a real member: a locator that returns the wrong region reddens it. A drift in the
	// member grammar or the owner-close rule moves both sides of this control together, because
	// both read `collectKeys`; that drift is caught by `Guide`'s bijection matrix and by the
	// `extractBodyLines` case that closes an owner at its brace. Every documented member the
	// declaration readers report must have a locatable block whose own description is that
	// member's summary.
	it('locates the block behind every documented member this package ships', () => {
		const members = Object.entries(SOURCE).flatMap(([file, text]) =>
			(['class', 'interface'] as const).flatMap((keyword) =>
				extractExports(text)
					.filter((symbol) => symbol.keyword === keyword)
					.flatMap((symbol) =>
						extractMemberMethods(extractDeclaration(text, keyword, symbol.name)?.body ?? [])
							.filter((entry) => entry.summary !== undefined)
							.map((entry) => ({ file, text, key: `${symbol.name}.${entry.name}`, entry })),
					),
			),
		)
		const missed = members.filter((member) => {
			const span = locateComment(member.text, member.key)
			if (span === undefined) return true
			return extractSummary(member.text.slice(span.start, span.end)) !== member.entry.summary
		})

		expect(missed.map((member) => `${member.file}: ${member.key}`)).toEqual([])
		expect(members.length).toBeGreaterThan(MEMBER_FLOOR)
	})
})
