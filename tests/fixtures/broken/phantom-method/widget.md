# Widget (broken: phantom-method)

> Variant of the good widget guide whose `WidgetInterface` Methods table
> documents a `destroy` method that does not exist on the real interface —
> `documents no phantom method` fails with `['destroy']`.

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
| `destroy` | Does not exist.      |

## Tests

- [widget.test.ts](../../good/tests/widget.test.ts)
