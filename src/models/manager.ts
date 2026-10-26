import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

export type WorkerOp =
  | 'ping'
  | 'stats'
  | 'embed'
  | 'embedBatch'
  | 'classify'
  | 'classifyFreshness'
  | 'scoreEntailment'
  | 'shutdown';

export class WorkerSpawnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerSpawnError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ManagerOptions {
  /** Override worker script path (tests). Default: dist/models/worker.js next to this file. */
  scriptPath?: string;
  /** Override child_process.fork (tests). */
  spawnFn?: (script: string, env: NodeJS.ProcessEnv) => ChildProcess;
  /** Start worker with MODEL_WORKER_MOCK=1 (tests, no model download). */
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
 * Private model-worker lifecycle: one child per MCP server, killed on idle.
 * Kill is verified (graceful → SIGTERM → SIGKILL escalation); if the child
 * somehow survives, it is reported — never silently leaked.
 */
export class ModelWorkerManager {
  private child: ChildProcess | null = null;
  private pendings = new Map<number, Pending>();
  private nextId = 1;
  private killTimer: ReturnType<typeof setTimeout> | undefined;
  private activeOps = 0;
  private terminating: Promise<boolean> | null = null;
  private readonly spawnFn: (script: string, env: NodeJS.ProcessEnv) => ChildProcess;
  private readonly scriptPath: string | null;
  private readonly mock: boolean;
  private readonly idleTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  flags = { embeddingLoaded: false, nliLoaded: false };
  lastKillVerified: boolean | null = null;

  constructor(opts: ManagerOptions = {}) {
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
      throw new WorkerSpawnError('Model worker script not found (dist/models/worker.js missing)');
    }
    const env: NodeJS.ProcessEnv = { ...process.env, MCP_WORKER: '1' };
    if (this.mock) env.MODEL_WORKER_MOCK = '1';
    let child: ChildProcess;
    try {
      child = this.spawnFn(this.scriptPath, env);
    } catch (err) {
      throw new WorkerSpawnError(`Model worker fork failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.child = child;
    this.flags = { embeddingLoaded: false, nliLoaded: false };
    child.on('message', (msg: unknown) => this.onMessage(msg));
    child.on('error', (err) => {
      logger.error({ err }, 'Model worker error');
      this.failAllPending(new Error(`Model worker error: ${err.message}`));
    });
    child.on('exit', (code, signal) => {
      logger.info({ code, signal }, 'Model worker exited');
      if (this.child === child) this.child = null;
      this.failAllPending(new Error(`Model worker exited (code=${code} signal=${signal})`));
    });
    logger.info({ pid: child.pid }, 'Model worker spawned');
  }

  /** Single request/response roundtrip with timeout. Never hangs forever. */
  async op<T>(op: WorkerOp, args: Record<string, unknown> = {}): Promise<T> {
    this.activeOps++;
    this.cancelKillTimer();
    try {
      await this.ensureSpawned();
      const child = this.child;
      if (!child) throw new Error('Model worker not running');
      const id = this.nextId++;
      const payload = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendings.delete(id);
          reject(new Error(`Model worker op '${op}' timed out`));
        }, this.requestTimeoutMs);
        if (typeof (timer as unknown as NodeJS.Timeout).unref === 'function') {
          (timer as unknown as NodeJS.Timeout).unref();
        }
        this.pendings.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        try {
          child.send({ id, op, args });
        } catch (err) {
          this.pendings.delete(id);
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
      this.markLoaded(op);
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

    logger.warn({ pid }, 'Model worker ignored shutdown, SIGTERM');
    try {
      child.kill('SIGTERM');
    } catch (err) {
      logger.warn({ err, pid }, 'SIGTERM send failed');
    }
    if (await exitedWithin(child, 2000)) return this.verify(child, pid, 'SIGTERM');

    logger.warn({ pid }, 'Model worker survived SIGTERM, SIGKILL');
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
    this.flags = { embeddingLoaded: false, nliLoaded: false };
    this.lastKillVerified = dead;
    if (dead) {
      logger.info({ pid, via }, 'Model worker kill verified');
    } else {
      logger.fatal({ pid, via }, 'Model worker SURVIVED kill escalation — leaked process');
    }
    return dead;
  }

  private onMessage(msg: unknown): void {
    const m = msg as { id?: number; ok?: boolean; result?: unknown; error?: string } | null;
    if (!m || typeof m.id !== 'number' || m.id === 0) return;
    const pending = this.pendings.get(m.id);
    if (!pending) return;
    this.pendings.delete(m.id);
    clearTimeout(pending.timer);
    if (m.ok) pending.resolve(m.result);
    else pending.reject(new Error(m.error ?? 'Model worker op failed'));
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pendings) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pendings.clear();
  }

  private markLoaded(op: WorkerOp): void {
    if (op === 'embed' || op === 'embedBatch') this.flags.embeddingLoaded = true;
    if (op === 'classify' || op === 'classifyFreshness' || op === 'scoreEntailment') {
      this.flags.nliLoaded = true;
    }
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
