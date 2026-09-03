import type { WidgetInterface } from './types.js'

// Variant of good/module/Widget.ts with one hidden module-scope function
// (`secretHelper`, no `export` keyword) beside the normal exports — the
// export-discipline check (`source.hidden()`) fails with
// `[ { name: 'secretHelper', keyword: 'function' } ]`.
function secretHelper(label: string): string {
	return label.trim()
}

export class Widget implements WidgetInterface {
	readonly count: number
	#label: string

	constructor(label: string) {
		this.#label = secretHelper(label)
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
