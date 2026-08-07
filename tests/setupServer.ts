import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isAbsolute, relative as relativePath, resolve, sep } from 'node:path'

export function readInventory(
	root: URL,
	directories: readonly string[],
	extensions: readonly string[] = [],
): Readonly<Record<string, string>> {
	if (directories.length === 0) return {}
	const supplied = fileURLToPath(root)
	const rootStatus = lstatSync(supplied)
	if (rootStatus.isSymbolicLink()) throw new Error('Root is a symbolic link')
	if (!rootStatus.isDirectory()) throw new Error('Root is not a directory')
	const base = realpathSync.native(supplied)
	const pending: string[] = []
	const queued = new Set<string>()
	const contents = new Map<string, string>()

	for (const directory of directories) {
		const candidate = directory === '.' ? base : resolve(base, directory)
		const requested = relativePath(base, candidate)
		if (requested === '..' || requested.startsWith(`..${sep}`) || isAbsolute(requested)) {
			throw new Error(`Directory outside root: ${directory}`)
		}
		const status = lstatSync(candidate)
		if (status.isSymbolicLink()) throw new Error(`Directory is a symbolic link: ${directory}`)
		if (!status.isDirectory()) throw new Error(`Not a directory: ${directory}`)
		const physical = realpathSync.native(candidate)
		const resolved = relativePath(base, physical)
		if (resolved === '..' || resolved.startsWith(`..${sep}`) || isAbsolute(resolved)) {
			throw new Error(`Directory outside root: ${directory}`)
		}
		if (queued.has(physical)) continue
		queued.add(physical)
		pending.push(physical)
	}

	while (pending.length > 0) {
		const directory = pending.pop()
		if (directory === undefined) continue
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name)
			const status = lstatSync(path)
			if (status.isSymbolicLink()) continue
			if (status.isDirectory()) {
				const physical = realpathSync.native(path)
				const resolved = relativePath(base, physical)
				if (
					resolved === '..' ||
					resolved.startsWith(`..${sep}`) ||
					isAbsolute(resolved) ||
					queued.has(physical)
				) {
					continue
				}
				queued.add(physical)
				pending.push(physical)
				continue
			}
			if (
				!status.isFile() ||
				(extensions.length > 0 && !extensions.some((value) => entry.name.endsWith(value)))
			) {
				continue
			}
			const key = relativePath(base, path).split(sep).join('/')
			if (!contents.has(key)) contents.set(key, readFileSync(path, 'utf8'))
		}
	}

	const files: Record<string, string> = {}
	for (const key of Array.from(contents.keys()).sort()) {
		const value = contents.get(key)
		if (value !== undefined) files[key] = value
	}
	return files
}

export function requireText(files: Readonly<Record<string, string>>, relative: string): string {
	if (Object.hasOwn(files, relative)) {
		const text = files[relative]
		if (text !== undefined) return text
	}
	throw new Error(`Missing file: ${relative}`)
}
