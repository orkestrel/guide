# Guides

A dual-axis index into this repository's guides — by concept, and by directory (AGENTS §22).

## By concept

| Concept | Spec                   | Source                    | Tests                                 |
| ------- | ---------------------- | ------------------------- | ------------------------------------- |
| Guide   | [`guide.md`](guide.md) | [`src/core`](../src/core) | [`tests/src/core`](../tests/src/core) |

## By directory

| Directory  | Guide                  |
| ---------- | ---------------------- |
| `src/core` | [`guide.md`](guide.md) |

## Dependency reference

[`contract.md`](contract.md) is a byte-identical mirror of the guide for
`@orkestrel/contract` — one of this package's runtime dependencies. It documents
**that package's** surface (guards, combinators, parsers, and the shape DSL), not
anything sourced in this repo; it is kept here so a reader of the extraction layer
(`createGuide`, `parseManifest`, `resolveLink`, …) can see the primitives it is built
from without leaving this guide set.

[`markdown.md`](markdown.md) is a byte-identical mirror of the guide for
`@orkestrel/markdown` — this package's other runtime dependency. It documents
**that package's** surface (the AST shape, the two-phase parse, GFM tables, and the
contract-backed leaf shapes), not anything sourced in this repo; it is kept here so a
reader of the extraction layer (`createGuide`, `parseManifest`, `resolveLink`, …) can
see the primitives they are built from without leaving this guide set.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules; §22 documentation-as-contracts.
