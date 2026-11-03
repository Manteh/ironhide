#!/usr/bin/env node
// Thin MCP client. All logic lives in the IronHide daemon (src/daemon.js);
// this process mirrors the tool schemas and forwards each call over HTTP.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { tools } from "../src/tools.js";
import { isDaemonRunning } from "../src/daemon.js";
import { WEB_PORT } from "../src/web-server.js";

const BASE = `http://127.0.0.1:${WEB_PORT}`;
const DAEMON = fileURLToPath(new URL("../src/daemon.js", import.meta.url));

async function ensureDaemon() {
  if (await isDaemonRunning()) return;
  spawn(process.execPath, [DAEMON], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isDaemonRunning()) return;
  }
  throw new Error("IronHide daemon did not start (is something else on port " + WEB_PORT + "?)");
}

const server = new McpServer({ name: "ironhide", version: "2.0.0" });

for (const [name, { handler, ...def }] of Object.entries(tools)) {
  server.registerTool(name, def, async (args) => {
    try {
      await ensureDaemon();
      const r = await fetch(`${BASE}/api/tools/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      return data;
    } catch (err) {
      return { content: [{ type: "text", text: `IronHide error: ${err.message}` }] };
    }
  });
}

await server.connect(new StdioServerTransport());
console.error("IronHide MCP client running");
