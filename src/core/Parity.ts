import type { MarkdownSpan } from '@orkestrel/markdown'
import type {
	Drift,
	ManifestEntry,
	ParityExampleResult,
	ParityFinding,
	ParityInterface,
	ParityOptions,
	ParityResult,
	ParityRewriteResult,
	ParityRow,
	SourceExample,
} from './types.js'
import { isNonEmptyString } from '@orkestrel/contract'
import {
	collectExamples,
	collectTitles,
	compareMembership,
	computeSymbolKey,
	extractFenceImports,
	findDrift,
	findMissing,
	findMissingSymbols,
	findUnexampled,
	findUnlisted,
	formatDrift,
	formatSide,
	identifyDrift,
	isExternalLink,
	locateComment,
	normalizeDirectories,
	normalizeComment,
	replaceCell,
	replaceExample,
	replaceFence,
	replaceSummary,
	resolveLink,
	selectModuleKeys,
	spliceSpan,
} from './helpers.js'
import { METHODS, SURFACE, TESTS } from './constants.js'
import { Guide } from './Guide.js'
import { Source } from './sources/Source.js'
import { SourceManager } from './sources/SourceManager.js'

/**
 * Composes generic guide-parity inspection and explicit in-memory rewrites over a caller inventory.
 */
export class Parity implements ParityInterface {
	readonly #options: ParityOptions
	readonly #rows: readonly ParityRow[]

