# Widget (broken: broken-link)

> Variant of the good widget guide with one extra link (outside `## Tests`)
> pointing at a source path that does not exist — LI's link-integrity check
> fails with `['good/module/gone.ts']`.

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

## Tests

- [widget.test.ts](../../good/tests/widget.test.ts)

## See also

- [gone](../../good/module/gone.ts)
