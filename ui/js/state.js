/**
 * state.js - Central store for soma cockpit.
 *
 * Simple pub/sub store. No framework. All mutation goes through setState().
 * Views subscribe to specific keys.
 *
 * @module state
 */

/**
 * @typedef {Object} AppState
 * @property {Array<{name:string, root:string}>} projects
 * @property {string|null} currentProject - root path of selected project
 * @property {string|null} currentProjectName
 * @property {object[]} events          - parsed journal events (newest first)
 * @property {number}   journalOffset   - byte offset for next tail call
 * @property {number}   journalSize     - last known file size (truncation detect)
 * @property {object|null} verifyResult - last log verify result
 * @property {boolean}  verifying       - true while verify is running
 * @property {object|null} status       - last soma status --json result
 * @property {object[]} skills          - last skill list result
 * @property {object[]} proposals       - last proposals list (open only)
 * @property {object[]} proposalsAll    - last proposals list --all
 * @property {object|null} cacheStats   - last cache stats result
 * @property {object[]} modelProbe      - last model probe result
 * @property {object[]} goals           - last goal list result
 * @property {object[]} crons           - last cron list result
 * @property {boolean}  followMode      - whether timeline follow is active
 * @property {string}   activeView      - 'timeline'|'skills'|'proposals'|'policy'|'goals'|'crons'|'exports'
 * @property {object|null} inspectorEvent - event currently shown in inspector
 * @property {string}   filterArea      - area chip filter ('' = all)
 * @property {string}   filterText      - free-text filter
 * @property {string}   filterKind      - kind dropdown filter
 * @property {number}   renderOffset    - how many events are rendered (pagination)
 */

/** @type {AppState} */
const _state = {
  projects: [],
  currentProject: null,
  currentProjectName: null,
  events: [],
  journalOffset: 0,
  journalSize: 0,
  verifyResult: null,
  verifying: false,
  status: null,
  skills: [],
  proposals: [],
  proposalsAll: [],
  cacheStats: null,
  modelProbe: [],
  goals: [],
  crons: [],
  followMode: true,
  activeView: 'timeline',
  inspectorEvent: null,
  filterArea: '',
  filterText: '',
  filterKind: '',
  renderOffset: 500,
};

/** @type {Map<string, Set<Function>>} */
const _subs = new Map();

/**
 * Get a shallow copy of the current state.
 * @returns {AppState}
 */
export function getState() {
  return { ..._state };
}

/**
 * Get a single state key.
 * @template {keyof AppState} K
 * @param {K} key
 * @returns {AppState[K]}
 */
export function get(key) {
  return _state[key];
}

/**
 * Update one or more state keys and notify subscribers.
 * @param {Partial<AppState>} patch
 */
export function setState(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (_state[k] !== v) {
      _state[k] = v;
      changed.push(k);
    }
  }
  for (const key of changed) {
    const subs = _subs.get(key);
    if (subs) {
      for (const fn of subs) {
        try { fn(_state[key], _state); } catch (e) { console.error('state sub error:', e); }
      }
    }
  }
  // Always notify wildcard subscribers
  const all = _subs.get('*');
  if (all && changed.length > 0) {
    for (const fn of all) {
      try { fn(changed, _state); } catch (e) { console.error('state wildcard sub error:', e); }
    }
  }
}

/**
 * Subscribe to state changes for a specific key, or '*' for any change.
 * @param {string} key
 * @param {Function} fn - called with (newValue, fullState) or (changedKeys[], fullState) for '*'
 * @returns {Function} unsubscribe
 */
export function subscribe(key, fn) {
  if (!_subs.has(key)) _subs.set(key, new Set());
  _subs.get(key).add(fn);
  return () => _subs.get(key).delete(fn);
}

/**
 * Prepend new events to the events buffer (from tail), keeping newest-first
 * ordering and honoring the 1 MiB spirit (cap at ~3000 events as a
 * reasonable proxy - the tail call itself is already capped at 1 MiB).
 *
 * @param {object[]} newEvents - parsed events, in file order (oldest first)
 */
export function prependEvents(newEvents) {
  if (!newEvents.length) return;
  // newEvents arrive in file order (oldest first); prepend reversed so our
  // array stays newest-first.
  const combined = [...newEvents.slice().reverse(), ..._state.events];
  // Cap at 3000 to bound memory
  _state.events = combined.slice(0, 3000);
  const subs = _subs.get('events');
  if (subs) for (const fn of subs) { try { fn(_state.events, _state); } catch (e) { console.error(e); } }
  const all = _subs.get('*');
  if (all) for (const fn of all) { try { fn(['events'], _state); } catch (e) { console.error(e); } }
}

/**
 * Replace the events buffer entirely (e.g. after truncation reset).
 * @param {object[]} events - parsed events, newest-first
 */
export function setEvents(events) {
  setState({ events: events.slice(0, 3000) });
}

/**
 * Persist last selected project to localStorage.
 * @param {string} root
 */
export function persistProject(root) {
  try { localStorage.setItem('soma_last_project', root); } catch (_) { /* ignore */ }
}

/**
 * Retrieve last selected project from localStorage.
 * @returns {string|null}
 */
export function getPersistedProject() {
  try { return localStorage.getItem('soma_last_project'); } catch (_) { return null; }
}
