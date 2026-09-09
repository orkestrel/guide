/**
 * Lists the declaration keywords a documented or exported symbol carries, in the order the
 * reflection grammar names them — the frozen population `ExportKeyword`, `isExportKeyword`, and
 * `surfaceSymbolShape` all derive from.
 *
 * @remarks
 * One frozen list feeds the type, the guard, and the shape, so a keyword cannot be admitted by one
 * and refused by another. Comment and template payload is excluded before reflection, and `enum`
 * is outside this population rather than forbidden by general package policy.
 */
export const EXPORT_KEYWORDS = Object.freeze([
	'type',
	'interface',
	'const',
	'function',
	'class',
] satisfies ReadonlyArray<'type' | 'interface' | 'const' | 'function' | 'class'>)

/**
 * Lists the compared sites a {@link Drift} can describe.
 */
export const DRIFT_CATEGORIES = Object.freeze(['summary', 'example'] satisfies ReadonlyArray<
	'summary' | 'example'
>)

/**
 * Names the `## Surface` heading text a guide's documented exports section is keyed on.
 */
export const SURFACE: string = 'Surface'

/**
 * Names the `## Methods` heading text a guide's documented interface-methods section is keyed on.
 */
export const METHODS: string = 'Methods'

/**
 * Names the `## Tests` heading text a guide's documented test-link section is keyed on.
 */
export const TESTS: string = 'Tests'

/**
 * Names the header text of the column a `## Surface` table's declaration keyword is read from.
 */
export const KIND: string = 'Kind'

/**
 * Names the header text of the column a `## Surface` or `## Methods` table's compared
 * description paragraph is read from.
 */
export const SUMMARY: string = 'Summary'

/**
 * Names the `## By concept` heading text the manifest's run-map table is keyed on.
 */
export const MANIFEST: string = 'By concept'

/**
 * Holds the default character budget a rewritten doc block's description paragraph wraps
 * inside — the greatest number of characters a re-wrapped line may carry, counted from the
 * line's first character with a tab counting as one, so a wrapped line reads
 * `${indent} * ${text}` and never passes that count.
 *
 * @remarks
 * The budget counts characters, not rendered columns. A block indented with tabs therefore
 * measures each tab as one character, and a formatter that renders a tab wider reads the same
 * line as longer; a caller whose formatter measures differently passes its own width instead of
 * taking this default. A doc block's own wrapping is not recoverable from its text either — the
 * blocks this package's own source carries are hand-wrapped, and no single greedy width
 * reproduces them — so a rewrite cannot infer a per-block width and falls back to this budget.
 */
export const WRAP_WIDTH: number = 100

/**
 * Lists the link `href` schemes a guides-parity link check skips as external — a link
 * with one of these prefixes (or a bare `#` anchor, handled separately in
 * `isExternalLink`) is never resolved against the filesystem.
 */
export const EXTERNAL_SCHEMES: readonly string[] = Object.freeze([
	'http:',
	'https:',
	'mailto:',
	'tel:',
])
