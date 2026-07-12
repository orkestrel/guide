# Widget (broken: renamed-surface)

> Variant of the good widget guide whose `## Surface` heading was renamed to
> `## Exports` — `extractSurface` scopes strictly to the literal `Surface`
> heading text, so this guide's `surface()` extracts empty, and the NV
> non-vacuousness guard (`guide.surface().length > 0`) fails loudly instead
> of the suite passing vacuously.

## Exports

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
