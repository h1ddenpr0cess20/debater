/**
 * Assembles the shader files in `glsl/` and `wgsl/`.
 *
 * `#include <name>` pastes in the chunk of that name, in either language.
 * GLSL keeps its own `#if`s for its own compiler, but WGSL has no
 * preprocessor, so for it `preprocess` also resolves `#if` / `#ifdef` /
 * `#ifndef` / `#elif` / `#else` / `#endif` against the defines a program is
 * built with, and writes each valued define in wherever its name appears —
 * what GLSL's preprocessor does with the `#define`s glsl.js puts in front.
 *
 * A define that is `true` is defined, one that is `false` or missing is not,
 * and a number or string is defined with that value.
 */

export function include(source, chunks) {
  return source.replace(/#include <(\w+)>/g, (_, name) => {
    if (!(name in chunks)) throw new Error(`gfx: no shader chunk <${name}>`);
    return include(chunks[name], chunks);
  });
}

export function preprocess(source, defines, chunks = {}) {
  const out = [];
  const stack = [];
  let active = true;
  for (const line of include(source, chunks).split('\n')) {
    const directive = /^\s*#(ifdef|ifndef|if|elif|else|endif)\b(.*)$/.exec(line);
    if (!directive) {
      if (active) out.push(line);
      continue;
    }
    const [, name, rest] = directive;
    const top = stack[stack.length - 1];
    if (name !== 'if' && name !== 'ifdef' && name !== 'ifndef' && !top) throw new Error(`gfx: #${name} without #if`);
    switch (name) {
      case 'if':
      case 'ifdef':
      case 'ifndef': {
        const test = name === 'if' ? evaluate(rest, defines)
          : isDefined(defines, rest.trim()) === (name === 'ifdef');
        stack.push({ parent: active, taken: active && test });
        active = active && test;
        break;
      }
      case 'elif':
        active = top.parent && !top.taken && evaluate(rest, defines);
        top.taken ||= active;
        break;
      case 'else':
        active = top.parent && !top.taken;
        top.taken = true;
        break;
      case 'endif':
        active = stack.pop().parent;
        break;
    }
  }
  if (stack.length) throw new Error('gfx: #if without #endif');

  const valued = Object.keys(defines).filter((name) => typeof defines[name] !== 'boolean' && defines[name] != null);
  if (!valued.length) return out.join('\n');
  const names = new RegExp(`\\b(${valued.join('|')})\\b`, 'g');
  // Comments are left as written.
  return out.map((line) => {
    const comment = line.indexOf('//');
    const code = comment < 0 ? line : line.slice(0, comment);
    return code.replace(names, (name) => String(defines[name])) + line.slice(code.length);
  }).join('\n');
}

const isDefined = (defines, name) => defines[name] !== undefined && defines[name] !== null && defines[name] !== false;

const valueOf = (defines, name) => {
  const value = defines[name];
  if (value === true) return 1;
  return typeof value === 'number' ? value : 0;
};

/** `#if` expressions: names, numbers, `defined()`, `!`, comparisons, `&&`, `||` and brackets. */
function evaluate(expression, defines) {
  const tokens = expression.match(/\|\||&&|[<>=!]=|[()<>!]|\w+(?:\.\d+)?/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];

  const or = () => {
    let value = and();
    while (peek() === '||') { next(); value = and() || value; }
    return value;
  };
  const and = () => {
    let value = compare();
    while (peek() === '&&') { next(); value = compare() && value; }
    return value;
  };
  const compare = () => {
    const left = unary();
    const op = peek();
    if (!['<', '>', '<=', '>=', '==', '!='].includes(op)) return left;
    next();
    const right = unary();
    switch (op) {
      case '<': return +(left < right);
      case '>': return +(left > right);
      case '<=': return +(left <= right);
      case '>=': return +(left >= right);
      case '==': return +(left === right);
      default: return +(left !== right);
    }
  };
  const unary = () => {
    if (peek() === '!') { next(); return +!unary(); }
    return primary();
  };
  const primary = () => {
    const token = next();
    if (token === '(') {
      const value = or();
      if (next() !== ')') throw new Error(`gfx: unbalanced #if ${expression.trim()}`);
      return value;
    }
    if (token === 'defined') {
      const bracketed = peek() === '(';
      if (bracketed) next();
      const value = +isDefined(defines, next());
      if (bracketed && next() !== ')') throw new Error(`gfx: unbalanced #if ${expression.trim()}`);
      return value;
    }
    if (/^\d/.test(token ?? '')) return Number(token);
    if (/^\w+$/.test(token ?? '')) return valueOf(defines, token);
    throw new Error(`gfx: cannot read #if ${expression.trim()}`);
  };

  const value = or();
  if (at !== tokens.length) throw new Error(`gfx: cannot read #if ${expression.trim()}`);
  return value !== 0;
}
