// The self-dogfooding drop-in: the exact consumer-side footprint this package
// ships, run against this repository's own guides/README.md manifest.

import type { SurfaceSymbol } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	createGuide,
	createSource,
	createSourceManager,
	extractFenceImports,
	extractSourceLines,
	findMissing,
	findUnexampled,
	findUnlisted,
	isExternalLink,
	findDrift,
	replaceCell,
	replaceSummary,
	renderSurface,
	findMissingSymbols,
	parseManifest,
	resolveLink,
	resolvePath,
	computeSymbolKey,
} from '@src/core'
import { isNonEmptyString } from '@orkestrel/contract'
import { requireValue } from '@orkestrel/test'
import { readInventory } from '@orkestrel/test/server'
import { requireText } from './setup.js'

const FENCE_LANGUAGES = Object.freeze(['ts'])
const EXAMPLE_LANGUAGE = 'ts'
const GUIDE_SPEC = 'guides/guide.md'
const files = readInventory(
	new URL('../', import.meta.url),
	['src', 'guides', 'tests', 'README.md'],
	{
		extensions: ['.ts', '.md'],
	},
)
const manifest = parseManifest(requireText(files, 'guides/README.md'), 'guides')
const own = requireValue(
	manifest.find((entry) => entry.spec === GUIDE_SPEC),
	`Missing manifest row: ${GUIDE_SPEC}`,
)
const sources = createSourceManager({
	files,
	modules: { '@orkestrel/guide': 'src/core' },
})

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
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
		...manifest.flatMap((entry) =>
			createGuide(requireText(files, entry.spec))
				.methods()
				.flatMap((group) => group.methods.map((method) => method.name)),
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
	const guide = createGuide(requireText(files, GUIDE_SPEC))
	const source = createSource({ files, module: own.source })
	const declared = source
		.examples()
		.map((example) => example.title)
		.filter(isNonEmptyString)
	const headings = guide
		.fences()
		.map((fence) => fence.title)
		.filter(isNonEmptyString)
	const paired = headings.filter((title) => declared.includes(title))
	const unpaired =
		paired.length > 0
			? []
			: [
					`${GUIDE_SPEC} pairs: guide ${JSON.stringify(headings)} source ${JSON.stringify(declared)}`,
				]
	expect(unpaired).toEqual([])
})

// The README's pitch and the guide's tagline are one text, each read as the blockquote
// under its file's H1. `README.md` is outside the concept index, so the reader is
// applied to it directly rather than through a manifest row. Each side is guarded
// against `undefined` first, so a file that lost its blockquote reports that rather
// than reporting two absences as agreement.
it('opens the README with the guide tagline', () => {
	const pitch = createGuide(requireText(files, 'README.md')).tagline()
	const tagline = createGuide(requireText(files, GUIDE_SPEC)).tagline()

	expect(pitch).not.toBeUndefined()
	expect(tagline).not.toBeUndefined()
	expect(pitch).toBe(tagline)
})

for (const entry of manifest) {
	const guide = createGuide(requireText(files, entry.spec))
	const source = createSource({ files, module: entry.source })

	describe(`${entry.concept}`, () => {
		it('uses only listed fence languages', () => {
			expect(findUnlisted(guide.fences(), FENCE_LANGUAGES)).toEqual([])
		})

		it('extracts a non-empty documented surface', () => {
			expect(guide.surface().length).toBeGreaterThan(0)
		})
		it('names every Surface and Methods row', () => {
			expect(guide.unnamed()).toEqual([])
		})
		it('re-exports every direct declaration', () => {
			expect(findMissingSymbols(source.exports(), source.surface())).toEqual([])
		})
		it('re-exports only direct declarations', () => {
			expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
		})
		it('documents every barrel export', () => {
			expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
		})
		it('documents only barrel exports', () => {
			expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
		})

		it('exposes no hidden module-scope declarations', () => {
			expect(source.hidden().map(computeSymbolKey)).toEqual([])
		})

		for (const group of guide.methods()) {
			const members = source.methods(group.interface).map((method) => method.name)
			const documented = group.methods.map((method) => method.name)
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(documented.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, documented)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(documented, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface
							? []
							: findMissing(
									source.methods(entity).map((method) => method.name),
									documented,
								)
					expect(extra).toEqual([])
				})
			})
		}

		// The equality gate: a `Summary` cell against its export's description paragraph, a
		// titled fence against the `@example` of that title. `findDrift` owns the comparison
		// and names both sides; converge the two sides with `npm run docs`, never by
		// weakening this assertion. `findDrift` pairs an example only where a title is
		// present on both sides, so an untitled `@example` block is outside this case. Each
		// collected line is the spec, the key, and each side's text or `absent` — the same
		// worklist `npm run docs` prints, so a failure here is read the way that command's
		// output is.
		it('keeps every compared summary and example equal to its source', () => {
			const disagreeing: string[] = []
			for (const drift of findDrift(guide, source)) {
				const left = drift.guide === undefined ? 'absent' : JSON.stringify(drift.guide)
				const right = drift.source === undefined ? 'absent' : JSON.stringify(drift.source)
				disagreeing.push(`${entry.spec} ${drift.key}: guide ${left} source ${right}`)
			}
			expect(disagreeing).toEqual([])
		})

		it('documents an example for every Surface function', () => {
			const fences = guide
				.fences()
				.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				.map((fence) => fence.code)
			const names = guide
				.surface()
				.filter((symbol) => symbol.keyword === 'function')
				.map((symbol) => symbol.name)
			expect(
				findUnexampled(
					names,
					fences,
					source.examples().map((example) => example.name),
				),
			).toEqual([])
		})

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code)
					const examples = (
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					).map((example) => example.name)
					const documented = group.methods.map((method) => method.name)
					expect(findUnexampled(documented, fences, examples)).toEqual([])
				})
			})
		}

		it('imports only real exports in every ```ts fence', () => {
			// `compared` is the non-vacuousness guard: an unmapped `modules` policy, a
			// package rename, or fences moved to a subpath specifier all leave every
			// import skipped, and a loop that ran no assertion reports green.
			const fences = guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)
			let compared = 0
			for (const fence of fences) {
				for (const { specifier, names } of extractFenceImports(fence.code)) {
					const imported = sources.source(specifier)
					if (imported === undefined) continue
					compared += 1
					const surface = imported.surface().map((symbol) => symbol.name)
					expect(findMissing(names, surface)).toEqual([])
				}
			}
			expect(compared).toBeGreaterThan(0)
		})

		it('resolves every relative link', () => {
			expect(guide.links().length).toBeGreaterThan(0)
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			expect(guide.tests().length).toBeGreaterThan(0)
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing).toEqual([])
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
			{ key: 'function walk', guide: 'Walks the tree.', source: 'Walks a tree.' },
		])
	})

	it('carries the drift fence lines the transcription copies', () => {
		expect(guideText).toContain(
			'// One entry per disagreement, naming both sites; a symbol one side lacks belongs to SB.',
		)
		expect(guideText).toContain(
			"findDrift(guide, source) // [{ key: 'function walk', guide: 'Walks the tree.', source: 'Walks a tree.' }]",
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
