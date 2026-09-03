import {
	EXPORT_KEYWORDS,
	isExportKeyword,
	manifestEntryShape,
	methodGroupShape,
	surfaceSymbolShape,
} from '@src/core'
import { createContract, seededRandom } from '@orkestrel/contract'
import { describe, expect, it } from 'vitest'
import { TEST_SEED } from '../../setup.js'

// The ContractShape blueprints — surfaceSymbolShape, methodGroupShape,
// manifestEntryShape — each compiled (through createContract) into a guard /
// parser / schema / generator that must agree in lockstep
// (.claude/rules/patterns.md § Validation and contracts).

describe('surfaceSymbolShape', () => {
	const contract = createContract(surfaceSymbolShape)

	it('is: accepts a well-formed value', () => {
		expect(contract.is({ name: 'Widget', keyword: 'class' })).toBe(true)
	})

	it('is: rejects a wrong keyword literal', () => {
		expect(contract.is({ name: 'Widget', keyword: 'enum' })).toBe(false)
	})

	it('schema: closed object with a name string and a keyword literal enum', () => {
		expect(contract.schema.type).toBe('object')
		expect(contract.schema.required).toEqual(['name', 'keyword'])
		expect(contract.schema.additionalProperties).toBe(false)
		expect(contract.schema.properties?.name?.type).toBe('string')
		expect(contract.schema.properties?.keyword?.enum).toEqual(EXPORT_KEYWORDS)
	})

	it('is: agrees with isExportKeyword on every declared keyword and on a non-member', () => {
		for (const keyword of EXPORT_KEYWORDS) {
			expect(isExportKeyword(keyword)).toBe(true)
			expect(contract.is({ name: 'Widget', keyword })).toBe(true)
		}
		expect(isExportKeyword('enum')).toBe(false)
		expect(contract.is({ name: 'Widget', keyword: 'enum' })).toBe(false)
	})

	it('generate: round-trips through is and parse', () => {
		const value = contract.generate(seededRandom(TEST_SEED))
		expect(contract.is(value)).toBe(true)
		expect(contract.parse(value)).toEqual(value)
	})

	it('generate: is deterministic per seed', () => {
		const a = contract.generate(seededRandom(TEST_SEED))
		const b = contract.generate(seededRandom(TEST_SEED))
		const c = contract.generate(seededRandom(TEST_SEED + 1))
		expect(a).toEqual(b)
		expect(a).not.toEqual(c)
	})

	it('parse: rejects an invalid value', () => {
		expect(contract.parse({ name: 'Widget' })).toBeUndefined()
	})
})

describe('methodGroupShape', () => {
	const contract = createContract(methodGroupShape)

	it('is: accepts a well-formed value', () => {
		expect(contract.is({ interface: 'WidgetInterface', methods: ['inspect'] })).toBe(true)
	})

	it('is: rejects a non-array methods field', () => {
		expect(contract.is({ interface: 'WidgetInterface', methods: 'inspect' })).toBe(false)
	})

	it('schema: closed object with an interface string and a methods string array', () => {
		expect(contract.schema.type).toBe('object')
		expect(contract.schema.required).toEqual(['interface', 'methods'])
		expect(contract.schema.additionalProperties).toBe(false)
		expect(contract.schema.properties?.interface?.type).toBe('string')
		expect(contract.schema.properties?.methods?.type).toBe('array')
	})

	it('generate: round-trips through is and parse, deterministically', () => {
		const a = contract.generate(seededRandom(TEST_SEED))
		const b = contract.generate(seededRandom(TEST_SEED))
		expect(contract.is(a)).toBe(true)
		expect(contract.parse(a)).toEqual(a)
		expect(a).toEqual(b)
	})

	it('parse: rejects a missing required field', () => {
		expect(contract.parse({ interface: 'WidgetInterface' })).toBeUndefined()
	})
})

describe('manifestEntryShape', () => {
	const contract = createContract(manifestEntryShape)

	it('is: accepts a single-string source', () => {
		expect(
			contract.is({ concept: 'X', spec: 'x.md', source: 'src/core', tests: 'tests/src/core' }),
		).toBe(true)
	})

	it('is: accepts a multi-directory source array', () => {
		expect(
			contract.is({
				concept: 'X',
				spec: 'x.md',
				source: ['src/core', 'src/browser'],
				tests: 'tests/src/core',
			}),
		).toBe(true)
	})

	it('is: rejects a numeric source', () => {
		expect(contract.is({ concept: 'X', spec: 'x.md', source: 1, tests: 't' })).toBe(false)
	})

	it('schema: closed object with a union-typed source', () => {
		expect(contract.schema.type).toBe('object')
		expect(contract.schema.required).toEqual(['concept', 'spec', 'source', 'tests'])
		expect(contract.schema.additionalProperties).toBe(false)
		expect(
			contract.schema.properties?.source?.anyOf ?? contract.schema.properties?.source?.oneOf,
		).toBeDefined()
	})

	it('generate: the GuideModule union produces either a string or an array, and is() holds either way', () => {
		let sawString = false
		let sawArray = false

		for (let seed = TEST_SEED; seed < TEST_SEED + 50; seed += 1) {
			const value = contract.generate(seededRandom(seed))
			expect(contract.is(value)).toBe(true)
			if (typeof value.source === 'string') sawString = true
			if (Array.isArray(value.source)) sawArray = true
		}

		expect(sawString || sawArray).toBe(true)
	})

	it('generate: is deterministic per seed', () => {
		const a = contract.generate(seededRandom(TEST_SEED))
		const b = contract.generate(seededRandom(TEST_SEED))
		expect(a).toEqual(b)
	})

	it('parse: valid value round-trips to a structurally-equal rebuilt value', () => {
		const input = { concept: 'X', spec: 'x.md', source: 'src/core', tests: 'tests/src/core' }
		expect(contract.parse(input)).toEqual(input)
	})

	it('parse: rejects an invalid value', () => {
		expect(contract.parse({ concept: 1 })).toBeUndefined()
	})
})
