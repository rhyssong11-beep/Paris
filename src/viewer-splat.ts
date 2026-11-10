/** Finds a landmark's Gaussian-splat capture file, if one has been added under public/models/. */
const EXTENSIONS = ['spz', 'sog', 'ksplat', 'splat', 'ply'];
/** First existing splat file for `basePath` (path without extension), or null. */
export async function findSplat(basePath: string, signal?: AbortSignal): Promise<string | null> {
  for (const ext of EXTENSIONS) {
    signal?.throwIfAborted();
    const url = `${basePath}.${ext}`;
    try {
      const timeout = AbortSignal.timeout(1500);
      const head = await fetch(url, { method: 'HEAD', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      // Dev servers answer unknown paths with index.html, so check the type as well as the status.
      if (head.ok && !(head.headers.get('content-type') ?? '').includes('text/html')) return url;
    } catch {
      signal?.throwIfAborted();
      // try the next extension
    }
  }
  return null;
}

