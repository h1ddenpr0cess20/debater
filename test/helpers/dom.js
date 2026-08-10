import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const INDEX = fileURLToPath(new URL('../../index.html', import.meta.url));

let markup;

export async function loadPage() {
  markup ??= await readFile(INDEX, 'utf8');

  const dom = new JSDOM(markup, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  return {
    dom,
    document: dom.window.document,
    window: dom.window,
    $: (sel) => dom.window.document.querySelector(sel),
    $$: (sel) => [...dom.window.document.querySelectorAll(sel)],
    close: () => dom.window.close(),
  };
}

export function withGlobals(values) {
  const saved = new Map();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, key in globalThis ? globalThis[key] : undefined);
    globalThis[key] = value;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
}
