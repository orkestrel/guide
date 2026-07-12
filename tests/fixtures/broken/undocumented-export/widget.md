# Widget (broken: undocumented-export)

> Variant of the good widget guide with one row removed from the Surface
> table — `DEFAULT_COUNT` is a real export of `good/module` but is not
> documented here, so SB's `documents every source export` direction fails
> with exactly one diff: `['const DEFAULT_COUNT']`.

## Surface

### Types

| Name              | Kind      |
| ----------------- | --------- |
| `WidgetInterface` | interface |
| `WidgetKind`      | type      |

### Helpers

| Name          | Kind     |
| ------------- | -------- |
| `createLabel` | function |
| `loadWidget`  | function |

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
