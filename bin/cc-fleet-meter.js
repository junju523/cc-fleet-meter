#!/usr/bin/env node
"use strict";

const { loadPricing } = require("../src/pricing");
const { aggregate } = require("../src/aggregate");
const { renderReport } = require("../src/render");

const HELP = `cc-fleet-meter — cross-instance cost meter for AI coding agents

Reads local Claude Code logs from every instance in your fleet
(~/.claude, ~/.claude-A … ~/.claude-G) and reports total spend with
breakdowns by instance, model, and project. Runs fully locally:
no network calls, no telemetry, no API key.

USAGE
  npx cc-fleet-meter [options]
  node bin/cc-fleet-meter.js [options]

OPTIONS
  --json                Output machine-readable JSON instead of a table.
  --pricing <file>      Use a custom pricing JSON file (overrides bundled rates).
  --home <dir>          Override the home directory to scan (for testing).
  -h, --help            Show this help.

PRICING
  Rates ship in pricing.json with their source URLs and retrieval date.
  Claude bills cache-creation and cache-read tokens at different rates than
  fresh input; those are modeled explicitly. Verify rates against the source
  before trusting absolute dollar figures.
`;

function parseArgs(argv) {
  const opts = { json: false, pricingFile: null, home: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--pricing") opts.pricingFile = argv[++i];
    else if (a === "--home") opts.home = argv[++i];
    else if (a === "-h" || a === "--help") opts.help = true;
    else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      opts.help = true;
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let pricing;
  try {
    pricing = loadPricing(opts.pricingFile);
  } catch (e) {
    process.stderr.write(`Failed to load pricing: ${e.message}\n`);
    return 1;
  }

  const agg = await aggregate({
    pricing,
    home: opts.home,
    now: new Date(),
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(agg, null, 2) + "\n");
  } else {
    process.stdout.write(renderReport(agg) + "\n");
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `cc-fleet-meter error: ${err && err.stack ? err.stack : err}\n`,
    );
    process.exit(1);
  });
