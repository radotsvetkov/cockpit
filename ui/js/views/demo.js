/**
 * demo.js - "Load demo project" one-click onboarding.
 *
 * A brand-new user lands on an empty cockpit. This module gives them a single
 * button that scaffolds a fully POPULATED project - builtin skills, a governed
 * run, a goal with a step, and an evidence bundle - so the very first screen
 * they see has a working timeline, skills, sessions, goals and evidence instead
 * of a blank slate.
 *
 * Everything is OFFLINE-SAFE: the `local-only` preset disables egress and the
 * sample run is a plain `echo`, so it works on a fresh machine with no API keys
 * and no network.
 *
 * The scaffold sequence (each step streamed to the run console so the user
 * watches it happen, exactly the evidence trail soma is about):
 *   1. init <dir> --name soma-demo --with-builtins   (populates Skills)
 *   2. preset apply local-only                        (air-gapped, no network)
 *   3. wrap --label demo-run -- sh -c 'echo …'        (Sessions + wrap receipts)
 *   4. goal add … then goal step … --kind skill …     (a goal with a step)
 *   5. export                                         (an evidence bundle)
 *
 * The goal id is captured from `goal add` stdout (`goal added: gl_…`).
 *
 * @module views/demo
 */

import { el } from '../render.js';
import { formModal, field } from './modal.js';
import { showToast } from './toast.js';
import { startRun, isRunning } from './console.js';
import { somaRaw } from '../soma.js';

const DEMO_NAME = 'soma-demo';

/** @returns {Function} the lazily-resolved Tauri invoke. */
function getInvoke() {
  return window.__TAURI__.core.invoke;
}

/**
 * Join a parent directory and the demo folder name with a single slash,
 * tolerating a trailing slash on the parent.
 * @param {string} dir
 * @returns {string}
 */
function demoPath(dir) {
  const base = (dir || '').replace(/\/+$/, '');
  return base ? `${base}/${DEMO_NAME}` : '';
}

/**
 * Open the "Load demo project" modal. On confirm it runs the offline-safe
 * scaffold sequence, then switches the cockpit to the new project.
 */
