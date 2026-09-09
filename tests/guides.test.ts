// The self-dogfooding drop-in: the exact consumer-side footprint this package
// ships, run against this repository's own guides/README.md manifest.

import type { GuideModule, SurfaceSymbol } from '@orkestrel/guide'
import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

const FENCE_LANGUAGES: readonly string[] = Object.freeze(['ts'])
const EXAMPLE_LANGUAGE = 'ts'
const GUIDE_SPEC = 'guides/guide.md'
const GUIDE_MODULES: Readonly<Record<string, GuideModule>> = Object.freeze({
	'@orkestrel/guide': 'src/core',
	'@orkestrel/guide/server': 'src/server',
})

await new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md'],
	modules: GUIDE_MODULES,
	languages: FENCE_LANGUAGES,
	language: EXAMPLE_LANGUAGE,
	reader: readInventory,
	runner: createVitest,
}).execute(async ({ files, report, root, rows }) => {
	const { isNonEmptyString } = await import('@orkestrel/contract')
	const {
		createGuide,
		createSource,
		createSourceManager,
		extractSourceLines,
		findDrift,
		findMissing,
		findMissingSymbols,
		findUnlisted,
		renderSurface,
		replaceCell,
		replaceSummary,
		resolveLink,
		resolvePath,
	} = await import('@src/core')
	const { describe, expect, it } = await import('vitest')
	const { requireText } = await import('./setup.js')
	const sources = createSourceManager({
		files,
		modules: GUIDE_MODULES,
	})

	it('loads every indexed guide input', () => {
		expect(root.length).toBeGreaterThan(0)
		expect(report.input).toEqual([])
	})

	it('manifest lists at least one guide', () => {
		expect(rows.length).toBeGreaterThan(0)
	})

	it('constructs the package guide row', () => {
		expect(rows.map((row) => row.entry.spec)).toContain(GUIDE_SPEC)
	})

	it('documents only real exports in the README API list', () => {
		// The root README is the package's front door and no manifest row reads it, so
		// its per-method prose can name a method nobody can call while every guide
		// check stays green. Bound the population to `## API`: the `## Usage` fence
		// declares a consumer-supplied `readText`, which resolves to no export.
		const readme = requireText(files, 'README.md')
		const heading = '\n## API\n'
		const start = readme.indexOf(heading)
		expect(start).toBeGreaterThan(-1)
		const rest = readme.slice(start + heading.length)
		const end = rest.indexOf('\n## ')
		const section = end === -1 ? rest : rest.slice(0, end)
		const tokens = Array.from(
			new Set(
				Array.from(section.matchAll(/`(\w+)\(/g), (match) => match[1]).filter(isNonEmptyString),
			),
		)
		expect(tokens.length).toBeGreaterThan(0)

		const documented = [
			...(sources
				.source('@orkestrel/guide')
				?.surface()
				.map((symbol) => symbol.name) ?? []),
			...rows.flatMap(({ guide }) =>
				guide.methods().flatMap((group) => group.methods.map((method) => method.name)),
			),
		]
		expect(findMissing(tokens, documented)).toEqual([])
	})

	// The example half of the equality case is silent over an empty population: with no
	// title on both sides `findDrift` compares no pair and the case passes on the summaries
	// alone. This pins the population this repository's own guide contributes, so removing
	// every `@example` title reddens the suite instead of quietly retiring half the gate.
	// The failure names both title sets, because a pin reporting only its own emptiness
	// leaves the reader to work out which side dropped the title.
	it('pairs at least one example title across the guide and the source', () => {
		expect(report.examples.titles.filter((finding) => finding.spec === GUIDE_SPEC)).toEqual([])
	})

	// The README's pitch and the guide's tagline are one text, each read as the blockquote
	// under its file's H1. `README.md` is outside the concept index, so the reader is
	// applied to it directly rather than through a manifest row. Each side is guarded
	// against `undefined` first, so a file that lost its blockquote reports that rather
	// than reporting two absences as agreement.
	it('opens the README with the guide tagline', () => {
		expect(report.pitch).toEqual([])
	})

	for (const row of rows) {
		describe(`${row.entry.concept}`, () => {
			it('keeps the documented, direct, and barrel surfaces in parity', () => {
				expect(report.surface.filter((finding) => finding.spec === row.entry.spec)).toEqual([])
			})

			it('keeps behavioral interfaces and implementing classes in parity', () => {
				expect(report.methods.filter((finding) => finding.spec === row.entry.spec)).toEqual([])
			})

			// The equality gate: a `Summary` cell against its export's description paragraph, a
			// titled fence against the `@example` of that title. `findDrift` owns the comparison
			// and names both sides; converge the two sides through the native entry, never by
			// weakening this assertion. `findDrift` pairs an example only where a title is
			// present on both sides, so an untitled `@example` block is outside this case. Each
			// collected line is the spec, the key, and each side's text or `absent` — the same
			// worklist the native entry prints, so a failure here is read the way that command's
			// output is. Select source authority with `--to guide`, or guide authority with
			// `--to source`.
			it('keeps every compared summary and example equal to its source', () => {
				expect(report.drift.filter((finding) => finding.spec === row.entry.spec)).toEqual([])
			})

			it('documents an example for every Surface function', () => {
				expect(
					report.examples.functions.filter((finding) => finding.spec === row.entry.spec),
				).toEqual([])
			})

			it('documents an example for every method', () => {
				expect(
					report.examples.methods.filter((finding) => finding.spec === row.entry.spec),
				).toEqual([])
			})

			it('imports only real exports in every ```ts fence', () => {
				expect(report.imports.filter((finding) => finding.spec === row.entry.spec)).toEqual([])
			})

			it('resolves every relative link', () => {
				expect(report.links.filter((finding) => finding.spec === row.entry.spec)).toEqual([])
			})
			it('links only to test files that exist', () => {
				expect(report.tests.filter((finding) => finding.spec === row.entry.spec)).toEqual([])
			})

			it('uses admitted fence languages', () => {
				expect(report.fences.filter((finding) => finding.spec === row.entry.spec)).toEqual([])
			})
		})
	}

	// The executed half. Every preceding check reads a name — from markdown text or
	// from reflected source — and a name that resolves proves nothing about the
	// sentence beside it, so a fence whose comment claims a value the code
	// contradicts passes all of them. The cases here run the `## Patterns` fences and
	// assert the values their comments claim. Change a fence, change the
	// transcription beside it.
	describe('flagship fences', () => {
		const guideText = requireText(files, GUIDE_SPEC)

		it('extracts a surface and its sections from markdown text', () => {
			const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `X` | class |')

			expect(guide.surface()).toEqual([{ name: 'X', keyword: 'class' }])
			expect(guide.sections()).toEqual(['Surface'])
		})

		it('carries the Guide-construction fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"const guide = createGuide('## Surface\\n\\n| Name | Kind |\\n| --- | --- |\\n| `X` | class |')",
			)
			expect(guideText).toContain("guide.surface() // [{ name: 'X', keyword: 'class' }]")
			expect(guideText).toContain("guide.sections() // ['Surface']")
		})

		it('keeps every fence and reports the ones a language list omits', () => {
			const guide = createGuide('```ts\nconst a = 1\n```\n\n```sh\nnpm test\n```\n')

			expect(guide.fences()).toEqual([
				{ language: 'ts', code: 'const a = 1' },
				{ language: 'sh', code: 'npm test' },
			])
			expect(findUnlisted(guide.fences(), ['ts'])).toEqual([{ language: 'sh', code: 'npm test' }])
			expect(findUnlisted(guide.fences(), ['ts', 'sh'])).toEqual([])
		})

		it('carries the fence-language fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"const guide = createGuide('```ts\\nconst a = 1\\n```\\n\\n```sh\\nnpm test\\n```\\n')",
			)
			expect(guideText).toContain(
				"guide.fences() // [{ language: 'ts', code: 'const a = 1' }, { language: 'sh', code: 'npm test' }]",
			)
			expect(guideText).toContain(
				"findUnlisted(guide.fences(), ['ts']) // [{ language: 'sh', code: 'npm test' }]",
			)
			expect(guideText).toContain("findUnlisted(guide.fences(), ['ts', 'sh']) // []")
		})

		it('reflects an inline files record into declarations, members, and paths', () => {
			const source = createSource({
				files: {
					'src/core/index.ts': "export * from './Guide.js'\nexport * from './types.js'\n",
					'src/core/Guide.ts': 'export class Guide {}\n',
					'src/core/types.ts': 'export interface GuideInterface {\n\tsections(): void\n}\n',
				},
				module: 'src/core',
			})

			expect(source.exports()).toEqual([
				{ name: 'Guide', keyword: 'class' },
				{ name: 'GuideInterface', keyword: 'interface' },
			])
			expect(source.surface()).toEqual([
				{ name: 'Guide', keyword: 'class' },
				{ name: 'GuideInterface', keyword: 'interface' },
			])
			expect(source.methods('GuideInterface')).toEqual([{ name: 'sections' }])
			expect(source.exists('src/core/Guide.ts')).toBe(true)
			expect(source.exists('src/core')).toBe(true)
		})

		it('carries the Source-construction fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"source.exports() // [{ name: 'Guide', keyword: 'class' }, { name: 'GuideInterface', keyword: 'interface' }]",
			)
			expect(guideText).toContain(
				"source.surface() // [{ name: 'Guide', keyword: 'class' }, { name: 'GuideInterface', keyword: 'interface' }]",
			)
			expect(guideText).toContain("source.methods('GuideInterface') // [{ name: 'sections' }]")
			expect(guideText).toContain("source.exists('src/core/Guide.ts') // true")
			expect(guideText).toContain(
				"source.exists('src/core') // true — a directory any inventory key sits beneath",
			)
		})

		it('resolves a specifier to one shared source view and skips a foreign one', () => {
			const managed = createSourceManager({
				files: {
					'src/core/index.ts': "export * from './Guide.js'\n",
					'src/core/Guide.ts': 'export class Guide {}\n',
				},
				modules: { '@scope/package': 'src/core', '@scope/package/core': 'src/core' },
			})

			expect(managed.source('@scope/package')?.surface()).toEqual([
				{ name: 'Guide', keyword: 'class' },
			])
			expect(managed.source('node:fs')).toBeUndefined()
			expect(managed.source('@scope/package')).toBe(managed.source('@scope/package/core'))
			expect(managed.sources()).toEqual([managed.source('@scope/package')])
		})

		it('carries the SourceManager fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"sources.source('@scope/package')?.surface() // [{ name: 'Guide', keyword: 'class' }]",
			)
			expect(guideText).toContain(
				"sources.source('node:fs') // undefined — a foreign import, which a fence check skips",
			)
			expect(guideText).toContain(
				"sources.source('@scope/package') === sources.source('@scope/package/core') // true",
			)
			expect(guideText).toContain('sources.sources() // [the one shared view both specifiers name]')
		})

		it('agrees in every direction between declarations, barrel, and guide', () => {
			const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `Guide` | class |')
			const source = createSource({
				files: {
					'src/core/index.ts': "export * from './Guide.js'\n",
					'src/core/Guide.ts': 'export class Guide {}\n',
				},
				module: 'src/core',
			})

			expect(findMissingSymbols(source.exports(), source.surface())).toEqual([])
			expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
			expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
			expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
		})

		it('names both sites of a disagreement between a guide and its source', () => {
			const guide = createGuide(
				'## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks the tree. |',
			)
			const source = createSource({
				files: {
					'src/core/index.ts': "export * from './helpers.js'\n",
					'src/core/helpers.ts': '/**\n * Walks a tree.\n */\nexport function walk(): void {}\n',
				},
				module: 'src/core',
			})

			expect(findDrift(guide, source)).toEqual([
				{
					key: 'function walk',
					category: 'summary',
					guide: 'Walks the tree.',
					source: 'Walks a tree.',
				},
			])
		})

		it('carries the drift fence lines the transcription copies', () => {
			expect(guideText).toContain(
				'// One entry per disagreement, naming both sites; a symbol one side lacks belongs to SB.',
			)
			expect(guideText).toContain(
				"findDrift(guide, source) // [{ key: 'function walk', category: 'summary', guide: 'Walks the tree.', source: 'Walks a tree.' }]",
			)
		})

		it('carries a summary across into the guide and into a doc block', () => {
			const guide =
				'## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks the tree. |'

			expect(replaceCell(guide, 'function walk', 'Walks a tree.')).toBe(
				'## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks a tree. |',
			)
			expect(replaceCell(guide, 'function phantom', 'Absent.')).toBeUndefined()
			expect(replaceCell(guide, 'function walk', 'Walks the tree.') === guide).toBe(true)
			expect(replaceSummary('/** Walks the tree. */', 'Walks a tree.')).toBe('/** Walks a tree. */')
		})

		// The guide states the renderers' round trip as a caller's obligation rather than as a
		// property of the render alone: each renders the block a section contains, so reading one
		// back parses it under the heading the caller supplies. This assertion is what breaks if
		// that obligation changes; the transcription check beside it only guards the sentence.
		it('reads a rendered Surface table back under the section heading its caller supplies', () => {
			const symbols: readonly SurfaceSymbol[] = [
				{ name: 'walk', keyword: 'function', summary: 'Walks the tree.' },
				{ name: 'Widget', keyword: 'class', summary: 'Represents a widget.' },
			]
			const rendered = renderSurface(symbols)

			expect(createGuide(rendered).surface()).toEqual([])
			expect(createGuide(`## Surface\n\n${rendered}`).surface()).toEqual(symbols)
		})

		it('carries the caller-obligation sentence the round trip proves', () => {
			expect(guideText).toContain(
				"`extractSurface` reads\n`'## Surface\\n\\n' + renderSurface(symbols)` back to the symbols it was rendered from",
			)
			expect(guideText).toContain('The gate reports and never writes')
		})

		it('carries the propagation fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"\t'## Surface\\n\\n| Name | Kind | Summary |\\n| --- | --- | --- |\\n| `walk` | function | Walks the tree. |'",
			)
			expect(guideText).toContain(
				"// The guide's text back, with that one cell replaced and every byte outside the table unchanged.",
			)
			expect(guideText).toContain("replaceCell(guide, 'function walk', 'Walks a tree.')")
			expect(guideText).toContain(
				"// '## Surface\\n\\n| Name | Kind | Summary |\\n| --- | --- | --- |\\n| `walk` | function | Walks a tree. |'",
			)
			expect(guideText).toContain(
				"replaceCell(guide, 'function phantom', 'Absent.') // undefined — no row carries that key",
			)
			expect(guideText).toContain(
				"replaceCell(guide, 'function walk', 'Walks the tree.') === guide // true — the row already carries it",
			)
			expect(guideText).toContain(
				"replaceSummary('/** Walks the tree. */', 'Walks a tree.') // '/** Walks a tree. */'",
			)
		})

		it('reads the tagline from the blockquote following the H1', () => {
			const guide = createGuide('# Widget\n\n> A widget toolkit.\n\n## Surface\n')

			expect(guide.tagline()).toBe('A widget toolkit.')
		})

		it('carries the tagline fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"const guide = createGuide('# Widget\\n\\n> A widget toolkit.\\n\\n## Surface\\n')",
			)
			expect(guideText).toContain("guide.tagline() // 'A widget toolkit.'")
		})

		it('carries the bijection fence lines the transcription copies', () => {
			expect(guideText).toContain(
				'// Direct declarations, public barrel, and guide surface agree in every direction.',
			)
			expect(guideText).toContain('findMissingSymbols(source.exports(), source.surface()) // []')
			expect(guideText).toContain('findMissingSymbols(source.surface(), source.exports()) // []')
			expect(guideText).toContain('findMissingSymbols(source.surface(), guide.surface()) // []')
			expect(guideText).toContain('findMissingSymbols(guide.surface(), source.surface()) // []')
		})

		it('projects a commented line into equal-length source and code with no JSDoc', () => {
			const [record] = extractSourceLines('export const visible = true // note\n')

			expect(record?.source).toBe('export const visible = true // note')
			expect(record?.code).toBe('export const visible = true        ')
			expect(record?.jsdoc).toBeUndefined()
		})

		it('carries the projection fence lines the transcription copies', () => {
			expect(guideText).toContain("extractSourceLines('export const visible = true // note\\n')")
			expect(guideText).toContain(
				"// [{ source: 'export const visible = true // note', code: 'export const visible = true        ', jsdoc: undefined }]",
			)
			expect(guideText).toContain('// … one record per remaining line')
		})

		it('reduces a directory target and a declaring-file target', () => {
			expect(resolvePath('guides/nested', './spec.md')).toBe('guides/nested/spec.md')
			expect(resolveLink('index.ts', './root.ts')).toBe('root.ts')
		})

		it('carries the path fence lines the transcription copies', () => {
			expect(guideText).toContain(
				"resolvePath('guides/nested', './spec.md') // 'guides/nested/spec.md'",
			)
			expect(guideText).toContain("resolveLink('index.ts', './root.ts') // 'root.ts'")
		})
	})
})
