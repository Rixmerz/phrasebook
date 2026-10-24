// Reads the API key from ~/.config/glosa/env so it never lives in the repo.
export async function loadEnv() {
  if (Deno.env.get("ANTHROPIC_API_KEY")) return;
  const path = `${Deno.env.get("HOME")}/.config/glosa/env`;
  const text = await Deno.readTextFile(path);
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) Deno.env.set(m[1], m[2]);
  }
}
