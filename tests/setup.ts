import type { TableNode } from '@orkestrel/markdown'
import type { ParityOptions, SourceInterface, SurfaceSymbol } from '@src/core'
import { parseDocument } from '@orkestrel/markdown'
import { requireValue } from '@orkestrel/test'

// ── Deterministic randomness ──────────────────────────────────────────────────
// The single house seed for tests that need generated/random input (contract
// `.generate(random)` calls, fuzz-style fixtures). Suites call
// `seededRandom(TEST_SEED)` directly to get a fresh, deterministic
// `RandomFunction` — keeping the seed centralized here means every suite that
// wants determinism uses the same starting point.
export const TEST_SEED = 42

/** Holds a guide where an embedded demonstration heading precedes the class row it mentions. */
export const DEMONSTRATION_HEADING_GUIDE = [
	'## Surface',
	'',
	'### Bind a `Widget` to a transport',
	'',
	'| Name | Kind | Summary |',
	'| --- | --- | --- |',
	'| `Widget` | class | Represents a widget. |',
	'',
].join('\n')

/** Represents one candidate H3 heading paired with the surface it yields. */
export type EntityHeadingCase = readonly [heading: string, surface: readonly SurfaceSymbol[]]

/** Holds each candidate H3 heading the entity-heading boundary admits or refuses. */
export const ENTITY_HEADING_CASES: readonly EntityHeadingCase[] = [
	['### `Widget`', [{ name: 'Widget', keyword: 'class' }]],
	['### `Widget<T>`', [{ name: 'Widget', keyword: 'class' }]],
	['###   `Widget`   ', [{ name: 'Widget', keyword: 'class' }]],
	['### **`Widget`**', [{ name: 'Widget', keyword: 'class' }]],
	['### [`Widget`](target)', [{ name: 'Widget', keyword: 'class' }]],
	['### Bind a `Widget` to a transport', []],
	['### `Widget` and `Alias`', []],
	['### `Widget` ` `', []],
]

/** Names the guide inventory key used by parity fixtures. */
export const PARITY_SPEC = 'guides/widget.md'

/** Holds a complete guide that agrees with the parity fixture's source. */
export const PARITY_GUIDE = [
	'# Widget',
	'',
	'> A widget toolkit.',
	'',
	'## Surface',
	'',
	'| Name | Kind | Summary |',
	'| --- | --- | --- |',
	'| `WidgetInterface` | interface | Represents a widget. |',
	'| `Widget` | class | Represents an implementing widget. |',
	'| `createWidget` | function | Creates a widget. |',
	'',
	'## Methods',
	'',
	'#### `WidgetInterface`',
	'',
	'| Name | Summary |',
	'| --- | --- |',
	'| `render` | Renders the widget. |',
	'',
	'## Patterns',
	'',
	'### Create a widget',
	'',
	'```ts',
	"import { createWidget } from '@scope/widget'",
	'createWidget()',
	'```',
	'',
	'### Render a widget',
	'',
	'```ts',
	'widget.render()',
	'```',
	'',
	'## Tests',
	'',
	'- [`Widget`](../tests/src/core/Widget.test.ts)',
	'',
].join('\n')

/** Holds the source file carrying the parity fixture's behavioral contract. */
export const PARITY_TYPES = [
	'/**',
	' * Represents a widget.',
	' */',
	'export interface WidgetInterface {',
	'\t/**',
	'\t * Renders the widget.',
	'\t *',
	'\t * @example Render a widget',
	'\t * ```ts',
	'\t * widget.render()',
	'\t * ```',
	'\t */',
	'\trender(): void',
	'}',
	'',
].join('\n')

/** Holds the source file carrying the parity fixture's entity implementation. */
export const PARITY_WIDGET = [
	'/**',
	' * Represents an implementing widget.',
	' */',
	'export class Widget {',
	'\trender(): void {}',
	'}',
	'',
].join('\n')

/** Holds the source file carrying the parity fixture's factory and titled example. */
export const PARITY_FACTORIES = [
	'/**',
	' * Creates a widget.',
	' *',
	' * @example Create a widget',
	' * ```ts',
	" * import { createWidget } from '@scope/widget'",
	' * createWidget()',
	' * ```',
	' */',
	'export function createWidget(): void {}',
	'',
].join('\n')