export function openDemoModal() {
  if (isRunning()) {
    showToast('a run is already in progress - wait for it to finish', 'error');
    return;
  }

  // ── Directory field (paste a path or Browse…) ──
  let parentDir = '';
  const dirInput = /** @type {HTMLInputElement} */ (
    el('input', { type: 'text', placeholder: '/Users/you', style: 'flex:1' })
  );
  const browseBtn = el('button', { cls: 'btn', text: 'Browse…', style: 'flex:none' });
  browseBtn.addEventListener('click', async () => {
    try {
      const picked = await getInvoke()('pick_directory');
      if (picked) {
        parentDir = String(picked).replace(/\/+$/, '');
        dirInput.value = parentDir;
        // Manually fire so the command preview refreshes.
        dirInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (e) {
      showToast(`browse: ${e}`, 'error');
    }
  });
  dirInput.addEventListener('input', () => { parentDir = dirInput.value.trim(); });

  const dirRow = el('div', { style: 'display:flex;gap:8px;align-items:center' });
  dirRow.appendChild(dirInput);
  dirRow.appendChild(browseBtn);

  const dirField = field(
    'Where to create it (paste a path or browse)',
    dirRow,
    `A new "${DEMO_NAME}" folder is created inside this directory.`
  );

  // ── What it creates ──
  const blurb = el('div', { cls: 'field-hint dim', style: 'margin:4px 0 2px;line-height:1.5' });
  blurb.appendChild(el('div', { text: 'Creates a ready-to-explore project, fully offline (no keys, no network):' }));
  const ul = el('ul', { style: 'margin:6px 0 0;padding-left:18px' });
  for (const line of [
    'builtin skills (cargo-build, cargo-test, git-status, disk-usage)',
    'the local-only preset - egress disabled, air-gapped',
    'a governed sample run (wrap.start / wrap.end receipts)',
    'a goal "Explore soma" with a skill step',
    'an exported evidence bundle',
  ]) {
    ul.appendChild(el('li', { style: 'font-size:11px', text: line }));
  }
  blurb.appendChild(ul);

  formModal({
    title: 'Load demo project',
    fields: [dirField, blurb],
    confirmLabel: 'Create demo',
    commandPreview: () => {
      const target = demoPath(parentDir) || `<dir>/${DEMO_NAME}`;
      return `soma init ${target} --name ${DEMO_NAME} --with-builtins`;
    },
    onConfirm: async () => {
      const target = demoPath(parentDir);
      if (!target) {
        showToast('Please choose a directory.', 'error');
        return false;
      }
      // Close the modal immediately; the scaffold streams to the console panel.
      // Run async after this returns so the modal closes cleanly.
      setTimeout(() => { runDemoScaffold(target).catch((e) => showToast(String(e), 'error')); }, 0);
      return true;
    },
  });
}

/**
 * Capture the goal id from `goal add` stdout, falling back to `goal list`.
 * `goal add` prints `goal added: gl_… (title)`.
 *
 * @param {string} target - the demo project root
 * @returns {Promise<string|null>}
 */
async function captureGoalId(target) {
  // init takes the directory positionally; every other command uses --project.
  const add = await somaRaw(
    ['goal', 'add', 'Explore soma', '--why', 'a guided demo goal', '--accept', 'disk-usage runs'],
    target
  );
  // Surface add output in the console for parity with the streamed steps.
  const m = (add.stdout || '').match(/gl_[a-z0-9]+/i);
  if (add.code === 0 && m) return m[0];

  // Fallback: list goals and take the most recent matching one.
  try {
    const raw = await somaRaw(['goal', 'list', '--json'], target);
    if (raw.code === 0) {
      const goals = JSON.parse((raw.stdout || '').trim() || '[]');
      const found = Array.isArray(goals)
        ? goals.find((g) => g && g.title === 'Explore soma') || goals[goals.length - 1]
        : null;
      if (found && found.id) return String(found.id);
    }
  } catch (_) { /* fall through */ }
  return null;
}

/**
 * Run the offline-safe scaffold sequence, streaming each step to the console.
 * Stops and toasts on the first failing step. On success, reloads the project
 * list, switches to the demo project, and navigates to the Timeline.
 *
 * @param {string} target - absolute path of the demo project to create
 */
export async function runDemoScaffold(target) {
  if (isRunning()) {
    showToast('a run is already in progress', 'error');
    return;
  }

  // Idempotent-ish: if the dir already holds a .soma, reuse it (warn) rather
  // than crashing on a second init.
  let alreadyInit = false;
  try {
    const policy = await somaRaw(['config', 'get', '--json'], target);
    alreadyInit = policy.code === 0;
  } catch (_) { /* not initialized yet - expected */ }

  // 1. init (positional dir; --project is ignored by init).
  if (alreadyInit) {
    showToast(`${target} already has a .soma - reusing it`, 'info');
  } else {
    const code = await startRun(
      'init demo project',
      ['init', target, '--name', DEMO_NAME, '--with-builtins'],
      null
    );
    if (code !== 0) { showToast('demo: init failed - see console', 'error'); return; }
  }

  // 2. preset apply local-only (air-gapped - no network for the rest).
  if ((await startRun('apply local-only preset', ['preset', 'apply', 'local-only'], target)) !== 0) {
    showToast('demo: preset apply failed - see console', 'error');
    return;
  }

  // 3. govern a sample run (populates Sessions + wrap receipts in Timeline).
  const wrapCode = await startRun(
    'govern a sample run',
    ['wrap', '--label', 'demo-run', '--', 'sh', '-c', 'echo hello from a governed agent'],
    target
  );
  if (wrapCode !== 0) { showToast('demo: governed run failed - see console', 'error'); return; }

  // 4. a sample goal + a skill step. goal add/step are not streamed (we need
  //    the id back), so run them via somaRaw and report through the toast.
  const gid = await captureGoalId(target);
  if (!gid) { showToast('demo: could not create the sample goal', 'error'); return; }
  const step = await somaRaw(
    ['goal', 'step', gid, '--name', 'check-disk', '--kind', 'skill',
     '--skill', 'disk-usage', '--input', '.', '--verify', 'exit0'],
    target
  );
  if (step.code !== 0) {
    showToast(`demo: goal step failed - ${(step.stderr || '').trim() || 'exit ' + step.code}`, 'error');
    return;
  }

  // 5. export (gives the Evidence view a bundle).
  if ((await startRun('export evidence bundle', ['export'], target)) !== 0) {
    showToast('demo: export failed - see console', 'error');
    return;
  }

  // ── Done: reload project list, switch to the demo, land on the Timeline. ──
  try {
    const { projectList } = await import('../soma.js');
    const { setState } = await import('../state.js');
    const projects = await projectList();
    setState({ projects: projects || [] });
    const { switchProject, navigateTo } = await import('../app.js');
    if (typeof switchProject === 'function') {
      await switchProject(target);
    }
    if (typeof navigateTo === 'function') navigateTo('timeline');
  } catch (e) {
    showToast(`demo: created, but could not auto-open - ${e}`, 'error');
    return;
  }

  showToast(
    'Demo project ready - explore the timeline, skills, sessions, goals, and evidence.',
    'success'
  );
}
