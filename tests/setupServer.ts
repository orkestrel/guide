import { requireValue } from '@orkestrel/test'

/**
 * Look one inventory key up and require it to be present.
 *
 * A named composition over `@orkestrel/test`'s `requireValue`, kept because this
 * package's tests perform the lookup dozens of times and the two-argument form reads
 * better at those call sites than repeating the subscript and the message.
 *
 * @param files - The inventory to read
 * @param relative - The root-relative key that must be present
 * @returns The file's text
 */
export function requireText(files: Readonly<Record<string, string>>, relative: string): string {
	return requireValue(files[relative], `Missing file: ${relative}`)
}
