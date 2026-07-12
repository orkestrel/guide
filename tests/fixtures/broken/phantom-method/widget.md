# Widget (broken: phantom-method)

> Variant of the good widget guide whose `WidgetInterface` Methods table
> documents a `destroy` method that does not exist on the real interface —
> `documents no phantom method` fails with `['destroy']`.

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

### `Widget`

## Methods

#### `WidgetInterface`

| Method | Description |
| --- | --- |
| `inspect` | Describe the widget. |
| `render` | Render a label. |
| `reset` | Reset the widget. |
| `destroy` | Does not exist. |

## Tests

- [widget.test.ts](../../good/tests/widget.test.ts)
