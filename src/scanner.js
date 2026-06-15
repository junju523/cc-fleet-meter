"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

/**
 * Discover Claude Code instance directories on this machine.
 * The default Claude Code dir is ~/.claude; multiple parallel instances live in
 * ~/.claude-A, ~/.claude-B, ... ("the fleet"). Each holds a projects/ subtree of
 * .jsonl conversation logs.
 *
 * @param {string} [home] override home directory (for tests)
 * @returns {Array<{instance: string, dir: string}>}
 */
function discoverInstances(home) {
  const base = home || os.homedir();
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  const instances = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    // ".claude" or ".claude-A" etc. Exclude backups/working dirs.
    if (name === ".claude" || /^\.claude-[A-Za-z0-9]+$/.test(name)) {
      if (name.startsWith(".claude-backup")) continue;
      const projectsDir = path.join(base, name, "projects");
      if (fs.existsSync(projectsDir)) {
        // instance label: ".claude" -> "default", ".claude-A" -> "A"
        const label =
          name === ".claude" ? "default" : name.slice(".claude-".length);
        instances.push({ instance: label, dir: projectsDir });
      }
    }
  }
  return instances.sort((a, b) => a.instance.localeCompare(b.instance));
}

/**
 * Recursively list all *.jsonl files beneath a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function listJsonlFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Decode the project directory name back into a readable project path.
 * Claude Code encodes the cwd as e.g. "C--Users-junju-Downloads-nexus".
 * We can't perfectly invert it (dashes are ambiguous), so we return the
 * trailing segment as the project label, which is what users recognize.
 * @param {string} encoded
 * @returns {string}
 */
function projectLabelFromDir(encoded) {
  if (!encoded) return "unknown";
  // Strip a leading drive prefix like "C--" and take the last path-ish segment.
  const parts = encoded.split("-").filter(Boolean);
  if (parts.length === 0) return encoded;
  return parts[parts.length - 1];
}

/**
 * Parse one assistant-message line from a Claude Code jsonl log into a usage
 * record, or return null if the line carries no billable usage.
 *
 * Schema (verified against real logs, Claude Code v2.1.x):
 *   line.type === "assistant"
 *   line.message.model      -> model id string
 *   line.message.usage      -> { input_tokens, output_tokens,
 *                                cache_creation_input_tokens,
 *                                cache_read_input_tokens, ... }
 *   line.timestamp          -> ISO 8601
 *   line.isSidechain        -> true for subagent turns
 *
 * @param {string} text  one line of JSON
 * @returns {null | {model, timestamp, usage, isSidechain}}
 */
function parseUsageLine(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return null; // tolerate partial/corrupt lines
  }
  const msg = obj.message;
  if (!msg || !msg.usage) return null;
  const model = msg.model;
  // Skip synthetic / non-billable model markers.
  if (!model || model === "<synthetic>") return null;
  const u = msg.usage;
  const usage = {
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
    cache_read_input_tokens: u.cache_read_input_tokens || 0,
  };
  const total =
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens;
  if (total === 0) return null;
  return {
    model,
    timestamp: obj.timestamp || null,
    usage,
    isSidechain: obj.isSidechain === true,
    // dedup key: the API request id + message id uniquely identify a billed
    // assistant turn; logs can duplicate lines across resumes.
    dedupKey: (obj.requestId || "") + "|" + (msg.id || "") || null,
  };
}

/**
 * Stream a jsonl file and yield parsed usage records via a callback.
 * @param {string} file
 * @param {(rec: Object) => void} onRecord
 * @returns {Promise<void>}
 */
function streamFile(file, onRecord) {
  return new Promise((resolve, reject) => {
    let stream;
    try {
      stream = fs.createReadStream(file, { encoding: "utf8" });
    } catch (e) {
      return resolve(); // unreadable file -> skip
    }
    stream.on("error", () => resolve()); // skip files we can't read
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line) return;
      const rec = parseUsageLine(line);
      if (rec) onRecord(rec);
    });
    rl.on("close", resolve);
    rl.on("error", reject);
  });
}

module.exports = {
  discoverInstances,
  listJsonlFiles,
  projectLabelFromDir,
  parseUsageLine,
  streamFile,
};
