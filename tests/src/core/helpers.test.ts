import type { SurfaceSymbol } from '@src/core'
import {
	cellLinks,
	fenceImports,
	findMissing,
	findUnexampled,
	firstCode,
	identifierOf,
	isExternalLink,
	kindIndex,
	missingSymbols,
	moduleDirs,
	moduleKeys,
	resolveLink,
	symbolKey,
} from '@src/core'
import { parseDocument } from '@orkestrel/markdown'
import type { TableNode } from '@orkestrel/markdown'
import { describe, expect, it } from 'vitest'

// The bijection helpers behind the guides-parity scanners — symbol keying,
// set-difference, link classification/resolution, generic-name normalization,
// and table-column/inline lookups. Pure and total; each mirrors one exported
// helpers.ts symbol (AGENTS §16).

describe('symbolKey', () => {
	it('joins kind and name with a space', () => {
		expect(symbolKey({ name: 'Markdown', kind: 'class' })).toBe('class Markdown')
	})

	it('differs when kind differs', () => {
		expect(symbolKey({ name: 'X', kind: 'type' })).not.toBe(symbolKey({ name: 'X', kind: 'class' }))
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

describe('resolveLink', () => {
	it('resolves against the directory of a same-dir file', () => {
		expect(resolveLink('guides/src/widget.md', 'helpers.ts')).toBe('guides/src/helpers.ts')
	})

	it('resolves a ../ chain up through multiple directories', () => {
		expect(resolveLink('guides/src/widget.md', '../../src/core/helpers.ts')).toBe(
			'src/core/helpers.ts',
		)
	})

	it('treats a from-path with no slash as a bare directory', () => {
		expect(resolveLink('guides', '../src/core')).toBe('src/core')
	})

	it('drops ./ segments', () => {
		expect(resolveLink('guides/src/widget.md', './helpers.ts')).toBe('guides/src/helpers.ts')
	})

	it('keeps a leading .. when it has nothing to pop', () => {
		expect(resolveLink('widget.md', '../../gone.ts')).toBe('../gone.ts')
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
	function tableFrom(markdown: string): TableNode {
		const [table] = parseDocument(markdown).children
		if (table?.element !== 'table') throw new Error('expected a table block')
		return table
	}

	it('finds the Kind column when present', () => {
		const table = tableFrom('| Name | Kind |\n| --- | --- |\n| `X` | class |\n')
		expect(kindIndex(table)).toBe(1)
	})

	it('returns undefined when no Kind header exists', () => {
		const table = tableFrom('| Name | Description |\n| --- | --- |\n| `X` | none |\n')
		expect(kindIndex(table)).toBeUndefined()
	})

	it('finds the Kind column when the header is reordered', () => {
		const table = tableFrom('| Kind | Name |\n| --- | --- |\n| class | `X` |\n')
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

describe('moduleDirs', () => {
	it('wraps a single string module into a one-element list', () => {
		expect(moduleDirs('src/core')).toEqual(['src/core'])
	})

	it('returns a multi-directory module unchanged', () => {
		expect(moduleDirs(['src/core', 'src/browser'])).toEqual(['src/core', 'src/browser'])
	})
})

describe('moduleKeys', () => {
	it('filters to files under the scope directory ending in .ts', () => {
		const files = { 'src/core/Guide.ts': '', 'src/other/X.ts': '' }
		expect(moduleKeys(files, 'src/core')).toEqual(['src/core/Guide.ts'])
	})

	it("excludes the scope directory's index.ts", () => {
		const files = { 'src/core/Guide.ts': '', 'src/core/index.ts': '' }
		expect(moduleKeys(files, 'src/core')).toEqual(['src/core/Guide.ts'])
	})

	it('excludes .test.ts files', () => {
		const files = { 'src/core/Guide.ts': '', 'src/core/Guide.test.ts': '' }
		expect(moduleKeys(files, 'src/core')).toEqual(['src/core/Guide.ts'])
	})

	it('unions keys across multiple scope directories', () => {
		const files = { 'src/core/Guide.ts': '', 'src/browser/Widget.ts': '', 'src/other/X.ts': '' }
		expect(moduleKeys(files, ['src/core', 'src/browser'])).toEqual([
			'src/browser/Widget.ts',
			'src/core/Guide.ts',
		])
	})

	it('returns keys sorted', () => {
		const files = { 'src/core/b.ts': '', 'src/core/a.ts': '' }
		expect(moduleKeys(files, 'src/core')).toEqual(['src/core/a.ts', 'src/core/b.ts'])
	})

	it('ignores non-.ts files and non-matching directories', () => {
		const files = { 'src/core/Guide.ts': '', 'src/core/README.md': '', 'other/X.ts': '' }
		expect(moduleKeys(files, 'src/core')).toEqual(['src/core/Guide.ts'])
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
