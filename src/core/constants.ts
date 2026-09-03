/**
 * Lists the declaration keywords a documented or exported symbol carries, in
 * the order the reflection grammar names them.
 *
 * @remarks
 * One frozen list feeds the `ExportKeyword` type, the `isExportKeyword` guard, and
 * `surfaceSymbolShape`, so a keyword cannot be admitted by one and refused by
 * another. Comment and template payload is excluded before reflection, and
 * `enum` is outside this population rather than forbidden by general package
 * policy.
 */
export const EXPORT_KEYWORDS = Object.freeze([
	'type',
	'interface',
	'const',
	'function',
	'class',
] as const)

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
 * Names the `## By concept` heading text the manifest's run-map table is keyed on.
 */
export const MANIFEST: string = 'By concept'

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
