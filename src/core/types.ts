/**
 * The declaration kind a documented / exported symbol carries — the half of the
 * bijection key (alongside its name) a `## Surface` table's `Kind` column encodes.
 */
export type ExportKind = 'type' | 'interface' | 'const' | 'function' | 'class'

/**
 * One documented / exported symbol — its identifier plus its declaration kind.
 */
export interface SurfaceSymbol {
	/** Its identifier. */
	readonly name: string
	/** Its declaration kind — half of the bijection key alongside {@link name}. */
	readonly kind: ExportKind
}

/**
 * The source scope a guide's manifest entry covers — one module directory, or
 * several when a layer guide spans multiple source directories (a core module
 * plus its backend implementations).
 */
export type GuideModule = string | readonly string[]

/**
 * One `## By concept` manifest row — a single guides-parity check target, paths
 * normalized to workspace root.
 */
export interface ManifestEntry {
	/** The concept name — the row's first cell, flattened. */
	readonly concept: string
	/** The guide `.md` this entry documents, root-relative. */
	readonly spec: string
	/** The source directory (or directories) the guide documents. */
	readonly source: GuideModule
	/** The tests directory the guide's `## Tests` links resolve against. */
	readonly tests: string
}

/**
 * One `#### \`Interface\`` block in a guide's `## Methods` section — the
 * documented member names of one behavioral interface.
 */
export interface MethodGroup {
	/** The backticked interface name. */
	readonly interface: string
	/** Its documented Method-cell identifiers, in table order. */
	readonly methods: readonly string[]
}

/**
 * The structured, pure view of one parsed guide — every projection extracted and
 * cached once at construction (see {@link createGuide}).
 */
export interface GuideInterface {
	/** The `##` heading names, in document order — the non-vacuousness guard for section presence. */
	sections(): readonly string[]
	/** Every `## Surface` identifier + kind — table rows union backticked entity headings. */
	surface(): readonly SurfaceSymbol[]
	/** One {@link MethodGroup} per documented behavioral interface in `## Methods`. */
	methods(): readonly MethodGroup[]
	/**
	 * Every link href in the guide, including table cells.
	 *
	 * @example
	 * ```ts
	 * guide.links() // ['../../src/core/helpers.ts']
	 * ```
	 */
	links(): readonly string[]
	/**
	 * The relative test links declared under `## Tests`.
	 *
	 * @example
	 * ```ts
	 * guide.tests() // ['../../tests/src/core/Guide.test.ts']
	 * ```
	 */
	tests(): readonly string[]
	/**
	 * Every fenced `ts` code block's body text, whole document.
	 *
	 * @example
	 * ```ts
	 * guide.patterns() // ["import { createGuide } from '@orkestrel/guide'"]
	 * ```
	 */
	patterns(): readonly string[]
}

/**
 * The reflected source truth a guide's documented surface is checked against —
 * a pure view over a consumer-supplied file inventory (see {@link Source}).
 */
export interface SourceInterface {
	/** Every module-scope export, including type-only, by (name, kind). */
	exports(): readonly SurfaceSymbol[]
	/** The call-signature members of the `class` / `interface` named `name`. */
	methods(name: string): readonly string[]
	/** Whether a workspace-root-relative path exists in the inventory. */
	exists(relative: string): boolean
	/**
	 * Every module-scope declaration LACKING the `export` keyword (AGENTS §5's
	 * export-discipline reflection) — empty on a conforming module.
	 *
	 * @example
	 * ```ts
	 * source.hidden() // []
	 * ```
	 */
	hidden(): readonly SurfaceSymbol[]
	/**
	 * The names of every exported function whose preceding JSDoc carries `@example`.
	 *
	 * @example
	 * ```ts
	 * source.examples() // ['createGuide', 'createSource']
	 * ```
	 */
	examples(): readonly string[]
	/**
	 * The members of the `class` / `interface` named `name` whose preceding JSDoc,
	 * within the declaration body, carries `@example`.
	 *
	 * @example
	 * ```ts
	 * source.examples('GuideInterface') // ['links', 'tests', 'patterns']
	 * ```
	 */
	examples(name: string): readonly string[]
}

/**
 * The construction input for a {@link Source} — a consumer-supplied file
 * inventory (root-relative path → file text) plus the module scope to
 * reflect. The consumer gathers `files` however their environment allows
 * (`node:fs` in a Node script, `import.meta.glob` in a browser/vitest run) —
 * `Source` itself never touches disk.
 */
export interface SourceOptions {
	/** The workspace's file inventory, root-relative path → file text. */
	readonly files: Readonly<Record<string, string>>
	/** The source directory (or directories) this guide documents, root-relative. */
	readonly module: GuideModule
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
