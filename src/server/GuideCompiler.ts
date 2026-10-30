import type { GuideCompilerInterface, GuideCompilerOptions } from './types.js'
import { isNonEmptyString, isRecord, parseJSONAs } from '@orkestrel/contract'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { GuideError } from '@src/core'
import {
	GUIDE_COMPILER_LIMIT,
	GUIDE_COMPILER_TIMEOUT,
	GUIDE_SCRATCH_PREFIX,
	GUIDE_SCRATCH_RETRIES,
} from './constants.js'
import { computeGuideProject, resolveGuideRoot } from './helpers.js'
import { parseCompilerRoot } from './parsers.js'

/**
 * Emits a guide module's declarations through the workspace's own TypeScript compiler, the
 * projection every computed `Signature` cell is read from.
 *
 * @remarks
 * The compiler is the `bin.tsc` entry the workspace root's `node_modules/typescript/package.json`
 * names, run by `process.execPath` with no shell, under a timeout and a per-stream output bound. A
 * module `src/<env>` or `app/<env>` emits through `configs/<layer>/tsconfig.<env>.json` into a fresh
 * scratch directory, with comments removed and LF line endings, and the scratch directory is
 * removed before the call returns or throws. Its path never enters the result, so two compiles of
 * one tree under one compiler return the same text. Every refusal is a `GuideError` whose
 * `context` names the module and project, except that a module outside `src/<env>` and
 * `app/<env>` names the module alone and a workspace with no compiler names its `root`.
 *
 * @param options - The workspace root, the run bounds, and the scratch parent directory
 *
 * @example
 * ```ts
 * import { GuideCompiler } from '@orkestrel/guide/server'
 *
 * const declarations = new GuideCompiler({ root: new URL('../', import.meta.url) }).compile('src/core')
 * declarations['src/core/helpers.d.ts'] // 'export declare function …'
 * ```
 */
export class GuideCompiler implements GuideCompilerInterface {
	readonly #root: string
	readonly #timeout: number
	readonly #limit: number
	readonly #temporary: string | undefined

	constructor(options: GuideCompilerOptions) {
		this.#root = resolveGuideRoot(options.root)
		this.#timeout = options.timeout ?? GUIDE_COMPILER_TIMEOUT
		this.#limit = options.limit ?? GUIDE_COMPILER_LIMIT
		this.#temporary = options.temporary
	}

