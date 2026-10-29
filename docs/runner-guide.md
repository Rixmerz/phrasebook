# Running the set with other models (OpenAI, Google, open weights)

*Versión en español: [runner-guide.es.md](runner-guide.es.md). If the two differ, this one holds.*

*Prefer to let your own AI coding agent do the setup? See [agent-runbook.md](agent-runbook.md).*

Thank you for helping. You will run 24 GitHub tasks with your model, through four different ways
of giving it access to GitHub, and send us back a file with the results. You do not need to
understand how each way works; the runner takes care of it.

**Time.** 1 to 2 hours of machine time per model and per language, depending on the provider's
speed. A subscription takes longer because of its usage limits.

**Runs.** A full round is 24 tasks × 4 ways × 3 repetitions = 288 runs per language. With a
subscription it is 216, since that path has no `code` way.

## 0. API key or subscription?

There are two paths. Pick the one that matches what you have; both count for the paper.

| You have | Path | Runner | Tokens |
|---|---|---|---|
| An API key (OpenAI, Google AI Studio, OpenRouter, DeepSeek...) or a local model (Ollama, vLLM) | **A. API** (sections 2A to 4A) | `src/openai_bench.ts` | counted by the runner from what the API returns |
| Only a chat subscription: ChatGPT (Plus/Pro/Team) or Google AI (or a free Google account) | **B. Subscription** (section 4B) | `src/cli_bench.ts` | reported by the provider's official CLI (Codex CLI or Gemini CLI); the runner stores them |
| Only a Claude subscription | not needed | — | we run the Claude models ourselves |

On neither path do you count tokens yourself. The runner stores them on every line of the log
(`input_tokens`, `output_tokens`, `cached_tokens`), so you need no prices.

- **Cost, path A:** your account pays.
  - The `native` arm sends about 27k input tokens per turn. With a mid-priced model, expect 10 to
    40 USD per language.
  - A free Google AI Studio API key also works; it is slower because of the free tier's limits.
- **Cost, path B:** nothing extra in money, but a lot of quota: the full round is about 200 times
  the smoke test. Check your quota before and after the smoke test (Codex: `/status`) and
  multiply. On ChatGPT Plus with a large model and medium reasoning, one runner measured about
  1.5% of the 5-hour window and 0.5% of the weekly window per run, so the round takes several weeks
  of a Plus plan. A smaller model or lower reasoning effort uses less.
  - If you hit the limit, the runner stops by itself.
  - Run the same command again once the quota renews and it picks up where it stopped.

## Rules

1. **The set is private.** You receive it separately as `beacon-bundle.zip`. Do not upload it to
   any repository, public chat or service that trains on your data, and do not share it.
2. **Do not change the code or the set.** If something fails, tell us; do not fix it yourself. The
   set and the runners are frozen by hash (`results/crossvendor-freeze*.sha256`), and any change
   invalidates the run.
3. **Record exactly what you ran:** the provider, the exact model id, the quantization for a local
   model, and any `--extra` you pass.
4. **Use only the runners in this guide** (`openai_bench.ts` or `cli_bench.ts`).
   - Runs made in other tools (the web app, Cursor, Cline, another CLI) cannot be used, because
     they cannot be checked or compared with the rest.
   - Tokens written down by hand cannot be used either, for the same reason.
   - If your tool is not here, tell us and we will see whether it can be added.
5. **Do not look at the tasks to "help" the model**, and do not tune prompts or settings based on
   results. Choose your settings before the first run and keep them.

## 1. Set up

