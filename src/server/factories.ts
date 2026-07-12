import type { SourceInterface } from '../core/index.js'
import type { SourceOptions } from './types.js'
import { Source } from './Source.js'

/**
 * Construct a disk-backed {@link SourceInterface}.
 *
 * @param options - The workspace root and module scope to reflect
 * @returns A `SourceInterface` reading the given module scope off disk
 *
 * @example
 * ```ts
 * const source = createSource({ root: '/repo', module: 'src/core' })
 * ```
 */
export function createSource(options: SourceOptions): SourceInterface {
	return new Source(options)
}
