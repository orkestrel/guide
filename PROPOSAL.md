# PROPOSAL: `@orkestrel/guide`

> A guides-parity **test helper** for `@orkestrel` packages. A consumer adds it as a devDependency, drops one short test file into `tests/guides/src/parity.test.ts`, wires a vitest `guides` project, and thereafter every guide is proven — mechanically, in CI, as ordinary vitest assertions — to be in **bijection** with the code it documents. No CLI, no runner, no exit-code contract: it is a library of extraction + reflection helpers that your test suite calls. Built on `@orkestrel/markdown`.

## 1. Motivation & doctrine — AGENTS §22 as a vitest suite

AGENTS §22 declares docs to be _enforced contracts_, not comments: every public export is documented, every behavioral interface's `## Methods` table lists exactly its call-signature members, each implementing class exposes exactly those methods, and every relative link resolves. Today that enforcement exists only as convention plus a proven-but-project-bound helper — the earlier terrain project's `setupGuides.ts` — and neither `contract` nor `markdown` runs a parity suite at all yet.

`@orkestrel/guide` promotes that proven helper into one reusable package. The doctrine is unchanged — **a guide is a claim about code; the test is the proof** — but the delivery is deliberately humble: it is not a program you _run_, it is a set of functions your existing test project _imports_. Drift surfaces as a red vitest assertion with an excellent diff (`expect(missing).toEqual([])` → `[ 'function flattenText' ]`), reconciled like any other failing test. This is a direct modernization of terrain's `setupGuides.ts`, ported onto the new stateful `@orkestrel/markdown` API and packaged for reuse.

## 2. The guide-format contract + manifest

The helpers assume the guide anatomy both existing repos already share; no config file, convention only.

**Guide anatomy** (`guides/src/<name>.md`):

