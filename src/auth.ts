/**
 * Shared-secret auth for the MCP endpoint.
 *
 * Two ways in, and deliberately two different secrets:
 *   - `Authorization: Bearer <secret>`  — goclaw and Claude Code
 *   - `/mcp/<secret>` in the URL path   — Claude Desktop, whose custom-connector
 *                                         dialog offers no header field at all
 *
 * The path secret gets its own value because a URL path lands in logs this code
 * cannot reach: wrangler prints it locally, and Workers request logs capture it
 * in production. Redacting our own log lines does not change that. Keeping the
 * two apart means the exposed one can be rotated by re-adding a single Desktop
 * connector, without touching goclaw or Claude Code.
 *
 * Leaving PATH_SECRET unset disables path auth entirely, which is the right
 * default for anyone not using Claude Desktop.
 *
 * Everything auth-related lives in this file so that swapping shared secrets
 * for JWT validation against an identity provider stays a one-file change.
 */

/** Compare two secrets without leaking length or content through timing. */
async function secretsMatch(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  // Hashing first makes the comparison fixed-width, so unequal lengths do not
  // short-circuit the loop below.
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);

  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** Pull the token out of an `Authorization: Bearer <token>` header. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

export interface Secrets {
  /** Expected `Authorization: Bearer` value. Required. */
  bearer: string;
  /** Expected `/mcp/<secret>` value. Null disables path auth. */
  path: string | null;
}

/**
 * Authorize one request.
 *
 * `pathSecret` is whatever followed `/mcp/` in the URL, or null when the client
 * called bare `/mcp` and is expected to present a header instead. Each route
 * checks only its own secret — a path credential never satisfies the header
 * check, or the reverse.
 */
export async function authenticate(
  request: Request,
  pathSecret: string | null,
  secrets: Secrets,
): Promise<boolean> {
  if (pathSecret !== null) {
    if (!secrets.path) return false;
    return secretsMatch(pathSecret, secrets.path);
  }

  const token = bearerToken(request);
  if (!token) return false;
  return secretsMatch(token, secrets.bearer);
}
