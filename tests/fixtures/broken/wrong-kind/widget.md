# Widget (broken: wrong-kind)

> Variant of the good widget guide where `createLabel` (a real `function`
> export) is documented with Kind `const` — SB's `symbolKey` bijection drifts
> in both directions: `['function createLabel']` missing from the guide and
> `['const createLabel']` missing from the source.

## Surface

### Types

| Name | Kind |
| --- | --- |
| `WidgetInterface` | interface |
| `WidgetKind` | type |

### Helpers

| Name | Kind |
| --- | --- |
| `createLabel` | const |
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
