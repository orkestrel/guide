import type { SpawnSyncReturns } from 'node:child_process'
import type { DistributionStage } from './setupDistribution.js'
import { parseSync } from 'vite'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
	DISTRIBUTION_RUNTIME_CONDITIONS,
	readDistributionOutput,
	resolveDistributionTarget,
	runDistributionNode,
	writeDistributionFile,
} from './setupDistribution.js'

/** Holds the canonical Guide workspace root. */
export const GUIDE_ROOT = fileURLToPath(new URL('../', import.meta.url))

/** Holds the installed TypeScript package a fixture workspace links as its own compiler. */
export const TYPESCRIPT_ROOT = resolve(GUIDE_ROOT, 'node_modules', 'typescript')

/** Holds a fixture workspace's scoped core project, with this checkout's emit settings. */
export const COMPILER_PROJECT = `${JSON.stringify(
	{
		compilerOptions: {
			target: 'ESNext',
			module: 'ESNext',
			moduleResolution: 'bundler',
			lib: ['ESNext'],
			types: [],
			strict: true,
			exactOptionalPropertyTypes: true,
			noUnusedLocals: true,
			noUnusedParameters: true,
			skipLibCheck: true,
			noEmit: false,
			declaration: true,
			emitDeclarationOnly: true,
			rootDir: '../../src/core',
			outDir: '../../dist/src/core',
		},
		include: ['../../src/core/**/*.ts'],
	},
	null,
	'\t',
)}\n`

/** Holds a fixture workspace's scoped server project, with this checkout's emit settings. */
export const SERVER_PROJECT = COMPILER_PROJECT.replaceAll('src/core', 'src/server')

/**
 * Holds the files of a fixture `node_modules/typescript` package whose `bin.tsc` entry appends its
 * arguments to `node_modules/typescript/calls.log` and runs this checkout's installed compiler with
 * them, so a proof counts the compiler runs a command makes.
 */
export const RECORDER_COMPILER: Readonly<Record<string, string>> = Object.freeze({
	'node_modules/typescript/package.json':
		'{ "name": "typescript", "type": "module", "bin": { "tsc": "./bin/tsc.js" } }\n',
	'node_modules/typescript/bin/tsc.js': [
		"import { spawnSync } from 'node:child_process'",
		"import { appendFileSync } from 'node:fs'",
		'',
		"appendFileSync(new URL('../calls.log', import.meta.url), `${JSON.stringify(process.argv.slice(2))}\\n`)",
		`const result = spawnSync(process.execPath, [${JSON.stringify(resolve(TYPESCRIPT_ROOT, 'bin', 'tsc'))}, ...process.argv.slice(2)], { stdio: 'inherit' })`,
		'process.exit(result.status ?? 1)',
		'',
	].join('\n'),
})

/**
 * Holds a fixture workspace whose one manifest entry spans `src/core` and `src/server`, each of
 * which exports `function openWidget`.
 */
export const COLLISION_FIXTURE: Readonly<Record<string, string>> = Object.freeze({
	'package.json': '{ "name": "@scope/fixture", "type": "module" }\n',
	'configs/src/tsconfig.core.json': COMPILER_PROJECT,
	'configs/src/tsconfig.server.json': SERVER_PROJECT,
	'src/core/index.ts': "export * from './widgets.js'\n",
	'src/core/widgets.ts': [
		'/**',
		' * Opens a widget by name.',
		' */',
		'export function openWidget(name: string): boolean {',
		'\treturn name.length > 0',
		'}',
		'',
	].join('\n'),
	'src/server/index.ts': "export * from './widgets.js'\n",
	'src/server/widgets.ts': [
		'/**',
		' * Opens a widget by name.',
		' */',
		'export function openWidget(name: string): boolean {',
		'\treturn name.length > 1',
		'}',
		'',
	].join('\n'),
	'guides/README.md': [
		'## By concept',
		'',
		'| Concept | Spec | Source | Tests |',
		'| --- | --- | --- | --- |',
		'| Widget | [Widget](widget.md) | [Core](../src/core)<br>[Server](../src/server) | [Tests](../tests) |',
		'',
	].join('\n'),
	'guides/widget.md': [
		'## Surface',
		'',
		'| Name | Kind | Signature | Summary |',
		'| --- | --- | --- | --- |',
		'| `openWidget` | function | `(name: string) => boolean` | Opens a widget by name. |',
		'',
	].join('\n'),
})

