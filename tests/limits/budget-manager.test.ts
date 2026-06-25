import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetManager } from '../../src/limits/budget-manager.js';

describe('BudgetManager', () => {
  let manager: BudgetManager;

  beforeEach(() => {
    manager = new BudgetManager();
  });

  it('should allow searches under the limit', () => {
    const result = manager.checkBudget('search');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('should allow fetches under the limit', () => {
    const result = manager.checkBudget('fetch');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('should deduct from remaining after recording usage', () => {
    const before = manager.checkBudget('search');
    manager.recordUsage('search');
    const after = manager.checkBudget('search');
    expect(after.remaining).toBe(before.remaining - 1);
  });

  it('should track remaining separately for searches and fetches', () => {
    manager.recordUsage('search');
    manager.recordUsage('search');
    manager.recordUsage('fetch');

    const remaining = manager.getRemaining();
    const info = manager.getWindowInfo();

    expect(remaining.searches).toBeLessThan(remaining.fetches);
    expect(info.searchesUsed).toBe(2);
    expect(info.fetchesUsed).toBe(1);
  });

  it('should return remaining counts via getRemaining', () => {
    const remaining = manager.getRemaining();
    expect(typeof remaining.searches).toBe('number');
    expect(typeof remaining.fetches).toBe('number');
    expect(remaining.searches).toBeGreaterThan(0);
    expect(remaining.fetches).toBeGreaterThan(0);
  });

  it('should deny search when budget exhausted', () => {
    const info = manager.getWindowInfo();
    for (let i = 0; i < info.maxSearches; i++) {
      manager.recordUsage('search');
    }
    const result = manager.checkBudget('search');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.message).toContain('Search budget exhausted');
  });
});
