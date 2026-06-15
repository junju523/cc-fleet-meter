"use strict";

const path = require("path");
const {
  discoverInstances,
  listJsonlFiles,
  projectLabelFromDir,
  streamFile,
} = require("./scanner");
const { resolveRate, costOf } = require("./pricing");

/**
 * Return YYYY-MM-DD for a Date in local time.
 */
function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Return YYYY-MM for a Date in local time.
 */
function monthKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function emptyTotals() {
  return {
    cost: 0,
    messages: 0,
    tokens: {
      input: 0,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
      total: 0,
    },
  };
}

function addUsage(totals, usage, cost) {
  totals.cost += cost;
  totals.messages += 1;
  totals.tokens.input += usage.input_tokens;
  totals.tokens.output += usage.output_tokens;
  totals.tokens.cache_creation += usage.cache_creation_input_tokens;
  totals.tokens.cache_read += usage.cache_read_input_tokens;
  totals.tokens.total +=
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens;
}

function bump(map, key, usage, cost) {
  if (!map[key]) map[key] = emptyTotals();
  addUsage(map[key], usage, cost);
}

/**
 * Determine which period(s) a timestamp belongs to relative to "now".
 * @returns {{today: boolean, month: boolean}}
 */
function periodFlags(ts, now) {
  if (!ts) return { today: false, month: false };
  const d = new Date(ts);
  if (isNaN(d.getTime())) return { today: false, month: false };
  return {
    today: dayKey(d) === dayKey(now),
    month: monthKey(d) === monthKey(now),
  };
}

/**
 * Scan the fleet and aggregate cost/usage.
 *
 * @param {Object} opts
 * @param {Object} opts.pricing   loaded pricing object ({models})
 * @param {string} [opts.home]    override home dir
 * @param {Date}   [opts.now]     override "now" for period bucketing
 * @returns {Promise<Object>} aggregation result
 */
async function aggregate(opts) {
  const pricing = opts.pricing;
  const now = opts.now || new Date();
  const instances = discoverInstances(opts.home);

  const result = {
    generatedAt: now.toISOString(),
    instanceCount: instances.length,
    today: emptyTotals(),
    month: emptyTotals(),
    allTime: emptyTotals(),
    byInstance: {},
    byModel: {},
    byProject: {},
    unknownModels: {},
    earliest: null,
    latest: null,
  };

  // Dedup billed turns across files (resumes can duplicate lines).
  const seen = new Set();

  for (const inst of instances) {
    const files = listJsonlFiles(inst.dir);
    for (const file of files) {
      // project dir is the first path segment under projects/
      const rel = path.relative(inst.dir, file);
      const projectDir = rel.split(path.sep)[0];
      const project = projectLabelFromDir(projectDir);

      await streamFile(file, (rec) => {
        if (rec.dedupKey && rec.dedupKey !== "|") {
          if (seen.has(rec.dedupKey)) return;
          seen.add(rec.dedupKey);
        }

        const { rate, matched } = resolveRate(pricing.models, rec.model);
        if (matched === "default" && rec.model && !pricing.models[rec.model]) {
          result.unknownModels[rec.model] =
            (result.unknownModels[rec.model] || 0) + 1;
        }
        const cost = costOf(rec.usage, rate);

        addUsage(result.allTime, rec.usage, cost);
        bump(result.byInstance, inst.instance, rec.usage, cost);
        bump(result.byModel, rec.model, rec.usage, cost);
        bump(result.byProject, project, rec.usage, cost);

        const flags = periodFlags(rec.timestamp, now);
        if (flags.today) addUsage(result.today, rec.usage, cost);
        if (flags.month) addUsage(result.month, rec.usage, cost);

        if (rec.timestamp) {
          if (!result.earliest || rec.timestamp < result.earliest) {
            result.earliest = rec.timestamp;
          }
          if (!result.latest || rec.timestamp > result.latest) {
            result.latest = rec.timestamp;
          }
        }
      });
    }
  }

  return result;
}

module.exports = {
  aggregate,
  dayKey,
  monthKey,
  periodFlags,
  emptyTotals,
  addUsage,
};
