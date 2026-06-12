/**
 * exports.js - Exports browser (v2, UI-SPEC §8a).
 *
 * Table from listExports(root): name, size (human), mtime (relative).
 * Per-row actions: "Verify" for *.soma-export dirs; dim hint for .akmon files.
 * Header buttons: evidence-pipeline, export bundle, export OTLP.
 * Refresh + poll/verify after each run completes.
 *
 * @module views/exports
 */

import { el, fmtTime, fmtBytes, helpButton } from '../render.js';
import { get } from '../state.js';
import { listExports } from '../soma.js';
import { showToast } from './toast.js';
import { isRunning, startRun } from './console.js';

let _mounted = false;

/**
 * Mount the Exports browser into #view-container.
 */
export async function mountExports() {
  _mounted = true;
  renderShell();
  await loadExports();
}

/**
 * Unmount.
 */
export function unmountExports() {
  _mounted = false;
}

async function loadExports() {
  const project = get('currentProject');
  if (!project) return;
  try {
    const entries = await listExports(project);
    if (_mounted) renderTable(entries || []);
  } catch (e) {
    showToast(`list exports: ${e}`, 'error');
    if (_mounted) renderTable([]);
  }
}

function renderShell() {
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  // Header with action buttons
  const header = el('div', { cls: 'section-header' });
  header.appendChild(el('h2', { cls: 'section-title', text: 'Evidence' }));
  header.appendChild(helpButton('Evidence', [
    'Evidence is signed, exportable proof of what ran: journal events → OTLP trace → AGEF bundle → ed25519 signature. The bundle is self-contained - agef-verify checks it completely offline.',
    'The Evidence pipeline (signed) runs the evidence-pipeline skill, which chains all three steps and signs the result. That is the artifact you hand an auditor or client.',
    'Use the Verify button on a .soma-export or .akmon file to re-verify its chain integrity via the soma binary - the same code an auditor runs.',
  ]));

  const btns = el('div', { cls: 'view-toolbar', style: 'margin:0;gap:8px' });

  const pipelineBtn = el('button', { cls: 'btn btn-green', id: 'evidence-pipeline-btn', text: '⬆ Evidence pipeline (signed)' });
  pipelineBtn.addEventListener('click', () => handleStream('skill run evidence-pipeline', ['skill', 'run', 'evidence-pipeline'], pipelineBtn));

  const exportBtn = el('button', { cls: 'btn', text: '⬡ Export bundle' });
  exportBtn.addEventListener('click', () => handleStream('export', ['export'], exportBtn));

  const otlpBtn = el('button', { cls: 'btn', text: '⬡ Export OTLP' });
  otlpBtn.addEventListener('click', () => handleStream('export otlp', ['export', 'otlp'], otlpBtn));

  const refreshBtn = el('button', { cls: 'btn', text: '↻ Refresh' });
  refreshBtn.addEventListener('click', () => loadExports());

  btns.appendChild(pipelineBtn);
  btns.appendChild(exportBtn);
  btns.appendChild(otlpBtn);
  btns.appendChild(refreshBtn);
  header.appendChild(btns);
  container.appendChild(header);

  container.appendChild(el('div', { id: 'exports-body' }));
}

function renderTable(entries) {
  const body = document.getElementById('exports-body');
  if (!body) return;
  body.innerHTML = '';

  if (entries.length === 0) {
    const empty = el('div', { cls: 'empty-state' });
    empty.appendChild(el('div', { text: 'Run the signed evidence pipeline to create an exportable proof bundle.' }));
    const pipelineBtn = el('button', { cls: 'btn empty-state-action', text: '⬆ Run the signed evidence pipeline' });
    pipelineBtn.addEventListener('click', () => {
      const btn = document.getElementById('evidence-pipeline-btn');
      if (btn) btn.click();
    });
    empty.appendChild(pipelineBtn);
    body.appendChild(empty);
    return;
  }

  const tableWrap = el('div', { cls: 'exports-table-wrap' });
  const table = el('table', { cls: 'exports-table' });

  const thead = el('thead');
  const tr = el('tr');
  for (const col of ['Name', 'Size', 'Modified', 'Actions']) {
    tr.appendChild(el('th', { text: col }));
  }
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    tbody.appendChild(renderExportRow(entry));
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  body.appendChild(tableWrap);
}

/**
 * @param {{ name:string, bytes:number, mtime:number, dir:boolean }} entry
 * @returns {HTMLTableRowElement}
 */
function renderExportRow(entry) {
  const tr = el('tr');

  // Name (with type indicator)
  const nameCell = el('td');
  nameCell.appendChild(el('span', { cls: 'export-name mono', text: entry.name }));
  if (entry.dir) nameCell.appendChild(el('span', { cls: 'chip chip-gray', style: 'margin-left:6px', text: 'dir' }));
  tr.appendChild(nameCell);

  // Size
  tr.appendChild(el('td', { cls: 'dim', text: fmtBytes(entry.bytes) }));

  // mtime relative
  tr.appendChild(el('td', { cls: 'dim', text: fmtTime(entry.mtime) }));

  // Actions
  const actionsCell = el('td', { cls: 'export-actions-cell' });

  if (entry.dir && entry.name.endsWith('.soma-export')) {
    // Verify button for soma-export dirs
    const verifyBtn = el('button', { cls: 'btn btn-sm', text: 'Verify' });
    verifyBtn.addEventListener('click', () => {
      handleStream(
        `export verify exports/${entry.name}`,
        ['export', 'verify', `exports/${entry.name}`],
        verifyBtn
      );
    });
    actionsCell.appendChild(verifyBtn);
  } else if (entry.name.endsWith('.akmon')) {
    // Real action: the agef-verify SKILL (policy-gated + journaled),
    // streamed into the console like every other run.
    const vBtn = el('button', { cls: 'btn btn-sm', text: 'Verify' });
    vBtn.addEventListener('click', () => handleStream(`verify ${entry.name}`, ['skill', 'run', 'agef-verify', `exports/${entry.name}`], vBtn));
    actionsCell.appendChild(vBtn);
  }

  tr.appendChild(actionsCell);
  return tr;
}

async function handleStream(label, args, btn) {
  if (isRunning()) {
    showToast('a run is already in progress', 'error');
    return;
  }
  const project = get('currentProject');
  btn.disabled = true;

  await startRun(label, args, project, {
    onDone: (code) => {
      btn.disabled = false;
      loadExports();
      triggerPollAndVerify();
    },
  });
}

function triggerPollAndVerify() {
  import('../app.js').then(({ triggerPollAndVerify: tpv }) => {
    if (typeof tpv === 'function') tpv();
  }).catch(() => {});
}
