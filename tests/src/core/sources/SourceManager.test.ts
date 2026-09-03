import { createSourceManager, computeModuleKey } from '@src/core'
import { describe, expect, it } from 'vitest'

const FILES = Object.freeze({
	'core/index.ts': "export * from './value.js'\n",
	'core/value.ts': 'export const coreValue = true\n',
	'browser/index.ts': "export * from './value.js'\n",
	'browser/value.ts': 'export const browserValue = true\n',
})

describe('computeModuleKey', () => {
	it('returns the same key for equal array-valued modules', () => {
		expect(computeModuleKey(['core', 'browser'])).toBe(computeModuleKey(['core', 'browser']))
	})

	it('does not collide between distinct module boundaries', () => {
		expect(computeModuleKey(['core', 'browser'])).not.toBe(computeModuleKey(['core/browser']))
	})
})

describe('SourceManager', () => {
	it('returns undefined for an unmapped specifier', () => {
		const manager = createSourceManager({ files: FILES, modules: {} })
		expect(manager.source('@scope/foreign')).toBeUndefined()
	})

	it('shares one Source by module and keeps a different module distinct', () => {
		const manager = createSourceManager({
			files: FILES,
			modules: {
				'@scope/package': 'core',
				'@scope/package/core': 'core',
				'@scope/package/browser': 'browser',
			},
		})
		const source = manager.source('@scope/package')
		const alias = manager.source('@scope/package/core')
		const control = manager.source('@scope/package/browser')
		expect(source).toBe(alias)
		expect(source).not.toBe(control)
	})

	it('reflects every directory in an array-valued module', () => {
		const manager = createSourceManager({
			files: FILES,
			modules: { '@scope/package': ['core', 'browser'] },
		})
		expect(manager.source('@scope/package')?.surface()).toEqual([
			{ name: 'browserValue', keyword: 'const' },
			{ name: 'coreValue', keyword: 'const' },
		])
	})

	it('accepts an empty modules record', () => {
		const manager = createSourceManager({ files: FILES, modules: {} })
		expect(manager.source('@scope/package')).toBeUndefined()
	})

	it('returns an empty Source for a mapped module with no inventory keys', () => {
		const manager = createSourceManager({
			files: FILES,
			modules: { '@scope/package': 'server' },
		})
		expect(manager.source('@scope/package')?.surface()).toEqual([])
	})

	it('enumerates one shared view per distinct module, in first-seen specifier order', () => {
		const manager = createSourceManager({
			files: FILES,
			modules: {
				'@scope/package': 'core',
				'@scope/package/core': 'core',
				'@scope/package/browser': 'browser',
			},
		})
		// Identity, not shape: two specifiers naming one module must contribute the
		// entity `source()` already caches, so a second scan of the same inventory
		// would show up here as an extra element.
		expect(manager.sources()).toEqual([
			manager.source('@scope/package'),
			manager.source('@scope/package/browser'),
		])
	})

	it('enumerates nothing for an empty policy', () => {
		const manager = createSourceManager({ files: FILES, modules: {} })
		expect(manager.sources()).toEqual([])
	})
})
