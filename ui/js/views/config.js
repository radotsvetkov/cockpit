/**
 * config.js - Config editor (v4).
 *
 * Loads `config get --json` and renders editable rows for routing tiers,
 * ollama_url, max_tokens, and cache knobs.
 *
 * Iron rule: every Set is a `soma config set <path> <value>` invocation.
 * The exact command is shown in a live mono preview before running.
 *
 * @module views/config
 */

import { el, rawJsonDetails, helpButton, cmdPreview } from '../render.js';
import { get } from '../state.js';
import { somaJson, somaRaw } from '../soma.js';
import { showToast } from './toast.js';

let _mounted = false;
/** @type {object|null} */
let _config = null;

/**
 * Mount the Config editor.
 * @param {HTMLElement} [container] - target element; defaults to #view-container
 */
export async function mountConfig(container) {
  _mounted = true;
  renderShell(container);
  await loadConfig();
}

/** Unmount. */
export function unmountConfig() {
  _mounted = false;
}

// ── Load ────────────────────────────────────────────────────────────

async function loadConfig() {
  const project = get('currentProject');
  if (!project) return;
  try {
    _config = await somaJson(['config', 'get', '--json'], project);
    if (_mounted) renderRows();
  } catch (e) {
    showToast(`config get: ${e}`, 'error');
    if (_mounted) renderRows();
  }
}

// ── Shell ────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} [containerEl]
 */
function renderShell(containerEl) {
  const container = containerEl || document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const header = el('div', { cls: 'section-header' });
  header.appendChild(el('h2', { cls: 'section-title', text: 'Models' }));
  header.appendChild(helpButton('Config / Models', [
    'Config controls the three routing tiers: simple (high-volume mechanical work - keep it local/cheap), moderate (drafting and routine judgment), complex (architecture and repair - the expensive one). Every routed call writes a model.route event with the factors.',
    'Set a tier to a local Ollama model to keep that class of work fully private; set it to anthropic for frontier capability. The footer shows your current network mode (local-only vs hybrid) live.',
    'Clear model cache removes all cached model responses - useful after changing routing or when you want fresh results. The exact soma command is shown before anything runs.',
  ]));

  const btns = el('div', { cls: 'view-toolbar', style: 'margin:0;gap:8px' });
  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => loadConfig());
  btns.appendChild(refreshBtn);

  const clearCacheBtn = el('button', { cls: 'btn', text: 'Clear model cache' });
  clearCacheBtn.addEventListener('click', () => handleClearCache(clearCacheBtn));
  btns.appendChild(clearCacheBtn);

  header.appendChild(btns);
  container.appendChild(header);

  // Journal note
  const note = el('div', { cls: 'config-journal-note dim', text: 'Every change is journaled as config.change {path, old, new}. Identity fields are refused by the runtime.' });
  container.appendChild(note);

  container.appendChild(el('div', { id: 'config-rows' }));
  container.appendChild(el('div', { id: 'config-raw' }));
}

// ── Rows ─────────────────────────────────────────────────────────────

/** @typedef {{ path: string, label: string, kind: 'text'|'number'|'select', options?: string[] }} KnobDef */

/** @type {KnobDef[]} */
const KNOBS = [
  { path: 'model.routing.simple.provider',   label: 'Simple routing - provider',   kind: 'select', options: ['echo','ollama','anthropic'] },
  { path: 'model.routing.simple.model',      label: 'Simple routing - model',      kind: 'text' },
  { path: 'model.routing.moderate.provider', label: 'Moderate routing - provider', kind: 'select', options: ['echo','ollama','anthropic'] },
  { path: 'model.routing.moderate.model',    label: 'Moderate routing - model',    kind: 'text' },
  { path: 'model.routing.complex.provider',  label: 'Complex routing - provider',  kind: 'select', options: ['echo','ollama','anthropic'] },
  { path: 'model.routing.complex.model',     label: 'Complex routing - model',     kind: 'text' },
  { path: 'model.ollama_url',                label: 'Ollama URL',                  kind: 'text' },
  { path: 'model.max_tokens',               label: 'Max tokens',                  kind: 'number' },
  { path: 'cache.enabled',                  label: 'Cache enabled',               kind: 'select', options: ['true','false'] },
  { path: 'cache.max_bytes',               label: 'Cache max bytes',             kind: 'number' },
];

/**
 * Drill into a nested object by dotted path.
 * Returns undefined when the path does not exist.
 * @param {object} obj
 * @param {string} path
 * @returns {any}
 */
function getPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function renderRows() {
  const rowsEl = document.getElementById('config-rows');
  const rawEl  = document.getElementById('config-raw');
  if (!rowsEl) return;
  rowsEl.innerHTML = '';
  if (rawEl) rawEl.innerHTML = '';

  if (!_config) {
    rowsEl.appendChild(el('div', { cls: 'empty-state', text: 'Could not load config (config get --json not supported or no project selected).' }));
    return;
  }

  const table = el('div', { cls: 'config-table' });

  for (const knob of KNOBS) {
    const current = getPath(_config, knob.path);
    const currentStr = current !== undefined && current !== null ? String(current) : '';
    table.appendChild(renderKnobRow(knob, currentStr));
  }

  rowsEl.appendChild(table);

  // Raw config details
  if (rawEl) {
    rawEl.appendChild(rawJsonDetails(_config, 'Full config JSON'));
  }
}

