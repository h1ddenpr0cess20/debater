import { fetchConnectors, saveConnectors } from '../api.js';

/**
 * The panel behind the `connectors` button: what this server can hand the
 * debaters beyond their own opinions, with a switch and whatever settings each
 * one needs.
 *
 * Nothing is registered yet, so what it shows is an honest empty state. The
 * panel is built against the server's own description of its catalog — name,
 * summary, fields — so a connector added on the server appears here with its
 * settings, and this file does not change.
 */
export function createConnectorsPanel({ root = document, onChange } = {}) {
  const panelEl = root.querySelector('#connectors');
  const bodyEl = root.querySelector('#connectors-list');
  const toggleEl = root.querySelector('#connectors-toggle');
  const saveEl = root.querySelector('#connectors-save');
  const closeEl = root.querySelector('#connectors-close');
  const noteEl = root.querySelector('#connectors-note');
  const doc = panelEl.ownerDocument;

  /** What the server last said, and what has been changed since. */
  let known = null;
  let patch = { enabled: {}, options: {} };

  function dirty() {
    return Object.keys(patch.enabled).length > 0 || Object.keys(patch.options).length > 0;
  }

  function say(text, { error = false } = {}) {
    noteEl.textContent = text ?? '';
    noteEl.classList.toggle('visible', Boolean(text));
    noteEl.classList.toggle('error', error);
  }

  function fieldEl(one, field) {
    const wrap = doc.createElement('label');
    wrap.className = 'field';
    wrap.append(field.label ?? field.key);

    const input = doc.createElement('input');
    input.type = 'text';
    input.value = patch.options[one.name]?.[field.key] ?? one.options[field.key] ?? '';
    input.placeholder = field.placeholder ?? '';
    input.addEventListener('input', () => {
      patch.options[one.name] = { ...patch.options[one.name], [field.key]: input.value };
      saveEl.disabled = !dirty();
    });

    wrap.append(input);
    return wrap;
  }

  function connectorEl(one) {
    const on = patch.enabled[one.name] ?? one.enabled;

    const section = doc.createElement('section');
    section.className = 'agent';
    section.dataset.on = String(on);

    const head = doc.createElement('header');
    const name = doc.createElement('span');
    name.className = 'agent-name chip';
    name.append(one.label);

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'chip switch';
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', `Switch ${one.label} ${on ? 'off' : 'on'}`);
    button.append(on ? 'on' : 'off');
    button.addEventListener('click', () => {
      patch.enabled[one.name] = !on;
      saveEl.disabled = !dirty();
      render();
    });

    const tools = doc.createElement('span');
    tools.className = 'meta chip';
    tools.append(one.tools.join(', '));

    head.append(name, button, tools);
    section.append(head);

    if (one.summary) {
      const summary = doc.createElement('p');
      summary.className = 'agent-summary';
      summary.append(one.summary);
      section.append(summary);
    }

    if (one.fields?.length) {
      const fields = doc.createElement('div');
      fields.className = 'agent-fields';
      fields.append(...one.fields.map((field) => fieldEl(one, field)));
      section.append(fields);
    }

    return section;
  }

  function render() {
    bodyEl.replaceChildren();
    saveEl.disabled = !dirty();

    if (!known) {
      const loading = doc.createElement('p');
      loading.className = 'empty';
      loading.append('Asking the server…');
      bodyEl.append(loading);
      return;
    }

    if (!known.connectors.length) {
      const empty = doc.createElement('p');
      empty.className = 'empty';
      empty.append('No connectors registered. The wiring is here — the route, the'
        + ' settings file and the tool declaration — and a debate does not obviously'
        + ' need one yet. Hosted web search is the one worth waiting for.');
      bodyEl.append(empty);
      return;
    }

    bodyEl.append(...known.connectors.map(connectorEl));
  }

  async function refresh() {
    try {
      known = await fetchConnectors();
      patch = { enabled: {}, options: {} };
      say('');
    } catch (err) {
      known = { connectors: [] };
      say(err?.message ?? String(err), { error: true });
    }
    render();
    toggleEl.classList.toggle('live', Boolean(known.connectors?.some((c) => c.enabled)));
  }

  saveEl.addEventListener('click', async () => {
    saveEl.disabled = true;
    try {
      known = await saveConnectors(patch);
      patch = { enabled: {}, options: {} };
      say('saved');
      onChange?.();
    } catch (err) {
      say(err?.message ?? String(err), { error: true });
    }
    render();
  });

  function open() {
    panelEl.hidden = false;
    toggleEl.setAttribute('aria-expanded', 'true');
    closeEl.focus();
    refresh();
  }

  function close() {
    panelEl.hidden = true;
    toggleEl.setAttribute('aria-expanded', 'false');
  }

  toggleEl.addEventListener('click', () => (panelEl.hidden ? open() : close()));
  closeEl.addEventListener('click', close);

  return {
    open,
    close,
    render,
    refresh,
    get isOpen() {
      return !panelEl.hidden;
    },
  };
}
