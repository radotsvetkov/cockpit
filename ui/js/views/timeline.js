/**
 * timeline.js - Reverse-chronological journal feed (U3).
 *
 * Poll loop, filter chips, kind filter, free-text filter, load-older
 * pagination (500 rows per page), click-to-inspector.
 *
 * @module views/timeline
 */

import { el, kindChip, kindArea, allAreas, fmtTime, eventSummary, helpButton } from '../render.js';
import { get, setState, subscribe, prependEvents, setEvents, getState } from '../state.js';
import { tail } from '../soma.js';
import { openInspector } from './inspector.js';
import { showToast } from './toast.js';
import { runVerify } from '../app.js';

const PAGE_SIZE = 500;

let _pollTimer = null;
let _verifyDebounce = null;
let _mounted = false;

/**
 * Mount the timeline view into #view-container.
 */
export function mountTimeline() {
  _mounted = true;
  renderView();

  // Subscribe to events changes to re-render the list
  subscribe('events',      () => { if (_mounted) renderList(); });
  subscribe('filterArea',  () => { if (_mounted) renderList(); });
  subscribe('filterText',  () => { if (_mounted) renderList(); });
  subscribe('filterKind',  () => { if (_mounted) renderList(); });
  subscribe('renderOffset',() => { if (_mounted) renderList(); });
  subscribe('followMode',  () => { if (_mounted) { updateFollowBtn(); scheduleOrStopPoll(); } });
  subscribe('inspectorEvent', () => { if (_mounted) highlightSelected(); });

  scheduleOrStopPoll();
}

/**
 * Unmount (called when switching away).
 */
export function unmountTimeline() {
  _mounted = false;
  stopPoll();
}

// ── Poll loop ────────────────────────────────────────────────────

function scheduleOrStopPoll() {
  stopPoll();
  if (get('followMode')) startPoll();
}

function startPoll() {
  stopPoll();
  _pollTimer = setInterval(poll, 1000);
}

function stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

let _lastMtime = 0;

async function poll() {
  const project = get('currentProject');
  if (!project) return;

  try {
    const offset = get('journalOffset');
    const result = await tail(project, offset);

    // mtime changes on in-place edits too (same size) - that's tampering,
    // so it must re-verify even when no new lines arrive.
    const mtimeChanged = typeof result.mtime === 'number' && result.mtime !== _lastMtime;
    if (typeof result.mtime === 'number') _lastMtime = result.mtime;

    // Truncation detection
    if (result.size < offset) {
      // File was truncated - reset from 0 (and re-verify: truncation is tamper)
      setState({ journalOffset: 0, journalSize: result.size });
      const fresh = await tail(project, 0);
      const parsed = fresh.lines.map(safeParseEvent).filter(Boolean);
      setEvents([...parsed].reverse());
      setState({ journalOffset: fresh.offset, journalSize: fresh.size });
      scheduleVerify();
    } else {
      if (result.lines.length > 0) {
        const parsed = result.lines.map(safeParseEvent).filter(Boolean);
        prependEvents(parsed);
        setState({ journalOffset: result.offset, journalSize: result.size });
      } else {
        setState({ journalSize: result.size });
      }
      // Debounce verify after new events OR any file modification
      if (result.lines.length > 0 || mtimeChanged) scheduleVerify();
    }
  } catch (e) {
    console.warn('timeline poll error:', e);
    // Don't toast on every poll failure - just log
  }
}

function scheduleVerify() {
  clearTimeout(_verifyDebounce);
  _verifyDebounce = setTimeout(() => {
    runVerify().catch(e => console.warn('verify error:', e));
  }, 1200);
}

// ── Initial load ────────────────────────────────────────────────

/**
 * Load the journal from offset 0 (initial mount or project switch).
 * @param {string} project - project root
 */