/** Holds the collision fixture's control, whose server module exports its own distinct name. */
export const DISTINCT_FIXTURE: Readonly<Record<string, string>> = Object.freeze({
	...COLLISION_FIXTURE,
	'src/server/widgets.ts': [
		'/**',
		' * Serves a widget by name.',
		' */',
		'export function serveWidget(name: string): boolean {',
		'\treturn name.length > 1',
		'}',
		'',
	].join('\n'),
	'guides/widget.md': [
		'## Surface',
		'',
		'| Name | Kind | Signature | Summary |',
		'| --- | --- | --- | --- |',
		'| `openWidget` | function | `(name: string) => boolean` | Opens a widget by name. |',
		'| `serveWidget` | function | `(name: string) => boolean` | Serves a widget by name. |',
		'',
	].join('\n'),
})

/**
 * Holds the driver that loads every packed copy of the root entry — the installed `import` and
 * `require` entries and a copy of the installed files at a second path — and writes, as JSON,
 * whether their `GuideError` constructors are pairwise distinct, whether the brand is hidden, and
 * each copy's guard reading of every copy's branded error, subclass error, look-alike, proxy, and
 * brand-only object.
 */
export const GUIDE_DISTRIBUTION_ERROR_SOURCE = [
	"import { createRequire } from 'node:module'",
	'',
	'const [name, copied, required] = process.argv.slice(2)',
	"const load = createRequire(new URL('./package.json', import.meta.url))",
	'const copies = [await import(name), load(name), await import(copied), load(required)]',
	"const brand = Symbol.for('@orkestrel/guide.GuideError')",
	'const checks = copies.flatMap((owner) => {',
	"\tconst error = new owner.GuideError('Refused header', 'header', { context: { table: 1 } })",
	'\tclass Derived extends owner.GuideError {}',
	"\tconst subclass = new Derived('Refused collision', 'collision')",
	'\tclass Lookalike extends Error {',
	"\t\tcode = 'header'",
	'\t}',
	'\tconst plain = {}',
	'\tObject.defineProperty(plain, brand, { value: plain })',
	'\treturn copies.map((reader) => ({',
	'\t\tcross: reader.isGuideError(error),',
	'\t\tsubclass: reader.isGuideError(subclass),',
	"\t\tlookalike: reader.isGuideError(new Lookalike('look-alike')),",
	'\t\tproxy: reader.isGuideError(new Proxy(error, {})),',
	'\t\tplain: reader.isGuideError(plain),',
	'\t}))',
	'})',
	"const descriptor = Object.getOwnPropertyDescriptor(new copies[0].GuideError('Refused', 'header'), brand)",
	'process.stdout.write(',
	'\tJSON.stringify({',
	'\t\tdistinct: new Set(copies.map((entry) => entry.GuideError)).size === copies.length,',
	'\t\thidden: descriptor?.enumerable === false && descriptor?.writable === false,',
	'\t\tchecks,',
	'\t}),',
	')',
	'',
].join('\n')

/**
 * Reads every packed copy's guard over every copy's errors through
 * {@link GUIDE_DISTRIBUTION_ERROR_SOURCE}, after copying the installed package to a second path.
 *
 * @param stage - The installed consumer
 * @returns The driver's parsed JSON reading
 * @throws When the root entry answers no `import` or `require` target, or the driver fails
 */
