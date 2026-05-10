import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import oauthRouter from "./auth/oauth.js";
import { authenticateToken } from "./auth/middleware.js";
import { registerAllTools } from "./tools/register.js";
import pool from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { GRACEFUL_SHUTDOWN_TIMEOUT_MS } from "./constants.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// ─── Security Middleware ─────────────────────────────────────────────────────
app.disable("x-powered-by");
app.set("trust proxy", 1); // Trust exactly one proxy hop
app.use(helmet({
  contentSecurityPolicy: false, // MCP responses are JSON, not HTML pages
}));
app.use(cors({
  origin: process.env.MCP_OAUTH_ISSUER || "*",
  credentials: false,
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ─── OAuth Routes (unauthenticated) ─────────────────────────────────────────
app.use(oauthRouter);

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "unhealthy", timestamp: new Date().toISOString() });
  }
});

// ─── MCP Endpoint (authenticated) ───────────────────────────────────────────
app.post("/mcp", authenticateToken, async (req, res) => {
  const userId = req.userId!;

  try {
    // Create a fresh MCP server instance per request (stateless)
    const mcpServer = new McpServer({
      name: "sparkyfitness-mcp-server",
      version: "1.0.0",
    });

    // Register all tools for this user
    registerAllTools(mcpServer, userId);

    // Create stateless transport
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless - no sessions
      enableJsonResponse: true,
    });

    // Clean up on response close
    res.on("close", () => {
      transport.close();
    });

    // Connect and handle the request
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP] Request handling error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ─── Custom 404 Handler ──────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ─── Custom Error Handler (no stack traces in production) ────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Server] Unhandled error:", err.message);
  if (process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  }
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start Server ────────────────────────────────────────────────────────────
async function start() {
  // Run migrations on startup (safe to run multiple times — uses IF NOT EXISTS)
  try {
    await runMigrations();
  } catch (error) {
    console.error("[MCP] Failed to run migrations, exiting:", error);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`[MCP] SparkyFitness MCP Server running on port ${PORT}`);
    console.log(`[MCP] OAuth issuer: ${process.env.MCP_OAUTH_ISSUER || "not set"}`);
    console.log(`[MCP] Environment: ${process.env.NODE_ENV || "development"}`);
  });

  // ─── Graceful Shutdown ───────────────────────────────────────────────────────
  function gracefulShutdown(signal: string) {
    console.log(`[MCP] ${signal} received, shutting down gracefully...`);
    server.close(() => {
      console.log("[MCP] HTTP server closed");
      pool.end().then(() => {
        console.log("[MCP] Database pool closed");
        process.exit(0);
      }).catch(() => {
        process.exit(1);
      });
    });

    // Force exit after timeout
    setTimeout(() => {
      console.error("[MCP] Forced shutdown after timeout");
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

start();
