// Copy of good/module/helpers.ts — unmodified; present so this fixture's
// module scope mirrors the good module's full export set.

export function createLabel(prefix: string): string {
	return `${prefix}-widget`
}

export async function loadWidget(id: string): Promise<string> {
	return id
}

export const DEFAULT_COUNT: number = 0
