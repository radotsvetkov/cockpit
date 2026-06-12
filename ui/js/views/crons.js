/**
 * crons.js - Crons board + cron composer.
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

let _mounted = false;

/**
 * Add-cron form state.
 * @type {{ name:string, schedule:string, kind:string, target:string, input:string }}
 */
let _form = { name: '', schedule: '', kind: 'skill', target: '', input: '' };

/** @type {string[]} skill names for the target <select> */
let _skillNames = [];

/**
 * Mount the Crons board into #view-container.
 */
export async function mountCrons() {
  _mounted = true;
  _form = { name: '', schedule: '', kind: 'skill', target: '', input: '' };
  renderShell();
  // Load skills list (for the target select) and cron list concurrently.
  const project = get('currentProject');
  const [, skills] = await Promise.allSettled([
    loadCrons(),
    project ? skillList(project).catch(() => []) : Promise.resolve([]),
  ]);
  _skillNames = ((skills.status === 'fulfilled' && skills.value) || []).map(s => s.name || s).filter(Boolean);
  if (_mounted) renderAddForm();
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
    'Ticks fire only when something calls soma tick. The recommended setup is a launchd LaunchAgent (macOS) or a cron entry (Linux) that runs soma tick on a regular interval.',
    'Add a schedule with the + Add cron form below, then enable it with the toggle. Run tick now forces an immediate tick so you can verify the cron works before its next scheduled time.',
  ]));

  const btns = el('div', { cls: 'view-toolbar', style: 'margin:0;gap:8px' });

  const tickBtn = el('button', { cls: 'btn btn-green', text: '▶ Run tick now' });
  tickBtn.addEventListener('click', () => handleTick(tickBtn));

  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => loadCrons());

  btns.appendChild(tickBtn);
  btns.appendChild(refreshBtn);
  header.appendChild(btns);
  container.appendChild(header);

  // Add-cron form placeholder (populated after skills load)
  container.appendChild(el('div', { id: 'cron-add-form' }));

  container.appendChild(el('div', { id: 'crons-body' }));
}

// ── Add-cron form ────────────────────────────────────────────────────

function renderAddForm() {
  const formEl = document.getElementById('cron-add-form');
  if (!formEl) return;
  formEl.innerHTML = '';

  const section = el('div', { cls: 'cron-add-section' });

  // Collapsible details element
  const details = el('details', { cls: 'cron-add-details' });
  const summary = el('summary', { cls: 'cron-add-summary', text: '+ Add cron' });
  details.appendChild(summary);

  const body = el('div', { cls: 'cron-add-body' });

  // ── Name ──
  const nameField = el('div', { cls: 'wizard-field' });
  nameField.appendChild(el('label', { text: 'Name' }));
  const nameInput = el('input', { type: 'text', cls: 'cron-add-input', placeholder: 'my-daily-cron', value: _form.name });
  nameInput.addEventListener('input', () => { _form.name = nameInput.value.trim(); updatePreview(); });
  nameField.appendChild(nameInput);
  body.appendChild(nameField);

  // ── Schedule ──
  const schedField = el('div', { cls: 'wizard-field' });
  schedField.appendChild(el('label', { text: 'Schedule' }));
  const schedInput = el('input', { type: 'text', cls: 'cron-add-input', placeholder: '0 3 * * *', value: _form.schedule });
  schedInput.addEventListener('input', () => { _form.schedule = schedInput.value.trim(); updatePreview(); });
  const schedHint = el('div', { cls: 'field-hint dim', text: '5-field cron, UTC' });
  schedField.appendChild(schedInput);
  schedField.appendChild(schedHint);
  body.appendChild(schedField);

  // ── Action kind ──
  const kindField = el('div', { cls: 'wizard-field' });
  kindField.appendChild(el('label', { text: 'Action kind' }));
  const kindSelect = el('select', { cls: 'cron-add-input' });
  for (const k of ['skill', 'goal', 'command']) {
    const opt = el('option', { value: k, text: k });
    if (k === _form.kind) opt.selected = true;
    kindSelect.appendChild(opt);
  }

  // ── Target (rendered separately, depends on kind) ──
  const targetField = el('div', { cls: 'wizard-field', id: 'cron-target-field' });
  targetField.appendChild(el('label', { text: 'Target' }));

  const renderTargetInput = () => {
    // Remove existing input/select inside targetField (keep label)
    const existing = targetField.querySelector('.cron-target-input');
    if (existing) existing.remove();

    let targetInput;
    if (_form.kind === 'skill' && _skillNames.length > 0) {
      targetInput = el('select', { cls: 'cron-add-input cron-target-input' });
      // blank option
      const blank = el('option', { value: '', text: '- select skill -' });
      if (!_form.target) blank.selected = true;
      targetInput.appendChild(blank);
      for (const name of _skillNames) {
        const opt = el('option', { value: name, text: name });
        if (name === _form.target) opt.selected = true;
        targetInput.appendChild(opt);
      }
    } else {
      targetInput = el('input', { type: 'text', cls: 'cron-add-input cron-target-input', placeholder: _form.kind === 'skill' ? 'skill-name' : _form.kind === 'goal' ? 'goal-id' : 'shell command', value: _form.target });
    }
    targetInput.addEventListener('input', () => { _form.target = targetInput.value.trim(); updatePreview(); });
    targetInput.addEventListener('change', () => { _form.target = targetInput.value.trim(); updatePreview(); });
    targetField.appendChild(targetInput);
  };

  kindSelect.addEventListener('change', () => {
    _form.kind = kindSelect.value;
    _form.target = '';
    renderTargetInput();
    updatePreview();
  });
  kindField.appendChild(kindSelect);
  body.appendChild(kindField);

  renderTargetInput();
  body.appendChild(targetField);

  // ── Optional input ──
  const inputField = el('div', { cls: 'wizard-field' });
  inputField.appendChild(el('label', { text: 'Input (optional)' }));
  const inputInput = el('input', { type: 'text', cls: 'cron-add-input', placeholder: 'passed as --input', value: _form.input });
  inputInput.addEventListener('input', () => { _form.input = inputInput.value.trim(); updatePreview(); });
  inputField.appendChild(inputInput);
  body.appendChild(inputField);

  // ── Live command preview ──
  const previewEl = el('div', { cls: 'wizard-cmd-preview', id: 'cron-add-preview' });
  body.appendChild(previewEl);

  // ── Add button ──
  const addBtn = el('button', { cls: 'btn btn-green', text: '+ Add cron' });
  addBtn.addEventListener('click', () => handleAddCron(addBtn));
  body.appendChild(addBtn);

  details.appendChild(body);
  section.appendChild(details);
  formEl.appendChild(section);

  updatePreview();

  function updatePreview() {
    const el2 = document.getElementById('cron-add-preview');
    if (el2) el2.textContent = buildCronAddPreview();
  }
}

