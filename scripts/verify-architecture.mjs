import fs from "node:fs";

const files = [
  "ADR-001.md",
  "ADR-002.md",
  "ADR-003A.md",
  "ADR-004.md",
  "ADR-005.md",
  "ADR-006.md",
  "ADR-007.md",
];

for (const file of files) {
  const path = `docs/architecture/adr/${file}`;

  if (fs.existsSync(path) === false) {
    throw new Error(`Missing architecture decision: ${file}`);
  }

  const text = fs.readFileSync(path, "utf8");

  if (/^Status: accepted$/m.test(text) === false) {
    throw new Error(`ADR not accepted: ${file}`);
  }
}
