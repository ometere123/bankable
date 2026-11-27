// Tier 2 probe: connect to the QIE Wallet MCP over Streamable HTTP with the official TypeScript SDK; list tools; call qie_reverse_lookup.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const client = new Client({ name: "bankable-probe", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.qie.digital/mcp")));
const tools = await client.listTools();
console.log(JSON.stringify(tools.tools.map((t) => ({ name: t.name, description: t.description?.slice(0, 160), schema: t.inputSchema, annotations: (t as any).annotations })), null, 2));
const addr = process.argv[2] ?? "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const r = await client.callTool({ name: "qie_reverse_lookup", arguments: { address: addr } });
console.log("RESULT for", addr, JSON.stringify(r).slice(0, 600));
await client.close();
