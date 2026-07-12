# Widget (broken: missing-test-link)

> Variant of the good widget guide whose `## Tests` link points at a test
> file that does not exist — TE's tests-link-existence check fails with
> `['good/tests/missing.test.ts']`.

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

- [missing.test.ts](../../good/tests/missing.test.ts)
