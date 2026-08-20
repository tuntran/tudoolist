/**
 * Logging helpers.
 *
 * Claude Desktop cannot send an Authorization header, so it authenticates by
 * putting the shared secret in the URL path (/mcp/<secret>). TLS hides that in
 * transit, which leaves logs as the real exposure — so no code path may ever
 * log a raw pathname. Route every pathname through `safePath` first.
 */

/** Strip the shared secret out of an /mcp/<secret> pathname. */
export function safePath(pathname: string): string {
  return pathname.startsWith('/mcp/') ? '/mcp/<redacted>' : pathname;
}

/** Log one request outcome with the secret stripped. */
export function logRequest(method: string, pathname: string, status: number): void {
  console.log(`${method} ${safePath(pathname)} -> ${status}`);
}
