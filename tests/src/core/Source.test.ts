import { Source } from '@src/core'
import { describe, expect, it } from 'vitest'
import { fixtureFiles } from '../../setup.js'

// The pure Source view over a consumer-supplied file inventory — exports(),
// methods(name), and exists(relative). Constructed from the good fixture
// (the bijection-perfect widget package) and the broken/class-extra-method
// fixture (the drop-in-catches-extras red path) (AGENTS §16).

describe('Source', () => {
	it("exports() returns the good fixture's exact 6 symbols, sorted by name", () => {
		const source = new Source({ files: fixtureFiles('good'), module: 'module' })
		expect(source.exports()).toEqual([
			{ name: 'DEFAULT_COUNT', kind: 'const' },
			{ name: 'Widget', kind: 'class' },
			{ name: 'WidgetInterface', kind: 'interface' },
			{ name: 'WidgetKind', kind: 'type' },
			{ name: 'createLabel', kind: 'function' },
			{ name: 'loadWidget', kind: 'function' },
		])
	})

	it('exports() caches the scan — repeated calls return the same array instance', () => {
		const source = new Source({ files: fixtureFiles('good'), module: 'module' })
		expect(source.exports()).toBe(source.exports())
	})

	it('methods(WidgetInterface) and methods(Widget) agree on the same three methods', () => {
		const source = new Source({ files: fixtureFiles('good'), module: 'module' })
		expect(source.methods('WidgetInterface')).toEqual(['inspect', 'render', 'reset'])
		expect(source.methods('Widget')).toEqual(['inspect', 'render', 'reset'])
	})

	it('methods(Widget) excludes the constructor, getter, static, and #private traps', () => {
		const source = new Source({ files: fixtureFiles('good'), module: 'module' })
		const methods = source.methods('Widget')
		expect(methods).not.toContain('constructor')
		expect(methods).not.toContain('label')
		expect(methods).not.toContain('create')
		expect(methods).not.toContain('describe')
	})

	it('methods() returns an empty array for a name with no declaration in scope', () => {
		const source = new Source({ files: fixtureFiles('good'), module: 'module' })
		expect(source.methods('Nonexistent')).toEqual([])
	})

	it('exists() is true for an exact key', () => {
		const source = new Source({ files: fixtureFiles('good'), module: 'module' })
		expect(source.exists('module/Widget.ts')).toBe(true)
	})

	it('exists() is true for a directory prefix', () => {
		const source = new Source({ files: fixtureFiles('good'), module: 'module' })
		expect(source.exists('module')).toBe(true)
	})

	it('exists() is false for a path not in the inventory', () => {
		const source = new Source({ files: fixtureFiles('good'), module: 'module' })
		expect(source.exists('module/gone.ts')).toBe(false)
	})

	it('exists() excludes index.ts and .test.ts files from exports() but not from exists()', () => {
		const source = new Source({ files: fixtureFiles('good'), module: 'module' })
		expect(source.exists('module/index.ts')).toBe(true)
		expect(source.exists('module/sample.test.ts')).toBe(true)
	})

	it('class-extra-method: methods(Widget) includes the extra method the interface does not document', () => {
		const source = new Source({
			files: fixtureFiles('broken/class-extra-method'),
			module: 'module',
		})
		expect(source.methods('Widget')).toContain('extra')
		expect(source.methods('WidgetInterface')).not.toContain('extra')
	})

	it('unions exports() across a multi-dir GuideModule', () => {
		const files = {
			...fixtureFiles('good'),
			...Object.fromEntries(
				Object.entries(fixtureFiles('broken/class-extra-method')).map(([key, value]) => [
					`extra/${key}`,
					value,
				]),
			),
		}
		const source = new Source({ files, module: ['module', 'extra/module'] })
		const names = source.exports().map((symbol) => symbol.name)
		expect(new Set(names).size).toBe(source.exports().length)
		expect(names).toContain('Widget')
	})

	it('returns empty exports() and false exists() for an empty file inventory', () => {
		const source = new Source({ files: {}, module: 'module' })
		expect(source.exports()).toEqual([])
		expect(source.exists('module/Widget.ts')).toBe(false)
	})
})
