import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const fixtures: string[] = [];
function check(source: string, layer = "domain"): void {
  const root = mkdtempSync(path.join(tmpdir(), "levex-architecture-"));
  fixtures.push(root);
  cpSync("docs/architecture/adr", path.join(root, "docs/architecture/adr"), {
    recursive: true,
  });
  mkdirSync(path.join(root, "packages/domain"), { recursive: true });
  writeFileSync(
    path.join(root, "packages/domain/allowed.ts"),
    "export const value = 1;"
  );
  mkdirSync(path.join(root, "packages", layer), { recursive: true });
  writeFileSync(path.join(root, "packages/domain/example.ts"), source);
  if (layer === "application") {
    writeFileSync(path.join(root, "packages/domain/example.ts"), "export {};");
    writeFileSync(path.join(root, "packages/application/example.ts"), source);
  }
  execFileSync(process.execPath, ["scripts/verify-architecture.mjs", root], {
    stdio: "pipe",
  });
}
afterEach(() => {
  for (const root of fixtures.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("application dependency boundary", () => {
  it("permits application-to-domain imports", () => {
    expect(() =>
      check('import { value } from "../domain/allowed";', "application")
    ).not.toThrow();
  });
  it.each([
    'import { Pool } from "pg";',
    'import { adapter } from "../infrastructure/database";',
    'const response = fetch("https://example.test");',
    'export { api } from "../../apps/api";',
  ])("rejects application I/O or reversed dependency: %s", (source) => {
    expect(() => check(source, "application")).toThrow();
  });
});

describe("executable domain architecture guard", () => {
  it("permits domain-to-domain imports and caller-provided time", () => {
    expect(() =>
      check(
        'import { value } from "./allowed"; export const at = new Date(value).toISOString();'
      )
    ).not.toThrow();
  });
  it.each([
    'import { Pool } from "pg";',
    'import fastify from "fastify";',
    'import OpenAI from "openai";',
    'import fs from "node:fs";',
    'import type { Pool } from "pg";',
    'export { value } from "../infrastructure/database";',
    'const p = import("pg");',
    "const p = import(path);",
    'type P = import("pg").Pool;',
    'const p = require("pg");',
    "const n = Date.now();",
    "const n = new Date();",
    "const n = Math.random();",
    'const n = Date["now"]();',
    'const n = globalThis["process"];',
    'const p = fetch("https://example.test");',
  ])("rejects forbidden source: %s", (source) => {
    expect(() => check(source)).toThrow();
  });
});