	constructor(options: ParityOptions) {
		this.#options = {
			files: { ...options.files },
			entries: options.entries.map((entry) => ({ ...entry })),
			modules: { ...options.modules },
			languages: [...options.languages],
			language: options.language,
			...(options.pitch === undefined ? {} : { pitch: { ...options.pitch } }),
		}
		this.#rows = this.#createRows(this.#options.files)
	}

	rows(): readonly ParityRow[] {
		return this.#rows
	}

	inspect(): ParityResult {
		const input: ParityFinding[] = []
		const sections: ParityFinding[] = []
		const surface: ParityFinding[] = []
		const methods: ParityFinding[] = []
		const declarations: ParityFinding[] = []
		const links: ParityFinding[] = []
		const tests: ParityFinding[] = []
		const fences: ParityFinding[] = []
		const exampleFences: ParityFinding[] = []
		const exampleFunctions: ParityFinding[] = []
		const exampleMethods: ParityFinding[] = []
		const exampleTitles: ParityFinding[] = []
		const examples: ParityExampleResult = {
			fences: exampleFences,
			functions: exampleFunctions,
			methods: exampleMethods,
			titles: exampleTitles,
		}
		const imports: ParityFinding[] = []
		const drift: ParityFinding[] = []
		const pitch: ParityFinding[] = []

		this.#inspectInput(input)
		for (const row of this.#rows) {
			this.#inspectSections(row, sections)
			this.#inspectSurface(row, surface)
			this.#inspectMethods(row, methods)
			this.#inspectDeclarations(row, declarations)
			this.#inspectLinks(row, links, tests)
			this.#inspectFences(row, fences)
			this.#inspectExamples(row, exampleFences, exampleFunctions, exampleMethods, exampleTitles)
			this.#inspectImports(row, imports)
			this.#inspectDrift(row, drift)
		}
		this.#inspectPitch(pitch)

		return {
			input,
			sections,
			surface,
			methods,
			declarations,
			links,
			tests,
			fences,
			examples,
			imports,
			drift,
			pitch,
		}
	}

	document(): ParityRewriteResult {
		return this.#rewrite((row, drift, files) => this.#rewriteGuide(row, drift, files))
	}

	annotate(): ParityRewriteResult {
		return this.#rewrite((row, drift, files) => this.#rewriteSource(row, drift, files))
	}

	#rewrite(
		apply: (row: ParityRow, drift: Drift, files: Map<string, string>) => string | undefined,
	): ParityRewriteResult {
		const files = new Map(Object.entries(this.#options.files))
		const reasons = new Map<string, string>()
		const requested = new Set<string>()

		for (const row of this.#rows) {
			for (const drift of findDrift(row.guide, row.source)) {
				const identity = identifyDrift(row.entry.spec, drift)
				requested.add(identity)
				const reason = apply(row, drift, files)
				if (reason !== undefined) reasons.set(identity, reason)
			}
		}

		const inventory = Object.fromEntries(files)
		const remaining: ParityFinding[] = []
		const result = new Parity({ ...this.#options, files: inventory })
		remaining.push(...result.inspect().input)
		for (const row of result.rows()) {
			for (const drift of findDrift(row.guide, row.source)) {
				const identity = identifyDrift(row.entry.spec, drift)
				if (!requested.has(identity)) continue
				remaining.push({
					spec: row.entry.spec,
					text: `${formatDrift(drift)}; ${reasons.get(identity) ?? 'the requested destination still disagrees'}`,
				})
			}
		}

		const changes = Array.from(files.entries())
			.filter(([path, content]) => this.#options.files[path] !== content)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([path, content]) => ({ path, content }))
		return { changes, findings: remaining }
	}

	#createRows(files: Readonly<Record<string, string>>): readonly ParityRow[] {
		const rows: ParityRow[] = []
		for (const entry of this.#options.entries) {
			const text = files[entry.spec]
			if (text === undefined) continue
			rows.push({
				entry,
				guide: new Guide(text),
				source: new Source({ files, module: entry.source }),
			})
		}
		return rows
	}

	#inspectInput(findings: ParityFinding[]): void {
		if (this.#options.entries.length === 0) {
			findings.push({ text: 'The manifest has no guide entries.' })
		}
		for (const entry of this.#options.entries) {
			if (this.#options.files[entry.spec] !== undefined) continue
			findings.push({ spec: entry.spec, text: `${entry.spec} is absent from the inventory.` })
		}
	}

	#inspectSections(row: ParityRow, findings: ParityFinding[]): void {
		const sections = row.guide.sections()
		for (const heading of [SURFACE, METHODS, TESTS]) {
			if (sections.includes(heading)) continue
			findings.push({
				spec: row.entry.spec,
				text: `${row.entry.spec} has no ## ${heading} section.`,
			})
		}
		if (row.guide.methods().length === 0) {
			findings.push({
				spec: row.entry.spec,
				text: `${row.entry.spec} has no documented method groups.`,
			})
		}
	}

	#inspectSurface(row: ParityRow, findings: ParityFinding[]): void {
		if (row.guide.surface().length === 0) {
			findings.push({ spec: row.entry.spec, text: `${row.entry.spec} has no documented surface.` })
		}
		for (const unnamed of row.guide.unnamed()) {
			findings.push({
				spec: row.entry.spec,
				text: `${row.entry.spec} has an unnamed row: ${unnamed}`,
			})
		}
		for (const key of findMissingSymbols(row.source.exports(), row.source.surface())) {
			findings.push({ spec: row.entry.spec, text: `${row.entry.spec} does not re-export ${key}.` })
		}
		for (const key of findMissingSymbols(row.source.surface(), row.source.exports())) {
			findings.push({
				spec: row.entry.spec,
				text: `${row.entry.spec} barrel exposes no direct ${key}.`,
			})
		}
		for (const key of findMissingSymbols(row.source.surface(), row.guide.surface())) {
			findings.push({ spec: row.entry.spec, text: `${row.entry.spec} does not document ${key}.` })
		}
		for (const key of findMissingSymbols(row.guide.surface(), row.source.surface())) {
			findings.push({ spec: row.entry.spec, text: `${row.entry.spec} documents no barrel ${key}.` })
		}
		for (const symbol of row.source.hidden()) {
			findings.push({
				spec: row.entry.spec,
				text: `${row.entry.spec} source hides ${computeSymbolKey(symbol)}.`,
			})
		}
	}

	#inspectMethods(row: ParityRow, findings: ParityFinding[]): void {
		for (const group of row.guide.methods()) {
			const documented = group.methods.map((entry) => entry.name)
			const declared = row.source.methods(group.interface).map((entry) => entry.name)
			if (documented.length === 0) {
				findings.push({
					spec: row.entry.spec,
					text: `${row.entry.spec} ${group.interface} has no documented methods.`,
				})
			}
			for (const name of findMissing(declared, documented)) {
				findings.push({
					spec: row.entry.spec,
					text: `${row.entry.spec} does not document ${group.interface}.${name}.`,
				})
			}
			for (const name of findMissing(documented, declared)) {
				findings.push({
					spec: row.entry.spec,
					text: `${row.entry.spec} documents no source ${group.interface}.${name}.`,
				})
			}
			const entity = group.interface.replace(/Interface$/, '')
			if (entity === group.interface) continue
			for (const name of findMissing(
				row.source.methods(entity).map((entry) => entry.name),
				documented,
			)) {
				findings.push({
					spec: row.entry.spec,
					text: `${row.entry.spec} ${entity}.${name} is outside the ${group.interface} contract.`,
				})
			}
		}
	}

	#inspectDeclarations(row: ParityRow, findings: ParityFinding[]): void {
		const groups = row.guide.methods()
		const documented = groups.map((group) => group.interface)
		const declared = new Set(row.source.surface().map((symbol) => symbol.name))

		for (const group of groups) {
			const finding = compareMembership(
				row.entry.spec,
				group.interface,
				group.methods.map((entry) => entry.name),
				row.source.methods(group.interface).map((entry) => entry.name),
			)
			if (finding !== undefined) findings.push(finding)
		}

		for (const symbol of row.source.surface()) {
			if (symbol.keyword !== 'interface' && symbol.keyword !== 'class') continue
			const members = row.source.methods(symbol.name).map((entry) => entry.name)
			if (members.length === 0) continue
			const contract = `${symbol.name}Interface`
			const implementing = symbol.keyword === 'class' && declared.has(contract)
			if (implementing) {
				const finding = compareMembership(
					row.entry.spec,
					symbol.name,
					row.source.methods(contract).map((entry) => entry.name),
					members,
				)
				if (finding !== undefined) findings.push(finding)
				continue
			}
			if (documented.includes(symbol.name)) continue
			findings.push({
				spec: row.entry.spec,
				text: `${row.entry.spec} ${symbol.name} declares members and carries no method table.`,
			})
		}
	}

	#inspectLinks(row: ParityRow, links: ParityFinding[], tests: ParityFinding[]): void {
		if (row.guide.links().length === 0) {
			links.push({ spec: row.entry.spec, text: `${row.entry.spec} has no links.` })
		}
		for (const href of row.guide.links()) {
			if (isExternalLink(href)) continue
			const path = resolveLink(row.entry.spec, href)
			if (row.source.exists(path)) continue
			links.push({ spec: row.entry.spec, text: `${row.entry.spec} has a broken link: ${href}.` })
		}
		if (row.guide.tests().length === 0) {
			tests.push({ spec: row.entry.spec, text: `${row.entry.spec} has no test links.` })
		}
		for (const href of row.guide.tests()) {
			const path = resolveLink(row.entry.spec, href)
			if (row.source.exists(path)) continue
			tests.push({ spec: row.entry.spec, text: `${row.entry.spec} has a missing test: ${href}.` })
		}
	}

	#inspectFences(row: ParityRow, findings: ParityFinding[]): void {
		for (const fence of findUnlisted(row.guide.fences(), this.#options.languages)) {
			findings.push({
				spec: row.entry.spec,
				text: `${row.entry.spec} has an unlisted fence language under ${fence.title ?? 'no heading'}: ${fence.language ?? 'absent'}.`,
			})
		}
	}

	#inspectExamples(
		row: ParityRow,
		fencesFindings: ParityFinding[],
		functionFindings: ParityFinding[],
		methodFindings: ParityFinding[],
		titleFindings: ParityFinding[],
	): void {
		const fences = row.guide
			.fences()
			.filter((fence) => fence.language === this.#options.language)
			.map((fence) => fence.code)
		if (fences.length === 0) {
			fencesFindings.push({
				spec: row.entry.spec,
				text: `${row.entry.spec} has no ${this.#options.language} example fence.`,
			})
		}
		const functions = row.guide
			.surface()
			.filter((symbol) => symbol.keyword === 'function')
			.map((symbol) => symbol.name)
		for (const name of findUnexampled(
			functions,
			fences,
			row.source.examples().map((example) => example.name),
		)) {
			functionFindings.push({
				spec: row.entry.spec,
				text: `${row.entry.spec} has no example for ${name}.`,
			})
		}

		for (const group of row.guide.methods()) {
			const entity = group.interface.replace(/Interface$/, '')
			const examples = row.source.examples(group.interface).map((example) => example.name)
			if (entity !== group.interface) {
				examples.push(...row.source.examples(entity).map((example) => example.name))
			}
			for (const name of findUnexampled(
				group.methods.map((entry) => entry.name),
				fences,
				examples,
			)) {
				methodFindings.push({
					spec: row.entry.spec,
					text: `${row.entry.spec} has no example for ${group.interface}.${name}.`,
				})
			}
		}

		const guide = row.guide
			.fences()
			.map((fence) => fence.title)
			.filter(isNonEmptyString)
		const source = row.source
			.examples()
			.map((example) => example.title)
			.filter(isNonEmptyString)
		if (!guide.some((title) => source.includes(title))) {
			titleFindings.push({
				spec: row.entry.spec,
				text: `${row.entry.spec} has no top-level example-title pair: guide ${JSON.stringify(guide)} source ${JSON.stringify(source)}.`,
			})
		}
	}

	#inspectImports(row: ParityRow, findings: ParityFinding[]): void {
		const sources = new SourceManager({
			files: this.#options.files,
			modules: this.#options.modules,
		})
		let compared = false
		for (const fence of row.guide.fences()) {
			if (fence.language !== this.#options.language) continue
			for (const imported of extractFenceImports(fence.code)) {
				const source = sources.source(imported.specifier)
				if (source === undefined) continue
				compared = true
				const surface = source.surface().map((symbol) => symbol.name)
				for (const name of findMissing(imported.names, surface)) {
					findings.push({
						spec: row.entry.spec,
						text: `${row.entry.spec} imports missing ${name} from ${imported.specifier}.`,
					})
				}
			}
		}
		if (!compared) {
			findings.push({ spec: row.entry.spec, text: `${row.entry.spec} has no mapped self import.` })
		}
	}

	#inspectDrift(row: ParityRow, findings: ParityFinding[]): void {
		for (const drift of findDrift(row.guide, row.source)) {
			findings.push({ spec: row.entry.spec, text: formatDrift(drift) })
		}
	}

	#inspectPitch(findings: ParityFinding[]): void {
		const pitch = this.#options.pitch
		if (pitch === undefined) return
		const readme = this.#options.files[pitch.readme]
		const spec = this.#options.files[pitch.spec]
		if (readme === undefined) {
			findings.push({ spec: pitch.readme, text: `${pitch.readme} is absent from the inventory.` })
			return
		}
		if (spec === undefined) {
			findings.push({ spec: pitch.spec, text: `${pitch.spec} is absent from the inventory.` })
			return
		}
		const left = new Guide(readme).tagline()
		const right = new Guide(spec).tagline()
		if (left !== undefined && left === right) return
		findings.push({
			spec: pitch.spec,
			text: `${pitch.spec} pitch: README ${formatSide(left)} guide ${formatSide(right)}.`,
		})
	}

	#rewriteGuide(row: ParityRow, drift: Drift, files: Map<string, string>): string | undefined {
		if (drift.source === undefined) return 'source authority is absent'
		const current = files.get(row.entry.spec)
		if (current === undefined) return 'the guide inventory text is absent'

		if (drift.category === 'summary') {
			const replacement = replaceCell(current, drift.key, drift.source)
			if (replacement === undefined)
				return 'the guide summary cell or its provenance is unavailable'
			files.set(row.entry.spec, replacement)
			return undefined
		}

		const example = collectTitles(row.guide, row.source).get(drift.key)
		if (example === undefined) return 'the paired source example is unavailable'
		const replacement = replaceFence(current, drift.key, example)
		if (replacement === undefined) return 'the titled guide fence or its provenance is unavailable'
		files.set(row.entry.spec, replacement)
		return undefined
	}

	#rewriteSource(row: ParityRow, drift: Drift, files: Map<string, string>): string | undefined {
		if (drift.guide === undefined) return 'guide authority is absent'
		if (drift.category === 'summary') {
			const located = this.#locateSource(row.entry, drift.key, files)
			if (located === undefined) return 'the source doc block or its provenance is unavailable'
			const comment = located.text.slice(located.span.start, located.span.end)
			const replacement = replaceSummary(comment, drift.guide)
			if (replacement === undefined) return 'the source summary cannot be represented safely'
			files.set(located.path, spliceSpan(located.text, located.span, replacement))
			return undefined
		}

		const fence = row.guide.fences().find((entry) => entry.title === drift.key)
		const located = this.#locateExample(row, drift.key, files)
		if (fence === undefined || located === undefined) {
			return 'the paired source example or its provenance is unavailable'
		}
		const comment = located.text.slice(located.span.start, located.span.end)
		const example: SourceExample = {
			name: located.example.name,
			title: drift.key,
			code: fence.code,
			...(fence.language === undefined ? {} : { language: fence.language }),
		}
		const replacement = replaceExample(comment, example)
		if (replacement === undefined) return 'the guide example cannot be represented safely'
		files.set(located.path, spliceSpan(located.text, located.span, replacement))
		return undefined
	}

	#locateSource(
		entry: ManifestEntry,
		key: string,
		files: ReadonlyMap<string, string>,
	): { readonly path: string; readonly text: string; readonly span: MarkdownSpan } | undefined {
		const inventory = Object.fromEntries(files)
		for (const path of selectModuleKeys(inventory, normalizeDirectories(entry.source))) {
			const text = files.get(path)
			if (text === undefined) continue
			const span = locateComment(text, key)
			if (span !== undefined) return { path, text, span }
		}
		return undefined
	}

	#locateExample(
		row: ParityRow,
		title: string,
		files: ReadonlyMap<string, string>,
	):
		| {
				readonly path: string
				readonly text: string
				readonly span: MarkdownSpan
				readonly example: SourceExample
		  }
		| undefined {
		const target = collectTitles(row.guide, row.source).get(title)
		if (target === undefined) return undefined
		const keys: string[] = []
		for (const symbol of row.source.exports()) {
			if (symbol.name === target.name) keys.push(computeSymbolKey(symbol))
		}
		for (const owner of row.guide.surface()) {
			if (owner.keyword !== 'class' && owner.keyword !== 'interface') continue
			const matched = row.source
				.examples(owner.name)
				.some((example) => example.name === target.name && example.title === title)
			if (matched) keys.push(`${owner.name}.${target.name}`)
		}

		const inventory = Object.fromEntries(files)
		for (const path of selectModuleKeys(inventory, normalizeDirectories(row.entry.source))) {
			const text = files.get(path)
			if (text === undefined) continue
			let selected: { readonly span: MarkdownSpan; readonly example: SourceExample } | undefined
			for (const key of keys) {
				const span = locateComment(text, key)
				if (span === undefined) continue
				const comment = normalizeComment(text.slice(span.start, span.end))
				const example = collectExamples(comment, target.name).find((entry) => entry.title === title)
				if (example === undefined) continue
				if (selected === undefined || span.start < selected.span.start) selected = { span, example }
			}
			if (selected !== undefined) return { path, text, ...selected }
		}
		return undefined
	}
}
