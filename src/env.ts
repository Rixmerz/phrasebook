// Reads the API key from ~/.config/phrasebook/env (or the older ~/.config/glosa/env)
// so it never lives in the repo.
export async function loadEnv() {
  if (Deno.env.get("ANTHROPIC_API_KEY")) return;
  const home = Deno.env.get("HOME");
  let text: string;
  try {
    text = await Deno.readTextFile(`${home}/.config/phrasebook/env`);
  } catch {
    text = await Deno.readTextFile(`${home}/.config/glosa/env`);
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) Deno.env.set(m[1], m[2]);
  }
}
