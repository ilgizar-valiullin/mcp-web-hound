#!/usr/bin/env node

import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import process, { stdout } from 'node:process';

function printHelp(): void {
  stdout.write(`
MCP Web Hound — Search Log Export Tool

Exports search log entries from the SQLite database for training dataset generation.

Usage:
  npx mcp-web-hound-export-logs                     Dump all search log entries (JSON)
  npx mcp-web-hound-export-logs --export             Only entries with agent_usage (training subset)
  npx mcp-web-hound-export-logs --jsonl              JSONL format (one JSON object per line)
  npx mcp-web-hound-export-logs --export --jsonl     Training dataset in JSONL format
  npx mcp-web-hound-export-logs --db <path>          Specify a custom database path
  npx mcp-web-hound-export-logs --help               Show this help

Database search order (unless --db is provided):
  1. ./data/search.db                          (project-local)
  2. ~/.mcp-web-hound/data/search.db           (npx runtime)
  3. ~/.config/mcp-web-hound/data/search.db    (config dir)

Export filter:
  --export   Only includes rows where agent_usage IS NOT NULL,
             i.e. searches where the agent reported which results
             were actually used. This is the training-ready subset.

Examples:
  npx mcp-web-hound-export-logs
  npx mcp-web-hound-export-logs --export --jsonl > training-data.jsonl
  npx mcp-web-hound-export-logs --db ./data/search.db --export
`);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const format = args.includes('--jsonl') ? 'jsonl' : 'json';
  const exportOnly = args.includes('--export');

  const possiblePaths: string[] = [
    resolve(process.cwd(), 'data', 'search.db'),
    resolve(homedir(), '.mcp-web-hound', 'data', 'search.db'),
    resolve(homedir(), '.config', 'mcp-web-hound', 'data', 'search.db'),
  ];

  const dbFlagIndex = args.indexOf('--db');
  let dbPath: string | undefined;
  if (dbFlagIndex !== -1 && args[dbFlagIndex + 1]) {
    dbPath = resolve(process.cwd(), args[dbFlagIndex + 1]);
    if (!existsSync(dbPath)) {
      console.error(`Database not found: ${dbPath}`);
      process.exit(1);
    }
  } else {
    for (const p of possiblePaths) {
      if (existsSync(p)) { dbPath = p; break; }
    }
  }

  if (!dbPath) {
    console.error('Search database not found. Tried:');
    for (const p of possiblePaths) console.error('  -', p);
    console.error('Use: --db <path> to specify database location');
    process.exit(1);
  }

  const db = new Database(dbPath);
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='search_logs'"
  ).get();
  if (!tableExists) {
    console.error(`Database "${dbPath}" has no search_logs table.`);
    console.error('Make sure the server is v1.10.0+ and SEARCH_LOG_ENABLED=true.');
    process.exit(1);
  }

  const condition = exportOnly
    ? 'WHERE agent_usage IS NOT NULL'
    : 'WHERE 1=1';

  const rows = db.prepare(
    `SELECT search_id, data_json, agent_usage, created_at FROM search_logs ${condition} ORDER BY created_at`
  ).all() as { search_id: string; data_json: string; agent_usage: string | null; created_at: string }[];

  const entries = rows.map(r => {
    const entry = JSON.parse(r.data_json);
    entry.agent_usage = r.agent_usage ? JSON.parse(r.agent_usage) : null;
    entry._logged_at = r.created_at;
    return entry;
  });

  if (format === 'jsonl') {
    for (const e of entries) console.log(JSON.stringify(e));
  } else {
    console.log(JSON.stringify(entries, null, 2));
  }

  if (entries.length === 0) {
    console.error('No search log entries found.');
  }

  db.close();
}

main();
