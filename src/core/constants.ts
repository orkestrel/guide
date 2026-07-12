/**
 * The `## Surface` heading text a guide's documented exports section is keyed on.
 */
export const SURFACE: string = 'Surface'

/**
 * The `## Methods` heading text a guide's documented interface-methods section is keyed on.
 */
export const METHODS: string = 'Methods'

/**
 * The `## Tests` heading text a guide's documented test-link section is keyed on.
 */
export const TESTS: string = 'Tests'

/**
 * The `## By concept` heading text the manifest's run-map table is keyed on.
 */
export const MANIFEST: string = 'By concept'

/**
 * The link `href` schemes a guides-parity link check skips as external — a link
 * with one of these prefixes (or a bare `#` anchor, handled separately in
 * `isExternalLink`) is never resolved against the filesystem.
 */
export const EXTERNAL_SCHEMES: readonly string[] = Object.freeze([
	'http:',
	'https:',
	'mailto:',
	'tel:',
])
