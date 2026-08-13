import {
	createGuide,
	createManifestEntryContract,
	createMethodGroupContract,
	createSource,
	createSurfaceSymbolContract,
} from '@src/core'
import { seededRandom } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { TEST_SEED } from '../../setup.js'
import { readInventory, requireText } from '../../setupServer.js'

const FIXTURES = readInventory(new URL('../../fixtures/', import.meta.url), ['.'])

// The factory surface — createGuide / createSource construct working
// instances, and createSurfaceSymbolContract / createMethodGroupContract /
// createManifestEntryContract compile each shape into a full contract
// (AGENTS §14 / §16). Guide/Source's own projections are covered in depth by
// Guide.test.ts / Source.test.ts — this suite is a spot-check that the
// factories wire the right classes and shapes.

describe('createGuide', () => {
	it('returns a working GuideInterface over the good fixture guide', () => {
		const guide = createGuide(requireText(FIXTURES, 'good/guides/src/widget.md'))
		expect(guide.surface()).toHaveLength(6)
		expect(guide.sections()).toEqual(['Surface', 'Methods', 'Tests'])
		expect(guide.fences()).toEqual([])
	})
})

describe('createSource', () => {
	it('returns a working SourceInterface over a file inventory', () => {
		const source = createSource({
			files: readInventory(new URL('../../fixtures/good/', import.meta.url), ['.']),
			module: 'module',
		})
		expect(source.exports()).toHaveLength(6)
		expect(source.methods('WidgetInterface')).toEqual(['inspect', 'render', 'reset'])
		expect(source.exists('module/Widget.ts')).toBe(true)
	})
})

describe('createSurfaceSymbolContract', () => {
	it('compiles a working SurfaceSymbol contract', () => {
		const contract = createSurfaceSymbolContract()
		expect(contract.is({ name: 'Widget', kind: 'class' })).toBe(true)
		expect(contract.is({ name: 'Widget', kind: 'enum' })).toBe(false)

		const value = contract.generate(seededRandom(TEST_SEED))
		expect(contract.is(value)).toBe(true)
		expect(contract.parse(value)).toEqual(value)
	})
})

describe('createMethodGroupContract', () => {
	it('compiles a working MethodGroup contract', () => {
		const contract = createMethodGroupContract()
		expect(contract.is({ interface: 'WidgetInterface', methods: ['inspect'] })).toBe(true)
		expect(contract.is({ interface: 'WidgetInterface', methods: [1] })).toBe(false)

		const value = contract.generate(seededRandom(TEST_SEED))
		expect(contract.is(value)).toBe(true)
		expect(contract.parse(value)).toEqual(value)
	})
})

describe('createManifestEntryContract', () => {
	it('compiles a working ManifestEntry contract', () => {
		const contract = createManifestEntryContract()
		expect(
			contract.is({
				concept: 'Widget',
				spec: 'guides/src/widget.md',
				source: 'module',
				tests: 'tests',
			}),
		).toBe(true)
		expect(contract.is({ concept: 1 })).toBe(false)

		const value = contract.generate(seededRandom(TEST_SEED))
		expect(contract.is(value)).toBe(true)
		expect(contract.parse(value)).toEqual(value)
	})
})
