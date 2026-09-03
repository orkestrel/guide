import { seededRandom } from '@orkestrel/contract'
import { createScratch, readInventory } from '@orkestrel/test/server'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TEST_SEED, requireText, requireTable } from './setup.js'

// Proves the host-independent setup helpers every project relies on. `setup.ts` is
// host-independent, so its full contract is reachable from the `setup` project, which
// runs in Node — real files anchor the inventory proof rather than a plain object.

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

describe('requireText', () => {
	it('reads a present file from a real inventory built by scanning real files on disk', () => {
		const scratch = createScratch()
		try {
			scratch.write('widget.md', '# Widget\n')
			// A second route: `readInventory` walks the real directory rather than
			// hand-building the record `requireText` reads, so the file the assertion
			// checks against is the one Node actually wrote and scanned.
			const files = readInventory(pathToFileURL(`${scratch.path}/`), ['.'])
			expect(requireText(files, 'widget.md')).toBe('# Widget\n')
		} finally {
			scratch.destroy()
		}
	})

	it('throws naming the missing relative path when the key is absent', () => {
		const files = { 'present.md': 'content' }
		expect(() => requireText(files, 'missing/widget.md')).toThrow('Missing file: missing/widget.md')
	})
})
