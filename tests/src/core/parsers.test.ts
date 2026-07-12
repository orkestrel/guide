import {
	declarationBody,
	exportsFrom,
	extractLinks,
	extractMethods,
	extractSurface,
	extractTests,
	joinHead,
	memberMethods,
	parseManifest,
	sectionBlocks,
} from '@src/core'
import { createMarkdown } from '@orkestrel/markdown'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../../setup.js'

// The guide-markdown scanners (section scoping, Surface/Methods/Links/Tests
// extraction, manifest row parsing) plus the source-text declaration grammar
// (exportsFrom, joinHead, declarationBody, memberMethods). Composed behavior —
// helpers.test.ts covers the pure primitives these build on (AGENTS §16).

describe('sectionBlocks', () => {
	it('scopes to the blocks between a heading and the next ## heading', () => {
		const document = createMarkdown('## A\n\npara-a\n\n## B\n\npara-b\n').document
		const blocks = sectionBlocks(document, 'A')
		expect(blocks).toHaveLength(1)
	})

	it('runs to the document end when no later ## heading exists', () => {
		const document = createMarkdown('## A\n\npara-a\n\npara-a2\n').document
		expect(sectionBlocks(document, 'A')).toHaveLength(2)
	})

	it('returns an empty array when the heading is missing', () => {
		const document = createMarkdown('## A\n\npara-a\n').document
		expect(sectionBlocks(document, 'B')).toEqual([])
	})

	it('stops at a level-1 or level-2 heading but not a level-3 heading', () => {
		const document = createMarkdown('## A\n\n### Sub\n\npara\n\n## B\n\npara-b\n').document
		const blocks = sectionBlocks(document, 'A')
		expect(blocks).toHaveLength(2)
	})
})

describe('extractSurface', () => {
	it("extracts the good fixture guide's exact 6-symbol surface", () => {
		const document = createMarkdown(readFixture('good/guides/src/widget.md')).document
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
		const document = createMarkdown(readFixture('good/guides/src/widget.md')).document
		const surface = extractSurface(document)
		expect(surface.some((symbol) => symbol.name === 'WidgetInterface')).toBe(true)
		expect(surface.some((symbol) => symbol.name.includes('<'))).toBe(false)
	})

	it('unions a backticked H3 entity heading as a class symbol', () => {
		const document = createMarkdown(readFixture('good/guides/src/widget.md')).document
		const surface = extractSurface(document)
		expect(surface).toContainEqual({ name: 'Widget', kind: 'class' })
	})

	it('extracts empty when the Surface heading was renamed', () => {
		const document = createMarkdown(readFixture('broken/renamed-surface/widget.md')).document
		expect(extractSurface(document)).toEqual([])
	})
})

describe('extractMethods', () => {
	it('extracts one group of inspect/render/reset from the good fixture', () => {
		const document = createMarkdown(readFixture('good/guides/src/widget.md')).document
		expect(extractMethods(document)).toEqual([
			{ interface: 'WidgetInterface', methods: ['inspect', 'render', 'reset'] },
		])
	})

	it('reflects a missing method row (missing-interface-method fixture)', () => {
		const document = createMarkdown(
			readFixture('broken/missing-interface-method/widget.md'),
		).document
		expect(extractMethods(document)).toEqual([
			{ interface: 'WidgetInterface', methods: ['inspect', 'render'] },
		])
	})

	it('reflects a phantom method row (phantom-method fixture)', () => {
		const document = createMarkdown(readFixture('broken/phantom-method/widget.md')).document
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
		const document = createMarkdown(readFixture('broken/broken-link/widget.md')).document
		expect(extractLinks(document)).toContain('../../good/module/gone.ts')
	})
})

describe('extractTests', () => {
	it("extracts only the Tests section's links", () => {
		const document = createMarkdown(readFixture('good/guides/src/widget.md')).document
		expect(extractTests(document)).toEqual(['../../tests/widget.test.ts'])
	})

	it('excludes links outside the Tests section', () => {
		const document = createMarkdown(readFixture('broken/broken-link/widget.md')).document
		expect(extractTests(document)).toEqual(['../../good/tests/widget.test.ts'])
	})

	it('returns empty when the Tests heading is missing', () => {
		const document = createMarkdown('## Surface\n\npara\n').document
		expect(extractTests(document)).toEqual([])
	})
})

describe('parseManifest', () => {
	it("parses the good manifest's one row with normalized paths", () => {
		const entries = parseManifest(readFixture('good/guides/README.md'), 'guides')
		expect(entries).toEqual([
			{ concept: 'Widget', spec: 'guides/src/widget.md', source: 'module', tests: 'tests' },
		])
	})

	it('returns an empty array for an empty manifest table', () => {
		expect(parseManifest(readFixture('broken/empty-manifest/README.md'), 'guides')).toEqual([])
	})

	it('skips a row missing a concept', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n|  | [s](s.md) | [m](m) | [t](t) |\n'
		expect(parseManifest(markdown, 'guides')).toEqual([])
	})

	it('skips a row missing a spec link', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n| X | no-link | [m](m) | [t](t) |\n'
		expect(parseManifest(markdown, 'guides')).toEqual([])
	})

	it('skips a row missing a source link', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n| X | [s](s.md) | no-link | [t](t) |\n'
		expect(parseManifest(markdown, 'guides')).toEqual([])
	})

	it('skips a row missing a tests link', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n| X | [s](s.md) | [m](m) | no-link |\n'
		expect(parseManifest(markdown, 'guides')).toEqual([])
	})

	it('collapses a single source directory to a string', () => {
		const entries = parseManifest(readFixture('good/guides/README.md'), 'guides')
		expect(entries[0]?.source).toBe('module')
	})

	it('collects multiple source links into an array', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n| X | [s](s.md) | [a](a) [b](b) | [t](t) |\n'
		const entries = parseManifest(markdown, 'guides')
		expect(entries[0]?.source).toEqual(['guides/a', 'guides/b'])
	})
})

