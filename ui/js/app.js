/**
 * app.js - Entry point for soma cockpit.
 *
 * Boot sequence:
 *   1. soma version --json → binary check, ui_api check
 *   2. project list --json → populate sidebar
 *   3. Select project (last from localStorage or first)
 *   4. Mount initial view (timeline)
 *
 * Also: trust badge wiring, nav routing, poll/verify triggers.
 *
 * @module app
 */

import { somaVersion, projectList, logVerify, somaRaw } from './soma.js';
import { get, setState, subscribe, persistProject, getPersistedProject } from './state.js';
import { el, selectById } from './render.js';
import { mountStatusBar, refreshStatus } from './views/statusbar.js';
import { mountInspector, closeInspector } from './views/inspector.js';
import { showToast } from './views/toast.js';
import { loadJournal, mountTimeline, unmountTimeline } from './views/timeline.js';
import { mountSkills, unmountSkills } from './views/skills.js';
import { mountProposals, unmountProposals } from './views/proposals.js';
import { mountPolicy, unmountPolicy } from './views/policy.js';
import { openWizard } from './views/wizard.js';
import { mountGoals, unmountGoals } from './views/goals.js';
import { mountCrons, unmountCrons } from './views/crons.js';
import { mountExports, unmountExports } from './views/exports.js';
import { mountSessions, unmountSessions } from './views/sessions.js';
import { mountConsole } from './views/console.js';
import { mountSettings, unmountSettings } from './views/settings.js';
import { mountGuide, unmountGuide } from './views/guide.js';

// ── Active view tracking ────────────────────────────────────────
const UNMOUNTERS = {
  timeline:  unmountTimeline,
  skills:    unmountSkills,
  proposals: unmountProposals,
  policy:    unmountPolicy,
  goals:     unmountGoals,
  crons:     unmountCrons,
  exports:   unmountExports,
  sessions:  unmountSessions,
  settings:  unmountSettings,
  guide:     unmountGuide,
};

// Sidebar view order for keyboard shortcuts 1–9, 0
const NAV_ORDER = [
  'timeline',   // 1
  'sessions',   // 2
  'exports',    // 3
  'skills',     // 4
  'goals',      // 5
  'crons',      // 6
  'proposals',  // 7
  'policy',     // 8
  'settings',   // 9
  'guide',      // 0
];

// ── Boot ─────────────────────────────────────────────────────────

/**
 * Main boot function. Called once on DOMContentLoaded.
 */
export async function boot() {
  mountStatusBar();
  mountInspector();
  mountConsole();
  wireTrustBadge();
  wireNav();
  wireSidebar();
  wireKeyboardShortcuts();

  // 1. Version check
  let versionOk = false;
  try {
    const ver = await somaVersion();
    if (ver && typeof ver.ui_api === 'number') {
      if (ver.ui_api > 1) {
        showBanner(`cockpit older than runtime - some data may not render (runtime ui_api=${ver.ui_api}, cockpit expects 1)`);
      }
      versionOk = true;
    } else {
      // version --json not supported yet - fall back gracefully
      versionOk = true;
    }
  } catch (e) {
    // Binary not found or soma error - show setup hint
    showSetupHint(String(e));
    return;
  }

  // 2. Project list
  try {
    const projects = await projectList();
    setState({ projects: projects || [] });
    populateProjectSelect(projects || []);

    if (!projects || projects.length === 0) {
      // No projects → open wizard
      openWizard();
      return;
    }

    // 3. Select last or first project
    const last = getPersistedProject();
    const toSelect = (last && projects.find(p => p.root === last))
      ? last
      : projects[0].root;
    await selectProject(toSelect, projects);
  } catch (e) {
    showToast(`project list: ${e}`, 'error');
    showSetupHint(String(e));
    return;
  }
}

// ── Project selection ────────────────────────────────────────────

/**
 * Switch to a project root.
 * @param {string} root
 */
