import {
	Guide,
	createGuide,
	createSource,
	isExternalLink,
	findMissingSymbols,
	resolveLink,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { readInventory } from '@orkestrel/test/server'
import { DEMONSTRATION_HEADING_GUIDE, requireText } from '../../setup.js'

const FIXTURES = readInventory(new URL('../../fixtures/', import.meta.url), ['.'])

// The pure Guide view over one parsed guide's markdown — the cached
// projections. Constructed from the good/broken fixture guides that exercise
// each projection's green and red paths (.claude/rules/tests.md § Test contract).

describe('Guide', () => {
	it('refuses a whitespace-only signature code span', () => {
		expect(() =>
			createGuide(
				'## Surface\n\n| Name | Kind | Signature | Summary |\n| --- | --- | --- | --- |\n| `Widget` | class | ` ` | |',
			),
		).toThrow(
			expect.objectContaining({
				code: 'signature',
				message:
					'## Surface table 1 row 1 ("class Widget") has an empty Signature cell; expected a non-empty TypeScript signature code span under "Name | Kind | Signature | Summary".',
			}),
		)
	})

	it('checks a later Surface section and leaves other sections outside the refusal', () => {
		const other = '## Methods\n\n| Name | Summary |\n| --- | --- |\n| `render` | Renders. |'
		expect(() => createGuide(other)).not.toThrow()
		expect(() =>
			createGuide(
				`## Surface\n\n| Name | Kind | Signature | Summary |\n| --- | --- | --- | --- |\n\n${other}\n\n## Surface\n\n| Export | Kind |\n| --- | --- |\n| \`Widget\` | class |`,
			),
		).toThrow(
			expect.objectContaining({
				code: 'header',
				message:
					'## Surface table 2 has header "Export | Kind"; expected "Name | Kind | Signature | Summary".',
			}),
		)
	})

	it('refuses reordered headers even though the low-level row reader locates named columns', () => {
		expect(() =>
			createGuide(
				'## Surface\n\n| Name | Signature | Kind | Summary |\n| --- | --- | --- | --- |\n| `Widget` | `new () => Widget` | class | |',
			),
		).toThrow(
			expect.objectContaining({
				code: 'header',
				message:
					'## Surface table 1 has header "Name | Signature | Kind | Summary"; expected "Name | Kind | Signature | Summary".',
			}),
		)
	})

	it('JSON-encodes and caps untrusted header and row text in refusals', () => {
		const header = `Bad "${'x'.repeat(250)}`
		expect(() => createGuide(`## Surface\n\n| ${header} | Kind |\n| --- | --- |\n`)).toThrow(
			expect.objectContaining({
				code: 'header',
				message: `## Surface table 1 has header ${JSON.stringify(`${header} | Kind`.slice(0, 200))}; expected "Name | Kind | Signature | Summary".`,
			}),
		)
		const name = `Widget"${'x'.repeat(250)}`
		expect(() =>
			createGuide(
				`## Surface\n\n| Name | Kind | Signature | Summary |\n| --- | --- | --- | --- |\n| \`${name}\` | class | | |`,
			),
		).toThrow(
			expect.objectContaining({
				code: 'signature',
				message: `## Surface table 1 row 1 (${JSON.stringify(`class ${name}`.slice(0, 200))}) has an empty Signature cell; expected a non-empty TypeScript signature code span under "Name | Kind | Signature | Summary".`,
			}),
		)
	})

	it.each(['Shape', 'Export', 'Symbol', 'Value', 'Returns', 'signature'])(
		'refuses the %s Surface header with a coded correction',
		(header) => {
			expect(() =>
				createGuide(
					`## Surface\n\n| Name | Kind | ${header} | Summary |\n| --- | --- | --- | --- |\n| \`Widget\` | class | \`new () => Widget\` | |`,
				),
			).toThrow(
				expect.objectContaining({
					code: 'header',
					message: `## Surface table 1 has header ${JSON.stringify(`Name | Kind | ${header} | Summary`)}; expected "Name | Kind | Signature | Summary".`,
				}),
			)
		},
	)

	it('refuses a Surface header with no typed column', () => {
		expect(() =>
			createGuide(
				'## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `Widget` | class | |',
			),
		).toThrow(
			expect.objectContaining({
				code: 'header',
				message:
					'## Surface table 1 has header "Name | Kind | Summary"; expected "Name | Kind | Signature | Summary".',
			}),
		)
	})

	it('refuses the first keyed empty Signature before later offending tables', () => {
		expect(() =>
			createGuide(
				'## Surface\n\n### `Widget`\n\n| Name | Kind | Signature | Summary |\n| --- | --- | --- | --- |\n| `Widget` | class | `new () => Widget` | |\n| `Widget` | class | | |\n\n| Export | Kind |\n| --- | --- |\n| `Later` | class |',
			),
		).toThrow(
			expect.objectContaining({
				code: 'signature',
				message:
					'## Surface table 1 row 2 ("class Widget") has an empty Signature cell; expected a non-empty TypeScript signature code span under "Name | Kind | Signature | Summary".',
			}),
		)
	})

	it('parses the uniform Surface table and preserves its signature', () => {
		expect(
			createGuide(
				'## Surface\n\n| Name | Kind | Signature | Summary |\n| --- | --- | --- | --- |\n| `Widget` | class | `new () => Widget` | |',
			).surface(),
		).toEqual([{ name: 'Widget', keyword: 'class', signature: '`new () => Widget`' }])
	})

	it('extracts sections in document order from the good fixture guide', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.sections()).toEqual(['Surface', 'Methods', 'Tests'])
	})

	it('extracts the exact documented surface from the good fixture guide', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.surface()).toEqual([
			{
				name: 'WidgetInterface',
				keyword: 'interface',
				signature: '`{ count, inspect(), render(), reset() }`',
			},
			{ name: 'WidgetKind', keyword: 'type', signature: "`'basic' | 'advanced'`" },
			{ name: 'createLabel', keyword: 'function', signature: '`(prefix: string) => string`' },
			{ name: 'loadWidget', keyword: 'function', signature: '`(id: string) => Promise<string>`' },
			{ name: 'DEFAULT_COUNT', keyword: 'const', signature: '`number`' },
			{ name: 'Widget', keyword: 'class' },
		])
	})

	it('caches a surface that refuses an embedded demonstration heading', () => {
		const guide = new Guide(DEMONSTRATION_HEADING_GUIDE)
		expect(guide.surface()).toEqual([
			{
				name: 'Widget',
				keyword: 'class',
				signature: '`new () => Widget`',
				summary: 'Represents a widget.',
			},
		])
		expect(guide.surface()).toBe(guide.surface())
	})

	it('extracts the WidgetInterface method group from the good fixture guide', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.methods()).toEqual([
			{
				interface: 'WidgetInterface',
				methods: [{ name: 'inspect' }, { name: 'render' }, { name: 'reset' }],
			},
		])
	})

	it('extracts links from the good fixture guide', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.links()).toEqual(['../../tests/widget.test.ts'])
	})

	it("extracts the Tests section's links from the good fixture guide", () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.tests()).toEqual(['../../tests/widget.test.ts'])
	})

	it('caches its projections — repeated calls return the same array instance', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.tagline()).toBe(guide.tagline())
		expect(guide.surface()).toBe(guide.surface())
		expect(guide.methods()).toBe(guide.methods())
		expect(guide.unnamed()).toBe(guide.unnamed())
		expect(guide.sections()).toBe(guide.sections())
		expect(guide.links()).toBe(guide.links())
		expect(guide.tests()).toBe(guide.tests())
		expect(guide.fences()).toBe(guide.fences())
	})

	it('extracts an empty unnamed() array from the good fixture guide', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.unnamed()).toEqual([])
	})

	// A row with no code-span name reaches neither surface() nor a MethodGroup, so
	// unnamed() is the only projection that can report it.
	it('projects a nameless row that reaches neither surface() nor a method group', () => {
		const guide = new Guide(
			[
				'## Surface',
				'',
				'| Name | Kind | Signature | Summary |',
				'| --- | --- | --- | --- |',
				'| `Widget` | class | `new () => Widget` | |',
				'| Widget | class | | |',
				'',
			].join('\n'),
		)
		expect(guide.unnamed()).toEqual(['Widget | class |  | '])
		expect(guide.surface()).toEqual([
			{ name: 'Widget', keyword: 'class', signature: '`new () => Widget`' },
		])
	})

	it('extracts an empty fences() array from the good fixture guide', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.fences()).toEqual([])
	})

	it("extracts the missing-example fixture guide's one Patterns fence with its heading title", () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/missing-example/guides/src/widget.md'))
		expect(guide.fences()).toEqual([
			{
				language: 'ts',
				code: "import { greet } from '../module/helpers.js'\n\ngreet('world')",
				title: 'Patterns',
			},
		])
	})

	it("extracts empty surface when the Surface heading was renamed (the NV guard's red path)", () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/renamed-surface/widget.md'))
		expect(guide.surface()).toEqual([])
	})

	it('reflects a missing method row (missing-interface-method fixture)', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/missing-interface-method/widget.md'))
		expect(guide.methods()).toEqual([
			{ interface: 'WidgetInterface', methods: [{ name: 'inspect' }, { name: 'render' }] },
		])
	})

	it('reflects a phantom method row (phantom-method fixture)', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/phantom-method/widget.md'))
		expect(guide.methods()).toEqual([
			{
				interface: 'WidgetInterface',
				methods: [{ name: 'inspect' }, { name: 'render' }, { name: 'reset' }, { name: 'destroy' }],
			},
		])
	})
})

