import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { HotProcessManager } from '../src/hot/manager.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Fake fork child: EventEmitter + recorded signals, exit only when told. */
class FakeChild extends EventEmitter {
  pid = 424243;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;
  kills: string[] = [];
  autoExitOn: Record<string, 'exit' | 'ignore'> = {};
  reply: ((msg: { id: number; op: string }) => void) | null = null;

  send(msg: { id: number; op: string }): boolean {
    if (msg.op === 'shutdown' && this.autoExitOn.shutdown === 'exit') {
      setImmediate(() => this.doExit(0));
      return true;
    }
    if (this.reply) {
      const r = this.reply;
      setImmediate(() => r(msg));
    }
    return true;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    const sig = String(signal ?? 'SIGTERM');
    this.kills.push(sig);
    if (this.autoExitOn[sig] === 'exit') {
      setImmediate(() => this.doExit(sig === 'SIGKILL' ? null : 0, sig === 'SIGKILL' ? 'SIGKILL' : null));
    }
    return true;
  }

  doExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.connected = false;
    this.emit('exit', code, signal);
  }

  asChild(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

describe('HotProcessManager kill escalation', () => {
  it('SIGTERM ignored → SIGKILL + verified', async () => {
    const fake = new FakeChild();
    fake.autoExitOn = { shutdown: 'ignore', SIGTERM: 'ignore', SIGKILL: 'exit' };
    const mgr = new HotProcessManager({
      spawnFn: () => fake.asChild(),
      scriptPath: 'fake-worker.js',
      idleTimeoutMs: 0,
    });
    await mgr.ensureSpawned();
    const dead = await mgr.terminate();
    expect(dead).toBe(true);
    expect(mgr.lastKillVerified).toBe(true);
    expect(fake.kills).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('graceful shutdown ack → no signals needed', async () => {
    const fake = new FakeChild();
    fake.autoExitOn = { shutdown: 'exit' };
    const mgr = new HotProcessManager({
      spawnFn: () => fake.asChild(),
      scriptPath: 'fake-worker.js',
      idleTimeoutMs: 0,
    });
    await mgr.ensureSpawned();
    const dead = await mgr.terminate();
    expect(dead).toBe(true);
    expect(fake.kills).toEqual([]);
  });

  it('idle timer kills worker automatically', async () => {
    const fake = new FakeChild();
    fake.autoExitOn = { shutdown: 'exit' };
    fake.reply = (msg) => fake.emit('message', { id: msg.id, ok: true, result: { status: {} } });
    const mgr = new HotProcessManager({
      spawnFn: () => fake.asChild(),
      scriptPath: 'fake-worker.js',
      idleTimeoutMs: 40,
    });
    await mgr.op('status');
    expect(mgr.isAlive).toBe(true);
    await sleep(250);
    expect(mgr.isAlive).toBe(false);
    expect(mgr.lastKillVerified).toBe(true);
  });

  it('op timeout rejects and reaps wedged worker', async () => {
    const fake = new FakeChild();
    fake.autoExitOn = { shutdown: 'exit', SIGTERM: 'exit' };
    // Never replies.
    const mgr = new HotProcessManager({
      spawnFn: () => fake.asChild(),
      scriptPath: 'fake-worker.js',
      idleTimeoutMs: 0,
      requestTimeoutMs: 60,
    });
    await expect(mgr.op('ping')).rejects.toThrow(/timed out/);
    await sleep(100);
    expect(mgr.isAlive).toBe(false);
  });
});

const DIST_WORKER = join(process.cwd(), 'dist', 'hot', 'worker.js');

describe('Hot worker mock fork (integration)', () => {
  it('ping/search/status roundtrip + verified kill', async () => {
    if (!existsSync(DIST_WORKER)) return;
    const mgr = new HotProcessManager({
      scriptPath: DIST_WORKER,
      mock: true,
      idleTimeoutMs: 0,
      requestTimeoutMs: 30_000,
    });
    const pong = await mgr.op<{ pid: number; mock: boolean }>('ping');
    expect(pong.mock).toBe(true);
    expect(pong.pid).toBe(mgr.workerPid);
    const { response } = await mgr.op<{ response: { results: unknown[] } }>('search', { query: 'hello' });
    expect(response.results).toEqual([]);
    const { status } = await mgr.op<{ status: { budget: { searches_remaining: number } } }>('status', {});
    expect(status.budget.searches_remaining).toBe(0);
    expect(mgr.isAlive).toBe(true);
    const dead = await mgr.terminate();
    expect(dead).toBe(true);
    expect(mgr.lastKillVerified).toBe(true);
    expect(mgr.isAlive).toBe(false);
  });

  it('orphaned worker suicides on disconnect', async () => {
    if (!existsSync(DIST_WORKER)) return;
    const child = fork(DIST_WORKER, [], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: { ...process.env, MCP_HOT: '1', HOT_MOCK: '1' },
    });
    // Give it a moment to come online, then sever the channel = parent death.
    await sleep(2000);
    expect(child.exitCode).toBeNull();
    child.disconnect();
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(child.exitCode !== null), 10_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    expect(exited).toBe(true);
    try {
      child.kill('SIGKILL');
    } catch {
      // Already dead — the point of the test.
    }
  });
});
