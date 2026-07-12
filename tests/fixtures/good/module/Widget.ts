import type { WidgetInterface } from './types.js'

// Implements exactly `WidgetInterface`'s three methods, plus a constructor,
// a getter, a static member, and a `#`-private method — every one of which
// the member scanner must exclude from `methods('Widget')`.
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
