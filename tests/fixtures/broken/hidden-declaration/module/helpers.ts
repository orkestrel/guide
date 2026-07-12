// Standalone helpers — one plain `function` export and one `async function`
// export (both scan as ExportKind `function`), plus one `const` export.

export function createLabel(prefix: string): string {
	return `${prefix}-widget`
}

export async function loadWidget(id: string): Promise<string> {
	return id
}

export const DEFAULT_COUNT: number = 0
