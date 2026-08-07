import type { TableNode } from '@orkestrel/markdown'
import { parseDocument } from '@orkestrel/markdown'

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

/** Whether a repository-relative Vue SFC path belongs to the private browser application. */
export function isBrowserVuePath(path: string): boolean {
	const normalized = path.replaceAll('\\', '/')
	return normalized.startsWith('app/browser/')
}
