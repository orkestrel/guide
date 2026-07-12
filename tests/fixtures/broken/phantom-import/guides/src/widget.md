# Phantom Import

> Fixture guide (BROKEN: phantom-import) — a Patterns fence imports `ghost`
> alongside `real`, but the module does not export `ghost`; FI's
> `fenceImports` + `findMissing` catches it with `['ghost']`.

## Surface

### Helpers

| Name   | Kind     |
| ------ | -------- |
| `real` | function |

## Patterns

```ts
import { real, ghost } from '@src/core'

real()
ghost()
```
