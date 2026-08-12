import { createMarkdown, flattenText, isHeadingNode } from '@orkestrel/markdown'
import type { GuideInterface, MethodGroup, SurfaceSymbol } from './types.js'
import {
	extractLinks,
	extractMethods,
	extractPatterns,
	extractSurface,
	extractTests,
} from './helpers.js'

/**
 * A stateful, structured view over one parsed guide — the six documented
 * projections (`sections` / `surface` / `methods` / `links` / `tests` /
 * `patterns`) are extracted once at construction and cached.
 *
 * @remarks
 * Pure: parses `source` once via `@orkestrel/markdown` and never touches the
 * filesystem — `Guide` has no notion of "where" the guide came from, only its
 * markdown text. Every accessor returns the same cached, readonly array on
 * every call.
 *
 * @example
 * ```ts
 * import { Guide } from '@orkestrel/guide'
 *
 * const guide = new Guide('## Surface\n\n| Name | Kind |\n| --- | --- |\n| `X` | class |')
 * guide.surface() // [{ name: 'X', kind: 'class' }]
 * ```
 */
export class Guide implements GuideInterface {
	readonly #sections: readonly string[]
	readonly #surface: readonly SurfaceSymbol[]
	readonly #methods: readonly MethodGroup[]
	readonly #links: readonly string[]
	readonly #tests: readonly string[]
	readonly #patterns: readonly string[]

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
		this.#patterns = extractPatterns(document)
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

	patterns(): readonly string[] {
		return this.#patterns
	}
}
