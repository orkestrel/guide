# Widget (broken: class-extra-method)

> Documents this fixture's own `module/Widget.ts`, which exposes one public
> method (`extra`) beyond `WidgetInterface`'s documented set. SB and the
> interface-methods bijection are clean; only the class-no-extra check fails,
> with `['extra']`.

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
