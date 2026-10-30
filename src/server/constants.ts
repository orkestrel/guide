/** Names the workspace-relative guide concept index. */
export const GUIDE_INDEX = 'guides/README.md'

/** Names the package manifest read for native pitch selection. */
export const GUIDE_MANIFEST = 'package.json'

/** Names the package README paired with its indexed guide pitch. */
export const GUIDE_README = 'README.md'

/** Holds the native command usage text written for unsupported arguments. */
export const GUIDE_USAGE = 'usage: npm run test:guides [-- --to guide|--to source]'

/** Names the host temporary directory prefix of a declaration emit's scratch output. */
export const GUIDE_SCRATCH_PREFIX = 'orkestrel-guide-'

/** Holds the removal retries a declaration emit's scratch output takes on a busy host. */
export const GUIDE_SCRATCH_RETRIES = 3

/** Holds the default milliseconds one compiler run may take before it is stopped. */
export const GUIDE_COMPILER_TIMEOUT = 300_000

/**
 * Holds the default bytes of output one compiler run may write to each stream, room for the
 * diagnostics of a large failing project.
 */
export const GUIDE_COMPILER_LIMIT = 64 * 1024 * 1024
