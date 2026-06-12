/**
 * console.js - Live streaming run console panel (v2).
 *
 * A single collapsible bottom panel reused by all run buttons across
 * Goals, Crons, Exports, and Skills views. Only one run may be active
 * at a time - starting a second run while one is active is blocked with
 * a toast.
 *
 * Public API:
 *   mountConsole()    - call once, inserts the panel into #console-region
 *   openConsole()     - expand the panel
 *   closeConsole()    - collapse the panel
 *   isRunning()       - returns true if a run is in progress
 *   startRun(label, args, project, handlers?) → Promise<number>
 *     Streams a soma command; resolves with exit code when done.
 *     handlers.onDone(code) is called after the run finishes if provided.
 *
 * @module views/console
 */

import { el } from '../render.js';
import { showToast } from './toast.js';
import { somaStream } from '../soma.js';

let _running = false;
let _panel = null;
let _header = null;
let _status = null;
let _body = null;
let _cmdLabel = null;

/**
 * Mount the console panel into #console-region (injected into the page by index.html).
 */
export function mountConsole() {
  const region = document.getElementById('console-region');
  if (!region || document.getElementById('run-console')) return;

  _panel = el('div', { id: 'run-console', cls: 'run-console collapsed' });

  // Header bar
  _header = el('div', { cls: 'console-header' });

  const left = el('div', { cls: 'console-header-left' });
  _cmdLabel = el('span', { cls: 'console-cmd mono dim', text: '' });
  _status = el('span', { cls: 'console-status-pill pill-idle', text: 'idle' });
  left.appendChild(_cmdLabel);
  left.appendChild(_status);

  const right = el('div', { cls: 'console-header-right' });
  const clearBtn = el('button', { cls: 'btn-sm', text: 'Clear' });
  clearBtn.addEventListener('click', () => clearConsole());
  const closeBtn = el('button', { cls: 'btn-sm', text: 'Close' });
  closeBtn.addEventListener('click', () => closeConsole());

  right.appendChild(clearBtn);
  right.appendChild(closeBtn);
  _header.appendChild(left);
  _header.appendChild(right);

  // Toggle collapse on header click (but not on buttons)
  _header.addEventListener('click', (e) => {
    if (/** @type {HTMLElement} */ (e.target).tagName === 'BUTTON') return;
    _panel.classList.toggle('collapsed');
  });

  // Log body
  _body = el('div', { cls: 'console-body' });

  _panel.appendChild(_header);
  _panel.appendChild(_body);
  region.appendChild(_panel);
}

/**
 * @returns {boolean} true if a run is currently in progress
 */
export function isRunning() {
  return _running;
}

/**
 * Expand the console panel.
 */
export function openConsole() {
  if (_panel) _panel.classList.remove('collapsed');
}

/**
 * Collapse the console panel.
 */
export function closeConsole() {
  if (_panel) _panel.classList.add('collapsed');
}

/**
 * Clear the log body.
 */
export function clearConsole() {
  if (_body) _body.innerHTML = '';
}

/**
 * Start a streaming run.
 * Blocks if another run is already active (shows a toast instead).
 *
 * @param {string} label    - human description of the command (displayed in header)
 * @param {string[]} args   - soma argv
 * @param {string|null} project
 * @param {{ onDone?: (code:number) => void }} [opts]
 * @returns {Promise<number>} exit code, or -1 if blocked
 */
export async function startRun(label, args, project, opts = {}) {
  if (_running) {
    showToast('a run is already in progress', 'error');
    return -1;
  }

  _running = true;
  openConsole();
  clearConsole();

  if (_cmdLabel) _cmdLabel.textContent = `soma ${args.join(' ')}`;
  setStatus('running', null);

  let code = -1;
  try {
    code = await somaStream(args, project, {
      onLine: (stream, line) => appendLine(stream, line),
    });
  } catch (err) {
    appendLine('err', String(err));
    code = -1;
  }

  _running = false;
  setStatus('done', code);

  if (opts && typeof opts.onDone === 'function') {
    try { opts.onDone(code); } catch (_) {}
  }

  return code;
}

// ── Private helpers ──────────────────────────────────────────────

function setStatus(phase, code) {
  if (!_status) return;
  if (phase === 'running') {
    _status.className = 'console-status-pill pill-running';
    _status.textContent = 'running';
  } else if (phase === 'done') {
    if (code === 0) {
      _status.className = 'console-status-pill pill-ok';
      _status.textContent = 'exit 0';
    } else {
      _status.className = 'console-status-pill pill-err';
      _status.textContent = `exit ${code}`;
    }
  } else {
    _status.className = 'console-status-pill pill-idle';
    _status.textContent = 'idle';
  }
}

function appendLine(stream, line) {
  if (!_body) return;
  const row = el('div', {
    cls: `console-line${stream === 'err' ? ' console-err' : ''}`,
    text: line,
  });
  _body.appendChild(row);
  // Auto-scroll to bottom
  _body.scrollTop = _body.scrollHeight;
}
