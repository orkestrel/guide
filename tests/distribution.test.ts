import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildDistributionCases, createDistributionSuite } from './setupDistribution.js'
import { readGuideDistributionErrors } from './setupServer.js'

const suite = createDistributionSuite()
beforeAll(() => suite.start())
afterAll(() => suite.destroy())

describe('packed package', () => {
	for (const entry of buildDistributionCases(suite)) {
		it(`${entry.label}`, async (context) => {
			const observation = await entry.observe(context)
			expect(observation.actual).toStrictEqual(observation.expected)
		})
	}

	it('publishes no browser face this proof cannot drive [requires the registry]', (context) => {
		expect(
			suite
				.read(context)
				.entries.filter((entry) => entry.browsable)
				.map((entry) => entry.subpath),
		).toEqual([])
	})

	it('recognizes Guide errors across packed copies and module formats [requires the registry]', (context) => {
		expect(readGuideDistributionErrors(suite.read(context))).toEqual({
			distinct: true,
			hidden: true,
			checks: Array.from({ length: 16 }, () => ({
				cross: true,
				subclass: true,
				lookalike: false,
				proxy: false,
				plain: false,
			})),
		})
	})
})
