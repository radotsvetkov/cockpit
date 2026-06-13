/**
 * ecosystem.js - HYT ecosystem tab (v4 §8c.6) + setup surface.
 *
 * Surfaces the sibling tools (akmon, agef-verify, memora, memora-cli) - presence
 * and version (read-only; foreign configs are never read, they may hold secrets)
 * - and turns the tab into a *setup* surface:
 *
 *  - Refresh re-probes ecosystem_info.
 *  - When akmon/memora aren't found, an honest guidance panel explains they are
 *    separate tools you build from their repos, then add to PATH or set
 *    AKMON_BIN / MEMORA_BIN.
 *  - "Set up akmon delegation" builds the akmon-task skill (the skill Sessions'
 *    Delegate runs) via the SAME mechanism skills.js uses: stage_manifest →
 *    `skill add <path>`. This makes Delegate actually work for this user.
 *
 * @module views/ecosystem
 */

import { el, helpButton } from '../render.js';
import { get } from '../state.js';
import { ecosystemInfo, somaRaw, skillList } from '../soma.js';
import { showToast } from './toast.js';
import { formModal, field } from './modal.js';

let _mounted = false;

/** Default model for an akmon delegation session. */
const DEFAULT_MODEL = 'llama3.2';

/**
 * Build the akmon-task skill manifest. This is the skill Sessions' "Delegate"
 * runs (`skill run akmon-task <task>`). `{input}` is soma's placeholder for the
 * delegated task text. The conductor convention: soma decides/gates/journals,
 * akmon executes one session and returns JSON evidence.
 *
 * @param {string} akmonPath - absolute path to the akmon binary
 * @param {string} model     - model id (e.g. llama3.2)
 * @returns {object} skill manifest
 */
export function buildAkmonTaskManifest(akmonPath, model) {
  const cmd = `${akmonPath} --task {input} --model ${model} --yes --output json`;
  return {
    name: 'akmon-task',
    version: 1,
    purpose: 'Delegate a task to akmon (one governed agent session, JSON evidence).',
    goal: 'akmon runs the task and returns a signed evidence bundle.',
    tags: ['akmon', 'delegate'],
    kind: 'command',
    run: { cmd, timeout_s: 600 },
    success: { kind: 'exit0' },
  };
}

/**
 * Mount into a container element.
 * @param {HTMLElement} [containerEl] - target element; defaults to #view-container
 */
