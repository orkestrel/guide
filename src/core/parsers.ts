import type { ManifestEntry } from './types.js'
import { createMarkdown, flattenText, isTableNode } from '@orkestrel/markdown'
import { isEmptyString, isNonEmptyArray } from '@orkestrel/contract'
import { MANIFEST } from './constants.js'
import {
	extractCellLinks,
	normalizeDirectories,
	resolvePath,
	selectSectionBlocks,
} from './helpers.js'

/**
 * Parses a `## By concept` manifest table into its {@link ManifestEntry} rows —
 * each row's Concept cell (flattened text), Spec / Tests cells (a single link
 * href, resolved against `directory`), and Source cell (every link href,
 * resolved against `directory`; Source links canonicalize through
 * {@link normalizeDirectories}, one directory collapses to a `string`, and several become
 * a `readonly string[]`). A row missing a concept, spec link, tests link, or
 * source link is skipped as malformed.
 *
 * @param markdown - The manifest markdown source, for example the content of `guides/README.md`
 * @param directory - The root-relative directory containing the manifest
 * @returns The manifest's entries, in row order
 *
 * @example
 * ```ts
 * parseManifest(readme, 'guides') // [{ concept: 'Markdown', spec: 'guides/src/markdown.md', ... }]
 * ```
 */
export function parseManifest(markdown: string, directory: string): readonly ManifestEntry[] {
	const document = createMarkdown(markdown).document
	const entries: ManifestEntry[] = []

	for (const block of selectSectionBlocks(document, MANIFEST)) {
		if (!isTableNode(block)) continue

		for (const row of block.rows) {
			const conceptCell = row[0]
			const specCell = row[1]
			const sourceCell = row[2]
			const testsCell = row[3]
			if (
				conceptCell === undefined ||
				specCell === undefined ||
				sourceCell === undefined ||
				testsCell === undefined
			) {
				continue
			}

			const concept = flattenText({ element: 'paragraph', children: conceptCell }).trim()
			if (isEmptyString(concept)) continue

			const specHref = extractCellLinks(specCell)[0]
			const testsHref = extractCellLinks(testsCell)[0]
			if (specHref === undefined || testsHref === undefined) continue

			const sourceHrefs = normalizeDirectories(
				extractCellLinks(sourceCell).map((href) => resolvePath(directory, href)),
			)
			if (!isNonEmptyArray<string>(sourceHrefs)) continue
			const [firstSource] = sourceHrefs
			const source = sourceHrefs.length === 1 ? firstSource : sourceHrefs

			entries.push({
				concept,
				spec: resolvePath(directory, specHref),
				source,
				tests: resolvePath(directory, testsHref),
			})
		}
	}

	return entries
}
