/**
 * Who is allowed to ask.
 *
 * Tater has no accounts and no auth, which is defensible for something you run
 * on your own machine — right up until a page you happen to have open in
 * another tab asks on your behalf. A browser attaches `Origin` to exactly the
 * requests that carry that risk: cross-site form posts, and `fetch` with a
 * content type simple enough to skip the preflight.
 *
 * So: a request that names an origin has to name ours. A request with no
 * origin is not a browser — curl, a test, a native client — and is left alone,
 * because an attacker who can already set arbitrary headers on this machine
 * has no need of the browser in the first place.
 */
export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;

  /**
   * HTTP/2 has no `Host` header — the authority is a pseudo-header, and Node's
   * compatibility layer does not synthesise one. Vite serves TLS over HTTP/2,
   * which is what `npm run dev:lan` does, so without this every state-changing
   * request over HTTPS is refused as though it came from somewhere else.
   */
  const host = req.headers.host ?? req.headers[':authority'] ?? req.authority;
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    /** `null`, and anything else that isn't a URL, is not this one. */
    return false;
  }
}
