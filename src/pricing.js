"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Load a pricing table from disk. Defaults to the bundled pricing.json.
 * @param {string} [file] absolute or relative path to a pricing JSON file
 * @returns {{models: Object, _meta: Object}}
 */
function loadPricing(file) {
  const target = file || path.join(__dirname, "..", "pricing.json");
  const raw = fs.readFileSync(target, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.models || typeof parsed.models !== "object") {
    throw new Error(`pricing file ${target} has no "models" object`);
  }
  return parsed;
}

/**
 * Resolve the rate entry for a given model name.
 * Matching strategy:
 *   1. exact match
 *   2. longest prefix match (so "claude-opus-4-8-20251101" matches "claude-opus-4-8")
 *   3. the "default" entry
 * @param {Object} models  the models map from a pricing file
 * @param {string} model   model id as found in the log
 * @returns {{rate: Object, matched: string}}
 */
function resolveRate(models, model) {
  if (!model) {
    return { rate: models.default, matched: "default" };
  }
  if (models[model]) {
    return { rate: models[model], matched: model };
  }
  let best = null;
  for (const key of Object.keys(models)) {
    if (key === "default") continue;
    if (model.startsWith(key) && (!best || key.length > best.length)) {
      best = key;
    }
  }
  if (best) {
    return { rate: models[best], matched: best };
  }
  return { rate: models.default, matched: "default" };
}

/**
 * Compute the USD cost of a single usage record.
 * Rates are in USD per 1,000,000 tokens. Claude separates cache-creation and
 * cache-read tokens, which are billed at different rates than fresh input.
 *
 * @param {Object} usage  { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
 * @param {Object} rate   { input, output, cache_write_5m, cache_read }
 * @returns {number} cost in USD
 */
function costOf(usage, rate) {
  if (!usage || !rate) return 0;
  const M = 1_000_000;
  const input = (usage.input_tokens || 0) * (rate.input || 0);
  const output = (usage.output_tokens || 0) * (rate.output || 0);
  // cache_write_5m / cache_read default to the base input rate if a model entry
  // omits them, so an under-specified pricing file still produces a sane number.
  const cacheWriteRate =
    rate.cache_write_5m != null ? rate.cache_write_5m : rate.input || 0;
  const cacheReadRate =
    rate.cache_read != null ? rate.cache_read : rate.input || 0;
  const cacheWrite = (usage.cache_creation_input_tokens || 0) * cacheWriteRate;
  const cacheRead = (usage.cache_read_input_tokens || 0) * cacheReadRate;
  return (input + output + cacheWrite + cacheRead) / M;
}

module.exports = { loadPricing, resolveRate, costOf };
