/**
 * crons.js - Crons board (v2, UI-SPEC §8a) + cron composer (v4, §8c item 1).
 *
 * Table from `cron list --json`: name, schedule (mono), action kind/target,
 * enabled toggle, next run (relative + absolute), last outcome from buffer.
 * Top-right "Run tick now" → somaStream(['tick']) into the shared console.
 *
 * "+ Add cron" section above the table: form (name, schedule, kind, target,
 * optional input) → live command preview → `cron add` via somaRaw →
 * verbatim toast → refresh.
 *
 * @module views/crons
 */

import { el, fmtTime, fmtTimeFull, helpButton } from '../render.js';
import { get, setState } from '../state.js';
import { cronList, skillList, somaRaw } from '../soma.js';
import { showToast } from './toast.js';
import { isRunning, startRun } from './console.js';
import { formModal, field } from './modal.js';

let _mounted = false;

/** @type {string[]} skill names for the target <select> */
let _skillNames = [];

/**
 * Mount the Crons board into #view-container.
 */
export async function mountCrons() {
  _mounted = true;
  _skillNames = [];
  renderShell();
  // Load skills list (for the target select) and cron list concurrently.
  const project = get('currentProject');
  const [, skills] = await Promise.allSettled([
    loadCrons(),
    project ? skillList(project).catch(() => []) : Promise.resolve([]),
  ]);
  _skillNames = ((skills.status === 'fulfilled' && skills.value) || []).map(s => s.name || s).filter(Boolean);
}

/**
 * Unmount.
 */
export function unmountCrons() {
  _mounted = false;
}

async function loadCrons() {
  const project = get('currentProject');
  if (!project) return;
  try {
    const crons = await cronList(project);
    setState({ crons: crons || [] });
    if (_mounted) renderTable();
  } catch (e) {
    showToast(`cron list: ${e}`, 'error');
    if (_mounted) renderTable();
  }
}

function renderShell() {
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  const header = el('div', { cls: 'section-header' });
  header.appendChild(el('h2', { cls: 'section-title', text: 'Crons' }));
  header.appendChild(helpButton('Crons', [
    'Crons are scheduled actions - skills, goals, or shell commands - that run automatically on a 5-field UTC cron schedule. Each run is policy-gated and journaled as a cron.run event.',
    'Ticks fire only when something calls soma tick. The recommended setup is the included launchagent (scripts/install-launchagent.sh), which calls soma tick on a regular interval.',
    'Add a schedule with the + Add cron form below, then enable it with the toggle. Run tick now forces an immediate tick so you can verify the cron works before its next scheduled time.',
  ]));

  const btns = el('div', { cls: 'view-toolbar', style: 'margin:0;gap:8px' });

  const tickBtn = el('button', { cls: 'btn btn-green', text: '▶ Run tick now' });
  tickBtn.addEventListener('click', () => handleTick(tickBtn));

  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => loadCrons());

  const newBtn = el('button', { cls: 'btn', text: '+ New cron' });
  newBtn.addEventListener('click', () => openNewCronModal());

  btns.appendChild(newBtn);
  btns.appendChild(tickBtn);
  btns.appendChild(refreshBtn);
  header.appendChild(btns);
  container.appendChild(header);

  container.appendChild(el('div', { id: 'crons-body' }));
}

// ── New-cron modal ───────────────────────────────────────────────────

/**
 * Quote a value for the command preview if it contains spaces or is empty.
 * Display-only - the real argv is passed unquoted to somaRaw.
 * @param {string} s
 * @returns {string}
 */
