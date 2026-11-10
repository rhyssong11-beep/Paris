/** Finds a landmark's Gaussian-splat capture file, if one has been added under public/models/. */
const EXTENSIONS = ['spz', 'sog', 'ksplat', 'splat', 'ply'];
/** First existing splat file for `basePath` (path without extension), or null. */
export async function findSplat(basePath: string): Promise<string | null> {
  for (const ext of EXTENSIONS) {
    const url = `${basePath}.${ext}`;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      // Dev servers answer unknown paths with index.html, so check the type as well as the status.
      if (head.ok && !(head.headers.get('content-type') ?? '').includes('text/html')) return url;
    } catch {
      // try the next extension
    }
  }
  return null;
}

