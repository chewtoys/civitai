#!/usr/bin/env node

/**
 * XGuard Policy Manager
 *
 * Read, replace, reset, export, and import XGuard policy options on the
 * orchestrator (`/v1/manager/xguard/*` admin endpoints).
 *
 * Usage:
 *   node .claude/skills/xguard-manager/manage.mjs get <mode>
 *   node .claude/skills/xguard-manager/manage.mjs defaults <mode>
 *   node .claude/skills/xguard-manager/manage.mjs put <mode> -f file.json --writable
 *   node .claude/skills/xguard-manager/manage.mjs reset <mode> --writable
 *   node .claude/skills/xguard-manager/manage.mjs export [-o file.json]
 *   node .claude/skills/xguard-manager/manage.mjs import -f file.json --writable
 *
 * Options:
 *   --writable      Allow destructive operations (put / reset / import)
 *   --file, -f      Path to JSON body (required for put / import)
 *   --output, -o    Save response to file instead of stdout
 *   --quiet, -q     Only print the response body
 *   --timeout, -t   Request timeout in seconds (default: 30)
 *
 * Env (from project .env):
 *   ORCHESTRATOR_ENDPOINT      base URL of the orchestrator
 *   ORCHESTRATOR_ACCESS_TOKEN  system bearer token
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillDir = __dirname;
const projectRoot = resolve(__dirname, '../../..');

function loadEnv() {
  const envFiles = [resolve(skillDir, '.env'), resolve(projectRoot, '.env')];
  for (const envPath of envFiles) {
    try {
      const envContent = readFileSync(envPath, 'utf-8');
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex);
        const value = trimmed.slice(eqIndex + 1);
        if (!process.env[key]) process.env[key] = value;
      }
    } catch {
      // file not found, continue
    }
  }
}
loadEnv();

const DEFAULT_TIMEOUT_SECONDS = 30;
const VALID_MODES = new Set(['text', 'prompt']);
const DESTRUCTIVE_COMMANDS = new Set(['put', 'reset', 'import']);

// Parse args
const args = process.argv.slice(2);
let command = '';
let mode = '';
let writable = false;
let filePath = '';
let outputPath = '';
let quiet = false;
let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
const positional = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--writable') {
    writable = true;
  } else if (arg === '--file' || arg === '-f') {
    filePath = args[++i] || '';
  } else if (arg === '--output' || arg === '-o') {
    outputPath = args[++i] || '';
  } else if (arg === '--quiet' || arg === '-q') {
    quiet = true;
  } else if (arg === '--timeout' || arg === '-t') {
    const val = args[++i];
    if (!val || isNaN(parseInt(val, 10))) {
      console.error('Error: --timeout requires a number (seconds)');
      process.exit(1);
    }
    timeoutSeconds = parseInt(val, 10);
  } else if (!arg.startsWith('-')) {
    positional.push(arg);
  } else {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
}

command = positional[0] || '';

function usage(msg) {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error(
    `Usage: node manage.mjs <command> [args] [options]

Commands:
  get <mode>          GET current options (mode: text | prompt)
  defaults <mode>     GET hardcoded defaults
  put <mode>          PUT options (requires --writable + --file)
  reset <mode>        POST reset to defaults (requires --writable)
  export              GET bulk export across all modes
  import              PUT bulk import (requires --writable + --file)

Options:
  --writable          Allow destructive operations
  --file, -f <path>   JSON body for put / import
  --output, -o <path> Save response to file
  --quiet, -q         Only print response body
  --timeout, -t <s>   Request timeout in seconds (default: ${DEFAULT_TIMEOUT_SECONDS})

Examples:
  node manage.mjs get prompt
  node manage.mjs defaults prompt -o defaults.json
  node manage.mjs put prompt -f policies.json --writable
  node manage.mjs reset prompt --writable
  node manage.mjs export -o backup.json
  node manage.mjs import -f backup.json --writable`
  );
  process.exit(1);
}

if (!command) usage();

const needsMode = ['get', 'defaults', 'put', 'reset'].includes(command);
if (needsMode) {
  mode = positional[1] || '';
  if (!mode) usage(`Command "${command}" requires a mode argument (text | prompt)`);
  if (!VALID_MODES.has(mode)) usage(`Invalid mode "${mode}". Must be one of: text, prompt`);
}

if (DESTRUCTIVE_COMMANDS.has(command) && !writable) {
  usage(
    `Command "${command}" is destructive — pass --writable to confirm.\n` +
      `This will change orchestrator state for every subsequent XGuard scan.`
  );
}

if ((command === 'put' || command === 'import') && !filePath) {
  usage(`Command "${command}" requires --file <path> for the JSON body.`);
}

const endpoint = process.env.ORCHESTRATOR_ENDPOINT;
const token = process.env.ORCHESTRATOR_ACCESS_TOKEN;
if (!endpoint) {
  console.error('Error: ORCHESTRATOR_ENDPOINT is not set in env (.env)');
  process.exit(1);
}
if (!token) {
  console.error('Error: ORCHESTRATOR_ACCESS_TOKEN is not set in env (.env)');
  process.exit(1);
}

function pathFor() {
  switch (command) {
    case 'get':
      return { method: 'GET', path: `/v1/manager/xguard/options/${mode}` };
    case 'defaults':
      return { method: 'GET', path: `/v1/manager/xguard/options/${mode}/defaults` };
    case 'put':
      return { method: 'PUT', path: `/v1/manager/xguard/options/${mode}` };
    case 'reset':
      return { method: 'POST', path: `/v1/manager/xguard/options/${mode}/reset` };
    case 'export':
      return { method: 'GET', path: `/v1/manager/xguard/export` };
    case 'import':
      return { method: 'PUT', path: `/v1/manager/xguard/import` };
    default:
      usage(`Unknown command: ${command}`);
      return null;
  }
}

function readBody() {
  if (!filePath) return undefined;
  let raw;
  try {
    raw = readFileSync(resolve(process.cwd(), filePath), 'utf-8');
  } catch (e) {
    console.error(`Error reading body file ${filePath}: ${e.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Error: --file ${filePath} is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  const { method, path } = pathFor();
  const url = `${endpoint}${path}`;

  const hasBody = method === 'PUT' || method === 'POST';
  let body;
  if (hasBody) {
    const fileBody = readBody();
    // reset has no body; put/import require a file
    body = fileBody !== undefined ? fileBody : command === 'reset' ? {} : undefined;
  }

  if (!quiet) {
    const safetyTag = DESTRUCTIVE_COMMANDS.has(command) ? ' [DESTRUCTIVE]' : '';
    console.error(`${method} ${url}${safetyTag} (timeout: ${timeoutSeconds}s)\n`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  let res;
  try {
    res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      console.error(`Error: Request timed out after ${timeoutSeconds} seconds`);
    } else {
      console.error(`Error: ${e.message}`);
    }
    process.exit(1);
  }
  clearTimeout(timeoutId);

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}`);
    if (parsed != null) console.error(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2));
    process.exit(1);
  }

  const output = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);

  if (outputPath) {
    writeFileSync(resolve(process.cwd(), outputPath), output);
    if (!quiet) console.error(`Saved response to ${outputPath}`);
  } else {
    console.log(output);
  }
}

main();
