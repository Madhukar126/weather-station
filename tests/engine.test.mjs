import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyse,
  demoData,
  inject,
  parseCSV,
  toCSV,
  splitPoints,
  evaluate,
  events,
  fitForest,
  calculateDewPoint,
  calculateHeatIndex,
} from '../lib/engine.ts';
test('CSV round trip preserves missing values and unknown labels', () => {
  const input = demoData();
  input[900].humidity = null;
  input[901].label = 'unknown';
  assert.deepEqual(parseCSV(toCSV(input)), input);
  const noLabels = toCSV(input)
    .split('\n')
    .map((line) => line.split(',').slice(0, 4).join(','))
    .join('\n');
  assert.ok(parseCSV(noLabels).every((r) => r.label === 'unknown'));
  const quoted = toCSV(input)
    .replace('timestamp,', '"timestamp",')
    .replace('normal\n', '"normal"\r\n');
  assert.deepEqual(parseCSV(quoted), input);
});
test('Import rejects malformed, duplicate, unsorted and undersized inputs', () => {
  assert.throws(() => parseCSV('temperature,humidity\n1,2'), /columns/);
  const rows = demoData();
  rows[1].timestamp = rows[0].timestamp;
  assert.throws(() => parseCSV(toCSV(rows)), /strictly increasing/);
  assert.throws(
    () => parseCSV(toCSV(demoData()).replace('26.', 'oops.')),
    /numeric/,
  );
  assert.throws(() => parseCSV(toCSV(demoData().slice(0, 100))), /120/);
  assert.throws(
    () => parseCSV(toCSV(demoData()).replace('T00:00:00.000Z', ' 00:00:00')),
    /timezone/,
  );
  assert.throws(
    () => parseCSV(toCSV(demoData()).replace(',normal', ',bogus')),
    /label/,
  );
  const empty = demoData().map((r) => ({ ...r, temperature: null }));
  assert.throws(() => parseCSV(toCSV(empty)), /training/);
  const noCal = demoData();
  for (let i = 576; i < 768; i++) noCal[i].temperature = null;
  assert.throws(() => parseCSV(toCSV(noCal)), /calibration/);
});
test('Faults never change train or calibration observations', () => {
  const base = demoData(),
    snapshot = structuredClone(base),
    { testStart } = splitPoints(base.length);
  for (const s of ['drift', 'spike', 'stuck', 'dropout', 'weather']) {
    const changed = inject(base, s, 'temperature', 3);
    assert.deepEqual(changed.slice(0, testStart), base.slice(0, testStart));
    assert.notDeepEqual(changed.slice(testStart), base.slice(testStart));
  }
  assert.deepEqual(base, snapshot);
});
test('Future test changes do not change fitted thresholds or earlier decisions', () => {
  const rows = demoData(),
    before = analyse(rows),
    changed = structuredClone(rows);
  for (let i = 900; i < 960; i++) {
    changed[i].temperature = 55;
    changed[i].pressure = null;
  }
  const after = analyse(changed);
  assert.deepEqual(after.thresholds, before.thresholds);
  for (const m of ['rules', 'forest', 'guard'])
    assert.deepEqual(
      after.results[m].slice(0, 900),
      before.results[m].slice(0, 900),
    );
});
test('Ground-truth labels never change detector outputs', () => {
  const rows = demoData(),
    a = analyse(rows);
  assert.deepEqual(
    analyse(rows.map((r) => ({ ...r, label: 'drift' }))).results,
    a.results,
  );
});
test('Scenarios produce finite scores, bounded recall and real detections', () => {
  for (const s of ['none', 'spike', 'drift', 'stuck', 'dropout', 'weather']) {
    const a = analyse(inject(demoData(), s, 'temperature', 3));
    for (const m of ['rules', 'forest', 'guard']) {
      assert.ok(a.results[m].every((f) => Number.isFinite(f.score)));
      const v = evaluate(a, m);
      assert.ok(v.detected <= v.events);
      assert.ok(v.recall === null || (v.recall >= 0 && v.recall <= 1));
    }
    if (['spike', 'stuck', 'dropout'].includes(s))
      assert.ok(evaluate(a, 'rules').detected > 0);
    if (s === 'drift') assert.ok(evaluate(a, 'guard').detected > 0);
  }
});
test('Unknown labels cannot produce accuracy or false-alert claims', () => {
  const a = analyse(demoData().map((r) => ({ ...r, label: 'unknown' })));
  for (const m of ['rules', 'forest', 'guard']) {
    const v = evaluate(a, m);
    assert.equal(v.recall, null);
    assert.equal(v.falsePerDay, null);
    assert.equal(v.known, 0);
  }
});
test('Event grouping and detection delay count events, not points', () => {
  assert.deepEqual(events([false, true, true, false, true]), [
    { start: 1, end: 2 },
    { start: 4, end: 4 },
  ]);
  const a = analyse(demoData());
  a.rows.forEach((r) => (r.label = 'normal'));
  for (let i = 800; i <= 809; i++) a.rows[i].label = 'drift';
  a.results.rules.forEach((f) => (f.flagged = false));
  a.results.rules[802].flagged = true;
  a.results.rules[803].flagged = true;
  a.results.rules[900].flagged = true;
  const v = evaluate(a, 'rules');
  assert.equal(v.events, 1);
  assert.equal(v.detected, 1);
  assert.equal(v.delay, 30);
  assert.equal(v.falseAlerts, 1);
  assert.equal(v.alerts, 2);
});
test('Forest is deterministic and isolates distant outliers', () => {
  const samples = Array.from({ length: 200 }, (_, i) => [
    Math.sin(i) * 0.2,
    Math.cos(i) * 0.2,
  ]);
  const f = fitForest(samples),
    g = fitForest(samples);
  assert.equal(f([0.1, 0.1]), g([0.1, 0.1]));
  assert.ok(f([10, 10]) > f([0.01, 0.01]));
});
test('A long alarm overlapping a fault still counts its normal segments', () => {
  const a = analyse(demoData());
  a.rows.forEach((r) => (r.label = 'normal'));
  a.rows[810].label = 'drift';
  a.rows[820].label = 'unknown';
  a.results.rules.forEach((f, i) => (f.flagged = i >= 800 && i <= 825));
  const v = evaluate(a, 'rules');
  assert.equal(v.alerts, 1);
  assert.equal(v.falseAlerts, 3);
  assert.equal(v.detected, 1);
});
test('Simulation preserves unknown labels, existing faults and missing measurements', () => {
  const rows = demoData();
  rows[810].temperature = null;
  rows[811].label = 'spike';
  rows[812].label = 'unknown';
  for (const s of ['drift', 'spike', 'stuck', 'dropout', 'weather']) {
    const out = inject(rows, s, 'temperature', 3);
    for (const i of [810, 811, 812]) assert.deepEqual(out[i], rows[i]);
  }
  const unknown = rows.map((r) => ({ ...r, label: 'unknown' }));
  assert.deepEqual(inject(unknown, 'weather', 'temperature', 3), unknown);
});
test('False-alert exposure uses elapsed reviewed time and excludes long gaps', () => {
  const a = analyse(demoData());
  a.rows.forEach((r) => (r.label = 'unknown'));
  for (let i = 800; i <= 804; i++) a.rows[i].label = 'normal';
  a.rows[801].timestamp = a.rows[800].timestamp + 5 * 60000;
  a.rows[802].timestamp = a.rows[800].timestamp + 15 * 60000;
  a.rows[803].timestamp = a.rows[800].timestamp + 60 * 60000;
  a.rows[804].timestamp = a.rows[800].timestamp + 75 * 60000;
  a.results.rules.forEach((f) => (f.flagged = false));
  a.results.rules[800].flagged = true;
  const v = evaluate(a, 'rules');
  assert.equal(v.normalMinutes, 30);
  assert.equal(v.falsePerDay, 48);
});

test('calculateDewPoint accurately computes dew points and handles edge cases', () => {
  assert.equal(calculateDewPoint(null, 50), null);
  assert.equal(calculateDewPoint(25, null), null);
  assert.equal(calculateDewPoint(25, -1), null);
  // At 25°C and 50% RH, dew point is approximately 13.9°C
  const dp = calculateDewPoint(25, 50);
  assert.ok(dp !== null && dp >= 13.5 && dp <= 14.2);
  // At 100% RH, dew point equals temperature
  const dp100 = calculateDewPoint(20, 100);
  assert.ok(dp100 !== null && Math.abs(dp100 - 20) < 0.1);
});

test('calculateHeatIndex computes apparent temperatures accurately', () => {
  assert.equal(calculateHeatIndex(null, 50), null);
  assert.equal(calculateHeatIndex(25, null), null);
  // At 30°C and 80% RH, heat index should be significantly higher than 30°C
  const hi = calculateHeatIndex(30, 80);
  assert.ok(hi !== null && hi > 34);
});

