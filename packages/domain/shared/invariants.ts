export class DomainError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DomainError";
  }
}

export function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new DomainError(code);
}

export function identifier(value: string): void {
  ensure(
    typeof value === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(value),
    "INVALID_ID"
  );
}

export function timestamp(value: string): number {
  ensure(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value),
    "INVALID_TIMESTAMP"
  );
  const milliseconds = Date.parse(value);
  ensure(
    Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString() === value,
    "INVALID_TIMESTAMP"
  );
  return milliseconds;
}

// Domain records are JSON-compatible values, never class instances or I/O handles.
// Clone first so caller-owned input is neither retained nor frozen as a side effect.
export function immutable<T>(value: T): T {
  if (Array.isArray(value))
    return Object.freeze(value.map((item: unknown) => immutable(item))) as T;
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, immutable(item)])
      )
    ) as T;
  }
  return value;
}

export function exactKeys(value: object, keys: readonly string[]): void {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "INVALID_COMMAND"
  );
  ensure(
    Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
    "INVALID_COMMAND"
  );
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
