/**
 * soma.js - Tauri IPC wrappers.
 *
 * Rules:
 * - window.__TAURI__ is accessed LAZILY (inside each function), so this
 *   module can be imported under Node.js for syntax checking without
 *   throwing a ReferenceError.
 * - somaJson throws on non-zero exit (stderr as the error message, verbatim).
 * - All public functions are async.
 *
 * @module soma
 */

/**
 * @returns {Function} The Tauri core invoke function.
 */
function getInvoke() {
  return window.__TAURI__.core.invoke;
}

/**
 * Run a soma command and parse stdout as JSON.
 * Throws a string (verbatim stderr) on non-zero exit code.
 *
 * @param {string[]} args    - argv array (without the 'soma' binary itself)
 * @param {string|null} project - project root path, or null
 * @returns {Promise<any>} parsed JSON from stdout
 * @throws {string} verbatim stderr on non-zero exit
 */
export async function somaJson(args, project = null) {
  const invoke = getInvoke();
  const result = await invoke('run_soma', { args, project });
  if (result.code !== 0) {
    throw result.stderr || `soma exited ${result.code}`;
  }
  const text = result.stdout.trim();
  if (!text) return null;
  return JSON.parse(text);
}

/**
 * Run a soma command and return raw {code, stdout, stderr}.
 * Does NOT throw on non-zero - caller decides what to do.
 *
 * @param {string[]} args
 * @param {string|null} project
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
export async function somaRaw(args, project = null) {
  const invoke = getInvoke();
  return invoke('run_soma', { args, project });
}

/**
 * Parse NDJSON (newline-delimited JSON) from a string.
 * Lines that fail to parse are skipped with a console.warn.
 *
 * @param {string} text
 * @returns {any[]}
 */
export function parseNdjson(text) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      console.warn('somaJson: skipping unparseable NDJSON line:', t.slice(0, 80), e);
    }
  }
  return out;
}

/**
 * Tail the journal from a byte offset.
 * Returns {lines, offset, size, mtime}.
 * lines are raw JSONL strings (each parseable as a journal event).
 * mtime is the journal file's modification time (ms); it changes on in-place
 * edits even when size is unchanged, so consumers use it to detect tampering.
 *
 * @param {string} root   - project root path
 * @param {number} from   - byte offset from previous call (0 for initial load)
 * @returns {Promise<{lines:string[], offset:number, size:number, mtime:number}>}
 */
export async function tail(root, from) {
  const invoke = getInvoke();
  return invoke('tail_journal', { root, from });
}

/**
 * Read policy.json for a project.
 * Returns parsed JSON, or throws a string on error.
 *
 * @param {string} root - project root path
 * @returns {Promise<object>}
 */
export async function readPolicy(root) {
  const invoke = getInvoke();
  const text = await invoke('read_policy', { root });
  return JSON.parse(text);
}

/**
 * Convenience: `soma version --json`
 * @returns {Promise<{version:string, ui_api:number}>}
 */
export async function somaVersion() {
  return somaJson(['version', '--json'], null);
}

/**
 * Convenience: `soma project list --json`
 * @returns {Promise<Array<{name:string, root:string}>>}
 */
export async function projectList() {
  return somaJson(['project', 'list', '--json'], null);
}

/**
 * Convenience: `soma log verify --json`
 * @param {string} project - project root
 * @returns {Promise<{ok:boolean, events?:number, head?:string, events_checked?:number, broken_line?:number, reason?:string}>}
 */
export async function logVerify(project) {
  try {
    return await somaJson(['log', 'verify', '--json'], project);
  } catch (err) {
    // Non-zero exit when broken - parse the stdout we still have if possible
    // (runtime may exit 1 with valid JSON on broken chain)
    const invoke = getInvoke();
    const raw = await invoke('run_soma', { args: ['log', 'verify', '--json'], project });
    const text = (raw.stdout || '').trim();
    if (text) {
      try { return JSON.parse(text); } catch (_) { /* fall through */ }
    }
    throw err;
  }
}

/**
 * Convenience: `soma status --json`
 * @param {string} project
 * @returns {Promise<object>}
 */
export async function somaStatus(project) {
  return somaJson(['status', '--json'], project);
}

/**
 * Convenience: `soma skill list --json`
 * @param {string} project
 * @returns {Promise<Array>}
 */
export async function skillList(project) {
  return somaJson(['skill', 'list', '--json'], project);
}

/**
 * Convenience: `soma skill show <name> --json`
 * @param {string} name
 * @param {string} project
 * @returns {Promise<object>}
 */
export async function skillShow(name, project) {
  return somaJson(['skill', 'show', name, '--json'], project);
}

/**
 * Convenience: `soma proposals list --json`
 * @param {string} project
 * @returns {Promise<Array>}
 */
export async function proposalsList(project) {
  return somaJson(['proposals', 'list', '--json'], project);
}

/**
 * Convenience: `soma proposals list --all --json`
 * @param {string} project
 * @returns {Promise<Array>}
 */
export async function proposalsListAll(project) {
  return somaJson(['proposals', 'list', '--all', '--json'], project);
}

/**
 * Convenience: `soma proposals apply <id> --json`
 * @param {string} id
 * @param {string} project
 * @returns {Promise<object>}
 */