/**
 * @param {KnobDef} knob
 * @param {string} currentStr
 * @returns {HTMLElement}
 */
function renderKnobRow(knob, currentStr) {
  const row = el('div', { cls: 'config-row' });

  // Label column
  const labelCol = el('div', { cls: 'config-row-label' });
  labelCol.appendChild(el('div', { cls: 'config-row-path', text: knob.label }));
  labelCol.appendChild(el('div', { cls: 'config-row-dotpath dim', text: knob.path }));
  row.appendChild(labelCol);

  // Input column
  const inputCol = el('div', { cls: 'config-row-input-col' });

  /** @type {HTMLInputElement|HTMLSelectElement} */
  let inputEl;
  if (knob.kind === 'select') {
    inputEl = el('select', { cls: 'config-input' });
    for (const opt of (knob.options || [])) {
      const optEl = el('option', { value: opt, text: opt });
      if (opt === currentStr) optEl.selected = true;
      inputEl.appendChild(optEl);
    }
  } else {
    inputEl = el('input', {
      type: knob.kind === 'number' ? 'number' : 'text',
      cls: 'config-input',
      value: currentStr,
    });
  }

  inputCol.appendChild(inputEl);

  // Live command preview
  const previewEl = el('div', { cls: 'wizard-cmd-preview config-cmd-preview', text: buildPreview(knob.path, currentStr) });
  inputCol.appendChild(previewEl);

  // Update preview on input
  const updatePreview = () => {
    previewEl.textContent = buildPreview(knob.path, inputEl.value.trim() || '');
  };
  inputEl.addEventListener('input', updatePreview);
  inputEl.addEventListener('change', updatePreview);

  // Set button
  const setBtn = el('button', { cls: 'btn btn-green config-set-btn', text: 'Set' });
  setBtn.addEventListener('click', () => handleSet(knob.path, inputEl, setBtn));
  inputCol.appendChild(setBtn);

  row.appendChild(inputCol);
  return row;
}

/**
 * @param {string} path
 * @param {string} value
 * @returns {string}
 */
function buildPreview(path, value) {
  const v = value !== '' ? value : '<value>';
  return `soma config set ${path} ${v}`;
}

// ── Set handler ──────────────────────────────────────────────────────

/**
 * @param {string} path
 * @param {HTMLInputElement|HTMLSelectElement} inputEl
 * @param {HTMLButtonElement} btn
 */
async function handleSet(path, inputEl, btn) {
  const value = inputEl.value.trim();
  if (value === '') {
    showToast('Value cannot be empty.', 'error');
    return;
  }

  const project = get('currentProject');
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '…';

  try {
    const result = await somaRaw(['config', 'set', path, value], project);
    const msg = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;
    showToast(msg, result.code === 0 ? 'success' : 'error');

    if (result.code === 0) {
      // Reload config to reflect the new value
      await loadConfig();
      // Kick poll + verify so the config.change event appears in the timeline
      triggerPollAndVerify();
    }
  } catch (e) {
    showToast(String(e), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ── Clear cache ──────────────────────────────────────────────────────

/**
 * Show cmdPreview for 'soma cache clear', confirm, then run.
 * @param {HTMLButtonElement} btn
 */
async function handleClearCache(btn) {
  const project = get('currentProject');
  const rowsEl = document.getElementById('config-rows');
  if (!rowsEl) return;

  // If a preview confirmation is already showing, remove it (toggle off).
  const existing = document.getElementById('cache-clear-confirm');
  if (existing) { existing.remove(); return; }

  const confirmBox = el('div', { id: 'cache-clear-confirm', cls: 'cron-add-section', style: 'margin-top:12px' });
  confirmBox.appendChild(cmdPreview('soma cache clear'));
  const confirmBtn = el('button', { cls: 'btn btn-red', text: 'Confirm - clear cache' });
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    try {
      const result = await somaRaw(['cache', 'clear'], project);
      const msg = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;
      showToast(msg, result.code === 0 ? 'success' : 'error');
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      confirmBox.remove();
      triggerPollAndVerify();
    }
  });
  const cancelBtn = el('button', { cls: 'btn', text: 'Cancel', style: 'margin-left:8px' });
  cancelBtn.addEventListener('click', () => confirmBox.remove());
  const btnRow = el('div', { style: 'margin-top:8px;display:flex;gap:8px' });
  btnRow.appendChild(confirmBtn);
  btnRow.appendChild(cancelBtn);
  confirmBox.appendChild(btnRow);
  rowsEl.insertAdjacentElement('beforebegin', confirmBox);
}

function triggerPollAndVerify() {
  import('../app.js').then(({ triggerPollAndVerify: tpv }) => {
    if (typeof tpv === 'function') tpv();
  }).catch(() => {});
}
