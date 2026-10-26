/**
 * Browser shim for `readable-stream`.
 *
 * JSZip's Node entry point imports `readable-stream`, which drags in Node's
 * `util`/`assert` polyfills. Next's `util` polyfill feature-detects generators
 * with `Function(...)` at module load, which a nonce-only CSP blocks. JSZip only
 * needs a stream implementation for Node's `generateNodeStream`; the CV viewer
 * never calls it, so an unavailable `Readable` is sufficient and keeps the
 * bundle free of the polyfills.
 *
 * @see ../next.config.ts (turbopack.resolveAlias)
 */
export const Readable = undefined
