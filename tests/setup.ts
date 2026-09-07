import type { TableNode } from '@orkestrel/markdown'
import type { SourceInterface } from '@src/core'
import { parseDocument } from '@orkestrel/markdown'
import { requireValue } from '@orkestrel/test'

// ── Deterministic randomness ──────────────────────────────────────────────────
// The single house seed for tests that need generated/random input (contract
// `.generate(random)` calls, fuzz-style fixtures). Suites call
// `seededRandom(TEST_SEED)` directly to get a fresh, deterministic
// `RandomFunction` — keeping the seed centralized here means every suite that
// wants determinism uses the same starting point.
export const TEST_SEED = 42

/**
 * Requires markdown whose first block is a table.
 *
 * @param markdown - The markdown source containing a leading table
 * @returns The parsed leading table
 *
 * @example
 * ```ts
 * requireTable('| Name |\n| --- |\n| Value |')
 * ```
 */
export function requireTable(markdown: string): TableNode {
	const [table] = parseDocument(markdown).children
	if (table?.element !== 'table') throw new Error('expected a table block')
	return table
}

/**
 * Looks one inventory key up and requires it to be present.
 *
 * @param files - The inventory to read
 * @param relative - The root-relative key that must be present
 * @returns The file's text
 *
 * @example
 * ```ts
 * requireText({ 'widget.md': '# Widget\n' }, 'widget.md')
 * ```
 */
export function requireText(files: Readonly<Record<string, string>>, relative: string): string {
	return requireValue(files[relative], `Missing file: ${relative}`)
}

/** Holds the names one `SourceInterface` answers with for each store-fixture reading. */
export interface StoreReadings {
	readonly member: readonly string[]
	readonly module: readonly string[]
	readonly store: readonly string[]
	readonly base: readonly string[]
	readonly absent: readonly string[]
}

/**
 * Builds one module file declaring a `ReadInterface` base and a `StoreInterface` extending it,
 * each member carrying its own `@example` tag.
 *
 * @param member - The member name `StoreInterface` declares beside the inherited `read`
 * @returns The file's source text
 *
 * @example
 * ```ts
 * buildStoreSource('open').includes('\topen(): void') // true
 * ```
 */
export function buildStoreSource(member: string): string {
	return [
		'export interface ReadInterface {',
		'\t/** @example */',
		'\tread(): string',
		'}',
		'export interface StoreInterface extends ReadInterface {',
		'\t/** @example */',
		`\t${member}(): void`,
		'}',
		'',
	].join('\n')
}

/**
 * Reads the example names and the method names one view answers for a store fixture.
 *
 * @remarks
 * The member collection is read before the module-wide one, and the derived name before the
 * declared one, so a reading that answered under another argument's key shows up in the result.
 *
 * @param source - The view to read
 * @returns The names each reading answered with
 *
 * @example
 * ```ts
 * import { Source } from '@src/core'
 *
 * const files = { 'module/types.ts': buildStoreSource('open') }
 * readStoreReadings(new Source({ files, module: 'module' })).store // ['open', 'read']
 * ```
 */
export function readStoreReadings(source: SourceInterface): StoreReadings {
	return {
		member: source.examples('StoreInterface').map((example) => example.name),
		module: source.examples().map((example) => example.name),
		store: source.methods('StoreInterface').map((entry) => entry.name),
		base: source.methods('ReadInterface').map((entry) => entry.name),
		absent: source.methods('AbsentInterface').map((entry) => entry.name),
	}
}