export async function loadJournal(project) {
  try {
    const result = await tail(project, 0);
    if (typeof result.mtime === 'number') _lastMtime = result.mtime;
    const parsed = result.lines.map(safeParseEvent).filter(Boolean);
    // File is newest-last; reverse so we get newest-first
    setEvents([...parsed].reverse());
    setState({ journalOffset: result.offset, journalSize: result.size, renderOffset: PAGE_SIZE });
    scheduleVerify();
  } catch (e) {
    showToast(`Failed to load journal: ${e}`, 'error');
  }
}

// ── View render ─────────────────────────────────────────────────

function renderView() {
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '';

  // Header row with title + help
  const titleRow = el('div', { cls: 'section-header' });
  titleRow.appendChild(el('h2', { cls: 'section-title', text: 'Timeline' }));
  titleRow.appendChild(helpButton('Timeline', [
    'The Timeline is an append-only hash chain of every action soma has taken. Each entry is hashed over the previous one - like git history - so editing even one byte turns the ⛓ badge red at the exact line.',
    'Click any row to open the Why panel: it shows the full event JSON and, for model.route events, the factor bars that explain why that tier and model were chosen.',
    'Use the area chips and text filter to narrow the feed. Enable Follow to tail new events live. The full history is always available via soma log or the Evidence export.',
  ]));
  container.appendChild(titleRow);

  // Toolbar
  const toolbar = el('div', { cls: 'timeline-toolbar' });

  // Area filter chips
  const chipsWrap = el('div', { cls: 'filter-chips' });
  const allChip = el('button', { cls: `filter-chip${!get('filterArea') ? ' active' : ''}`, text: 'All' });
  allChip.addEventListener('click', () => setState({ filterArea: '', renderOffset: PAGE_SIZE }));
  chipsWrap.appendChild(allChip);

  for (const area of allAreas()) {
    const chip = el('button', {
      cls: `filter-chip${get('filterArea') === area.area ? ' active' : ''}`,
      text: area.label,
    });
    chip.addEventListener('click', () => setState({ filterArea: area.area, renderOffset: PAGE_SIZE }));
    chipsWrap.appendChild(chip);
  }
  toolbar.appendChild(chipsWrap);

  // Kind dropdown
  const kindSel = el('select', { cls: 'filter-select', 'aria-label': 'Filter by kind' });
  kindSel.appendChild(el('option', { value: '', text: 'All kinds' }));
  const allKinds = getAllKinds();
  for (const k of allKinds) kindSel.appendChild(el('option', { value: k, text: k }));
  kindSel.value = get('filterKind');
  kindSel.addEventListener('change', () => setState({ filterKind: kindSel.value, renderOffset: PAGE_SIZE }));
  toolbar.appendChild(kindSel);

  // Text filter
  const textInput = el('input', { type: 'text', cls: 'filter-text', placeholder: 'Filter text…', value: get('filterText'), 'aria-label': 'Filter by text' });
  textInput.addEventListener('input', () => setState({ filterText: textInput.value, renderOffset: PAGE_SIZE }));
  toolbar.appendChild(textInput);

  // Follow toggle
  const followWrap = el('label', { cls: 'follow-toggle', title: 'Auto-follow new events' });
  const followCheck = el('input', { type: 'checkbox' });
  followCheck.checked = get('followMode');
  followCheck.id = 'follow-toggle';
  followCheck.addEventListener('change', () => setState({ followMode: followCheck.checked }));
  followWrap.appendChild(followCheck);
  followWrap.appendChild(document.createTextNode(' Follow'));
  toolbar.appendChild(followWrap);

  container.appendChild(toolbar);

  // List container (will be populated by renderList)
  const listWrap = el('div', { cls: 'timeline-list', id: 'timeline-list' });
  container.appendChild(listWrap);

  // Footer note
  container.appendChild(el('div', { cls: 'timeline-footer-note', text: 'showing the most recent 1 MiB of the journal; full history via soma log / export' }));

  renderList();
}

