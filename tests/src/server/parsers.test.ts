import { parseGuideDirection, parsePackageName } from '@src/server'
import { describe, expect, it } from 'vitest'

describe('parseGuideDirection', () => {
	it('accepts only the native rewrite argument shapes', () => {
		expect(parseGuideDirection(['--to', 'guide'])).toBe('guide')
		expect(parseGuideDirection(['--to', 'source'])).toBe('source')
		expect(parseGuideDirection([])).toBeUndefined()
		expect(parseGuideDirection(['--to'])).toBeUndefined()
		expect(parseGuideDirection(['--to', 'guide', 'extra'])).toBeUndefined()
		expect(parseGuideDirection(['--to', 'other'])).toBeUndefined()
		expect(parseGuideDirection(['guide'])).toBeUndefined()
	})
})

describe('parsePackageName', () => {
	it('reads a scoped or unscoped package name and rejects malformed input', () => {
		expect(parsePackageName('{"name":"@scope/widget"}')).toBe('widget')
		expect(parsePackageName('{"name":"widget"}')).toBe('widget')
		expect(parsePackageName('{}')).toBeUndefined()
		expect(parsePackageName('{"name":""}')).toBeUndefined()
		expect(parsePackageName('null')).toBeUndefined()
	})
})
