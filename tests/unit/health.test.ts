import { describe, expect, it } from "vitest";
import { buildServer } from "../../apps/api/src/server";

describe("GET /health", () => {
  it("returns bootstrap health status", async () => {
    const server = buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "LEVEXx API (bootstrap)",
    });

    await server.close();
  });
});
