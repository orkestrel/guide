import type { GuideModule } from '../core/index.js'

/**
 * The construction input for a disk-backed {@link SourceInterface} implementation.
 */
export interface SourceOptions {
	/** The absolute workspace root every relative path is resolved against. */
	readonly root: string
	/** The source directory (or directories) this guide documents, root-relative. */
	readonly module: GuideModule
}