function q(s) {
  if (s === '' || /[\s"';]/.test(s)) return `"${s}"`;
  return s;
}

/**
 * Open the "+ New cron" modal.
 * Fields: name, schedule, kind (skill/goal/command), target, optional input.
 * Target is a <select> of skills when kind=skill and skills are known.
 * Runs: soma cron add <name> "<sched>" --kind K --target T [--input I]
 */
function openNewCronModal() {
  const project = get('currentProject');

  const nameInput = /** @type {HTMLInputElement} */ (el('input', { type: 'text', placeholder: 'my-daily-cron' }));
  const schedInput = /** @type {HTMLInputElement} */ (el('input', { type: 'text', placeholder: '0 3 * * *' }));

  const kindSelect = /** @type {HTMLSelectElement} */ (el('select'));
  for (const k of ['skill', 'goal', 'command']) {
    kindSelect.appendChild(el('option', { value: k, text: k }));
  }

  // Target field holds either a <select> (skills) or a free <input>.
  const targetField = el('div', { cls: 'wizard-field' });
  targetField.appendChild(el('label', { text: 'Target' }));

  /** @returns {string} the current target value */
  function targetValue() {
    const ctrl = /** @type {HTMLInputElement|HTMLSelectElement|null} */ (targetField.querySelector('.cron-target-input'));
    return ctrl ? ctrl.value.trim() : '';
  }

  /** Rebuild the target control for the current kind (preserving value). */
  function renderTargetInput() {
    const prev = targetValue();
    const existing = targetField.querySelector('.cron-target-input');
    if (existing) existing.remove();

    /** @type {HTMLInputElement|HTMLSelectElement} */
    let ctrl;
    if (kindSelect.value === 'skill' && _skillNames.length > 0) {
      ctrl = /** @type {HTMLSelectElement} */ (el('select', { cls: 'cron-target-input' }));
      ctrl.appendChild(el('option', { value: '', text: '- select skill -' }));
      for (const name of _skillNames) {
        const opt = el('option', { value: name, text: name });
        if (name === prev) opt.selected = true;
        ctrl.appendChild(opt);
      }
    } else {
      const ph = kindSelect.value === 'skill' ? 'skill-name' : kindSelect.value === 'goal' ? 'goal-id' : 'shell command';
      ctrl = /** @type {HTMLInputElement} */ (el('input', { type: 'text', cls: 'cron-target-input', placeholder: ph, value: prev }));
    }
    targetField.appendChild(ctrl);
  }
  renderTargetInput();

  const inputInput = /** @type {HTMLInputElement} */ (el('input', { type: 'text', placeholder: 'passed as --input' }));

  const modal = formModal({
    title: 'New cron',
    fields: [
      field('Name', nameInput),
      field('Schedule', schedInput, '5-field cron, UTC'),
      field('Action kind', kindSelect),
      targetField,
      field('Input (optional)', inputInput),
    ],
    commandPreview: () => {
      const name = nameInput.value.trim() || '<name>';
      const sched = schedInput.value.trim();
      const target = targetValue() || '<target>';
      const input = inputInput.value.trim();
      let cmd = `soma cron add ${q(name)} ${sched ? q(sched) : '"<schedule>"'} --kind ${kindSelect.value} --target ${q(target)}`;
      if (input) cmd += ` --input ${q(input)}`;
      return cmd;
    },
    confirmLabel: '+ Add cron',
    onConfirm: async () => {
      const name = nameInput.value.trim();
      const sched = schedInput.value.trim();
      const target = targetValue();
      const input = inputInput.value.trim();
      if (!name) { showToast('Name is required.', 'error'); return false; }
      if (!sched) { showToast('Schedule is required.', 'error'); return false; }
      if (!target) { showToast('Target is required.', 'error'); return false; }

      const args = ['cron', 'add', name, sched, '--kind', kindSelect.value, '--target', target];
      if (input) args.push('--input', input);

      const result = await somaRaw(args, project);
      const msg = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;
      showToast(msg, result.code === 0 ? 'success' : 'error');
      if (result.code !== 0) return false;

      await loadCrons();
      triggerPollAndVerify();
      return true;
    },
  });

  // When the kind changes, rebuild the target control and refresh the preview.
  kindSelect.addEventListener('change', () => {
    renderTargetInput();
    modal.refreshPreview();
  });
}

function renderTable() {
  const body = document.getElementById('crons-body');
  if (!body) return;
  body.innerHTML = '';

  const crons = get('crons') || [];

  if (crons.length === 0) {
    const empty = el('div', { cls: 'empty-state' });
    empty.appendChild(el('div', { text: 'Add a schedule - ticks fire via the launchagent (scripts/install-launchagent.sh).' }));
    const addBtn = el('button', { cls: 'btn empty-state-action', text: '+ Add a cron' });
    addBtn.addEventListener('click', () => openNewCronModal());
    empty.appendChild(addBtn);
    body.appendChild(empty);
    return;
  }

  const tableWrap = el('div', { cls: 'crons-table-wrap' });
  const table = el('table', { cls: 'crons-table' });

  // Header row
  const thead = el('thead');
  const tr = el('tr');
  for (const col of ['Name', 'Schedule', 'Action', 'Enabled', 'Next run', 'Last']) {
    tr.appendChild(el('th', { text: col }));
  }
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const cron of crons) {
    tbody.appendChild(renderCronRow(cron));
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  body.appendChild(tableWrap);

  // Dim note at bottom
  body.appendChild(el('div', {
    cls: 'crons-note dim',
    text: 'ticks fire only when something calls soma tick - see scripts/install-launchagent.sh',
  }));
}

/**
 * @param {object} cron - from cron list --json (has next_iso)
 * @returns {HTMLTableRowElement}
 */
function renderCronRow(cron) {
  const tr = el('tr', { cls: 'crons-row' });

  // Name
  tr.appendChild(el('td', {}, el('span', { cls: 'cron-name', text: cron.name || '?' })));

  // Schedule (mono)
  tr.appendChild(el('td', {}, el('code', { text: cron.schedule || '?' })));

  // Action kind / target
  const action = cron.action || {};
  const actionKind = action.kind || cron.kind || '';
  const actionTarget = action.target || cron.target || '';
  const actionCell = el('td', { cls: 'cron-action-cell' });
  if (actionKind) actionCell.appendChild(el('span', { cls: 'chip chip-gray', text: actionKind }));
  if (actionTarget) actionCell.appendChild(el('span', { cls: 'cron-target dim', text: actionTarget }));
  tr.appendChild(actionCell);

  // Enabled toggle
  const enabled = !!cron.enabled;
  const toggleTd = el('td', { cls: 'cron-toggle-cell' });
  const toggleBtn = el('button', {
    cls: `cron-toggle-btn ${enabled ? 'toggle-on' : 'toggle-off'}`,
    title: enabled ? 'Disable' : 'Enable',
    text: enabled ? '✓' : '✗',
  });
  toggleBtn.addEventListener('click', () => handleToggle(cron.name, toggleBtn));
  toggleTd.appendChild(toggleBtn);
  tr.appendChild(toggleTd);

  // Next run
  const nextCell = el('td', { cls: 'cron-next-cell' });
  if (cron.next_iso) {
    const rel = el('span', { text: fmtTime(cron.next_iso) });
    const abs = el('span', { cls: 'dim', style: 'font-size:10px;display:block', text: fmtTimeFull(cron.next_iso) });
    nextCell.appendChild(rel);
    nextCell.appendChild(abs);
  } else {
    nextCell.appendChild(el('span', { cls: 'dim', text: '-' }));
  }
  tr.appendChild(nextCell);

  // Last outcome from buffer
  const lastTd = el('td');
  const lastOutcome = getLastCronOutcome(cron.name || '');
  if (lastOutcome) {
    lastTd.appendChild(el('span', {
      cls: lastOutcome.ok ? 'green' : 'red',
      text: lastOutcome.ok ? 'ok' : 'failed',
    }));
    if (lastOutcome.ts) {
      lastTd.appendChild(el('span', { cls: 'dim', style: 'font-size:10px;display:block', text: fmtTime(lastOutcome.ts) }));
    }
  } else {
    lastTd.appendChild(el('span', { cls: 'dim', text: '-' }));
  }
  tr.appendChild(lastTd);

  return tr;
}

/**
 * Derive last cron outcome from the events buffer.
 * @param {string} cronName
 * @returns {{ok:boolean, ts:number|string|null}|null}
 */
function getLastCronOutcome(cronName) {
  const events = get('events') || [];
  for (const ev of events) {
    if (ev.kind !== 'cron.run') continue;
    const d = ev.data || ev;
    if ((d.name || d.cron) !== cronName) continue;
    return {
      ok: d.ok !== false,
      ts: d.ts || d.ms || ev.ts || ev.ms || null,
    };
  }
  return null;
}

async function handleToggle(cronName, btn) {
  if (!cronName) return;
  const project = get('currentProject');
  btn.disabled = true;
  try {
    const result = await somaRaw(['cron', 'toggle', cronName], project);
    if (result.code === 0) {
      await loadCrons();
    } else {
      showToast(result.stderr || `soma exited ${result.code}`, 'error');
      btn.disabled = false;
    }
  } catch (e) {
    showToast(String(e), 'error');
    btn.disabled = false;
  }
}

async function handleTick(tickBtn) {
  if (isRunning()) {
    showToast('a run is already in progress', 'error');
    return;
  }
  const project = get('currentProject');
  tickBtn.disabled = true;

  await startRun('tick', ['tick'], project, {
    onDone: (code) => {
      tickBtn.disabled = false;
      loadCrons();
      triggerPollAndVerify();
    },
  });
}

function triggerPollAndVerify() {
  import('../app.js').then(({ triggerPollAndVerify: tpv }) => {
    if (typeof tpv === 'function') tpv();
  }).catch(() => {});
}
