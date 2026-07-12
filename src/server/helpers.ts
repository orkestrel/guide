import type { ExportKind, GuideModule, SurfaceSymbol } from '../core/index.js'
import { isNonEmptyString } from '@orkestrel/contract'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Narrow a raw regex capture to a valid {@link ExportKind} — the five literal
 * export keywords `exportsFrom` scans for, compared explicitly (no `as`).
 *
 * @param value - The candidate keyword captured from a source line
 * @returns `true` when `value` is one of the five recognized export keywords
 *
 * @example
 * ```ts
 * isExportKind('class') // true
 * isExportKind('let')   // false
 * ```
 */
export function isExportKind(value: string): value is ExportKind {
	return (
		value === 'type' ||
		value === 'interface' ||
		value === 'const' ||
		value === 'function' ||
		value === 'class'
	)
}

/**
 * A module scope normalized to its directory list — a single directory
 * becomes a one-element list so every scanner walks the same shape.
 *
 * @param module - The module scope to normalize
 * @returns The directory list `module` denotes
 *
 * @example
 * ```ts
 * moduleDirs('src/core')                       // ['src/core']
 * moduleDirs(['src/core', 'src/browser'])       // ['src/core', 'src/browser']
 * ```
 */
export function moduleDirs(module: GuideModule): readonly string[] {
	return typeof module === 'string' ? [module] : module
}

/**
 * Read a workspace-relative text file.
 *
 * @param root - The absolute workspace root
 * @param relative - The root-relative file path
 * @returns The file's UTF-8 text contents
 *
 * @example
 * ```ts
 * readText('/repo', 'src/core/types.ts') // '...'
 * ```
 */
export function readText(root: string, relative: string): string {
	return readFileSync(join(root, relative), 'utf8')
}

/**
 * Whether a workspace-relative path exists on disk.
 *
 * @param root - The absolute workspace root
 * @param relative - The root-relative path to check
 * @returns `true` when the path exists
 *
 * @example
 * ```ts
 * pathExists('/repo', 'src/core/types.ts') // true
 * ```
 */
export function pathExists(root: string, relative: string): boolean {
	return existsSync(join(root, relative))
}

/**
 * Recursively collect every source file of one module directory into `files`
 * — `index.ts` and `*.test.ts` are excluded, directories are walked.
 *
 * @param root - The absolute workspace root
 * @param relative - The root-relative directory to walk
 * @param files - The accumulator every discovered file path is pushed onto
 * @returns Nothing — `files` is mutated in place
 *
 * @example
 * ```ts
 * const files: string[] = []
 * collectModuleFiles('/repo', 'src/core', files)
 * ```
 */
export function collectModuleFiles(root: string, relative: string, files: string[]): void {
	for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
		const child = `${relative}/${entry.name}`
		if (entry.isDirectory()) {
			collectModuleFiles(root, child, files)
			continue
		}

		if (!entry.isFile()) continue
		if (!entry.name.endsWith('.ts')) continue
		if (entry.name === 'index.ts' || entry.name.endsWith('.test.ts')) continue
		files.push(child)
	}
}

/**
 * Every source file of a {@link GuideModule} scope, sorted — a single
 * directory walked, or several unioned when the scope spans multiple dirs.
 *
 * @param root - The absolute workspace root
 * @param module - The module scope to walk
 * @returns The scope's file paths, root-relative and sorted
 *
 * @example
 * ```ts
 * moduleFiles('/repo', 'src/core') // ['src/core/Guide.ts', 'src/core/helpers.ts', ...]
 * ```
 */
export function moduleFiles(root: string, module: GuideModule): readonly string[] {
	const files: string[] = []
	for (const dir of moduleDirs(module)) collectModuleFiles(root, dir, files)
	return files.sort()
}

/**
 * The module-scope exports declared in one file's source text — matches
 * `export (async)? (function|class|const|interface|type) Name`, deduped by
 * (kind, name).
 *
 * @param source - The file's source text
 * @returns The file's exported symbols, in file order
 *
 * @example
 * ```ts
 * exportsFrom('export class Markdown {}\n') // [{ name: 'Markdown', kind: 'class' }]
 * ```
 */
