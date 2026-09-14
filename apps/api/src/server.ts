import Fastify from "fastify";

export function buildServer() {
  const server = Fastify({ logger: false });

  server.get("/health", async () => ({
    status: "ok",
    service: "LEVEXx API (bootstrap)",
  }));

  return server;
}
