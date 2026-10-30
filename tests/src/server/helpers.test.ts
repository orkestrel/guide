import type { ManifestEntry } from '@src/core'
import {
	computeGuideEnvironment,
	computeGuideProject,
	formatGuideFinding,
	matchesGuideResult,
	resolveGuideRoot,
	selectGuidePitch,
} from '@src/server'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ChangingResult, ResultModule } from '../../setupServer.js'

describe('matchesGuideResult', () => {
	it('owns foreign result collections before inspection', () => {
		const changing = new ChangingResult()

		expect(
			matchesGuideResult({ testModules: [{ state: () => 'passed' }], unhandledErrors: [] }),
		).toBe(true)
		expect(
			matchesGuideResult({ testModules: [{ state: () => 'failed' }], unhandledErrors: [] }),
		).toBe(false)
		expect(matchesGuideResult({ testModules: [], unhandledErrors: [] })).toBe(false)
		expect(matchesGuideResult(changing)).toBe(false)
		expect(changing.reads).toBe(1)
	})

	it('validates only consumed members and retains the module receiver', () => {
		expect(
			matchesGuideResult({
				testModules: [new ResultModule('passed')],
				unhandledErrors: [],
				extra: 'admitted',
			}),
		).toBe(true)
		expect(matchesGuideResult(undefined)).toBe(false)
		expect(matchesGuideResult({ testModules: {}, unhandledErrors: [] })).toBe(false)
		expect(matchesGuideResult({ testModules: [], unhandledErrors: {} })).toBe(false)
		expect(matchesGuideResult({ testModules: [undefined], unhandledErrors: [] })).toBe(false)
		expect(matchesGuideResult({ testModules: [{ state: 'passed' }], unhandledErrors: [] })).toBe(
			false,
		)
		expect(
			matchesGuideResult({
				testModules: [new ResultModule('passed')],
				unhandledErrors: [new Error('runner failure')],
			}),
		).toBe(false)
	})
})

describe('formatGuideFinding', () => {
	it('adds a present prefix once and leaves an absent prefix alone', () => {
		expect(formatGuideFinding({ text: 'missing export' })).toBe('missing export')
		expect(formatGuideFinding({ spec: 'guides/widget.md', text: 'missing export' })).toBe(
			'guides/widget.md missing export',
		)
		expect(
			formatGuideFinding({
				spec: 'guides/widget.md',
				text: 'guides/widget.md missing export',
			}),
		).toBe('guides/widget.md missing export')
	})
})

describe('resolveGuideRoot', () => {
	it('resolves native absolute and relative paths and file URLs with spaces', () => {
		const absolute = resolve('workspace')
		const relative = join('workspace', 'nested')
		const spaced = resolve('workspace with spaces')

		expect(resolveGuideRoot(absolute)).toBe(absolute)
		expect(resolveGuideRoot(relative)).toBe(resolve(relative))
		expect(resolveGuideRoot(pathToFileURL(spaced))).toBe(spaced)
	})
})

describe('selectGuidePitch', () => {
	it('selects the matching indexed guide and rejects missing or absent package names', () => {
		const entries: readonly ManifestEntry[] = [
			{ concept: 'Widget', spec: 'guides/widget.md', source: 'src/core', tests: 'tests' },
		]

		expect(selectGuidePitch(entries, 'widget')).toBe('guides/widget.md')
		expect(selectGuidePitch(entries, 'other')).toBeUndefined()
		expect(selectGuidePitch(entries, undefined)).toBeUndefined()
	})
})

describe('computeGuideProject', () => {
	it('maps a src or app environment module to its scoped project', () => {
		expect(computeGuideProject('src/core')).toBe('configs/src/tsconfig.core.json')
		expect(computeGuideProject('src/server')).toBe('configs/src/tsconfig.server.json')
		expect(computeGuideProject('app/browser')).toBe('configs/app/tsconfig.browser.json')
	})

	it('maps no project for a module outside src/<env> and app/<env>', () => {
		for (const module of [
			'src/core/sources',
			'src',
			'lib/core',
			'.',
			'src/..',
			'src/core/',
			'/src/core',
			'src\\core',
		]) {
			expect(computeGuideProject(module)).toBeUndefined()
		}
	})
})

describe('computeGuideEnvironment', () => {
	it('maps a src or app source to the environment directory it equals or sits beneath', () => {
		expect(computeGuideEnvironment('src/core')).toBe('src/core')
		expect(computeGuideEnvironment('src/core/panels')).toBe('src/core')
		expect(computeGuideEnvironment('src/core/panels/rows')).toBe('src/core')
		expect(computeGuideEnvironment('app/browser/screens')).toBe('app/browser')
		expect(computeGuideEnvironment('src/corex')).toBe('src/corex')
		expect(computeGuideEnvironment('src/core.x')).toBeUndefined()
	})

	it('maps no environment for a source under neither src/<env> nor app/<env>', () => {
		for (const source of [
			'src',
			'app',
			'lib/core',
			'.',
			'src/..',
			'src/core/',
			'src/core/../server',
			'/src/core',
			'src\\core',
			'srcs/core',
			'tests/src/core',
		]) {
			expect(computeGuideEnvironment(source)).toBeUndefined()
		}
	})
})
