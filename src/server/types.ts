import type { GuideModule, ParityResult, ParityRow } from '../core/types.js'

/**
 * Reads a workspace inventory through the consumer's host reader.
 *
 * @param root - The workspace root as a file URL or native path
 * @param targets - The root-relative files or directories to read
 * @returns The root-relative, forward-slash path-to-text inventory
 * @throws When the host cannot read a requested target. A native rewrite reports the error and
 * raises the process exit status; a worker inventory error rejects `execute`.
 */
export type GuideReadFunction = (
	root: URL | string,
	targets: readonly string[],
) => Readonly<Record<string, string>>

/**
 * Defines the fixed guides-project runner invocation.
 */
export interface GuideRunnerOptions {
	/** Holds the resolved native workspace root. */
	readonly root: string
	/** Names the resolved native Vite configuration path. */
	readonly config: string
	/** Selects the guides project. */
	readonly project: 'guides'
	/** Selects the dot reporter. */
	readonly reporters: 'dot'
	/** Disables the external runner's cache. */
	readonly cache: false
	/** Disables watch mode. */
	readonly watch: false
}

/**
 * Creates a foreign guides-project runner whose consumed members Guide validates before use.
 *
 * @param mode - The fixed external runner mode
 * @param options - The narrow guides-project options
 * @returns The foreign runner value, whose consumed lifecycle members Guide validates
 * @throws When runner creation fails. The native command reports the error and raises the process
 * exit status before `execute` resolves.
 */
export type GuideRunnerFunction = (mode: 'test', options: GuideRunnerOptions) => Promise<unknown>

/**
 * Supplies fresh owned inventory, joined rows, and its generic parity result to package assertion
 * setup.
 */
export interface GuideCommandContext {
	/** Holds the resolved native workspace root. */
	readonly root: string
	/** Holds the owned root-relative, forward-slash path-to-text inventory. */
	readonly files: Readonly<Record<string, string>>
	/** Lists the manifest rows joined to parsed guide and source views. */
	readonly rows: readonly ParityRow[]
	/** Holds the generic parity result over the same fresh inventory. */
	readonly report: ParityResult
}

/**
 * Registers package assertions against the fresh worker context.
 *
 * @param context - The resolved root, owned inventory, joined rows, and parity result
 * @returns A promise that resolves after assertion registration finishes
 * @throws When package assertion registration fails
 */
export type GuideCommandHandler = (context: GuideCommandContext) => Promise<void>

/**
 * Configures workspace policy and direct host ports for the reusable command.
 */
export interface GuideCommandOptions {
	/** Names the workspace root as a file URL or native path. */
	readonly root: URL | string
	/** Lists the inventory globs the command expands from the workspace root. */
	readonly patterns: readonly string[]
	/** Maps each self import specifier to the source scope it exposes. */
	readonly modules: Readonly<Record<string, GuideModule>>
	/** Lists every fence language the package admits. */
	readonly languages: readonly string[]
	/** Names the fence language inspected for examples and self imports. */
	readonly language: string
	/**
	 * Supplies the host inventory reader directly. Native rewrite failures are reported through
	 * stderr and exit status; worker inventory failures reject `execute`.
	 */
	readonly reader: GuideReadFunction
	/**
	 * Supplies the external guides-project runner factory directly. Creation, start, validation, and
	 * cleanup failures are reported through native stderr and exit status before `execute` resolves.
	 */
	readonly runner: GuideRunnerFunction
}

/**
 * Represents the server command's native and worker behavior.
 */
export interface GuideCommandInterface {
	/**
	 * Runs the native command or registers package assertions with fresh worker inventory and parity.
	 *
	 * @param register - The package-owned assertion registration callback
	 * @returns A promise that resolves after the selected command path finishes
	 * @throws When worker inventory reading or package assertion registration fails. Native failures
	 * are reported through stderr and process exit status before this promise resolves.
	 */
	execute(register: GuideCommandHandler): Promise<void>
}