export function readGuideDistributionErrors(stage: DistributionStage): unknown {
	const entry = stage.entries.find((candidate) => candidate.subpath === '.')
	const imported = resolveDistributionTarget(entry?.mapping, DISTRIBUTION_RUNTIME_CONDITIONS.module)
	const required = resolveDistributionTarget(
		entry?.mapping,
		DISTRIBUTION_RUNTIME_CONDITIONS.commonjs,
	)
	if (entry === undefined || imported === undefined || required === undefined) {
		throw new Error('The installed root entry answers no import and require target')
	}
	const copy = join(stage.consumer, 'copy')
	cpSync(stage.installed, copy, { recursive: true })
	const driver = join(stage.consumer, 'guide-errors.mjs')
	writeDistributionFile(driver, GUIDE_DISTRIBUTION_ERROR_SOURCE)
	const result = runDistributionNode(
		[driver, entry.specifier, pathToFileURL(join(copy, imported)).href, join(copy, required)],
		stage.consumer,
	)
	if (result.status !== 0) throw new Error(readDistributionOutput(result))
	const reading: unknown = JSON.parse(result.stdout)
	return reading
}

/**
 * Reads the built server entry the native-command cases load, refusing a build older than the
 * sources it was built from.
 *
 * @param root - The workspace root whose `dist/src` build and `src` sources are compared
 * @returns The file URL of `dist/src/server/index.js`
 * @throws When the entry is absent, or when a file under `src` is newer than the oldest file under
 * `dist/src`, naming each newer source and the rebuild
 */
export function readGuideBuild(root: string): string {
	const output = resolve(root, 'dist', 'src')
	const entry = resolve(output, 'server', 'index.js')
	if (!existsSync(entry)) {
		throw new Error(
			'dist/src/server/index.js is absent; run npm run build before the native-command cases.',
		)
	}
	const built = Math.min(
		...readdirSync(output, { recursive: true, encoding: 'utf8' })
			.map((file) => statSync(resolve(output, file)))
			.filter((stats) => stats.isFile())
			.map((stats) => stats.mtimeMs),
	)
	const sources = resolve(root, 'src')
	const stale = readdirSync(sources, { recursive: true, encoding: 'utf8' })
		.filter((file) => {
			const stats = statSync(resolve(sources, file))
			return stats.isFile() && stats.mtimeMs > built
		})
		.map((file) => `src/${file.replaceAll('\\', '/')}`)
		.sort()
	if (stale.length > 0) {
		throw new Error(
			`The build under dist/src is older than ${stale.join(', ')}; run npm run build before the native-command cases.`,
		)
	}
	return pathToFileURL(entry).href
}