// ── The bijection matrix ────────────────────────────────────────────────────
// For every broken guide variant, the Guide + Source projections combine into
// exactly the one-element diff the fixture's own doc comment predicts. The
// good fixture's green path is the baseline every red path is a one-symptom
// deviation from.

describe('bijection matrix', () => {
	const goodSource = createSource({
		files: readInventory(new URL('../../fixtures/good/', import.meta.url), ['.']),
		module: 'module',
	})

	it('good: documents every source export and vice versa (both directions empty)', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(findMissingSymbols(goodSource.surface(), guide.surface())).toEqual([])
		expect(findMissingSymbols(guide.surface(), goodSource.surface())).toEqual([])
	})

	it('good: WidgetInterface method set equals Widget class method set (green path)', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		const [group] = guide.methods()
		expect(group?.methods).toEqual(goodSource.methods('WidgetInterface'))
		expect(goodSource.methods('WidgetInterface')).toEqual(goodSource.methods('Widget'))
		expect(guide.tagline()).toBe(
			'A tiny fixture module exercising every ExportKeyword for guides-parity tests.',
		)
	})

	it('undocumented-export: source has DEFAULT_COUNT the guide does not document', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/undocumented-export/widget.md'))
		expect(findMissingSymbols(goodSource.surface(), guide.surface())).toEqual([
			'const DEFAULT_COUNT',
		])
	})

	it('phantom-row: guide documents missingExport, which the source does not export', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/phantom-row/widget.md'))
		expect(findMissingSymbols(guide.surface(), goodSource.surface())).toEqual([
			'function missingExport',
		])
	})

	it('wrong-kind: createLabel drifts keyword in both directions', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/wrong-kind/widget.md'))
		expect(findMissingSymbols(goodSource.surface(), guide.surface())).toEqual([
			'function createLabel',
		])
		expect(findMissingSymbols(guide.surface(), goodSource.surface())).toEqual(['const createLabel'])
	})

	it('missing-interface-method: the guide is missing the reset row', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/missing-interface-method/widget.md'))
		const [group] = guide.methods()
		const documented = (group?.methods ?? []).map((entry) => entry.name)
		const missing = goodSource
			.methods('WidgetInterface')
			.map((entry) => entry.name)
			.filter((method) => !documented.includes(method))
		expect(missing).toEqual(['reset'])
	})

	it('phantom-method: the guide documents a destroy method the interface does not have', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/phantom-method/widget.md'))
		const [group] = guide.methods()
		const declared = goodSource.methods('WidgetInterface').map((entry) => entry.name)
		const phantom = (group?.methods ?? [])
			.map((entry) => entry.name)
			.filter((method) => !declared.includes(method))
		expect(phantom).toEqual(['destroy'])
	})

	it('class-extra-method: the class has an extra method the interface does not document', () => {
		const extraSource = createSource({
			files: readInventory(new URL('../../fixtures/broken/class-extra-method/', import.meta.url), [
				'.',
			]),
			module: 'module',
		})
		const guide = new Guide(requireText(FIXTURES, 'broken/class-extra-method/widget.md'))
		const [group] = guide.methods()
		const documented = (group?.methods ?? []).map((entry) => entry.name)
		const extra = extraSource
			.methods('Widget')
			.map((entry) => entry.name)
			.filter((method) => !documented.includes(method))
		expect(extra).toEqual(['extra'])
	})

	it('broken-link: the guide links a source path that does not exist', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/broken-link/widget.md'))
		const guidePath = 'guides/src/widget.md'
		const dangling = guide
			.links()
			.filter((href) => !isExternalLink(href))
			.map((href) => resolveLink(guidePath, href))
			.filter((resolved) => !goodSource.exists(resolved.replace(/^good\//, '')))
		expect(dangling).toEqual(['good/module/gone.ts'])
	})

	it('missing-test-link: the guide links a test file that does not exist', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/missing-test-link/widget.md'))
		expect(guide.tests()).toEqual(['../../good/tests/missing.test.ts'])
		expect(goodSource.exists('tests/missing.test.ts')).toBe(false)
		expect(goodSource.exists('tests/widget.test.ts')).toBe(true)
	})
})
