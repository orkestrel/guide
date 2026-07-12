// Fixture module (BROKEN: missing-example) — `greet` carries an `@example` JSDoc
// block and is mentioned in the guide's Patterns fence; `farewell` has neither,
// so EX's `findUnexampled` catches it with exactly `['farewell']`.

/**
 * @example
 * ```ts
 * greet('world')
 * ```
 */
export function greet(name: string): string {
	return `hi ${name}`
}

export function farewell(name: string): string {
	return `bye ${name}`
}