export async function switchProject(root) {
  const projects = get('projects') || [];
  await selectProject(root, projects);
}

async function selectProject(root, projects) {
  const project = projects.find(p => p.root === root) || projects[0];
  if (!project) return;

  setState({
    currentProject:     project.root,
    currentProjectName: project.name,
    events:             [],
    journalOffset:      0,
    journalSize:        0,
    skills:             [],
    proposals:          [],
    proposalsAll:       [],
    inspectorEvent:     null,
    filterArea:         '',
    filterText:         '',
    filterKind:         '',
    renderOffset:       500,
  });

  persistProject(project.root);
  updateProjectSelectUI(project.root);

  // Close inspector when switching projects
  closeInspector();

  // Refresh status bar data
  refreshStatus();

  // Run initial verify
  runVerify().catch(e => console.warn('initial verify:', e));

  // Load journal
  await loadJournal(project.root);

  // Mount the default view
  navigateTo('timeline');

  // Update proposals badge
  updateProposalsBadge();
}

// ── Verify (trust badge) ─────────────────────────────────────────

/**
 * Run `log verify --json` and update the trust badge.
 * Called on boot, on demand (badge click), and after journal changes (debounced).
 */
export async function runVerify() {
  const project = get('currentProject');
  if (!project) return;

  setState({ verifying: true });
  updateBadgeUI();

  try {
    const result = await logVerify(project);
    setState({ verifyResult: result, verifying: false });
  } catch (e) {
    // logVerify can also return broken-chain info as a parsed object
    // if it threw a string it means real error
    setState({ verifyResult: { ok: false, reason: String(e) }, verifying: false });
  }
  updateBadgeUI();
}

/**
 * Trigger an immediate poll of the journal + re-verify.
 * Called after proposal apply/dismiss for the cause→effect loop.
 */
export async function triggerPollAndVerify() {
  const project = get('currentProject');
  if (!project) return;
  // Trigger one poll immediately
  try {
    const { tail } = await import('./soma.js');
    const { prependEvents, setEvents, get: sg, setState: ss } = await import('./state.js');
    const offset = sg('journalOffset');
    const result = await tail(project, offset);

    if (result.size < offset) {
      const fresh = await tail(project, 0);
      const parsed = fresh.lines.map(safeParseEvent).filter(Boolean);
      setEvents([...parsed].reverse());
      ss({ journalOffset: fresh.offset, journalSize: fresh.size });
    } else if (result.lines.length > 0) {
      const parsed = result.lines.map(safeParseEvent).filter(Boolean);
      prependEvents(parsed);
      ss({ journalOffset: result.offset, journalSize: result.size });
    }
  } catch (e) {
    console.warn('triggerPollAndVerify poll:', e);
  }
  await runVerify();
  updateProposalsBadge();
  refreshStatus().catch(() => {}); // policy/providers/cache may have changed
}

function safeParseEvent(line) {
  try { return JSON.parse(line); } catch (_) { return null; }
}

// ── Trust badge UI ───────────────────────────────────────────────

function wireTrustBadge() {
  const badge = document.getElementById('trust-badge');
  const popover = document.getElementById('trust-popover');
  const popoverClose = document.getElementById('trust-popover-close');

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    popover.classList.toggle('hidden');
    if (!popover.classList.contains('hidden')) {
      runVerify();
    }
  });

  if (popoverClose) {
    popoverClose.addEventListener('click', () => popover.classList.add('hidden'));
  }

  document.addEventListener('click', (e) => {
    if (!popover.contains(/** @type {Node} */ (e.target)) && e.target !== badge) {
      popover.classList.add('hidden');
    }
  });

  subscribe('verifyResult', updateBadgeUI);
  subscribe('verifying',    updateBadgeUI);
}