/** Holds a fixture workspace declaring one source per signature form under `src/core`. */
export const COMPILER_FIXTURE: Readonly<Record<string, string>> = Object.freeze({
	'package.json': '{ "name": "@scope/fixture", "type": "module" }\n',
	'configs/src/tsconfig.core.json': COMPILER_PROJECT,
	'src/core/index.ts': [
		"export * from './types.js'",
		"export * from './functions.js'",
		"export * from './Widget.js'",
		"export * from './WidgetError.js'",
		"export * from './WidgetBox.js'",
		"export * from './constants.js'",
		'',
	].join('\n'),
	'src/core/types.ts': [
		'export interface WidgetInterface {',
		'\treadonly name: string',
		'\treadonly label?: string',
		'\topen(): boolean',
		'\tresize(size: number): void',
		'\tresize(width: number, height: number): void',
		'}',
		'',
		'export interface WidgetOptions {',
		'\treadonly name: string',
		'}',
		'',
		'export interface WidgetLookup {',
		'\t(name: string): WidgetInterface | undefined',
		'\treadonly [name: string]: unknown',
		'}',
		'',
		'export type WidgetRecord = {',
		'\treadonly id: string',
		'\treadonly size: number',
		'}',
		'',
		'export type WidgetPath = `widgets/${string}`',
		'',
	].join('\n'),
	'src/core/functions.ts': [
		"import type { WidgetOptions } from './types.js'",
		'',
		'export function openWidget(name: string): boolean {',
		'\treturn name.length > 0',
		'}',
		'',
		'export function findWidget(id: string): boolean',
		'export function findWidget(ids: readonly string[]): boolean',
		'export function findWidget(input: string | readonly string[]): boolean {',
		'\treturn input.length > 0',
		'}',
		'',
		'export function firstWidget<T extends WidgetOptions>(widgets: readonly T[]): T | undefined {',
		'\treturn widgets[0]',
		'}',
		'',
	].join('\n'),
	'src/core/Widget.ts': [
		"import type { WidgetInterface, WidgetOptions } from './types.js'",
		'',
		'export class Widget implements WidgetInterface {',
		'\treadonly name: string',
		'\t#opened = false',
		'',
		'\tconstructor(options: WidgetOptions) {',
		'\t\tthis.name = options.name',
		'\t}',
		'',
		'\topen(): boolean {',
		'\t\tthis.#opened = true',
		'\t\treturn this.#opened',
		'\t}',
		'',
		'\tresize(size: number): void',
		'\tresize(width: number, height: number): void',
		'\tresize(..._sizes: number[]): void {}',
		'}',
		'',
	].join('\n'),
	'src/core/WidgetError.ts': [
		'export class WidgetError extends Error {',
		'\treadonly code: string',
		'',
		'\tconstructor(message: string, code: string) {',
		'\t\tsuper(message)',
		'\t\tthis.code = code',
		'\t}',
		'}',
		'',
	].join('\n'),
	'src/core/WidgetBox.ts': [
		'export class WidgetBox<T> {',
		'\treadonly items: readonly T[] = []',
		'}',
		'',
	].join('\n'),
	'src/core/constants.ts': [
		'export const WIDGET_LIMITS = { size: 3, depth: 2 } as const',
		"export const WIDGET_LABEL: string = 'widget'",
		"export const WIDGET_KIND = 'widget'",
		'',
	].join('\n'),
})

/** Holds a fixture workspace whose guide documents one function with a stale signature. */
export const NATIVE_FIXTURE: Readonly<Record<string, string>> = Object.freeze({
	'package.json': '{ "name": "@scope/fixture", "type": "module" }\n',
	'configs/src/tsconfig.core.json': COMPILER_PROJECT,
	'src/core/index.ts': "export * from './widgets.js'\n",
	'src/core/widgets.ts': [
		'/**',
		' * Opens a widget by name.',
		' */',
		'export function openWidget(name: string): boolean {',
		'\treturn name.length > 0',
		'}',
		'',
	].join('\n'),
	'guides/README.md': [
		'## By concept',
		'',
		'| Concept | Spec | Source | Tests |',
		'| --- | --- | --- | --- |',
		'| Widget | [Widget](widget.md) | [Source](../src/core) | [Tests](../tests) |',
		'',
	].join('\n'),
	'guides/widget.md': [
		'## Surface',
		'',
		'| Name | Kind | Signature | Summary |',
		'| --- | --- | --- | --- |',
		'| `openWidget` | function | `(name: number) => boolean` | Opens a widget by name. |',
		'',
	].join('\n'),
})

/**
 * Runs a native Guide command carrier in an isolated process against this checkout's built server
 * entry, which {@link readGuideBuild} resolves and refuses when stale.
 *
 * @param source - The real runner setup to insert into the shared carrier
 * @param options - The workspace root and module map the command reads, and the arguments the
 * child receives. Default: this checkout, its own two modules, and no arguments.
 * @returns The completed native process result
 */
