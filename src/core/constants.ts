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
export const DRIFT_CATEGORIES = Object.freeze([
	'summary',
	'signature',
	'example',
] satisfies ReadonlyArray<'summary' | 'signature' | 'example'>)

/**
 * Names the `## Surface` heading text a guide's documented exports section is keyed on.
 */
export const SURFACE: string = 'Surface'

/**
 * Lists the codes a {@link GuideError} carries: a refused Surface `header` or empty `signature`
 * cell, a name two modules of one manifest entry declare (`collision`), and the compiler faults —
 * a failed `compile`, an `empty` emit, a `timeout`, and an output `overflow`.
 */
export const GUIDE_CODES = Object.freeze([
	'header',
	'signature',
	'collision',
	'compile',
	'empty',
	'timeout',
	'overflow',
] satisfies ReadonlyArray<
	'header' | 'signature' | 'collision' | 'compile' | 'empty' | 'timeout' | 'overflow'
>)

/** Names the cross-copy identity marker of a Guide error. */
export const GUIDE_ERROR_BRAND = Symbol.for('@orkestrel/guide.GuideError')

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
 * Names the header text of the column a `## Surface` table's TypeScript signature is read from.
 */
export const SIGNATURE: string = 'Signature'

/**
 * Names the header text of the column a `## Surface` or `## Methods` table's compared
 * description paragraph is read from.
 */
export const SUMMARY: string = 'Summary'

/**
 * Names the header text of a `## Surface` or `## Methods` table's first column, the symbol name.
 */
export const NAME: string = 'Name'

/**
 * Lists the uniform `## Surface` table header, column by column, that guide construction requires.
 */
export const SURFACE_HEADER: readonly string[] = Object.freeze([NAME, KIND, SIGNATURE, SUMMARY])

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

/**
 * Matches one character that occupies two terminal columns: an emoji presentation character other
 * than a regional indicator, or a character of the East Asian wide and fullwidth classes.
 *
 * @remarks
 * A regional indicator is outside this class because the formatter counts each as one column,
 * which makes a flag pair two. The blocks are the formatter's Unicode tables, so an unassigned
 * code point, a character the formatter's Unicode version classes differently from a later one,
 * and a ligating cluster such as Arabic lam-alef, which the formatter counts one column, are the
 * measure's known divergences. A character in {@link ZERO_WIDTH} counts none
 * whatever this class holds, because the width measure tests that class first.
 */
export const WIDE_CHARACTER: RegExp = new RegExp(
	[
		String.raw`[[\p{Emoji_Presentation}--\p{Regional_Indicator}]`,
		String.raw`\u{1100}-\u{115F}\u{2329}\u{232A}\u{2630}-\u{2637}\u{268A}-\u{268F}`,
		String.raw`\u{2E80}-\u{2E99}\u{2E9B}-\u{2EF3}\u{2F00}-\u{2FD5}\u{2FF0}-\u{303E}`,
		String.raw`\u{3041}-\u{3096}\u{3099}-\u{30FF}\u{3105}-\u{312F}\u{3131}-\u{318E}`,
		String.raw`\u{3190}-\u{31E5}\u{31EF}-\u{321E}\u{3220}-\u{3247}\u{3250}-\u{A48C}`,
		String.raw`\u{A490}-\u{A4C6}\u{A960}-\u{A97C}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}`,
		String.raw`\u{FE10}-\u{FE19}\u{FE30}-\u{FE52}\u{FE54}-\u{FE66}\u{FE68}-\u{FE6B}`,
		String.raw`\u{FF01}-\u{FF60}\u{FFE0}-\u{FFE6}`,
		String.raw`\u{16FE0}-\u{16FE3}\u{16FF0}-\u{16FF6}\u{17000}-\u{187FF}`,
		String.raw`\u{18800}-\u{18CD5}\u{18CFF}-\u{18D1E}\u{18D80}-\u{18DF2}`,
		String.raw`\u{1AFF0}-\u{1AFF3}\u{1AFF5}-\u{1AFFB}\u{1AFFD}\u{1AFFE}`,
		String.raw`\u{1B000}-\u{1B122}\u{1B132}\u{1B150}-\u{1B152}\u{1B155}`,
		String.raw`\u{1B164}-\u{1B167}\u{1B170}-\u{1B2FB}\u{1D300}-\u{1D356}`,
		String.raw`\u{1D360}-\u{1D376}\u{1F200}\u{1F202}\u{1F210}-\u{1F219}`,
		String.raw`\u{1F21B}-\u{1F22E}\u{1F230}\u{1F231}\u{1F237}\u{1F23B}`,
		String.raw`\u{1F240}-\u{1F248}\u{1F250}\u{1F251}\u{1F260}-\u{1F265}`,
		String.raw`\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}]`,
	].join(''),
	'v',
)

/**
 * Matches a character that occupies no terminal column: a nonspacing, enclosing, or extending
 * mark, a format character such as a zero width space, a control character, and the Hangul
 * medial and final jamo, less the format and mark characters the formatter counts one column.
 */
export const ZERO_WIDTH: RegExp = new RegExp(
	[
		String.raw`[[\p{Grapheme_Extend}\p{Cf}\p{Cc}\u{1160}-\u{11FF}\u{D7B0}-\u{D7C6}\u{D7CB}-\u{D7FB}`,
		String.raw`\u{3164}\u{FFA0}]--[\u{600}-\u{604}\u{6DD}\u{2D7F}\u{FFF9}-\u{FFFB}`,
		String.raw`\u{110BD}\u{110CD}\u{13430}-\u{1343F}]]`,
	].join(''),
	'v',
)

/**
 * Matches a grapheme cluster the formatter counts two columns whole: a pictograph sequence joined
 * by a zero width joiner, an emoji followed by a skin-tone modifier, an emoji followed by the emoji
 * variation selector, or a keycap that carries that selector.
 */
export const EMOJI_SEQUENCE: RegExp =
	/\p{Extended_Pictographic}\u{200D}\p{Extended_Pictographic}|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji}\u{FE0F}|[0-9#*]\u{FE0F}\u{20E3}/u
