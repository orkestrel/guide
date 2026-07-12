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
	/** Every link href in the guide, including table cells. */
	links(): readonly string[]
	/** The relative test links declared under `## Tests`. */
	tests(): readonly string[]
}

/**
 * The reflected source truth a guide's documented surface is checked against —
 * implemented over disk reflection in `server`.
 */
export interface SourceInterface {
	/** Every module-scope export, including type-only, by (name, kind). */
	exports(): readonly SurfaceSymbol[]
	/** The call-signature members of the `class` / `interface` named `name`. */
	methods(name: string): readonly string[]
	/** Whether a workspace-root-relative path exists on disk. */
	exists(relative: string): boolean
}
