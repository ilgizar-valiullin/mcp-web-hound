import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { HotOp } from './protocol.js';

export class HotSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HotSpawnError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface HotManagerOptions {
  /** Override worker script path (tests). Default: dist/hot/worker.js next to this file. */
  scriptPath?: string;
  /** Override child_process.fork (tests). */
  spawnFn?: (script: string, env: NodeJS.ProcessEnv) => ChildProcess;
  /** Start worker with HOT_MOCK=1 (tests, no DB/models). */
  mock?: boolean;
  /** Idle timeout before kill (ms). Default from MODEL_IDLE_TIMEOUT_SEC. */
  idleTimeoutMs?: number;
  /** Per-request timeout (ms). Default 60s. */
  requestTimeoutMs?: number;
}

function defaultSpawn(script: string, env: NodeJS.ProcessEnv): ChildProcess {
  return fork(script, [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    env,
  });
}

function exitedWithin(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(child.exitCode !== null || child.signalCode !== null);
    }, ms);
    if (typeof (timer as unknown as NodeJS.Timeout).unref === 'function') {
      (timer as unknown as NodeJS.Timeout).unref();
    }
    child.once('exit', onExit);
  });
}

/**
 * Hot-process lifecycle: one child per MCP server, owns DB/vec/router/models.
 * Spawned on first tool call, killed on idle (default 5s) — the OS reclaims
 * ALL native memory (sqlite-vec pages can't be unloaded any other way).
 * Kill is verified (graceful → SIGTERM → SIGKILL escalation).
 */
export class HotProcessManager {
  private child: ChildProcess | null = null;
  private resolvers = new Map<number, Pending>();
  private nextId = 1;
  private killTimer: ReturnType<typeof setTimeout> | undefined;
  private activeOps = 0;
  private terminating: Promise<boolean> | null = null;
  private readonly spawnFn: (script: string, env: NodeJS.ProcessEnv) => ChildProcess;
  private readonly scriptPath: string | null;
  private readonly mock: boolean;
  private readonly idleTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  lastKillVerified: boolean | null = null;

  constructor(opts: HotManagerOptions = {}) {
    this.spawnFn = opts.spawnFn ?? defaultSpawn;
    this.mock = opts.mock ?? false;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? config.MODEL_IDLE_TIMEOUT_SEC * 1000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 60_000;
    if (opts.scriptPath) {
      this.scriptPath = opts.scriptPath;
    } else {
      try {
        const here = dirname(fileURLToPath(import.meta.url));
        const candidate = join(here, 'worker.js');
        this.scriptPath = existsSync(candidate) ? candidate : null;
      } catch {
        this.scriptPath = null;
      }
    }
  }

  get isAlive(): boolean {
    return !!this.child && this.child.exitCode === null && this.child.signalCode === null;
  }

  get workerPid(): number | null {
    return this.child?.pid ?? null;
  }

