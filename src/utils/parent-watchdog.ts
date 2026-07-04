/**
 * Parent-death watchdog.
 *
 * MCP servers run as child processes of an AI host (OpenCode, Claude Code,
 * VS Code, etc.). When the host exits without sending SIGTERM (SIGKILL, OOM,
 * crash), the server gets reparented and never terminates — accumulating
 * orphaned processes with stale DB handles and memory.
 *
 * Two detection mechanisms, both cross-platform:
 *
 * 1. stdin 'close' — fast path. When the parent closes its pipe, Node
 *    delivers a 'close' event on process.stdin. This is the intended exit
 *    path and works on both Unix and Windows.
 *
 * 2. PPID polling — reliable backstop. Record process.ppid at startup and
 *    check every N seconds. When the parent dies the process gets reparented
 *    and ppid changes. Catches cases where stdin EOF never arrives (wrapper
 *    chain like npx→node, or broken pipe on hard kill).
 */

export interface ParentWatchdogOptions {
  /** Poll interval in ms. Default 5000. */
  intervalMs?: number;
  /**
   * Cleanup hook fired when parent death is detected. May be async.
   * After it resolves (or throws), the process exits.
   */
  onParentDeath?: () => void | Promise<void>;
  /** Override `process.ppid` getter (tests). */
  ppidGetter?: () => number;
  /** Override `process.exit` (tests). */
  exit?: (code: number) => void;
  /** Override `process.stdin` (tests). */
  stdin?: NodeJS.ReadStream | null;
}

export interface ParentWatchdog {
  stop(): void;
}

let instance: ParentWatchdog | undefined;

/**
 * Install the parent-death watchdog. Idempotent — safe to call multiple times.
 * Only the first call installs; subsequent calls return the existing instance.
 */
export function installParentWatchdog(opts: ParentWatchdogOptions = {}): ParentWatchdog {
  if (instance) return instance;

  const intervalMs = opts.intervalMs ?? 5000;
  const getPpid = opts.ppidGetter ?? (() => process.ppid);
  const doExit = opts.exit ?? ((code: number) => process.exit(code));
  const onParentDeath = opts.onParentDeath;
  const stdin = opts.stdin ?? process.stdin;

  const initialPpid = getPpid();

  if (initialPpid <= 1) {
    // Already orphaned or launched directly by init — nothing meaningful
    // to watch. Return a no-op watchdog.
    instance = { stop() {} };
    return instance;
  }

  let triggered = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function trigger(): Promise<void> {
    if (triggered) return;
    triggered = true;
    stop();
    try {
      if (onParentDeath) await onParentDeath();
      doExit(0);
    } catch {
      doExit(1);
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  // --- stdin close listener (fast path) ---
  if (stdin) {
    const onClose = (): void => {
      void trigger();
    };
    stdin.on('close', onClose);
  }

  // --- PPID polling (backstop) ---
  timer = setInterval(() => {
    const ppid = getPpid();
    if (ppid !== initialPpid) {
      void trigger();
    }
  }, intervalMs);

  if (typeof (timer as unknown as NodeJS.Timeout).unref === 'function') {
    (timer as unknown as NodeJS.Timeout).unref();
  }

  instance = { stop };
  return instance;
}