export async function mountEcosystem(containerEl) {
  _mounted = true;
  const container = containerEl || document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const header = el('div', { cls: 'section-header' });
  header.appendChild(el('h2', { cls: 'section-title', text: 'Ecosystem' }));
  header.appendChild(helpButton('Ecosystem', [
    'The HYT ecosystem is a set of cooperating binaries: soma (the policy enforcer and journal), akmon (the execution unit - full agent sessions with evidence), agef-verify (offline bundle verifier), and memora/memora-cli (verified citation-integrity memory).',
    'The conductor pattern: soma decides and gates; akmon executes and signs proof. This means you only audit soma\'s code for trust - a compromised cockpit or akmon is bounded by soma\'s policy.',
    'akmon and memora are SEPARATE tools - you build them from their own repositories. Once a tool is on your PATH (or AKMON_BIN / MEMORA_BIN points at it), Refresh to detect it, then "Set up akmon delegation" to wire delegation up.',
  ]));
  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => mountEcosystem(container));
  header.appendChild(refreshBtn);
  const setupBtn = el('button', { cls: 'btn btn-green', text: 'Set up akmon delegation' });
  setupBtn.addEventListener('click', () => openAkmonSetupModal(null));
  header.appendChild(setupBtn);
  container.appendChild(header);

  container.appendChild(el('div', {
    cls: 'config-journal-note',
    text: 'Read-only presence + version. akmon and memora are separate tools - build them, then add to PATH or set AKMON_BIN / MEMORA_BIN and Refresh. "Set up akmon delegation" creates the akmon-task skill so Sessions → Delegate works.',
  }));

  const grid = el('div', { id: 'eco-grid', cls: 'sessions-list' });
  container.appendChild(grid);

  const ROLES = {
    'akmon':       'Execution unit & evidence: full agent sessions (akmon-task skill), AGEF bundles, signing. soma decides - akmon executes and proves.',
    'agef-verify': 'Standalone offline verifier: anyone can check a bundle’s chain, objects, and signatures with this one binary. Used by the Exports board’s Verify buttons.',
    'memora':      'Verified memory: citation-integrity store. Integrate via MCP - add its server to mcp.json and import its tools as skills (MCP view).',
    'memora-cli':  'memora’s command-line interface - wrap calls as soma skills to keep them policy-gated and journaled.',
  };

  /** @type {import('../soma.js').EcoTool[]} */
  let tools = [];
  try {
    tools = (await ecosystemInfo()) || [];
  } catch (e) {
    showToast(`ecosystem: ${e}`, 'error');
    return;
  }

  /** @type {import('../soma.js').EcoTool|undefined} */
  const akmon = tools.find(t => t.name === 'akmon');
  /** @type {import('../soma.js').EcoTool|undefined} */
  const memora = tools.find(t => t.name === 'memora');

  for (const t of tools) {
    const card = el('div', { cls: 'session-card' });
    const head = el('div', { cls: 'session-head' });
    head.appendChild(el('span', {
      cls: `chip ${t.exists ? 'chip-ok' : 'chip-fail'}`,
      text: t.exists ? '● present' : '○ not found',
    }));
    head.appendChild(el('span', { style: 'font-weight:600', text: t.name }));
    if (t.exists && t.version) {
      head.appendChild(el('span', { cls: 'dim mono', style: 'font-size:11px', text: t.version }));
    }
    card.appendChild(head);
    card.appendChild(el('div', {
      cls: t.exists ? 'mcp-server-cmd' : 'mcp-server-cmd dim',
      text: t.exists ? t.path : `${t.path} (not found)`,
    }));
    card.appendChild(el('div', { cls: 'dim', style: 'font-size:12px', text: ROLES[t.name] || '' }));

    // ── Per-tool action buttons ────────────────────────────────
    const actRow = el('div', { cls: 'session-actions', style: 'margin-top:8px' });

    if (t.name === 'akmon') {
      const cfgBtn = el('button', {
        cls: t.exists ? 'btn btn-sm' : 'btn btn-sm btn-green',
        text: 'Set up delegation',
      });
      cfgBtn.addEventListener('click', () => openAkmonSetupModal(t.exists ? t.path : ''));
      actRow.appendChild(cfgBtn);
    }

    if (t.exists && t.name === 'memora-cli') {
      const mcpBtn = el('button', { cls: 'btn btn-sm', text: 'Connect via MCP' });
      mcpBtn.addEventListener('click', () => {
        import('../app.js').then(({ navigateTo }) => {
          if (typeof navigateTo === 'function') {
            navigateTo('settings', { tab: 'connectors', prefill: 'memora' });
          }
        }).catch(() => {});
      });
      actRow.appendChild(mcpBtn);
    }

    if (actRow.children.length > 0) card.appendChild(actRow);
    grid.appendChild(card);
  }

  // ── Honest guidance when akmon/memora aren't found ──────────────
  const missing = [];
  if (akmon && !akmon.exists) missing.push('akmon');
  if (memora && !memora.exists) missing.push('memora');
  if (missing.length > 0) {
    container.appendChild(buildGuidancePanel(missing));
  }
}

/**
 * Build the honest "these are separate tools" guidance panel. Factual only -
 * no invented install commands.
 * @param {string[]} missing - names of tools not found (akmon and/or memora)
 * @returns {HTMLElement}
 */
