# cc-fleet-meter

**A local cost meter for Claude Code.** One command to see what Claude Code is actually costing you — by model, by project, and (its reason to exist) summed across **every instance** you run.

> Single-instance usage tools already exist and are good — [ccusage](https://github.com/ryoppippi/ccusage) is the one most people use. cc-fleet-meter's difference: if you run **more than one** Claude Code home (`~/.claude`, `~/.claude-A`, `~/.claude-B` …), no per-instance tool gives you the *combined* total. This does — one number for the whole fleet, plus per-instance / per-model / per-project breakdowns. Works fine for a single instance too.

---

## The problem

If you run a single Claude Code instance, existing tools already show your usage. But a growing number of developers run **a fleet**: multiple Claude Code instances side by side (each with its own `~/.claude-X` home), often on different projects at once. There's no single number for "what did the fleet cost today?" — you'd have to open each one and add it up by hand.

cc-fleet-meter reads the logs every instance already writes to disk and rolls them up into one view.

## One command

```bash
npx github:junju523/cc-fleet-meter
```

No install, no config, no API key. (Requires Node 20+ and `git`.)

> An npm release (`npx cc-fleet-meter`) is on the way; until then, install straight from GitHub with the command above.

## Example output

```
cc-fleet-meter  —  Claude Code fleet cost summary
(local-only · no network · no telemetry)

Period       Cost      Messages        Tokens
----------------------------------------------------
Today        $92.06       357 msgs    103.27M tokens
Month      $2163.06      8168 msgs   2370.64M tokens
All-time   $4349.26     16629 msgs   5483.59M tokens

Instances: 8    Data span: 2026-01-09 → 2026-06-15

By instance:
Instance  Msgs    Tokens     Cost
--------  ----  --------  -------
F         3143  1111.96M  $882.21
C         2597  1005.42M  $857.50
B         3068   935.37M  $806.71
...

By model:
Model               Msgs    Tokens      Cost
------------------  ----  --------  --------
claude-opus-4-7     9388  3495.06M  $2443.60
claude-opus-4-8     4906  1360.82M   $988.81
claude-fable-5      2108   615.31M   $908.93
...

By project:
Project        Msgs    Tokens      Cost
------------  -----  --------  --------
main-workspace 16365  5444.81M  $4299.72
automation       176    32.94M    $42.70
...
```

JSON for piping into your own tooling:

```bash
npx github:junju523/cc-fleet-meter --json
```

## Local-only by design — your trust is the product

A tool that reads your dev logs has to be trustworthy. So:

- **No network calls.** Nothing is uploaded. Ever. Cost is computed entirely on your machine from a bundled price table.
- **No telemetry.** We don't know you ran it.
- **No API key.** It reads files; it never calls the Anthropic API.
- **Tiny, readable, dependency-free.** Zero runtime npm dependencies. The whole thing is a few hundred lines of plain Node you can audit in one sitting.

You can verify all of the above with `grep -ri "http\|fetch\|require(" src/` — there are no HTTP clients and no third-party packages.

## How it works

Claude Code writes a JSONL conversation log per session under `~/.claude*/projects/**/*.jsonl`. Each assistant turn carries a `usage` object (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) and a `model` id. cc-fleet-meter:

1. Discovers every instance home (`~/.claude`, `~/.claude-A` … and any `~/.claude-<X>`).
2. Streams every JSONL log (it never loads a whole file into memory).
3. De-duplicates billed turns by request + message id (resumed sessions can repeat lines).
4. Prices each turn from `pricing.json`, correctly charging **cache-creation and cache-read tokens at their own rates** (Claude bills these differently from fresh input).
5. Rolls everything up by period, instance, model, and project.

## Pricing & accuracy

Prices live in [`pricing.json`](./pricing.json) with their **source URL and retrieval date** recorded inline — this tool does not bury guessed numbers in code. Rates were taken from Anthropic's published model pricing (retrieved 2026-06-04). Cache economics (5-minute cache write = 1.25× base input, cache read = 0.1× base input) follow Anthropic's prompt-caching pricing docs.

**Treat dollar figures as a close estimate, not a billing statement.** Published rates change, and your account may have different terms. Override the whole table with your own rates at any time:

```bash
npx github:junju523/cc-fleet-meter --pricing ./my-rates.json
```

Models with no entry are priced with a clearly-flagged `default` rate, and the tool tells you which ones so you can add them.

## Supported agents

| Agent | Status |
|---|---|
| Claude Code (all instances / the whole fleet) | ✅ Supported |
| OpenAI Codex (`~/.codex`) | 🔜 Planned — pluggable adapter |
| Cursor | 🔜 Planned — pluggable adapter |

The scanner is structured so other agents' logs can be added as adapters. Today the value is the **Claude Code cross-instance** roll-up; the architecture is built to grow.

## Roadmap

- Pluggable adapters for other agents (Codex, Cursor, …) as their local logs become available.
- Date-range filters (`--since` / `--until`) and per-day timelines.
- **Always-on team dashboard (SaaS).** A continuously-updated, multi-developer view of fleet spend for teams running agents at scale. → **[Join the waitlist](https://jamon-monetize-bot-rryxbfcsxq-an.a.run.app/smoke/ccfleet.html)**

## Options

```
--json                Machine-readable JSON instead of a table.
--pricing <file>      Use a custom pricing JSON file.
--home <dir>          Override the home directory to scan.
-h, --help            Show help.
```

## Development

```bash
node --test        # run the unit tests (no deps)
npm start          # run against your real fleet
```

## License

MIT