function updateBadgeUI() {
  const badgeEl   = document.getElementById('trust-badge');
  const badgeText = document.getElementById('badge-text');
  const popoverBody = document.getElementById('trust-popover-body');
  if (!badgeEl || !badgeText) return;

  const result   = get('verifyResult');
  const verifying = get('verifying');

  if (verifying) {
    badgeEl.className = 'trust-badge trust-unknown';
    badgeText.textContent = 'verifying…';
    return;
  }

  if (!result) {
    badgeEl.className = 'trust-badge trust-unknown';
    badgeText.textContent = 'not verified';
    return;
  }

  if (result.ok === true) {
    badgeEl.className = 'trust-badge trust-ok';
    const n = result.events !== undefined ? result.events : '';
    badgeText.textContent = `chain verified${n !== '' ? ` · ${n} events` : ''}`;
    if (popoverBody) {
      popoverBody.innerHTML = '';
      popoverBody.appendChild(el('p', { cls: 'green', text: '✓ Chain is intact' }));
      if (result.head) {
        popoverBody.appendChild(el('p', { cls: 'mono dim', text: `head: ${result.head}` }));
      }
      if (n !== '') {
        popoverBody.appendChild(el('p', { cls: 'dim', text: `${n} events verified` }));
      }
    }
  } else {
    badgeEl.className = 'trust-badge trust-broken';
    const where = result.broken_line ? `line ${result.broken_line}` : 'unknown line';
    const reason = result.reason || 'hash mismatch';
    badgeText.textContent = `⛓ BROKEN at ${where} - ${reason}`;
    if (popoverBody) {
      popoverBody.innerHTML = '';
      popoverBody.appendChild(el('p', { cls: 'red', text: `✕ BROKEN at ${where}` }));
      popoverBody.appendChild(el('p', { cls: 'dim', text: `Reason: ${reason}` }));
      if (result.events_checked !== undefined) {
        popoverBody.appendChild(el('p', { cls: 'dim', text: `Events checked: ${result.events_checked}` }));
      }
    }
  }
}

// ── Navigation ───────────────────────────────────────────────────

function wireNav() {
  document.getElementById('main-nav').addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('[data-view]');
    if (btn) navigateTo(/** @type {HTMLElement} */ (btn).dataset.view);
  });
}

/**
 * Wire digit keyboard shortcuts (1–9,0) for sidebar views; '?' opens Guide.
 * Disabled when focus is inside an input/textarea/select or a dialog is open.
 */
function wireKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Skip when a dialog is open
    const openDialog = document.querySelector('dialog[open]');
    if (openDialog) return;

    // Skip when focus is in a form element
    const t = /** @type {HTMLElement|null} */ (e.target);
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;

    // Skip modified keys (Cmd, Ctrl, Alt)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === '?') {
      navigateTo('guide');
      return;
    }

    // Digits 1–9 map to NAV_ORDER indices 0–8; 0 maps to index 9
    let idx = -1;
    if (e.key >= '1' && e.key <= '9') {
      idx = parseInt(e.key, 10) - 1;
    } else if (e.key === '0') {
      idx = 9;
    }
    if (idx >= 0 && idx < NAV_ORDER.length) {
      navigateTo(NAV_ORDER[idx]);
    }
  });
}

/**
 * Navigate to a named view, unmounting the current one first.
 * Legacy keys 'config', 'mcp', 'ecosystem' redirect to the Settings hub
 * with the appropriate tab pre-selected.
 *
 * @param {string} view
 * @param {{ tab?: string, prefill?: string }} [opts]
 */
