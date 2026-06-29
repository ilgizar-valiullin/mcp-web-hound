#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process, { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { ConfigSchema } from '../utils/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ROOT = resolve(__dirname, '../..');
const ENV_PATH = resolve(SERVER_ROOT, '.env');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
};

function clr(text: string, code: string): string {
  return `${code}${text}${C.reset}`;
}

type FieldType = 'boolean' | 'number' | 'string' | 'enum';

interface Section {
  key: string;
  label: string;
  description: string;
  match: (key: string) => boolean;
}

const SECTIONS: Section[] = [
  {
    key: 'server',
    label: 'Server',
    description: 'Logging verbosity and data storage paths',
    match: k => ['LOG_LEVEL', 'DATA_DIR', 'DB_FILENAME'].includes(k),
  },
  {
    key: 'search_providers',
    label: 'Search Providers',
    description: 'Toggle free search providers on or off',
    match: k => ['DDG_ENABLED', 'BING_ENABLED', 'STARTPAGE_ENABLED', 'BRAVE_WEB_ENABLED'].includes(k),
  },
  {
    key: 'api_keys',
    label: 'API Keys',
    description: 'Premium provider credentials and daily query limits',
    match: k => k.endsWith('_API_KEY') || k.endsWith('_DAILY_LIMIT'),
  },
  {
    key: 'platform_tokens',
    label: 'Platform Tokens',
    description: 'GitHub and GitLab API access tokens',
    match: k => k.endsWith('_TOKEN'),
  },
  {
    key: 'search_engine',
    label: 'Search Engine',
    description: 'Provider order, parallelism, timeouts, max results',
    match: k => ['PROVIDER_ORDER', 'MAX_PARALLEL_PROVIDERS', 'PROVIDER_EXECUTION_MODE', 'MAX_RESULTS_AFTER_RERANK', 'SEARCH_TIMEOUT_MS'].includes(k),
  },
  {
    key: 'budget',
    label: 'Budget',
    description: 'Daily limits for search and fetch operations',
    match: k => k.startsWith('BUDGET_'),
  },
  {
    key: 'cache',
    label: 'Cache',
    description: 'Result cache size, eviction interval, and TTL',
    match: k => k.startsWith('CACHE_'),
  },
  {
    key: 'ai_features',
    label: 'AI Features',
    description: 'Semantic search, embeddings model, reranking, intent classifier',
    match: k => k.startsWith('SEMANTIC_') || k.startsWith('RERANK_') || k.startsWith('INTENT_') || k.startsWith('EMBEDDING_'),
  },
  {
    key: 'deduplication',
    label: 'Deduplication',
    description: 'Window for deduplicating repeated queries',
    match: k => k.startsWith('SESSION_'),
  },
  {
    key: 'rate_limits',
    label: 'Rate Limits',
    description: 'Per-provider RPM, RPD, and monthly request caps',
    match: k => k.endsWith('_RPM') || k.endsWith('_RPD') || k.endsWith('_RPMONTH'),
  },
  {
    key: 'advanced',
    label: 'Advanced',
    description: 'Per-provider delays, pagination, and tuning',
    match: k => k.includes('_DELAY_') || k.includes('_MAX_PER_') || k.includes('_RESULTS_PER_') || k.includes('_MAX_PAGES'),
  },
];

function sectionFor(key: string): Section {
  for (const s of SECTIONS) {
    if (s.match(key)) return s;
  }
  return { key: 'other', label: 'Other', description: '', match: () => false };
}

function typeName(t: any): string {
  return t?._def?.typeName ?? t?.constructor?.name ?? '';
}

function unwrapType(type: any): { fieldType: FieldType; enumValues?: string[] } {
  const tn = typeName(type);
  if (tn === 'ZodDefault' || tn === 'ZodOptional' || tn === 'ZodEffects' || tn === 'ZodPipe') {
    return unwrapType(type._def.innerType ?? type._def.type ?? type._def.in);
  }
  if (tn === 'ZodBoolean') return { fieldType: 'boolean' };
  if (tn === 'ZodNumber') return { fieldType: 'number' };
  if (tn === 'ZodString') return { fieldType: 'string' };
  if (tn === 'ZodEnum') {
    const values = type._def.values ?? (type._def.entries ? Object.values(type._def.entries) : undefined);
    if (values) return { fieldType: 'enum', enumValues: values as string[] };
    return { fieldType: 'string' };
  }
  if (tn === 'ZodUnion') {
    const opts = type._def.options as any[];
    if (opts.some((o: any) => typeName(o) === 'ZodBoolean')) return { fieldType: 'boolean' };
    if (opts.some((o: any) => typeName(o) === 'ZodNumber')) return { fieldType: 'number' };
    return { fieldType: 'string' };
  }
  return { fieldType: 'string' };
}

