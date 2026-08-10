async function json(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `${url} returned ${res.status}`);
  }
  return body;
}

/** The models, the voices, who is at each lectern, and the caps to open on. */
export function fetchCatalog() {
  return json('/api/models');
}

/** One lectern's ten-minute secret. Two of these open a debate. */
export function fetchClientSecret({ model, voice, debater, topic, resumed }) {
  return json('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, voice, debater, topic, resumed }),
  });
}

/** The connector setup: what is registered, what is on, and how each is set. */
export function fetchConnectors() {
  return json('/api/connectors');
}

export function saveConnectors(patch) {
  return json('/api/connectors', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/**
 * A connector tool call, run on the server.
 *
 * The calls themselves run in this browser, so a debater's tool call arrives
 * here and the page is the only thing that can answer it — but the work is the
 * server's to do, since it is the server's machine.
 */
export function runConnectorTool(name, args) {
  return json('/api/connectors/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, args }),
  });
}