export function runNativeGuide(
	source: string,
	options?: {
		readonly root?: string
		readonly modules?: Readonly<Record<string, string | readonly string[]>>
		readonly args?: readonly string[]
	},
): SpawnSyncReturns<string> {
	const build = readGuideBuild(GUIDE_ROOT)
	const entry = resolve(GUIDE_ROOT, 'tests', `.guide-command-${randomUUID()}.ts`)
	const root =
		options?.root === undefined ? "new URL('../', import.meta.url)" : JSON.stringify(options.root)
	const modules = JSON.stringify(
		options?.modules ?? { '@orkestrel/guide': ['src/core', 'src/server'] },
	)
	writeFileSync(
		entry,
		`import { GuideCommand } from ${JSON.stringify(build)}
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

const events = []
const root = ${root}
const modules = ${modules}
${source}
const command = new GuideCommand({
	root,
	patterns: ['src/**/*.ts', 'tests/**/*.ts', 'guides/*.md', '*.md'],
	modules,
	languages: ['ts'],
	language: 'ts',
	reader: readInventory,
	runner,
})
await command.execute(async () => {})
process.stdout.write(JSON.stringify({ events, exitCode: process.exitCode ?? 0 }) + '\\n')
`,
	)
	try {
		return spawnSync(
			process.execPath,
			['--experimental-strip-types', entry, ...(options?.args ?? [])],
			{
				cwd: GUIDE_ROOT,
				encoding: 'utf8',
				env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'VITEST')),
				timeout: 30_000,
				windowsHide: true,
			},
		)
	} finally {
		unlinkSync(entry)
	}
}

export class ChangingResult {
	#reads = 0

	get testModules(): ReadonlyArray<{ readonly state: () => string }> {
		this.#reads += 1
		return this.#reads === 1 ? [new ResultModule('failed')] : []
	}

	get unhandledErrors(): readonly unknown[] {
		return []
	}

	get reads(): number {
		return this.#reads
	}
}

export function readParsedSummaries(source: string): ReadonlyMap<string, string> {
	const parsed = parseSync('control.ts', source)
	const summaries = new Map<string, string>()

	for (const statement of parsed.program.body) {
		if (statement.type !== 'ExportNamedDeclaration') continue
		const declaration = statement.declaration
		if (declaration === null || declaration === undefined) continue

		const names =
			declaration.type === 'VariableDeclaration'
				? declaration.declarations.map((entry) =>
						entry.id.type === 'Identifier' ? entry.id.name : '',
					)
				: declaration.type === 'FunctionDeclaration' ||
					  declaration.type === 'TSDeclareFunction' ||
					  declaration.type === 'ClassDeclaration' ||
					  declaration.type === 'TSInterfaceDeclaration' ||
					  declaration.type === 'TSTypeAliasDeclaration'
					? [declaration.id?.name ?? '']
					: []

		const preceding = parsed.comments.filter(
			(comment) =>
				comment.type === 'Block' &&
				comment.value.startsWith('*') &&
				comment.end <= statement.start &&
				source.slice(comment.end, statement.start).trim() === '',
		)
		const attached = preceding[preceding.length - 1]
		if (attached === undefined) continue

		// The control's own unwrapping, deliberately independent of the reader's.
		const body = attached.value
			.replace(/^\*/, '')
			.split('\n')
			.map((line) => line.replace(/^\s*\*\s?/, ''))
			.join('\n')
		const tag = body.search(/(?:^|\n)@\w/)
		const description = (tag < 0 ? body : body.slice(0, tag)).replace(/\s+/g, ' ').trim()

		// An overload set declares one name several times; the first declaration
		// answers for it, which is the reader's rule too.
		for (const name of names) {
			if (name.length === 0 || summaries.has(name)) continue
			if (description.length > 0) summaries.set(name, description)
		}
	}

	return summaries
}

export class ResultModule {
	readonly extra = 'retained'
	readonly #status: string

	constructor(status: string) {
		this.#status = status
	}

	state(): string {
		return this.#status
	}
}
