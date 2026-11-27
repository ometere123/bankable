// Writes the Solidity standard-JSON input used for the build, for explorer source verification (flow undocumented in the spec; see progress doc).
import fs from "node:fs";
const dir = "artifacts/build-info"; const f = fs.readdirSync(dir).find((x) => x.endsWith(".json"))!;
const bi = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
fs.mkdirSync("deployments", { recursive: true });
// Only the production contract: the G3 probe harness is never deployed and must not appear in the verification input.
const input = { ...bi.input, sources: { "contracts/StatementRegistry.sol": bi.input.sources["contracts/StatementRegistry.sol"] } };
fs.writeFileSync("deployments/standard-json-input.json", JSON.stringify(input, null, 2));
console.log(`compiler ${bi.solcLongVersion}; wrote deployments/standard-json-input.json (sources: ${Object.keys(input.sources).join(", ")})`);
