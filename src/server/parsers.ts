import type { ParityDirection } from '../core/types.js'
import { isNonEmptyString, isRecord, parseEnum, parseJSONAs } from '@orkestrel/contract'

/**
 * Maps the supported `--to guide` and `--to source` arguments to an explicit rewrite destination.
 *
 * @param args - The arguments after the native command entry
 * @returns The requested destination, or `undefined` when the shape is unsupported
 *
 * @example
 * ```ts
 * parseGuideDirection(['--to', 'guide'])
 * ```
 */
export function parseGuideDirection(args: readonly string[]): ParityDirection | undefined {
	if (args.length !== 2 || args[0] !== '--to') return undefined
	return parseEnum(args[1], ['guide', 'source'])
}

/**
 * Reads the bare package name from package manifest JSON.
 *
 * @param manifest - The package manifest JSON text
 * @returns The name after its final scope separator, or `undefined` when no name is declared
 *
 * @example
 * ```ts
 * parsePackageName('{"name":"@scope/widget"}')
 * ```
 */
export function parsePackageName(manifest: string): string | undefined {
	const parsed = parseJSONAs(manifest, isRecord)
	if (parsed === undefined) return undefined
	const name = parsed.name
	if (!isNonEmptyString(name)) return undefined
	return name.slice(name.lastIndexOf('/') + 1)
}
