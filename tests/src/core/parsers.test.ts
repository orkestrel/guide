import { parseManifest } from '@src/core'
import { describe, expect, it } from 'vitest'
import { readInventory } from '@orkestrel/test/server'
import { requireText } from '../../setupServer.js'

const FIXTURES = readInventory(new URL('../../fixtures/', import.meta.url), ['.'])

// The manifest coercer — `## By concept` table rows into `ManifestEntry`
// values, with every Spec/Source/Tests link resolved against the manifest's own
// directory. Composed behavior — helpers.test.ts covers the section scoping,
// cell-link, and path-resolution leaves this builds on (AGENTS §16).

describe('parseManifest', () => {
	it("parses the good manifest's one row with normalized paths", () => {
		const entries = parseManifest(requireText(FIXTURES, 'good/guides/README.md'), 'guides')
		expect(entries).toEqual([
			{ concept: 'Widget', spec: 'guides/src/widget.md', source: 'module', tests: 'tests' },
		])
	})

	it('returns an empty array for an empty manifest table', () => {
		expect(
			parseManifest(requireText(FIXTURES, 'broken/empty-manifest/README.md'), 'guides'),
		).toEqual([])
	})

	it('skips a row missing a concept', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n|  | [s](s.md) | [m](m) | [t](t) |\n'
		expect(parseManifest(markdown, 'guides')).toEqual([])
	})

	it('skips a row missing a spec link', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n| X | no-link | [m](m) | [t](t) |\n'
		expect(parseManifest(markdown, 'guides')).toEqual([])
	})

	it('skips a row missing a source link', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n| X | [s](s.md) | no-link | [t](t) |\n'
		expect(parseManifest(markdown, 'guides')).toEqual([])
	})

	it('skips a row missing a tests link', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n| X | [s](s.md) | [m](m) | no-link |\n'
		expect(parseManifest(markdown, 'guides')).toEqual([])
	})

	it('collapses a single source directory to a string', () => {
		const entries = parseManifest(requireText(FIXTURES, 'good/guides/README.md'), 'guides')
		expect(entries[0]?.source).toBe('module')
	})

	it('collects multiple source links into an array', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n| X | [s](s.md) | [a](a) [b](b) | [t](t) |\n'
		const entries = parseManifest(markdown, 'guides')
		expect(entries[0]?.source).toEqual(['guides/a', 'guides/b'])
	})

	it("canonicalizes root and duplicate source links to '.'", () => {
		const markdown = [
			'## By concept',
			'',
			'| Concept | Spec | Source | Tests |',
			'| --- | --- | --- | --- |',
			'| Root | [guide](./guide.md) | [root](..) [same](../.) | [tests](../tests) |',
		].join('\n')
		expect(parseManifest(markdown, 'guides')).toEqual([
			{ concept: 'Root', spec: 'guides/guide.md', source: '.', tests: 'tests' },
		])
	})

	it('resolves every manifest path from a nested manifest directory', () => {
		const markdown =
			'## By concept\n\n| Concept | Spec | Source | Tests |\n| --- | --- | --- | --- |\n| X | [s](spec.md) | [m](module) | [t](tests) |\n'
		expect(parseManifest(markdown, 'guides/nested')).toEqual([
			{
				concept: 'X',
				spec: 'guides/nested/spec.md',
				source: 'guides/nested/module',
				tests: 'guides/nested/tests',
			},
		])
	})
})
