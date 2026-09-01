# @orkestrel/guide

A guides-parity **test helper** for `@orkestrel` packages. Add it as a
devDependency, drop one short test file into `tests/guides.test.ts`,
wire a vitest `guides` project, and thereafter every guide is proven —
mechanically, in CI, as ordinary vitest assertions — to be in **bijection**
with the code it documents: every documented export exists in source and
vice versa, every documented method matches the class, and every relative
link resolves. No CLI, no runner, no exit-code contract: it is a library of
extraction + reflection helpers your test suite calls. Built on
`@orkestrel/markdown`. Part of the `@orkestrel` line.

## Install

```sh
npm install -D @orkestrel/guide
```

## Requirements

- Node.js >= 22.12.0
- ESM and CommonJS

## Usage

The entire consumer-side footprint is one short test file. An excerpt of the
drop-in pattern (`tests/guides.test.ts`):

The consumer supplies the file inventory `Source` reflects over. The inventory
below is an illustrative, non-runnable placeholder until the consumer supplies
real workspace text; the complete runnable implementation is
[`tests/guides.test.ts`](tests/guides.test.ts).

```ts
import { expect, it } from 'vitest'
import { createGuide, createSource, findMissingSymbols, parseManifest } from '@orkestrel/guide'

declare const files: Readonly<Record<string, string>> // illustrative root-relative inventory
declare function readText(relative: string): string // required exact lookup supplied by the consumer

const manifest = parseManifest(readText('guides/README.md'), 'guides')

it('lists at least one guide', () => {
	expect(manifest.length).toBeGreaterThan(0)
})

for (const entry of manifest) {
	const guide = createGuide(readText(entry.spec))
	const source = createSource({ files, module: entry.source })

	it('keeps direct declarations, the public barrel, and the guide equal', () => {
		expect(guide.surface().length).toBeGreaterThan(0)
		expect(findMissingSymbols(source.exports(), source.surface())).toEqual([])
		expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
		expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
		expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
	})
}
```

Every row added to the consumer's `guides/README.md` manifest auto-extends
coverage with zero test edits.

`exports()` inventories direct `type`, `interface`, `const`, `function`, and
`class` declarations in the selected directories' canonical-segment module
keys. `hidden()` reflects the same five declaration kinds without `export`.
Both use the one structured physical-line projection: each record retains exact
raw source, equal-length projected code, and an equal-length genuine JSDoc view
that retains every genuine span at its physical column. Comment and template
payload is excluded, but projection does not grant membership. Direct/hidden
declaration heads remain uninterrupted and column-zero. `enum` is outside this reflection
population, not forbidden by general package policy.

`surface()` inventories declarations reachable through exact `index.ts` for the
canonical workspace-root module `'.'`, or exact `<dir>/index.ts` for a nested
module. It follows only complete relative `.js` star
rows, maps the terminal `.js` to an exact `.ts` inventory key, and recursively
follows exact workspace-root `index.ts` and nested `/index.ts` targets. Missing
roots and targets, unsupported export forms, and declarations written directly
in an index contribute nothing. `resolvePath(directory, target)` owns pure
directory-relative dot-segment reduction; `resolveLink(file, target)` adapts a
declaring file to that engine. Neither performs filesystem or extension
inference. Module spellings canonicalize through
`resolvePath`/`normalizeDirectories`, while `hasCanonicalSegments` excludes
opaque inventory keys containing empty, `.` or `..` segments without rewriting
them; ordinary dotfiles remain eligible. Both initial barrels and resolved row
targets must be canonical after relative-row reduction, while parent rows that
reduce to canonical inventory keys remain valid. Barrel rows have their own
whitespace-tolerant whole-line grammar.

Regex preservation follows a bounded lexical goal rather than full TypeScript
parser grammar. Literal ECMAScript Unicode identifiers participate in slash-state
recognition without claiming general TypeScript parsing or escaped-identifier
decoding. Slash immediately after bare `}` is division; a regex statement after
a closing brace needs an explicit `;` to enter the supported population. General
semicolonless declaration/ASI classification is also outside the finite projector,
so callers use an explicit `;` before a slash-leading statement after such a
declaration.

## Checks

- **Surface parity** — intentional direct declarations, the conventional
  barrel-reachable surface, and documented `## Surface` symbols match by name
  and kind in both directions.
- **Methods bijection + class-no-extra** — every documented `## Methods`
  member matches the interface's implementer, and the implementing class
  exposes no undocumented public method.
- **Link integrity** — every relative link in a guide resolves to a real
  file.
- **Tests-link existence** — every `## Tests` link resolves to a real test
  file.
- **Non-vacuousness guards** — the manifest, each guide's surface, and each
  method group must extract non-empty, so a renamed heading fails loudly
  instead of passing vacuously.
- **Examples presence** — every documented function and method appears in a
  TypeScript fence or carries an immediately preceding eligible genuine JSDoc
  chain whose final authoritative span has an exact block-position `@example`
  tag. Title text is allowed; intervening material severs association.
- **Fence-import reality** — every self-package name imported in a TypeScript
  fence exists on the conventional public/barrel surface.

## API

- `createGuide(source)` — parses one guide's markdown into a structured,
  cached view with six projections (`sections()`, `surface()`, `methods()`,
  `links()`, `tests()`, `patterns()`).
- `createSource(options)` — reflects intentional direct declarations with
  `exports()`, conventional barrel reachability with `surface()`, members with
  `methods()`, path presence with `exists()`, hidden declarations with
  `hidden()`, and TSDoc example membership with `examples()`, over a
  consumer-supplied file inventory for one or more source directories. Both
  declaration projections are lazy, cached, deduplicated by name and kind, and
  sorted by name.
- `parseManifest(markdown, directory)` — extracts the `## By concept` rows
  from a manifest directory, including nested directories.
- `findMissingSymbols(symbols, source)` — the `(name, kind)` set difference
  driving surface bijection.
- `extractSourceLines(source)` — returns one `SourceLine` per physical line,
  including the final line, with exact `source`, equal-length masked `code`, and
  equal-length genuine `jsdoc` retaining every span at its physical column, or
  `undefined`.
- `extractExampleLines(lines)` — selects the single physical candidate line
  after an eligible leading JSDoc chain whose last whitespace-separated span
  carries an exact block-position `@example`; title text is allowed, intervening
  material severs association, and the next physical record is consumed once.
- `hasCanonicalSegments(key)` — rejects empty, `.` and `..` opaque key
  segments without normalization while retaining dotfiles.
- `normalizeDirectories(module)` — canonicalizes one or more module spellings
  through `resolvePath` and removes duplicates in first-seen order.
- `selectModuleKeys(files, module)` — selects sorted canonical-segment `.ts`
  keys under a module scope, excluding selected indexes and test files.
- `findMissing(names, source)` — the plain set difference driving methods
  bijection and link/test checks.
- `isExternalLink(href)` — true for `http`/`https`/`mailto`/`tel`/`#` links.
- `resolvePath(directory, target)` — normalizes a directory-relative target,
  returns `'.'` when all segments cancel, and preserves excess leading parents.
- `resolveLink(file, target)` — resolves a relative target from its declaring
  file, including files at the workspace root.

## Guide

For the full surface — the guide anatomy, the manifest format, and the check
catalog — see [`guides/guide.md`](guides/guide.md). For the design
and guide index, see [`guides/`](./guides/).

## Package

Published as one pure, I/O-free typed entry point — `@orkestrel/guide` — per
the `exports` field in `package.json`, with both ESM and CommonJS output. The
consumer supplies the file inventory `Source` reflects over; runtime
dependencies provide parsing and contract primitives without changing that
boundary.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