function renderList() {
  const listEl = document.getElementById('timeline-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const filtered = filterEvents();
  const renderCount = get('renderOffset') || PAGE_SIZE;
  const visible = filtered.slice(0, renderCount);
  const hasMore = filtered.length > renderCount;

  // Load-older button
  if (hasMore) {
    const btn = el('button', { cls: 'load-older-btn', text: `Load older (${filtered.length - renderCount} more filtered)` });
    btn.addEventListener('click', () => setState({ renderOffset: renderCount + PAGE_SIZE }));
    listEl.appendChild(btn);
  }

  if (visible.length === 0) {
    listEl.appendChild(el('div', { cls: 'empty-state', text: 'No events match the current filter.' }));
    return;
  }

  for (const ev of visible) {
    listEl.appendChild(renderEventRow(ev));
  }
}

/**
 * Render a single event row.
 * @param {object} ev
 * @returns {HTMLElement}
 */
function renderEventRow(ev) {
  const kind = ev.kind || '?';
  const ts   = ev.t || ev.ts;
  const evd = ev.data || ev;
  const isDeny = kind === 'policy.decision' &&
    ((evd.allowed !== undefined) ? evd.allowed : evd.allow) === false;
  const inspectorEv = get('inspectorEvent');
  const isSelected = inspectorEv && (
    (ev.id && inspectorEv.id && ev.id === inspectorEv.id) ||
    (ev.hash && inspectorEv.hash && ev.hash === inspectorEv.hash)
  );

  const row = el('div', {
    cls: `event-row${isDeny ? ' deny' : ''}${isSelected ? ' selected' : ''}`,
    'data-event-id': ev.id || ev.hash || '',
    title: eventSummary(ev),
  });

  row.appendChild(el('span', { cls: 'event-time', text: fmtTime(ts) }));
  const kindWrap = el('span', { cls: 'event-kind-wrap' });
  kindWrap.appendChild(kindChip(kind));
  row.appendChild(kindWrap);
  row.appendChild(el('span', { cls: 'event-summary', text: eventSummary(ev) }));

  row.addEventListener('click', () => openInspector(ev));
  return row;
}

function highlightSelected() {
  const rows = document.querySelectorAll('.event-row');
  const inspectorEv = get('inspectorEvent');
  for (const row of rows) {
    const id = row.getAttribute('data-event-id');
    if (!id) { row.classList.remove('selected'); continue; }
    const match = inspectorEv && (
      (inspectorEv.id   && String(inspectorEv.id)   === id) ||
      (inspectorEv.hash && String(inspectorEv.hash) === id)
    );
    row.classList.toggle('selected', !!match);
  }
}

function updateFollowBtn() {
  const check = document.getElementById('follow-toggle');
  if (check) check.checked = get('followMode');
}

// ── Filtering ────────────────────────────────────────────────────

function filterEvents() {
  const events    = get('events');
  const area      = get('filterArea');
  const text      = (get('filterText') || '').toLowerCase();
  const kindF     = get('filterKind');

  return events.filter(ev => {
    if (area) {
      const info = kindArea(ev.kind || '');
      if (info.area !== area) return false;
    }
    if (kindF && ev.kind !== kindF) return false;
    if (text) {
      const haystack = (ev.kind || '') + ' ' + eventSummary(ev) + ' ' + JSON.stringify(ev);
      if (!haystack.toLowerCase().includes(text)) return false;
    }
    return true;
  });
}

function getAllKinds() {
  const events = get('events');
  const seen = new Set();
  for (const ev of events) {
    if (ev.kind) seen.add(ev.kind);
  }
  return [...seen].sort();
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Safely parse a JSONL line into an event object.
 * Returns null on parse failure (defensive; never crash on bad data).
 * @param {string} line
 * @returns {object|null}
 */
function safeParseEvent(line) {
  try {
    const ev = JSON.parse(line);
    if (typeof ev !== 'object' || ev === null) return null;
    return ev;
  } catch (_) {
    return null;
  }
}
