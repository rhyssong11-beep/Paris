// Tiny HTTP GET helper. curl is used (not fetch) so proxy settings are honoured;
// the open-data portals drop a lot of connections, hence the generous retries.
import { execFileSync } from 'node:child_process';

export function get(url, { tries = 60, timeout = 300 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return execFileSync('curl', ['-sS', '--fail', '--compressed', '--connect-timeout', '10', '-m', String(timeout), url], {
        maxBuffer: 1 << 30,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (e) {
      if (i >= tries) throw new Error(`GET failed after ${tries} tries: ${url}`);
    }
  }
}
export const getJson = (url, opts) => JSON.parse(get(url, opts));