export function navigateTo(view, opts) {
  // Legacy redirect: absorbed views → Settings hub
  const LEGACY_TAB = { config: 'models', mcp: 'connectors', ecosystem: 'ecosystem' };
  if (LEGACY_TAB[view]) {
    navigateTo('settings', { tab: LEGACY_TAB[view], ...opts });
    return;
  }

  const current = get('activeView');
  if (current && UNMOUNTERS[current]) {
    try { UNMOUNTERS[current](); } catch (_) {}
  }
  setState({ activeView: view });
  updateNavActive(view);

  // Mount new view
  switch (view) {
    case 'timeline':  mountTimeline(); break;
    case 'skills':    mountSkills(); break;
    case 'proposals': mountProposals(); break;
    case 'policy':    mountPolicy(); break;
    case 'goals':     mountGoals(); break;
    case 'crons':     mountCrons(); break;
    case 'exports':   mountExports(); break;
    case 'sessions':  mountSessions(); break;
    case 'settings':  mountSettings(opts || {}); break;
    case 'guide':     mountGuide(); break;
  }
}

function updateNavActive(view) {
  for (const btn of document.querySelectorAll('.nav-item')) {
    btn.classList.toggle('active', /** @type {HTMLElement} */ (btn).dataset.view === view);
  }
}

// ── Sidebar ──────────────────────────────────────────────────────

function wireSidebar() {
  const sel = selectById('project-select');
  sel.addEventListener('change', () => {
    const root = sel.value;
    if (root) switchProject(root);
  });

  document.getElementById('add-project-btn').addEventListener('click', () => openWizard());

  // Subscribe to projects state
  subscribe('projects', () => {
    const projects = get('projects') || [];
    populateProjectSelect(projects);
  });
}

function populateProjectSelect(projects) {
  const sel = selectById('project-select');
  sel.innerHTML = '';
  if (!projects || projects.length === 0) {
    sel.appendChild(el('option', { value: '', text: '(no projects)' }));
    return;
  }
  for (const p of projects) {
    sel.appendChild(el('option', { value: p.root, text: p.name || p.root.split('/').pop() }));
  }
  const current = get('currentProject');
  if (current) sel.value = current;
}

function updateProjectSelectUI(root) {
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('project-select'));
  if (sel) sel.value = root;
}

// ── Proposals badge ──────────────────────────────────────────────

async function updateProposalsBadge() {
  const project = get('currentProject');
  if (!project) return;
  try {
    const { proposalsList: pList } = await import('./soma.js');
    const open = await pList(project);
    const count = (open || []).length;
    setState({ proposals: open || [] });
    const badge = document.getElementById('proposals-badge');
    if (badge) {
      badge.textContent = String(count);
      badge.classList.toggle('hidden', count === 0);
    }
  } catch (_) {}
}

// ── Setup hint ───────────────────────────────────────────────────

function showSetupHint(errMsg) {
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const hint = el('div', { cls: 'setup-hint' });
  hint.appendChild(el('h2', { text: 'soma binary not found' }));
  hint.appendChild(el('p', { text: `Error: ${errMsg}` }));
  hint.appendChild(el('p', { text: 'The cockpit looks for the soma binary in this order:' }));
  hint.appendChild(el('code', { text: '1. $SOMA_BIN environment variable' }));
  hint.appendChild(el('code', { text: '2. ../soma/target/release/soma' }));
  hint.appendChild(el('code', { text: '3. soma on $PATH' }));
  hint.appendChild(el('p', { text: 'Build soma with: cargo build --release --manifest-path ../soma/Cargo.toml' }));
  container.appendChild(hint);

  // Still update badge
  const badgeEl = document.getElementById('trust-badge');
  if (badgeEl) {
    badgeEl.className = 'trust-badge trust-broken';
    document.getElementById('badge-text').textContent = 'binary not found';
  }
}

function showBanner(msg) {
  const header = document.getElementById('app-header');
  if (!header) return;
  const banner = el('div', { style: 'background:var(--amber-bg);color:var(--amber);font-size:11px;padding:3px 10px;border-radius:12px;border:1px solid var(--amber)', text: msg });
  header.appendChild(banner);
}

// ── DOMContentLoaded ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  boot().catch(e => {
    console.error('boot error:', e);
    showToast(`Boot error: ${e}`, 'error');
  });
});
