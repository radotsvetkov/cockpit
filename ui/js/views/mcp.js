/**
 * mcp.js - Connectors tab (v5, UI-SPEC §9.3, §9.4, §9.7).
 *
 * Renders:
 *   1. Header + "?" help popover (FAQ copy from §9.6 "Why connectors?").
 *   2. Configured server cards - Tools / Import / Remove with cmdPreview.
 *   3. "Add a connector" section: catalog-grid cards + Custom card →
 *      form (name, command, args textarea, envNote) → live cmdPreview →
 *      somaRaw(buildAddArgs) → verbatim toast → refresh.
 *   4. Empty state: catalog IS the onboarding (§9.7).
 *
 * Iron rules:
 *   - All mutations via soma CLI through somaRaw; cmdPreview shown before run.
 *   - Never writes .soma/ from the UI.
 *   - Every add/remove/import is journaled by the runtime.
 *   - API keys never enter the UI.
 *   - CSP: no inline handlers; all events via addEventListener.
 *
 * @module views/mcp
 */

import { el, cmdPreview, helpButton } from '../render.js';
import { get } from '../state.js';
import { somaRaw } from '../soma.js';
import { showToast } from './toast.js';
import { isRunning, startRun } from './console.js';
import {
  CONNECTOR_CATALOG,
  buildAddArgs,
  consumePrefill,
} from './catalog.js';

// ── Module state ──────────────────────────────────────────────────

let _mounted = false;

/** @type {HTMLElement|null} */
let _container = null;

// ── Public API ────────────────────────────────────────────────────

/**
 * Mount the Connectors tab into a container element.
 *
 * @param {HTMLElement} [containerEl] - target element; defaults to #view-container
 */
export async function mountMcp(containerEl) {
  _mounted = true;
  _container = containerEl || document.getElementById('view-container');
  renderShell(_container);
  await loadMcp();

  // Honour any pending deep-link prefill (from ecosystem view etc.).
  // memora's command is a placeholder in the catalog - resolve the real
  // binary path the same way a catalog click does (probeMemora).
  const preId = consumePrefill();
  if (preId) {
    let resolvedCmd;
    if (preId === 'memora') {
      try {
        const tools = await window.__TAURI__.core.invoke('ecosystem_info');
        const m = Array.isArray(tools) && tools.find(t => t.name === 'memora-cli' && t.exists);
        if (m && m.path) resolvedCmd = m.path;
      } catch (_) {}
    }
    openCatalogForm(preId, resolvedCmd);
  }
}

/**
 * Unmount.
 */
export function unmountMcp() {
  _mounted = false;
  _container = null;
}

// ── Shell ─────────────────────────────────────────────────────────

/**
 * Render the static shell (header, journal note, slot elements).
 *
 * @param {HTMLElement} container
 */
function renderShell(container) {
  if (!container) return;
  container.innerHTML = '';

  // ── Header ────────────────────────────────────────────────────
  const header = el('div', { cls: 'section-header' });
  const titleRow = el('div', { cls: 'section-header-title-row', style: 'display:flex;align-items:center;gap:8px;' });
  titleRow.appendChild(el('h2', { cls: 'section-title', text: 'Connectors' }));
  titleRow.appendChild(helpButton('Connectors', [
    'They give skills tools - files, web, GitHub, memora. Servers run locally under your policy; importing a tool just creates a skill, and every call is policy-checked and journaled.',
  ]));
  header.appendChild(titleRow);

  const btns = el('div', { cls: 'view-toolbar', style: 'margin:0;gap:8px' });
  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => loadMcp());
  btns.appendChild(refreshBtn);
  header.appendChild(btns);
  container.appendChild(header);

  // Journal note (replaces old "edit mcp.json in your text editor" copy)
  const note = el('div', {
    cls: 'config-journal-note dim',
    text: 'Every add, remove, and import is journaled by the runtime. ' +
          'Env vars for servers go in the shell that launches the cockpit - keys never enter the UI.',
  });
  container.appendChild(note);

  // Slot: server list or empty-state (filled by renderServers)
  container.appendChild(el('div', { id: 'mcp-servers' }));
}

// ── Load ──────────────────────────────────────────────────────────

async function loadMcp() {
  const project = get('currentProject');
  if (!project) return;
  try {
    const invoke = window.__TAURI__.core.invoke;
    const raw = await invoke('read_mcp', { root: project });
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = {}; }
    if (_mounted) renderServers(parsed);
  } catch (e) {
    showToast(`read_mcp: ${e}`, 'error');
    if (_mounted) renderServers({});
  }
}

