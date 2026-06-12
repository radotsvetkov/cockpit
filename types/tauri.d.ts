// Ambient type declarations for the Tauri runtime surface the cockpit uses.
// Dev-time type checking only. Nothing here is shipped: the browser never
// loads .d.ts files, and the frontend has no build step. The real bindings
// are injected by Tauri at runtime (and by ui/js/__tauri_mock.js in the
// browser test harness).

interface TauriCore {
  // The JS↔Rust boundary is genuinely untyped; shape types live on the
  // soma.js wrapper functions, not on raw invoke. Returning `any` here keeps
  // the wrappers as the single place where return shapes are declared.
  invoke(cmd: string, args?: Record<string, unknown>): Promise<any>;
}

interface TauriEventPayload {
  payload: unknown;
}

interface TauriEvent {
  listen(
    event: string,
    handler: (event: TauriEventPayload) => void
  ): Promise<() => void>;
}

interface TauriGlobal {
  core: TauriCore;
  event: TauriEvent;
}

interface Window {
  __TAURI__: TauriGlobal;
}
