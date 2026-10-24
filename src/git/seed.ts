// Seeds a fresh repository for the git tasks, with fixed authors and dates.
import { git, GIT_FEATURE, GIT_FEATURE_FROM, GIT_MAIN, GIT_WORKTREE, type SeedCommit } from "./tasks.ts";

// Identity used for commits the agent makes through the server.
export const AGENT_GIT_ENV = {
  GIT_AUTHOR_NAME: "agent", GIT_AUTHOR_EMAIL: "agent@example.com",
  GIT_COMMITTER_NAME: "agent", GIT_COMMITTER_EMAIL: "agent@example.com",
};

function write(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const full = `${dir}/${path}`;
    Deno.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    Deno.writeTextFileSync(full, content);
  }
}

function commit(dir: string, c: SeedCommit) {
  write(dir, c.files);
  git(dir, "add", ...Object.keys(c.files));
  const out = new Deno.Command("git", {
    args: ["-C", dir, "commit", "-q", "-m", c.message],
    env: {
      GIT_AUTHOR_NAME: c.author, GIT_AUTHOR_EMAIL: `${c.author}@example.com`, GIT_AUTHOR_DATE: c.date,
      GIT_COMMITTER_NAME: c.author, GIT_COMMITTER_EMAIL: `${c.author}@example.com`, GIT_COMMITTER_DATE: c.date,
    },
  }).outputSync();
  if (!out.success) throw new Error(`seed commit failed: ${new TextDecoder().decode(out.stderr)}`);
}

export function seedGit(dir: string) {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "agent");
  git(dir, "config", "user.email", "agent@example.com");
  GIT_MAIN.slice(0, GIT_FEATURE_FROM).forEach((c) => commit(dir, c));
  git(dir, "branch", "feature/login");
  GIT_MAIN.slice(GIT_FEATURE_FROM).forEach((c) => commit(dir, c));
  git(dir, "checkout", "-q", "feature/login");
  GIT_FEATURE.forEach((c) => commit(dir, c));
  git(dir, "checkout", "-q", "main");
  write(dir, GIT_WORKTREE.modified);
  write(dir, GIT_WORKTREE.staged);
  git(dir, "add", ...Object.keys(GIT_WORKTREE.staged));
  write(dir, GIT_WORKTREE.untracked);
}
