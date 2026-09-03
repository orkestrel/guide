// The self-dogfooding drop-in: the exact consumer-side footprint this package
// ships, run against this repository's own guides/README.md manifest.

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
	findMissingSymbols,
	parseManifest,
	resolveLink,
	resolvePath,
	computeSymbolKey,
} from '@src/core'
import { isNonEmptyString } from '@orkestrel/contract'
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
				.flatMap((group) => group.methods),
		),
	]
	expect(findMissing(tokens, documented)).toEqual([])
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
			const members = source.methods(group.interface)
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface}`, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				it(`${entity} exposes no undocumented method`, () => {
					const extra =
						entity === group.interface ? [] : findMissing(source.methods(entity), group.methods)
					expect(extra).toEqual([])
				})
			})
		}

		it('documents an example for every Surface function', () => {
			const fences = guide
				.fences()
				.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				.map((fence) => fence.code)
			const names = guide
				.surface()
				.filter((symbol) => symbol.keyword === 'function')
				.map((symbol) => symbol.name)
			expect(findUnexampled(names, fences, source.examples())).toEqual([])
		})

		for (const group of guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			describe(`${group.interface} examples`, () => {
				it('documents an example for every method', () => {
					const fences = guide
						.fences()
						.filter((fence) => fence.language === EXAMPLE_LANGUAGE)
						.map((fence) => fence.code)
					const examples =
						entity === group.interface
							? source.examples(group.interface)
							: source.examples(group.interface).concat(source.examples(entity))
					expect(findUnexampled(group.methods, fences, examples)).toEqual([])
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
		expect(source.methods('GuideInterface')).toEqual(['sections'])
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
		expect(guideText).toContain("source.methods('GuideInterface') // ['sections']")
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
			"// [{ source: 'export const visible = true // note', code: 'export const visible = true        ', jsdoc: undefined }, ...]",
		)
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
