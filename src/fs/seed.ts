// Seeds a fresh workspace directory for the filesystem tasks.
import { FS_SEED } from "./tasks.ts";

export function seedFs(dir: string) {
  for (const [path, content] of Object.entries(FS_SEED)) {
    const full = `${dir}/${path}`;
    Deno.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    Deno.writeTextFileSync(full, content);
  }
}
