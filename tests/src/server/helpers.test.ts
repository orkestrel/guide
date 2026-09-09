import type { ManifestEntry } from '@src/core'
import {
	formatGuideFinding,
	matchesGuideResult,
	resolveGuideRoot,
	selectGuidePitch,
} from '@src/server'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

class ChangingResult {
	#reads = 0

	get testModules(): ReadonlyArray<{ readonly state: () => string }> {
		this.#reads += 1
		return this.#reads === 1 ? [{ state: () => 'failed' }] : []
	}

	get unhandledErrors(): readonly unknown[] {
		return []
	}

	get reads(): number {
		return this.#reads
	}
}

class ResultModule {
	readonly extra = 'retained'
	readonly #status: string

	constructor(status: string) {
		this.#status = status
	}

	state(): string {
		return this.#status
	}
}

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
