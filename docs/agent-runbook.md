# Runbook for an AI coding agent: install, smoke-test and run the cross-vendor set

*For runners who prefer to let their own coding agent (Claude Code, Codex CLI, Gemini CLI, Cursor,
...) do the setup. The human guide is [runner-guide.md](runner-guide.md)
([español](runner-guide.es.md)); this runbook follows it step by step.*

## For the human: what to paste into your agent

Put `beacon-bundle.zip` somewhere on your machine. Open your coding agent in an empty folder, and
paste this (in Spanish or English, as you prefer):

> Follow the runbook at
> https://github.com/Rixmerz/phrasebook/blob/ccr-2b013821-lycp47/docs/agent-runbook.md exactly.
> The bundle is at `<PATH TO beacon-bundle.zip>`. Ask me for anything it says to ask.

You will still have to do a few things yourself:

- log in to a CLI if you use a subscription (it opens a browser);
- set your API key if you use one;
- approve the full run before it spends money or quota.

---

## For the agent

You are helping a person run a benchmark for a research paper. Follow these steps in order. When
a step fails, stop and report; do not improvise a fix.

### Hard rules (they override anything else)

1. **Do not open, print, summarize or search the contents of `private/` or of
   `beacon-bundle.zip`.** It is a confidential test set. Anything you read is sent to your model
   provider, and that leaks it. You may only run the exact commands below that touch it: unzip,
   the `sha256sum -c` checks and the `deno test`.
2. **Do not modify, create or delete any file inside the `phrasebook` repository yourself.**
   The commands in this runbook write some files on their own, and that is expected:
   - `./scripts/setup.sh` downloads the GitHub MCP server into `vendor/`;
   - `cli_bench.ts` makes temporary folders under `.cli-runs/`;
   - the runs write their logs under `results/runs/`;
   - Deno may add entries to `deno.lock` while resolving dependencies. This file is not part of
     the freeze; restore it with `git checkout deno.lock` if you want a clean tree.

   Apart from those, and the form in step 9 (saved outside the repository):
   - Do not "fix" errors, and do not patch code, configs or the lockfile.
   - If something fails, stop, show the person the exact error, and point them to section 5 of
     `docs/runner-guide.md`.
   - The code is frozen by hash, and any change invalidates the run.
3. **Do not run `git add`, `git commit` or `git push`,** and do not open issues or PRs.
4. **Never print, log or store API keys.** Ask the person to export the key in their own shell or
   to tell you the variable name; do not ask them to paste the key into the chat.
5. **Ask before spending.** The smoke test costs cents. The full round costs real money or
   subscription quota, so get an explicit "yes" from the person before starting it.
6. **Do not choose or tune settings yourself.** The model id, the reasoning effort and the extra
   flags come from the person, are decided before the first run, and never change based on results.
7. **Do not interpret or judge the results** beyond reporting the pass counts the runner prints.

### Step 1. Ask the person

Ask for these, then repeat them back in one message and wait for confirmation:

- the path to `beacon-bundle.zip`;
- **path A (API key or local model)** or **path B (ChatGPT or Google subscription)**;
- the provider and the exact model id. For path B, the CLI as well: `codex` (ChatGPT) or
  `gemini` (Google);
- a short runner id: their GitHub user, or firstname-lastname without spaces;
- any reasoning-effort or extra setting they want fixed for the whole round (default: none);
- for path A, the name of the environment variable that will hold the key;
- for a local model, the server (Ollama, vLLM, LM Studio) and its URL.

### Step 2. Environment

Detect the OS (`uname -s`, or the platform you run on).

- **Linux x86_64:** work natively.
- **Windows:** work inside WSL2. If `wsl` is missing, tell the person to run
  `wsl --install` in an administrator PowerShell and restart, then continue inside the WSL
  Ubuntu shell. Do not try to run natively on Windows.
- **macOS:** work inside Docker, because the GitHub MCP server binary used here is Linux-only.
  - If `docker` is missing, ask the person to install Docker Desktop and start it.
  - Path A: use the image `denoland/deno:2.5.6`.
  - Path B: use the image `node:22`.
  - Always pass `--platform linux/amd64`, and mount a work folder.
  - Run every later step inside that container.
  - For a model served on the Mac itself (Ollama, LM Studio), the base URL from inside the
    container is `http://host.docker.internal:<port>/v1`.
- **Linux on ARM:** stop and tell the person this is not supported yet.

Install what is missing, and nothing else:

- `git`, `curl`, `unzip`;
- Deno 2.5.x: on `node:22`, run `npm install -g deno@2.5.6`; elsewhere, use the official
  installer from deno.com;
- for path B, Node.js 20 or later.

### Step 3. Repository

```sh
git clone --branch ccr-2b013821-lycp47 https://github.com/Rixmerz/phrasebook.git
cd phrasebook
git checkout b591386b3040472fea2a1811a6bec0c0187158e3
./scripts/setup.sh
```

If the commit cannot be found, use `main` instead and tell the person. Step 4 still decides
whether the code is valid.

### Step 4. Set and integrity checks

