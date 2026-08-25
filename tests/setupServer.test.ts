import { createScratch, readInventory } from '@orkestrel/test/server'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { requireText } from './setupServer.js'

// Proves the Node-only setup helper every server-side suite relies on to read fixture text.
// `setupServer.ts` is Node-only, so real files anchor this proof rather than a plain object.

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