interface FieldDef {
  key: string;
  description: string;
  section: string;
  fieldType: FieldType;
  defaultRaw: string;
  enumValues?: string[];
}

function buildFields(): FieldDef[] {
  const shape = ConfigSchema.shape as Record<string, any>;
  const fields: FieldDef[] = [];
  for (const key of Object.keys(shape)) {
    const type: any = shape[key];
    const description: string = type.description ?? '';
    const { fieldType, enumValues } = unwrapType(type);
    let dv: any = type._def.defaultValue;
    if (dv === undefined) {
      const inner = type._def.innerType;
      if (inner) dv = inner._def.defaultValue;
    }
    const defaultRaw = dv === undefined || dv === null ? '' : fieldType === 'boolean' ? (dv ? 'true' : 'false') : String(dv);
    fields.push({ key, description, section: sectionFor(key).key, fieldType, defaultRaw, enumValues });
  }
  fields.sort((a, b) => {
    const ia = SECTIONS.findIndex(s => s.key === a.section);
    const ib = SECTIONS.findIndex(s => s.key === b.section);
    if (ia !== ib) return ia - ib;
    return a.key.localeCompare(b.key);
  });
  return fields;
}

function loadEnv(): Record<string, string> {
  try {
    const content = readFileSync(ENV_PATH, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

function currentValue(key: string, env: Record<string, string>, def: FieldDef): string {
  if (key in env) return env[key];
  const pe = process.env[key];
  if (pe) return pe;
  return def.defaultRaw;
}

function mask(val: string, key: string): string {
  if ((key.endsWith('_API_KEY') || key.endsWith('_TOKEN')) && val.length > 8) {
    return val.slice(0, 4) + '****' + val.slice(-4);
  }
  return val || clr('(not set)', C.dim);
}

function parseInput(input: string, def: FieldDef): { value?: unknown; error?: string } {
  const t = input.trim();
  if (!t) return {};

  if (def.fieldType === 'boolean') {
    const l = t.toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(l)) return { value: true };
    if (['false', '0', 'no', 'n'].includes(l)) return { value: false };
    return { error: 'true/false, yes/no, or 1/0' };
  }

  if (def.fieldType === 'number') {
    const n = Number(t);
    if (isNaN(n)) return { error: 'Expected a number' };
    return { value: n };
  }

  if (def.fieldType === 'enum' && def.enumValues) {
    const l = t.toLowerCase();
    const m = def.enumValues.find(v => v.toLowerCase() === l);
    if (!m) return { error: `Options: ${def.enumValues.join(', ')}` };
    return { value: m };
  }

  return { value: t };
}

function toEnv(v: unknown, ft: FieldType): string {
  if (v === undefined || v === null) return '';
  return ft === 'boolean' ? (v ? 'true' : 'false') : String(v);
}

function prepareEnv(silent?: boolean): void {
  // Only create .env from default.env if it doesn't exist at all
  if (existsSync(ENV_PATH)) return;

  const defaultPath = resolve(SERVER_ROOT, 'default.env');
  try {
    const content = readFileSync(defaultPath, 'utf-8');
    writeFileSync(ENV_PATH, content, 'utf-8');
    if (!silent) {
      stdout.write(clr(`\n  ✓ Created ${ENV_PATH} from default.env\n\n`, C.green));
    }
  } catch {
    // No default.env — will write raw values on first change
  }
}

function applyChanges(env: Record<string, string>, changes: Map<string, string>, silent?: boolean): void {
  const wasMissing = !existsSync(ENV_PATH);
  prepareEnv(true);

  const merged = { ...env };
  for (const [key, val] of changes) merged[key] = val;

  const existing = readFileSync(ENV_PATH, 'utf-8');
  const lines = existing.split('\n');
  const seen = new Set<string>();

  if (wasMissing) {
    // Fresh from default.env — uncomment keys that user set, keep others commented
    const out: string[] = [];
    for (const line of lines) {
      const t = line.trimEnd();
      const match = t.match(/^#\s*([A-Z][A-Z0-9_]*)=/);
      if (match) {
        const key = match[1];
        seen.add(key);
        if (key in merged && merged[key]) {
          out.push(`${key}=${merged[key]}`);
        } else {
          out.push(t);
        }
      } else {
        out.push(t);
      }
    }
    for (const [key, val] of Object.entries(merged)) {
      if (!seen.has(key) && val) {
        out.push(`${key}=${val}`);
      }
    }
    out.push('');
    const tmp = ENV_PATH + '.tmp';
    writeFileSync(tmp, out.join('\n'), 'utf-8');
    renameSync(tmp, ENV_PATH);
  } else {
    // Existing file — update values in place, uncomment if needed, preserve formatting
    const out: string[] = [];
    for (const line of lines) {
      const t = line.trimEnd();
      const eq = t.indexOf('=');

      // Active KEY=VALUE line
      if (eq > 0 && !t.startsWith('#')) {
        const key = t.slice(0, eq).trim();
        seen.add(key);
        const newVal = merged[key];
        out.push(newVal && newVal !== '' ? `${key}=${newVal}` : t);
        continue;
      }

      // Commented line like "# KEY=VALUE" — uncomment if key is in changes
      const commentMatch = t.match(/^#\s*([A-Z][A-Z0-9_]*)=/);
      if (commentMatch) {
        const key = commentMatch[1];
        seen.add(key);
        const newVal = merged[key];
        if (newVal && newVal !== '') {
          out.push(`${key}=${newVal}`);
        } else {
          out.push(t);
        }
        continue;
      }

      // Pure comment, section header, or empty line
      out.push(t);
    }
    for (const [key, val] of Object.entries(merged)) {
      if (!seen.has(key) && val) {
        out.push(`${key}=${val}`);
      }
    }
    out.push('');
    const tmp = ENV_PATH + '.tmp';
    writeFileSync(tmp, out.join('\n'), 'utf-8');
    renameSync(tmp, ENV_PATH);
  }

  if (!silent) {
    stdout.write(clr(`\n  ✓ Saved to ${ENV_PATH}\n\n`, C.green + C.bold));
  }
}

// ─── Fallback: numbered menu (non-TTY) ────────────────────────────

async function runNumbered(fields: FieldDef[], env: Record<string, string>): Promise<void> {
  const changes: Map<string, string> = new Map();
  const rl = createInterface({ input: stdin, output: stdout });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let lastSection: string | undefined;
    for (const f of fields) {
      if (f.section !== lastSection) {
        lastSection = f.section;
        const sec = SECTIONS.find(s => s.key === f.section);
        const label = sec ? `${sec.label} — ${sec.description}` : f.section;
        stdout.write(clr(`\n${label}\n`, C.cyan));
      }
      const cur = changes.get(f.key) ?? currentValue(f.key, env, f);
      stdout.write(`  ${clr(f.key, C.yellow)}  ${mask(cur, f.key)}\n`);
    }

    stdout.write(clr('\n  Edit # (0 to save & exit): ', C.bold + C.green));
    const answer = await rl.question('');
    const num = parseInt(answer, 10);

    if (answer.trim() === '0' || answer.trim() === '' || isNaN(num)) {
      break;
    }

    if (num < 1 || num > fields.length) {
      stdout.write(clr(`  ✖ Pick 1–${fields.length}\n`, C.red));
      continue;
    }

    const field = fields[num - 1];
    const curRaw = changes.get(field.key) ?? currentValue(field.key, env, field);

    stdout.write(`\n  ${clr('─── ' + field.key + ' ───', C.magenta)}\n`);
    if (field.description) stdout.write(`  ${field.description}\n`);
    if (field.enumValues) {
      stdout.write(clr(`  Options: ${field.enumValues.join(', ')}`, C.yellow) + '\n');
    } else if (field.fieldType === 'boolean') {
      stdout.write(clr('  Values: true / false', C.yellow) + '\n');
    }
    stdout.write(clr(`  Default: ${field.defaultRaw || '(empty)'}`, C.green) + '\n');
    stdout.write(`  Current: ${curRaw}\n`);

    const newVal = await rl.question(clr(`  New value (Enter to keep): `, C.green));
    const parsed = parseInput(newVal, field);

    if (parsed.error) {
      stdout.write(clr(`  ✖ ${parsed.error}\n`, C.red));
      continue;
    }

    if (parsed.value === undefined) {
      stdout.write(clr('  · unchanged\n', C.dim));
      continue;
    }

    const envVal = toEnv(parsed.value, field.fieldType);
    changes.set(field.key, envVal);
    stdout.write(clr(`  ✓ ${envVal}\n`, C.green));
  }

  rl.close();

  if (changes.size === 0) {
    stdout.write(clr('\n  No changes.\n\n', C.dim));
    return;
  }

  stdout.write(clr('\n  ─── Changes ───\n', C.cyan));
  for (const [k, v] of changes) stdout.write(clr(`  ${k}=${v}\n`, C.green));

  const confirmRl = createInterface({ input: stdin, output: stdout });
  const confirmAnswer = await confirmRl.question(clr('\n  Apply? (Y/n): ', C.bold));
  confirmRl.close();

  if (confirmAnswer.trim().toLowerCase() === 'n') {
    stdout.write(clr('  Cancelled.\n\n', C.yellow));
    return;
  }

  applyChanges(env, changes);
}

// ─── Interactive: arrow-key menu (TTY) ────────────────────────────

function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return rl.question(prompt).finally(() => rl.close());
}

async function askDiscard(): Promise<boolean> {
  stdin.setRawMode(false);
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(clr('  Discard unsaved changes? (y/N): ', C.bold));
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

function saveAndExit(env: Record<string, string>, changes: Map<string, string>): void {
  stdin.setRawMode(false);
  stdout.write('\x1b[?1049l'); // restore main buffer
  if (changes.size === 0) {
    stdout.write(clr('\n  No changes.\n\n', C.dim));
    stdin.pause();
    return;
  }
  stdout.write(clr('\n  Saving changes:\n', C.bold));
  for (const [k, v] of changes) stdout.write(clr(`  ${k}=${v}\n`, C.green));
  applyChanges(env, changes);
  stdin.pause();
}

function runInteractive(fields: FieldDef[], env: Record<string, string>): void {
  const changes: Map<string, string> = new Map();

  const sections = SECTIONS.filter(s => fields.some(f => f.section === s.key));

  stdout.write('\x1b[?1049h');

  function exitClean(msg: string, color = C.dim): void {
    stdin.removeAllListeners('keypress');
    stdin.setRawMode(false);
    stdout.write('\x1b[?1049l');
    stdout.write(clr(`\n  ${msg}\n\n`, color));
    stdin.pause();
  }

  function unsavedLabel(): string {
    if (changes.size === 0) return '';
    const label = clr(`${changes.size} unsaved`, C.yellow);
    return changes.size > 0 ? label + ' · ' : '';
  }

  // ── Section list ──────────────────────────────────────────────

  function drawSections(cursor: number): void {
    stdout.write('\x1b[2J\x1b[H');
    stdout.write(clr('  MCP Web Hound — Settings Editor\n', C.bold + C.cyan));
    stdout.write(clr('  ↑↓ navigate · Enter open · q quit\n', C.dim));

    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const count = fields.filter(f => f.section === s.key).length;
      const changed = fields.filter(f => f.section === s.key && changes.has(f.key)).length;
      const prefix = i === cursor ? ' ❯' : '  ';
      const label = clr(s.label, i === cursor ? C.white + C.bold : C.cyan);
      const meta = clr(` (${count} items${changed ? `, ${changed} changed` : ''})`, C.dim);
      const desc = `  ${s.description}`;
      stdout.write(`${prefix} ${label}${meta}\n`);
      stdout.write(`    ${desc}\n`);
    }
    stdout.write(`\n  ${unsavedLabel()}${clr('↑↓·Enter·q', C.dim)}\n`);
  }

  // ── Field list ────────────────────────────────────────────────

  function fieldMeta(f: FieldDef): string {
    const seg: string[] = [];
    if (f.description) seg.push(f.description);
    if (f.enumValues) {
      seg.push(clr(`Options: ${f.enumValues.join(', ')}`, C.yellow));
    } else if (f.fieldType === 'boolean') {
      seg.push(clr('Values: true / false', C.yellow));
    }
    seg.push(clr(`Default: ${f.defaultRaw || '(empty)'}`, C.green));
    return seg.join(' · ');
  }

  function drawFields(section: Section, cursor: number): void {
    const sectionFields = fields.filter(f => f.section === section.key);
    const secLabel = clr(section.label, C.bold + C.cyan);

    stdout.write('\x1b[2J\x1b[H');
    stdout.write(`  ${secLabel}\n`);
    stdout.write(clr('  ↑↓ navigate · Enter edit · s save · q back\n', C.dim));

    for (let i = 0; i < sectionFields.length; i++) {
      const f = sectionFields[i];
      const cur = changes.get(f.key) ?? currentValue(f.key, env, f);
      const prefix = i === cursor ? ' ❯' : '  ';
      const keyPart = clr(f.key, i === cursor ? C.white + C.bold : C.yellow);
      const valPart = mask(cur, f.key);
      stdout.write(`${prefix} ${keyPart}  ${valPart}\n`);
      stdout.write(clr(`   ${fieldMeta(f)}\n`, C.cyan));
    }

    stdout.write(`\n  ${unsavedLabel()}${clr('↑↓·Enter·s·q', C.dim)}\n`);
  }

  function editField(f: FieldDef): Promise<void> {
    return new Promise((resolve) => {
      stdin.removeListener('keypress', onKey);
      stdin.setRawMode(false);

      const curRaw = changes.get(f.key) ?? currentValue(f.key, env, f);

      stdout.write('\x1b[2J\x1b[H');
      stdout.write(`\n  ${clr('─── ' + f.key + ' ───', C.magenta)}\n`);
      if (f.description) stdout.write(`  ${f.description}\n`);
      if (f.enumValues) {
        stdout.write(clr(`  Options: ${f.enumValues.join(', ')}`, C.yellow) + '\n');
      } else if (f.fieldType === 'boolean') {
        stdout.write(clr('  Values: true / false', C.yellow) + '\n');
      }
      stdout.write(clr(`  Default: ${f.defaultRaw || '(empty)'}`, C.green) + '\n');
      stdout.write(`  Current: ${curRaw}\n`);

      readLine(clr(`  New value (Enter to keep): `, C.green)).then((answer) => {
        if (!answer.trim()) {
          stdout.write(clr('  · unchanged\n', C.dim));
        } else {
          const parsed = parseInput(answer, f);
          if (parsed.error) {
            stdout.write(clr(`  ✖ ${parsed.error}\n`, C.red));
          } else {
            const envVal = toEnv(parsed.value!, f.fieldType);
            changes.set(f.key, envVal);
            stdout.write(clr(`  ✓ ${envVal}\n`, C.green));
          }
        }
        stdin.setRawMode(true);
        resolve();
      });
    });
  }

  // ── Navigation ────────────────────────────────────────────────

  let mode: 'sections' | 'fields' = 'sections';
  let currentSection: Section | null = null;
  let cursor = 0;

  function redraw(): void {
    if (mode === 'sections') {
      drawSections(cursor);
    } else if (currentSection) {
      drawFields(currentSection, cursor);
    }
  }

  function switchToSection(s: Section): void {
    mode = 'fields';
    currentSection = s;
    cursor = 0;
    redraw();
  }

  function backToSections(): void {
    mode = 'sections';
    currentSection = null;
    cursor = 0;
    redraw();
  }

  async function onKey(_key: string, data: any): Promise<void> {
    if (!data) return;

    if (data.name === 'c' && data.ctrl) {
      exitClean('Interrupted.', C.yellow);
      return;
    }

    if (mode === 'sections') {
      if (data.name === 'up') {
        cursor = cursor > 0 ? cursor - 1 : sections.length - 1;
        redraw();
      } else if (data.name === 'down') {
        cursor = cursor < sections.length - 1 ? cursor + 1 : 0;
        redraw();
      } else if (data.name === 'return') {
        switchToSection(sections[cursor]);
      } else if (data.name === 'q') {
        if (changes.size > 0) {
          stdin.removeListener('keypress', onKey);
          const discard = await askDiscard();
          if (discard) {
            exitClean('Cancelled.');
          } else {
            stdin.on('keypress', onKey);
            redraw();
          }
        } else {
          exitClean('No changes.');
        }
      }
    } else if (mode === 'fields' && currentSection) {
      const sectionFields = fields.filter(f => f.section === currentSection!.key);

      if (data.name === 'up') {
        cursor = cursor > 0 ? cursor - 1 : sectionFields.length - 1;
        redraw();
      } else if (data.name === 'down') {
        cursor = cursor < sectionFields.length - 1 ? cursor + 1 : 0;
        redraw();
      } else if (data.name === 'return') {
        await editField(sectionFields[cursor]);
        stdin.on('keypress', onKey);
        redraw();
      } else if (data.name === 'backspace' || data.name === 'left') {
        backToSections();
      } else if (data.name === 'q') {
        backToSections();
      } else if (data.name === 's') {
        stdin.removeListener('keypress', onKey);
        saveAndExit(env, changes);
      }
    }
  }

  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('keypress', onKey);
  redraw();
}

export function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const jsonIdx = args.indexOf('--json');
  if (jsonIdx !== -1) {
    handleJsonMode(args.slice(jsonIdx + 1));
    return;
  }

  // TUI / numbered fallback
  const env = loadEnv();
  const fields = buildFields();

  if (stdin.isTTY) {
    runInteractive(fields, env);
  } else {
    stdout.write(clr('  Non-TTY mode: using numbered menu\n', C.dim));
    runNumbered(fields, env);
  }
}

function printHelp(): void {
  const cwdEnv = resolve(process.cwd(), '.env');
  stdout.write(`
MCP Web Hound — Configuration Tool

Config file: ${ENV_PATH}

Configuration model (2-tier):
  ${ENV_PATH}            Server config (written by this tool)
  ${cwdEnv}               Per-project overrides (optional)

  AGENT RULE: AI agents MUST write config ONLY to the server .env above
  via --json set. NEVER write to a project's .env file.

Usage:
  mcp-web-hound-configure                  Interactive settings editor (TUI)
  mcp-web-hound-configure --help            Show this help

Machine-readable JSON (for AI agents):
  mcp-web-hound-configure --json get        List all config fields with
                                            descriptions, types, defaults,
                                            current values, and sections.
                                            Output: JSON array on stdout.

  mcp-web-hound-configure --json set KEY=VALUE [KEY=VALUE...]
                                            Set one or more config values.
                                            Validates all values against the
                                            schema before writing any.
                                            Output: JSON result on stdout.

  Examples:
    mcp-web-hound-configure --json get
    mcp-web-hound-configure --json set BRAVE_API_KEY=abc123
    mcp-web-hound-configure --json set DDG_ENABLED=false GITHUB_TOKEN=ghp_xxx
`);
}

function handleJsonMode(sub: string[]): void {
  const cmd = sub[0];

  if (cmd === 'get') {
    const fields = buildFields();
    const env = loadEnv();
    const result = fields.map(f => ({
      key: f.key,
      description: f.description,
      type: f.fieldType,
      default: f.defaultRaw,
      current: currentValue(f.key, env, f),
      isSet: currentValue(f.key, env, f) !== f.defaultRaw,
      enumValues: f.enumValues ?? null,
      section: SECTIONS.find(s => s.key === f.section)?.label ?? f.section,
    }));
    stdout.write(JSON.stringify({ fields: result }, null, 2) + '\n');
    return;
  }

  if (cmd === 'set') {
    const pairs: Array<{ key: string; value: string }> = [];
    for (const arg of sub.slice(1)) {
      const eq = arg.indexOf('=');
      if (eq === -1) continue;
      pairs.push({ key: arg.slice(0, eq), value: arg.slice(eq + 1) });
    }

    if (pairs.length === 0) {
      stdout.write(JSON.stringify({ applied: 0, errors: [{ error: 'No KEY=VALUE pairs provided' }], file: ENV_PATH }, null, 2) + '\n');
      return;
    }

    const fields = buildFields();
    const errors: Array<{ key: string; input: string; error: string }> = [];
    const toApply: Record<string, string> = {};

    for (const { key, value } of pairs) {
      const field = fields.find(f => f.key === key);
      if (!field) {
        errors.push({ key, input: value, error: 'Unknown config key' });
        continue;
      }
      const parsed = parseInput(value, field);
      if (parsed.error) {
        errors.push({ key, input: value, error: parsed.error });
        continue;
      }
      toApply[key] = toEnv(parsed.value!, field.fieldType);
    }

    if (Object.keys(toApply).length > 0) {
      const env = loadEnv();
      const changes = new Map(Object.entries(toApply));
      applyChanges(env, changes, true);
    }

    stdout.write(JSON.stringify({ applied: Object.keys(toApply).length, errors, file: ENV_PATH }, null, 2) + '\n');
    return;
  }

  // Unknown subcommand
  stdout.write(JSON.stringify({ error: `Unknown json command '${cmd}'. Use 'get' or 'set'.` }, null, 2) + '\n');
}

const isDirectEntry = process.argv[1]?.split(/[/\\]/).pop()?.startsWith('configure');
if (isDirectEntry) {
  main();
}
