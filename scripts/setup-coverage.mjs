#!/usr/bin/env node
// setup-coverage: fail when the code reads a setting the setup manifest doesn't
// list. Token-free and offline, so it can run in CI and in a repo's test script.
//
//   node setup-coverage.mjs setup.json [--root .] [--strict]
//
// Finds process.env.X, process.env["X"], import.meta.env.X and
// `const { X } = process.env`, plus any extra regexes in manifest.coverage.patterns
// (first capture group is the key). Platform keys (VERCEL_*, NODE_ENV, CI, ...)
// and manifest.coverage.ignore entries are skipped. --strict also fails on
// manifest keys the code never reads (a stale manifest).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const { positionals, values: options } = parseArgs({ allowPositionals: true,
  options: { root: { type: "string" }, strict: { type: "boolean", default: false } } });
if (!positionals[0]) { console.error("Usage: setup-coverage.mjs <setup.json> [--root dir] [--strict]"); process.exit(2); }
const manifestPath = resolve(positionals[0]);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const coverage = manifest.coverage ?? {};
const root = resolve(options.root ?? dirname(manifestPath));
const roots = (coverage.roots ?? ["."]).map((path) => resolve(root, path));
const skipDirs = new Set(["node_modules", ".next", ".vercel", "dist", "build", "coverage", ".git", "tests", "__tests__", "test-results", ...(coverage.skipDirs ?? [])]);
const sourceFile = /\.(?:[cm]?js|jsx|tsx?)$/;
const testFile = /\.(?:test|spec)\.[^.]+$/;
const platform = /^(?:VERCEL|VERCEL_.+|NEXT_PUBLIC_VERCEL_.+|NODE_ENV|NEXT_RUNTIME|NEXT_PHASE|CI|PORT|HOME|PATH|TZ|PWD)$/;
const builtIn = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
];
const extra = (coverage.patterns ?? []).map((source) => new RegExp(source, "gm"));
const destructure = /\{([^{}]*)\}\s*=\s*process\.env\b/g;

function* files(path) {
  const stat = statSync(path);
  if (stat.isFile()) { if (sourceFile.test(path) && !testFile.test(path)) yield path; return; }
  for (const name of readdirSync(path)) if (!skipDirs.has(name)) yield* files(join(path, name));
}

const reads = new Map(); // key -> first "file:line"
function record(key, file, text, index) {
  if (platform.test(key) || reads.has(key)) return;
  reads.set(key, `${relative(root, file)}:${text.slice(0, index).split("\n").length}`);
}
for (const start of roots) for (const file of files(start)) {
  const text = readFileSync(file, "utf8");
  for (const pattern of [...builtIn, ...extra]) for (const match of text.matchAll(pattern)) record(match[1], file, text, match.index);
  for (const match of text.matchAll(destructure))
    for (const part of match[1].split(",")) { const key = part.split(":")[0].trim(); if (/^[A-Z][A-Z0-9_]*$/.test(key)) record(key, file, text, match.index); }
}

const listed = new Set(manifest.env.map((item) => item.key));
const ignored = new Map((coverage.ignore ?? []).map((item) => [item.key, item.reason]));
const missing = [...reads].filter(([key]) => !listed.has(key) && !ignored.has(key));
// An item read through a computed name says so in `readBy`; it can't be found by pattern.
const declared = new Set(manifest.env.filter((item) => item.readBy).map((item) => item.key));
const stale = [...listed].filter((key) => !reads.has(key) && !declared.has(key));
for (const [key, where] of missing) console.log(`FAIL ${key}: read at ${where} but not in ${relative(process.cwd(), manifestPath)}. Add it to env (with why and owner) or to coverage.ignore with a reason.`);
for (const key of stale) console.log(`${options.strict ? "FAIL" : "warn"} ${key}: listed in the manifest, but no code read was found. Remove it, or add a coverage pattern that finds the read.`);
const failures = missing.length + (options.strict ? stale.length : 0);
console.log(failures ? `\n${failures} to fix.` : `\nAll ${reads.size} settings the code reads are in the manifest.`);
process.exit(failures ? 1 : 0);
