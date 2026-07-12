import type { WidgetInterface } from './types.js'

// Variant of good/module/Widget.ts with one EXTRA public method (`extra`)
// beyond WidgetInterface's documented set — the class-no-extra check
// (`findMissing(source.methods('Widget'), group.methods)`) fails with
// `['extra']`.
export class Widget implements WidgetInterface {
	readonly count: number
	#label: string

	constructor(label: string) {
		this.#label = label
		this.count = 0
	}

	inspect(): string {
		return this.#describe()
	}

	render(label: string): string {
		return `${label}:${this.count}`
	}

	reset(): void {
		this.#label = ''
	}

	extra(): void {
		this.#label = this.#label.trim()
	}

	get label(): string {
		return this.#label
	}

	static create(label: string): Widget {
		return new Widget(label)
	}

	#describe(): string {
		return `Widget(${this.#label})`
	}
}
