import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isBrowserVuePath } from './setup.js'
import { readInventory, requireText } from './setupServer.js'
import { inspectCodingWorkspace } from './setupPolicy.js'

describe('repository coding law', () => {
	it('defines conservative Node text membership for static and dynamic forms', () => {
		const rejected = ["import { readFile } from 'node:fs'", "await import('node:fs')"]
		expect(rejected.every((source) => source.includes('node:'))).toBe(true)
		expect("import { createMarkdown } from '@orkestrel/markdown'").not.toContain('node:')
	})

	it('defines conservative forbidden-identifier text membership across declaration forms', () => {
		const forbidden = [
			'function walk() {}',
			'function readText() {}',
			'const walk = () => undefined',
			'const readText = (relative: string) => relative',
		]
		expect(forbidden.every((source) => /\b(?:walk|readText)\b/.test(source))).toBe(true)
		expect('walkNodes requireText otherIdentifier').not.toMatch(/\b(?:walk|readText)\b/)
	})

	it('returns an empty inventory without touching a missing root', () => {
		const root = new URL('./.r57-does-not-exist/', import.meta.url)
		const first = readInventory(root, [])
		const second = readInventory(root, [])
		expect(first).toEqual({})
		expect(first).not.toBe(second)
	})

	it('returns an empty inventory without validating a regular-file root', () => {
		const root = new URL('../package.json', import.meta.url)
		const first = readInventory(root, [])
		const second = readInventory(root, [])
		expect(first).toEqual({})
		expect(first).not.toBe(second)
	})

	it('retains invalid-root failures for non-empty populations', () => {
		expect(() => readInventory(new URL('./.r57-does-not-exist/', import.meta.url), ['.'])).toThrow(
			'ENOENT',
		)
		expect(() => readInventory(new URL('../package.json', import.meta.url), ['.'])).toThrow(
			'Root is not a directory',
		)
	})

	it('keeps universal setup host-independent and parity free of local filesystem helpers', () => {
		const setup = readFileSync(new URL('./setup.ts', import.meta.url), 'utf8')
		const server = readFileSync(new URL('./setupServer.ts', import.meta.url), 'utf8')
		const parity = readFileSync(new URL('./guides.test.ts', import.meta.url), 'utf8')
		expect(setup).not.toContain('node:')
		expect(parity).not.toMatch(/\b(?:walk|readText)\b/)
		expect(`${setup}\n${server}\n${parity}`).not.toMatch(
			/\b(?:fixturesRoot|readFixture|collectFixtureFiles|fixtureFiles|parseTable)\b/,
		)
		expect(setup.match(/^export (?:const|function) \w+/gm)).toEqual([
			'export const TEST_SEED',
			'export function requireTable',
			'export function isBrowserVuePath',
		])
	})

	it('reads deterministic contained inventories with filtering and overlap deduplication', () => {
		const directories = ['.', 'module']
		const extensions = ['.ts']
		const files = readInventory(
			new URL('./fixtures/good/', import.meta.url),
			directories,
			extensions,
		)
		const keys = Object.keys(files)
		expect(keys).toEqual([...keys].sort())
		expect(new Set(keys).size).toBe(keys.length)
		expect(keys.length).toBeGreaterThan(0)
		expect(keys.every((key) => key.endsWith('.ts'))).toBe(true)
		expect(directories).toEqual(['.', 'module'])
		expect(extensions).toEqual(['.ts'])
		expect(readInventory(new URL('./fixtures/good/', import.meta.url), [])).toEqual({})
		expect(() => readInventory(new URL('./fixtures/good/', import.meta.url), ['..'])).toThrow(
			'Directory outside root: ..',
		)
	})

	it('requires exact present text including empty content and rejects absence', () => {
		const files = { empty: '', present: 'value' }
		expect(requireText(files, 'empty')).toBe('')
		expect(requireText(files, 'present')).toBe('value')
		expect(() => requireText(files, 'absent')).toThrow('Missing file: absent')
	})

	it('keeps Vue single-file components exclusively in browser environments', () => {
		const files = globSync('{app,src}/**/*.vue')

		expect(files.every(isBrowserVuePath)).toBe(true)
	})

	it('enforces source placement, exports, readonly contracts, and syntax law', () => {
		expect(inspectCodingWorkspace(process.cwd())).toEqual([])
	})
})
