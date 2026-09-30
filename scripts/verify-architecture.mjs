import fs from "node:fs";
import path from "node:path";

const acceptedAdrs = [
  "ADR-001.md",
  "ADR-002.md",
  "ADR-003A.md",
  "ADR-004.md",
  "ADR-005.md",
  "ADR-006.md",
  "ADR-007.md",
];

class ArchitectureBoundaryError extends Error {
  constructor(message) {
    super(`ARCHITECTURE_BOUNDARY_VIOLATION: ${message}`);
    this.name = "ArchitectureBoundaryError";
  }
}

function assertAcceptedAdrs() {
  for (const file of acceptedAdrs) {
    const adrPath = `docs/architecture/adr/${file}`;
    if (!fs.existsSync(adrPath)) {
      throw new Error(`Missing architecture decision: ${file}`);
    }
    const text = fs.readFileSync(adrPath, "utf8");
    if (/^Status: accepted$/m.test(text) === false) {
      throw new Error(`ADR not accepted: ${file}`);
    }
  }
}

function walk(root) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const item = path.posix.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...walk(item));
    } else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      output.push(item);
    }
  }
  return output;
}

function importSpecifiers(source) {
  const specs = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"'\n]*?\s+from\s+)?["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) specs.push(match[1]);
  }
  return specs;
}

function internalTarget(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), specifier)
  );
}

function moduleInfo(file) {
  const match = file.match(/^packages\/modules\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  return { name: match[1], rest: match[2] ?? "" };
}

function isModulePublicApi(target, moduleName) {
  const root = `packages/modules/${moduleName}`;
  const normalized = target.replace(/\.(?:js|ts|tsx|mjs|cjs)$/, "");
  return normalized === root || normalized === `${root}/index`;
}

function validateDependency(fromFile, specifier) {
  const target = internalTarget(fromFile, specifier);
  if (!target) return;

  const sourceModule = moduleInfo(fromFile);
  const targetModule = moduleInfo(target);

  if (
    targetModule &&
    (!sourceModule || sourceModule.name !== targetModule.name)
  ) {
    if (!isModulePublicApi(target, targetModule.name)) {
      throw new ArchitectureBoundaryError(
        `${fromFile} deep-imports module ${targetModule.name} via ${specifier}; use its index.ts public API`
      );
    }
  }

  if (sourceModule) {
    const sourceLayer = sourceModule.rest.split("/")[0] ?? "";

    if (target.startsWith("apps/")) {
      throw new ArchitectureBoundaryError(
        `${fromFile} imports application composition code via ${specifier}`
      );
    }

    if (sourceLayer === "domain") {
      if (
        target.startsWith("packages/infrastructure/") ||
        target.includes(`packages/modules/${sourceModule.name}/application/`) ||
        target.includes(`packages/modules/${sourceModule.name}/infrastructure/`)
      ) {
        throw new ArchitectureBoundaryError(
          `${fromFile} domain layer depends outward via ${specifier}`
        );
      }
    }

    if (sourceLayer === "application") {
      if (
        target.startsWith("packages/infrastructure/") ||
        target.includes(`packages/modules/${sourceModule.name}/infrastructure/`)
      ) {
        throw new ArchitectureBoundaryError(
          `${fromFile} application layer depends on infrastructure via ${specifier}`
        );
      }
    }
  }

  if (
    fromFile.startsWith("packages/infrastructure/") &&
    target.startsWith("apps/")
  ) {
    throw new ArchitectureBoundaryError(
      `${fromFile} shared infrastructure imports an app composition root via ${specifier}`
    );
  }
}

function validateSource(fromFile, source) {
  for (const specifier of importSpecifiers(source)) {
    validateDependency(fromFile, specifier);
  }
}

function validateRepository() {
  for (const root of ["packages/modules", "packages/infrastructure", "apps"]) {
    for (const file of walk(root)) {
      validateSource(file, fs.readFileSync(file, "utf8"));
    }
  }
}

function runRegressionFixture(fixturePath) {
  const source = fs.readFileSync(fixturePath, "utf8");
  const match = source.match(/^\/\/\s*virtual-path:\s*(\S+)\s*$/m);
  if (!match)
    throw new Error("Architecture regression fixture missing virtual-path");
  try {
    validateSource(match[1], source);
  } catch (error) {
    if (error instanceof ArchitectureBoundaryError) {
      console.log(error.message);
      console.log("ARCHITECTURE_REGRESSION_DETECTED");
      return;
    }
    throw error;
  }
  throw new Error("ARCHITECTURE_REGRESSION_NOT_DETECTED");
}

assertAcceptedAdrs();

const fixtureIndex = process.argv.indexOf("--regression-fixture");
if (fixtureIndex >= 0) {
  const fixturePath = process.argv[fixtureIndex + 1];
  if (!fixturePath) throw new Error("--regression-fixture requires a path");
  runRegressionFixture(fixturePath);
} else {
  validateRepository();
  console.log("ARCHITECTURE_BOUNDARIES_OK");
}