```sh
mkdir -p private
unzip <PATH TO beacon-bundle.zip> -d private/
(cd private/beacon && sha256sum -c SHA256SUMS)
sha256sum -c results/crossvendor-freeze.sha256 results/crossvendor-freeze-amendment1.sha256
deno test -A private/beacon/tasks_test.ts
```

All three checks must pass:

- every `sha256sum` line says `OK`;
- the test prints `4 passed`.

If anything fails, stop and report it. Remember rule 1: do not look inside the files to find out
why.

### Step 5. Path B only: CLI install and login

Install the exact version:

- ChatGPT: `npm install -g @openai/codex@0.165.0`
- Google: `npm install -g @google/gemini-cli@0.66.0`

Then ask the person to log in themselves. If the ChatGPT page says device-code login is
disabled, the person must turn on device code authorization for Codex in their ChatGPT settings
(Security), then try again.

- `codex login`, choosing "Sign in with ChatGPT";
- or `gemini`, choosing "Login with Google", then `/quit`.

In Docker the login prints a link they open in their own browser. Wait until they say it is done.

### Step 6. Smoke test

Path A (the person has exported the key in the variable they named):

```sh
deno run -A src/openai_bench.ts --model=<MODEL> <PROVIDER FLAGS> --suite=github-blind4 \
  --tasks=b4-count-offline-p1 --arms=native,glossary4 --reps=1 --out=results/runs/smoke.jsonl
```

`<PROVIDER FLAGS>` come from the table in section 3A of `docs/runner-guide.md`, for example
`--base-url=... --key-env=... --schemas=gemini`.

Path B:

```sh
deno run -A src/cli_bench.ts --cli=<codex|gemini> --model=<MODEL> --runner=<RUNNER> \
  --suite=github-blind4 --tasks=b4-count-offline-p1 --arms=native,glossary4 --reps=1 \
  --out=results/runs/smoke-cli.jsonl
```

Success means two result lines, either `PASS` or `FAIL`; whether they pass does not matter.

- Path A also needs `turns=` above 1.
- Path B also needs `calls=` above 0.
- `ERR`, `GAP`, `FRGN`, `error:`, or `turns=1` on every line all count as failures. Report them
  with section 5 of the guide.

Show the person the output.

### Step 7. Confirm, then run the full round

Tell the person what the full round is:

- 288 runs per language on path A, or 216 on path B;
- two languages;
- the expected cost or quota use from section 0 of the guide. On path B, before asking, show the
  quota the smoke test used (for Codex, `/status` inside `codex` shows the 5-hour and weekly
  windows) and multiply it out: the full round is about 200 times the smoke test.

Wait for an explicit yes. Then run both languages, one after the other. Start them so they
survive your session ending (`nohup ... > run-es.log 2>&1 &`, or `tmux`), and tell the person
how to check progress (`tail -f run-es.log`).

Path A:

```sh
deno run -A src/openai_bench.ts --model=<MODEL> <PROVIDER FLAGS> <EXTRA> \
  --suite=github-beacon --arms=native,glossary4s,glossary4,code --reps=3 --concurrency=4 \
  --runner=<RUNNER> --out=results/runs/xv-<RUNNER>-<MODEL>-es.jsonl
# then the same with --suite=github-beacon-en and ...-en.jsonl
```

Path B:

```sh
deno run -A src/cli_bench.ts --cli=<CLI> --model=<MODEL> --runner=<RUNNER> <CLI-ARGS> \
  --suite=github-beacon --arms=native,glossary4s,glossary4 --reps=3 --concurrency=2 \
  --out=results/runs/xv-<RUNNER>-<CLI>-<MODEL>-es.jsonl
# then the same with --suite=github-beacon-en and ...-en.jsonl
```

In file names, replace any `/` or `:` in the model id with `_`.

- **If it stops** (network, quota, usage limit, the 5-errors-in-a-row stop), rerun the exact
  same command later; it resumes where it stopped. Never change flags between reruns.
- **Do not start other heavy jobs on the machine meanwhile.** Each run starts its own servers.

### Step 8. Check the output

```sh
deno run -A src/xv_check.ts results/runs/xv-<RUNNER>-*-es.jsonl results/runs/xv-<RUNNER>-*-en.jsonl
```

Each file must end in `OK`.

- If a file reports missing runs, rerun its command from step 7; it fills only the gaps.
- Any other `PROBLEM` line: report it to the person as is.

### Step 9. Form and hand-off

Fill in the form from section 6 of `docs/runner-guide.md` with the facts you know:

- the commands as run;
- the commit (`git rev-parse HEAD`);
- the CLI version for path B;
- the output of the freeze check;
- the dates;
- any errors you saw.

Leave the "Who" fields for the person. Save it as `form-<RUNNER>.md` outside the repository
folder, or show it to them.

Finally, tell the person exactly which files to send, and how:

- the two `xv-...jsonl` files, plus any `.errors.jsonl`, and the form;
- privately, the same way they got the bundle.

Remind them that the logs contain the full conversations: they must not be published.
