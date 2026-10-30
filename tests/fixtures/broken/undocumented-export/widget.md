# Widget (broken: undocumented-export)

> Variant of the good widget guide with one row removed from the Surface
> table — `DEFAULT_COUNT` is a real export of `good/module` but is not
> documented here, so SB's `documents every source export` direction fails
> with exactly one diff: `['const DEFAULT_COUNT']`.

## Surface

### Types

| Name              | Kind      | Signature                                 | Summary |
| ----------------- | --------- | ----------------------------------------- | ------- |
| `WidgetInterface` | interface | `{ count, inspect(), render(), reset() }` |         |
| `WidgetKind`      | type      | `'basic' \| 'advanced'`                   |         |

### Helpers

| Name          | Kind     | Signature                         | Summary |
| ------------- | -------- | --------------------------------- | ------- |
| `createLabel` | function | `(prefix: string) => string`      |         |
| `loadWidget`  | function | `(id: string) => Promise<string>` |         |

### `Widget`

## Methods

#### `WidgetInterface`

| Method    | Description          |
| --------- | -------------------- |
| `inspect` | Describe the widget. |
| `render`  | Render a label.      |
| `reset`   | Reset the widget.    |

## Tests

- [widget.test.ts](../../good/tests/widget.test.ts)
