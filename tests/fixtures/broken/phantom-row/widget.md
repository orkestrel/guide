# Widget (broken: phantom-row)

> Variant of the good widget guide with one extra Surface row for a symbol
> that does not exist in `good/module` — SB's `documents only real exports`
> direction fails with `['function missingExport']`.

## Surface

### Types

| Name | Kind |
| --- | --- |
| `WidgetInterface` | interface |
| `WidgetKind` | type |

### Helpers

| Name | Kind |
| --- | --- |
| `createLabel` | function |
| `loadWidget` | function |
| `DEFAULT_COUNT` | const |
| `missingExport` | function |

### `Widget`

## Methods

#### `WidgetInterface`

| Method | Description |
| --- | --- |
| `inspect` | Describe the widget. |
| `render` | Render a label. |
| `reset` | Reset the widget. |

## Tests

- [widget.test.ts](../../good/tests/widget.test.ts)
