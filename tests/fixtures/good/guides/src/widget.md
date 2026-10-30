# Widget

> A tiny fixture module exercising every ExportKeyword for guides-parity tests.

## Surface

### Types

| Name                 | Kind      | Signature                                 | Summary |
| -------------------- | --------- | ----------------------------------------- | ------- |
| `WidgetInterface<T>` | interface | `{ count, inspect(), render(), reset() }` |         |
| `WidgetKind`         | type      | `'basic' \| 'advanced'`                   |         |

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

- [widget.test.ts](../../tests/widget.test.ts)