1. `# Title` (single H1) and a `>` summary blockquote.
2. `## Surface` — one or more H3 subsections. Each H3 is either a **category** (`### Types`, `### Helpers`, …) followed by one table whose **first column** is a backticked identifier and which carries a **`Kind`** column (`type` / `interface` / `const` / `function` / `class`), OR a **backticked entity heading** (`` ### `Markdown` ``) documenting a class export.
3. `## Methods` — one H4 `` #### `InterfaceName` `` per behavioral interface, each followed by one `| Method | … |` table whose first column is the backticked member name.
4. `## Tests` — a bullet list of relative links to the test files.
5. Free-form prose, `## Patterns`, `## See also` — unconstrained by the checks.

**Manifest** (`guides/README.md`) — the run map. A `## By concept` table `| Concept | Spec | Source | Tests |`; one row = one check target. `Spec` links the guide, `Source` links its source directory (a cell MAY link several directories — a layer guide spanning a core module plus its backend implementations — which parse to a multi-directory scope), `Tests` links its test directory. Adding a row auto-extends coverage with **zero test edits**. An optional `## Dependency reference` section names sibling guides for runtime-dependency packages (e.g. `markdown` cites `contract.md`); it is documentation, not consumed by v1's checks.

## 3. Package identity & dependencies

- **Name** `@orkestrel/guide` · **repo** `orkestrel/guide` · ESM-only · `node >=24` · a single pure `core` surface — no `server`, **no `bin/`**.
- **Runtime dependencies — two:** `@orkestrel/markdown` and `@orkestrel/contract`, both pure and core-safe.
  - `@orkestrel/markdown` is the parsing engine: `createMarkdown` / the `MarkdownInterface` (`walk` / `find` / `filter`), the `is*Node` guards, `walkNodes`, and `flattenText` are everything the extraction layer needs.
  - `@orkestrel/contract` powers the internals exactly as it does in the markdown package: from-unknown guards for the data types this package parses out of untrusted markdown (`isSurfaceSymbol` / `isManifestEntry` / `isMethodGroup`, composed from `recordOf` / `literalOf` / `arrayOf` / `unionOf`), `parseEnum` coercion of `Kind` cells against the five-kind literal set, emptiness guards at line level, and `ContractShape`s + compiled contracts for the non-recursive data types (seeded generators powering test fixtures). One deliberate boundary remains from the v1 rethink: **findings stay plain `readonly string[]` diffs** asserted with `expect(diff).toEqual([])` — vitest's native diff beats any compiled report model for failure output — so contract backs validation and fixtures, not a `Finding`/`Report`/`Summary` object model.
- **No peer `typescript`.** Source truth is read with line scanners (§7), not the compiler API — so there is no peer compiler to bind, no version-skew surface, and type-only exports are read directly from source text.

## 4. Architecture & public API

One pure surface, no server. Everything — guide markdown parsing, the pure comparison leaves, and source reflection — is ordinary ECMAScript with zero filesystem or network access. `Source` implements `SourceInterface` (declared in `types.ts`) over a **consumer-supplied file inventory**: a plain `Record<string, string>` mapping root-relative paths to file text. The consumer gathers that inventory however their own environment allows — `node:fs` in a Node test file, `import.meta.glob` under a browser vitest project — and passes it to `createSource`. This is the dependency-inversion seam that keeps the package itself I/O-free while still supporting every runtime a consumer's test suite might run in.

The design is intentionally lean: **no `Checker`/`Runner` classes.** The "checks" are pure set-difference helpers the drop-in test composes directly, so there is no orchestration entity to own. `validators.ts` and `shapers.ts` exist for the contract-backed layer — from-unknown guards over the parsed data types and shapes/compiled contracts for fixtures — not for a report model.

### `src/core` (pure, `@orkestrel/guide`)

| File            | Holds                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`      | source of truth — `SurfaceSymbol`, `ExportKind`, `GuideModule`, `ManifestEntry`, `MethodGroup`, `GuideInterface`, `SourceInterface`, `SourceOptions`, `DeclarationHead` |
| `constants.ts`  | `EXTERNAL_SCHEMES`, `SURFACE`, `METHODS`, `TESTS`, `MANIFEST` heading literals                                                                                       |
| `helpers.ts`    | pure leaves — `symbolKey`, `findMissing`, `missingSymbols`, `isExternalLink`, `resolveLink`, `firstCode`, `kindIndex`, `moduleDirs`, `moduleKeys`                     |
| `parsers.ts`    | guide/manifest extraction over the Markdown AST, plus the fs-free scanner grammar over source text — `extractSurface`, `extractMethods`, `extractLinks`, `extractTests`, `sectionBlocks`, `parseManifest`, `exportsFrom`, `joinHead`, `declarationBody`, `memberMethods` |
| `validators.ts` | from-unknown guards over the parsed data types — `isSurfaceSymbol`, `isManifestEntry`, `isMethodGroup`, `isExportKind` (contract combinators)                       |
| `shapers.ts`    | `ContractShape`s for the non-recursive data types — `surfaceSymbolShape`, `manifestEntryShape`, `methodGroupShape`                                                   |
| `Guide.ts`      | the `Guide` class — a stateful structured view over one guide (extraction cached in the constructor)                                                                 |
| `Source.ts`     | the `Source` class — implements `SourceInterface`: reflects exports/members/existence over a consumer-supplied file inventory via line scanners                     |
| `factories.ts`  | `createGuide`, `createSource` + compiled-contract factories for the data-type shapes                                                                                 |
| `index.ts`      | the sole barrel                                                                                                                                                      |

### Public API sketch

```ts
// ---- core/types.ts ----
type ExportKind = 'type' | 'interface' | 'const' | 'function' | 'class'
interface SurfaceSymbol {
	// one documented / exported symbol
	readonly name: string // its identifier
	readonly kind: ExportKind // its declaration kind — half of the bijection key
}
type GuideModule = string | readonly string[] // one source dir, or several (a layer guide's scope)
interface ManifestEntry {
	// one `## By concept` row, paths normalized to workspace root
	readonly concept: string
	readonly spec: string // the guide .md, root-relative
	readonly source: GuideModule // the source dir(s) it documents
	readonly tests: string // the tests dir
}
interface MethodGroup {
	// one `#### `Interface`` block in `## Methods`
	readonly interface: string // the backticked interface name
	readonly methods: readonly string[] // its documented Method-cell identifiers
}
interface GuideInterface {
	// the structured view of one guide (pure)
	sections(): readonly string[] // `##` heading names, in order (empty-extraction guard)
	surface(): readonly SurfaceSymbol[] // every Surface identifier + Kind, table rows ∪ entity headings
	methods(): readonly MethodGroup[] // one group per documented behavioral interface
	links(): readonly string[] // every link href in the guide (incl. table cells)
	tests(): readonly string[] // the relative test links under `## Tests`
}
interface SourceInterface {
	// reflected source truth — pure, over a consumer-supplied file inventory
	exports(): readonly SurfaceSymbol[] // every module-scope export incl. type-only, by (name, kind)
	methods(name: string): readonly string[] // the call-signature members of `class`/`interface` `name`
	exists(relative: string): boolean // whether a workspace-root-relative path is in the inventory
}
interface SourceOptions {
	readonly files: Readonly<Record<string, string>> // root-relative path → file text
	readonly module: GuideModule
}

// ---- core: pure comparison leaves + factories ----
function symbolKey(symbol: SurfaceSymbol): string // `${kind} ${name}`
function findMissing(names: readonly string[], source: readonly string[]): readonly string[] // set difference
function missingSymbols(
	symbols: readonly SurfaceSymbol[],
	source: readonly SurfaceSymbol[],
): readonly string[] // symbolKey diff
function isExternalLink(href: string): boolean // http/https/mailto/tel/# → skip
function resolveLink(from: string, target: string): string // resolve a link vs the guide's dir
function parseManifest(markdown: string, base: string): readonly ManifestEntry[] // `## By concept` → entries
function createGuide(source: string): GuideInterface // parse + cache extraction
function createSource(options: SourceOptions): SourceInterface // pure reflection over `options.files`
```

## 5. The check catalog

Each check is a pure comparison that a passing run reduces to `expect([]).toEqual([])`. Every check pairs with an explicit **non-vacuousness guard** so a renamed heading or a moved section fails _loudly_ instead of extracting nothing and passing.

**SB — Surface bijection (kind folded in).** _Inputs:_ `guide.surface()` (each Surface table's first-column code span + its `Kind` cell, located by header text; plus each backticked entity H3 as `{name, kind:'class'}`) vs `source.exports()`. _Algorithm:_ `missingSymbols` both directions over `symbolKey` — so a symbol can drift in neither name **nor** kind (kind agreement is not a separate check; it is baked into the key). Names are normalized to their identifier prefix (`identifierOf`) — generic parameters written in a doc cell or heading (`MarkdownHandler<TNode, T>`) are annotation, not part of the bijection key. _Guard:_ `guide.surface().length > 0`. _Failing diff:_ `[ 'function flattenText' ]` (an export with no Surface row) or `[ 'const MAX_DEPTH' ]` (documented `function`, declared `const`).

**MB — Methods bijection + class-no-extra.** _Inputs:_ per `MethodGroup`, its documented `methods` vs `source.methods(group.interface)`. _Algorithm:_ `findMissing` both directions; then derive the implementer by convention (`XInterface → X`) and assert `findMissing(source.methods('X'), group.methods)` is empty — the class exposes **no** public method the interface does not document. The scanner's member regex already excludes `constructor`, getters/setters, `static`, and `#` privates, and the documented `readonly document`-style data member never matches (no `(`), so this mirrors §22's method-vs-data-member line exactly. Interface names and method-table names are likewise normalized to their identifier prefix (`identifierOf`), so a generic interface heading (`` `HandlerInterface<T>` ``) still matches the bare `HandlerInterface` from the source. _Guard:_ `group.methods.length > 0`. _Failing diff:_ `[ 'stream' ]`.

**LI — Link integrity.** _Inputs:_ `guide.links()` (a full-AST `filter(isLinkNode)` — table cells included). _Algorithm:_ drop `isExternalLink` hrefs, `resolveLink` the rest against the guide's directory, keep those failing `source.exists`. _Guard:_ the SB/MB extractions already prove the AST walk is live. _Failing diff:_ `[ 'src/core/gone.ts' ]`.

**TE — Tests-link existence.** _Inputs:_ `guide.tests()` (the `## Tests` bullet links). _Algorithm:_ `resolveLink` + `source.exists`; keep the missing. _Failing diff:_ `[ 'tests/src/core/missing.test.ts' ]`.

**NV — Non-vacuousness (the minimal structure guard).** Not a body of anatomy rules — just the assertions that keep every other check honest: `parseManifest` yields ≥1 entry (an empty manifest must not pass a whole empty suite), `guide.surface()` is non-empty, and each `MethodGroup` is non-empty. A guide whose `## Surface` or `## Methods` heading was renamed extracts an empty set and **fails here**, rather than passing vacuously. Full anatomy linting, backtick-prose resolution, and pattern typechecking are deferred (§10).

## 6. The drop-in

This is the centerpiece: the entire consumer-side footprint is one short test file, one vitest project, one script.

**`tests/guides/src/parity.test.ts`** (blessed, ~45 lines):

This example gathers its file inventory with a compact `node:fs` walk — the test file runs under vitest's Node environment, so `node:fs` is available there even though the package itself never imports it. A browser-vitest consumer would gather the same inventory with `import.meta.glob('/**/*.ts', { eager: true, query: '?raw', import: 'default' })` instead.

```ts
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
	createGuide,
	createSource,
	findMissing,
	isExternalLink,
	missingSymbols,
	parseManifest,
	resolveLink,
} from '@orkestrel/guide'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

function walk(dir: string, acc: Record<string, string>): void {
	for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
		const relative = `${dir}/${entry.name}`
		if (entry.isDirectory()) {
			walk(relative, acc)
			continue
		}
		if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.md')) continue
		acc[relative] = readFileSync(join(ROOT, relative), 'utf8')
	}
}

const files: Record<string, string> = {}
walk('.', files)

function readText(relative: string): string {
	const text = files[relative]
	if (text === undefined) throw new Error(`Missing file: ${relative}`)
	return text
}

const manifest = parseManifest(readText('guides/README.md'), 'guides')

it('manifest lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

for (const entry of manifest) {
	const guide = createGuide(readText(entry.spec))
	const source = createSource({ files, module: entry.source })

	describe(entry.concept, () => {
		it('extracts a non-empty documented surface', () => {
			expect(guide.surface().length).toBeGreaterThan(0)
		})
		it('documents every source export', () => {
			expect(missingSymbols(source.exports(), guide.surface())).toEqual([])
		})
		it('documents only real exports', () => {
			expect(missingSymbols(guide.surface(), source.exports())).toEqual([])
		})

		for (const group of guide.methods()) {
			const members = source.methods(group.interface)
			const entity = group.interface.replace(/Interface$/, '')
			describe(group.interface, () => {
				it('documents at least one method', () => {
					expect(group.methods.length).toBeGreaterThan(0)
				})
				it('documents every interface method', () => {
					expect(findMissing(members, group.methods)).toEqual([])
				})
				it('documents no phantom method', () => {
					expect(findMissing(group.methods, members)).toEqual([])
				})
				if (entity !== group.interface) {
					it(`${entity} exposes no undocumented method`, () => {
						expect(findMissing(source.methods(entity), group.methods)).toEqual([])
					})
				}
			})
		}

		it('resolves every relative link', () => {
			const broken = guide
				.links()
				.filter((href) => !isExternalLink(href))
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(broken).toEqual([])
		})
		it('links only to test files that exist', () => {
			const missing = guide
				.tests()
				.map((href) => resolveLink(entry.spec, href))
				.filter((path) => !source.exists(path))
			expect(missing).toEqual([])
		})
	})
}
```

**`vite.config.ts`** — add a `guides` project extending the repo's existing single `srcCore` config (Node env, its own include glob), and register it. Adapted from terrain's pattern to markdown/contract's shape:

```ts
// Extends srcCore: the guides-parity suite. Node env — it reads the real
// guides/*.md and the documented source modules off disk — but resolves like core tests.
export const guides = (config?: UserConfig): UserConfig =>
	srcCore(
		mergeConfig(
			{
				test: {
					name: { label: 'guides', color: 'green' },
					include: ['tests/guides/**/*.test.ts'],
					exclude: ['tests/src/**/*.test.ts', 'tests/setup.test.ts'],
				},
			},
			config ?? {},
		),
	)

// ...in defineConfig:
test: {
	projects: [srcCore, guides]
}
```

**`package.json`** — one script:

```json
"test:guides": "vitest run --project guides"
```

Add `test:guides` to the `prepublishOnly` gate chain after the existing test step. That is the whole adoption footprint.

## 7. Source-scanning fidelity

`Source` reflects truth with **line scanners over source text**, not the TypeScript compiler API — a direct port of terrain's proven `setupGuides.ts` scanners, ported to be explicitly fs-free: every scanner takes source text (or a body's lines) as a plain argument, and it is the *consumer* who supplies that text — from a file inventory gathered however their environment allows. The scanning mechanics themselves are unchanged from the original disk-backed port.

