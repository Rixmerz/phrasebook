// Checks that the sandbox matches the frozen snapshot. Imports the suites first, because
// suite.ts and suites.ts import each other.
// Run: SANDBOX_TOKEN=$(gh auth token) PHRASEBOOK_REAL=1 deno run -A src/github/real/pristine.ts
import "../../suites.ts";
import { tokenFromEnv } from "./api.ts";
const { assertPristine } = await import("./suite.ts");
await assertPristine(Deno.env.get("SANDBOX_TOKEN") ?? tokenFromEnv());
console.log("sandbox matches the snapshot");
