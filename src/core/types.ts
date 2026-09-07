import type { EXPORT_KEYWORDS } from './constants.js'

/**
 * Represents the declaration keyword a documented / exported symbol carries — the reflected
 * `type`, `interface`, `const`, `function`, and `class` heads, derived from
 * {@link EXPORT_KEYWORDS} so the type, the guard, and the shape name one
 * population. Comment/template payload is excluded before reflection.
 * `enum` is outside this population, not forbidden by general package policy.
 */
export type ExportKeyword = (typeof EXPORT_KEYWORDS)[number]

/**
 * Represents one documented / exported symbol — its identifier, its declaration keyword, and
 * the description paragraph the guide and the doc block are compared on.
 */
export interface SurfaceSymbol {
	/** Holds the symbol's identifier. */
	readonly name: string
	/** Holds the symbol's declaration keyword — half of the bijection key alongside {@link name}. */
	readonly keyword: ExportKeyword
	/**
	 * Holds the normalized description paragraph this side carries — a guide table's `Summary`
	 * cell, or a doc block's text before its first block tag — and is absent when this side
	 * carries none. Optional, so a hand-built symbol stays valid; {@link computeSymbolKey} never
	 * reads it.
	 */
	readonly summary?: string
}

/**
 * Represents one documented method — its identifier plus the description paragraph the guide's
 * `Summary` cell and the member's doc block are compared on.
 */
export interface MethodEntry {
	/** Holds the method's identifier. */
	readonly name: string
	/** Holds the normalized description paragraph this side carries, or is absent when it carries none. */
	readonly summary?: string
}

/**
 * Represents one `@example` block read from a doc comment — the declaration it documents, its
 * title, and the code it carries.
 */
export interface SourceExample {
	/** Names the declaration or member whose doc block carries the block. */
	readonly name: string
	/** Holds the text after the `@example` tag, which pairs the block with the guide fence under the heading of that text; absent when the tag carries none. */
	readonly title?: string
	/** Holds the block's code — the body of its fence, or the whole block when it carries no fence. */
	readonly code: string
	/** Holds the info-string language of the block's fence, or is absent when the block carries no fence. */
	readonly language?: string
}

/**
 * Represents one disagreement between a guide and the source it documents — the compared key
 * with the text each side carries there.
 */
export interface Drift {
	/**
	 * Names the compared pair: a {@link computeSymbolKey} symbol key for a `## Surface` row, an
	 * `Owner.member` key for a `## Methods` row, or the shared title for an example.
	 */
	readonly key: string
	/** Holds the guide's text, or is absent when the guide carries none there. */
	readonly guide?: string
	/** Holds the source's text, or is absent when the source carries none there. */
	readonly source?: string
}

/**
 * Represents the source scope a guide's manifest entry covers — one module directory, or
 * several when a layer guide spans multiple source directories (a core module
 * plus its backend implementations). `'.'` is the canonical workspace-root
 * directory; empty, trailing-slash, and dot-segment spellings canonicalize to
 * the same value before reflection.
 */
export type GuideModule = string | readonly string[]

/**
 * Represents one terminator-free physical source line and its aligned reflection
 * projections. Every projection has the same length as {@link source}, and
 * every genuine JSDoc span retains its physical opener column; the final
 * physical line is present even when it is empty.
 */
export interface SourceLine {
	/** Holds the exact source characters, excluding the LF or CRLF terminator. */
	readonly source: string
	/** Holds source code with comment and template spans replaced by aligned spaces. */
	readonly code: string
	/** Holds every genuine JSDoc span at its exact source columns, or `undefined` when absent. */
	readonly jsdoc: string | undefined
}

/**
 * Represents one eligible genuine JSDoc block paired with the physical record it documents —
 * the block's unwrapped body and the {@link SourceLine} that follows its chain.
 */
export interface SourceComment {
	/**
	 * Holds the authoritative span's unwrapped body: the `/**` opener, the closing marker, each
	 * line's continuation marker, and the block's leading indentation removed, with per-line
	 * trailing whitespace trimmed.
	 */
	readonly text: string
	/** Holds the physical record the block documents — the next record after its chain. */
	readonly line: SourceLine
}

/**
 * Represents one `## By concept` manifest row — a single guides-parity check target, paths
 * normalized to workspace root.
 */