// ── Servers list ──────────────────────────────────────────────────

/**
 * Render the server list + catalog section.
 *
 * @param {object} mcpJson - parsed mcp.json
 */
function renderServers(mcpJson) {
  const slot = document.getElementById('mcp-servers');
  if (!slot) return;
  slot.innerHTML = '';

  // Support both {servers:{…}} and bare {name:{…}} shapes.
  const servers = (mcpJson && mcpJson.servers)
    ? mcpJson.servers
    : (mcpJson && typeof mcpJson === 'object') ? mcpJson : {};

  const names = Object.keys(servers || {});
  const hasServers = names.length > 0;

  // ── Existing server cards ──────────────────────────────────────
  if (hasServers) {
    const list = el('div', { cls: 'mcp-server-list' });
    for (const name of names) {
      list.appendChild(renderServerCard(name, servers[name] || {}));
    }
    slot.appendChild(list);
  }

  // ── "Add a connector" section ──────────────────────────────────
  const addSection = el('div', { cls: 'mcp-add-section', style: 'margin-top:24px;' });

  const addHeader = el('div', { cls: 'section-header', style: 'margin-bottom:8px;' });
  addHeader.appendChild(el('h3', { cls: 'section-subtitle', text: 'Add a connector' }));
  addSection.appendChild(addHeader);

  // Catalog header note (onboarding copy from §9.4)
  addSection.appendChild(el('div', {
    cls: 'dim',
    style: 'font-size:12px;margin-bottom:12px;',
    text: 'Templates, not endorsements - adding a connector grants it local code execution under this project\'s policy. The launcher must be on mcp_allow_commands (npx/uvx/… by default) or the add is refused and journaled - and the spawn is re-checked too. Every import is journaled.',
  }));

  addSection.appendChild(renderCatalogGrid());

  // Form slot (populated when a card is clicked)
  addSection.appendChild(el('div', { id: 'mcp-add-form' }));

  slot.appendChild(addSection);
}

// ── Catalog grid ──────────────────────────────────────────────────

/**
 * Build the .catalog-grid element with one card per visible catalog entry
 * plus a "Custom…" card.
 *
 * @returns {HTMLElement}
 */
function renderCatalogGrid() {
  const grid = el('div', { cls: 'catalog-grid', id: 'mcp-catalog-grid' });

  for (const entry of CONNECTOR_CATALOG) {
    // gate: 'memora' entries are added lazily after ecosystem probe
    if (entry.gate === 'memora') continue; // rendered separately after ecosystem check
    grid.appendChild(renderCatalogCard(entry));
  }

  // Custom card
  const customCard = el('div', { cls: 'catalog-card catalog-card-custom' });
  customCard.appendChild(el('div', { cls: 'catalog-card-name', text: 'Custom…' }));
  customCard.appendChild(el('div', { cls: 'catalog-card-why dim', text: 'Manually specify a command and arguments for any MCP server.' }));
  customCard.addEventListener('click', () => openCatalogForm(null));
  grid.appendChild(customCard);

  // Async: probe ecosystem for memora and insert card if present
  probeMemora(grid);

  return grid;
}

/**
 * Probe ecosystem_info for memora-cli; if present insert the memora card
 * and prefill its command with the reported path.
 *
 * @param {HTMLElement} grid
 */
async function probeMemora(grid) {
  try {
    const tools = await window.__TAURI__.core.invoke('ecosystem_info');
    const memoraCli = Array.isArray(tools) && tools.find(t => t.name === 'memora-cli' && t.exists);
    if (!memoraCli) return;

    // Build a customised entry with the actual binary path
    const baseEntry = CONNECTOR_CATALOG.find(e => e.id === 'memora');
    if (!baseEntry) return;
    const entry = Object.assign({}, baseEntry, { command: memoraCli.path || baseEntry.command });

    // Insert before the Custom card (last child)
    const customCard = grid.lastElementChild;
    const card = renderCatalogCard(entry);
    grid.insertBefore(card, customCard);

    // Store the resolved path so openCatalogForm can use it
    grid.dataset.memoraCliPath = memoraCli.path || '';
  } catch (_) {
    // ecosystem_info unavailable or memora absent - silent
  }
}

/**
 * Render a single catalog card.
 *
 * @param {import('./catalog.js').CatalogEntry} entry
 * @returns {HTMLElement}
 */