	/**
	 * Emits the declarations of one `src/<env>` or `app/<env>` module through its scoped project.
	 *
	 * @param module - The workspace-relative module directory, `src/<env>` or `app/<env>`
	 * @returns The emitted declaration text keyed by workspace-relative `.d.ts` path, sorted by key
	 * @throws `GuideError` with code `compile` when the module is outside `src/<env>` and
	 * `app/<env>`, the workspace installs no TypeScript compiler, the project declares no
	 * `rootDir`, or the compiler exits non-zero; `empty` when the project emits no declaration under
	 * the module; `timeout` when a run passes the timeout; and `overflow` when a run passes the output
	 * bound
	 *
	 * @example
	 * ```ts
	 * compiler.compile('src/core')['src/core/types.d.ts'] // 'export type …'
	 * ```
	 */
	compile(module: string): Readonly<Record<string, string>> {
		const project = computeGuideProject(module)
		if (project === undefined) {
			throw new GuideError(
				`${JSON.stringify(module.slice(0, 200))} is outside src/<env> and app/<env>; a guide module compiles through configs/<layer>/tsconfig.<env>.json, such as configs/src/tsconfig.core.json for src/core.`,
				'compile',
				{ context: { module: module.slice(0, 200) } },
			)
		}
		const compiler = this.#locate()
		const path = resolve(this.#root, project)
		const root = parseCompilerRoot(
			this.#run(module, project, compiler, ['--showConfig', '-p', path]),
		)
		if (root === undefined) {
			throw new GuideError(
				`${JSON.stringify(module)} compiles through ${project}, which declares no rootDir.`,
				'compile',
				{ context: { module, project } },
			)
		}
		const base = resolve(dirname(path), root)
		const scratch = mkdtempSync(join(this.#temporary ?? tmpdir(), GUIDE_SCRATCH_PREFIX))
		try {
			this.#run(module, project, compiler, [
				'-p',
				path,
				'--declaration',
				'--emitDeclarationOnly',
				'--noEmit',
				'false',
				'--declarationMap',
				'false',
				'--removeComments',
				'--newLine',
				'lf',
				'--outDir',
				scratch,
			])
			const entries = readdirSync(scratch, { recursive: true, encoding: 'utf8' })
				.filter((file) => file.endsWith('.d.ts'))
				.map((file) => ({
					key: relative(this.#root, resolve(base, file)).split(sep).join('/'),
					file,
				}))
				.filter((entry) => entry.key.startsWith(`${module}/`))
				.sort((left, right) => (left.key === right.key ? 0 : left.key < right.key ? -1 : 1))
			if (entries.length === 0) {
				throw new GuideError(
					`${JSON.stringify(module)} emitted no declaration under ${module} through ${project}; the project's include must cover ${module} and its declarations must emit into --outDir, with no declarationDir.`,
					'empty',
					{ context: { module, project } },
				)
			}
			const declarations = Object.freeze(
				Object.fromEntries(
					entries.map((entry) => [entry.key, readFileSync(join(scratch, entry.file), 'utf8')]),
				),
			)
			rmSync(scratch, { recursive: true, force: true, maxRetries: GUIDE_SCRATCH_RETRIES })
			return declarations
		} catch (error) {
			try {
				rmSync(scratch, { recursive: true, force: true, maxRetries: GUIDE_SCRATCH_RETRIES })
			} catch {
				// The compile error answers for this call; a removal failure must not replace it.
			}
			throw error
		}
	}

	// The workspace root's own compiler entry, named by its installed manifest's `bin.tsc`.
	#locate(): string {
		const manifest = join(this.#root, 'node_modules', 'typescript', 'package.json')
		const declared = existsSync(manifest)
			? parseJSONAs(readFileSync(manifest, 'utf8'), isRecord)
			: undefined
		const bin = declared?.bin
		const entry = isRecord(bin) ? bin.tsc : undefined
		if (!isNonEmptyString(entry)) {
			throw new GuideError(
				`The workspace at ${JSON.stringify(this.#root)} installs no TypeScript compiler; node_modules/typescript/package.json names no bin.tsc entry.`,
				'compile',
				{ context: { root: this.#root } },
			)
		}
		return resolve(dirname(manifest), entry)
	}

	#run(module: string, project: string, compiler: string, args: readonly string[]): string {
		const result = spawnSync(process.execPath, [compiler, ...args], {
			cwd: this.#root,
			encoding: 'utf8',
			maxBuffer: this.#limit,
			timeout: this.#timeout,
			windowsHide: true,
		})
		const code: unknown = result.error === undefined ? undefined : Reflect.get(result.error, 'code')
		if (code === 'ETIMEDOUT') {
			throw new GuideError(
				`${JSON.stringify(module)} did not compile through ${project} within ${this.#timeout} ms; the compiler was stopped at the timeout.`,
				'timeout',
				{ context: { module, project, timeout: this.#timeout } },
			)
		}
		if (code === 'ENOBUFS') {
			throw new GuideError(
				`${JSON.stringify(module)} wrote more than ${this.#limit} bytes of compiler output to one stream through ${project}; the compiler was stopped at the output bound.`,
				'overflow',
				{ context: { module, project, limit: this.#limit } },
			)
		}
		if (result.error !== undefined || result.status !== 0) {
			const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`
			throw new GuideError(
				`${JSON.stringify(module)} does not compile through ${project}:\n${output}`,
				'compile',
				{ context: { module, project, output } },
			)
		}
		return result.stdout
	}
}