export interface ManifestEntry {
	/** Holds the concept name — the row's first cell, flattened. */
	readonly concept: string
	/** Names the guide `.md` this entry documents, root-relative. */
	readonly spec: string
	/** Names the source directory (or directories) the guide documents. */
	readonly source: GuideModule
	/** Names the tests directory the guide's `## Tests` links resolve against. */
	readonly tests: string
}

/**
 * Represents one behavioral interface a guide's `## Methods` section documents — the H4
 * heading naming that interface as a code span, and the member entries its table lists.
 */
export interface MethodGroup {
	/** Holds the backticked interface name. */
	readonly interface: string
	/** Lists the group's documented Method-cell entries, in table order. */
	readonly methods: readonly MethodEntry[]
}

/**
 * Represents one brace `import` statement projected from a guide fence — its specifier
 * paired with the exported names it binds.
 */
export interface FenceImport {
	/** Names the module specifier the statement imports from. */
	readonly specifier: string
	/** Lists the imported names, each alias resolved to the original exported name. */
	readonly names: readonly string[]
}

/** Represents one fenced code block projected from a guide document. */
export interface GuideFence {
	/** Holds the info-string language tag, or `undefined` when the fence is untagged. */
	readonly language: string | undefined
	/** Holds the fence's verbatim code body. */
	readonly code: string
	/**
	 * Holds the flattened text of the fence's nearest preceding heading, which pairs the fence
	 * with the `@example` block carrying that title; absent when no heading precedes it.
	 */
	readonly title?: string
}

/**
 * Represents the structured, pure view of one parsed guide — every projection extracted and
 * cached once at construction (see {@link createGuide}).
 */
export interface GuideInterface {
	/**
	 * Lists the `##` heading names, in document order — the non-vacuousness guard for
	 * section presence.
	 *
	 * @returns The document's `##` heading names, in document order
	 */
	sections(): readonly string[]
	/**
	 * Returns the text of the blockquote following the document's H1 — the guide's tagline.
	 *
	 * @returns The tagline, or `undefined` when no blockquote follows an H1 before the next heading
	 *
	 * @example
	 * ```ts
	 * guide.tagline() // 'A pure, I/O-free guides-parity toolkit'
	 * ```
	 */
	tagline(): string | undefined
	/**
	 * Lists every `## Surface` identifier + keyword — table rows union backticked entity headings.
	 * Each row carries its `Summary` cell, located by header text, when the table has that column.
	 *
	 * @returns The documented surface symbols, in encounter order
	 */
	surface(): readonly SurfaceSymbol[]
	/**
	 * Returns one {@link MethodGroup} per documented behavioral interface in `## Methods`.
	 *
	 * @returns One group per documented behavioral interface, in document order
	 */
	methods(): readonly MethodGroup[]
	/**
	 * Lists every `## Surface` or `## Methods` row whose first cell carries no code span — the
	 * rows {@link surface} and {@link methods} skip for want of a name, each entry being the
	 * row's cells joined by ` | `. Such a row reaches neither projection, so no bijection check
	 * can report it and this one names it instead. The `## Surface` rows come first, then the
	 * `## Methods` rows, each in document order.
	 *
	 * @returns One entry per row carrying no code-span name, in document order
	 *
	 * @example
	 * ```ts
	 * guide.unnamed() // ['Widget | class | Represents a widget.']
	 * ```
	 */
	unnamed(): readonly string[]
	/**
	 * Lists every link href in the guide, including table cells.
	 *
	 * @returns Every link href in the guide, in walk order
	 *
	 * @example
	 * ```ts
	 * guide.links() // ['../../src/core/helpers.ts']
	 * ```
	 */
	links(): readonly string[]
	/**
	 * Lists the relative test links declared under `## Tests`.
	 *
	 * @returns The `## Tests` section's link hrefs, in walk order
	 *
	 * @example
	 * ```ts
	 * guide.tests() // ['../../tests/src/core/Guide.test.ts']
	 * ```
	 */
	tests(): readonly string[]
	/**
	 * Lists every fenced code block in the whole document, in document order — no
	 * language filter, so a consumer decides which languages its checks read.
	 *
	 * @returns Every fence's language, verbatim code, and nearest preceding heading title, in document order
	 *
	 * @example
	 * ```ts
	 * guide.fences() // [{ language: 'ts', code: "import { createGuide } from '@orkestrel/guide'" }]
	 * ```
	 */
	fences(): readonly GuideFence[]
}

/**
 * Represents the reflected source truth a guide's documented surface is checked against —
 * a pure view over a consumer-supplied file inventory (see {@link Source}).
 */
