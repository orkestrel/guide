# Missing Example

> Fixture guide (BROKEN: missing-example) — `farewell` has no fence mention and
> no `@example` JSDoc; EX's `findUnexampled` catches it with `['farewell']`.

## Surface

### Helpers

| Name       | Kind     | Signature                  | Summary |
| ---------- | -------- | -------------------------- | ------- |
| `greet`    | function | `(name: string) => string` |         |
| `farewell` | function | `(name: string) => string` |         |

## Patterns

```ts
import { greet } from '../module/helpers.js'

greet('world')
```
