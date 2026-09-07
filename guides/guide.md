# Guide

> A pure, I/O-free guides-parity toolkit: `Guide` extracts a markdown guide's documented
> surface, method groups, links, test links, and fenced code blocks; `Source` reflects direct
> declarations and conventional barrel reachability from a consumer-supplied file inventory through pure text
> scanners (no filesystem or TypeScript compiler API); runtime dependencies provide markdown
> and contract primitives, while comparison helpers (`findMissingSymbols`, `findMissing`,
> `resolveLink`, …) reduce every guides-parity check to `expect([]).toEqual([])`
> (`.claude/rules/documentation.md`). Source: [`src/core`](../src/core). Published through `@orkestrel/guide`.

A guide is a contract, not prose. `createGuide(markdown)` parses a guide's
source once (through `@orkestrel/markdown`) into a `GuideInterface` — its `## Surface` identifiers
(keyword-tagged), its `## Methods` interface/method groups, every link, its `## Tests`
links, and every fenced code block, each cached at construction.
`createSource({ files, module })` builds a
`SourceInterface` that reflects intentional direct declarations, conventional barrel-reachable
declarations, and interface/class methods by scanning a consumer-gathered file inventory with
plain-text line scanners, never touching disk itself. `createSourceManager({ files, modules })`
resolves the consumer's own import specifiers onto those views, one shared `Source` per module, so
a check that meets an import decides from the specifier alone which face of the package it names.
A guides-parity test asserts direct declarations equal the barrel surface and the barrel surface
equals the documented surface, in both directions. `parseManifest` reads a `guides/README.md`'s
`## By concept` table into the list of `{ concept, spec, source, tests }` entries a suite
iterates to run this check once per documented concept.

## Surface

### Types

The manifest/extraction shapes every check is built from, from [`types.ts`](../src/core/types.ts).

