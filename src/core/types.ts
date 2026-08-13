/**
 * The declaration kind a documented / exported symbol carries — exactly the
 * five reflected `type`, `interface`, `const`, `function`, and `class` heads.
 * Comment/template payload is excluded before reflection. `enum` is outside
 * this population, not forbidden by general package policy.
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
 * plus its backend implementations). `'.'` is the canonical workspace-root
 * directory; empty, trailing-slash, and dot-segment spellings canonicalize to
 * the same value before reflection.
 */
export type GuideModule = string | readonly string[]

/**
 * One terminator-free physical source line and its aligned reflection
 * projections. Every projection has the same length as {@link source}, and
 * every genuine JSDoc span retains its physical opener column; the final
 * physical line is present even when it is empty.
 */
export interface SourceLine {
	/** The exact source characters, excluding the LF or CRLF terminator. */
	readonly source: string
	/** Source code with comment and template spans replaced by aligned spaces. */
	readonly code: string
	/** Every genuine JSDoc span at its exact source columns, or `undefined` when absent. */
	readonly jsdoc: string | undefined
}

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

/** One fenced code block projected from a guide document. */
export interface GuideFence {
	/** The info-string language tag, or `undefined` when the fence is untagged. */
	readonly language: string | undefined
	/** The fence's verbatim code body. */
	readonly code: string
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
	 * Every fenced code block in the whole document, in document order — no
	 * language filter, so a consumer decides which languages its checks read.
	 *
	 * @example
	 * ```ts
	 * guide.fences() // [{ language: 'ts', code: "import { createGuide } from '@orkestrel/guide'" }]
	 * ```
	 */
	fences(): readonly GuideFence[]
}

/**
 * The reflected source truth a guide's documented surface is checked against —
 * a pure view over a consumer-supplied file inventory (see {@link Source}).
 */
export interface SourceInterface {
	/**
	 * Every direct declaration in the selected module keys matching
	 * `export (async )?(function*?|class|const|interface|type) Name`, by
	 * (name, kind). Module keys are `.ts` inventory keys under the selected
	 * directories, excluding each directory's exact root `index.ts` and every
	 * `*.test.ts` key. Inventory keys are exact opaque workspace-relative keys,
	 * must contain no empty, `.` or `..` segment, and are never normalized.
	 * Comment/template payload is excluded through a
	 * length-preserving projection, but membership still follows this consumer's
	 * uninterrupted column-zero declaration-head grammar. `enum`
	 * and other TypeScript export forms are outside this five-kind reflection
	 * population, not forbidden by general package policy.
	 */
	exports(): readonly SurfaceSymbol[]
	/**
	 * Every declaration reachable from each selected module's conventional root
	 * `index.ts` through complete relative `.js` `export *` rows. Unlike
	 * {@link exports}, this inventories barrel reachability rather than all
	 * intentional direct declarations under the selected directories.
	 *
	 * @remarks
	 * This pure projection reads only the consumer-supplied inventory. A row must
	 * be equivalent to `export * from './target.js'`: its target is relative and
	 * ends in `.js`; either quote, surrounding whitespace, an optional semicolon,
	 * and an optional trailing line comment are accepted; the inactive quote
	 * delimiter remains target data. Comment and template spans are masked while
	 * valid code before or after them remains eligible; markers inside quoted
	 * target text remain data. Regex recognition is a bounded lexical goal rather
	 * than TypeScript parser grammar: a slash immediately after bare `}` is treated
	 * as division, so a post-brace regex statement needs an explicit `;`. General
	 * semicolonless declaration/ASI classification is also outside the finite
	 * projector, so callers use an explicit `;` before a slash-leading statement
	 * after such a declaration. Only the
	 * terminal `.js` becomes `.ts`, and that
	 * exact resolved inventory key is used only when its segments are canonical.
	 * Initial barrel keys must likewise be canonical; relative parent rows that
	 * reduce to canonical keys remain valid. Exact workspace-root `index.ts` and
	 * nested targets ending `/index.ts` recurse as barrels, with a
	 * per-computation visited set terminating cycles; other targets contribute
	 * direct declarations from `exportsFrom()`. Missing roots, missing targets, and
	 * unsupported export forms contribute no symbols while valid siblings continue.
	 * Repository policy, typechecking, and builds own validation; this is not
	 * filesystem or TypeScript resolution. The result is deduplicated by
	 * `symbolKey()`, retains same-name/different-kind symbols, sorts by name,
	 * computes lazily, and caches the same readonly array instance.
	 *
	 * @returns The conventional barrel-reachable surface
	 *
	 * @example
	 * ```ts
	 * source.surface() // [{ name: 'Guide', kind: 'class' }]
	 * ```
	 */
	surface(): readonly SurfaceSymbol[]
	/** The call-signature members of the `class` / `interface` named `name`. */
	methods(name: string): readonly string[]
	/** Whether a workspace-root-relative path exists in the inventory. */
	exists(relative: string): boolean
	/**
	 * Every module-scope declaration LACKING the `export` keyword (AGENTS §5's
	 * export-discipline reflection) across the same projected physical code lines
	 * and five declaration kinds as {@link exports}. Comment/template payload and
	 * `enum` are outside this population; projection preserves physical columns
	 * but does not widen the uninterrupted column-zero declaration-head grammar.
	 * This does not forbid enums by general package policy. Empty on a conforming module.
	 *
	 * @example
	 * ```ts
	 * source.hidden() // []
	 * ```
	 */
	hidden(): readonly SurfaceSymbol[]
	/**
	 * The names of every exported function whose next-physical-record eligible
	 * genuine JSDoc chain ends in a span carrying an exact block-position
	 * `@example` tag. Title text is allowed; intervening material severs
	 * association.
	 *
	 * @example
	 * ```ts
	 * source.examples() // ['createGuide', 'createSource']
	 * ```
	 */
	examples(): readonly string[]
	/**
	 * The members of the `class` / `interface` named `name` whose immediately
	 * preceding eligible genuine JSDoc chain, within the declaration body, ends
	 * in a span carrying an exact block-position `@example` tag. Title text is
	 * allowed; intervening material severs association. Declaration and callable
	 * member eligibility comes from aligned projected code while genuine JSDoc
	 * evidence retains its source columns.
	 *
	 * @example
	 * ```ts
	 * source.examples('GuideInterface') // ['fences', 'links', 'tests']
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
	/** The workspace's exact canonical-segment opaque inventory keys, root-relative path → text. */
	readonly files: Readonly<Record<string, string>>
	/** The source directory (or directories) this guide documents; `'.'` is workspace root. */
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
