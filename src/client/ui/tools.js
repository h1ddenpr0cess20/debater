/**
 * The panel behind the `tools` button: what either debater may reach for, with
 * a switch each.
 *
 * The list comes from the server, and today it is empty — they argue from what
 * they know and nothing else. The panel is here ahead of the tools: when a
 * connector declares one, `/api/models` names it and the switches appear
 * without this file changing.
 *
 * Nothing here can add a tool. A switch only ever takes one out of the debate.
 */
export function createToolsPanel({ root = document, switches, onChange } = {}) {
  const panelEl = root.querySelector('#toolbox');
  const listEl = root.querySelector('#toolbox-list');
  const toggleEl = root.querySelector('#toolbox-toggle');
  const closeEl = root.querySelector('#toolbox-close');
  const doc = panelEl.ownerDocument;

  function itemEl(tool) {
    const row = doc.createElement('li');
    row.className = 'tool-item';
    row.dataset.on = String(tool.enabled);

    const name = doc.createElement('span');
    name.className = 'tool-name';
    name.append(tool.label);

    const el = doc.createElement('button');
    el.className = 'chip switch';
    el.type = 'button';
    el.setAttribute('aria-pressed', String(tool.enabled));
    el.setAttribute('aria-label', `Switch ${tool.label} ${tool.enabled ? 'off' : 'on'}`);
    el.append(tool.enabled ? 'on' : 'off');
    el.addEventListener('click', () => {
      switches.toggle(tool.name);
      render();
      onChange?.();
    });

    row.append(name, el);
    return row;
  }

  function render() {
    const items = switches.items;
    listEl.replaceChildren();

    if (!items.length) {
      const empty = doc.createElement('p');
      empty.className = 'empty';
      empty.append('Nothing to switch yet. Tools land here as the connectors'
        + ' declare them, and both lecterns get the same ones.');
      listEl.append(empty);
      return;
    }

    listEl.append(...items.map(itemEl));
  }

  function open() {
    render();
    panelEl.hidden = false;
    toggleEl.setAttribute('aria-expanded', 'true');
    closeEl.focus();
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
    get isOpen() {
      return !panelEl.hidden;
    },
  };
}