| Name                     | Kind      | Shape                                                                                                                                                                                                                                         |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExportKeyword`          | type      | `'type' \| 'interface' \| 'const' \| 'function' \| 'class'` — the declaration-keyword reflection population, derived from `EXPORT_KEYWORDS`. Comment/template payload and enums are outside it; general package policy does not forbid enums. |
| `SurfaceSymbol`          | interface | `{ name, keyword, summary? }` — one documented / exported symbol; `summary` holds the compared description paragraph its side carries.                                                                                                        |
| `GuideModule`            | type      | `string \| readonly string[]` — one source directory, or several; `'.'` is the canonical workspace root.                                                                                                                                      |
| `SourceLine`             | interface | `{ source, code, jsdoc }` — one terminator-free physical source line with exact raw text, equal-length projections, and every genuine JSDoc span at its physical column or `undefined`.                                                       |
| `SourceComment`          | interface | `{ text, line }` — one eligible genuine JSDoc block's unwrapped body paired with the physical record it documents.                                                                                                                            |
| `MethodEntry`            | interface | `{ name, summary? }` — one documented method's identifier and the compared description paragraph its side carries.                                                                                                                            |
| `SourceExample`          | interface | `{ name, title?, code, language? }` — one `@example` block: the declaration it documents, its pairing title, its code, and its fence language.                                                                                                |
| `Drift`                  | interface | `{ key, guide?, source? }` — one disagreement between a guide and its source, the side carrying no text omitted.                                                                                                                              |
| `ManifestEntry`          | interface | `{ concept, spec, source, tests }` — one `## By concept` manifest row, paths normalized to workspace root.                                                                                                                                    |
| `MethodGroup`            | interface | `{ interface, methods }` — one `#### Interface` block's documented `MethodEntry` rows, in table order.                                                                                                                                        |
| `FenceImport`            | interface | `{ specifier, names }` — one brace `import` statement projected from a guide fence, each alias resolved to the original exported name.                                                                                                        |
| `GuideFence`             | interface | `{ language, code, title? }` — one fenced code block; `language` is its info-string tag, or `undefined` when the fence is untagged, and `title` is the flattened text of its nearest preceding heading.                                       |
| `GuideInterface`         | interface | `{ sections, tagline, surface, methods, unnamed, links, tests, fences }` — the structured, pure view over one parsed guide. See [`## Methods`](#methods).                                                                                     |
| `SourceInterface`        | interface | `{ exports, surface, methods, exists, hidden, examples }` — direct declarations, conventional barrel reachability, members, paths, discipline, and examples. See [`## Methods`](#methods).                                                    |
| `SourceManagerInterface` | interface | `{ source, sources }` — resolves one import specifier to the shared source view of the module it names, and enumerates those views. See [`## Methods`](#methods).                                                                             |
| `SourceOptions`          | interface | `{ files, module }` — exact canonical-segment opaque workspace-relative inventory keys plus the canonicalized module scope to reflect.                                                                                                        |
| `SourceManagerOptions`   | interface | `{ files, modules }` — one shared inventory plus the consumer's own specifier-to-module policy.                                                                                                                                               |
| `DeclarationHead`        | interface | `{ text, end }` — a declaration head joined into one line (across an oxfmt-wrapped signature) plus the index of the line ending in `{`.                                                                                                       |
| `Declaration`            | interface | `{ body, bases }` — one located `export class` / `export interface` declaration, its body lines and its base identifiers read from the same head.                                                                                             |
| `DeclarationKeyword`     | type      | `'class' \| 'interface'` — which declaration head `extractDeclaration` and `Source` locate; the `ExportKeyword` subset carrying a documented member body.                                                                                     |

### Constants

The declaration-keyword population, the section-heading keys, and the external-link schemes every
extractor and link check is keyed on, from [`constants.ts`](../src/core/constants.ts).

| Name               | Kind  | Behavior                                                                                                                                                    |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPORT_KEYWORDS`  | const | `['type', 'interface', 'const', 'function', 'class']` — the frozen population `ExportKeyword`, `isExportKeyword`, and `surfaceSymbolShape` all derive from. |
| `SURFACE`          | const | `'Surface'` — the `## Surface` heading text.                                                                                                                |
| `METHODS`          | const | `'Methods'` — the `## Methods` heading text.                                                                                                                |
| `TESTS`            | const | `'Tests'` — the `## Tests` heading text.                                                                                                                    |
| `MANIFEST`         | const | `'By concept'` — the `## By concept` manifest heading text.                                                                                                 |
| `KIND`             | const | `'Kind'` — the header text of the column a `## Surface` table's declaration keyword is read from.                                                           |
| `SUMMARY`          | const | `'Summary'` — the header text of the column a `## Surface` or `## Methods` table's compared description paragraph is read from.                             |
| `EXTERNAL_SCHEMES` | const | `readonly string[]` — `['http:', 'https:', 'mailto:', 'tel:']`; a link with one of these prefixes is never filesystem-resolved.                             |
| `WRAP_WIDTH`       | const | `100` — the default character budget a rewritten doc block's description paragraph wraps inside, counting a tab as one character.                           |

### Helpers

Pure, total leaves from [`helpers.ts`](../src/core/helpers.ts) — the source-line projection,
the declaration, member, JSDoc, and guide-document grammars built on it, and the comparison and
path primitives `Guide`, `Source`, `parsers.ts`, and a consumer's parity test all reach for
directly.

| Name                    | Kind     | Signature                                                                                                 | Behavior                                                                                                                                                                                                                                                                                                               |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizeDirectories`  | function | `(module: GuideModule) => readonly string[]`                                                              | Canonicalizes through `resolvePath`, uses `'.'` for root, and removes duplicates in first-seen order.                                                                                                                                                                                                                  |
| `computeModuleKey`      | function | `(module: GuideModule) => string`                                                                         | The stable cache key for a module scope — its normalized directories joined by NUL, so two spellings of one module share a key and no directory boundary can collide with directory text.                                                                                                                              |
| `selectModuleKeys`      | function | `(files: Readonly<Record<string, string>>, module: GuideModule) => readonly string[]`                     | Selects exact canonical-segment opaque `.ts` keys under any scope and excludes every selected exact `index.ts` plus `*.test.ts`; sorted.                                                                                                                                                                               |
| `hasCanonicalSegments`  | function | `(key: string) => boolean`                                                                                | Rejects empty, `.` and `..` slash-separated segments without normalization while retaining ordinary dotfiles.                                                                                                                                                                                                          |
| `computeSymbolKey`      | function | `(symbol: SurfaceSymbol) => string`                                                                       | The bijection key for a surface symbol — `${keyword} ${name}` — so a symbol comparison diffs (name, keyword) pairs, not names alone.                                                                                                                                                                                   |
| `findMissing`           | function | `(names: readonly string[], source: readonly string[]) => readonly string[]`                              | The names present in `names` but absent from `source` — the set-difference behind a both-directions bijection assertion.                                                                                                                                                                                               |
| `findMissingSymbols`    | function | `(symbols: readonly SurfaceSymbol[], source: readonly SurfaceSymbol[]) => readonly string[]`              | The `computeSymbolKey` set-difference between two symbol lists.                                                                                                                                                                                                                                                        |
| `extractSourceLines`    | function | `(source: string) => readonly SourceLine[]`                                                               | Equal-length physical source, code, and JSDoc projection with bounded literal Unicode identifier slash state.                                                                                                                                                                                                          |
| `extractExports`        | function | `(source: string) => readonly SurfaceSymbol[]`                                                            | Direct declaration-keyword exports over projected lines with an uninterrupted column-zero head; projection never widens membership.                                                                                                                                                                                    |
| `extractHidden`         | function | `(source: string) => readonly SurfaceSymbol[]`                                                            | The non-exported mirror with the same projected, uninterrupted column-zero head and declaration-keyword population.                                                                                                                                                                                                    |
| `joinHead`              | function | `(lines: readonly string[], start: number) => DeclarationHead \| undefined`                               | Joins a declaration head starting at `start` into one space-separated line, consuming lines until the first ending in `{`.                                                                                                                                                                                             |
| `escapeRegExp`          | function | `(value: string) => string`                                                                               | Escapes every regex metacharacter in a literal string so it reads as text inside a larger `RegExp` source — `extractDeclaration`'s head grammar and `findUnexampled`'s word-boundary search both splice a caller-supplied name through it.                                                                             |
| `extractDeclaration`    | function | `(source: string, keyword: DeclarationKeyword, name: string) => Declaration \| undefined`                 | Locates one real `export class` / `export interface` head in projected lines and returns its raw body and its `extends` bases together, or `undefined` when the file declares no such head.                                                                                                                            |
| `extractMemberMethods`  | function | `(lines: readonly string[]) => readonly MethodEntry[]`                                                    | Matches callable members on one projection of the body, each with its own doc block's description paragraph; commented candidates, getters, setters, `static`, and `#` privates never count.                                                                                                                           |
| `extractSourceComments` | function | `(lines: readonly SourceLine[]) => readonly SourceComment[]`                                              | Every eligible genuine JSDoc block paired with the physical record it documents — the one walk every doc-block reader shares.                                                                                                                                                                                          |
| `normalizeComment`      | function | `(comment: string) => string`                                                                             | One genuine JSDoc span's unwrapped body: opener, closing marker, continuation markers, and the block's leading indentation removed, per-line trailing whitespace trimmed.                                                                                                                                              |
| `unwrapComment`         | function | `(comment: string) => readonly string[]`                                                                  | The same unwrapping as one content line per physical line, aligned with `comment.split('\n')`, so an index found in it addresses the same line of the span it was built from.                                                                                                                                          |
| `buildComment`          | function | `(lines: readonly string[], indent: string) => string`                                                    | One genuine JSDoc span built from its content lines — the inverse of `unwrapComment`, each line behind a continuation marker at `indent` and an empty line as the bare marker.                                                                                                                                         |
| `wrapText`              | function | `(text: string, width: number) => readonly string[]`                                                      | One paragraph wrapped into greedy lines no longer than `width`; a word longer than `width` takes its own line rather than being split.                                                                                                                                                                                 |
| `normalizeSummary`      | function | `(text: string) => string`                                                                                | The compared form of a description paragraph — single-backtick code spans located first, `{@link}` targets outside them rendered as code tokens, whitespace collapsed, the ends trimmed, and each located span's own boundary whitespace trimmed.                                                                      |
| `maskFences`            | function | `(text: string) => string`                                                                                | One doc block's unwrapped text with every fenced body replaced by aligned spaces, so a tag search reads the block's structure and never its example code.                                                                                                                                                              |
| `collectSummaries`      | function | `(lines: readonly SourceLine[]) => ReadonlyMap<SourceLine, string>`                                       | The description paragraph of every documented record, keyed by the record; a block carrying no description contributes no entry.                                                                                                                                                                                       |
| `extractBodyLines`      | function | `(lines: readonly string[]) => readonly SourceLine[]`                                                     | A declaration body's aligned physical records, read inside an owner head the reader supplies so each callable member keys to its owner; that head's own record opens the projection.                                                                                                                                   |
| `collectKeys`           | function | `(lines: readonly SourceLine[]) => ReadonlyMap<SourceLine, string>`                                       | The compared key of every record a key names — a `computeSymbolKey` symbol key for a column-zero `export` head, an `Owner.member` key for a one-tab callable member inside one — keyed by the record; the owner closes at the first column-zero `}` or at a column-zero `export` declaration carrying another keyword. |
| `collectExamples`       | function | `(comment: string, name: string) => readonly SourceExample[]`                                             | The `@example` blocks one doc block's unwrapped text carries, each with its title, its fence language, and its body.                                                                                                                                                                                                   |
| `extractExampleLines`   | function | `(lines: readonly SourceLine[]) => readonly SourceLine[]`                                                 | The `extractSourceComments` walk filtered to the blocks carrying an `@example` tag opening a line at its first non-blank column, projected to the records they document.                                                                                                                                               |
| `extractExamples`       | function | `(source: string) => readonly SourceExample[]`                                                            | The exported functions' `@example` blocks, matched against shared eligible genuine JSDoc adjacency and aligned code.                                                                                                                                                                                                   |
| `extractExampleMethods` | function | `(lines: readonly string[]) => readonly SourceExample[]`                                                  | The callable members' `@example` blocks, matched against the same shared eligible genuine JSDoc adjacency and aligned code.                                                                                                                                                                                            |
| `selectSectionBlocks`   | function | `(document: MarkdownDocument, heading: string) => readonly BlockNode[]`                                   | The block nodes under a named `##` heading, up to the next `##`-or-higher heading (or the document's end).                                                                                                                                                                                                             |
| `extractTagline`        | function | `(document: MarkdownDocument) => string \| undefined`                                                     | The text of the blockquote following the document's H1, or `undefined` when a heading intervenes first.                                                                                                                                                                                                                |
| `extractSurface`        | function | `(document: MarkdownDocument) => readonly SurfaceSymbol[]`                                                | Every `## Surface` identifier: each table's rows union every backticked H3 entity heading, deduped by `computeSymbolKey`, each row carrying its `Summary` cell when the table has that column.                                                                                                                         |
| `extractMethods`        | function | `(document: MarkdownDocument) => readonly MethodGroup[]`                                                  | One `MethodGroup` per documented behavioral interface in `## Methods` — an H4 code span sets the interface, the following table lists its entries.                                                                                                                                                                     |
| `collectGroups`         | function | `(document: MarkdownDocument) => ReadonlyMap<TableNode, string>`                                          | Each `## Methods` table keyed to the interface its H4 names, in document order — the node-addressed form a rewrite locates a row's table through.                                                                                                                                                                      |
| `extractUnnamed`        | function | `(document: MarkdownDocument) => readonly string[]`                                                       | Every `## Surface` or `## Methods` row whose first cell carries no code span — the rows `extractSurface` and `extractMethods` skip for want of a name, each returned as its cells' text on one line.                                                                                                                   |
| `extractLinks`          | function | `(document: MarkdownDocument) => readonly string[]`                                                       | Every link href in the guide document, including table cells — a full, depth-first AST walk.                                                                                                                                                                                                                           |
| `extractTests`          | function | `(document: MarkdownDocument) => readonly string[]`                                                       | The relative test links declared under `## Tests`.                                                                                                                                                                                                                                                                     |
| `extractFences`         | function | `(document: MarkdownDocument) => readonly GuideFence[]`                                                   | Every fenced code block anywhere in the guide document, tagged or not, each carrying its nearest preceding heading as `title` — a full AST walk with no language filter.                                                                                                                                               |
| `collectFences`         | function | `(document: MarkdownDocument) => ReadonlyMap<CodeBlockNode, GuideFence>`                                  | Each fenced code block keyed by its own node, paired with the `GuideFence` `extractFences` reports for it — the node-addressed form a rewrite reads a fence's source region through.                                                                                                                                   |
| `isExternalLink`        | function | `(href: string) => boolean`                                                                               | Whether a guides-parity link check skips a link `href` — an external scheme (`EXTERNAL_SCHEMES`) or a bare `#` anchor.                                                                                                                                                                                                 |
| `resolveLink`           | function | `(file: string, target: string) => string`                                                                | Derives a declaring file's directory, including workspace-root files, then delegates to `resolvePath`.                                                                                                                                                                                                                 |
| `resolvePath`           | function | `(directory: string, target: string) => string`                                                           | Sole dot-segment reducer; returns `'.'` when no segment remains and preserves every excess leading parent.                                                                                                                                                                                                             |
| `findFirstCode`         | function | `(nodes: readonly InlineNode[]) => string \| undefined`                                                   | The first code-span value found by descending an inline node list, following into `emphasis`, `link`, and `image` children.                                                                                                                                                                                            |
| `normalizeIdentifier`   | function | `(code: string) => string`                                                                                | The identifier prefix of a code-span text — everything before its first `<`, trimmed (strips generic-parameter annotation).                                                                                                                                                                                            |
| `findColumnIndex`       | function | `(table: TableNode, header: string) => number \| undefined`                                               | The index of the column whose header text is `header`, found by that text so a table's columns survive reordering.                                                                                                                                                                                                     |
| `extractRowSymbol`      | function | `(table: TableNode, row: number) => SurfaceSymbol \| undefined`                                           | One `## Surface` row's symbol — its code-span name, its `Kind` keyword, and its `Summary` cell; `undefined` for a row with no code-span name and for a row whose `Kind` text is no `ExportKeyword`.                                                                                                                    |
| `extractRowEntry`       | function | `(table: TableNode, row: number) => MethodEntry \| undefined`                                             | One `## Methods` row's entry — its code-span name and its `Summary` cell; `undefined` for a row with no code-span name.                                                                                                                                                                                                |
| `extractRowSummary`     | function | `(table: TableNode, row: number) => string \| undefined`                                                  | One row's compared summary, read through `extractCellText` and `normalizeSummary`; `undefined` when the table has no `Summary` column and when the cell is empty.                                                                                                                                                      |
| `extractCellText`       | function | `(cell: readonly InlineNode[]) => string`                                                                 | One table cell's compared text, code spans kept as code spans while emphasis and a link drop to their text and an image drops to its alternative text.                                                                                                                                                                 |
| `buildCell`             | function | `(text: string) => readonly InlineNode[]`                                                                 | One cell's inline nodes built from its compared text — the inverse of `extractCellText`; a single-backtick run whose text has no inner backtick and no boundary space becomes a code span and every other character becomes literal text.                                                                              |
| `extractCellLinks`      | function | `(cell: readonly InlineNode[]) => readonly string[]`                                                      | The link hrefs found within one table cell's inline content, in walk order.                                                                                                                                                                                                                                            |
| `findUnexampled`        | function | `(names: readonly string[], fences: readonly string[], examples: readonly string[]) => readonly string[]` | The names with no fence mention (word boundary) and no `@example` membership — the EX check's core comparison.                                                                                                                                                                                                         |
| `findUnlisted`          | function | `(fences: readonly GuideFence[], languages: readonly string[]) => readonly GuideFence[]`                  | The fences whose language the caller did not list, plus every untagged fence — an untagged fence has no language to list.                                                                                                                                                                                              |
| `extractFenceImports`   | function | `(fence: string) => readonly FenceImport[]`                                                               | Parses a fence's brace `import` statements into per-specifier imported identifier names — the FI check's core comparison. Brace bindings only: a default, namespace, side-effect, or mixed `import Default, { named }` statement is not surfaced.                                                                      |
| `collectTitles`         | function | `(guide: GuideInterface, source: SourceInterface) => ReadonlyMap<string, SourceExample>`                  | The titled `@example` blocks a guide's documented surface reaches, keyed by title, the first block of a title answering for it.                                                                                                                                                                                        |
| `computeDrift`          | function | `(key: string, guide: string \| undefined, source: string \| undefined) => Drift \| undefined`            | One compared key's guide text and source text as a `Drift`, or `undefined` only when both sides carry the same text; the side carrying no text is omitted, and neither side carrying text reports the key alone.                                                                                                       |
| `findDrift`             | function | `(guide: GuideInterface, source: SourceInterface) => readonly Drift[]`                                    | Every disagreement between a guide and its source — Surface rows, Methods rows, then the first titled fence of each heading — naming both sites.                                                                                                                                                                       |
| `renderSurface`         | function | `(symbols: readonly SurfaceSymbol[]) => string`                                                           | A `Name` / `Kind` / `Summary` table rendered from the symbols a source declares, one row per symbol; a symbol with no summary renders an empty cell.                                                                                                                                                                   |
| `renderMethods`         | function | `(group: MethodGroup) => string`                                                                          | One `## Methods` group rendered as its `####` code-span heading and a `Name` / `Summary` table, one row per documented member.                                                                                                                                                                                         |
| `renderExample`         | function | `(example: SourceExample) => string`                                                                      | One `@example` block rendered as the guide fence it pairs with — an H3 heading carrying its title, then a fence carrying its language and code; an untitled block renders the fence alone.                                                                                                                             |
| `buildTable`            | function | `(table: TableNode, row: number, column: number, text: string) => TableNode`                              | A copy of a table with one cell's inline content rebuilt from `text`; every other cell, the header, and the alignment row are shared.                                                                                                                                                                                  |
| `buildFence`            | function | `(example: SourceExample) => CodeBlockNode`                                                               | The fenced code block one `@example` block renders as, untagged when the block names no language.                                                                                                                                                                                                                      |
| `spliceSpan`            | function | `(source: string, span: MarkdownSpan, replacement: string) => string`                                     | `source` with the region `span` addresses written over by `replacement`, every byte outside it travelling unchanged.                                                                                                                                                                                                   |
| `replaceCell`           | function | `(guide: string, key: string, summary: string) => string \| undefined`                                    | A guide's text with one compared cell replaced, the key named the way `findDrift` names it; `undefined` when the key reaches no cell, and the guide byte for byte when the row already carries the summary.                                                                                                            |
| `replaceFence`          | function | `(guide: string, title: string, example: SourceExample) => string \| undefined`                           | A guide's text with the first fence of `title` taking the block's language and code; `undefined` when no fence carries the title, and the guide byte for byte when the fence already carries that body.                                                                                                                |
| `replaceSummary`        | function | `(comment: string, summary: string, width?: number) => string \| undefined`                               | One doc block's raw text with its description paragraph replaced and re-wrapped inside `width`, every tag line and the blank separator kept; the block byte for byte when it already carries the summary, and `undefined` for a text that is no doc block and for a summary carrying no word.                          |
| `replaceExample`        | function | `(comment: string, example: SourceExample) => string \| undefined`                                        | One doc block's raw text with the body of the `@example` tag of that title replaced by a fence of the block's language and code; `undefined` for a text that is no doc block, for a title no tag carries, and for code the emitted three-backtick fence cannot enclose.                                                |
| `locateComment`         | function | `(text: string, key: string) => MarkdownSpan \| undefined`                                                | The character region of the doc block a compared key attaches to inside one file's text, indentation included — the span a caller slices, rewrites, and splices back through `spliceSpan`; `undefined` when no block carries the key.                                                                                  |

### Parsers

The manifest coercer, from [`parsers.ts`](../src/core/parsers.ts) — the one scanner that turns
markdown text into typed values, composed out of `helpers.ts`'s leaves.

| Name            | Kind     | Signature                                                           | Behavior                                                                                                                  |
| --------------- | -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `parseManifest` | function | `(markdown: string, directory: string) => readonly ManifestEntry[]` | Resolves manifest links and canonicalizes Source values through `normalizeDirectories`, preserving one-versus-many shape. |

### Shapers

Declarative `ContractShape` values (from `@orkestrel/contract`) from
[`shapers.ts`](../src/core/shapers.ts) — every documented data type here is
non-recursive, so each shapes directly.

| Name                 | Kind  | Builds                                                                                                |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `surfaceSymbolShape` | const | The shape of a `SurfaceSymbol` — `{ name: string, keyword: ExportKeyword, summary?: string }`.        |
| `methodGroupShape`   | const | The shape of a `MethodGroup` — `{ interface: string, methods: readonly MethodEntry[] }`.              |
| `methodEntryShape`   | const | The shape of a `MethodEntry` — `{ name: string, summary?: string }`.                                  |
| `sourceExampleShape` | const | The shape of a `SourceExample` — `{ name: string, title?: string, code: string, language?: string }`. |
| `driftShape`         | const | The shape of a `Drift` — `{ key: string, guide?: string, source?: string }`.                          |
| `manifestEntryShape` | const | The shape of a `ManifestEntry` — `source` accepting a single directory or several.                    |

### Validators

Total from-unknown guards composed from `@orkestrel/contract` combinators, from
[`validators.ts`](../src/core/validators.ts).

| Name              | Kind  | Narrows to / Tests | Behavior                                                               |
| ----------------- | ----- | ------------------ | ---------------------------------------------------------------------- |
| `isExportKeyword` | const | `value: unknown`   | `true` when `value` is one of the documented `ExportKeyword` literals. |
| `isSurfaceSymbol` | const | `value: unknown`   | `true` when `value` is a well-formed `SurfaceSymbol`.                  |
| `isMethodGroup`   | const | `value: unknown`   | `true` when `value` is a well-formed `MethodGroup`.                    |
| `isMethodEntry`   | const | `value: unknown`   | `true` when `value` is a well-formed `MethodEntry`.                    |
| `isSourceExample` | const | `value: unknown`   | `true` when `value` is a well-formed `SourceExample`.                  |
| `isDrift`         | const | `value: unknown`   | `true` when `value` is a well-formed `Drift`.                          |
| `isManifestEntry` | const | `value: unknown`   | `true` when `value` is a well-formed `ManifestEntry`.                  |

### Factories

From [`factories.ts`](../src/core/factories.ts).

| Name                          | Kind     | Signature                                                   | Behavior                                                                                               |
| ----------------------------- | -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createGuide`                 | function | `(source: string) => GuideInterface`                        | Creates a structured `GuideInterface` view over one guide's markdown source.                           |
| `createSource`                | function | `(options: SourceOptions) => SourceInterface`               | Creates a pure `SourceInterface` over a consumer-supplied file inventory.                              |
| `createSourceManager`         | function | `(options: SourceManagerOptions) => SourceManagerInterface` | Creates a `SourceManagerInterface` over a specifier-to-module policy, sharing one `Source` per module. |
| `createSurfaceSymbolContract` | function | `() => ContractInterface<SurfaceSymbol>`                    | Compiles `surfaceSymbolShape` into a guard / parser / schema / generator bundle.                       |
| `createMethodGroupContract`   | function | `() => ContractInterface<MethodGroup>`                      | Compiles `methodGroupShape` into a guard / parser / schema / generator bundle.                         |
| `createMethodEntryContract`   | function | `() => ContractInterface<MethodEntry>`                      | Compiles `methodEntryShape` into a guard / parser / schema / generator bundle.                         |
| `createSourceExampleContract` | function | `() => ContractInterface<SourceExample>`                    | Compiles `sourceExampleShape` into a guard / parser / schema / generator bundle.                       |
| `createDriftContract`         | function | `() => ContractInterface<Drift>`                            | Compiles `driftShape` into a guard / parser / schema / generator bundle.                               |
| `createManifestEntryContract` | function | `() => ContractInterface<ManifestEntry>`                    | Compiles `manifestEntryShape` into a guard / parser / schema / generator bundle.                       |

### `Guide`

The implementing class of `GuideInterface`, from [`Guide.ts`](../src/core/Guide.ts). A
pure, structured view over one parsed guide: parses `source` once through
`@orkestrel/markdown` and never touches the filesystem — `Guide` reads only the markdown
text it is given and records nothing about where the guide came from. Every accessor
returns the same cached, readonly array on every call. See [`## Methods`](#methods) for its
public call-signature surface.

### `Source`

The implementing class of `SourceInterface`, from [`Source.ts`](../src/core/sources/Source.ts). A
pure reflection over a consumer-supplied file inventory (root-relative path → file text) plus a
module scope. `exports()` inventories direct `type`, `interface`, `const`, `function`, and
`class` declarations in the selected canonical directories' exact opaque module keys over
comment/template-excluded projected code lines; `enum` is outside this reflection population without being forbidden by
general package policy;
`surface()` inventories declarations reachable through each selected directory's conventional
root barrel. Both projections are computed on first access, cached, deduplicated by name and
keyword, and sorted by name. Member structure comes from projected lines while raw bodies preserve
JSDoc evidence, and `methods(name)` resolves a declaration's members through its `extends` chain
within the same module scope, reading the first file that declares the name. `Source` never uses the
TypeScript compiler API or filesystem; the consumer gathers `files` however its environment
allows. See [`## Methods`](#methods) for the public call-signature surface.

### `SourceManager`

The implementing class of `SourceManagerInterface`, from
[`SourceManager.ts`](../src/core/sources/SourceManager.ts). It answers one question a bare `Source`
cannot: a guide fence may import from a face of the package this `Source` does not cover, and the
check needs the right `Source` for whichever specifier the fence names. `modules` is the consumer's
own policy — it maps each import specifier the package publishes to the source module behind it —
and `SourceManager` never infers or normalizes that map. `source(specifier)` returns `undefined` for
an unmapped specifier, and a fence-import check skips the import on that signal; a mapped specifier
is local. `sources()` enumerates the same views, one per distinct module the policy maps, so a
check that must sweep every face of the package reads them without repeating the policy. One
`Source` is cached per module, so two specifiers naming one module share one entity and the
inventory is scanned once. See [`## Methods`](#methods) for its public call-signature surface.

## Methods

The public methods of each behavioral interface — one table per type, keyed by its
backticked name (`.claude/rules/documentation.md` § Parity).

#### `GuideInterface`

| Method     | Returns                    | Behavior                                                                                                                                                                        |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sections` | `readonly string[]`        | The `##` heading names, in document order — the non-vacuousness guard for section presence.                                                                                     |
| `tagline`  | `string \| undefined`      | The text of the blockquote following the H1 — the guide's tagline, or `undefined` when a heading intervenes first.                                                              |
| `surface`  | `readonly SurfaceSymbol[]` | Every `## Surface` identifier + keyword — table rows union backticked entity headings, each row carrying its `Summary` cell when the table has that column.                     |
| `methods`  | `readonly MethodGroup[]`   | One `MethodGroup` per documented behavioral interface in `## Methods`, each row carrying its `Summary` cell.                                                                    |
| `unnamed`  | `readonly string[]`        | Every `## Surface` or `## Methods` row whose first cell carries no code span — the rows `surface` and `methods` skip for want of a name, so no bijection check can report them. |
| `links`    | `readonly string[]`        | Every link href in the guide, including table cells.                                                                                                                            |
| `tests`    | `readonly string[]`        | The relative test links declared under `## Tests`.                                                                                                                              |
| `fences`   | `readonly GuideFence[]`    | Every fenced code block in the whole document, tagged or not, each carrying its nearest preceding heading as `title` — no language filter.                                      |

#### `SourceInterface`

| Method     | Returns                    | Behavior                                                                                                                                                                                                                                                                            |
| ---------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exports`  | `readonly SurfaceSymbol[]` | What the package **declares** — direct `type`, `interface`, `const`, `function`, and `class` declarations in the selected module keys.                                                                                                                                              |
| `surface`  | `readonly SurfaceSymbol[]` | What a consumer can **import** — every declaration reachable through the selected directories' conventional root `index.ts` barrels.                                                                                                                                                |
| `methods`  | `readonly MethodEntry[]`   | The call-signature members of the `class` / `interface` named `name`, unioned with those of every declaration it extends within the module scope, each with its own doc block's description paragraph. The first file declaring the name answers for it.                            |
| `exists`   | `boolean`                  | Whether a workspace-root-relative path names an inventory key exactly, or a directory any inventory key sits beneath — which is what lets a guide link to a directory resolve.                                                                                                      |
| `hidden`   | `readonly SurfaceSymbol[]` | Every module-scope declaration **lacking** `export` (`.claude/rules/architecture.md` § Barrel exports).                                                                                                                                                                             |
| `examples` | `readonly SourceExample[]` | The `@example` blocks carried by the exported functions (or, given `name`, that declaration's own members) whose eligible leading JSDoc chain ends in a span carrying an `@example` tag opening a line at its first non-blank column. Given `name`, it follows no `extends` clause. |

#### Which projector a check uses

`exports()` and `surface()` answer different questions, and picking the wrong one is the most
common error in a consumer's parity test.

**`surface()` is what a guide is checked against.** A guide documents what a consumer can import,
and `surface()` is the barrel-reachable set. Use it for the documented-surface bijection (SB) and
for the fence-import comparison (FI).

**`exports()` answers a different question.** It is every direct declaration under the selected
modules, and it includes a class that carries `export` only because the placement sweep requires
every implementation class to be exported. Those classes are deliberately absent from the barrel,
so they are not part of the package's public surface. Use `exports()` where the question really is
what the package declares — the direct-versus-barrel legs of SB, which catch a declaration the
barrel never re-exports.

Check whether `surface()` already answers the question before reaching for a denylist over
`exports()` or a second projector built on the TypeScript compiler. `surface()` excludes the
internal implementation classes a denylist would enumerate by hand, so a fence-import check reads
`surface()`.

#### `SourceManagerInterface`

| Method    | Returns                        | Behavior                                                                                                                   |
| --------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `source`  | `SourceInterface \| undefined` | The shared source view of the module `specifier` names, or `undefined` when the policy does not map it — a foreign import. |
| `sources` | `readonly SourceInterface[]`   | One shared source view per distinct module the policy maps, in first-seen specifier order.                                 |

## The extraction model

`Guide` parses a guide's markdown once (through `@orkestrel/markdown`'s `createMarkdown`) and
caches its projections at construction — `sections`, `tagline`, `surface`, `methods`, `unnamed`,
`links`, `tests`, `fences` — so every accessor is a cheap array return, not a re-parse.
`extractSurface` scopes to the `## Surface` section (`selectSectionBlocks`) and unions its sources
of identifiers: every table's column-0 code span (keyword read from the column whose header text
is `Kind`, located positionally so it survives reordering) and every backticked H3 entity heading
(a class documented outside a table, keyword fixed to `'class'`). `extractMethods` scopes to
`## Methods`: an H4 whose first code span sets the current interface name, and the very next
table becomes that interface's `MethodGroup`. Both extractors normalize every identifier
through `normalizeIdentifier`, stripping a generic-parameter annotation (`` `WidgetInterface<T>` ``
→ `WidgetInterface`) so the bijection key is always the bare name. `extractLinks` walks the
whole AST for every `link` node (table cells included); `extractTests` does the same walk
scoped to the `## Tests` section only; and `extractFences` walks the whole AST for every
fenced code block, tagged or not, keeping each fence's info-string language and verbatim body.

The fence projection is total on purpose. `Guide` reports what the document contains, and each
consumer decides which languages its own checks read: `findUnlisted` states the list a package
allows, and the example and import checks filter to the language they parse. A package documenting
`sql` or `sh` examples can therefore feed those fences to its own checks. A `ts` filter inside
`Guide` would have discarded them before the consumer ever saw them, and an untagged fence would
have vanished with no language to report.

`parseManifest(markdown, directory)` resolves every Spec, Source, and Tests link through
`resolvePath(directory, target)`, so root, nested, and dotted directory names are ordinary path
components. Source links then canonicalize through `normalizeDirectories`: `'.'` is workspace root and
duplicates collapse in first-seen order. `resolvePath` owns the only forward-slash dot-segment reducer, returns `'.'` when all components cancel, and retains every
excess leading parent. `resolveLink(file, target)` adds the declaring-file boundary: it derives
the directory before the final slash, treats a slashless file as workspace-root, and delegates.
Neither helper consults the filesystem, infers extensions, or guesses whether a dotted component
is a file.

The guide's side and the source's side read into one form. `extractSurface` and `extractMethods` locate
the compared column by its header text, `Summary`, exactly as they locate `Kind`, and read that cell
through `extractCellText` and `normalizeSummary`. `extractSourceComments` walks the aligned
`SourceLine` records once, pairs each eligible genuine JSDoc block with the physical record it
documents, and every doc-block reader is a projection of that one walk: `collectSummaries` for the
description paragraph, `collectExamples` for the `@example` blocks, and `extractExampleLines` for the
records an `@example` documents. `extractTagline` reads the blockquote following the H1, and
`extractUnnamed` returns the `## Surface` and `## Methods` rows `extractSurface` and
`extractMethods` skip for want of a code-span name.

One transform reads both sides, so its clauses are stated once and each fires wherever its input
occurs rather than on a side reserved for it:

- Every single-backtick code span — one backtick per side, no inner backtick, no adjacent backtick — is located, before any other clause runs.
- `{@link X}` and `{@link A.b}` become the code token of the target text, outside a located span.
- `{@link X | text}` becomes the code token of `text`, outside a located span.
- Emphasis — `**text**` and `_text_` — drops to its text.
- A link, `[text](target)`, drops to `text`.
- An image, `![text](target)`, drops to its alternative text.
- `\|` unescapes.
- Every run of whitespace, a continuation marker and a line break included, collapses to one space.
- The leading and trailing whitespace trims.
- A code span stays a code span, and the whitespace at each end of a located span's own content trims; a span whose content is all whitespace keeps one space.

Nothing else is transformed. Emphasis, a link, an image, and `\|` are markdown syntax the parser
resolves, so those clauses reach only a guide cell; `{@link Widget}` is ordinary text, so a guide cell carrying that token
rewrites to `` `Widget` `` exactly as a doc block's paragraph does, while the same token written
inside a code span stays literal on both sides. The `extractCellText` function
reads the markdown nodes and `normalizeSummary` reads the text tokens, and both sides end in
`normalizeSummary`.

The order is what makes the clauses agree. Locating spans first keeps a delimiter the `{@link}`
expansion inserts from reading as an authored one; trimming a span's boundary last, after the
whitespace collapse, judges a span wrapped across two physical lines on the characters the parser
judged. The trim is symmetric because the markdown parser is not: it strips one space from each end
of a code span only when both ends carry one, so trimming every boundary space on the source side
is the rule that meets a guide cell however it was written.

A code span delimited by more than one backtick sits outside the compared form and travels
untouched, as does a code span whose own text carries a backtick. The form spells every span with
one backtick per side, so neither can be written back: a summary carrying either cannot converge,
and the construct belongs in prose instead.

The compared unit is the description paragraph, not its first sentence: on the source side the doc
block's text from its opening to its first block tag, and on the guide side the `Summary` cell. A
block tag opens a line whose first non-blank character is `@`, so a tag written past one space after
the continuation marker still ends the paragraph and still reads as a tag. A line inside a fenced
body is example code rather than block structure, so it opens no tag: a body runs from a line
opening with three or more backticks or tildes to the first line opening with a run of the same
character at least as long, and `maskFences` replaces its characters with aligned spaces before
every tag search reads the block.
`@param`, `@returns` and the `Returns` column, `@remarks` and narrative, and the H1 tagline are
outside the comparison — `tagline()` reads the tagline for a package that compares it against its own
README, and it gains a partner to compare against when a source declares `@packageDocumentation`.
`Shape`, `Signature`, `Value`, and `Returns` are guide-only data columns and stay unread.

Examples pair by title. A `GuideFence` carries the flattened text of its nearest preceding heading as
`title`, a `SourceExample` carries the text after its `@example` tag, and a block claims the fence of
the same title. A heading's text is flattened, so a title written with a code span pairs with a plain
`@example` title. The pairing is per title across the whole document, not per heading: the first
fence a title reaches is the compared one, and every later fence of that title is outside the
comparison, whether it sits under the same heading or under a second heading of the same text. A
heading can therefore carry a setup fence and a result fence, and only the first answers for the
title. The bodies compare after `normalizeComment` removes the continuation marker and the
block's leading indentation and trims per-line trailing whitespace, and the fence language compares
with them: an example's compared text is its language on the first line and its body beneath. An
untitled `@example` keeps its presence role for `findUnexampled`.

`Source` never parses markdown or touches disk — it scans a consumer-supplied file
inventory's text with deliberately narrow physical-line grammars. `extractSourceLines` is the
sole character engine and emits one `SourceLine` per LF/CRLF physical line plus the final line:
`source` is exact, `code` is equal-length with real comments and complete template tokens masked,
and `jsdoc` is equal-length with every genuine span retained at its physical column or is
`undefined`. A genuine JSDoc capture starts only from ordinary reflection code, never inside an
open comment, raw template, or template substitution. The engine traverses escapes, nested
template substitutions, strings, regex character classes, comments, and division/regex contexts
only to identify those spans; it does not parse TypeScript. Literal ECMAScript Unicode identifiers
participate in bounded slash-state recognition, but escaped identifier spellings are not decoded.
Regex recognition is a bounded lexical goal: because the projection cannot infer whether `}`
closes an expression or a statement/declaration block, slash immediately after bare `}` is
division and a post-brace regex statement needs an explicit `;`. General semicolonless
declaration/ASI classification is also outside this finite projector; callers use an explicit
`;` before a slash-leading statement after such a declaration. Projection preserves columns;
each consumer still owns membership. Direct and hidden heads remain uninterrupted and
column-zero, while barrel rows retain their separate whitespace-tolerant whole-line grammar.

`extractExampleLines` walks only `SourceLine` records. A genuine JSDoc opener is eligible only
when it is the first non-whitespace source material. Within a leading whitespace-separated chain,
each later span replaces the earlier one and is authoritative. Only an `@example` tag opening a line
at its first non-blank column qualifies; same-line title text is allowed. Source material between or after spans
severs association, a leading JSDoc on the next line replaces pending state, and any other next
physical record is returned once as the candidate. `extractExamples` and `extractExampleMethods` share this
adjacency parser and apply their distinct exported-function and callable-member grammars only to
`code`.

Across the `.ts` module keys under each selected directory, excluding its root `index.ts` and
every `*.test.ts`, `collectKeys` matches
`^export (?:async )?(function\*?|class|const|interface|type) (\w+)` per projected line and keys that
line by `computeSymbolKey`; `extractExports` reads those keys, splits each at its one space, and
dedupes by (keyword, name). `collectKeys` is the package's one key grammar, and `extractExports`,
`extractExamples`, `extractMemberMethods`, `extractExampleMethods`, and `locateComment` each read
their own part out of the same map, so a change to the head shape or to the member shape reaches
every one of them. A column-zero `export` declaration carrying another keyword closes the owner
it follows, the same way a column-zero `}` does. `extractHidden` applies the same
declaration-keyword head grammar without `export`. Comment and
template payload, enums, `let`, `var`, and other TypeScript declaration forms are outside these
populations; enum exclusion describes reflection scope, not a general package-policy ban.
`extractDeclaration` locates a named real `export class` / `export interface` head and exact
column-zero close in projected lines (joining an oxfmt-wrapped signature through `joinHead`), then
returns that one head's aligned raw body and its `extends` bases as a single `Declaration`, or
`undefined` when the file declares no such head. One locator is what keeps a body and a heritage
clause on the same declaration. Its identifier is escaped through `escapeRegExp` before it enters
the head grammar, so a name carrying a regex metacharacter is literal text rather than a wildcard
or a thrown `SyntaxError`. A head that opens no column-zero close is skipped and the scan
continues. `extractMemberMethods` projects that body once through `extractBodyLines`, which reads it
inside an owner head so each member keys to its owner, and `collectKeys` matches
`^\t(?:async )?\*?(\w+)\??(?:<.*>)?\(` against those body lines — plain / `async` /
generator / optional methods count; getters, setters, `static` members, and `#` privates
never match (their keyword or sigil breaks the `name(` shape), and `constructor` is filtered
out of `Source.methods`. Every balanced `<...>` span is removed from the head before its `extends`
clause is read, so a `T extends Base` type parameter never reads as a base and `Base<T>` reads as
`Base`, and a class's `implements` clause is excluded. `Source.methods(name)` unions the located
declaration's own members with those of every declaration it extends, following each base through
the same module scope and keeping the keyword it started from — an interface chain resolves through
interfaces, a class chain through classes, so an interface extending a name only a class declares
gets nothing from it. One declaration answers for a name: the module scope's files are read in
sorted key order, and the first one whose located head has a body or has bases supplies both the
members and the bases; a head with neither a body nor bases does not count as declared, so an empty
`export interface X {}` is skipped and the scan continues to a later file or falls through to a
same-named class, and a second file declaring the same name after one is found adds nothing. The
inventory is the further bound: a base the
selected directories do not declare, whether it is imported from another package or written as a
qualified name such as `external.Store`, contributes no members and is not an error, and one
visited set per call collapses a cycle and a diamond to a single visit. `Source.examples(name)` is
deliberately asymmetric with it — it reads only the named declaration's own body, under each
keyword, and follows no `extends` clause, so an inherited member's `@example` belongs to the base
that declares it. `selectModuleKeys` scopes the inventory to one `GuideModule`'s `.ts` files,
excluding each scope directory's own `index.ts` and any `*.test.ts` file. `Source.hidden()`
mechanically asserts the export-discipline rule `.claude/rules/architecture.md` § Barrel exports
states, and catches a hidden declaration-keyword declaration the surface bijection alone would
never see.

`Source.surface()` starts only at exact `index.ts` for canonical `'.'`, or exact
`<directory>/index.ts` for each nested directory returned by `normalizeDirectories(module)`.
Inventory keys remain opaque and are never normalized; `hasCanonicalSegments` rejects empty,
`.` and `..` segments while retaining dotfiles. Both the initial index and every resolved target
must be canonical after relative-row reduction; a parent row that reduces to a canonical key
remains valid. A complete row must be equivalent to
`export * from './target.js'`: the target starts with `./` or `../` and ends in `.js`;
surrounding whitespace, either quote, an optional semicolon, and an optional trailing `//`
comment is accepted, while the inactive quote delimiter remains target data. The same projection
masks actual comment/template spans, preserving valid row code around them and markers inside a
quoted target. Arbitrary trailing source is rejected. Only the terminal `.js` becomes `.ts`;
`resolveLink(currentIndex, target)` derives the current index file's directory and delegates to
`resolvePath`, the only dot-segment reducer. Exact workspace-root `index.ts` and nested targets
ending `/index.ts` recurse as barrels, while another exact `.ts` target contributes its direct
`extractExports` declarations. One visited set terminates self-cycles, multi-index cycles, repeated
rows, and diamonds. `computeSymbolKey` deduplicates same-name/same-keyword rows while retaining
same-name/different-keyword rows, and the final list uses the same name sort as `exports()`.

Missing roots and targets, empty barrels, and unsupported rows contribute nothing without
throwing, while valid siblings continue. Named, default, namespace, type-only, non-relative, and
extensionless re-exports are outside the population. So are enums, declarations written directly
in an `index.ts`, and re-export syntax inside a terminal non-index target. Ignoring these forms does not
validate them: repository barrel policy, typechecking, and builds own validity. There is no
filesystem, package-map, alias, config, directory-index fallback, or general TypeScript module
resolution. The supplied inventory is never mutated; the first computed result is cached and the
same readonly array instance is returned thereafter.

## The check catalog

Every guides-parity check reduces to `expect([]).toEqual([])`, paired with a non-vacuousness
guard so a renamed heading fails loudly instead of passing on an empty extraction:

- **SB — Direct/barrel/guide surface parity (keyword folded in).** `findMissingSymbols` proves every
  direction: direct declarations → barrel surface, barrel surface → direct declarations, barrel
  surface → guide surface, and guide surface → barrel surface. Every comparison uses `computeSymbolKey`,
  so a declaration may drift in neither name nor keyword. Guard: `guide.surface().length > 0`.
- **MB — Methods bijection + class-no-extra.** Per `MethodGroup`, its `methods` vs
  `source.methods(group.interface)`, `findMissing` both directions; then, by the
  `XInterface → X` naming convention, `findMissing(source.methods('X'), group.methods)` must
  also be empty — the implementing class exposes no undocumented public method. Guard:
  `group.methods.length > 0`.
- **RN — Row naming.** `guide.unnamed()` keeps every `## Surface` or `## Methods` row whose first
  cell carries no code span. `extractSurface` and `extractMethods` key a row on that code span, so a
  row without one enters neither `guide.surface()` nor a `MethodGroup`, no bijection leg can report
  it, and this check names the row instead of letting it go in silence. A finding is the row's cells
  read through `extractCellText` and joined by `` ` | ` ``. Guard: RN reads table rows, so a guide
  documenting its surface with backticked H3 entity headings and no `## Surface` table gives RN
  nothing to read, and SB's `guide.surface().length > 0` covers that surface instead.
- **LI — Link integrity.** `guide.links()`, dropping `isExternalLink` hrefs, `resolveLink`
  the rest against the guide's own path, keep those failing `source.exists` — which holds for a
  directory link too, because `exists` answers for an inventory key and for any directory a key
  sits beneath. Guard: `guide.links().length > 0`.
- **TE — Tests-link existence.** `guide.tests()`, `resolveLink` + `source.exists`, keep the
  missing; a link naming a fixture directory resolves on the same directory rule. Guard:
  `guide.tests().length > 0`.
- **NV — Non-vacuousness.** `parseManifest` yields at least one entry; each guide's
  `surface()` and every `MethodGroup` is non-empty — the guard behind every other check.
- **FL — Fence-language listing.** `findUnlisted(guide.fences(), LANGUAGES)` keeps every fence
  whose language the package did not list, plus every untagged fence. The list is the package's
  own — `Guide` never decides it — so a package documenting `sh` or `sql` examples lists those
  languages and keeps its remaining checks scoped to the one they parse.
- **EX — Examples presence.** A documented symbol "has an example" when its bare name
  appears (word boundary) in any fence body from `guide.fences()` filtered to the example
  language, **or** its source has an immediately preceding eligible leading JSDoc chain whose final
  authoritative span carries an `@example` tag opening a line at its first non-blank column, with
  optional title text,
  (`source.examples()` / `source.examples(name)`).
  Applies to every `function`-keyword `Surface` symbol and every `MethodGroup` member.
  Presence-only — fence and JSDoc **content** are never checked. `findUnexampled` is the
  comparison. Guard: the SB/MB extractions this check reuses already prove non-vacuous.
- **SQ — Surface summary equality.** For every symbol both `guide.surface()` and `source.surface()`
  carry, the guide row's `Summary` cell equals the declaration's description paragraph. A pair agrees
  only when both sides carry the same text: guide text alone reports the guide's side, source text
  alone reports the source's, and neither side carrying text reports the key by itself — never as
  agreement. A table with no `Summary` column therefore reports every row it documents, and a package
  adopting SQ cannot pass it vacuously. `findDrift` is the comparison. Guard: the SB extractions
  this check reuses already prove non-vacuous.
- **MQ — Methods summary equality.** The same comparison per `MethodGroup`, over the members
  `group.methods` and `source.methods(group.interface)` both carry, keyed `Owner.member`.
- **EQ — Example equality.** Every titled guide fence against the `@example` block of the same title,
  body and fence language together. The pairing is per title across the document, not per heading: the
  first fence a title reaches is the compared one, and every later fence of that title is outside the
  comparison, whether it sits under the same heading or under a second heading of the same text. A title one side alone carries is outside
  the comparison too, and an untitled `@example` stays EX's presence evidence.
- **FI — Fence-import reality.** Every `import { ... } from 'specifier'` in a `guide.fences()`
  fence of the checked language, for a **self** specifier (this repo's own package name / path
  alias), imports only names that exist in `source.surface()`. `extractFenceImports` parses the
  statement; `findMissing` diffs the imported names against the public/barrel surface's names.
  Guard: the comparison runs against at least one resolved import.

SQ, MQ, and EQ share one function: `findDrift(guide, source)` returns every disagreement with both
sites, so a package's whole equality gate is `expect(findDrift(guide, source)).toEqual([])`. It
compares only the pairs both sides carry, so a symbol, a member, or a title one side lacks is left to
the bijection check that owns it and is never reported twice.

Permanent controls bind the SB population boundaries through production `Source`, `Guide`,
`findMissingSymbols`, and `computeSymbolKey`: a stranded direct declaration must be missing from the barrel;
a phantom Guide row must be missing from the barrel; keyword drift must fail in both barrel/Guide
directions; a barrel-only declaration outside `selectModuleKeys()` must be missing from direct exports;
a correlated commented declaration must remain absent from direct and barrel populations while
failing Guide-to-barrel; and a workspace-root `index.ts` hop must reach its real terminal symbol.

## The renderers and the replacers

The readers say where a guide and its source disagree; the renderers and the replacers carry a
change across. Every one of them returns text and writes nothing, so the gate that reads
`findDrift` calls no writer and a package's suite can never rewrite the tree it is checking. A
script you write reads the file, chooses the direction, and writes the result back; this package
gives that script the text to write and never opens a file itself.

`renderSurface`, `renderMethods`, and `renderExample` produce fresh guide text from source
entries — a `Name` / `Kind` / `Summary` table, a `####` group and its `Name` / `Summary` table,
and a titled fence. Each builds a markdown node and renders it through the parser's own
`renderMarkdown`, so the text it returns is the text the package parses back. Each renders the
block a guide section contains rather than the section itself, because a guide documents its
surface in several tables under their own sub-headings: reading a render back therefore parses it
under the section heading its caller supplies, so `extractSurface` reads
`'## Surface\n\n' + renderSurface(symbols)` back to the symbols it was rendered from, and
`extractMethods` reads `'## Methods\n\n' + renderMethods(group)` back to the group.
`renderExample` needs no such heading, because `extractFences` scopes a fence to no section. The
render is one-space padded whatever the committed guide's column alignment was, so the checkout's
own formatter re-aligns it and the comparison stays on parsed entries rather than on bytes.

`replaceCell` and `replaceFence` rewrite one node inside a guide that already exists. Each locates
its node through the readers — `extractRowSymbol` and `collectGroups` for a row, `collectFences`
for a fence — reads that node's source region from the parser's provenance, rebuilds the node, and
splices the render over the region through `spliceSpan`. Only the located node's own region is
rewritten, so every byte of the guide outside it travels unchanged.

`replaceSummary` and `replaceExample` rewrite one doc block's raw text — its description paragraph,
or the body of the `@example` tag carrying a given title. `locateComment` is how a caller finds
that block: it takes a file's text and a compared key and returns the block's own character region,
which the caller slices, hands to a replacer, and splices back through `spliceSpan`. `unwrapComment`
gives one content line per physical line, so the rewrite addresses the lines it replaces and keeps
every other line: the tag lines, the blank separator before the first tag, the block's indentation,
and its continuation markers. A replaced description re-wraps inside the caller's `width`, defaulting
to `WRAP_WIDTH`, because a doc block's own wrapping is not recoverable from its text.

Every replacer reports a miss the same way. `undefined` means "not replaced", and it covers a
key that reaches no row, a table carrying no `Summary` column, a title no fence or tag carries, a
text that is no doc block, a summary carrying no word, and code the emitted three-backtick fence
cannot enclose. A caller reports the key it could not place instead of writing a file it could not
read back.

Every replacement whose target already carries the value returns its input byte for byte. That is
what lets a package run the propagation over a tree that has no drift and see no file move: a
re-render would re-pad a table and a re-wrap would move most doc blocks, and neither is a change
anyone asked for. The identity reads both sides through the compared form, so handing a replacer
text the form still moves writes once and is a fixed point on the next run.

Direction is the developer's, with one rule: **the guide fence wins on example content**, because a
package's suite executes its guide's fences and nothing executes a doc comment. So a disagreeing
example travels from the guide into the doc block, and a disagreeing summary travels whichever way
the developer names. The gate reports and never writes; neither this package's readers nor its
renderers decide.

## The pure file-inventory model

Neither `Guide` nor `Source` ever imports `node:fs` or any other I/O primitive — `Source`'s
construction input (`SourceOptions.files`) is a plain `Readonly<Record<string, string>>` the
**consumer** gathers however their runtime allows: a recursive `node:fs` walk in a Node vitest
run, `import.meta.glob('/**/*.ts', { eager: true, query: '?raw', import: 'default' })` in a
browser/vitest run, or a static bundle in any other environment. This keeps the package
itself environment-agnostic while every check still runs against real, on-disk truth in the
consumer's own test. The inventory must include each selected module's root `index.ts` and every
reachable exact `.ts` target for `surface()` to observe them; absent keys remain empty reflection.

## Patterns

### Construct a `Guide` from markdown text

```ts
import { createGuide } from '@orkestrel/guide'

const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `X` | class |')
guide.surface() // [{ name: 'X', keyword: 'class' }]
guide.sections() // ['Surface']
```

### List the fence languages a package allows

````ts
import { createGuide, findUnlisted } from '@orkestrel/guide'

const guide = createGuide('```ts\nconst a = 1\n```\n\n```sh\nnpm test\n```\n')
guide.fences() // [{ language: 'ts', code: 'const a = 1' }, { language: 'sh', code: 'npm test' }]
findUnlisted(guide.fences(), ['ts']) // [{ language: 'sh', code: 'npm test' }]
findUnlisted(guide.fences(), ['ts', 'sh']) // []
````

### Construct a `Source` from an inline files record

```ts
import { createSource } from '@orkestrel/guide'

const source = createSource({
	files: {
		'src/core/index.ts': "export * from './Guide.js'\nexport * from './types.js'\n",
		'src/core/Guide.ts': 'export class Guide {}\n',
		'src/core/types.ts': 'export interface GuideInterface {\n\tsections(): void\n}\n',
	},
	module: 'src/core',
})
source.exports() // [{ name: 'Guide', keyword: 'class' }, { name: 'GuideInterface', keyword: 'interface' }]
source.surface() // [{ name: 'Guide', keyword: 'class' }, { name: 'GuideInterface', keyword: 'interface' }]
source.methods('GuideInterface') // [{ name: 'sections' }]
source.exists('src/core/Guide.ts') // true
source.exists('src/core') // true — a directory any inventory key sits beneath
```

### Resolve a fence's import specifier to the right `Source`

```ts
import { createSourceManager } from '@orkestrel/guide'

const sources = createSourceManager({
	files: {
		'src/core/index.ts': "export * from './Guide.js'\n",
		'src/core/Guide.ts': 'export class Guide {}\n',
	},
	modules: { '@scope/package': 'src/core', '@scope/package/core': 'src/core' },
})

sources.source('@scope/package')?.surface() // [{ name: 'Guide', keyword: 'class' }]
sources.source('node:fs') // undefined — a foreign import, which a fence check skips
sources.source('@scope/package') === sources.source('@scope/package/core') // true
sources.sources() // [the one shared view both specifiers name]
```

### The bijection assertion shape

```ts
import { createGuide, createSource, findMissingSymbols } from '@orkestrel/guide'

const guide = createGuide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `Guide` | class |')
const source = createSource({
	files: {
		'src/core/index.ts': "export * from './Guide.js'\n",
		'src/core/Guide.ts': 'export class Guide {}\n',
	},
	module: 'src/core',
})

// Direct declarations, public barrel, and guide surface agree in every direction.
findMissingSymbols(source.exports(), source.surface()) // []
findMissingSymbols(source.surface(), source.exports()) // []
findMissingSymbols(source.surface(), guide.surface()) // []
findMissingSymbols(guide.surface(), source.surface()) // []
```

### Compare a guide against the source it documents

```ts
import { createGuide, createSource, findDrift } from '@orkestrel/guide'

const guide = createGuide(
	'## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks the tree. |',
)
const source = createSource({
	files: {
		'src/core/index.ts': "export * from './helpers.js'\n",
		'src/core/helpers.ts': '/**\n * Walks a tree.\n */\nexport function walk(): void {}\n',
	},
	module: 'src/core',
})

// One entry per disagreement, naming both sites; a symbol one side lacks belongs to SB.
findDrift(guide, source) // [{ key: 'function walk', guide: 'Walks the tree.', source: 'Walks a tree.' }]
```

### Carry a summary across into the guide

```ts
import { replaceCell, replaceSummary } from '@orkestrel/guide'

const guide =
	'## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks the tree. |'

// The guide's text back, with that one cell replaced and every byte outside the table unchanged.
replaceCell(guide, 'function walk', 'Walks a tree.')
// '## Surface\n\n| Name | Kind | Summary |\n| --- | --- | --- |\n| `walk` | function | Walks a tree. |'
replaceCell(guide, 'function phantom', 'Absent.') // undefined — no row carries that key
replaceCell(guide, 'function walk', 'Walks the tree.') === guide // true — the row already carries it

// The other direction: one doc block's raw text, its description paragraph replaced.
replaceSummary('/** Walks the tree. */', 'Walks a tree.') // '/** Walks a tree. */'
```

### Read a guide's tagline

```ts
import { createGuide } from '@orkestrel/guide'

const guide = createGuide('# Widget\n\n> A widget toolkit.\n\n## Surface\n')
guide.tagline() // 'A widget toolkit.'
```

### Project source into physical code lines

```ts
import { extractSourceLines } from '@orkestrel/guide'

extractSourceLines('export const visible = true // note\n')
// [{ source: 'export const visible = true // note', code: 'export const visible = true        ', jsdoc: undefined }]
// … one record per remaining line
```

### Resolve directory and file targets

```ts
import { resolveLink, resolvePath } from '@orkestrel/guide'

resolvePath('guides/nested', './spec.md') // 'guides/nested/spec.md'
resolveLink('index.ts', './root.ts') // 'root.ts'
```

## Tests

This repository runs the catalog against itself. Its `tests/guides.test.ts` wires RN, SB, MB, LI,
TE, NV, FL, EX, and FI. It does not wire SQ, MQ, or EQ: this guide's Surface and Methods tables head
their compared column `Shape`, `Signature`, `Behavior`, `Builds`, and `Returns` rather than
`Summary`, so `findDrift` would report every row this guide documents. This guide adopts the
`Summary` column in a later change, and until then the catalog's SQ, MQ, and EQ rows describe checks
this repository does not run against its own guide.

- [`tests/src/core/helpers.test.ts`](../tests/src/core/helpers.test.ts) — direct `SourceLine`, lexical, and JSDoc-alignment invariants; projected declaration-keyword direct/hidden reflection; genuine JSDoc example adjacency and faux JSDoc exclusion; every guide-document extractor; the compared form clause by clause on both sides; the `Summary` locator over a reordered header and a table without the column; the nameless-row finding against a name the reader reads through emphasis; a block tag written past one space after the continuation marker, and a tag-shaped line inside a fenced body left to the example code; the fenced-body projection `maskFences` returns; fence titles and the tagline; `findDrift` with a negative control drawn from the symbols the bijection legs already report, a planted disagreement of each kind, and a later fence under one heading left outside the comparison; the doc-block reader against `parseSync`'s own reading, which names the shape the reader misses; the compared cell built back from its text, over every doc-block summary this package ships; the compared form's code-span clause converging a padded, a one-sided, and an all-whitespace span from either side, leaving a link token inside a span literal, and leaving a multi-backtick span untouched; the corpus this package ships carrying a floor of blocks, read at its raw spans through the aligned JSDoc projection and checked against the blocks `extractSourceComments` attaches; the renderers round-tripping through the readers that own them and the render read the same as the column-aligned committed form; each replacer's located node rewritten with every byte outside it unchanged, its miss returning `undefined`, and its identity case byte-stable over every described doc block this package ships and a fixed point on the second run, with a control from outside each replacer's membership; the one key grammar `collectKeys` reports over the control fixtures and a member fixture, its owner closing at a column-zero brace, and the keyword and member name each reader splits back out of it; `locateComment` over an overload set, a member key, an owner closed at its brace, a CRLF file, and the shapes the attaching reader misses, then a rewrite spliced back and read through `collectSummaries`, and every `Owner.member` key this package's own source declares located back to the block carrying that member's summary; canonical-key, runtime-name, `resolvePath`, and `resolveLink` invariants; all remaining helper leaves.
- [`tests/src/core/parsers.test.ts`](../tests/src/core/parsers.test.ts) — `parseManifest` row parsing, malformed-row skipping, one-versus-many Source canonicalization, and nested manifest directories.
- [`tests/src/core/validators.test.ts`](../tests/src/core/validators.test.ts) — `isExportKeyword` / `isSurfaceSymbol` / `isMethodEntry` / `isSourceExample` / `isDrift` / `isMethodGroup` / `isManifestEntry`.
- [`tests/src/core/shapers.test.ts`](../tests/src/core/shapers.test.ts) — per-shape guard exactness, JSON Schema essentials, seeded generate round-trips, parse rebuilds.
- [`tests/src/core/factories.test.ts`](../tests/src/core/factories.test.ts) — `createGuide` / `createSource` + the compiled symbol, entry, example, drift, group, and manifest contracts.
- [`tests/src/core/Guide.test.ts`](../tests/src/core/Guide.test.ts) — `Guide`'s cached projections, its tagline, its nameless rows, and its fence titles, and production barrel/Guide phantom and keyword-drift controls.
- [`tests/src/core/sources/Source.test.ts`](../tests/src/core/sources/Source.test.ts) — direct/barrel projections, lexical and JSDoc regressions, canonical-key populations, root and nested indexes, exact row grammar, graph invariants, and correlated population controls.
- [`tests/src/core/sources/SourceManager.test.ts`](../tests/src/core/sources/SourceManager.test.ts) — `computeModuleKey` boundary collision, specifier resolution, the `undefined` skip for an unmapped specifier, array-valued module scopes, `sources()` enumeration, and per-module entity sharing with a differently-scoped identity control.
- [`tests/fixtures/broken/stranded-export`](../tests/fixtures/broken/stranded-export) — permanent negative control: its guide and direct declarations agree while its conventional barrel omits `strandedExport`.
- [`tests/guides.test.ts`](../tests/guides.test.ts) — the drop-in guides-parity suite, run against **this** repository's own `guides/README.md` manifest — the self-dogfooding acceptance criterion.

## See also

- `AGENTS.md` (workspace root) — the rules; `.claude/rules/documentation.md` § Parity states the documentation-as-contract law.
- [`README.md`](README.md) — the guides index.
