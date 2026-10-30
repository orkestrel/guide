import type { GuideReadFunction, GuideRunnerFunction } from '@src/server'
import { GuideCommand } from '@src/server'
import { isFunction, isRecord } from '@orkestrel/contract'
import { createScratch, readInventory } from '@orkestrel/test/server'
import { resolve } from 'node:path'
import { createVitest } from 'vitest/node'
import { describe, expect, it } from 'vitest'
import {
	COLLISION_FIXTURE,
	COMPILER_PROJECT,
	DISTINCT_FIXTURE,
	NATIVE_FIXTURE,
	NESTED_FIXTURE,
	RECORDER_COMPILER,
	TYPESCRIPT_ROOT,
	runNativeGuide,
} from '../../setupServer.js'

describe('GuideCommand', () => {
	it('rejects a malformed guide with its path, refusal code, and required header', async () => {
		const scratch = createScratch({
			files: {
				'package.json': '{}',
				'configs/src/tsconfig.core.json': COMPILER_PROJECT,
				'src/core/index.ts': 'export {}\n',
				'guides/README.md':
					'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n| Widget | [Widget](rejected.md) | [Source](../src/core) | [Tests](../tests) |',
				'guides/rejected.md':
					'## Surface\n\n| Name | Kind | Shape | Summary |\n| --- | --- | --- | --- |\n| `Widget` | class | `new () => Widget` | |',
			},
		})
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const command = new GuideCommand({
				root: scratch.path,
				patterns: ['guides/*.md'],
				modules: {},
				languages: ['ts'],
				language: 'ts',
				reader: readInventory,
				runner: createVitest,
			})
			await expect(
				command.execute(async () => {
					throw new Error('Registration must not run')
				}),
			).rejects.toMatchObject({
				code: 'header',
				message:
					'"guides/rejected.md": ## Surface table 1 has header "Name | Kind | Shape | Summary"; expected "Name | Kind | Signature | Summary".',
			})
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a source that fails to compile naming the module and the compiler output', async () => {
		const scratch = createScratch({
			files: {
				...NATIVE_FIXTURE,
				'src/core/widgets.ts': "export const broken: number = 'text'\n",
			},
		})
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const command = new GuideCommand({
				root: scratch.path,
				patterns: ['src/**/*.ts', 'guides/*.md'],
				modules: { '@scope/widget': 'src/core' },
				languages: ['ts'],
				language: 'ts',
				reader: readInventory,
				runner: createVitest,
			})
			await expect(
				command.execute(async () => {
					throw new Error('Registration must not run')
				}),
			).rejects.toThrow(
				/^"src\/core" does not compile through configs\/src\/tsconfig\.core\.json:\n[\s\S]*TS2322/,
			)
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a malformed guide before any module compiles', async () => {
		const scratch = createScratch({
			files: {
				...NATIVE_FIXTURE,
				...RECORDER_COMPILER,
				'src/core/widgets.ts': "export const broken: number = 'text'\n",
				'guides/widget.md':
					'## Surface\n\n| Name | Kind | Shape | Summary |\n| --- | --- | --- | --- |\n| `openWidget` | function | `() => boolean` | |\n',
			},
		})
		try {
			const command = new GuideCommand({
				root: scratch.path,
				patterns: ['src/**/*.ts', 'guides/*.md'],
				modules: { '@scope/widget': 'src/core' },
				languages: ['ts'],
				language: 'ts',
				reader: readInventory,
				runner: createVitest,
			})
			await expect(
				command.execute(async () => {
					throw new Error('Registration must not run')
				}),
			).rejects.toMatchObject({
				code: 'header',
				message:
					'"guides/widget.md": ## Surface table 1 has header "Name | Kind | Shape | Summary"; expected "Name | Kind | Signature | Summary".',
			})
			expect(scratch.has('node_modules/typescript/calls.log')).toBe(false)
		} finally {
			scratch.destroy()
		}
	})

	it('compiles each module once across a --to guide run that rewrites and inspects again', () => {
		const scratch = createScratch({ files: { ...NATIVE_FIXTURE, ...RECORDER_COMPILER } })
		try {
			const result = runNativeGuide(
				`
const runner = async () => ({
	start: async () => ({ testModules: [{ state: () => 'passed' }], unhandledErrors: [] }),
	close: async () => {},
})
`,
				{
					root: scratch.path,
					modules: { '@scope/widget': 'src/core' },
					args: ['--to', 'guide'],
				},
			)

			expect(result.error).toBeUndefined()
			expect(result.stderr).toBe('')
			expect(result.status).toBe(0)
			expect(result.stdout).toContain('wrote guides/widget.md\n')
			const calls = (scratch.read('node_modules/typescript/calls.log') ?? '')
				.trim()
				.split('\n')
				.map((line): unknown => JSON.parse(line))
			expect(calls).toEqual([
				expect.arrayContaining(['--showConfig']),
				expect.arrayContaining(['--emitDeclarationOnly']),
			])
		} finally {
			scratch.destroy()
		}
	})

	it('reads a nested module row signatures from its environment compile', async () => {
		const options = {
			patterns: ['src/**/*.ts', 'guides/*.md'],
			modules: { '@scope/widget': 'src/core', '@scope/widget/panels': 'src/core/panels' },
			languages: ['ts'],
			language: 'ts',
			reader: readInventory,
			runner: createVitest,
		}
		const clean = createScratch({ files: NESTED_FIXTURE })
		try {
			clean.ensure('node_modules')
			clean.link('node_modules/typescript', TYPESCRIPT_ROOT)
			await new GuideCommand({ ...options, root: clean.path }).execute(async ({ report, rows }) => {
				expect(rows.map((row) => row.entry.spec)).toEqual(['guides/widget.md', 'guides/panel.md'])
				expect(report.input).toEqual([])
				expect(report.drift).toEqual([])
			})
		} finally {
			clean.destroy()
		}
		const stale = createScratch({
			files: {
				...NESTED_FIXTURE,
				'guides/panel.md': (NESTED_FIXTURE['guides/panel.md'] ?? '').replace(
					'`(depth: number) => boolean`',
					'`(depth: string) => boolean`',
				),
			},
		})
		try {
			stale.ensure('node_modules')
			stale.link('node_modules/typescript', TYPESCRIPT_ROOT)
			await new GuideCommand({ ...options, root: stale.path }).execute(async ({ report }) => {
				expect(report.input).toEqual([])
				expect(report.drift).toEqual([
					{
						spec: 'guides/panel.md',
						text: expect.stringContaining(
							'signature function openPanel: guide "`(depth: string) => boolean`" source "`(depth: number) => boolean`"',
						),
					},
				])
			})
		} finally {
			stale.destroy()
		}
	})

	it('compiles an environment once per execute call for its own and its nested module rows', async () => {
		const scratch = createScratch({ files: { ...NESTED_FIXTURE, ...RECORDER_COMPILER } })
		try {
			const command = new GuideCommand({
				root: scratch.path,
				patterns: ['src/**/*.ts', 'guides/*.md'],
				modules: { '@scope/widget': 'src/core', '@scope/widget/panels': 'src/core/panels' },
				languages: ['ts'],
				language: 'ts',
				reader: readInventory,
				runner: createVitest,
			})
			await command.execute(async ({ report }) => {
				expect(report.drift).toEqual([])
			})
			const calls = (scratch.read('node_modules/typescript/calls.log') ?? '')
				.trim()
				.split('\n')
				.map((line): unknown => JSON.parse(line))
			expect(calls).toEqual([
				expect.arrayContaining([
					'--showConfig',
					resolve(scratch.path, 'configs/src/tsconfig.core.json'),
				]),
				expect.arrayContaining([
					'--emitDeclarationOnly',
					resolve(scratch.path, 'configs/src/tsconfig.core.json'),
				]),
			])
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a nested module its environment project emits no declaration under, naming it', async () => {
		const scratch = createScratch({
			files: {
				...NESTED_FIXTURE,
				'configs/src/tsconfig.core.json': COMPILER_PROJECT.replace(
					'"../../src/core/**/*.ts"',
					'"../../src/core/*.ts"',
				),
			},
		})
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const command = new GuideCommand({
				root: scratch.path,
				patterns: ['src/**/*.ts', 'guides/*.md'],
				modules: { '@scope/widget': 'src/core', '@scope/widget/panels': 'src/core/panels' },
				languages: ['ts'],
				language: 'ts',
				reader: readInventory,
				runner: createVitest,
			})
			await expect(
				command.execute(async () => {
					throw new Error('Registration must not run')
				}),
			).rejects.toMatchObject({
				code: 'empty',
				message:
					'"src/core/panels" emitted no declaration under src/core/panels through configs/src/tsconfig.core.json; each project\'s include must cover its module and its declarations must emit into --outDir, with no declarationDir.',
				context: {
					missing: [{ module: 'src/core/panels', project: 'configs/src/tsconfig.core.json' }],
				},
			})
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a source outside every src/<env> and app/<env> directory, naming it', async () => {
		const scratch = createScratch({
			files: {
				...NESTED_FIXTURE,
				'lib/core/index.ts': 'export {}\n',
				'guides/README.md': (NESTED_FIXTURE['guides/README.md'] ?? '').replace(
					'[Source](../src/core/panels)',
					'[Source](../lib/core)',
				),
				'guides/panel.md':
					'## Surface\n\n| Name | Kind | Signature | Summary |\n| --- | --- | --- | --- |\n',
			},
		})
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const command = new GuideCommand({
				root: scratch.path,
				patterns: ['src/**/*.ts', 'lib/**/*.ts', 'guides/*.md'],
				modules: { '@scope/widget': 'src/core' },
				languages: ['ts'],
				language: 'ts',
				reader: readInventory,
				runner: createVitest,
			})
			await expect(
				command.execute(async () => {
					throw new Error('Registration must not run')
				}),
			).rejects.toMatchObject({
				code: 'compile',
				message:
					'"lib/core" is outside src/<env> and app/<env>; a guide module compiles through configs/<layer>/tsconfig.<env>.json, such as configs/src/tsconfig.core.json for src/core.',
				context: { module: 'lib/core' },
			})
		} finally {
			scratch.destroy()
		}
	})

	it('exits 1 naming the guide when a native rewrite meets a header refusal', () => {
		const scratch = createScratch({
			files: {
				...NATIVE_FIXTURE,
				'guides/widget.md':
					'## Surface\n\n| Name | Kind | Shape | Summary |\n| --- | --- | --- | --- |\n| `openWidget` | function | `() => boolean` | |\n',
			},
		})
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const result = runNativeGuide(
				`
const runner = async () => ({
	start: async () => ({ testModules: [{ state: () => 'passed' }], unhandledErrors: [] }),
	close: async () => {},
})
`,
				{
					root: scratch.path,
					modules: { '@scope/widget': 'src/core' },
					args: ['--to', 'guide'],
				},
			)

			expect(result.error).toBeUndefined()
			expect(result.status).toBe(1)
			expect(result.stderr).toBe(
				'"guides/widget.md": ## Surface table 1 has header "Name | Kind | Shape | Summary"; expected "Name | Kind | Signature | Summary".\n',
			)
			expect(result.stdout).not.toContain('wrote')
			expect(scratch.read('guides/widget.md')).toBe(
				'## Surface\n\n| Name | Kind | Shape | Summary |\n| --- | --- | --- | --- |\n| `openWidget` | function | `() => boolean` | |\n',
			)
		} finally {
			scratch.destroy()
		}
	})

	it('exits 1 naming the module when a native rewrite meets a compile refusal', () => {
		const scratch = createScratch({
			files: { ...NATIVE_FIXTURE, 'src/core/widgets.ts': "export const broken: number = 'text'\n" },
		})
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const result = runNativeGuide(
				`
const runner = async () => ({
	start: async () => ({ testModules: [{ state: () => 'passed' }], unhandledErrors: [] }),
	close: async () => {},
})
`,
				{
					root: scratch.path,
					modules: { '@scope/widget': 'src/core' },
					args: ['--to', 'guide'],
				},
			)

			expect(result.error).toBeUndefined()
			expect(result.status).toBe(1)
			expect(result.stderr).toMatch(
				/^"src\/core" does not compile through configs\/src\/tsconfig\.core\.json:\n[\s\S]*TS2322/,
			)
			expect(result.stdout).not.toContain('wrote')
		} finally {
			scratch.destroy()
		}
	})

	it('refuses a name src/core and src/server both export, naming the name and both modules', async () => {
		const options = {
			patterns: ['src/**/*.ts', 'guides/*.md'],
			modules: { '@scope/widget': 'src/core', '@scope/widget/server': 'src/server' },
			languages: ['ts'],
			language: 'ts',
			reader: readInventory,
			runner: createVitest,
		}
		const colliding = createScratch({ files: COLLISION_FIXTURE })
		try {
			await expect(
				new GuideCommand({ ...options, root: colliding.path }).execute(async () => {
					throw new Error('Registration must not run')
				}),
			).rejects.toMatchObject({
				code: 'collision',
				message:
					'"guides/widget.md": "openWidget" is declared in "src/core" and "src/server"; one name exported from two environments is a conflict. Declare logic both environments share once in src/core, and give each environment\'s own logic a distinct name.',
				context: {
					collisions: [{ name: 'openWidget', modules: ['src/core', 'src/server'] }],
				},
			})
		} finally {
			colliding.destroy()
		}
		const distinct = createScratch({ files: DISTINCT_FIXTURE })
		try {
			distinct.ensure('node_modules')
			distinct.link('node_modules/typescript', TYPESCRIPT_ROOT)
			await new GuideCommand({ ...options, root: distinct.path }).execute(
				async ({ report, rows }) => {
					expect(rows.map((row) => row.entry.spec)).toEqual(['guides/widget.md'])
					expect(report.input).toEqual([])
					expect(report.drift).toEqual([])
				},
			)
		} finally {
			distinct.destroy()
		}
	})

	it('rewrites only a stale Signature cell under --to guide and reports none afterward', () => {
		const scratch = createScratch({ files: NATIVE_FIXTURE })
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const runner = `
const runner = async () => ({
	start: async () => ({ testModules: [{ state: () => 'passed' }], unhandledErrors: [] }),
	close: async () => {},
})
`
			const options = {
				root: scratch.path,
				modules: { '@scope/widget': 'src/core' },
				args: ['--to', 'guide'],
			}
			const first = runNativeGuide(runner, options)

			expect(first.error).toBeUndefined()
			expect(first.stderr).toBe('')
			expect(first.status).toBe(0)
			expect(first.stdout).toContain('wrote guides/widget.md\n')
			expect(scratch.read('guides/widget.md')).toBe(
				(NATIVE_FIXTURE['guides/widget.md'] ?? '').replace(
					'`(name: number) => boolean`',
					'`(name: string) => boolean`',
				),
			)
			expect(scratch.read('src/core/widgets.ts')).toBe(NATIVE_FIXTURE['src/core/widgets.ts'])

			const second = runNativeGuide(runner, options)
			expect(second.error).toBeUndefined()
			expect(second.stderr).toBe('')
			expect(second.status).toBe(0)
			expect(second.stdout).not.toContain('wrote')
			expect(second.stdout).not.toContain('signature')
		} finally {
			scratch.destroy()
		}
	})

	it('leaves the source unchanged under --to source and reports the computed signature', () => {
		const scratch = createScratch({ files: NATIVE_FIXTURE })
		try {
			scratch.ensure('node_modules')
			scratch.link('node_modules/typescript', TYPESCRIPT_ROOT)
			const result = runNativeGuide(
				`
const runner = async () => ({
	start: async () => ({ testModules: [{ state: () => 'passed' }], unhandledErrors: [] }),
	close: async () => {},
})
`,
				{ root: scratch.path, modules: { '@scope/widget': 'src/core' }, args: ['--to', 'source'] },
			)

			expect(result.error).toBeUndefined()
			expect(result.status).toBe(1)
			expect(result.stdout).toContain(
				'guides/widget.md signature function openWidget: guide "`(name: number) => boolean`" source "`(name: string) => boolean`"; a signature is computed from the source declaration\n',
			)
			expect(result.stdout).not.toContain('wrote')
			expect(scratch.read('src/core/widgets.ts')).toBe(NATIVE_FIXTURE['src/core/widgets.ts'])
			expect(scratch.read('guides/widget.md')).toBe(NATIVE_FIXTURE['guides/widget.md'])
		} finally {
			scratch.destroy()
		}
	})

	it('accepts the installed inventory reader and Vitest runner directly', () => {
		expect<GuideReadFunction>(readInventory).toBe(readInventory)
		expect<GuideRunnerFunction>(createVitest).toBe(createVitest)
	})

	it('publishes the server command', async () => {
		const server: unknown = await import('@src/server')
		expect(isRecord(server) && isFunction(server.GuideCommand)).toBe(true)
	})

	it('supplies fresh owned inventory and parity views to the guides worker', async () => {
		const command = new GuideCommand({
			root: new URL('../../../', import.meta.url),
			patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md'],
			modules: {
				'@orkestrel/guide': 'src/core',
				'@orkestrel/guide/server': 'src/server',
			},
			languages: ['ts'],
			language: 'ts',
			reader: readInventory,
			runner: createVitest,
		})

		await command.execute(async ({ files, report, root, rows }) => {
			expect(root.endsWith('guide')).toBe(true)
			expect(files['guides/README.md']).toBeTypeOf('string')
			expect(rows.map((row) => row.entry.spec)).toContain('guides/guide.md')
			expect(report.input).toEqual([])
		})
	})

	it('closes the real runner after its start rejects', () => {
		const result = runNativeGuide(`
const runner = async (mode, options) => {
	const reporter = {
		onTestRunStart() {
			events.push('start')
			throw new Error('runner start failed')
		},
	}
	const vitest = await createVitest(mode, {
		...options,
		reporters: [reporter],
	})
	vitest.onClose(() => events.push('close'))
	return vitest
}
`)

		expect(result.error).toBeUndefined()
		expect(result.signal).toBeNull()
		expect(result.status).toBe(1)
		expect(result.stderr).toContain('runner start failed')
		expect(result.stdout).toContain('"events":["start","close"')
		expect(result.stdout).toContain('"exitCode":1')
	})

	it('reports cleanup failure from the real runner after lifecycle completion', () => {
		const result = runNativeGuide(`
const runner = async (mode, options) => {
	const vitest = await createVitest(mode, options)
	vitest.onClose(() => {
		events.push('cleanup')
		throw new Error('runner cleanup failed')
	})
	return vitest
}
`)

		expect(result.error).toBeUndefined()
		expect(result.signal).toBeNull()
		expect(result.status).toBe(1)
		expect(result.stderr).toContain('runner cleanup failed')
		expect(result.stdout).toContain('"events":["cleanup"')
		expect(result.stdout).toContain('"exitCode":1')
	})

	it('preserves a higher native exit status with the real runner', () => {
		const result = runNativeGuide(`
process.exitCode = 5
const runner = async (mode, options) => {
	const reporter = {
		onTestRunStart() {
			throw new Error('higher exit runner failed')
		},
	}
	const vitest = await createVitest(mode, {
		...options,
		reporters: [reporter],
	})
	vitest.onClose(() => {})
	return vitest
}
`)

		expect(result.error).toBeUndefined()
		expect(result.signal).toBeNull()
		expect(result.status).toBe(5)
		expect(result.stderr).toContain('higher exit runner failed')
		expect(result.stdout).toContain('"exitCode":5')
	})

	it('rejects when worker registration rejects', async () => {
		const command = new GuideCommand({
			root: new URL('../../../', import.meta.url),
			patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md'],
			modules: {
				'@orkestrel/guide': 'src/core',
				'@orkestrel/guide/server': 'src/server',
			},
			languages: ['ts'],
			language: 'ts',
			reader: readInventory,
			runner: createVitest,
		})
		const failure = new Error('registration failed')

		await expect(
			command.execute(async () => {
				throw failure
			}),
		).rejects.toBe(failure)
	})
})