- **Exports.** Per module file's text, `exportsFrom` matches `^export (?:async )?(function|class|const|interface|type) (\w+)` → `{name, kind}`. The name is always on the first line even when oxfmt wraps the signature, so no join is needed here.
- **Members.** `declarationBody(source, keyword, name)` finds the declaration head within one file's text, uses `joinHead` to fold an oxfmt-wrapped head (printWidth 100; nested generics like `<T = Record<string, unknown>>` still match) into one line ending in `{`, then collects lines to the column-0 `}`. `memberMethods` matches `^\t(?:async )?\*?(\w+)(<[^>]*>)?\??\(` — plain / `async` / generator / optional methods count; getters, setters, `static`, `#` privates, and data members never do (their shape breaks the `name(` match); `constructor` is filtered out.
- **File selection.** `moduleKeys(files, module)` filters the consumer-supplied file inventory's keys to each `GuideModule` directory's `.ts` files, unions multi-dir scopes, and excludes `index.ts` and `*.test.ts` — the pure, inventory-keys equivalent of the old disk walk.

```ts
export function joinHead(
	lines: readonly string[],
	start: number,
): { text: string; end: number } | undefined {
	const parts: string[] = []
	for (let i = start; i < lines.length; i += 1) {
		const line = lines[i]
		if (line === undefined) break
		parts.push(i === start ? line.trimEnd() : line.trim())
		if (line.trimEnd().endsWith('{')) return { text: parts.join(' '), end: i }
	}
	return undefined
}
```