describe('exportsFrom', () => {
	it('scans all five ExportKind declarations from the good fixture types.ts', () => {
		const symbols = exportsFrom(readFixture('good/module/types.ts'))
		expect(symbols).toEqual([
			{ name: 'WidgetInterface', kind: 'interface' },
			{ name: 'WidgetKind', kind: 'type' },
		])
	})

	it('scans a plain function, an async function, a class, and a const', () => {
		const source =
			'export function a() {}\nexport async function b() {}\nexport class C {}\nexport const D = 1\n'
		expect(exportsFrom(source)).toEqual([
			{ name: 'a', kind: 'function' },
			{ name: 'b', kind: 'function' },
			{ name: 'C', kind: 'class' },
			{ name: 'D', kind: 'const' },
		])
	})

	it('scans a generator function as kind function', () => {
		expect(exportsFrom('export function* walk() {}\n')).toEqual([
			{ name: 'walk', kind: 'function' },
		])
	})

	it('dedupes a repeated (kind, name) pair', () => {
		const source = 'export class X {}\nexport class X {}\n'
		expect(exportsFrom(source)).toEqual([{ name: 'X', kind: 'class' }])
	})

	it('ignores non-export lines', () => {
		const source = 'const local = 1\nfunction helper() {}\nexport class Real {}\n'
		expect(exportsFrom(source)).toEqual([{ name: 'Real', kind: 'class' }])
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
		const lines = readFixture('good/module/types.ts').split(/\r?\n/)
		const start = lines.findIndex((line) => line.startsWith('export interface WidgetInterface'))
		const head = joinHead(lines, start)
		expect(head?.text).toBe('export interface WidgetInterface<T = Record<string, unknown>> {')
	})

	it('returns undefined when no line opens a body', () => {
		const lines = ['export const X = 1', 'export const Y = 2']
		expect(joinHead(lines, 0)).toBeUndefined()
	})
})

describe('declarationBody', () => {
	it('extracts an interface body', () => {
		const source = 'export interface X {\n\twalk(): void\n}\n'
		expect(declarationBody(source, 'interface', 'X')).toEqual(['\twalk(): void'])
	})

	it('extracts a class body', () => {
		const source = 'export class X {\n\twalk(): void {}\n}\n'
		expect(declarationBody(source, 'class', 'X')).toEqual(['\twalk(): void {}'])
	})

	it('extracts a body from the fixture types.ts text', () => {
		const body = declarationBody(
			readFixture('good/module/types.ts'),
			'interface',
			'WidgetInterface',
		)
		expect(body).toEqual([
			'\treadonly count: number',
			'\tinspect(): string',
			'\trender(label: string, data?: T): string',
			'\treset(): void',
		])
	})

	it('returns an empty array when the named declaration is missing', () => {
		expect(declarationBody('export class X {\n}\n', 'interface', 'Y')).toEqual([])
	})
})

describe('memberMethods', () => {
	it('counts a plain method', () => {
		expect(memberMethods(['\tmap(): void'])).toEqual(['map'])
	})

	it('counts an async method', () => {
		expect(memberMethods(['\tasync load(): Promise<void>'])).toEqual(['load'])
	})

	it('counts a generator method', () => {
		expect(memberMethods(['\t*walk(): Generator<void>'])).toEqual(['walk'])
	})

	it('counts an optional method', () => {
		expect(memberMethods(['\trecords?(): void'])).toEqual(['records'])
	})

	it('excludes a getter', () => {
		expect(memberMethods(['\tget label(): string'])).toEqual([])
	})

	it('excludes a setter', () => {
		expect(memberMethods(['\tset label(value: string)'])).toEqual([])
	})

	it('excludes a static member', () => {
		expect(memberMethods(['\tstatic create(): X'])).toEqual([])
	})

	it('excludes a #-private member', () => {
		expect(memberMethods(['\t#describe(): string'])).toEqual([])
	})

	it('counts a constructor line as a member (Source excludes it downstream, not memberMethods)', () => {
		expect(memberMethods(['\tconstructor(label: string)'])).toEqual(['constructor'])
	})

	it('excludes a plain data member', () => {
		expect(memberMethods(['\treadonly count: number'])).toEqual([])
	})

	it('dedupes and sorts the results', () => {
		expect(memberMethods(['\tzeta(): void', '\talpha(): void', '\tzeta(): void'])).toEqual([
			'alpha',
			'zeta',
		])
	})

	it("reproduces the good fixture Widget class's exact three methods (excluding the trap members)", () => {
		const body = declarationBody(readFixture('good/module/Widget.ts'), 'class', 'Widget')
		expect(memberMethods(body).filter((method) => method !== 'constructor')).toEqual([
			'inspect',
			'render',
			'reset',
		])
	})
})
