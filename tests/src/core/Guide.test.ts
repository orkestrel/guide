import { Guide, createSource, isExternalLink, findMissingSymbols, resolveLink } from '@src/core'
import { describe, expect, it } from 'vitest'
import { readInventory } from '@orkestrel/test/server'
import { requireText } from '../../setup.js'

const FIXTURES = readInventory(new URL('../../fixtures/', import.meta.url), ['.'])

// The pure Guide view over one parsed guide's markdown — the cached
// projections. Constructed from the good/broken fixture guides that exercise
// each projection's green and red paths (.claude/rules/tests.md § Test contract).

describe('Guide', () => {
	it('extracts sections in document order from the good fixture guide', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.sections()).toEqual(['Surface', 'Methods', 'Tests'])
	})

	it('extracts the exact documented surface from the good fixture guide', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.surface()).toEqual([
			{ name: 'WidgetInterface', keyword: 'interface' },
			{ name: 'WidgetKind', keyword: 'type' },
			{ name: 'createLabel', keyword: 'function' },
			{ name: 'loadWidget', keyword: 'function' },
			{ name: 'DEFAULT_COUNT', keyword: 'const' },
			{ name: 'Widget', keyword: 'class' },
		])
	})

	it('extracts the WidgetInterface method group from the good fixture guide', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.methods()).toEqual([
			{ interface: 'WidgetInterface', methods: ['inspect', 'render', 'reset'] },
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
		expect(guide.surface()).toBe(guide.surface())
		expect(guide.methods()).toBe(guide.methods())
		expect(guide.sections()).toBe(guide.sections())
		expect(guide.links()).toBe(guide.links())
		expect(guide.tests()).toBe(guide.tests())
		expect(guide.fences()).toBe(guide.fences())
	})

	it('extracts an empty fences() array from the good fixture guide', () => {
		const guide = new Guide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.fences()).toEqual([])
	})

	it("extracts the missing-example fixture guide's one Patterns fence", () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/missing-example/guides/src/widget.md'))
		expect(guide.fences()).toEqual([
			{
				language: 'ts',
				code: "import { greet } from '../module/helpers.js'\n\ngreet('world')",
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
			{ interface: 'WidgetInterface', methods: ['inspect', 'render'] },
		])
	})

	it('reflects a phantom method row (phantom-method fixture)', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/phantom-method/widget.md'))
		expect(guide.methods()).toEqual([
			{ interface: 'WidgetInterface', methods: ['inspect', 'render', 'reset', 'destroy'] },
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
		const sourceMethods = goodSource.methods('WidgetInterface')
		const missing = sourceMethods.filter((method) => !(group?.methods ?? []).includes(method))
		expect(missing).toEqual(['reset'])
	})

	it('phantom-method: the guide documents a destroy method the interface does not have', () => {
		const guide = new Guide(requireText(FIXTURES, 'broken/phantom-method/widget.md'))
		const [group] = guide.methods()
		const sourceMethods = goodSource.methods('WidgetInterface')
		const phantom = (group?.methods ?? []).filter((method) => !sourceMethods.includes(method))
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
		const extra = extraSource
			.methods('Widget')
			.filter((method) => !(group?.methods ?? []).includes(method))
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
