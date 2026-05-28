// Smoke test: connect a real MCP client to the AdLift MCP server and call tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] || "http://localhost:3030/mcp");
const transport = new StreamableHTTPClientTransport(url);
const client = new Client({ name: "adlift-test", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

const safety = await client.callTool({ name: "check_brand_safety", arguments: { headline: "The #1 Best Earbuds, Guaranteed", subcopy: "nothing beats them", rules: "no unverifiable superlatives" } });
console.log("\ncheck_brand_safety('#1 Best...Guaranteed'):\n" + safety.content[0].text);

const ctr = await client.callTool({ name: "predict_ctr", arguments: { headline: "Hear Every Footstep", subcopy: "ANC earbuds built for gamers", cta: "Try now", angle: "benefit", product: "Acme Buds Pro", audience: "gamers" } });
console.log("\npredict_ctr('Hear Every Footstep'):\n" + ctr.content[0].text);

await client.close();
console.log("\nMCP client smoke test OK");