export function exportsFrom(source: string): readonly SurfaceSymbol[] {
	const symbols: SurfaceSymbol[] = []
	const seen = new Set<string>()

	for (const line of source.split(/\r?\n/)) {
		const match = line.match(/^export (?:async )?(function|class|const|interface|type) (\w+)/)
		const kind = match?.[1]
		const name = match?.[2]
		if (!isNonEmptyString(kind) || !isNonEmptyString(name) || !isExportKind(kind)) continue

		const key = `${kind} ${name}`
		if (seen.has(key)) continue
		seen.add(key)
		symbols.push({ name, kind })
	}

	return symbols
}

/**
 * A declaration head joined into a single line, plus the index of the line
 * carrying its opening `{` — how a head that oxfmt wrapped across lines
 * (printWidth 100) is matched as if it were written on one.
 */
export interface DeclarationHead {
	/** The joined, space-separated head text. */
	readonly text: string
	/** The index (within the source `lines`) of the line ending in `{`. */
	readonly end: number
}

/**
 * Join the declaration head starting at `start` into one space-separated
 * line, consuming lines until the first that ends with `{`.
 *
 * @param lines - The file's source lines
 * @param start - The index of the head's first line
 * @returns The joined head, or `undefined` when no line opens a body
 *
 * @example
 * ```ts
 * joinHead(['export class X {'], 0) // { text: 'export class X {', end: 0 }
 * ```
 */
export function joinHead(lines: readonly string[], start: number): DeclarationHead | undefined {
	const parts: string[] = []

	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index]
		if (line === undefined) break
		parts.push(index === start ? line.trimEnd() : line.trim())
		if (line.trimEnd().endsWith('{')) return { text: parts.join(' '), end: index }
	}

	return undefined
}

/**
 * The body lines of the named `export class` / `export interface` declaration
 * — everything between the head's opening `{` and the column-0 closing `}` —
 * searched across every file of the module scope.
 *
 * @param root - The absolute workspace root
 * @param module - The module scope to search
 * @param keyword - Whether to look for a `class` or an `interface`
 * @param name - The declaration's identifier
 * @returns The declaration's body lines, or an empty array when no file declares it
 *
 * @example
 * ```ts
 * declarationBody('/repo', 'src/core', 'interface', 'GuideInterface') // ['\tsections(): ...', ...]
 * ```
 */
export function declarationBody(
	root: string,
	module: GuideModule,
	keyword: 'class' | 'interface',
	name: string,
): readonly string[] {
	const opener = `export ${keyword} ${name}`
	const declaration = new RegExp(`^export ${keyword} ${name}(?:<.*>)?(?: .*)? \\{$`)

	for (const file of moduleFiles(root, module)) {
		const lines = readText(root, file).split(/\r?\n/)

		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]
			if (line === undefined || !line.startsWith(opener)) continue

			const head = joinHead(lines, index)
			if (head === undefined || !declaration.test(head.text)) continue

			const body: string[] = []
			for (const member of lines.slice(head.end + 1)) {
				if (member === '}') return body
				body.push(member)
			}

			// Unterminated body — move on to the next candidate file.
			break
		}
	}

	return []
}

/**
 * The member lines declaring a callable member: plain, `async`, generator
 * (`*`), and optional (`records?(`) methods all count; getters, setters,
 * `static` members, and `#` privates never do (their keyword or `#` breaks
 * the `name(` shape).
 *
 * @param lines - A declaration's body lines
 * @returns The declared method names, deduped and sorted
 *
 * @example
 * ```ts
 * memberMethods(['\tmap(): void', '\tfilter(): void']) // ['filter', 'map']
 * ```
 */
export function memberMethods(lines: readonly string[]): readonly string[] {
	const methods: string[] = []

	for (const line of lines) {
		const method = line.match(/^\t(?:async )?\*?(\w+)(<[^>]*>)?\??\(/)
		if (method?.[1] !== undefined) methods.push(method[1])
	}

	return Array.from(new Set(methods)).sort()
}
