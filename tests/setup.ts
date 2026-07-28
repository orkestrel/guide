// Base test setup — environment-agnostic helpers loaded first by every
// Vitest project (`src:core` / `guides`). `node:fs` is used here for fixture
// loading only — the package's own `src` stays pure; this constraint is on
// package source, not on test helpers.

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// ── Deterministic randomness ──────────────────────────────────────────────────
// The single house seed for tests that need generated/random input (contract
// `.generate(random)` calls, fuzz-style fixtures). Suites call
// `seededRandom(TEST_SEED)` directly to get a fresh, deterministic
// `RandomFunction` — keeping the seed centralized here means every suite that
// wants determinism uses the same starting point.
export const TEST_SEED = 42

// ── Fixture paths ───────────────────────────────────────────────────────────

/** The absolute path to `tests/fixtures` — every fixture helper's root. */
export function fixturesRoot(): string {
	return fileURLToPath(new URL('./fixtures/', import.meta.url))
}

/**
 * Read one fixture file's text content.
 *
 * @param relative - The path relative to `tests/fixtures` (e.g. `'good/guides/src/widget.md'`)
 * @returns The file's UTF-8 text contents
 *
 * @example
 * ```ts
 * readFixture('good/guides/src/widget.md')
 * ```
 */
export function readFixture(relative: string): string {
	return readFileSync(join(fixturesRoot(), relative), 'utf8')
}

/**
 * Recursively collect every file under `${fixturesRoot()}/${prefix}` into
 * `files`, keyed by its path relative to that fixture root.
 *
 * @param root - The absolute directory to walk
 * @param base - The absolute fixture-root directory paths are keyed relative to
 * @param files - The accumulator every discovered file is written into
 */
function collectFixtureFiles(root: string, base: string, files: Record<string, string>): void {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name)
		if (entry.isDirectory()) {
			collectFixtureFiles(path, base, files)
			continue
		}
		if (!entry.isFile()) continue
		const key = path
			.slice(base.length + 1)
			.split('\\')
			.join('/')
		files[key] = readFileSync(path, 'utf8')
	}
}

/**
 * An in-memory file inventory for one fixture package — every file under
 * `tests/fixtures/<prefix>`, keyed by its path relative to that fixture's own
 * root. This is the shape the pure `Source` (file-inventory based, no
 * `node:fs`) consumes; suites build one per fixture and hand it in directly.
 *
 * @param prefix - The fixture package to walk, relative to `tests/fixtures` (e.g. `'good'`)
 * @returns A map of root-relative path to file text
 *
 * @example
 * ```ts
 * fixtureFiles('good')
 * // { 'module/types.ts': '...', 'guides/README.md': '...', 'guides/src/widget.md': '...', 'tests/widget.test.ts': '...' }
 * ```
 */
export function fixtureFiles(prefix: string): Record<string, string> {
	const base = join(fixturesRoot(), prefix)
	const files: Record<string, string> = {}
	collectFixtureFiles(base, base, files)
	return files
}

/** Whether a repository-relative Vue SFC path belongs to the private browser application. */
export function isBrowserVuePath(path: string): boolean {
	const normalized = path.replaceAll('\\', '/')
	return normalized.startsWith('app/browser/')
}
