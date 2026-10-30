# Widget (broken: broken-link)

> Variant of the good widget guide with one extra link (outside `## Tests`)
> pointing at a source path that does not exist — LI's link-integrity check
> fails with `['good/module/gone.ts']`.

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

- [widget.test.ts](../../good/tests/widget.test.ts)

## See also

- [gone](../../good/module/gone.ts)