export interface SourceInterface {
	/**
	 * Lists every direct declaration in the selected module keys matching
	 * `export (async )?(function*?|class|const|interface|type) Name`, by
	 * (name, keyword). Module keys are `.ts` inventory keys under the selected
	 * directories, excluding each directory's exact root `index.ts` and every
	 * `*.test.ts` key. Inventory keys are exact opaque workspace-relative keys,
	 * must contain no empty, `.` or `..` segment, and are never normalized.
	 * Comment/template payload is excluded through a
	 * length-preserving projection, but membership still follows this consumer's
	 * uninterrupted column-zero declaration-head grammar. `enum`
	 * and other TypeScript export forms are outside this declaration-keyword
	 * reflection population, not forbidden by general package policy.
	 *
	 * @returns The selected modules' direct declarations, deduplicated and sorted by name
	 */
	exports(): readonly SurfaceSymbol[]
	/**
	 * Lists every declaration reachable from each selected module's conventional root
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
	 * direct declarations from `extractExports()`. Missing roots, missing targets, and
	 * unsupported export forms contribute no symbols while valid siblings continue.
	 * Repository policy, typechecking, and builds own validation; this is not
	 * filesystem or TypeScript resolution. The result is deduplicated by
	 * `computeSymbolKey()`, retains same-name/different-keyword symbols, sorts by name,
	 * computes lazily, and caches the same readonly array instance.
	 *
	 * @returns The conventional barrel-reachable surface
	 *
	 * @example
	 * ```ts
	 * source.surface() // [{ name: 'Guide', keyword: 'class' }]
	 * ```
	 */
	surface(): readonly SurfaceSymbol[]
	/**
	 * Returns the call-signature members of the `class` / `interface` named `name`,
	 * unioned with the members of every declaration it extends.
	 *
	 * @remarks
	 * One declaration answers for `name`: the module scope's files are read in
	 * sorted key order and the first one whose located head has a body or has
	 * bases supplies both the members and the bases, so a second file
	 * declaring the same name adds nothing; a head with neither a body nor
	 * bases does not count as declared, so an empty `export interface X {}`
	 * is skipped and resolution continues to a later file or falls through to
	 * a same-named class. Resolution reads that head's `extends` clause and follows it
	 * through this same module scope, keeping the keyword it started from: an
	 * `interface` chain resolves through interfaces and a `class` chain through
	 * classes, so a class's `implements` clause is outside the walk. A base the
	 * scope does not declare — imported from another package, written as a
	 * qualified name, or declared outside the selected directories —
	 * contributes no members and is not an error. One visited set per call
	 * collapses a cycle and a diamond to a single visit.
	 *
	 * @param name - The declaration's identifier
	 * @returns Its declared and inherited members, each with its doc block's description paragraph, deduplicated by name and sorted, a class `constructor` excluded
	 */
	methods(name: string): readonly MethodEntry[]
	/**
	 * Checks whether a workspace-root-relative path names a file or a directory present
	 * in the inventory.
	 *
	 * @param relative - The workspace-root-relative path to look up
	 * @returns True if the inventory holds that exact key or any key beneath it; false otherwise
	 */
	exists(relative: string): boolean
	/**
	 * Lists every module-scope declaration lacking the `export` keyword — the
	 * export-discipline reflection `.claude/rules/architecture.md` § Barrel exports
	 * states — across the same projected physical code lines and declaration
	 * keywords as {@link exports}. Comment/template payload and
	 * `enum` are outside this population; projection preserves physical columns
	 * but does not widen the uninterrupted column-zero declaration-head grammar.
	 * This does not forbid enums by general package policy. Empty on a conforming module.
	 *
	 * @returns The module scope's non-exported declarations, deduplicated and sorted by name
	 *
	 * @example
	 * ```ts
	 * source.hidden() // []
	 * ```
	 */
	hidden(): readonly SurfaceSymbol[]
	/**
	 * Lists every `@example` block carried by an exported declaration head — a `type`,
	 * `interface`, `const`, `function`, or `class` head at column zero — whose
	 * next-physical-record eligible genuine JSDoc chain ends in a span holding an `@example` tag
	 * opening a line at its first non-blank column. Each block carries its title, its fence
	 * language, and its code; intervening material severs association. A member's block belongs
	 * to the `name` overload instead.
	 *
	 * @returns The exported declaration heads' `@example` blocks, in first-seen order
	 *
	 * @example
	 * ```ts
	 * source.examples() // [{ name: 'createGuide', code: "createGuide('# Guide')" }]
	 * ```
	 */
	examples(): readonly SourceExample[]
	/**
	 * Lists every `@example` block carried by a member of the `class` / `interface` named
	 * `name` whose immediately preceding eligible genuine JSDoc chain, within the declaration
	 * body, ends in a span holding an `@example` tag opening a line at its first non-blank column.
	 * Each block carries its title, its fence language, and its code; intervening material severs
	 * association. Declaration and callable
	 * member eligibility comes from aligned projected code while genuine JSDoc
	 * evidence retains its source columns. The head's own block belongs to the
	 * no-argument overload instead, so the overloads split the axis at the
	 * declaration head against its members.
	 *
	 * @remarks
	 * This overload reads only the named declaration's own body, in the first
	 * file that declares it, under each keyword. Unlike {@link methods}, the
	 * overload follows no `extends` clause, so an inherited member's `@example`
	 * belongs to the base that declares it.
	 *
	 * @param name - The declaration's identifier
	 * @returns Its own members' `@example` blocks, deduplicated by name and title and sorted by name
	 *
	 * @example
	 * ```ts
	 * source.examples('GuideInterface') // [{ name: 'fences', code: 'guide.fences()' }]
	 * ```
	 */
	examples(name: string): readonly SourceExample[]
}

