import { seededRandom } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { TEST_SEED, isBrowserVuePath, requireTable } from './setup.js'

// Proves the host-independent setup helpers every project relies on. `setup.ts` carries no
// browser or Node dependency, so its full contract is reachable from the `setup` project.

describe('TEST_SEED', () => {
	it('feeds seededRandom a fixed starting point that reproduces the same value across calls', () => {
		// Deriving expected values the same way seededRandom derives them would prove
		// nothing; the contract this constant exists for is that two independent calls
		// seeded with it agree, which is exactly what every suite reusing it depends on.
		const first = seededRandom(TEST_SEED)
		const second = seededRandom(TEST_SEED)
		expect(first()).toBe(second())
		expect(first()).toBe(second())
	})

	it('differs from a neighboring seed', () => {
		const own = seededRandom(TEST_SEED)
		const neighbor = seededRandom(TEST_SEED + 1)
		expect(own()).not.toBe(neighbor())
	})
})

describe('requireTable', () => {
	it('returns the leading table with header and row cell text read straight from the source', () => {
		const table = requireTable('| Name | Kind |\n| --- | --- |\n| Widget | class |\n')
		expect(table.element).toBe('table')
		// Read the expected text by a second route: literal substrings of the source
		// markdown, never by re-parsing it the way requireTable itself does.
		const [headerFirst, headerSecond] = table.header
		expect(headerFirst).toEqual([{ element: 'text', value: 'Name' }])
		expect(headerSecond).toEqual([{ element: 'text', value: 'Kind' }])
		const [row] = table.rows
		expect(row).toEqual([
			[{ element: 'text', value: 'Widget' }],
			[{ element: 'text', value: 'class' }],
		])
	})

	it('throws when the leading block is not a table', () => {
		expect(() => requireTable('Just a paragraph, no table.')).toThrow('expected a table block')
	})

	it('throws when the document has no blocks at all', () => {
		expect(() => requireTable('')).toThrow('expected a table block')
	})
})

describe('isBrowserVuePath', () => {
	it.each([
		['app/browser/components/Widget.vue', true],
		['app\\browser\\components\\Widget.vue', true],
		['app/server/handlers.ts', false],
		['app/browserish/Widget.vue', false],
		['appbrowser/Widget.vue', false],
	])('%s -> %s', (path, expected) => {
		expect(isBrowserVuePath(path)).toBe(expected)
	})
})
