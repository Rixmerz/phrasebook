// Blind task sets kept outside git (private/<name>/tasks.ts) until the paper is published.
// Each is distributed privately and frozen by the sha256 in docs/preregistration-crossvendor.md;
// when its folder is missing the suite is simply not registered.
import type { State } from "./mock.ts";
import type { GhTask } from "./tasks.ts";

export type PrivateSet = { name: string; seed: () => State; tasks: (lang: "es" | "en") => GhTask[] };

async function load(name: string): Promise<PrivateSet | null> {
  const url = new URL(`../../private/${name}/tasks.ts`, import.meta.url);
  try {
    Deno.statSync(url);
  } catch {
    return null;
  }
  const m = await import(url.href);
  return { name, seed: m[`${name}Seed`], tasks: m[`${name}Tasks`] };
}

// github-beacon (Spanish prompts) and github-beacon-en (the same tasks in English).
export const privateSets = (await Promise.all(["beacon"].map(load))).filter((s): s is PrivateSet => s !== null);
