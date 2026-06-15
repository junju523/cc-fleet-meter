"use strict";

/** Format a USD amount. */
function usd(n) {
  return "$" + (n || 0).toFixed(2);
}

/** Compact a token count: 12345 -> "12.3K", 1234567 -> "1.23M". */
function tokens(n) {
  n = n || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

/**
 * Render a simple fixed-width table.
 * @param {string[]} headers
 * @param {Array<string[]>} rows
 * @returns {string}
 */
function table(headers, rows) {
  const widths = headers.map((h, i) => {
    let w = h.length;
    for (const r of rows) {
      const cell = r[i] != null ? String(r[i]) : "";
      if (cell.length > w) w = cell.length;
    }
    return w;
  });
  const pad = (cell, i, left) => {
    const s = cell != null ? String(cell) : "";
    return left ? s.padEnd(widths[i]) : s.padStart(widths[i]);
  };
  // first column left-aligned, numeric columns right-aligned
  const line = (cells) => cells.map((c, i) => pad(c, i, i === 0)).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const out = [line(headers), sep];
  for (const r of rows) out.push(line(r));
  return out.join("\n");
}

/** Sort a breakdown map into descending-cost rows. */
function sortedRows(map) {
  return Object.entries(map).sort((a, b) => b[1].cost - a[1].cost);
}

function breakdownTable(title, map, label) {
  const rows = sortedRows(map).map(([key, t]) => [
    key,
    String(t.messages),
    tokens(t.tokens.total),
    usd(t.cost),
  ]);
  return `\n${title}\n` + table([label, "Msgs", "Tokens", "Cost"], rows);
}

/**
 * Render the full human-readable report.
 * @param {Object} agg aggregation result from aggregate()
 * @returns {string}
 */
function renderReport(agg) {
  const lines = [];
  lines.push("cc-fleet-meter  —  Claude Code fleet cost summary");
  lines.push("(local-only · no network · no telemetry)");
  lines.push("");

  const period = (name, t) =>
    `${name.padEnd(8)} ${usd(t.cost).padStart(10)}   ${String(
      t.messages,
    ).padStart(7)} msgs   ${tokens(t.tokens.total).padStart(8)} tokens`;

  lines.push("Period       Cost      Messages        Tokens");
  lines.push("-".repeat(52));
  lines.push(period("Today", agg.today));
  lines.push(period("Month", agg.month));
  lines.push(period("All-time", agg.allTime));
  lines.push("");

  const span =
    agg.earliest && agg.latest
      ? `${agg.earliest.slice(0, 10)} → ${agg.latest.slice(0, 10)}`
      : "n/a";
  lines.push(`Instances: ${agg.instanceCount}    Data span: ${span}`);

  lines.push(breakdownTable("By instance:", agg.byInstance, "Instance"));
  lines.push(breakdownTable("By model:", agg.byModel, "Model"));
  lines.push(breakdownTable("By project:", agg.byProject, "Project"));

  const unknown = Object.keys(agg.unknownModels);
  if (unknown.length) {
    lines.push("");
    lines.push(
      'Note: priced with the "default" rate (no entry in pricing.json): ' +
        unknown.join(", "),
    );
    lines.push("Pass --pricing <file> to override rates.");
  }

  return lines.join("\n");
}

module.exports = { renderReport, table, usd, tokens };
