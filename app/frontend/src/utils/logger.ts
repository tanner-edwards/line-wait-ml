// In-memory ring-buffer logger for in-app debugging (see DebugLogModal).
//
// Session-only: the buffer lives in module scope and resets on reload. We
// deliberately don't persist — the goal is to read what happened *this*
// session (e.g. why a push subscription failed) without adding storage I/O.
//
// Two ways entries land here:
//   1. Explicit calls — logInfo / logWarn / logError from app code.
//   2. Console mirror — installConsoleMirror() patches console.warn and
//      console.error to also append here, so stray warnings (e.g. from the
//      web-push service) get captured without touching every call site.

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  ts: string;        // ISO timestamp
  level: LogLevel;
  tag: string | null;
  message: string;
}

const MAX_ENTRIES = 300;

let buffer: LogEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function append(level: LogLevel, message: string, tag: string | null): void {
  const entry: LogEntry = { id: nextId++, ts: new Date().toISOString(), level, tag, message };
  // Reassign (don't mutate) so getLogs() returns a fresh reference on every
  // change — useSyncExternalStore relies on identity to detect updates.
  const next = buffer.length >= MAX_ENTRIES
    ? [...buffer.slice(buffer.length - MAX_ENTRIES + 1), entry]
    : [...buffer, entry];
  buffer = next;
  emit();
}

export function logInfo(message: string, tag: string | null = null): void {
  append('info', message, tag);
}

export function logWarn(message: string, tag: string | null = null): void {
  append('warn', message, tag);
}

export function logError(message: string, tag: string | null = null): void {
  append('error', message, tag);
}

/** Newest-last snapshot of the buffer. Callers reverse for display if needed. */
export function getLogs(): LogEntry[] {
  return buffer;
}

export function clearLogs(): void {
  buffer = [];
  emit();
}

/** Subscribe to buffer changes (append/clear). Returns an unsubscribe fn. */
export function subscribeLogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let mirrorInstalled = false;

/**
 * Mirror console.warn / console.error into the buffer. Idempotent and safe to
 * call once at app startup. Originals are preserved and still fire, so devtools
 * output is unchanged.
 */
export function installConsoleMirror(): void {
  if (mirrorInstalled) return;
  mirrorInstalled = true;

  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    append('warn', formatArgs(args), 'console');
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    append('error', formatArgs(args), 'console');
    origError(...args);
  };
}

function formatArgs(args: unknown[]): string {
  return args
    .map(a => {
      if (a instanceof Error) {
        const name = a.name && a.name !== 'Error' ? `${a.name}: ` : '';
        return `${name}${a.message}`;
      }
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

// Test helper.
export function _resetForTests(): void {
  buffer = [];
  nextId = 1;
  listeners.clear();
  mirrorInstalled = false;
}