You need **Linux x86_64**; on macOS or Windows use Docker (below). Install
[Deno 2.5.x](https://deno.com), `git` and `curl`.

Use this exact branch and commit:

- Branch: `ccr-2b013821-lycp47`
- Commit: `b591386b3040472fea2a1811a6bec0c0187158e3`

```sh
git clone --branch ccr-2b013821-lycp47 https://github.com/Rixmerz/phrasebook.git
cd phrasebook
git checkout b591386b3040472fea2a1811a6bec0c0187158e3   # git says "detached HEAD": that is fine
./scripts/setup.sh         # downloads the GitHub MCP server and checks its checksum
```

If `git checkout` cannot find the commit (for example because the branch was merged), use
`main` and go on. What matters is that every file in the next step's check reports `OK`.

Put the set in place and check that it arrived intact:

```sh
mkdir -p private
unzip beacon-bundle.zip -d private/      # gives private/beacon/...
(cd private/beacon && sha256sum -c SHA256SUMS)   # every line must say OK
sha256sum -c results/crossvendor-freeze.sha256 results/crossvendor-freeze-amendment1.sha256   # frozen code and set: all OK
deno test -A private/beacon/tasks_test.ts   # 4 tests "ok", no model involved
```

`private/` is in `.gitignore`, so git will not upload it by accident. Even so, never run
`git add -f` on it.

**With Docker (macOS/Windows),** from the `phrasebook` folder:

```sh
docker run --rm -it --platform linux/amd64 -v "$PWD":/w -w /w denoland/deno:2.5.6 bash
apt-get update && apt-get install -y curl git   # inside the container
./scripts/setup.sh
```

If your model runs on your own machine (Ollama, LM Studio), use
`--base-url=http://host.docker.internal:11434/v1` from inside the container.

## 2A. Smoke test, API path (2 minutes, a few cents)

Before the real round, test the connection on a public set we already ran with Claude:

```sh
export OPENAI_API_KEY=...    # or your provider's variable, see section 3A
deno run -A src/openai_bench.ts --model=<MODEL> --suite=github-blind4 \
  --tasks=b4-count-offline-p1 --arms=native,glossary4 --reps=1 \
  --out=results/runs/smoke.jsonl
```

It should print two `PASS` or `FAIL` lines with `turns=` above 1. Whether they pass does not
matter here; only that the model reaches the tools. If you see `GAP`, `error:`, or `turns=1`
everywhere, check section 5 before going on.

## 3A. Choose a provider (API path)

The runner talks to any OpenAI-compatible Chat Completions API. Two flags select it:
`--base-url`, and `--key-env` (the name of the environment variable holding the key).

| Provider | Flags |
|---|---|
| OpenAI | (default) `--key-env=OPENAI_API_KEY` |
| Google Gemini | `--base-url=https://generativelanguage.googleapis.com/v1beta/openai --key-env=GEMINI_API_KEY --schemas=gemini` |
| OpenRouter (any model) | `--base-url=https://openrouter.ai/api/v1 --key-env=OPENROUTER_API_KEY` |
| Together, Groq, Fireworks, DeepInfra | each one's OpenAI-compatible `/v1` URL and key |
| DeepSeek | `--base-url=https://api.deepseek.com/v1 --key-env=DEEPSEEK_API_KEY --drop-fields=reasoning_content` |
| Ollama (local) | `--base-url=http://localhost:11434/v1 --key-env=` |
| vLLM / LM Studio / llama.cpp server | `--base-url=http://localhost:8000/v1 --key-env=` (adjust the port) |

Notes per provider:

- **Reasoning models** (OpenAI o-series and GPT-5, Gemini 2.5+, etc.): to fix the effort, pass
  `--extra='{"reasoning_effort":"low"}'` or your provider's field. Decide before you start and
  record it.
- **Local models** must support tool calling in your server.
  - **Ollama:** raise the context before starting it: `OLLAMA_CONTEXT_LENGTH=65536 ollama serve`.
    With the default context, the `native` arm (about 27k tokens of definitions alone) is silently
    truncated and everything fails.
  - **vLLM:** start it with `--enable-auto-tool-choice --tool-call-parser <your model's parser>
    --max-model-len 65536`.
  - Use `--concurrency=1` or `2` if your GPU cannot take more.
- **Prices:** for the log to compute USD, pass `--price-in` and `--price-out` in USD per million
  tokens. This is optional; we use the tokens.

## 4A. The round (API path)

One round per language, Spanish (`github-beacon`) and English (`github-beacon-en`):

```sh
deno run -A src/openai_bench.ts --model=<MODEL> <provider flags> \
  --suite=github-beacon --arms=native,glossary4s,glossary4,code --reps=3 --concurrency=4 \
  --runner=<your-id> --out=results/runs/xv-<your-id>-<model>-es.jsonl

deno run -A src/openai_bench.ts --model=<MODEL> <provider flags> \
  --suite=github-beacon-en --arms=native,glossary4s,glossary4,code --reps=3 --concurrency=4 \
  --runner=<your-id> --out=results/runs/xv-<your-id>-<model>-en.jsonl
```

- **Treat `--runner` as required.** Always pass the same short identifier: your GitHub user, or
  firstname-lastname without spaces.
  - It is stored on every line of the log, and it is how we tell whose contribution is whose.
  - It keeps two people running the same model apart.
  - Use it in the file name too, as in the example.
- Each run prints one line. At the end you get a summary per arm.
- **If it stops** (network, quota, Ctrl-C), run **the same command** again. It skips what is
  already in the file and retries the runs that ended in an API error.
- With budget to spare, add the optional `native-trimmed-compact` arm in a separate run with the
  same `--out`.
- Do not change `--max-turns` (20) or the other defaults.

What each arm is (not needed to run it):

- `native`: the official GitHub server's 40+ tools, as they are.
- `glossary4` / `glossary4s`: a single tool with a short command language. The `s` variant adds
  recipes meant for small models.
- `code`: the model writes JavaScript against an API generated from the tools.

## 4B. Subscription path: Codex CLI or Gemini CLI

You use your provider's official CLI with your usual login. The runner starts it without its
interface, in an empty folder, with its own tools switched off (no shell, files or web), so the
model can only use GitHub. You also need [Node.js](https://nodejs.org) 20 or later.

**1. Install the exact CLI version and log in** (once):

| Subscription | Install | Log in |
|---|---|---|
| ChatGPT | `npm install -g @openai/codex@0.165.0` | `codex login` (choose "Sign in with ChatGPT") |
| Google AI or Google account | `npm install -g @google/gemini-cli@0.66.0` | `gemini`, choose "Login with Google", then exit with `/quit` |

Inside Docker, the login prints a link: open it in your own machine's browser. The Deno image has
no Node, so for this path use the Node image and install Deno with npm:

```sh
docker run --rm -it --platform linux/amd64 -v "$PWD":/w -w /w node:22 bash
npm install -g deno@2.5.6 && ./scripts/setup.sh
```

**2. Smoke test** (uses a few requests of your quota):

```sh
deno run -A src/cli_bench.ts --cli=codex --model=<MODEL> --runner=<your-id> \
  --suite=github-blind4 --tasks=b4-count-offline-p1 --arms=native,glossary4 --reps=1 \
  --out=results/runs/smoke-cli.jsonl
```

(With Gemini, `--cli=gemini`.) It should print two `PASS` or `FAIL` lines with `calls=` above 0.

- **`ERR`:** read the message. It is usually the login, or a model your plan does not have.
- **`FRGN`:** the CLI used a tool that should have been off. Stop and tell us.

`--model` is required. Use the exact id your CLI accepts, for example one of those listed by
`/model` inside the CLI, and record it in the form.

**3. The round**, one per language:

```sh
deno run -A src/cli_bench.ts --cli=codex --model=<MODEL> --runner=<your-id> \
  --suite=github-beacon --arms=native,glossary4s,glossary4 --reps=3 --concurrency=2 \
  --out=results/runs/xv-<your-id>-codex-<model>-es.jsonl

deno run -A src/cli_bench.ts --cli=codex --model=<MODEL> --runner=<your-id> \
  --suite=github-beacon-en --arms=native,glossary4s,glossary4 --reps=3 --concurrency=2 \
  --out=results/runs/xv-<your-id>-codex-<model>-en.jsonl
```

- **Usage limit.** When you hit your plan's limit, you see several `ERR` lines in a row and the
  runner stops by itself. Once your quota renews, run the same command and it continues where it
  stopped. Runs that were cut short do not count.
- **Tokens** are reported by the CLI itself. They include its internal prompt, which is the same
  for every arm. There is nothing to compute.
- **There is no `code` arm** on this path; that is expected.
- **Reasoning effort.** To fix it, decide before you start, record it, and pass the same value in
  both rounds.
  - Codex: `--cli-args='["-c","model_reasoning_effort=\"low\""]'`.
  - Gemini: there is no equivalent option; use the model as it is.

## 5. Common problems

| Symptom | Likely cause |
|---|---|
| `HTTP 401` / `HTTP 403` | wrong key, or `--key-env` names another variable |
| `HTTP 400 ... tools` or `... schema` on Gemini | `--schemas=gemini` is missing |
| `HTTP 400 ... reasoning_content` | add `--drop-fields=reasoning_content` |
| Everything `FAIL` with `turns=1` | the model is not calling tools: check that your server supports tool calling for it (on vLLM, the parser) |
| Everything `FAIL` on `native` with a local model, but not on the other arms | context too short: raise `OLLAMA_CONTEXT_LENGTH` or `--max-model-len` |
| Many `HTTP 429` | lower `--concurrency`; the runner already retries with a wait |
| `GAP` lines | the fake GitHub does not know a call. Not the model's fault; those runs are excluded. Send us the log anyway |
| `github-mcp-server: not found` | `./scripts/setup.sh` was not run, or you are not on Linux x86_64 |
| (B) `cannot run codex` / `cannot run gemini` | the CLI is not installed or not on `PATH`; or pass its path with `--bin=` |
| (B) `ERR` mentioning "login", "auth" or "401" | log in again with `codex login` or `gemini` |
| (B) `warning: codex X; this runner was tested with ...` | install the version in the table in 4B |
| (B) `FRGN` lines | the CLI used a tool that should have been off: stop and tell us |
| (B) ChatGPT says device-code login is disabled | turn on device code authorization for Codex in ChatGPT's settings (Security), then run `codex login` again |
| `git status` shows `deno.lock` modified | Deno resolved a dependency; harmless and not part of the freeze. `git checkout deno.lock` restores it |
| `git status` shows `vendor/` or `.cli-runs/` | written by `setup.sh` and `cli_bench.ts`; expected |

## 6. What you send back

Privately, the same way you received the set:

1. **The logs.** The `results/runs/xv-<your-id>-...-es.jsonl` and `-en.jsonl` files (the ones you
   passed to `--out`), plus any `.errors.jsonl` left over. They contain the full conversations,
   so do not publish them.
2. **This form, filled in.** Paste it in your message, or send it as `form-<your-id>.md`:

```text
## Cross-vendor contribution — orchard/beacon

Who
- Name for the acknowledgments: (or "anonymous" if you prefer not to appear)
- Affiliation (optional):
- GitHub user or link (optional):
- Identifier used in --runner:
- Contact (for questions about the run):

What you ran
- Path (A: API / B: subscription with codex or gemini) and CLI version if B:
- Provider and endpoint (--base-url, path A only):
- Exact model id (--model):
- If local: parameter count, quantization, server (Ollama/vLLM/...) and version, GPU, maximum context:
- Extra flags (--extra, --schemas, --drop-fields, --concurrency, --cli-args):
- Exact commands (both, ES and EN):
- phrasebook commit (git rev-parse HEAD):
- Output of sha256sum -c results/crossvendor-freeze*.sha256 (all OK?):
- Date(s) of the run:

Issues
- Did you change anything in the code or the set? (should be "no"):
- Errors, GAPs or odd behavior:
- Approximate cost (optional):
```

Each contribution is recorded under that identifier. The name you give in the form is the one in
the paper's acknowledgments, next to the model you ran.

To see your numbers before sending them:

```sh
deno run -A src/client_stats.ts results/runs/xv-<your-id>-<model>-es.jsonl --a=glossary4 --b=native
```