function renderCatalogCard(entry) {
  const card = el('div', { cls: 'catalog-card', 'data-id': entry.id });
  card.appendChild(el('div', { cls: 'catalog-card-name', text: entry.name }));
  card.appendChild(el('div', { cls: 'catalog-card-why dim', text: entry.why }));
  card.appendChild(el('span', { cls: 'catalog-req chip chip-mcp', text: `requires: ${entry.requires}` }));
  card.addEventListener('click', () => {
    // For memora, use the resolved path if available
    if (entry.gate === 'memora') {
      const grid = document.getElementById('mcp-catalog-grid');
      const path = grid && grid.dataset.memoraCliPath;
      if (path) {
        openCatalogForm('memora', path);
        return;
      }
    }
    openCatalogForm(entry.id);
  });
  return card;
}

// ── Add-connector form ────────────────────────────────────────────

/**
 * Open/prefill the add-connector form below the catalog grid.
 *
 * @param {string|null}  id            - Catalog entry id, or null for custom.
 * @param {string|null}  [resolvedCmd] - Override command (e.g. resolved memora-cli path).
 */
function openCatalogForm(id, resolvedCmd) {
  const formSlot = document.getElementById('mcp-add-form');
  if (!formSlot) return;
  formSlot.innerHTML = '';

  const entry = id ? CONNECTOR_CATALOG.find(e => e.id === id) : null;

  const initName    = entry ? entry.id : '';
  const initCmd     = resolvedCmd || (entry ? entry.command : '');
  const initArgs    = entry ? entry.args.join('\n') : '';
  const initEnvNote = entry ? (entry.envNote || '') : '';

  const form = el('div', { cls: 'mcp-add-form', style: 'margin-top:16px;' });

  form.appendChild(el('h4', { cls: 'mcp-form-title', text: entry ? `Add: ${entry.name}` : 'Add custom connector' }));

  // Name field
  const nameLabel = el('label', { cls: 'form-label', text: 'Name' });
  const nameInput = el('input', {
    cls: 'form-input',
    type: 'text',
    placeholder: 'server-name',
    value: initName,
  });
  form.appendChild(nameLabel);
  form.appendChild(nameInput);

  // Command field
  const cmdLabel = el('label', { cls: 'form-label', text: 'Command' });
  const cmdInput = el('input', {
    cls: 'form-input',
    type: 'text',
    placeholder: 'npx  /  uvx  /  /path/to/binary',
    value: initCmd,
  });
  form.appendChild(cmdLabel);
  form.appendChild(cmdInput);

  // Args textarea (one arg per line)
  const argsLabel = el('label', { cls: 'form-label', text: 'Arguments (one per line)' });
  const argsArea = el('textarea', {
    cls: 'form-textarea',
    placeholder: '-y\n@scope/mcp-server\n<path>',
    rows: '4',
  });
  argsArea.value = initArgs;
  form.appendChild(argsLabel);
  form.appendChild(argsArea);

  // envNote (dim warning)
  const envNoteEl = el('div', {
    cls: 'dim',
    style: 'font-size:11px;margin-top:4px;' + (initEnvNote ? '' : 'display:none;'),
    text: initEnvNote,
    id: 'mcp-form-envnote',
  });
  form.appendChild(envNoteEl);

  // Live cmdPreview block
  const previewWrap = el('div', { style: 'margin-top:12px;' });
  const previewEl = cmdPreview('');
  previewEl.id = 'mcp-form-preview';
  previewWrap.appendChild(previewEl);
  form.appendChild(previewWrap);

  // Add button
  const addBtn = el('button', { cls: 'btn btn-green', text: 'Add connector', style: 'margin-top:8px;' });
  addBtn.disabled = true;
  form.appendChild(addBtn);

  // Cancel button
  const cancelBtn = el('button', { cls: 'btn', text: 'Cancel', style: 'margin-top:8px;margin-left:8px;' });
  cancelBtn.addEventListener('click', () => { formSlot.innerHTML = ''; });
  form.appendChild(cancelBtn);

  // ── Hint slot (shown after successful add) ─────────────────────
  form.appendChild(el('div', { id: 'mcp-form-hint', style: 'margin-top:8px;' }));

  formSlot.appendChild(form);

  // ── Live preview + validation ──────────────────────────────────
  function refresh() {
    const name    = nameInput.value.trim();
    const cmd     = cmdInput.value.trim();
    const argsRaw = argsArea.value;
    const args    = argsRaw.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const hasPlaceholders = args.some(a => /^<.+>$/.test(a)) || /^<.+>$/.test(cmd);
    const valid = name.length > 0 && cmd.length > 0 && !hasPlaceholders;

    const argv = buildAddArgs(name, cmd, args);
    const preview = 'soma ' + argv.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ');
    const preEl = document.getElementById('mcp-form-preview');
    if (preEl) preEl.textContent = preview;

    addBtn.disabled = !valid;
    addBtn.title = hasPlaceholders ? 'Replace <placeholder> values before adding.' : '';
  }

  nameInput.addEventListener('input', refresh);
  cmdInput.addEventListener('input', refresh);
  argsArea.addEventListener('input', refresh);
  refresh();

  // ── Add button handler ─────────────────────────────────────────
  addBtn.addEventListener('click', async () => {
    const name    = nameInput.value.trim();
    const cmd     = cmdInput.value.trim();
    const argsRaw = argsArea.value;
    const args    = argsRaw.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (!name || !cmd) return;

    const project = get('currentProject');
    addBtn.disabled = true;
    addBtn.textContent = '…';

    const argv = buildAddArgs(name, cmd, args);
    try {
      const result = await somaRaw(argv, project);
      const output = (result.stdout || result.stderr || '').trim() || `exit ${result.code}`;
      showToast(output, result.code === 0 ? 'success' : 'error');

      if (result.code === 0) {
        // loadMcp re-renders the shell (the form goes away), so the
        // follow-up nudge must outlive it - use a toast.
        await loadMcp();
        showToast('Connector added - now import its tools as skills (⬇ on the server card)', 'info');
        triggerPollAndVerify();
      }
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = 'Add connector';
    }
  });

  // Scroll the form into view
  formSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Server card ───────────────────────────────────────────────────

/**
 * Render a configured server card with Tools / Import / Remove actions.
 *
 * @param {string} name
 * @param {{ command?:string, args?:string[] }} server
 * @returns {HTMLElement}
 */
function renderServerCard(name, server) {
  const card = el('div', { cls: 'mcp-card', id: `mcp-card-${cssId(name)}` });

  // Header row
  const hdr = el('div', { cls: 'mcp-card-header' });
  hdr.appendChild(el('span', { cls: 'mcp-server-name', text: name }));
  hdr.appendChild(el('span', { cls: 'chip chip-mcp', text: 'mcp' }));
  card.appendChild(hdr);

  // Command summary
  const cmdStr = buildCmdStr(server);
  if (cmdStr) {
    card.appendChild(el('div', { cls: 'mcp-server-cmd dim mono', text: cmdStr }));
  }

  // Command previews
  const toolsPreview  = `soma mcp tools ${name}`;
  const importPreview = `soma mcp import ${name}`;
  const removePreview = `soma mcp remove ${name}`;

  // Action buttons row
  const btnRow = el('div', { cls: 'mcp-card-actions' });

  const toolsBtn = el('button', { cls: 'btn btn-sm', text: 'Tools', title: toolsPreview });
  toolsBtn.addEventListener('click', () => handleMcpTools(name, card, toolsBtn));

  const importBtn = el('button', { cls: 'btn btn-sm btn-green', text: '⬇ Import as skills', title: importPreview });
  importBtn.addEventListener('click', () => handleMcpImport(name, importBtn));

  const removeBtn = el('button', { cls: 'btn btn-sm btn-red', text: 'Remove', title: removePreview });
  removeBtn.addEventListener('click', () => toggleRemoveConfirm(name, card, removeConfirmRow));

  btnRow.appendChild(toolsBtn);
  btnRow.appendChild(importBtn);
  btnRow.appendChild(removeBtn);
  card.appendChild(btnRow);

  // Inline command previews under buttons
  const previewEl = el('div', { cls: 'mcp-card-previews' });
  previewEl.appendChild(el('div', { cls: 'mcp-cmd-hint dim', text: toolsPreview }));
  previewEl.appendChild(el('div', { cls: 'mcp-cmd-hint dim', text: importPreview }));
  card.appendChild(previewEl);

  // Remove confirm row (hidden by default - inline confirm pattern)
  const removeConfirmRow = el('div', {
    cls: 'mcp-remove-confirm hidden',
    id: `mcp-remove-confirm-${cssId(name)}`,
  });
  removeConfirmRow.appendChild(cmdPreview(removePreview));
  const confirmMsg = el('div', {
    cls: 'dim',
    style: 'font-size:12px;margin:4px 0;',
    text: `Remove server "${name}"? This cannot be undone from the UI.`,
  });
  removeConfirmRow.appendChild(confirmMsg);

  const confirmBtnRow = el('div', { style: 'display:flex;gap:8px;margin-top:6px;' });
  const confirmYes = el('button', { cls: 'btn btn-sm btn-red', text: 'Confirm remove' });
  confirmYes.addEventListener('click', () => handleMcpRemove(name, confirmYes));
  const confirmNo = el('button', { cls: 'btn btn-sm', text: 'Cancel' });
  confirmNo.addEventListener('click', () => {
    removeConfirmRow.classList.add('hidden');
    removeBtn.disabled = false;
  });
  confirmBtnRow.appendChild(confirmYes);
  confirmBtnRow.appendChild(confirmNo);
  removeConfirmRow.appendChild(confirmBtnRow);

  card.appendChild(removeConfirmRow);

  // Tools output slot
  card.appendChild(el('div', { cls: 'mcp-tools-out', id: `mcp-tools-${cssId(name)}` }));

  return card;
}

// ── Action: toggle remove confirm ─────────────────────────────────

/**
 * Show / hide the inline remove confirm row for a server card.
 *
 * @param {string}      name
 * @param {HTMLElement} card
 * @param {HTMLElement} confirmRow
 */
function toggleRemoveConfirm(name, card, confirmRow) {
  const isHidden = confirmRow.classList.contains('hidden');
  // Hide any other open confirm rows first
  const allConfirm = document.querySelectorAll('.mcp-remove-confirm');
  for (const row of allConfirm) {
    if (row !== confirmRow) row.classList.add('hidden');
  }
  confirmRow.classList.toggle('hidden', !isHidden);
}

// ── Action: mcp tools ─────────────────────────────────────────────

/**
 * Run `soma mcp tools <name>` and display verbatim output on the card.
 *
 * @param {string}      name
 * @param {HTMLElement} card
 * @param {HTMLButtonElement} btn
 */
async function handleMcpTools(name, card, btn) {
  const project = get('currentProject');
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '…';

  const outEl = document.getElementById(`mcp-tools-${cssId(name)}`);
  if (outEl) outEl.innerHTML = '';

  try {
    const result = await somaRaw(['mcp', 'tools', name], project);
    const text = (result.stdout || result.stderr || '').trim() || `(exit ${result.code}, no output)`;
    if (outEl) {
      const pre = el('pre', { cls: 'mcp-tools-pre' });
      pre.textContent = text;
      outEl.appendChild(pre);
    }
    if (result.code !== 0) {
      showToast(`mcp tools ${name}: exit ${result.code}`, 'error');
    }
  } catch (e) {
    showToast(String(e), 'error');
    if (outEl) {
      outEl.appendChild(el('div', { cls: 'red', style: 'font-size:11px;margin-top:6px;', text: String(e) }));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ── Action: mcp import ────────────────────────────────────────────

/**
 * Stream `soma mcp import <name>` into the shared console.
 *
 * @param {string}            name
 * @param {HTMLButtonElement} btn
 */
async function handleMcpImport(name, btn) {
  if (isRunning()) {
    showToast('a run is already in progress', 'error');
    return;
  }
  const project = get('currentProject');
  btn.disabled = true;

  await startRun(`mcp import ${name}`, ['mcp', 'import', name], project, {
    onDone: (_code) => {
      btn.disabled = false;
      triggerPollAndVerify();
    },
  });
}

// ── Action: mcp remove ────────────────────────────────────────────

/**
 * Run `soma mcp remove <name>`, show verbatim toast, then refresh.
 *
 * @param {string}            name
 * @param {HTMLButtonElement} btn
 */
async function handleMcpRemove(name, btn) {
  const project = get('currentProject');
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '…';

  try {
    const result = await somaRaw(['mcp', 'remove', name], project);
    const output = (result.stdout || result.stderr || '').trim() || `exit ${result.code}`;
    showToast(output, result.code === 0 ? 'success' : 'error');
    if (result.code === 0) {
      triggerPollAndVerify();
      await loadMcp();
    }
  } catch (e) {
    showToast(String(e), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Build a human-readable command string from a server definition.
 *
 * @param {{ command?:string, args?:string[] }} server
 * @returns {string}
 */
function buildCmdStr(server) {
  if (!server || !server.command) return '';
  const args = (server.args || []).join(' ');
  return args ? `${server.command} ${args}` : server.command;
}

/**
 * Sanitize a server name to a valid CSS id fragment.
 *
 * @param {string} name
 * @returns {string}
 */
function cssId(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function triggerPollAndVerify() {
  import('../app.js').then(({ triggerPollAndVerify: tpv }) => {
    if (typeof tpv === 'function') tpv();
  }).catch(() => {});
}