  async ensureSpawned(): Promise<void> {
    if (this.isAlive) return;
    if (this.terminating) await this.terminating;
    if (this.isAlive) return;
    if (!this.scriptPath) {
      throw new HotSpawnError('Hot worker script not found (dist/hot/worker.js missing)');
    }
    const env: NodeJS.ProcessEnv = { ...process.env, MCP_HOT: '1' };
    if (this.mock) env.HOT_MOCK = '1';
    let child: ChildProcess;
    try {
      child = this.spawnFn(this.scriptPath, env);
    } catch (err) {
      throw new HotSpawnError(`Hot worker fork failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.child = child;
    child.on('message', (msg: unknown) => this.onMessage(msg));
    child.on('error', (err) => {
      logger.error({ err }, 'Hot worker error');
      this.failAllPending(new Error(`Hot worker error: ${err.message}`));
    });
    child.on('exit', (code, signal) => {
      logger.info({ code, signal }, 'Hot worker exited');
      if (this.child === child) this.child = null;
      this.failAllPending(new Error(`Hot worker exited (code=${code} signal=${signal})`));
    });
    logger.info({ pid: child.pid }, 'Hot worker spawned');
  }

  /** Single request/response roundtrip with timeout. Never hangs forever. */
  async op<T>(op: HotOp, args: Record<string, unknown> = {}): Promise<T> {
    this.activeOps++;
    this.cancelKillTimer();
    try {
      await this.ensureSpawned();
      const child = this.child;
      if (!child) throw new Error('Hot worker not running');
      const id = this.nextId++;
      const payload = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.resolvers.delete(id);
          reject(new Error(`Hot worker op '${op}' timed out`));
        }, this.requestTimeoutMs);
        if (typeof (timer as unknown as NodeJS.Timeout).unref === 'function') {
          (timer as unknown as NodeJS.Timeout).unref();
        }
        this.resolvers.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        try {
          child.send({ id, op, args });
        } catch (err) {
          this.resolvers.delete(id);
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
      return payload as T;
    } catch (err) {
      // Suspect a wedged worker — reap it so the next op respawns fresh.
      void this.terminate();
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      this.activeOps--;
      if (this.activeOps <= 0) {
        this.activeOps = 0;
        this.scheduleKill();
      }
    }
  }

  /**
   * Kill the worker and VERIFY death: graceful shutdown → SIGTERM → SIGKILL.
   * Returns true when the process is confirmed gone.
   */
  terminate(): Promise<boolean> {
    if (this.terminating) return this.terminating;
    this.terminating = this.terminateInner().finally(() => {
      this.terminating = null;
    });
    return this.terminating;
  }

  async dispose(): Promise<void> {
    this.cancelKillTimer();
    await this.terminate();
  }

  private async terminateInner(): Promise<boolean> {
    const child = this.child;
    if (!child) {
      this.lastKillVerified = true;
      return true;
    }
    const pid = child.pid;
    try {
      child.send({ id: 0, op: 'shutdown', args: {} });
    } catch {
      // Channel already dead — proceed with signals.
    }
    if (await exitedWithin(child, 1500)) return this.verify(child, pid, 'shutdown');

    logger.warn({ pid }, 'Hot worker ignored shutdown, SIGTERM');
    try {
      child.kill('SIGTERM');
    } catch (err) {
      logger.warn({ err, pid }, 'SIGTERM send failed');
    }
    if (await exitedWithin(child, 2000)) return this.verify(child, pid, 'SIGTERM');

    logger.warn({ pid }, 'Hot worker survived SIGTERM, SIGKILL');
    try {
      child.kill('SIGKILL');
    } catch (err) {
      logger.warn({ err, pid }, 'SIGKILL send failed');
    }
    if (await exitedWithin(child, 2000)) return this.verify(child, pid, 'SIGKILL');

    return this.verify(child, pid, 'SIGKILL+wait');
  }

  private verify(child: ChildProcess, pid: number | undefined, via: string): boolean {
    let dead = child.exitCode !== null || child.signalCode !== null;
    if (!dead && pid) {
      try {
        process.kill(pid, 0);
      } catch {
        dead = true;
      }
    }
    if (dead && this.child === child) this.child = null;
    this.lastKillVerified = dead;
    if (dead) {
      logger.info({ pid, via }, 'Hot worker kill verified');
    } else {
      logger.fatal({ pid, via }, 'Hot worker SURVIVED kill escalation — leaked process');
    }
    return dead;
  }

  private onMessage(msg: unknown): void {
    const m = msg as { id?: number; ok?: boolean; result?: unknown; error?: string } | null;
    if (!m || typeof m.id !== 'number' || m.id === 0) return;
    const pending = this.resolvers.get(m.id);
    if (!pending) return;
    this.resolvers.delete(m.id);
    clearTimeout(pending.timer);
    if (m.ok) pending.resolve(m.result);
    else pending.reject(new Error(m.error ?? 'Hot worker op failed'));
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.resolvers) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.resolvers.clear();
  }

  private cancelKillTimer(): void {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
    }
  }

  private scheduleKill(): void {
    if (this.idleTimeoutMs <= 0) return;
    if (!this.child) return;
    if (this.killTimer) return;
    this.killTimer = setTimeout(() => {
      this.killTimer = undefined;
      void this.terminate();
    }, this.idleTimeoutMs);
    if (typeof (this.killTimer as unknown as NodeJS.Timeout).unref === 'function') {
      (this.killTimer as unknown as NodeJS.Timeout).unref();
    }
  }
}