/**
 * Build the exact soma command string for the preview.
 * @returns {string}
 */
function buildCronAddPreview() {
  const { name, schedule, kind, target, input } = _form;
  const namePart     = name     || '<name>';
  const schedPart    = schedule ? `"${schedule}"` : '"<schedule>"';
  const targetPart   = target   || '<target>';
  const inputPart    = input    ? ` --input ${input}` : '';
  return `soma cron add ${namePart} ${schedPart} --kind ${kind} --target ${targetPart}${inputPart}`;
}

/**
 * Build the soma argv array for `cron add`.
 * @returns {string[]}
 */
function buildCronAddArgs() {
  const { name, schedule, kind, target, input } = _form;
  const args = ['cron', 'add', name, schedule, '--kind', kind, '--target', target];
  if (input) { args.push('--input', input); }
  return args;
}

async function handleAddCron(btn) {
  const { name, schedule, kind, target } = _form;
  if (!name)     { showToast('Name is required.', 'error'); return; }
  if (!schedule) { showToast('Schedule is required.', 'error'); return; }
  if (!target)   { showToast('Target is required.', 'error'); return; }

  const project = get('currentProject');
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '…';

  try {
    const args = buildCronAddArgs();
    const result = await somaRaw(args, project);
    const msg = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;
    showToast(msg, result.code === 0 ? 'success' : 'error');

    if (result.code === 0) {
      // Reset form and collapse details
      _form = { name: '', schedule: '', kind: 'skill', target: '', input: '' };
      const details = document.querySelector('.cron-add-details');
      if (details) details.open = false;
      await loadCrons();
      triggerPollAndVerify();
    }
  } catch (e) {
    showToast(String(e), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function renderTable() {
  const body = document.getElementById('crons-body');
  if (!body) return;
  body.innerHTML = '';

  const crons = get('crons') || [];

  if (crons.length === 0) {
    const empty = el('div', { cls: 'empty-state' });
    empty.appendChild(el('div', { text: 'Add a schedule - ticks fire via a launchd LaunchAgent or cron.' }));
    const addBtn = el('button', { cls: 'btn empty-state-action', text: '+ Add a cron' });
    addBtn.addEventListener('click', () => {
      const details = document.querySelector('.cron-add-details');
      if (details) { details.open = true; details.scrollIntoView({ behavior: 'smooth' }); }
    });
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
    text: 'ticks fire only when something calls soma tick - set up a launchd LaunchAgent or cron to run it',
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
