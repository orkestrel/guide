# Widget (broken: missing-test-link)

> Variant of the good widget guide whose `## Tests` link points at a test
> file that does not exist — TE's tests-link-existence check fails with
> `['good/tests/missing.test.ts']`.

## Surface

### Types

| Name              | Kind      | Signature                                 | Summary |
| ----------------- | --------- | ----------------------------------------- | ------- |
| `WidgetInterface` | interface | `{ count, inspect(), render(), reset() }` |         |
| `WidgetKind`      | type      | `'basic' \| 'advanced'`                   |         |

### Helpers

| Name            | Kind     | Signature                         | Summary |
| --------------- | -------- | --------------------------------- | ------- |
| `createLabel`   | function | `(prefix: string) => string`      |         |
| `loadWidget`    | function | `(id: string) => Promise<string>` |         |
| `DEFAULT_COUNT` | const    | `number`                          |         |

### `Widget`

## Methods

#### `WidgetInterface`

| Method    | Description          |
| --------- | -------------------- |
| `inspect` | Describe the widget. |
| `render`  | Render a label.      |
| `reset`   | Reset the widget.    |

## Tests

- [missing.test.ts](../../good/tests/missing.test.ts)
