// Copy of good/module/types.ts — unmodified. Colocated (rather than shared)
// because this mode's defect lives in Widget.ts and the module must be
// self-contained for the class-no-extra check to target it in isolation.

export interface WidgetInterface<T = Record<string, unknown>> {
	readonly count: number
	inspect(): string
	render(label: string, data?: T): string
	reset(): void
}

export type WidgetKind = 'basic' | 'advanced'
