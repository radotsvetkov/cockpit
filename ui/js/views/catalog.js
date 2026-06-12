/**
 * catalog.js - MCP connector catalog for the soma cockpit (v5).
 *
 * Exports:
 *   CONNECTOR_CATALOG  - 8 catalog entries (id, name, desc, why, command, args,
 *                        requires, optional envNote, optional gate).
 *   buildAddArgs(name, command, args) → argv array for `soma mcp add`.
 *   prefillConnector(id) - deep-link target; consumed by mcp.js on mount.
 *
 * Iron rules:
 *   - Zero dependencies; plain ES module.
 *   - No network, no keys.
 *   - <path> placeholders MUST be present in args arrays that need user input;
 *     mcp.js keeps the Add button disabled until every <…> is replaced.
 *
 * @module views/catalog
 */

// ── Catalog entries ───────────────────────────────────────────────

/**
 * @typedef {Object} CatalogEntry
 * @property {string}   id       - Stable machine identifier.
 * @property {string}   name     - Display name.
 * @property {string}   desc     - Short one-line description.
 * @property {string}   why      - Reason to connect (body copy).
 * @property {string}   command  - Executable (npx / uvx / binary path).
 * @property {string[]} args     - Arguments array. <…> tokens are placeholders.
 * @property {string}   requires - "requires" chip text (e.g. "npx", "uvx").
 * @property {string}   [envNote]  - Dim warning about env variables, if any.
 * @property {string}   [gate]     - If 'memora', entry shown only when memora-cli exists.
 */

/** @type {CatalogEntry[]} */
export const CONNECTOR_CATALOG = [
  {
    id: 'memora',
    name: 'memora',
    desc: 'Verified memory with citation integrity.',
    why: 'Verified memory with citation integrity - give skills a store they can cite.',
    command: '<memora-cli path>',
    args: ['mcp'],
    requires: 'memora-cli',
    envNote: 'Check `memora-cli mcp --help` if the serve flag differs.',
    gate: 'memora',
  },
  {
    id: 'filesystem',
    name: 'filesystem',
    desc: 'Read/write a chosen directory.',
    why: 'Read/write a chosen directory - the bread-and-butter connector.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '<path>'],
    requires: 'npx',
  },
  {
    id: 'fetch',
    name: 'fetch',
    desc: 'Fetch web pages as markdown.',
    why: 'Fetch web pages as markdown for skills that need to read the web.',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    requires: 'uvx',
  },
  {
    id: 'github',
    name: 'github',
    desc: 'Issues, PRs, repos.',
    why: 'Issues, PRs, repos. Requires GITHUB_TOKEN exported in the shell that launches the cockpit - keys never enter the UI.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requires: 'npx',
    envNote: 'Requires GITHUB_TOKEN exported in the shell that launches the cockpit - keys never enter the UI.',
  },
  {
    id: 'memory',
    name: 'memory',
    desc: 'Scratch knowledge-graph memory.',
    why: 'Scratch knowledge-graph memory, useful for long-running goals.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    requires: 'npx',
  },
  {
    id: 'sqlite',
    name: 'sqlite',
    desc: 'Query a local SQLite database.',
    why: 'Query a local SQLite database.',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', '<path>'],
    requires: 'uvx',
  },
  {
    id: 'time',
    name: 'time',
    desc: 'Timezone-correct current time.',
    why: 'Timezone-correct current time.',
    command: 'uvx',
    args: ['mcp-server-time'],
    requires: 'uvx',
  },
  {
    id: 'puppeteer',
    name: 'puppeteer',
    desc: 'Drive a real browser.',
    why: 'Drive a real browser (capability ladder rung 2).',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    requires: 'npx',
  },
];

// ── buildAddArgs ──────────────────────────────────────────────────

/**
 * Build the argv array for `soma mcp add <name> --cmd <command> [--arg <v>]…`.
 *
 * @param {string}   name    - Server name.
 * @param {string}   command - Executable path/name.
 * @param {string[]} args    - Argument values.
 * @returns {string[]} Full argv array starting with 'mcp'.
 */
export function buildAddArgs(name, command, args) {
  const argv = ['mcp', 'add', name, '--cmd', command];
  for (const a of args) {
    argv.push('--arg', a);
  }
  return argv;
}

// ── prefillConnector deep-link target ─────────────────────────────

/** @type {string|null} */
let _pendingPrefill = null;

/**
 * Request that mcp.js open and prefill the form for a given catalog id
 * the next time mountMcp() is called (or immediately if already mounted).
 *
 * @param {string} id - CatalogEntry.id
 */
export function prefillConnector(id) {
  _pendingPrefill = id;
}

/**
 * Consume and clear the pending prefill id.
 * Called by mcp.js on mount.
 *
 * @returns {string|null}
 */
export function consumePrefill() {
  const id = _pendingPrefill;
  _pendingPrefill = null;
  return id;
}
