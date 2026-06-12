// soma cockpit - Tauri host.
//
// Trust model: this process is a *viewer/remote*. The soma
// binary is the enforcer - every mutation the webview requests goes through
// it, gets policy-gated there, and is journaled there. The host's only
// security job is to keep the webview inside the CLI surface the spec
// allows: an argv allowlist, a blocked-flag list, and file reads restricted
// to fixed .soma/ suffixes. Claims come from the binary; pixels may come
// from the files.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Seek, SeekFrom};
use std::process::Command;

/// Max bytes returned per tail call - bounds memory and keeps the UI honest
/// about never holding the whole journal.
const MAX_TAIL_BYTES: u64 = 1_048_576;

/// argv prefixes the webview may execute. Anything not prefix-matched here
/// is rejected before spawn.
const ALLOWED: &[&[&str]] = &[
    &["version"],
    &["status"],
    &["log", "tail"],
    &["log", "show"],
    &["log", "verify"],
    &["skill", "list"],
    &["skill", "show"],
    &["issues", "list"],
    &["select"],
    &["proposals", "list"],
    &["proposals", "show"],
    &["proposals", "apply"],
    &["proposals", "dismiss"],
    &["model", "probe"],
    &["model", "route"],
    &["cache", "stats"],
    &["project", "list"],
    &["knowledge", "list"],
    &["knowledge", "search"],
    &["init"],
    &["preset", "apply"],
    // v2: execution + boards. Still soma-policy-gated and
    // journaled - the cockpit can only trigger what the CLI could.
    &["goal", "list"],
    &["goal", "show"],
    &["goal", "run"],
    &["cron", "list"],
    &["cron", "toggle"],
    // v4 control plane: journaled config edits + cron composer.
    &["config", "get"],
    &["config", "set"],
    &["cron", "add"],
    &["skill", "add"],
    &["skill", "lint"],
    &["policy", "show"],
    &["policy", "set"],
    &["mcp", "add"],
    &["mcp", "remove"],
    &["mcp", "tools"],
    &["mcp", "import"],
    &["cache", "clear"],
    &["skill", "run"],
    &["tick"],
    &["export"],
];

/// Flags that would turn an allowlisted read into an execution.
const BLOCKED_FLAGS: &[&str] = &["--run", "--ask-model"];

#[derive(serde::Serialize)]
struct SomaOut {
    code: i32,
    stdout: String,
    stderr: String,
}

#[derive(serde::Serialize)]
struct Tail {
    /// Complete journal lines (verbatim) from `from` (or the 1 MiB clamp).
    lines: Vec<String>,
    /// Byte offset to pass as `from` next call.
    offset: u64,
    /// Current file size; if it ever drops below your offset, reset to 0.
    size: u64,
    /// File mtime in ms - changes on in-place edits too, so the frontend can
    /// re-verify on tamper that doesn't grow the file.
    mtime: u64,
}

/// Resolve the soma binary: explicit env override, then the copy shipped
/// inside the .app bundle (next to this host executable), then a sibling
/// `soma` checkout's release build, then PATH.
fn soma_bin() -> String {
    if let Ok(p) = std::env::var("SOMA_BIN") {
        return p;
    }
    // Packaged .app: package-release.sh copies the release soma alongside the
    // host into Contents/MacOS/. Prefer it so the bundle is self-contained.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("soma");
            if bundled.is_file() {
                return bundled.to_string_lossy().into_owned();
            }
            // Dev convenience: when the soma runtime repo is checked out next
            // to this one, use its release build without extra configuration.
            // target/{release}/soma-cockpit -> ../../../../soma/target/release/soma
            let sibling = dir.join("../../../../soma/target/release/soma");
            if sibling.is_file() {
                return sibling.to_string_lossy().into_owned();
            }
        }
    }
    "soma".to_string()
}