**Why line scanning has high fidelity here — and is the right v1 choice.** AGENTS _locks the grammar the scanner assumes_, and the format/lint gates enforce that lock on every commit: §5 requires every module-scope declaration to be exported (nothing hides from the scanner), §6 permits exactly one export style, §3 mandates tabs, and oxfmt fixes the wrap shape `joinHead` decodes. The scanner reads **source text**, so type-only exports (`export interface`, `export type`) — the exact symbols invisible to runtime reflection — are trivially visible. It has zero dependencies, runs in milliseconds, and needs no peer compiler.

**Honest limits.** The approach is _style-coupled_: a repo that does not obey AGENTS' export style, indentation, or format width would mis-scan. That is an acceptable v1 constraint because the target repos are exactly the ones whose gates enforce the style. The TypeScript compiler API (a `Source` variant reflecting via `getExportsOfModule` / call signatures, behind the same `SourceInterface`) is the natural **future hardening** for non-conforming or cross-language consumers — not v1.

## 8. Testing strategy, including dogfooding

- **Unit tests mirror source** (§16): `tests/src/core/parsers.test.ts` (guide + manifest extraction, incl. entity-heading surface and multi-dir Source cells, plus the scanner grammar — `exportsFrom`, `joinHead` on wrapped heads, `declarationBody`), `helpers.test.ts` (`symbolKey`, `findMissing`, `missingSymbols`, `resolveLink`, `firstCode`, `kindIndex`, `moduleDirs`, `moduleKeys`), `Guide.test.ts`, `Source.test.ts` (pure reflection against an in-memory fixture inventory, incl. `memberMethods` on every excluded shape).
- **Fixture guides** (`tests/fixtures/`): one _good_ guide + tiny fixture module that passes every check, plus one _broken_ fixture per failure mode (undocumented export, wrong Kind, extra class method, broken link, missing test, renamed `## Surface`) — each isolating one check's red path and its non-vacuousness guard. Deterministic, no network.
- **Self-dogfooding** (acceptance criterion): the package ships its own `guides/src/guide.md` documenting `GuideInterface` / `SourceInterface` (with `## Methods`), and its own `tests/guides/src/parity.test.ts` runs the drop-in against this repo — the checker must pass its own checker.

