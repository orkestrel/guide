import { findDrift, Parity } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	createParityFixture,
	PARITY_FACTORIES,
	PARITY_GUIDE,
	PARITY_SPEC,
	PARITY_TYPES,
	PARITY_WIDGET,
} from '../../setup.js'

describe('Parity', () => {
	it('publishes a pure composition with shared rows and a clean complete report', () => {
		const options = createParityFixture()
		const files = { ...options.files }
		const parity = new Parity(options)

		expect(parity.rows()).toBe(parity.rows())
		expect(parity.rows().map((row) => row.entry.spec)).toEqual([PARITY_SPEC])
		expect(parity.inspect()).toEqual({
			input: [],
			sections: [],
			surface: [],
			methods: [],
			declarations: [],
			links: [],
			tests: [],
			fences: [],
			examples: { fences: [], functions: [], methods: [], titles: [] },
			imports: [],
			drift: [],
			pitch: [],
		})
		expect(options.files).toEqual(files)
	})

	it('reports missing manifest inputs without constructing a partial row', () => {
		const absent = new Parity(createParityFixture({ files: { [PARITY_SPEC]: undefined } }))
		const empty = new Parity(createParityFixture({ entries: [] }))

		expect(absent.rows()).toEqual([])
		expect(absent.inspect().input).toEqual([
			{ spec: PARITY_SPEC, text: `${PARITY_SPEC} is absent from the inventory.` },
		])
		expect(empty.inspect().input).toEqual([{ text: 'The manifest has no guide entries.' }])
	})

	it('keeps generic report families independently assertable', () => {
		const guide = PARITY_GUIDE.replace('Represents a widget.', 'Represents another widget.')
			.replace('```ts\nimport { createWidget }', '```js\nimport { missing }')
			.replace('widget.render()', 'widget.paint()')
			.replace('../tests/src/core/Widget.test.ts', '../tests/src/core/Missing.test.ts')
		const report = new Parity(
			createParityFixture({
				files: {
					'README.md': '# Widget\n\n> Another pitch.\n',
					[PARITY_SPEC]: guide,
					'src/core/types.ts': `${PARITY_TYPES.replace('@example', '@sample')}\nconst hidden = true\n`,
					'src/core/factories.ts': PARITY_FACTORIES.replace('@example', '@sample'),
				},
			}),
		).inspect()

		expect(report.surface).not.toEqual([])
		expect(report.links).not.toEqual([])
		expect(report.tests).not.toEqual([])
		expect(report.fences).not.toEqual([])
		expect(report.examples.functions).not.toEqual([])
		expect(report.examples.methods).not.toEqual([])
		expect(report.imports).not.toEqual([])
		expect(report.drift).not.toEqual([])
		expect(report.pitch).not.toEqual([])
	})

	it('separates function, method, and configured-language example evidence', () => {
		const withoutExamples = new Parity(
			createParityFixture({
				files: {
					[PARITY_SPEC]: PARITY_GUIDE.replace(
						"import { createWidget } from '@scope/widget'\ncreateWidget()",
						"import { buildWidget } from '@scope/widget'\nbuildWidget()",
					).replace('widget.render()', 'widget.paint()'),
					'src/core/factories.ts': PARITY_FACTORIES.replace('@example', '@sample'),
					'src/core/types.ts': PARITY_TYPES.replace('@example', '@sample'),
				},
			}),
		).inspect().examples
		const language = new Parity(
			createParityFixture({ languages: ['ts'], language: 'js' }),
		).inspect()

		expect(withoutExamples.functions.map((finding) => finding.text)).toEqual([
			`${PARITY_SPEC} has no example for createWidget.`,
		])
		expect(withoutExamples.methods.map((finding) => finding.text)).toEqual([
			`${PARITY_SPEC} has no example for WidgetInterface.render.`,
		])
		expect(language.fences).toEqual([])
		expect(language.examples.fences).not.toEqual([])
	})

	it('keeps top-level title presence independent from member pairing and equality', () => {
		const memberOnly = new Parity(
			createParityFixture({
				files: {
					'src/core/factories.ts': PARITY_FACTORIES.replace(
						'@example Create a widget',
						'@example Another title',
					),
				},
			}),
		).inspect()
		const unequal = new Parity(
			createParityFixture({
				files: { [PARITY_SPEC]: PARITY_GUIDE.replace('createWidget()', 'buildWidget()') },
			}),
		).inspect()

		expect(memberOnly.drift).toEqual([])
		expect(memberOnly.examples.titles).not.toEqual([])
		expect(unequal.examples.titles).toEqual([])
		expect(unequal.drift).not.toEqual([])
	})

	it('keeps title presence scoped to each indexed guide', () => {
		const other = 'guides/other.md'
		const report = new Parity(
			createParityFixture({
				files: { [other]: PARITY_GUIDE, 'src/empty/index.ts': '' },
				entries: [
					{ concept: 'Empty', spec: PARITY_SPEC, source: 'src/empty', tests: 'tests/src/core' },
					{ concept: 'Other', spec: other, source: 'src/core', tests: 'tests/src/core' },
				],
			}),
		).inspect()

		expect(report.examples.titles.map((finding) => finding.spec)).toEqual([PARITY_SPEC])
	})

	it('reports required sections and distinguishes absent groups from empty groups', () => {
		const missing = PARITY_GUIDE.replace(/## Methods[\s\S]*?## Patterns/, '## Patterns')
		const empty = PARITY_GUIDE.replace('| `render` | Renders the widget. |', '')
		const missingReport = new Parity(
			createParityFixture({ files: { [PARITY_SPEC]: missing } }),
		).inspect()
		const emptyReport = new Parity(
			createParityFixture({ files: { [PARITY_SPEC]: empty } }),
		).inspect()

		expect(missingReport.sections).not.toEqual([])
		expect(missingReport.declarations).not.toEqual([])
		expect(emptyReport.sections).toEqual([])
		expect(emptyReport.methods).not.toEqual([])
	})

	it('reports source-driven declaration populations without requiring memberless classes', () => {
		const guide = PARITY_GUIDE.replace(
			'| `render` | Renders the widget. |',
			'| `open` | Opens the widget. |\n| `render` | Renders the widget. |',
		).replace(
			'| `Widget` | class | Represents an implementing widget. |',
			'| `Widget` | class | Represents an implementing widget. |\n| `Empty` | class | Represents an empty widget. |',
		)
		const types = PARITY_TYPES.replace(
			'\trender(): void',
			'\t/** Opens the widget. */\n\topen(): void\n\trender(): void',
		)
		const report = new Parity(
			createParityFixture({
				files: {
					[PARITY_SPEC]: guide,
					'src/core/types.ts': types,
					'src/core/index.ts':
						"export * from './types.js'\nexport * from './Widget.js'\nexport * from './Empty.js'\nexport * from './factories.js'\n",
					'src/core/Empty.ts': '/** Represents an empty widget. */\nexport class Empty {}\n',
				},
			}),
		).inspect()

		expect(report.declarations).not.toEqual([])
		expect(report.declarations.map((finding) => finding.text).join('\n')).not.toContain('Empty')
	})

	it('preserves duplicate documented names in exact declaration membership', () => {
		const duplicate = PARITY_GUIDE.replace(
			'| `render` | Renders the widget. |',
			'| `render` | Renders the widget. |\n| `render` | Renders the widget. |',
		)
		const report = new Parity(
			createParityFixture({ files: { [PARITY_SPEC]: duplicate } }),
		).inspect()

		expect(report.methods).toEqual([])
		expect(report.declarations).not.toEqual([])
	})

	it('reports method membership and implementing-class contract drift', () => {
		const guide = PARITY_GUIDE.replace(
			'| `render` | Renders the widget. |',
			'| `phantom` | Renders the widget. |',
		)
		const types = PARITY_TYPES.replace('\trender(): void', '\trender(): void\n\topen(): void')
		const widget = PARITY_WIDGET.replace(
			'\trender(): void {}',
			'\trender(): void {}\n\textra(): void {}',
		)
		const findings = new Parity(
			createParityFixture({
				files: {
					[PARITY_SPEC]: guide,
					'src/core/types.ts': types,
					'src/core/Widget.ts': widget,
				},
			}),
		).inspect().methods

		expect(findings.map((finding) => finding.text)).toEqual(
			expect.arrayContaining([
				`${PARITY_SPEC} does not document WidgetInterface.open.`,
				`${PARITY_SPEC} documents no source WidgetInterface.phantom.`,
				`${PARITY_SPEC} Widget.extra is outside the WidgetInterface contract.`,
			]),
		)
	})

	it('categorizes colliding summary and example keys without inferring from text', () => {
		const guide = PARITY_GUIDE.replace('### Create a widget', '### function createWidget')
		const source = PARITY_FACTORIES.replace(
			'@example Create a widget',
			'@example function createWidget',
		)
		const row = new Parity(
			createParityFixture({
				files: {
					[PARITY_SPEC]: guide.replace('Creates a widget.', 'Creates another widget.'),
					'src/core/factories.ts': source.replace('createWidget()', 'buildWidget()'),
				},
			}),
		).rows()[0]

		expect(row).not.toBeUndefined()
		if (row === undefined) return
		expect(findDrift(row.guide, row.source).map((drift) => [drift.key, drift.category])).toEqual([
			['function createWidget', 'summary'],
			['function createWidget', 'example'],
		])
	})

	it('rewrites source authority into guide summaries and the first titled fence only', () => {
		const guide = PARITY_GUIDE.replace('Creates a widget.', 'Creates another widget.').replace(
			'createWidget()\n```\n\n### Render',
			'buildWidget()\n```\n\n### Create a widget\n\n```ts\nleaveWidget()\n```\n\n### Render',
		)
		const options = createParityFixture({ files: { [PARITY_SPEC]: guide } })
		const rewrite = new Parity(options).document()

		expect(rewrite.findings).toEqual([])
		expect(rewrite.changes.map((change) => change.path)).toEqual([PARITY_SPEC])
		expect(rewrite.changes[0]?.content).toContain(
			'| `createWidget` | function | Creates a widget. |',
		)
		expect(rewrite.changes[0]?.content).toContain('createWidget()\n```')
		expect(rewrite.changes[0]?.content).toContain('leaveWidget()')
		expect(options.files[PARITY_SPEC]).toBe(guide)
	})

	it('accumulates guide authority into one source text and returns changed texts only', () => {
		const guide = PARITY_GUIDE.replace('Creates a widget.', 'Builds a widget.').replace(
			'createWidget()\n```',
			'createWidget({ ready: true })\n```',
		)
		const options = createParityFixture({ files: { [PARITY_SPEC]: guide } })
		const rewrite = new Parity(options).annotate()

		expect(rewrite.findings).toEqual([])
		expect(rewrite.changes.map((change) => change.path)).toEqual(['src/core/factories.ts'])
		expect(rewrite.changes[0]?.content).toContain(' * Builds a widget.')
		expect(rewrite.changes[0]?.content).toContain(' * createWidget({ ready: true })')
		expect(options.files['src/core/factories.ts']).toBe(PARITY_FACTORIES)
	})

	it('preserves an absent example language in either rewrite direction', () => {
		const source = PARITY_FACTORIES.replace(' * ```ts', ' * ```')
		const guideResult = new Parity(
			createParityFixture({ files: { 'src/core/factories.ts': source } }),
		).document()
		const guide = PARITY_GUIDE.replace(
			'```ts\nimport { createWidget }',
			'```\nimport { createWidget }',
		)
		const sourceResult = new Parity(
			createParityFixture({ files: { [PARITY_SPEC]: guide } }),
		).annotate()

		expect(guideResult.findings).toEqual([])
		expect(guideResult.changes[0]?.content).toContain('```\nimport { createWidget }')
		expect(sourceResult.findings).toEqual([])
		expect(sourceResult.changes[0]?.content).toContain(' * ```\n')
	})

	it('selects the sorted source path and earliest duplicate title site', () => {
		const alternate = [
			'/**',
			' * Creates the alternate widget.',
			' *',
			' * @example Select a site',
			' * ```ts',
			' * alternateSite()',
			' * ```',
			' */',
			'export function createAlternate(): void {}',
			'',
		].join('\n')
		const selected = [
			'/**',
			' * Creates the selected widget.',
			' *',
			' * @example Select a site',
			' * ```ts',
			' * firstSite()',
			' * ```',
			' *',
			' * @example Select a site',
			' * ```ts',
			' * laterSite()',
			' * ```',
			' */',
			'export function createSelected(): void {}',
			'',
		].join('\n')
		const guide = PARITY_GUIDE.replace('### Create a widget', '### Select a site')
		const rewrite = new Parity(
			createParityFixture({
				files: {
					'src/core/Zeta.ts': alternate,
					'src/core/Alpha.ts': selected,
					[PARITY_SPEC]: guide,
				},
			}),
		).annotate()

		expect(rewrite.findings).toEqual([])
		expect(rewrite.changes.map((change) => change.path)).toEqual(['src/core/Alpha.ts'])
		expect(rewrite.changes.find((change) => change.path === 'src/core/Zeta.ts')).toBeUndefined()
		expect(rewrite.changes[0]?.content).toContain(" * import { createWidget } from '@scope/widget'")
		expect(rewrite.changes[0]?.content).toContain(' * laterSite()')
		expect(rewrite.changes[0]?.content).not.toContain(' * firstSite()')
		expect(alternate).toContain(' * alternateSite()')
	})

	it('reports target misses and safe source refusal against the accumulated result', () => {
		const missingColumn = PARITY_GUIDE.replace(' | Summary', '').replace(
			' | --- | --- |',
			' | --- |',
		)
		const unsafe = PARITY_GUIDE.replace('createWidget()\n```', 'createWidget(/* */)\n```')
		const target = new Parity(
			createParityFixture({ files: { [PARITY_SPEC]: missingColumn } }),
		).document()
		const refused = new Parity(createParityFixture({ files: { [PARITY_SPEC]: unsafe } })).annotate()

		expect(target.changes).toEqual([])
		expect(target.findings.map((finding) => finding.text)).toEqual(
			expect.arrayContaining([expect.stringContaining('summary function createWidget:')]),
		)
		expect(refused.changes).toEqual([])
		expect(refused.findings.map((finding) => finding.text)).toEqual([
			expect.stringContaining('example Create a widget:'),
		])
		expect(refused.findings[0]?.text).toContain('cannot be represented safely')
	})
})
