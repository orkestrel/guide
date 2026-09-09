import type { ManifestEntry, ParityFinding } from '../core/types.js'
import { isArray, isFunction, isObject } from '@orkestrel/contract'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Formats one finding with its guide prefix when needed.
 *
 * @param finding - The finding to format
 * @returns The finding text with its spec prefix when the text does not already carry it
 *
 * @example
 * ```ts
 * formatGuideFinding({ spec: 'guides/widget.md', text: 'missing export' })
 * ```
 */
export function formatGuideFinding(finding: ParityFinding): string {
	const spec = finding.spec
	const prefix = spec === undefined || finding.text.startsWith(spec) ? '' : `${spec} `
	return `${prefix}${finding.text}`
}

/**
 * Reads an owned foreign result view and accepts passed modules without unhandled errors.
 *
 * @param result - The unknown external runner result to inspect
 * @returns True if a module is present, every module passed, and no unhandled error exists; false otherwise
 *
 * @example
 * ```ts
 * matchesGuideResult({ testModules: [{ state: () => 'passed' }], unhandledErrors: [] })
 * ```
 */
export function matchesGuideResult(result: unknown): boolean {
	if (!isObject(result)) return false
	const testModules = Reflect.get(result, 'testModules')
	const unhandledErrors = Reflect.get(result, 'unhandledErrors')
	if (!isArray(testModules) || !isArray(unhandledErrors)) return false
	const modules = [...testModules]
	const errors = [...unhandledErrors]
	if (modules.length === 0 || errors.length > 0) return false
	for (const module of modules) {
		if (!isObject(module)) return false
		const state = Reflect.get(module, 'state')
		if (!isFunction(state) || Reflect.apply(state, module, []) !== 'passed') return false
	}
	return true
}

/**
 * Resolves a command root to a native absolute path.
 *
 * @param root - The workspace root as a file URL or native path
 * @returns The native absolute workspace path
 *
 * @example
 * ```ts
 * resolveGuideRoot('/workspace')
 * ```
 */
export function resolveGuideRoot(root: URL | string): string {
	return resolve(root instanceof URL ? fileURLToPath(root) : root)
}

/**
 * Selects the indexed guide matching a package's bare name.
 *
 * @param entries - The concept-index entries to search
 * @param name - The package's bare name, or `undefined` when none was parsed
 * @returns The indexed own-guide path, or `undefined` when the index carries none
 *
 * @example
 * ```ts
 * selectGuidePitch([{ concept: 'Widget', spec: 'guides/widget.md', source: 'src', tests: 'tests' }], 'widget')
 * ```
 */
export function selectGuidePitch(
	entries: readonly ManifestEntry[],
	name: string | undefined,
): string | undefined {
	if (name === undefined) return undefined
	const spec = `guides/${name}.md`
	return entries.some((entry) => entry.spec === spec) ? spec : undefined
}