/**
 * Represents the construction input for a {@link Source} — a consumer-supplied file
 * inventory (root-relative path → file text) plus the module scope to
 * reflect. The consumer gathers `files` however their environment allows
 * (`node:fs` in a Node script, `import.meta.glob` in a browser/vitest run) —
 * `Source` itself never touches disk.
 */
export interface SourceOptions {
	/**
	 * Holds the workspace's exact canonical-segment opaque inventory keys, root-relative path
	 * → text.
	 */
	readonly files: Readonly<Record<string, string>>
	/** Names the source directory (or directories) this guide documents; `'.'` is workspace root. */
	readonly module: GuideModule
}

/**
 * Represents the construction input for a {@link SourceManager}: one shared file inventory
 * plus the consumer's specifier-to-module policy.
 */
export interface SourceManagerOptions {
	/**
	 * Holds the workspace's exact canonical-segment opaque inventory keys, root-relative path
	 * → text.
	 */
	readonly files: Readonly<Record<string, string>>
	/** Maps each local import specifier to the source module it exposes. */
	readonly modules: Readonly<Record<string, GuideModule>>
}

/** Represents a specifier resolver that shares one {@link SourceInterface} per module. */
export interface SourceManagerInterface {
	/**
	 * Resolves a mapped specifier to its shared source view.
	 *
	 * @param specifier - The import specifier to resolve
	 * @returns Its source view, or `undefined` when the specifier is not mapped
	 *
	 * @example
	 * ```ts
	 * sources.source('@scope/package')?.surface() // [{ name: 'Guide', keyword: 'class' }]
	 * ```
	 */
	source(specifier: string): SourceInterface | undefined
	/**
	 * Lists every source view the policy maps, sharing the same per-module entities
	 * {@link source} returns.
	 *
	 * @returns One shared source view per distinct module the policy maps, in first-seen specifier order
	 *
	 * @example
	 * ```ts
	 * const [core] = sources.sources()
	 * core === sources.source('@scope/package') // true
	 * ```
	 */
	sources(): readonly SourceInterface[]
}

/**
 * Pairs a declaration head joined into a single line with the index of the line
 * carrying its opening `{` — how a head that oxfmt wrapped across lines
 * (printWidth 100) is matched as if it were written on one.
 */
export interface DeclarationHead {
	/** Holds the joined, space-separated head text. */
	readonly text: string
	/** Holds the index (within the source `lines`) of the line ending in `{`. */
	readonly end: number
}

/**
 * Represents one located `export class` / `export interface` declaration — the body lines
 * and the base identifiers read from the same head, so a consumer never pairs
 * one declaration's body with another declaration's heritage (see
 * {@link extractDeclaration}).
 */
export interface Declaration {
	/** Holds the declaration's raw body lines, between the head and the column-zero closing `}`. */
	readonly body: readonly string[]
	/** Lists the base identifiers its head extends, in head order. */
	readonly bases: readonly string[]
}

/**
 * Represents which declaration head {@link extractDeclaration} and {@link Source} locate —
 * a `class` or an `interface`. That pair is the subset of {@link ExportKeyword}
 * carrying a body whose members a guide's `## Methods` table documents.
 */
export type DeclarationKeyword = 'class' | 'interface'
