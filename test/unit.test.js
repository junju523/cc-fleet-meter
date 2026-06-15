'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadPricing, resolveRate, costOf } = require('../src/pricing');
const { parseUsageLine, discoverInstances, projectLabelFromDir } = require('../src/scanner');
const { aggregate, periodFlags } = require('../src/aggregate');

const PRICING = loadPricing();

test('pricing: opus-4-8 base input/output cost', () => {
  const { rate } = resolveRate(PRICING.models, 'claude-opus-4-8');
  // 1M input tokens @ $5/MTok = $5
  const cost = costOf(
    { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    rate
  );
  assert.strictEqual(cost, 5);
  // 1M output @ $25/MTok = $25
  const out = costOf(
    { input_tokens: 0, output_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    rate
  );
  assert.strictEqual(out, 25);
});

test('pricing: cache_creation billed at 1.25x input, cache_read at 0.1x input', () => {
  const { rate } = resolveRate(PRICING.models, 'claude-opus-4-8');
  // cache write: 1M @ $6.25/MTok = $6.25
  const w = costOf(
    { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 0 },
    rate
  );
  assert.strictEqual(w, 6.25);
  // cache read: 1M @ $0.50/MTok = $0.50
  const r = costOf(
    { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000 },
    rate
  );
  assert.strictEqual(r, 0.5);
});

test('pricing: combined usage sums each token class', () => {
  const { rate } = resolveRate(PRICING.models, 'claude-haiku-4-5');
  // haiku: input $1, output $5, write $1.25, read $0.1 per MTok
  const cost = costOf(
    {
      input_tokens: 100_000,
      output_tokens: 100_000,
      cache_creation_input_tokens: 100_000,
      cache_read_input_tokens: 100_000,
    },
    rate
  );
  // (100k*1 + 100k*5 + 100k*1.25 + 100k*0.1)/1e6 = (0.1+0.5+0.125+0.01)=0.735
  assert.ok(Math.abs(cost - 0.735) < 1e-9, `got ${cost}`);
});

test('pricing: prefix match for dated model ids', () => {
  const { matched } = resolveRate(PRICING.models, 'claude-opus-4-8-20251101');
  assert.strictEqual(matched, 'claude-opus-4-8');
});

test('pricing: unknown model falls back to default', () => {
  const { matched } = resolveRate(PRICING.models, 'totally-made-up-model');
  assert.strictEqual(matched, 'default');
});

test('pricing: fable-5 is the priciest tier', () => {
  const { rate } = resolveRate(PRICING.models, 'claude-fable-5');
  assert.strictEqual(rate.input, 10);
  assert.strictEqual(rate.output, 50);
});

test('scanner: parseUsageLine extracts usage from a real-shaped line', () => {
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-05-11T12:37:42.219Z',
    requestId: 'req_abc',
    isSidechain: false,
    message: {
      model: 'claude-opus-4-7',
      id: 'msg_123',
      usage: {
        input_tokens: 6,
        cache_creation_input_tokens: 13525,
        cache_read_input_tokens: 19095,
        output_tokens: 173,
      },
    },
  });
  const rec = parseUsageLine(line);
  assert.ok(rec);
  assert.strictEqual(rec.model, 'claude-opus-4-7');
  assert.strictEqual(rec.usage.cache_creation_input_tokens, 13525);
  assert.strictEqual(rec.dedupKey, 'req_abc|msg_123');
});

test('scanner: parseUsageLine skips synthetic, empty, and malformed lines', () => {
  assert.strictEqual(parseUsageLine('not json'), null);
  assert.strictEqual(parseUsageLine(JSON.stringify({ type: 'user' })), null);
  assert.strictEqual(
    parseUsageLine(JSON.stringify({ message: { model: '<synthetic>', usage: { input_tokens: 1 } } })),
    null
  );
  assert.strictEqual(
    parseUsageLine(
      JSON.stringify({
        message: {
          model: 'claude-opus-4-8',
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      })
    ),
    null
  );
});

test('scanner: projectLabelFromDir takes the trailing segment', () => {
  assert.strictEqual(projectLabelFromDir('C--Users-junju-Downloads-nexus'), 'nexus');
  assert.strictEqual(projectLabelFromDir('C--Users-junju'), 'junju');
});

test('aggregate: periodFlags buckets today/month vs now', () => {
  const now = new Date('2026-06-15T10:00:00Z');
  assert.deepStrictEqual(periodFlags('2026-06-15T01:00:00Z', now), {
    today: true,
    month: true,
  });
  assert.deepStrictEqual(periodFlags('2026-06-01T01:00:00Z', now), {
    today: false,
    month: true,
  });
  assert.deepStrictEqual(periodFlags('2026-05-31T01:00:00Z', now), {
    today: false,
    month: false,
  });
});

test('aggregate: end-to-end over a synthetic fleet with dedup', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccfm-'));
  // Build ~/.claude-X/projects/<proj>/sess.jsonl
  const mk = (instDir, proj, lines) => {
    const dir = path.join(tmp, instDir, 'projects', proj);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sess.jsonl'), lines.join('\n') + '\n');
  };
  const usageLine = (model, id, req, input, output) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-06-15T08:00:00Z',
      requestId: req,
      message: {
        model,
        id,
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    });

  mk('.claude', 'C--proj-alpha', [
    usageLine('claude-opus-4-8', 'm1', 'r1', 1_000_000, 0), // $5
    usageLine('claude-opus-4-8', 'm1', 'r1', 1_000_000, 0), // duplicate -> deduped
  ]);
  mk('.claude-A', 'C--proj-beta', [
    usageLine('claude-haiku-4-5', 'm2', 'r2', 1_000_000, 1_000_000), // $1 + $5 = $6
  ]);

  const agg = await aggregate({ pricing: PRICING, home: tmp, now: new Date('2026-06-15T10:00:00Z') });

  assert.strictEqual(agg.instanceCount, 2);
  // total: $5 (deduped) + $6 = $11
  assert.ok(Math.abs(agg.allTime.cost - 11) < 1e-9, `cost ${agg.allTime.cost}`);
  assert.strictEqual(agg.allTime.messages, 2); // 3 lines, 1 deduped
  assert.ok(agg.byInstance.default);
  assert.ok(agg.byInstance.A);
  assert.ok(agg.byModel['claude-opus-4-8']);
  assert.ok(agg.byProject.alpha);
  assert.ok(agg.byProject.beta);
  // today bucket should equal all-time here
  assert.ok(Math.abs(agg.today.cost - 11) < 1e-9);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('scanner: discoverInstances finds .claude and .claude-X dirs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccfm-disc-'));
  fs.mkdirSync(path.join(tmp, '.claude', 'projects'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.claude-A', 'projects'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.claude-backups'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'unrelated'), { recursive: true });

  const found = discoverInstances(tmp);
  const labels = found.map((f) => f.instance).sort();
  assert.deepStrictEqual(labels, ['A', 'default']);

  fs.rmSync(tmp, { recursive: true, force: true });
});
