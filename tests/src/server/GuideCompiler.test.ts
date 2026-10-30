import { createSource, extractSignatures } from '@src/core'
import { GuideCompiler } from '@src/server'
import { createScratch } from '@orkestrel/test/server'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPILER_FIXTURE, COMPILER_PROJECT, TYPESCRIPT_ROOT } from '../../setupServer.js'

describe('GuideCompiler', () => {
	it('computes each declaration form from the workspace compiler', () => {
		const scratch = createScratch({ prefix: 'compiler-', files: COMPILER_FIXTURE })
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const declarations = new GuideCompiler({ root: scratch.path }).compile('src/core')
			const source = createSource({
				files: COMPILER_FIXTURE,
				module: 'src/core',
				declarations,
			})

			expect(Object.keys(declarations)).toEqual([
				'src/core/Widget.d.ts',
				'src/core/WidgetBox.d.ts',
				'src/core/WidgetError.d.ts',
				'src/core/constants.d.ts',
				'src/core/functions.d.ts',
				'src/core/index.d.ts',
				'src/core/types.d.ts',
			])
			expect(
				Object.fromEntries(
					source.surface().map((symbol) => [`${symbol.keyword} ${symbol.name}`, symbol.signature]),
				),
			).toEqual({
				'const WIDGET_KIND': '"widget"',
				'const WIDGET_LABEL': 'string',
				'const WIDGET_LIMITS': '{ readonly size: 3; readonly depth: 2; }',
				'class Widget': 'new (options: WidgetOptions) => WidgetInterface',
				'class WidgetBox': 'new <T>() => WidgetBox<T>',
				'class WidgetError': 'new (message: string, code: string) => WidgetError',
				'interface WidgetInterface': '{ name, label?, open(), resize() }',
				'interface WidgetLookup':
					'{ (name: string): WidgetInterface | undefined, readonly [name: string]: unknown }',
				'interface WidgetOptions': '{ name }',
				'type WidgetPath': '`widgets/${string}`',
				'type WidgetRecord': '{ readonly id: string; readonly size: number; }',
				'function findWidget': '((id: string) => boolean) & ((ids: readonly string[]) => boolean)',
				'function firstWidget': '<T extends WidgetOptions>(widgets: readonly T[]) => T | undefined',
				'function openWidget': '(name: string) => boolean',
			})
			expect(extractSignatures(declarations['src/core/index.d.ts'] ?? '')).toEqual([])
			expect(Object.keys(declarations)).toEqual(
				Object.keys(declarations).toSorted((left, right) =>
					left === right ? 0 : left < right ? -1 : 1,
				),
			)
		} finally {
			scratch.destroy()
		}
	})

	it('returns the same bytes from two compiles of one tree', () => {
		const scratch = createScratch({ prefix: 'compiler-', files: COMPILER_FIXTURE })
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const compiler = new GuideCompiler({ root: scratch.path })
			const first = compiler.compile('src/core')
			const second = new GuideCompiler({ root: pathToFileURL(scratch.path) }).compile('src/core')

			expect(JSON.stringify(second)).toBe(JSON.stringify(first))
			expect(JSON.stringify(first)).not.toContain('orkestrel-guide-')
			expect(Object.isFrozen(first)).toBe(true)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a source that fails to compile with the compiler output', () => {
		const scratch = createScratch({
			prefix: 'compiler-',
			files: {
				'package.json': '{ "type": "module" }\n',
				'configs/src/tsconfig.core.json': COMPILER_PROJECT,
				'src/core/index.ts': "export const broken: number = 'text'\n",
			},
		})
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			expect(() => new GuideCompiler({ root: scratch.path }).compile('src/core')).toThrow(
				/^"src\/core" does not compile through configs\/src\/tsconfig\.core\.json:\n[\s\S]*src\/core\/index\.ts[\s\S]*TS2322/,
			)
			expect(() => new GuideCompiler({ root: scratch.path }).compile('src/core')).toThrow(
				expect.objectContaining({
					code: 'compile',
					context: expect.objectContaining({
						module: 'src/core',
						project: 'configs/src/tsconfig.core.json',
						output: expect.stringMatching(/TS2322/),
					}),
				}),
			)
		} finally {
			scratch.destroy()
		}
	})

	it.each([
		[
			'a declarationDir that sends the emit elsewhere',
			COMPILER_PROJECT.replace(
				'"emitDeclarationOnly": true,',
				'"emitDeclarationOnly": true,\n\t\t"declarationDir": "../../types",',
			),
		],
		[
			'an include that misses the module',
			COMPILER_PROJECT.replace('"rootDir": "../../src/core"', '"rootDir": "../../src"').replace(
				'"../../src/core/**/*.ts"',
				'"../../src/other/**/*.ts"',
			),
		],
	])('refuses %s as an empty emit naming the module and project', (_label, project) => {
		const scratch = createScratch({
			prefix: 'compiler-',
			files: {
				...COMPILER_FIXTURE,
				'src/other/widgets.ts': 'export const OTHER_WIDGET = 1\n',
				'configs/src/tsconfig.core.json': project,
			},
		})
		try {
			expect(project).not.toBe(COMPILER_PROJECT)
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			expect(() => new GuideCompiler({ root: scratch.path }).compile('src/core')).toThrow(
				expect.objectContaining({
					code: 'empty',
					message:
						'"src/core" emitted no declaration under src/core through configs/src/tsconfig.core.json; the project\'s include must cover src/core and its declarations must emit into --outDir, with no declarationDir.',
					context: { module: 'src/core', project: 'configs/src/tsconfig.core.json' },
				}),
			)
		} finally {
			scratch.destroy()
		}
	})

	it('removes its scratch output after a success and after a failure', () => {
		const scratch = createScratch({
			prefix: 'compiler-',
			files: COMPILER_FIXTURE,
		})
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const temporary = scratch.ensure('temporary')
			const compiler = new GuideCompiler({ root: scratch.path, temporary })
			expect(Object.keys(compiler.compile('src/core'))).not.toEqual([])
			expect(scratch.names('temporary')).toEqual([])
			scratch.write('src/core/broken.ts', "export const broken: number = 'text'\n")
			expect(() => compiler.compile('src/core')).toThrow(
				expect.objectContaining({ code: 'compile' }),
			)
			expect(scratch.names('temporary')).toEqual([])
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a compiler run that passes its timeout', () => {
		const scratch = createScratch({ prefix: 'compiler-', files: COMPILER_FIXTURE })
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			expect(() =>
				new GuideCompiler({ root: scratch.path, timeout: 1 }).compile('src/core'),
			).toThrow(
				expect.objectContaining({
					code: 'timeout',
					message:
						'"src/core" did not compile through configs/src/tsconfig.core.json within 1 ms; the compiler was stopped at the timeout.',
					context: { module: 'src/core', project: 'configs/src/tsconfig.core.json', timeout: 1 },
				}),
			)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a compiler run that passes its output bound', () => {
		const scratch = createScratch({ prefix: 'compiler-', files: COMPILER_FIXTURE })
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			expect(() => new GuideCompiler({ root: scratch.path, limit: 1 }).compile('src/core')).toThrow(
				expect.objectContaining({
					code: 'overflow',
					message:
						'"src/core" wrote more than 1 bytes of compiler output to one stream through configs/src/tsconfig.core.json; the compiler was stopped at the output bound.',
					context: { module: 'src/core', project: 'configs/src/tsconfig.core.json', limit: 1 },
				}),
			)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a project the workspace does not carry with the compiler output', () => {
		const scratch = createScratch({ prefix: 'compiler-', files: { 'package.json': '{}\n' } })
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			expect(() => new GuideCompiler({ root: scratch.path }).compile('src/server')).toThrow(
				/^"src\/server" does not compile through configs\/src\/tsconfig\.server\.json:\n\S/,
			)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a module outside src/<env> and app/<env> naming the expected project path', () => {
		const compiler = new GuideCompiler({ root: '.' })
		for (const module of ['src/core/sources', 'lib/core', '.', 'src', 'src/../core']) {
			expect(() => compiler.compile(module)).toThrow(
				expect.objectContaining({
					code: 'compile',
					message: `${JSON.stringify(module)} is outside src/<env> and app/<env>; a guide module compiles through configs/<layer>/tsconfig.<env>.json, such as configs/src/tsconfig.core.json for src/core.`,
				}),
			)
		}
	})

	it('refuses a workspace that installs no TypeScript compiler', () => {
		const scratch = createScratch({ prefix: 'compiler-', files: COMPILER_FIXTURE })
		try {
			expect(() => new GuideCompiler({ root: scratch.path }).compile('src/core')).toThrow(
				expect.objectContaining({
					code: 'compile',
					message: expect.stringContaining(
						'installs no TypeScript compiler; node_modules/typescript/package.json names no bin.tsc entry.',
					),
				}),
			)
		} finally {
			scratch.destroy()
		}
	})
})
