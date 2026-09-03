import type { TableNode } from '@orkestrel/markdown'
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
 * Require markdown whose first block is a table.
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