/** Represents optional replacements applied to a parity fixture inventory. */
export interface ParityFixtureOptions {
	/** Replaces or removes inventory texts by root-relative key. */
	readonly files?: Readonly<Record<string, string | undefined>>
	/** Replaces the manifest rows. */
	readonly entries?: ParityOptions['entries']
	/** Replaces the self-specifier map. */
	readonly modules?: ParityOptions['modules']
	/** Replaces the admitted fence-language list. */
	readonly languages?: ParityOptions['languages']
	/** Replaces the example and import language. */
	readonly language?: string
	/** Replaces or removes the pitch pairing. */
	readonly pitch?: ParityOptions['pitch'] | false
}

/**
 * Creates a complete parity fixture with optional inventory and policy replacements.
 *
 * @param options - The fixture replacements
 * @returns A parity input whose guide and source agree by default
 */
export function createParityFixture(options?: ParityFixtureOptions): ParityOptions {
	const files: Record<string, string> = {
		'README.md': '# Widget\n\n> A widget toolkit.\n',
		[PARITY_SPEC]: PARITY_GUIDE,
		'src/core/index.ts':
			"export * from './types.js'\nexport * from './Widget.js'\nexport * from './factories.js'\n",
		'src/core/types.ts': PARITY_TYPES,
		'src/core/Widget.ts': PARITY_WIDGET,
		'src/core/factories.ts': PARITY_FACTORIES,
		'tests/src/core/Widget.test.ts': '',
	}
	for (const [path, content] of Object.entries(options?.files ?? {})) {
		if (content === undefined) delete files[path]
		else files[path] = content
	}

	return {
		files,
		entries: options?.entries ?? [
			{ concept: 'Widget', spec: PARITY_SPEC, source: 'src/core', tests: 'tests/src/core' },
		],
		modules: options?.modules ?? { '@scope/widget': 'src/core' },
		languages: options?.languages ?? ['ts'],
		language: options?.language ?? 'ts',
		...(options?.pitch === false
			? {}
			: { pitch: options?.pitch ?? { readme: 'README.md', spec: PARITY_SPEC } }),
	}
}

/**
 * Requires markdown whose first block is a table.
 *
 * @param markdown - The markdown source containing a leading table
 * @returns The parsed leading table
 *
 * @example
 * ```ts
 * requireTable('| Name |\n| --- |\n| Value |')
 * ```
 */
export function requireTable(markdown: string): TableNode {
	const [table] = parseDocument(markdown).children
	if (table?.element !== 'table') throw new Error('expected a table block')
	return table
}

/**
 * Looks one inventory key up and requires it to be present.
 *
 * @param files - The inventory to read
 * @param relative - The root-relative key that must be present
 * @returns The file's text
 *
 * @example
 * ```ts
 * requireText({ 'widget.md': '# Widget\n' }, 'widget.md')
 * ```
 */
export function requireText(files: Readonly<Record<string, string>>, relative: string): string {
	return requireValue(files[relative], `Missing file: ${relative}`)
}

/** Holds the names one `SourceInterface` answers with for each store-fixture reading. */
export interface StoreReadings {
	readonly member: readonly string[]
	readonly module: readonly string[]
	readonly store: readonly string[]
	readonly base: readonly string[]
	readonly absent: readonly string[]
}

/**
 * Builds one module file declaring a `ReadInterface` base and a `StoreInterface` extending it,
 * each member carrying its own `@example` tag.
 *
 * @param member - The member name `StoreInterface` declares beside the inherited `read`
 * @returns The file's source text
 *
 * @example
 * ```ts
 * buildStoreSource('open').includes('\topen(): void') // true
 * ```
 */
export function buildStoreSource(member: string): string {
	return [
		'export interface ReadInterface {',
		'\t/** @example */',
		'\tread(): string',
		'}',
		'export interface StoreInterface extends ReadInterface {',
		'\t/** @example */',
		`\t${member}(): void`,
		'}',
		'',
	].join('\n')
}

/**
 * Reads the example names and the method names one view answers for a store fixture.
 *
 * @remarks
 * The member collection is read before the module-wide one, and the derived name before the
 * declared one, so a reading that answered under another argument's key shows up in the result.
 *
 * @param source - The view to read
 * @returns The names each reading answered with
 *
 * @example
 * ```ts
 * import { Source } from '@src/core'
 *
 * const files = { 'module/types.ts': buildStoreSource('open') }
 * readStoreReadings(new Source({ files, module: 'module' })).store // ['open', 'read']
 * ```
 */
export function readStoreReadings(source: SourceInterface): StoreReadings {
	return {
		member: source.examples('StoreInterface').map((example) => example.name),
		module: source.examples().map((example) => example.name),
		store: source.methods('StoreInterface').map((entry) => entry.name),
		base: source.methods('ReadInterface').map((entry) => entry.name),
		absent: source.methods('AbsentInterface').map((entry) => entry.name),
	}
}