## 9. Adoption plan — `contract` and `markdown`

For **both** repos: add `@orkestrel/guide` as a devDependency, drop in `tests/guides/src/parity.test.ts` (§6), add the `guides` vitest project and the `test:guides` script (into `prepublishOnly` after `test`), then run once and reconcile whatever surfaces (undocumented exports, extra class surface, kind drift, broken links) — docs or code, per §22. Both `## By concept` tables already expose `Spec` / `Source` / `Tests` pointing at the exact dirs the helpers resolve, so no manifest changes are required.

For **markdown** specifically: it has no `## Contract` section in `markdown.md` where `contract.md` does. This is out of v1's mechanical scope (NV does not require it), but the asymmetry should be noted and closed by hand when the guides are next revised.

## 10. Risks & future work

**Risks (priority-ordered):**

1. **Style-coupling of the line scanners** — a source file that violates AGENTS' export/format grammar mis-scans, potentially a false parity failure. _Mitigation:_ the target repos' format + lint gates enforce that grammar on every commit; the `memberMethods` / `joinHead` edge cases (wrapped heads, nested generics, every excluded member shape) are unit-tested against fixtures; the TS-compiler `Source` variant is the documented escape hatch if a consumer ever needs it.
2. **Entity-heading kind inference** — a backticked `## Surface` H3 is assumed to document a `class`. _Mitigation:_ that matches the anatomy convention and the only current case (`Markdown`); a non-class entity heading would fail SB loudly (visible, not silent), signaling the guide to add a table row instead.
3. **Convention-derived implementer name** (`XInterface → X`) — a class named against convention would skip its no-extra check. _Mitigation:_ the interface↔doc bijection still fully covers the documented set; only the _extra-method_ guard depends on the name mapping, and a mismatch degrades to a safe no-op rather than a false pass.

**Future work (post-v1):** the TS-compiler-API `Source` for cross-language/non-conforming repos; backtick-prose resolution (every prose backtick resolves to an export, a member, an attributed external, or a language literal); `## Patterns` fence typechecking; a tests-mirror sub-check (every behavioral source file has a linked test).

## 11. Roadmap

- **v0.1 — the port.** Core `Guide` + `parseManifest`; pure `Source` line scanners over a consumer-supplied file inventory; the pure comparison helpers; checks SB, MB (+ class-no-extra), LI, TE, and the NV guards. Self-dogfooded against this repo's own `guides/`. One runtime dependency (`@orkestrel/markdown`), no compiler.
- **v1.0 — adopted.** `contract` and `markdown` both green on the drop-in; `markdown.md`'s missing `## Contract` reconciled. API stable.
