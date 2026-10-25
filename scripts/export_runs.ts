// Writes results/runs/<log>.jsonl: one line per scored run, without the full transcripts
// ("messages", "calls"), which stay in the gitignored results/*.jsonl.
// Local paths in the model's replies are replaced, so logs do not carry the machine's home.
// Usage: deno run -A scripts/export_runs.ts
const out = new URL("../results/runs/", import.meta.url).pathname;
Deno.mkdirSync(out, { recursive: true });
const home = Deno.env.get("HOME") ?? "/nonexistent";
const repoDir = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const scrub = (t: string) => t.replaceAll(repoDir, "<repo>").replaceAll(home, "~").replaceAll(home.replaceAll("/", "-"), "-home-user");
const dir = new URL("../results/", import.meta.url).pathname;
for (const e of Deno.readDirSync(dir)) {
  if (!e.isFile || !e.name.endsWith(".jsonl")) continue;
  const lines: string[] = [];
  for (const line of Deno.readTextFileSync(dir + e.name).split("\n")) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.kind !== "run") continue;
    delete r.messages;
    delete r.calls;
    lines.push(scrub(JSON.stringify(r)));
  }
  if (lines.length) Deno.writeTextFileSync(out + e.name, lines.join("\n") + "\n");
}
