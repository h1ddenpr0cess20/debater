/**
 * Which of the xAI engine's tools a page is allowed to switch, and what happens
 * when it does.
 *
 * The environment decides what exists. This decides which of those the two
 * models are offered on one debate, from one browser, and it can only ever take
 * away: a tool the config never enabled has no switch, and nothing the page
 * sends can put it back. That is the whole of the contract — the page subtracts,
 * the server cannot be added to from outside.
 *
 * A switch applies to the debate rather than to one lectern. Neither side gets a
 * tool the other does not; a debate where one of them can look things up and the
 * other cannot is not a debate.
 */

/** The switchable tools, in the order the panel lists them. */
export function toolCatalog(tools = {}) {
  const catalog = [];
  if (tools.webSearch) catalog.push({ name: 'web_search', label: 'web search' });
  if (tools.xSearch) catalog.push({ name: 'x_search', label: 'X search' });
  for (const server of tools.mcpServers ?? []) {
    catalog.push({ name: `mcp:${server.server_label}`, label: server.server_label });
  }
  return catalog;
}

/**
 * The names in `off` this server actually has a switch for, deduplicated. A
 * page can hold a switch for a tool this server does not offer — an MCP server
 * that has since been taken out of the config, or a switch left over from the
 * other engine — and saying so is not an error, it just has nothing to turn off
 * here.
 */
export function switchedOff(tools, off) {
  const known = new Set(toolCatalog(tools).map((tool) => tool.name));
  return [...new Set((Array.isArray(off) ? off : []).filter((name) => known.has(name)))];
}

/** The config's tools, minus the ones this page has switched off. */
export function pickTools(tools, off = []) {
  const dropped = new Set(switchedOff(tools, off));
  const on = (name) => !dropped.has(name);

  return {
    ...tools,
    webSearch: Boolean(tools.webSearch) && on('web_search'),
    xSearch: Boolean(tools.xSearch) && on('x_search'),
    mcpServers: (tools.mcpServers ?? []).filter((server) => on(`mcp:${server.server_label}`)),
  };
}