export async function proposalsApply(id, project) {
  return somaJson(['proposals', 'apply', id, '--json'], project);
}

/**
 * Convenience: `soma proposals dismiss <id> --json`
 * @param {string} id
 * @param {string} project
 * @returns {Promise<object>}
 */
export async function proposalsDismiss(id, project) {
  return somaJson(['proposals', 'dismiss', id, '--json'], project);
}

/**
 * Convenience: `soma model probe --json`
 * @param {string|null} project
 * @returns {Promise<Array<{provider:string, ok:boolean, note:string}>>}
 */
export async function modelProbe(project) {
  return somaJson(['model', 'probe', '--json'], project);
}

/**
 * Convenience: `soma cache stats --json`
 * @param {string} project
 * @returns {Promise<{entries:number, bytes:number, max_bytes:number, hits_total:number}>}
 */
export async function cacheStats(project) {
  return somaJson(['cache', 'stats', '--json'], project);
}

/**
 * Convenience: `soma preset apply <preset>` - emits human text, not JSON
 * (preset apply is outside the --json contract), so this returns the raw
 * {code, stdout, stderr} for the caller to render verbatim.
 * @param {string} preset
 * @param {string} project
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
export async function presetApply(preset, project) {
  return somaRaw(['preset', 'apply', preset], project);
}

// ── v2 additions ─────────────────────────────────────────────────

/**
 * Convenience: `soma goal list --json`
 * @param {string} project
 * @returns {Promise<Array>}
 */
export async function goalList(project) {
  return somaJson(['goal', 'list', '--json'], project);
}

/**
 * Convenience: `soma goal show <id> --json`
 * @param {string} id
 * @param {string} project
 * @returns {Promise<object>}
 */
export async function goalShow(id, project) {
  return somaJson(['goal', 'show', id, '--json'], project);
}

/**
 * Convenience: `soma cron list --json`
 * @param {string} project
 * @returns {Promise<Array>}
 */
export async function cronList(project) {
  return somaJson(['cron', 'list', '--json'], project);
}

/**
 * List the project's exports/ directory.
 * Returns an array of {name, bytes, mtime, dir}.
 * Lazy __TAURI__ access - safe to import in Node.
 *
 * @param {string} root - project root path
 * @returns {Promise<Array<{name:string, bytes:number, mtime:number, dir:boolean}>>}
 */
export async function listExports(root) {
  const invoke = window.__TAURI__.core.invoke;
  return invoke('list_exports', { root });
}

/**
 * Stream a soma command with live line output.
 *
 * Generates a runId, subscribes to `soma-stream` events filtered to that id,
 * calls handlers.onLine(stream, line) for each line ('out'|'err'), and
 * resolves with the exit code on the done event. The Tauri listener is
 * unsubscribed automatically.
 *
 * Lazy __TAURI__ access - safe to import in Node (won't run there anyway).
 *
 * @param {string[]} args        - soma argv (without the binary name)
 * @param {string|null} project  - project root path, or null
 * @param {{ onLine: (stream:'out'|'err', line:string) => void }} handlers
 * @returns {Promise<number>} exit code
 */
export async function somaStream(args, project, handlers) {
  const tauri = window.__TAURI__;
  const invoke = tauri.core.invoke;
  const listen = tauri.event.listen;

  // Generate a unique run id so concurrent streams don't collide.
  const runId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `run-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    let unlisten = null;
    let settled = false;

    // Subscribe before invoking to avoid missing early lines.
    listen('soma-stream', (event) => {
      /** @type {{run_id?:string, done?:boolean, code?:number, line?:string, stream?:'out'|'err'}} */
      const payload = event.payload;
      if (!payload || payload.run_id !== runId) return;

      if (payload.done) {
        if (unlisten) unlisten();
        if (!settled) {
          settled = true;
          resolve(payload.code ?? -1);
        }
        return;
      }

      if (payload.line !== undefined && handlers && typeof handlers.onLine === 'function') {
        handlers.onLine(payload.stream || 'out', payload.line);
      }
    }).then((unlistenFn) => {
      unlisten = unlistenFn;
      // Now invoke the streaming command.
      invoke('stream_soma', { runId, args, project }).catch((err) => {
        if (unlisten) unlisten();
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    }).catch(reject);
  });
}

/**
 * v3: list akmon sessions captured in this project (.akmon/evidence +
 * .akmon/audit). Read-only host scan; evidence JSON returned verbatim.
 * @param {string} root - project root
 * @returns {Promise<Array<{sid:string, mtime:number, evidence:string|null, audit_bytes:number}>>}
 */
export async function listAkmonSessions(root) {
  const invoke = getInvoke();
  return invoke('list_akmon_sessions', { root });
}

/**
 * @typedef {Object} EcoTool
 * @property {string} name    - tool name (akmon, agef-verify, memora, memora-cli)
 * @property {string} path    - detected binary path (env/PATH/default)
 * @property {boolean} exists  - whether the binary is present + executable
 * @property {string} version  - `--version` output, or '' when not found
 */

/**
 * Probe sibling HYT tools (akmon, agef-verify, memora, memora-cli).
 * Read-only presence + version; never reads foreign configs.
 * @returns {Promise<EcoTool[]>}
 */
export async function ecosystemInfo() {
  const invoke = getInvoke();
  return invoke('ecosystem_info');
}
