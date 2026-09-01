import {
	Source,
	createGuide,
	findMissing,
	findMissingSymbols,
	parseManifest,
	computeSymbolKey,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { readInventory } from '@orkestrel/test/server'
import { requireText } from '../../../setupServer.js'

const FIXTURES = readInventory(new URL('../../../fixtures/', import.meta.url), ['.'])
const GOOD_FILES = readInventory(new URL('../../../fixtures/good/', import.meta.url), ['.'])

// The pure Source view over a consumer-supplied file inventory — exports(),
// surface(), methods(name), and exists(relative). Constructed from the good fixture
// (the bijection-perfect widget package) and the broken/class-extra-method
// fixture (the drop-in-catches-extras red path) (AGENTS §16).

describe('Source', () => {
	it('carries every successor lexical repair through direct and terminal reflection', () => {
		const programs = [
			'let count = 0\n++/[/*]/.lastIndex\nexport const visible = true',
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
				'async function run() {',
				'\tfor await (const value of /[/*]/ as unknown as readonly RegExp[]) value',
				'}',
				'export const visible = true',
			].join('\n'),
			'export default /[/*]/\nexport const visible = true',
			'class Derived extends /[/*]/.constructor {}\nexport const visible = true',
			"while (true) { break\n/[/*]/.test('') }\nexport const visible = true",
			"outer: for (;;) { continue outer\n/[/*]/.test('') }\nexport const visible = true",
			"debugger\n/[/*]/.test('')\nexport const visible = true",
		]
		const reflected = programs.map((program) => {
			const source = new Source({
				files: {
					'module/index.ts': "export * from './terminal.js'",
					'module/terminal.ts': program,
				},
				module: 'module',
			})
			return { direct: source.exports(), terminal: source.surface() }
		})
		expect(reflected).toEqual(
			programs.map(() => ({
				direct: [{ name: 'visible', kind: 'const' }],
				terminal: [{ name: 'visible', kind: 'const' }],
			})),
		)
	})

	it('carries literal Unicode identifier division through direct and terminal reflection', () => {
		const programs = [
			'const ratio = object.\u03c0 / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'class Counter {\n\t#\u03c0 = 1\n\tratio(): number { return this.#\u03c0 / 2 /* open\nexport const ghost = true\n*/ }\n}\nexport const visible = true',
			'const text = `${object.\u03c0 / 2 /* open\nexport const ghost = true\n*/}`\nexport const visible = true',
			'const \u{10400} = 1\nconst ratio = \u{10400} / 2 /* open\nexport const ghost = true\n*/\nexport const visible = true',
		]
		const reflected = programs.map((program) => {
			const source = new Source({
				files: {
					'module/index.ts': "export * from './terminal.js'",
					'module/terminal.ts': program,
				},
				module: 'module',
			})
			return { direct: source.exports(), terminal: source.surface() }
		})
		expect(reflected).toEqual(
			programs.map(() => ({
				direct: [{ name: 'visible', kind: 'const' }],
				terminal: [{ name: 'visible', kind: 'const' }],
			})),
		)
	})

	it('carries empty and elided for-of bindings through direct and terminal reflection', () => {
		const programs = [
			'for (const {} of /[/*]/ as unknown as readonly object[]) {}\nexport const visible = true',
			'for (const [] of /[/*]/ as unknown as readonly unknown[][]) {}\nexport const visible = true',
			'for (const [,,] of /[/*]/ as unknown as readonly unknown[][]) {}\nexport const visible = true',
			'for (const [{}, []] of /[/*]/ as unknown as readonly [object, unknown[]][]) {}\nexport const visible = true',
		]
		const reflected = programs.map((program) => {
			const source = new Source({
				files: {
					'module/index.ts': "export * from './terminal.js'",
					'module/terminal.ts': program,
				},
				module: 'module',
			})
			return { direct: source.exports(), terminal: source.surface() }
		})
		expect(reflected).toEqual(
			programs.map(() => ({
				direct: [{ name: 'visible', kind: 'const' }],
				terminal: [{ name: 'visible', kind: 'const' }],
			})),
		)
	})

	it('excludes faux JSDoc from both examples overloads while preserving genuine examples', () => {
		const source = new Source({
			files: {
				'module/examples.ts': [
					'export const text = `',
					'/** @example */',
					'export function templateGhost(): void {}',
					'`',
					'/*',
					'/** @example */',
					'export function outerVisible(): void {}',
					'/** @example */',
					'export function genuine(): void {}',
					'export interface Widget {',
					'\t/*',
					'\t/** @example */',
					'\touterVisible(): void',
					'\t/** @example */',
					'\tgenuine(): void',
					'}',
				].join('\n'),
			},
			module: 'module',
		})
		expect({ functions: source.examples(), members: source.examples('Widget') }).toEqual({
			functions: ['genuine'],
			members: ['genuine'],
		})
	})

	it('uses exact titled example tags and last-span replacement in both overloads', () => {
		const source = new Source({
			files: {
				'module/examples.ts': [
					'/** @example */',
					'export function exact(): void {}',
					'/** @example title */',
					'export function titled(): void {}',
					'/** @examples */',
					'export function plural(): void {}',
					'/** text @example prose */',
					'export function embedded(): void {}',
					'/** @example */ /** plain */',
					'export function replaced(): void {}',
					'/** plain */ /** @example title */',
					'export function authoritative(): void {}',
					'export interface Widget {',
					'\t/** @example */',
					'\texact(): void',
					'\t/** @example title */',
					'\ttitled(): void',
					'\t/** @exampled */',
					'\tsuffixed(): void',
					'\t/** text @example prose */',
					'\tembedded(): void',
					'\t/** @example */ /** plain */',
					'\treplaced(): void',
					'\t/** plain */ /** @example title */',
					'\tauthoritative(): void',
					'}',
				].join('\n'),
			},
			module: 'module',
		})
		expect(source.examples()).toEqual(['exact', 'titled', 'authoritative'])
		expect(source.examples('Widget')).toEqual(['authoritative', 'exact', 'titled'])
	})

	it('carries minimal JSDoc span precedence through both examples overloads', () => {
		const source = new Source({
			files: {
				'module/examples.ts': [
					'/**/ /** @example title */',
					'export function positive(): void {}',
					'/** @example */ /**/',
					'export function inverse(): void {}',
					'export interface Widget {',
					'\t/**/',
					'\t/** @example title */',
					'\tpositive(): void',
					'\t/** @example */ /**/',
					'\tinverse(): void',
					'}',
				].join('\n'),
			},
			module: 'module',
		})
		expect({ functions: source.examples(), members: source.examples('Widget') }).toEqual({
			functions: ['positive'],
			members: ['positive'],
		})
	})

	it('excludes internal alias segments from every module-key population and retains dotfiles', () => {
		const files = {
			'src/../outside.ts': [
				'export const escaped = true',
				'const hiddenAlias = true',
				'/** @example */',
				'export function escapedExample(): void {}',
				'export interface Alias {',
				'\t/** @example */',
				'\trun(): void',
				'}',
			].join('\n'),
			'src/./alias.ts': 'export const dotAlias = true\n',
			'src//double.ts': 'export const doubleAlias = true\n',
			'src/.hidden.ts': 'export const dotfile = true\n',
			'src/visible.ts': 'export const visible = true\n',
		}
		const source = new Source({ files, module: 'src' })
		expect({
			exports: source.exports(),
			hidden: source.hidden(),
			methods: source.methods('Alias'),
			examples: source.examples(),
			members: source.examples('Alias'),
		}).toEqual({
			exports: [
				{ name: 'dotfile', kind: 'const' },
				{ name: 'visible', kind: 'const' },
			],
			hidden: [],
			methods: [],
			examples: [],
			members: [],
		})
	})

	it('carries hostile lexical transitions through direct and barrel-terminal reflection', () => {
		for (const terminal of [
			'const ratio = count++ / total /* open\nexport const ghost = true\n*/\nexport const visible = true',
			'const ratio = count! / total /* open\nexport const ghost = true\n*/\nexport const visible = true',
			"if (true) /[/*]/.test('*')\nexport const visible = true",
			'const values = [... /[/*]/]\nexport const visible = true',
			'for (const value of /[/*]/) value\nexport const visible = true',
		]) {
			const source = new Source({
				files: {
					'module/index.ts': "export * from './terminal.js'",
					'module/terminal.ts': terminal,
				},
				module: 'module',
			})
			expect(source.exports()).toEqual([{ name: 'visible', kind: 'const' }])
			expect(source.surface()).toEqual([{ name: 'visible', kind: 'const' }])
		}
	})

	it('reaches workspace-root barrels and terminals from canonical-equivalent module inputs', () => {
		for (const module of ['.', '', './', 'nested/..']) {
			const source = new Source({
				files: {
					'index.ts': "export * from './terminal.js'",
					'terminal.ts': 'export const visible = true',
				},
				module,
			})
			expect(source.exports()).toEqual([{ name: 'visible', kind: 'const' }])
			expect(source.surface()).toEqual([{ name: 'visible', kind: 'const' }])
		}
	})

	it('carries a canonical workspace-root manifest source into Source', () => {
		const markdown = [
			'## By concept',
			'',
			'| Concept | Spec | Source | Tests |',
			'| --- | --- | --- | --- |',
			'| Root | [guide](./guide.md) | [root](..) | [tests](../tests) |',
		].join('\n')
		const entry = parseManifest(markdown, 'guides')[0]
		expect(entry?.source).toBe('.')
		if (entry === undefined) throw new Error('Expected manifest entry')
		const source = new Source({
			files: {
				'index.ts': "export * from './terminal.js'",
				'terminal.ts': 'export const visible = true',
			},
			module: entry.source,
		})
		expect(source.surface()).toEqual([{ name: 'visible', kind: 'const' }])
	})

	it('correlates postfix leakage in the correct Guide-to-Source direction', () => {
		const source = new Source({
			files: {
				'module/index.ts': "export * from './terminal.js'",
				'module/terminal.ts': [
					'const ratio = count++ / total /* open',
					'export const ghost = true',
					'*/',
					'export const visible = true',
				].join('\n'),
			},
			module: 'module',
		})
		const guide = createGuide(
			'## Surface\n\n| Name | Kind |\n| --- | --- |\n| `ghost` | const |\n| `visible` | const |',
		)
		expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
		expect(findMissingSymbols(guide.surface(), source.surface())).toEqual(['const ghost'])
	})

	it('correlates control-header regex omission in the Source-to-Guide direction', () => {
		const source = new Source({
			files: {
				'module/index.ts': "export * from './terminal.js'",
				'module/terminal.ts': [
					'export const kept = true',
					"if (true) /[/*]/.test('*')",
					'export const lost = true',
				].join('\n'),
			},
			module: 'module',
		})
		const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `kept` | const |')
		expect(findMissingSymbols(source.surface(), guide.surface())).toEqual(['const lost'])
		expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
	})

	it('excludes commented methods and reports a correlated Guide phantom', () => {
		const source = new Source({
			files: {
				'module/index.ts': "export * from './types.js'",
				'module/types.ts': [
					'export interface Widget {',
					'\t/*',
					'\tghost(): void',
					'\t*/',
					'\t/** @example */',
					'\tvisible(): void',
					'}',
				].join('\n'),
			},
			module: 'module',
		})
		const guide = createGuide(
			'## Surface\n\n| Name | Kind |\n| --- | --- |\n| `Widget` | interface |\n\n## Methods\n\n#### `Widget`\n\n| Method | Description |\n| --- | --- |\n| `ghost` | Phantom |\n| `visible` | Real |',
		)
		expect(source.methods('Widget')).toEqual(['visible'])
		expect(source.examples('Widget')).toEqual(['visible'])
		expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
		expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
		const documented = guide.methods()[0]?.methods ?? []
		expect(findMissing(source.methods('Widget'), documented)).toEqual([])
		expect(findMissing(documented, source.methods('Widget'))).toEqual(['ghost'])
	})

	it('stranded-export: surface() reveals a direct declaration omitted from the conventional barrel', () => {
		const source = new Source({
			files: readInventory(new URL('../../../fixtures/broken/stranded-export/', import.meta.url), [
				'.',
			]),
			module: 'module',
		})
		const guide = createGuide(requireText(FIXTURES, 'broken/stranded-export/guide.md'))
		const surface = source.surface()

		expect(surface).toEqual([{ name: 'publishedExport', kind: 'function' }])
		expect(findMissingSymbols(source.exports(), surface)).toEqual(['function strandedExport'])
		expect(findMissingSymbols(surface, source.exports())).toEqual([])
		expect(findMissingSymbols(surface, guide.surface())).toEqual([])
		expect(findMissingSymbols(guide.surface(), surface)).toEqual(['function strandedExport'])
	})

	it("exports() returns the good fixture's exact 6 symbols, sorted by name", () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.exports()).toEqual([
			{ name: 'DEFAULT_COUNT', kind: 'const' },
			{ name: 'Widget', kind: 'class' },
			{ name: 'WidgetInterface', kind: 'interface' },
			{ name: 'WidgetKind', kind: 'type' },
			{ name: 'createLabel', kind: 'function' },
			{ name: 'loadWidget', kind: 'function' },
		])
	})

	it('exports() caches the scan — repeated calls return the same array instance', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.exports()).toBe(source.exports())
	})

	it("surface() returns the good fixture barrel's exact 6 symbols, sorted by name", () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.surface()).toEqual([
			{ name: 'DEFAULT_COUNT', kind: 'const' },
			{ name: 'Widget', kind: 'class' },
			{ name: 'WidgetInterface', kind: 'interface' },
			{ name: 'WidgetKind', kind: 'type' },
			{ name: 'createLabel', kind: 'function' },
			{ name: 'loadWidget', kind: 'function' },
		])
	})

	it('surface() caches the scan — repeated calls return the same array instance', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.surface()).toBe(source.surface())
	})

	it('surface() treats missing roots and targets as empty while retaining a valid sibling', () => {
		const missingRoot = new Source({
			files: { 'module/visible.ts': 'export const visible = true\n' },
			module: 'module',
		})
		expect(missingRoot.surface()).toEqual([])

		const missingTarget = new Source({
			files: {
				'module/index.ts': ["export * from './missing.js'", "export * from './visible.js'"].join(
					'\n',
				),
				'module/visible.ts': 'export const visible = true\n',
			},
			module: 'module',
		})
		expect(missingTarget.surface()).toEqual([{ name: 'visible', kind: 'const' }])
	})

	it('surface() accepts whitespace, either quote, optional semicolons, and trailing comments', () => {
		const source = new Source({
			files: {
				'module/index.ts': [
					'',
					'// comment-only row',
					'  export  *  from  "./visible.js" ; // trailing comment',
					"export * from './visible.js'",
				].join('\n'),
				'module/visible.ts': 'export function visible(): void {}\n',
			},
			module: 'module',
		})
		expect(source.surface()).toEqual([{ name: 'visible', kind: 'function' }])
	})

	it('surface() preserves inactive quotes and comment markers inside quoted targets', () => {
		const source = new Source({
			files: {
				'module/index.ts': [
					`export * from "./dou'ble.js"`,
					`export * from './sin"gle.js'`,
					'export * from "./line//comment.js"',
					"export * from './block/*comment.js'",
				].join('\n'),
				"module/dou'ble.ts": 'export const apostrophe = true\n',
				'module/sin"gle.ts': 'export const quotation = true\n',
				'module/line/comment.ts': 'export const slash = true\n',
				'module/block/*comment.ts': 'export const block = true\n',
			},
			module: 'module',
		})
		expect(source.surface()).toEqual([
			{ name: 'apostrophe', kind: 'const' },
			{ name: 'block', kind: 'const' },
			{ name: 'quotation', kind: 'const' },
			{ name: 'slash', kind: 'const' },
		])
	})

	it('surface() preserves a canonical row before a block comment and excludes comment payload', () => {
		const source = new Source({
			files: {
				'module/index.ts': [
					'/*',
					"export * from './commented.js'",
					'*/',
					"export * from './prefixed.js' /*",
					"export * from './leaked.js'",
					'*/',
					"export * from './visible.js'",
				].join('\n'),
				'module/commented.ts': 'export const commented = true\n',
				'module/prefixed.ts': 'export const prefixed = true\n',
				'module/leaked.ts': 'export const leaked = true\n',
				'module/visible.ts': 'export const visible = true\n',
			},
			module: 'module',
		})
		expect(source.surface()).toEqual([
			{ name: 'prefixed', kind: 'const' },
			{ name: 'visible', kind: 'const' },
		])
	})

	it('surface() reaches a workspace-root index target', () => {
		const source = new Source({
			files: {
				'module/index.ts': "export * from '../index.js'\n",
				'index.ts': "export * from './root.js'\n",
				'root.ts': 'export const root = true\n',
			},
			module: 'module',
		})
		expect(source.surface().map(computeSymbolKey)).toEqual(['const root'])
	})

	it('terminal reflection excludes commented declarations and retains real declarations', () => {
		const source = new Source({
			files: {
				'module/index.ts': "export * from './terminal.js'\n",
				'module/terminal.ts': [
					'/*',
					'export const ghost = true',
					'*/',
					'export const visible = true',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect(source.exports().map(computeSymbolKey)).toEqual(['const visible'])
		expect(source.surface().map(computeSymbolKey)).toEqual(['const visible'])
	})

	it('correlated commented declarations cannot satisfy four-way parity', () => {
		const source = new Source({
			files: {
				'module/index.ts': "export * from './terminal.js'\n",
				'module/terminal.ts': ['/*', 'export const ghost = true', '*/', ''].join('\n'),
			},
			module: 'module',
		})
		const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `ghost` | const |\n')
		const direct = source.exports()
		const barrel = source.surface()
		const documented = guide.surface()

		expect(findMissingSymbols(direct, barrel)).toEqual([])
		expect(findMissingSymbols(barrel, direct)).toEqual([])
		expect(findMissingSymbols(barrel, documented)).toEqual([])
		expect(findMissingSymbols(documented, barrel)).toEqual(['const ghost'])
	})

	it('barrel-only declarations are visible outside the direct module-key population', () => {
		const source = new Source({
			files: {
				'module/index.ts': "export * from '../external.js'\n",
				'external.ts': 'export const external = true\n',
			},
			module: 'module',
		})
		const guide = createGuide(
			'## Surface\n\n| Name | Kind |\n| --- | --- |\n| `external` | const |\n',
		)
		const direct = source.exports()
		const barrel = source.surface()
		const documented = guide.surface()

		expect(findMissingSymbols(direct, barrel)).toEqual([])
		expect(findMissingSymbols(barrel, direct)).toEqual(['const external'])
		expect(findMissingSymbols(barrel, documented)).toEqual([])
		expect(findMissingSymbols(documented, barrel)).toEqual([])
	})

	it('surface() does not alias excess ancestors to an unrelated root inventory key', () => {
		const source = new Source({
			files: {
				'module/index.ts': "export * from '../../../outside.js'",
				'outside.ts': 'export const escaped = true\n',
			},
			module: 'module',
		})
		expect(source.surface()).toEqual([])
	})

	it('surface() rejects noncanonical initial and resolved inventory entrances', () => {
		const invalidInitial = new Source({
			files: {
				'../src/index.ts': "export * from './visible.js'",
				'../src/visible.ts': 'export const visible = true',
			},
			module: '../src',
		})
		expect(invalidInitial.surface()).toEqual([])

		const invalidTarget = new Source({
			files: {
				'module/index.ts': [
					"export * from '../../outside.js'",
					"export * from './visible.js'",
					"export * from '../shared.js'",
				].join('\n'),
				'../outside.ts': 'export const escaped = true',
				'module/visible.ts': 'export const visible = true',
				'shared.ts': 'export const shared = true',
			},
			module: 'module',
		})
		expect(invalidTarget.surface()).toEqual([
			{ name: 'shared', kind: 'const' },
			{ name: 'visible', kind: 'const' },
		])
	})

	it('surface() unions multiple module-directory roots', () => {
		const source = new Source({
			files: {
				'one/index.ts': "export * from './first.js'\n",
				'one/first.ts': 'export const first = 1\n',
				'two/index.ts': "export * from './second.js'\n",
				'two/second.ts': 'export class Second {}\n',
			},
			module: ['one', 'two'],
		})
		expect(source.surface()).toEqual([
			{ name: 'Second', kind: 'class' },
			{ name: 'first', kind: 'const' },
		])
	})

	it('surface() reaches nested regular targets and recursively traverses nested indexes', () => {
		const source = new Source({
			files: {
				'module/index.ts': [
					"export * from './nested/helpers.js'",
					"export * from './nested/index.js'",
				].join('\n'),
				'module/nested/helpers.ts': 'export function nestedHelper(): void {}\n',
				'module/nested/index.ts': "export * from './detail.js'\n",
				'module/nested/detail.ts': 'export interface NestedDetail {}\n',
			},
			module: 'module',
		})
		expect(source.surface()).toEqual([
			{ name: 'NestedDetail', kind: 'interface' },
			{ name: 'nestedHelper', kind: 'function' },
		])
	})

	it('surface() terminates self and multi-index cycles while retaining reachable leaves', () => {
		const source = new Source({
			files: {
				'module/index.ts': ["export * from './index.js'", "export * from './nested/index.js'"].join(
					'\n',
				),
				'module/nested/index.ts': [
					"export * from '../index.js'",
					"export * from './value.js'",
				].join('\n'),
				'module/nested/value.ts': 'export type CyclicValue = string\n',
			},
			module: 'module',
		})
		expect(source.surface()).toEqual([{ name: 'CyclicValue', kind: 'type' }])
	})

	it('surface() dedupes identical symbols and retains same-name different-kind symbols', () => {
		const source = new Source({
			files: {
				'module/index.ts': [
					"export * from './first.js'",
					"export * from './second.js'",
					"export * from './third.js'",
				].join('\n'),
				'module/first.ts': 'export function Shared(): void {}\n',
				'module/second.ts': 'export function Shared(): void {}\n',
				'module/third.ts': 'export type Shared = string\n',
			},
			module: 'module',
		})
		expect(source.surface()).toEqual([
			{ name: 'Shared', kind: 'function' },
			{ name: 'Shared', kind: 'type' },
		])
	})

	it('surface() returns empty for empty inputs and does not mutate the supplied inventory', () => {
		expect(new Source({ files: {}, module: 'module' }).surface()).toEqual([])
		expect(
			new Source({
				files: { 'module/index.ts': "export * from './visible.js'" },
				module: [],
			}).surface(),
		).toEqual([])

		const files = {
			'module/index.ts': "export * from './visible.js'\n",
			'module/visible.ts': 'export const visible = true\n',
		}
		const before = JSON.stringify(files)
		new Source({ files, module: 'module' }).surface()
		expect(JSON.stringify(files)).toBe(before)
	})

	// This proves only that unsupported forms remain outside surface()'s
	// membership population; it does not establish general TypeScript or barrel validity.
	it('surface() ignores every unsupported export form while retaining a canonical sibling', () => {
		const source = new Source({
			files: {
				'module/index.ts': [
					"export { named } from './unsupported.js'",
					"export { value as default } from './unsupported.js'",
					"export * as namespace from './unsupported.js'",
					"export type * from './unsupported.js'",
					"export * from '@scope/package'",
					"export * from './extensionless'",
					'export const local = true',
					"export * from './trailing.js'; const arbitrary = true",
					"export * from './terminal.js'",
					"export * from './visible.js'",
				].join('\n'),
				'module/unsupported.ts': 'export const unsupported = true\n',
				'module/trailing.ts': 'export const trailing = true\n',
				'module/terminal.ts': "export * from './hidden.js'\n",
				'module/hidden.ts': 'export const hidden = true\n',
				'module/visible.ts': 'export const visible = true\n',
			},
			module: 'module',
		})
		expect(source.surface()).toEqual([{ name: 'visible', kind: 'const' }])
	})

	it('methods(WidgetInterface) and methods(Widget) agree on the same three methods', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.methods('WidgetInterface')).toEqual(['inspect', 'render', 'reset'])
		expect(source.methods('Widget')).toEqual(['inspect', 'render', 'reset'])
	})

	it('methods(Widget) excludes the constructor, getter, static, and #private traps', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		const methods = source.methods('Widget')
		expect(methods).not.toContain('constructor')
		expect(methods).not.toContain('label')
		expect(methods).not.toContain('create')
		expect(methods).not.toContain('describe')
	})

	it('methods() returns an empty array for a name with no declaration in scope', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.methods('Nonexistent')).toEqual([])
	})

	it('methods() unions an interface pair through its extends clause', () => {
		const source = new Source({
			files: {
				'module/types.ts': [
					'export interface StoreInterface {',
					'\tread(key: string): string | undefined',
					'\twrite(key: string, value: string): void',
					'}',
					'',
					'export interface CursorStoreInterface extends StoreInterface {',
					'\tcursor(): AsyncIterable<string>',
					'}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect({
			base: source.methods('StoreInterface'),
			extending: source.methods('CursorStoreInterface'),
		}).toEqual({ base: ['read', 'write'], extending: ['cursor', 'read', 'write'] })
	})

	it('methods() reports the inherited members of a declaration that adds none', () => {
		const source = new Source({
			files: {
				'module/types.ts': [
					'export interface ReadInterface {',
					'\tread(): string',
					'}',
					'export interface StoreInterface extends ReadInterface {',
					'}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect(source.methods('StoreInterface')).toEqual(['read'])
	})

	it('methods() walks a transitive chain and visits a diamond base once', () => {
		const source = new Source({
			files: {
				'module/types.ts': [
					'export interface ReadInterface {',
					'\tread(): string',
					'}',
					'export interface WriteInterface extends ReadInterface {',
					'\twrite(value: string): void',
					'}',
					'export interface AppendInterface extends ReadInterface {',
					'\tappend(value: string): void',
					'}',
					'export interface StoreInterface extends WriteInterface, AppendInterface {',
					'\tclose(): void',
					'}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect(source.methods('StoreInterface')).toEqual(['append', 'close', 'read', 'write'])
	})

	it('methods() terminates an extends cycle', () => {
		const source = new Source({
			files: {
				'module/types.ts': [
					'export interface FirstInterface extends SecondInterface {',
					'\tfirst(): void',
					'}',
					'export interface SecondInterface extends FirstInterface {',
					'\tsecond(): void',
					'}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect(source.methods('FirstInterface')).toEqual(['first', 'second'])
	})

	it('methods() ignores a base the module scope does not declare', () => {
		const source = new Source({
			files: {
				'module/types.ts': [
					"import type { StoreInterface } from '@orkestrel/store'",
					'export interface CursorStoreInterface extends StoreInterface {',
					'\tcursor(): void',
					'}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect(source.methods('CursorStoreInterface')).toEqual(['cursor'])
	})

	it('methods() reads the first declaring file and ignores a later file declaring the same name', () => {
		const source = new Source({
			files: {
				'module/first.ts': [
					'export interface ReadInterface {',
					'\tread(): string',
					'}',
					'export interface StoreInterface extends ReadInterface {',
					'\topen(): void',
					'}',
					'',
				].join('\n'),
				'module/second.ts': [
					'export interface StoreInterface {',
					'\twrite(value: string): void',
					'}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect(source.methods('StoreInterface')).toEqual(['open', 'read'])
	})

	it('methods() keeps its keyword and reads no member from a same-named class base', () => {
		const source = new Source({
			files: {
				'module/types.ts': [
					'export interface StoreInterface extends Store {',
					'\topen(): void',
					'}',
					'',
				].join('\n'),
				'module/Store.ts': [
					'export class Store {',
					'\tread(): string {',
					"\t\treturn ''",
					'\t}',
					'}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect(source.methods('StoreInterface')).toEqual(['open'])
	})

	it('methods() reads no member from a qualified base', () => {
		const source = new Source({
			files: {
				'module/types.ts': [
					'export interface StoreInterface extends external.Store {',
					'\topen(): void',
					'}',
					'export interface Store {',
					'\tread(): string',
					'}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect(source.methods('StoreInterface')).toEqual(['open'])
	})

	it('methods() walks a class chain and still excludes the constructor', () => {
		const source = new Source({
			files: {
				'module/Store.ts': [
					'export class Store {',
					'\tconstructor(label: string) {}',
					'\tread(): string {',
					"\t\treturn ''",
					'\t}',
					'}',
					'export class CursorStore extends Store {',
					'\tcursor(): void {}',
					'}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect(source.methods('CursorStore')).toEqual(['cursor', 'read'])
	})

	it('exists() is true for an exact key', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.exists('module/Widget.ts')).toBe(true)
	})

	it('exists() is true for a directory prefix', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.exists('module')).toBe(true)
	})

	it('exists() is false for a path not in the inventory', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.exists('module/gone.ts')).toBe(false)
	})

	it('exists() excludes index.ts and .test.ts files from exports() but not from exists()', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.exists('module/index.ts')).toBe(true)
		expect(source.exists('module/sample.test.ts')).toBe(true)
	})

	it('class-extra-method: methods(Widget) includes the extra method the interface does not document', () => {
		const source = new Source({
			files: readInventory(
				new URL('../../../fixtures/broken/class-extra-method/', import.meta.url),
				['.'],
			),
			module: 'module',
		})
		expect(source.methods('Widget')).toContain('extra')
		expect(source.methods('WidgetInterface')).not.toContain('extra')
	})

	it('unions exports() across a multi-dir GuideModule', () => {
		const files = {
			...GOOD_FILES,
			...Object.fromEntries(
				Object.entries(
					readInventory(new URL('../../../fixtures/broken/class-extra-method/', import.meta.url), [
						'.',
					]),
				).map(([key, value]) => [`extra/${key}`, value]),
			),
		}
		const source = new Source({ files, module: ['module', 'extra/module'] })
		const names = source.exports().map((symbol) => symbol.name)
		expect(new Set(names).size).toBe(source.exports().length)
		expect(names).toContain('Widget')
	})

	it('returns empty exports() and false exists() for an empty file inventory', () => {
		const source = new Source({ files: {}, module: 'module' })
		expect(source.exports()).toEqual([])
		expect(source.exists('module/Widget.ts')).toBe(false)
	})

	it('hidden() is empty over the good fixture (§5-conformant, nothing hidden)', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.hidden()).toEqual([])
	})

	it('hidden() caches the scan — repeated calls return the same array instance', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.hidden()).toBe(source.hidden())
	})

	// hidden-declaration: the red path a surface bijection alone cannot see —
	// secretHelper never appears as an export, so it never shows as a missing
	// Surface row; hidden() is the only reflection that catches it.
	it('hidden-declaration: hidden() reports the one non-exported function', () => {
		const source = new Source({
			files: readInventory(
				new URL('../../../fixtures/broken/hidden-declaration/', import.meta.url),
				['.'],
			),
			module: 'module',
		})
		expect(source.hidden()).toEqual([{ name: 'secretHelper', kind: 'function' }])
	})

	it('examples() returns an empty array over the good fixture (no @example JSDoc)', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.examples()).toEqual([])
	})

	it('examples() caches the scan — repeated calls return the same array instance', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.examples()).toBe(source.examples())
	})

	it('examples(name) returns an empty array for the good fixture WidgetInterface (no @example JSDoc)', () => {
		const source = new Source({ files: GOOD_FILES, module: 'module' })
		expect(source.examples('WidgetInterface')).toEqual([])
	})

	it('missing-example: examples() reports only greet (the @example-carrying function)', () => {
		const source = new Source({
			files: readInventory(new URL('../../../fixtures/broken/missing-example/', import.meta.url), [
				'.',
			]),
			module: 'module',
		})
		expect(source.examples()).toEqual(['greet'])
	})

	it("examples(name) reads only the interface body's @example members when no same-named class exists", () => {
		const files = {
			'src/core/types.ts': [
				'export interface WidgetInterface {',
				'\t/**',
				'\t * @example',
				'\t */',
				'\twalk(): void',
				'\tfold(): void',
				'}',
				'',
			].join('\n'),
		}
		const source = new Source({ files, module: 'src/core' })
		expect(source.examples('WidgetInterface')).toEqual(['walk'])
	})

	it('examples(name) reads only the named body and follows no extends clause', () => {
		const source = new Source({
			files: {
				'module/types.ts': [
					'export interface ReadInterface {',
					'\t/** @example */',
					'\tread(): string',
					'}',
					'export interface StoreInterface extends ReadInterface {',
					'\t/** @example */',
					'\topen(): void',
					'}',
					'',
				].join('\n'),
			},
			module: 'module',
		})
		expect({
			own: source.examples('StoreInterface'),
			inherited: source.methods('StoreInterface'),
		}).toEqual({ own: ['open'], inherited: ['open', 'read'] })
	})

	it("examples(name) reads the class body's @example members under the implementer's own name", () => {
		const files = {
			'src/core/types.ts': [
				'export interface WidgetInterface {',
				'\twalk(): void',
				'\tfold(): void',
				'}',
				'',
			].join('\n'),
			'src/core/Widget.ts': [
				"import type { WidgetInterface } from './types.js'",
				'export class Widget implements WidgetInterface {',
				'\twalk(): void {}',
				'\t/**',
				'\t * @example',
				'\t */',
				'\tfold(): void {}',
				'}',
				'',
			].join('\n'),
		}
		const source = new Source({ files, module: 'src/core' })
		expect(source.examples('Widget')).toEqual(['fold'])
	})
})