fn allowed(args: &[String]) -> bool {
    if args.iter().any(|a| BLOCKED_FLAGS.contains(&a.as_str())) {
        return false;
    }
    ALLOWED
        .iter()
        .any(|p| args.len() >= p.len() && p.iter().enumerate().all(|(i, w)| args[i] == *w))
}

/// Registered project roots, cached across calls; a cache miss re-asks the
/// binary so a project initialized after boot validates without a restart.
fn registered_roots_cache() -> &'static std::sync::Mutex<Vec<String>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<Vec<String>>> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

fn fetch_registered_roots() -> Vec<String> {
    let out = match Command::new(soma_bin())
        .args(["project", "list", "--json"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&out.stdout);
    serde_json::from_str::<Vec<serde_json::Value>>(text.trim())
        .map(|rows| {
            rows.iter()
                .filter_map(|r| r.get("root").and_then(|v| v.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Every `root`/`project` path coming from the webview must name a
/// registered soma project - the host refuses to read files under (or run
/// soma against) arbitrary directories.
fn validate_root(root: &str) -> Result<(), String> {
    let cache = registered_roots_cache();
    if let Ok(held) = cache.lock() {
        if held.iter().any(|r| r == root) {
            return Ok(());
        }
    }
    let fresh = fetch_registered_roots();
    let ok = fresh.iter().any(|r| r == root);
    if let Ok(mut held) = cache.lock() {
        *held = fresh;
    }
    if ok {
        Ok(())
    } else {
        Err(format!("cockpit: '{root}' is not a registered soma project"))
    }
}

#[tauri::command]
fn run_soma(args: Vec<String>, project: Option<String>) -> Result<SomaOut, String> {
    if args.is_empty() || !allowed(&args) {
        return Err(format!("cockpit: argv not on allowlist: {args:?}"));
    }
    let mut cmd = Command::new(soma_bin());
    if let Some(root) = &project {
        validate_root(root)?;
        cmd.arg("--project").arg(root);
    }
    cmd.args(&args);
    let out = cmd.output().map_err(|e| format!("spawn soma: {e}"))?;
    Ok(SomaOut {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// Stream the journal from a byte offset. Display-path only (pixels); the
/// trust badge never uses this - it calls `log verify` through run_soma.
#[tauri::command]
fn tail_journal(root: String, from: u64) -> Result<Tail, String> {
    validate_root(&root)?;
    let path = std::path::Path::new(&root).join(".soma").join("events.jsonl");
    let mut f =
        std::fs::File::open(&path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let meta = f.metadata().map_err(|e| e.to_string())?;
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut start = from.min(size);
    if size - start > MAX_TAIL_BYTES {
        start = size - MAX_TAIL_BYTES;
    }
    f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = String::new();
    f.take(MAX_TAIL_BYTES)
        .read_to_string(&mut buf)
        .map_err(|e| format!("read {}: {e}", path.display()))?;

    // If we landed mid-line (clamped start), drop the partial first line.
    let mut s = buf.as_str();
    let mut consumed = start;
    if start > from {
        if let Some(i) = s.find('\n') {
            consumed += (i + 1) as u64;
            s = &s[i + 1..];
        } else {
            return Ok(Tail { lines: Vec::new(), offset: size, size, mtime });
        }
    }

    let mut lines = Vec::new();
    for line in s.split_inclusive('\n') {
        if line.ends_with('\n') {
            consumed += line.len() as u64;
            let t = line.trim_end();
            if !t.is_empty() {
                lines.push(t.to_string());
            }
        }
        // Trailing partial line (mid-append): leave it for the next poll.
    }
    Ok(Tail { lines, offset: consumed, size, mtime })
}

/// Read the policy contract for rendering. Fixed suffix join -
/// the webview can only ever name a project root, never an arbitrary file.
#[tauri::command]
fn read_policy(root: String) -> Result<String, String> {
    validate_root(&root)?;
    let p = std::path::Path::new(&root).join(".soma").join("policy.json");
    std::fs::read_to_string(&p).map_err(|e| format!("read {}: {e}", p.display()))
}

/// Reader thread for one stream of a streamed run: emits each line as a
/// `soma-stream` event tagged with the caller's run_id.
fn pump_stream<R: std::io::Read + Send + 'static>(
    app: tauri::AppHandle,
    run_id: String,
    stream: &'static str,
    r: R,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        use std::io::BufRead;
        use tauri::Emitter;
        for line in std::io::BufReader::new(r).lines().map_while(Result::ok) {
            let _ = app.emit(
                "soma-stream",
                serde_json::json!({ "run_id": run_id, "stream": stream, "line": line }),
            );
        }
    })
}

/// v2: run an allowlisted soma command with line-streamed output. Each
/// stdout/stderr line is emitted as a `soma-stream` event tagged with the
/// caller-chosen run_id; the final event carries done+code. Async so the
/// blocking child wait runs off the main thread; soma's own timeout_s
/// bounds long runs.
#[tauri::command]
async fn stream_soma(
    app: tauri::AppHandle,
    run_id: String,
    args: Vec<String>,
    project: Option<String>,
) -> Result<i32, String> {
    use tauri::Emitter;
    if args.is_empty() || !allowed(&args) {
        return Err(format!("cockpit: argv not on allowlist: {args:?}"));
    }
    let mut cmd = Command::new(soma_bin());
    if let Some(root) = &project {
        validate_root(root)?;
        cmd.arg("--project").arg(root);
    }
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("spawn soma: {e}"))?;
    let out = child.stdout.take().ok_or("no stdout pipe")?;
    let err = child.stderr.take().ok_or("no stderr pipe")?;

    let t1 = pump_stream(app.clone(), run_id.clone(), "out", out);
    let t2 = pump_stream(app.clone(), run_id.clone(), "err", err);
    let code = tauri::async_runtime::spawn_blocking(move || {
        let status = child.wait();
        let _ = t1.join();
        let _ = t2.join();
        status.map(|s| s.code().unwrap_or(-1)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit(
        "soma-stream",
        serde_json::json!({ "run_id": run_id, "done": true, "code": code }),
    );
    Ok(code)
}

#[derive(serde::Serialize)]
struct ExportEntry {
    name: String,
    bytes: u64,
    mtime: u64,
    dir: bool,
}

#[derive(serde::Serialize)]
struct AkmonSession {
    sid: String,
    mtime: u64,
    /// Verbatim evidence JSON when .akmon/evidence/<sid>.json exists.
    evidence: Option<String>,
    audit_bytes: u64,
}

fn file_mtime_ms(md: &std::fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// v3: read-only listing of akmon sessions the conductor ran
/// in this project - evidence JSON verbatim + audit log presence/size.
#[tauri::command]
fn list_akmon_sessions(root: String) -> Result<Vec<AkmonSession>, String> {
    validate_root(&root)?;
    let base = std::path::Path::new(&root).join(".akmon");
    let mut by_sid: std::collections::HashMap<String, AkmonSession> = std::collections::HashMap::new();

    if let Ok(rd) = std::fs::read_dir(base.join("audit")) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if let Some(sid) = name.strip_suffix(".jsonl") {
                if let Ok(md) = e.metadata() {
                    by_sid.insert(
                        sid.to_string(),
                        AkmonSession {
                            sid: sid.to_string(),
                            mtime: file_mtime_ms(&md),
                            evidence: None,
                            audit_bytes: md.len(),
                        },
                    );
                }
            }
        }
    }
    if let Ok(rd) = std::fs::read_dir(base.join("evidence")) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if let Some(sid) = name.strip_suffix(".json") {
                let content = std::fs::read_to_string(e.path()).ok();
                let md = e.metadata().ok();
                let entry = by_sid.entry(sid.to_string()).or_insert(AkmonSession {
                    sid: sid.to_string(),
                    mtime: 0,
                    evidence: None,
                    audit_bytes: 0,
                });
                entry.evidence = content;
                if let Some(md) = md {
                    let m = file_mtime_ms(&md);
                    if m > entry.mtime {
                        entry.mtime = m;
                    }
                }
            }
        }
    }
    let mut out: Vec<AkmonSession> = by_sid.into_values().collect();
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    Ok(out)
}

/// v2: read-only listing of the project's exports/ directory (pixels only).
#[tauri::command]
fn list_exports(root: String) -> Result<Vec<ExportEntry>, String> {
    validate_root(&root)?;
    let p = std::path::Path::new(&root).join("exports");
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(&p) {
        Ok(r) => r,
        Err(_) => return Ok(out), // no exports yet - empty list, not an error
    };
    for e in rd.flatten() {
        let md = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(ExportEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            bytes: md.len(),
            mtime,
            dir: md.is_dir(),
        });
    }
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    Ok(out)
}

#[derive(serde::Serialize)]
struct ToolInfo {
    name: String,
    path: String,
    exists: bool,
    version: String,
}

/// v4 §8c.6: read-only health of the sibling ecosystem tools. No foreign
/// config files are read (they may hold secrets) - presence + --version only.
///
/// Each tool is resolved from an explicit env override (e.g. `AKMON_BIN`),
/// falling back to the bare command name on `PATH`. There are no hardcoded
/// install paths: point the env vars at your builds, or put the tools on PATH.
fn resolve_tool(name: &str) -> String {
    let env_key = format!("{}_BIN", name.replace('-', "_").to_uppercase());
    if let Ok(p) = std::env::var(&env_key) {
        if !p.is_empty() {
            return p;
        }
    }
    name.to_string()
}

#[tauri::command]
fn ecosystem_info() -> Vec<ToolInfo> {
    let names = ["akmon", "agef-verify", "memora", "memora-cli"];
    names
        .iter()
        .map(|name| {
            let path = resolve_tool(name);
            // `exists` means "found on disk at an absolute path"; a bare PATH
            // name still runs but reports presence via the --version probe.
            let on_disk = std::path::Path::new(&path).is_file();
            let probe = Command::new(&path)
                .arg("--version")
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty());
            let exists = on_disk || probe.is_some();
            let version = probe.unwrap_or_else(|| {
                if exists { "(no --version)".into() } else { String::new() }
            });
            ToolInfo { name: name.to_string(), path, exists, version }
        })
        .collect()
}

/// Stage UI-composed file content (e.g. a skill manifest) into a temp file
/// so it can be passed to `soma skill add <path>` - the UI never writes
/// into .soma/ itself; the binary validates and installs.
#[tauri::command]
fn stage_manifest(content: String) -> Result<String, String> {
    let dir = std::env::temp_dir().join("soma-cockpit-staged");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!(
        "manifest-{}.json",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Read .soma/mcp.json for rendering (fixed suffix join, like read_policy).
#[tauri::command]
fn read_mcp(root: String) -> Result<String, String> {
    validate_root(&root)?;
    let p = std::path::Path::new(&root).join(".soma").join("mcp.json");
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(s),
        Err(_) => Ok("{}".to_string()), // no servers configured yet
    }
}

/// Native folder picker via osascript (zero extra dependencies). Returns
/// None when the user cancels. Used by the wizard's Browse… button.
#[tauri::command]
fn pick_directory() -> Result<Option<String>, String> {
    let out = Command::new("osascript")
        .args([
            "-e",
            "POSIX path of (choose folder with prompt \"Choose a project directory for soma\")",
        ])
        .output()
        .map_err(|e| format!("osascript: {e}"))?;
    if !out.status.success() {
        return Ok(None); // user cancelled the dialog
    }
    let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(if p.is_empty() { None } else { Some(p) })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            run_soma,
            tail_journal,
            read_policy,
            stream_soma,
            list_exports,
            list_akmon_sessions,
            pick_directory,
            stage_manifest,
            read_mcp,
            ecosystem_info
        ])
        .run(tauri::generate_context!())
        .expect("soma-cockpit failed to start");
}
