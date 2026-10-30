import { GUIDE_CODES, GuideError, GUIDE_ERROR_BRAND, isGuideError } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('GuideError', () => {
	it('preserves its code, message, and cause with a non-enumerable identity brand', () => {
		const cause = new Error('source')
		const error = new GuideError('Invalid Surface', 'signature', { cause })
		expect(error.code).toBe('signature')
		expect(error.message).toBe('Invalid Surface')
		expect(error.cause).toBe(cause)
		expect(Object.getOwnPropertyDescriptor(error, GUIDE_ERROR_BRAND)).toEqual({
			value: error,
			enumerable: false,
			writable: false,
			configurable: false,
		})
		expect(isGuideError(error)).toBe(true)
	})

	it('recognizes a subclass and refuses lookalikes, proxies, and undeclared codes', () => {
		const error = new GuideError('Invalid Surface', 'header')
		const child = Reflect.construct(
			GuideError,
			['Invalid Surface', 'header'],
			class extends GuideError {},
		)
		expect(isGuideError(child)).toBe(true)
		expect(isGuideError(new Proxy(error, {}))).toBe(false)
		expect(isGuideError(Object.assign(new Error('Invalid Surface'), { code: 'header' }))).toBe(
			false,
		)
		expect(isGuideError({ [GUIDE_ERROR_BRAND]: error, code: 'header' })).toBe(false)
		const plain: Record<PropertyKey, unknown> = {
			name: 'GuideError',
			message: 'Invalid Surface',
			code: 'header',
		}
		plain[GUIDE_ERROR_BRAND] = plain
		expect(isGuideError(plain)).toBe(false)
		const bare = Object.assign(new Error('Invalid Surface'), { code: 'header' })
		Object.defineProperty(bare, GUIDE_ERROR_BRAND, { value: bare })
		expect(isGuideError(bare)).toBe(false)
		Object.defineProperty(error, 'code', { value: 'other' })
		expect(isGuideError(error)).toBe(false)
	})

	it('carries a JSON context under every declared code and refuses a context of another shape', () => {
		const error = new GuideError('Refused compile', 'compile', {
			context: { module: 'src/core', output: 'error TS2322' },
		})
		expect(error.context).toEqual({ module: 'src/core', output: 'error TS2322' })
		expect(isGuideError(error)).toBe(true)
		expect(new GuideError('Refused header', 'header').context).toBeUndefined()
		expect(GUIDE_CODES.map((code) => isGuideError(new GuideError('Refused', code)))).toEqual(
			GUIDE_CODES.map(() => true),
		)
		Object.defineProperty(error, 'context', { value: new Map([['module', 'src/core']]) })
		expect(isGuideError(error)).toBe(false)
	})

	it('contains throwing reads and revoked proxies', () => {
		const error = new GuideError('Invalid Surface', 'header')
		Object.defineProperty(error, 'code', {
			get() {
				throw new Error('unreadable')
			},
		})
		const revoked = Proxy.revocable(error, {})
		revoked.revoke()
		expect(isGuideError(error)).toBe(false)
		expect(isGuideError(revoked.proxy)).toBe(false)
		expect(isGuideError(undefined)).toBe(false)
	})
})
