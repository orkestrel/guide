import type { GuideFence, GuideInterface, MethodGroup, SurfaceSymbol } from './types.js'
import { createMarkdown, flattenText, isHeadingNode } from '@orkestrel/markdown'
import {
	extractFences,
	extractLinks,
	extractMethods,
	extractSurface,
	extractTests,
} from './helpers.js'

/**
 * Presents a pure, structured view over one parsed guide — the documented
 * projections (`sections` / `surface` / `methods` / `links` / `tests` /
 * `fences`) are extracted once at construction and cached.
 *
 * @remarks
 * Parses `source` once through `@orkestrel/markdown` and never touches the
 * filesystem — `Guide` reads only the markdown text it is given and records
 * nothing about where the guide came from. Every accessor returns the same
 * cached, readonly array on every call.
 *
 * @example
 * ```ts
 * import { Guide } from '@orkestrel/guide'
 *
 * const guide = new Guide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `X` | class |')
 * guide.surface() // [{ name: 'X', keyword: 'class' }]
 * ```
 */
export class Guide implements GuideInterface {
	readonly #sections: readonly string[]
	readonly #surface: readonly SurfaceSymbol[]
	readonly #methods: readonly MethodGroup[]
	readonly #links: readonly string[]
	readonly #tests: readonly string[]
	readonly #fences: readonly GuideFence[]

	constructor(source: string) {
		const document = createMarkdown(source).document

		this.#sections = document.children
			.filter(isHeadingNode)
			.filter((heading) => heading.level === 2)
			.map((heading) => flattenText(heading).trim())
		this.#surface = extractSurface(document)
		this.#methods = extractMethods(document)
		this.#links = extractLinks(document)
		this.#tests = extractTests(document)
		this.#fences = extractFences(document)
	}

	sections(): readonly string[] {
		return this.#sections
	}

	surface(): readonly SurfaceSymbol[] {
		return this.#surface
	}

	methods(): readonly MethodGroup[] {
		return this.#methods
	}

	links(): readonly string[] {
		return this.#links
	}

	tests(): readonly string[] {
		return this.#tests
	}

	fences(): readonly GuideFence[] {
		return this.#fences
	}
}
