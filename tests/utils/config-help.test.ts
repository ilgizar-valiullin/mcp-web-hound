import { describe, it, expect } from 'vitest';
import { isSecretKey, maskSecretValue } from '../../src/utils/config-help.js';

describe('isSecretKey', () => {
  it('flags API keys and tokens', () => {
    expect(isSecretKey('BRAVE_API_KEY')).toBe(true);
    expect(isSecretKey('GITHUB_TOKEN')).toBe(true);
    expect(isSecretKey('GITLAB_TOKEN')).toBe(true);
  });

  it('passes through everything else', () => {
    expect(isSecretKey('LOG_LEVEL')).toBe(false);
    expect(isSecretKey('DDG_ENABLED')).toBe(false);
    expect(isSecretKey('BUDGET_MAX_SEARCHES')).toBe(false);
  });
});

describe('maskSecretValue', () => {
  it('partially masks long secrets', () => {
    expect(maskSecretValue('BRAVE_API_KEY', 'abcdefghij123456')).toBe('abcd****3456');
  });

  it('fully masks short secrets', () => {
    expect(maskSecretValue('GITHUB_TOKEN', 'short')).toBe('****');
    expect(maskSecretValue('GITHUB_TOKEN', '')).toBe('');
  });

  it('passes through non-secrets and non-strings untouched', () => {
    expect(maskSecretValue('LOG_LEVEL', 'info')).toBe('info');
    expect(maskSecretValue('DDG_ENABLED', true)).toBe(true);
    expect(maskSecretValue('BUDGET_MAX_SEARCHES', 15)).toBe(15);
    expect(maskSecretValue('BRAVE_API_KEY', undefined)).toBe(undefined);
  });
});
