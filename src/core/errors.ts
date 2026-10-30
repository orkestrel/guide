import type { GuideCode, GuideErrorOptions } from './types.js'
import type { JSONRecord } from '@orkestrel/contract'
import { holds, INTRINSICS, isBoundedJSONRecord } from '@orkestrel/contract'
import { GUIDE_CODES, GUIDE_ERROR_BRAND } from './constants.js'

/** Carries a coded refusal of a guide, a manifest entry, or a module compile. */
export class GuideError extends Error {
	override readonly name: string = 'GuideError'
	readonly code: GuideCode
	readonly context: JSONRecord | undefined

	constructor(message: string, code: GuideCode, options?: GuideErrorOptions) {
		super(message, options)
		this.code = code
		this.context = options?.context
		INTRINSICS.define(this, GUIDE_ERROR_BRAND, { value: this })
	}
}

/**
 * Checks whether a value carries the Guide error brand and declared members across package copies.
 *
 * @example
 * ```ts
 * isGuideError(new GuideError('Invalid Surface header', 'header')) // true
 * ```
 */
export function isGuideError(value: unknown): value is GuideError {
	return holds(() => {
		if (!(value instanceof INTRINSICS.error)) return false
		if (INTRINSICS.prototype(value) === INTRINSICS.error.prototype) return false
		if (INTRINSICS.describe(value, GUIDE_ERROR_BRAND)?.value !== value) return false
		const code: unknown = INTRINSICS.reflect.read(value, 'code')
		const context: unknown = INTRINSICS.reflect.read(value, 'context')
		return (
			GUIDE_CODES.some((candidate) => candidate === code) &&
			(context === undefined || isBoundedJSONRecord(context)) &&
			typeof INTRINSICS.reflect.read(value, 'name') === 'string' &&
			typeof INTRINSICS.reflect.read(value, 'message') === 'string'
		)
	})
}