function buildGuidancePanel(missing) {
  const panel = el('div', { cls: 'config-journal-note', style: 'margin-top:14px' });
  panel.appendChild(el('div', {
    style: 'font-weight:600;margin-bottom:6px',
    text: `Not found: ${missing.join(', ')}`,
  }));
  panel.appendChild(el('div', {
    style: 'font-size:12px;margin-bottom:6px',
    text: 'akmon and memora are separate tools - soma shells out to them, it does not bundle them. To enable them here:',
  }));
  const ol = el('ol', { style: 'font-size:12px;margin:0 0 0 18px;padding:0;line-height:1.6' });
  ol.appendChild(el('li', { text: 'Build the binary from the akmon / memora repository (cargo build --release in that repo).' }));
  ol.appendChild(el('li', { text: 'Add it to your PATH, or set AKMON_BIN / MEMORA_BIN to the binary’s full path.' }));
  ol.appendChild(el('li', { text: 'Click Refresh above to re-probe.' }));
  panel.appendChild(ol);
  if (missing.includes('akmon')) {
    panel.appendChild(el('div', {
      cls: 'dim',
      style: 'font-size:11px;margin-top:8px',
      text: 'If a Finder-launched app can’t see your shell PATH, that’s fine - "Set up akmon delegation" lets you Locate the binary directly.',
    }));
  }
  return panel;
}

/**
 * Open the "Set up akmon delegation" modal. Builds the akmon-task skill via the
 * same mechanism skills.js uses (stage_manifest → `skill add <path>`).
 *
 * The path is trusted as typed/located - we do NOT require ecosystem_info to
 * have detected akmon, since a Finder-launched GUI app can't see the shell PATH.
 *
 * @param {string|null} detectedPath - akmon path from ecosystem_info, if found
 */
function openAkmonSetupModal(detectedPath) {
  const project = get('currentProject');
  if (!project) { showToast('open a project first', 'error'); return; }

  const pathInput = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', placeholder: '/path/to/akmon', value: detectedPath || '' })
  );
  const modelInput = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', placeholder: DEFAULT_MODEL, value: DEFAULT_MODEL })
  );

  // Path field with a Locate… button (pick a directory, append /akmon).
  const pathRow = el('div', { style: 'display:flex;gap:8px;align-items:center' });
  pathInput.style.flex = '1';
  const locateBtn = el('button', { cls: 'btn', text: 'Locate…', style: 'flex:none' });
  locateBtn.addEventListener('click', async () => {
    try {
      const picked = await window.__TAURI__.core.invoke('pick_directory');
      if (picked) {
        const dir = String(picked).replace(/\/$/, '');
        pathInput.value = `${dir}/akmon`;
        modal.refreshPreview();
      }
    } catch (e) {
      showToast(`locate: ${e}`, 'error');
    }
  });
  pathRow.appendChild(pathInput);
  pathRow.appendChild(locateBtn);

  /** Stage the akmon-task manifest and return its temp path. */
  async function stage() {
    const akmonPath = pathInput.value.trim();
    const model = modelInput.value.trim() || DEFAULT_MODEL;
    const content = JSON.stringify(buildAkmonTaskManifest(akmonPath, model), null, 2);
    return window.__TAURI__.core.invoke('stage_manifest', { content });
  }

  const modal = formModal({
    title: 'Set up akmon delegation',
    fields: [
      field('akmon binary path', pathRow,
        'Full path to the akmon binary. Detected automatically when on PATH/AKMON_BIN; otherwise paste it or use Locate… (pick the folder, we append /akmon).'),
      field('Model', modelInput, 'Model id akmon runs the session with (e.g. llama3.2).'),
    ],
    commandPreview: () => {
      const akmonPath = pathInput.value.trim() || '<akmon-path>';
      const model = modelInput.value.trim() || DEFAULT_MODEL;
      return buildAkmonTaskManifest(akmonPath, model).run.cmd;
    },
    confirmLabel: 'Create akmon-task skill',
    onConfirm: async () => {
      const akmonPath = pathInput.value.trim();
      if (!akmonPath) { showToast('enter the akmon binary path', 'error'); return false; }
      const path = await stage();
      const result = await somaRaw(['skill', 'add', path], project);
      const msg = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;
      if (result.code !== 0) { showToast(msg, 'error'); return false; }
      showToast('akmon delegation set up - Sessions → Delegate now works', 'success');
      import('../app.js').then(({ triggerPollAndVerify }) => triggerPollAndVerify && triggerPollAndVerify()).catch(() => {});
      return true;
    },
  });

  // Seed the run.cmd preview immediately.
  modal.refreshPreview();
}

/** Unmount. */
export function unmountEcosystem() {
  _mounted = false;
}
