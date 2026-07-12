# @orkestrel/guide

A guides-parity **test helper** for `@orkestrel` packages. Add it as a
devDependency, drop one short test file into `tests/guides/src/parity.test.ts`,
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

- Node.js >= 24
- ESM-only (no CommonJS build)

## Usage

The entire consumer-side footprint is one short test file. An excerpt of the
drop-in pattern (`tests/guides/src/parity.test.ts`):

```ts
import { fileURLToPath } from 'node:url'
import { createGuide, missingSymbols, parseManifest } from '@orkestrel/guide/core'
import { createSource, readText } from '@orkestrel/guide'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const manifest = parseManifest(readText(ROOT, 'guides/README.md'), 'guides')

for (const entry of manifest) {
	const guide = createGuide(readText(ROOT, entry.spec))
	const source = createSource({ root: ROOT, module: entry.source })

	it('documents every source export', () => {
		expect(missingSymbols(source.exports(), guide.surface())).toEqual([])
	})
}
```

Every row added to the consumer's `guides/README.md` manifest auto-extends
coverage with zero test edits.

## Checks

- **Surface bijection** — every documented `## Surface` symbol (name + kind)
  matches a real export, and vice versa.
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

## API

- `createGuide(source)` — parses one guide's markdown into a structured,
  cached view (`surface()`, `methods()`, `links()`, `tests()`).
- `createSource(options)` — reflects real exports/members/existence off disk
  for one or more source directories.
- `parseManifest(markdown, base)` — extracts the `## By concept` rows from a
  `guides/README.md` manifest.
- `missingSymbols(symbols, source)` — the `(name, kind)` set difference
  driving surface bijection.
- `findMissing(names, source)` — the plain set difference driving methods
  bijection and link/test checks.
- `readText(root, relative)` — reads a workspace-root-relative file.
- `isExternalLink(href)` — true for `http`/`https`/`mailto`/`tel`/`#` links.
- `resolveLink(from, target)` — resolves a guide-relative link against the
  guide's own directory.

## Guide

For the full surface — the guide anatomy, the manifest format, and the check
catalog — see [`guides/src/guide.md`](guides/src/guide.md). For the design
rationale, see [`PROPOSAL.md`](./PROPOSAL.md). For the guide index, see
[`guides/`](./guides/).

## Package

Published as two typed entry points — `@orkestrel/guide` (server) and
`@orkestrel/guide/core` (pure) — per the `exports` field in `package.json`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
