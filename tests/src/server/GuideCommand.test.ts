import type { GuideReadFunction, GuideRunnerFunction } from '@src/server'
import { GuideCommand } from '@src/server'
import { isRecord } from '@orkestrel/contract'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'
import { describe, expect, it } from 'vitest'
import { runNativeGuide } from '../../setupServer.js'

describe('GuideCommand', () => {
	it('accepts the installed inventory reader and Vitest runner directly', () => {
		expect<GuideReadFunction>(readInventory).toBe(readInventory)
		expect<GuideRunnerFunction>(createVitest).toBe(createVitest)
	})

	it('publishes the server command', async () => {
		const server: unknown = await import('@src/server')
		expect(isRecord(server) && typeof server.GuideCommand === 'function').toBe(true)
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
