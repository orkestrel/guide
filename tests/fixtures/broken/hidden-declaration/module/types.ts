// Fixture module (GOOD) — exercises every ExportKeyword the guides-parity
// scanner supports, plus shapes the scanner is required to EXCLUDE (data
// members, getters, statics, `#` privates, constructor). See guides/src/widget.md
// for the bijection-perfect guide documenting this module.

export interface WidgetInterface<T = Record<string, unknown>> {
	readonly count: number
	inspect(): string
	render(label: string, data?: T): string
	reset(): void
}

export type WidgetKind = 'basic' | 'advanced'
