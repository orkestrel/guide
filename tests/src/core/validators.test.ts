import {
	extractMethods,
	extractSurface,
	isManifestEntry,
	isMethodGroup,
	isSurfaceSymbol,
	parseManifest,
} from '@src/core'
import { createMarkdown } from '@orkestrel/markdown'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../../setup.js'

// The four from-unknown guards a parsed guide/manifest value crosses on its
// way into a typed shape — each total (never throws), each accepting real
// extracted values and rejecting near-misses (AGENTS §14, §16).

describe('isExportKind (via isSurfaceSymbol)', () => {
	it('accepts every real extracted value', () => {
		const document = createMarkdown(readFixture('good/guides/src/widget.md')).document
		for (const symbol of extractSurface(document)) {
			expect(isSurfaceSymbol(symbol)).toBe(true)
		}
	})

	it('rejects an unrecognized kind string', () => {
		expect(isSurfaceSymbol({ name: 'X', kind: 'enum' })).toBe(false)
	})
})

describe('isSurfaceSymbol', () => {
	it('accepts a well-formed symbol', () => {
		expect(isSurfaceSymbol({ name: 'Widget', kind: 'class' })).toBe(true)
	})

	it('rejects a missing field', () => {
		expect(isSurfaceSymbol({ name: 'Widget' })).toBe(false)
	})

	it('rejects a wrong-type field', () => {
		expect(isSurfaceSymbol({ name: 1, kind: 'class' })).toBe(false)
	})

	it('rejects an extra key', () => {
		expect(isSurfaceSymbol({ name: 'Widget', kind: 'class', extra: true })).toBe(false)
	})

	it('rejects primitives', () => {
		expect(isSurfaceSymbol('Widget')).toBe(false)
		expect(isSurfaceSymbol(1)).toBe(false)
		expect(isSurfaceSymbol(true)).toBe(false)
	})

	it('rejects null and undefined', () => {
		expect(isSurfaceSymbol(null)).toBe(false)
		expect(isSurfaceSymbol(undefined)).toBe(false)
	})

	it('never throws on a hostile getter object', () => {
		const hostile = {
			get name(): string {
				throw new Error('boom')
			},
			kind: 'class',
		}
		expect(() => isSurfaceSymbol(hostile)).not.toThrow()
	})
})

describe('isMethodGroup', () => {
	it('accepts every real extracted method group', () => {
		const document = createMarkdown(readFixture('good/guides/src/widget.md')).document
		for (const group of extractMethods(document)) {
			expect(isMethodGroup(group)).toBe(true)
		}
	})

	it('accepts a well-formed group', () => {
		expect(isMethodGroup({ interface: 'WidgetInterface', methods: ['inspect'] })).toBe(true)
	})

	it('rejects a missing field', () => {
		expect(isMethodGroup({ interface: 'WidgetInterface' })).toBe(false)
	})

	it('rejects a methods array with a wrong element type', () => {
		expect(isMethodGroup({ interface: 'WidgetInterface', methods: [1] })).toBe(false)
	})

	it('rejects an extra key', () => {
		expect(isMethodGroup({ interface: 'WidgetInterface', methods: [], extra: true })).toBe(false)
	})

	it('rejects primitives and null', () => {
		expect(isMethodGroup('X')).toBe(false)
		expect(isMethodGroup(null)).toBe(false)
	})

	it('never throws on a hostile getter object', () => {
		const hostile = {
			interface: 'X',
			get methods(): readonly string[] {
				throw new Error('boom')
			},
		}
		expect(() => isMethodGroup(hostile)).not.toThrow()
	})
})

describe('isManifestEntry', () => {
	it('accepts every real parsed manifest entry', () => {
		const entries = parseManifest(readFixture('good/guides/README.md'), 'guides')
		for (const entry of entries) {
			expect(isManifestEntry(entry)).toBe(true)
		}
	})

	it('accepts a well-formed entry with a single-string source', () => {
		expect(
			isManifestEntry({ concept: 'X', spec: 'x.md', source: 'src/core', tests: 'tests/src/core' }),
		).toBe(true)
	})

	it('accepts a well-formed entry with a multi-directory source', () => {
		expect(
			isManifestEntry({
				concept: 'X',
				spec: 'x.md',
				source: ['src/core', 'src/browser'],
				tests: 'tests/src/core',
			}),
		).toBe(true)
	})

	it('rejects a missing field', () => {
		expect(isManifestEntry({ concept: 1 })).toBe(false)
	})

	it('rejects a wrong-type source (neither string nor string array)', () => {
		expect(isManifestEntry({ concept: 'X', spec: 'x.md', source: 1, tests: 't' })).toBe(false)
	})

	it('rejects an extra key', () => {
		expect(
			isManifestEntry({ concept: 'X', spec: 'x.md', source: 'src', tests: 't', extra: true }),
		).toBe(false)
	})

	it('rejects primitives and null', () => {
		expect(isManifestEntry('X')).toBe(false)
		expect(isManifestEntry(null)).toBe(false)
	})

	it('never throws on a hostile getter object', () => {
		const hostile = {
			concept: 'X',
			spec: 'x.md',
			get source(): string {
				throw new Error('boom')
			},
			tests: 't',
		}
		expect(() => isManifestEntry(hostile)).not.toThrow()
	})
})
