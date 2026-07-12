# Widget (broken: missing-interface-method)

> Variant of the good widget guide whose `WidgetInterface` Methods table is
> missing the `reset` row — `reset` is a real interface member, so
> `documents every interface method` fails with `['reset']`.

## Surface

### Types

| Name              | Kind      |
| ----------------- | --------- |
| `WidgetInterface` | interface |
| `WidgetKind`      | type      |

### Helpers

| Name            | Kind     |
| --------------- | -------- |
| `createLabel`   | function |
| `loadWidget`    | function |
| `DEFAULT_COUNT` | const    |

### `Widget`

## Methods

#### `WidgetInterface`

| Method    | Description          |
| --------- | -------------------- |
| `inspect` | Describe the widget. |
| `render`  | Render a label.      |

## Tests

- [widget.test.ts](../../good/tests/widget.test.ts)
