export type Channel = 'temperature' | 'pressure' | 'humidity';
export type Scenario =
  | 'none'
  | 'spike'
  | 'drift'
  | 'stuck'
  | 'dropout'
  | 'weather';
export type Label =
  | 'normal'
  | 'weather'
  | 'spike'
  | 'drift'
  | 'stuck'
  | 'dropout'
  | 'unknown';
export type Reading = {
  timestamp: number;
  temperature: number | null;
  pressure: number | null;
  humidity: number | null;
  label: Label;
};
export type Finding = {
  flagged: boolean;
  score: number;
  reason: string;
  kind: string;
};
export type Method = 'rules' | 'forest' | 'guard';
export const channels: Channel[] = ['temperature', 'pressure', 'humidity'];
export const units = { temperature: '°C', pressure: 'hPa', humidity: '%' };
export const names = {
  rules: 'Conventional checks',
  forest: 'Isolation Forest',
  guard: 'MausamGuard',
};
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
const quantile = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
};
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function demoData(seed = 73): Reading[] {
  const random = rng(seed);
  const start = Date.UTC(2026, 7, 1);
  return Array.from({ length: 960 }, (_, i) => {
    const phase = (2 * Math.PI * (i % 96)) / 96;
    const noise = () => random() + random() + random() - 1.5;
    return {
      timestamp: start + i * 15 * 60_000,
      temperature: +(26 + 5 * Math.sin(phase - 1.2) + noise() * 0.5).toFixed(3),
      pressure: +(1006 + 1.5 * Math.cos(phase) + noise() * 0.35).toFixed(3),
      humidity: +(67 - 15 * Math.sin(phase - 1.2) + noise() * 1.8).toFixed(3),
      label: 'normal',
    };
  });
}
export function splitPoints(n: number) {
  return { trainEnd: Math.floor(n * 0.6), testStart: Math.floor(n * 0.8) };
}
export function inject(
  rows: Reading[],
  scenario: Scenario,
  channel: Channel,
  severity: number,
): Reading[] {
  const out = rows.map((r) => ({ ...r }));
  if (scenario === 'none') return out;
  const { testStart } = splitPoints(rows.length);
  const start = testStart + Math.floor((rows.length - testStart) * 0.15);
  const end = Math.min(
    rows.length,
    start + Math.max(8, Math.floor((rows.length - testStart) * 0.55)),
  );
  const amp = severity * { temperature: 2, pressure: 3, humidity: 6 }[channel];
  const eligible = (r: Reading) =>
    r.label === 'normal' && channels.every((c) => r[c] !== null);
  const stuckValue = rows.slice(start, end).find(eligible)?.[channel];
  for (let i = start; i < end; i++) {
    if (!eligible(rows[i])) continue;
    const old = rows[i][channel];
    const t = (i - start) / Math.max(1, end - start - 1);
    if (scenario === 'weather') {
      const wave = Math.sin(Math.PI * t);
      if (Math.abs(wave) < 1e-8) continue;
      out[i].temperature = rows[i].temperature! - severity * wave;
      out[i].pressure = rows[i].pressure! - severity * 0.4 * wave;
      out[i].humidity = Math.min(100, rows[i].humidity! + severity * 2 * wave);
      out[i].label = 'weather';
    } else if (scenario === 'dropout') {
      out[i][channel] = null;
      out[i].label = 'dropout';
    } else if (old !== null) {
      if (scenario === 'spike' && (i - start) % 12 !== 0) continue;
      if (scenario === 'drift' && t === 0) continue;
      if (scenario === 'stuck' && (stuckValue == null || old === stuckValue))
        continue;
      out[i][channel] =
        scenario === 'stuck'
          ? stuckValue!
          : old + amp * (scenario === 'drift' ? t : 1);
      out[i].label = scenario;
    }
  }
  return out;
}
// Minimal RFC4180 parser, including quoted fields, escaped quotes and CRLF.
export function parseCSV(text: string): Reading[] {
  if (text.length > 5_000_000) throw Error('File exceeds the 5 MB limit.');
  const table: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((x) => x.trim())) table.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw Error('CSV has an unclosed quoted field.');
  row.push(field);
  if (row.some((x) => x.trim())) table.push(row);
  const header = (table.shift() ?? []).map((h) => h.trim().toLowerCase());
  const required = ['timestamp', ...channels];
  if (required.some((h) => !header.includes(h)))
    throw Error(
      'Use columns: timestamp, temperature, pressure, humidity. Optional: label.',
    );
  if (new Set(header).size !== header.length)
    throw Error('CSV contains duplicate column names.');
  if (table.length < 120 || table.length > 5000)
    throw Error('Upload 120–5,000 readings from one station.');
  const labels: Label[] = [
    'normal',
    'weather',
    'spike',
    'drift',
    'stuck',
    'dropout',
    'unknown',
  ];
  const rows = table.map((cells, n) => {
    const read = (h: string) => cells[header.indexOf(h)]?.trim() ?? '';
    const ts = read('timestamp');
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
        ts,
      )
    )
      throw Error(
        `Row ${n + 2}: timestamp must be ISO 8601 with timezone, e.g. 2026-08-01T00:00:00Z.`,
      );
    const timestamp = Date.parse(ts);
    if (!Number.isFinite(timestamp))
      throw Error(`Row ${n + 2}: invalid timestamp.`);
    const values = Object.fromEntries(
      channels.map((c) => {
        const v = read(c);
        if (v === '' || v.toLowerCase() === 'null' || v === '-9999')
          return [c, null];
        const x = Number(v);
        if (!Number.isFinite(x))
          throw Error(`Row ${n + 2}: ${c} must be numeric or blank.`);
        return [c, x];
      }),
    );
    const label = (read('label').toLowerCase() || 'unknown') as Label;
    if (!labels.includes(label))
      throw Error(`Row ${n + 2}: unrecognized label.`);
    return { timestamp, ...values, label } as Reading;
  });
  for (let i = 1; i < rows.length; i++)
    if (rows[i].timestamp <= rows[i - 1].timestamp)
      throw Error(
        'Timestamps must be unique and strictly increasing. Sort the CSV first.',
      );
  const { trainEnd, testStart } = splitPoints(rows.length);
  for (const c of channels)
    if (rows.slice(0, trainEnd).filter((r) => r[c] !== null).length < 60)
      throw Error(`At least 60 training readings are required for ${c}.`);
  if (
    rows.slice(0, trainEnd).filter((r) => channels.every((c) => r[c] !== null))
      .length < 60
  )
    throw Error('At least 60 complete training rows are required.');
  if (
    rows
      .slice(trainEnd, testStart)
      .filter((r) => channels.every((c) => r[c] !== null)).length < 20
  )
    throw Error(
      'At least 20 complete calibration rows are required in the middle 20%.',
    );
  return rows;
}
export function toCSV(rows: Reading[]) {
  return (
    'timestamp,temperature,pressure,humidity,label\n' +
    rows
      .map((r) =>
        [
          new Date(r.timestamp).toISOString(),
          ...channels.map((c) => r[c] ?? ''),
          r.label,
        ].join(','),
      )
      .join('\n')
  );
}
const basis = (timestamp: number) => {
  const h = ((timestamp % 86400000) / 86400000) * 2 * Math.PI;
  return [1, Math.sin(h), Math.cos(h), Math.sin(2 * h), Math.cos(2 * h)];
};
function solve(a: number[][], b: number[]) {
  const m = a.map((r, i) => [...r, b[i]]);
  const n = b.length;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let j = k + 1; j < n; j++)
      if (Math.abs(m[j][k]) > Math.abs(m[p][k])) p = j;
    [m[k], m[p]] = [m[p], m[k]];
    const d = m[k][k] || 1e-9;
    for (let j = k; j <= n; j++) m[k][j] /= d;
    for (let i = 0; i < n; i++)
      if (i !== k) {
        const q = m[i][k];
        for (let j = k; j <= n; j++) m[i][j] -= q * m[k][j];
      }
  }
  return m.map((r) => r[n]);
}
function fitCycle(rows: Reading[], channel: Channel) {
  const valid = rows.filter((r) => r[channel] !== null);
  const matrix = Array.from({ length: 5 }, () => Array(5).fill(0));
  const rhs = Array(5).fill(0);
  for (const r of valid) {
    const x = basis(r.timestamp);
    for (let i = 0; i < 5; i++) {
      rhs[i] += x[i] * r[channel]!;
      for (let j = 0; j < 5; j++) matrix[i][j] += x[i] * x[j];
    }
  }
  for (let i = 0; i < 5; i++) matrix[i][i] += 0.01;
  const weights = solve(matrix, rhs);
  const predict = (t: number) =>
    basis(t).reduce((v, x, i) => v + x * weights[i], 0);
  const scale = Math.max(
    sd(valid.map((r) => r[channel]! - predict(r.timestamp))),
    { temperature: 0.15, pressure: 0.15, humidity: 0.5 }[channel],
  );
  return { predict, scale };
}
type Tree = {
  size: number;
  feature?: number;
  cut?: number;
  left?: Tree;
  right?: Tree;
};
function harmonic(n: number) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n;
}
export function fitForest(samples: number[][], seed = 73) {
  const random = rng(seed),
    size = Math.min(128, samples.length),
    depth = Math.ceil(Math.log2(size));
  const grow = (data: number[][], d: number): Tree => {
    if (data.length < 2 || d >= depth) return { size: data.length };
    const features = Array.from({ length: data[0].length }, (_, i) => i).filter(
      (f) => data.some((r) => r[f] !== data[0][f]),
    );
    if (!features.length) return { size: data.length };
    const f = features[Math.floor(random() * features.length)];
    const vals = data.map((r) => r[f]);
    const min = Math.min(...vals),
      max = Math.max(...vals);
    const cut = min + (max - min) * random();
    const left = data.filter((r) => r[f] < cut),
      right = data.filter((r) => r[f] >= cut);
    if (!left.length || !right.length) return { size: data.length };
    return {
      size: data.length,
      feature: f,
      cut,
      left: grow(left, d + 1),
      right: grow(right, d + 1),
    };
  };
  const trees = Array.from({ length: 48 }, () => {
    const ids = Array.from({ length: samples.length }, (_, i) => i);
    for (let i = 0; i < size; i++) {
      const j = i + Math.floor(random() * (ids.length - i));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return grow(
      ids.slice(0, size).map((i) => samples[i]),
      0,
    );
  });
  const path = (t: Tree, row: number[], d = 0): number =>
    t.feature === undefined
      ? d + harmonic(t.size)
      : path(row[t.feature] < t.cut! ? t.left! : t.right!, row, d + 1);
  return (row: number[]) =>
    2 ** (-mean(trees.map((t) => path(t, row))) / Math.max(harmonic(size), 1));
}
export type Analysis = {
  rows: Reading[];
  trainEnd: number;
  testStart: number;
  thresholds: { forest: number; guard: number };
  predictions: Record<Channel, number[]>;
  results: Record<Method, Finding[]>;
  intervalMinutes: number;
};
export function analyse(rows: Reading[]): Analysis {
  const { trainEnd, testStart } = splitPoints(rows.length),
    train = rows.slice(0, trainEnd);
  const cycles = Object.fromEntries(
    channels.map((c) => [c, fitCycle(train, c)]),
  ) as Record<Channel, ReturnType<typeof fitCycle>>;
  const medians = Object.fromEntries(
    channels.map((c) => [
      c,
      quantile(
        train.flatMap((r) => (r[c] === null ? [] : [r[c]!])),
        0.5,
      ),
    ]),
  ) as Record<Channel, number>;
  const predictions = Object.fromEntries(
    channels.map((c) => [c, rows.map((r) => cycles[c].predict(r.timestamp))]),
  ) as Record<Channel, number[]>;
  const intervalMinutes = quantile(
    train.slice(1).map((r, i) => (r.timestamp - train[i].timestamp) / 60000),
    0.5,
  );
  const features = rows.map((r, i) => [
    ...channels.map((c) => r[c] ?? medians[c]),
    ...channels.map((c) =>
      r[c] === null || i === 0 || rows[i - 1][c] === null
        ? 0
        : r[c]! - rows[i - 1][c]!,
    ),
    ...channels.map((c) => {
      const a = rows
        .slice(Math.max(0, i - 7), i + 1)
        .flatMap((x) => (x[c] === null ? [] : [x[c]!]));
      return sd(a);
    }),
  ]);
  const trainingFeatures = features
    .slice(1, trainEnd)
    .filter((_, i) => channels.every((c) => rows[i + 1][c] !== null));
  const forest = fitForest(trainingFeatures);
  const forestScores = features.map(forest);
  const residuals = rows.map((r, i) =>
    channels.map((c) =>
      r[c] === null ? 0 : (r[c]! - predictions[c][i]) / cycles[c].scale,
    ),
  );
  const guardScores = residuals.map((z, i) =>
    Math.max(
      ...z.map(Math.abs),
      ...channels.map(
        (_, j) =>
          Math.abs(
            mean(residuals.slice(Math.max(0, i - 11), i + 1).map((x) => x[j])),
          ) * 1.5,
      ),
    ),
  );
  const calIndices = Array.from(
    { length: testStart - trainEnd },
    (_, i) => i + trainEnd,
  ).filter((i) => channels.every((c) => rows[i][c] !== null));
  const thresholds = {
    forest: Math.max(
      0.5,
      quantile(
        calIndices.map((i) => forestScores[i]),
        0.99,
      ),
    ),
    guard: Math.max(
      3.5,
      quantile(
        calIndices.map((i) => guardScores[i]),
        0.99,
      ) * 1.1,
    ),
  };
  const rules = rows.map((r, i): Finding => {
    const empty = channels.filter((c) => r[c] === null);
    if (empty.length)
      return {
        flagged: true,
        score: 1,
        kind: 'Missing reading',
        reason: `No ${empty.join(', ')} observation. Inspect sensor or transmission.`,
      };
    if (
      i &&
      r.timestamp - rows[i - 1].timestamp > intervalMinutes * 60000 * 1.5
    )
      return {
        flagged: true,
        score: 1,
        kind: 'Timestamp gap',
        reason:
          'Observation interval exceeds the training cadence. Check transmission.',
      };
    for (const c of channels) {
      const x = r[c]!;
      const limits = {
        temperature: [-90, 60],
        pressure: [300, 1100],
        humidity: [0, 100],
      }[c];
      if (x < limits[0] || x > limits[1])
        return {
          flagged: true,
          score: 1,
          kind: 'Range check',
          reason: `${c}: ${x.toFixed(2)} ${units[c]} is outside this prototype's configured range.`,
        };
      if (i > 0 && rows[i - 1][c] !== null) {
        const minutes = (r.timestamp - rows[i - 1].timestamp) / 60000;
        const rate =
          { temperature: 5, pressure: 4, humidity: 20 }[c] *
          Math.max(1, minutes / 15);
        if (Math.abs(x - rows[i - 1][c]!) > rate)
          return {
            flagged: true,
            score: 1,
            kind: 'Sudden change',
            reason: `${c} changed by ${(x - rows[i - 1][c]!).toFixed(2)} ${units[c]} in ${minutes.toFixed(1)} minutes. Review context.`,
          };
      }
      if (i >= 5 && rows.slice(i - 5, i + 1).every((v) => v[c] === x))
        return {
          flagged: true,
          score: 1,
          kind: 'Stuck reading',
          reason: `${c} is identical across six consecutive observations. Check instrument resolution and sensor health.`,
        };
    }
    return {
      flagged: false,
      score: 0,
      kind: 'Within checks',
      reason: 'No configured range, step, gap or persistence check failed.',
    };
  });
  const results: Record<Method, Finding[]> = { rules, forest: [], guard: [] };
  for (let i = 0; i < rows.length; i++) {
    const shared =
      rules[i].kind === 'Missing reading' || rules[i].kind === 'Timestamp gap';
    const fs = forestScores[i];
    results.forest.push(
      shared
        ? rules[i]
        : {
            flagged: fs > thresholds.forest,
            score: fs,
            kind: fs > thresholds.forest ? 'Unusual pattern' : 'Within model',
            reason: `Isolation Forest score ${fs.toFixed(3)}; validation threshold ${thresholds.forest.toFixed(3)}. A score is not a fault probability.`,
          },
    );
    const gs = guardScores[i],
      j = residuals[i].reduce(
        (best, x, k) => (Math.abs(x) > Math.abs(residuals[i][best]) ? k : best),
        0,
      ),
      c = channels[j];
    const sustained =
      i >= 11 &&
      Math.abs(mean(residuals.slice(i - 11, i + 1).map((x) => x[j]))) >
        thresholds.guard / 1.5;
    results.guard.push(
      rules[i].flagged
        ? rules[i]
        : {
            flagged: gs > thresholds.guard,
            score: gs,
            kind:
              gs > thresholds.guard
                ? sustained
                  ? 'Persistent deviation'
                  : 'Needs review'
                : 'Within model',
            reason:
              gs > thresholds.guard
                ? `${c} differs from its learned daily rhythm by ${(rows[i][c]! - predictions[c][i]).toFixed(2)} ${units[c]}. ${sustained ? 'Deviation persists across recent readings. ' : ''}Weather or a sensor issue could explain this; operator review is required.`
                : 'Readings agree with the learned daily rhythm and configured checks.',
          },
    );
  }
  return {
    rows,
    trainEnd,
    testStart,
    thresholds,
    predictions,
    results,
    intervalMinutes,
  };
}
export function isFault(label: Label) {
  return ['spike', 'drift', 'stuck', 'dropout'].includes(label);
}
export type Event = { start: number; end: number };
export function events(flags: boolean[]): Event[] {
  const out: Event[] = [];
  flags.forEach((f, i) => {
    if (f) {
      if (i > 0 && flags[i - 1]) out[out.length - 1].end = i;
      else out.push({ start: i, end: i });
    }
  });
  return out;
}
export function evaluate(a: Analysis, method: Method, until = a.rows.length) {
  const end = Math.min(until, a.rows.length),
    rows = a.rows.slice(a.testStart, end),
    findings = a.results[method].slice(a.testStart, end);
  const trueEvents: Event[] = [];
  rows.forEach((r, i) => {
    if (isFault(r.label)) {
      if (i && r.label === rows[i - 1].label)
        trueEvents[trueEvents.length - 1].end = i;
      else trueEvents.push({ start: i, end: i });
    }
  });
  const alerts = events(findings.map((f) => f.flagged));
  const delays: number[] = [];
  let detected = 0;
  for (const e of trueEvents) {
    const hit = findings.findIndex(
      (f, i) => i >= e.start && i <= e.end && f.flagged,
    );
    if (hit >= 0) {
      detected++;
      delays.push((rows[hit].timestamp - rows[e.start].timestamp) / 60000);
    }
  }
  const normal = (r: Reading) => r.label === 'normal' || r.label === 'weather';
  const falseAlerts = events(
    findings.map((f, i) => f.flagged && normal(rows[i])),
  ).length;
  let normalMinutes = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const dt = (rows[i + 1].timestamp - rows[i].timestamp) / 60000;
    if (
      normal(rows[i]) &&
      normal(rows[i + 1]) &&
      dt > 0 &&
      dt <= a.intervalMinutes * 1.5
    )
      normalMinutes += dt;
  }
  return {
    events: trueEvents.length,
    detected,
    recall: trueEvents.length ? detected / trueEvents.length : null,
    delay: delays.length ? mean(delays) : null,
    falsePerDay: normalMinutes ? falseAlerts / (normalMinutes / 1440) : null,
    normalMinutes,
    falseAlerts,
    alerts: alerts.length,
    unknown: rows.filter((r) => r.label === 'unknown').length,
    known: rows.length - rows.filter((r) => r.label === 'unknown').length,
  };
}

/**
 * Calculates the Dew Point in °C using the Magnus-Tetens approximation.
 */
export function calculateDewPoint(
  tempC: number | null,
  rhPercent: number | null,
): number | null {
  if (tempC === null || rhPercent === null || rhPercent <= 0) return null;
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * tempC) / (b + tempC) + Math.log(rhPercent / 100);
  const dp = (b * alpha) / (a - alpha);
  return Number.isFinite(dp) ? +dp.toFixed(2) : null;
}

/**
 * Calculates the Heat Index (apparent temperature) in °C using NOAA's formula.
 */
export function calculateHeatIndex(
  tempC: number | null,
  rhPercent: number | null,
): number | null {
  if (tempC === null || rhPercent === null) return null;
  // Convert C to F
  const tf = tempC * 1.8 + 32;
  const rh = rhPercent;

  // Below 80°F (approx 26.7°C), Heat Index is not significantly elevated above actual temperature
  if (tf < 80) {
    const simpleHi = 0.5 * (tf + 61.0 + (tf - 68.0) * 1.2 + rh * 0.094);
    const avgHi = (simpleHi + tf) / 2;
    return +((avgHi - 32) / 1.8).toFixed(2);
  }

  // Rothfusz regression equation
  let hi =
    -42.379 +
    2.04901523 * tf +
    10.14333127 * rh -
    0.22475541 * tf * rh -
    0.00683783 * tf * tf -
    0.05481717 * rh * rh +
    0.00122874 * tf * tf * rh +
    0.00085282 * tf * rh * rh -
    0.00000199 * tf * tf * rh * rh;

  // Adjustments
  if (rh < 13 && tf >= 80 && tf <= 112) {
    const adj = ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(tf - 95)) / 17);
    hi -= adj;
  } else if (rh > 85 && tf >= 80 && tf <= 87) {
    const adj = ((rh - 85) / 10) * ((87 - tf) / 5);
    hi += adj;
  }

  const hiC = (hi - 32) / 1.8;
  return Number.isFinite(hiC) ? +hiC.toFixed(2) : null;
}

export type CityPreset = {
  name: string;
  lat: number;
  lon: number;
  state: string;
};

export const CITY_PRESETS: Record<string, CityPreset> = {
  delhi: { name: 'New Delhi', lat: 28.6139, lon: 77.209, state: 'Delhi' },
  mumbai: { name: 'Mumbai', lat: 19.076, lon: 72.8777, state: 'Maharashtra' },
  bengaluru: {
    name: 'Bengaluru',
    lat: 12.9716,
    lon: 77.5946,
    state: 'Karnataka',
  },
  kolkata: {
    name: 'Kolkata',
    lat: 22.5726,
    lon: 88.3639,
    state: 'West Bengal',
  },
  chennai: { name: 'Chennai', lat: 13.0827, lon: 80.2707, state: 'Tamil Nadu' },
  shimla: {
    name: 'Shimla',
    lat: 31.1048,
    lon: 77.1734,
    state: 'Himachal Pradesh',
  },
  hyderabad: {
    name: 'Hyderabad',
    lat: 17.385,
    lon: 78.4867,
    state: 'Telangana',
  },
  pune: { name: 'Pune', lat: 18.5204, lon: 73.8567, state: 'Maharashtra' },
};

/**
 * Fetches real weather station observations from Open-Meteo API.
 */
export async function fetchOpenMeteoStation(
  lat: number,
  lon: number,
  locationName: string,
  days = 14,
): Promise<{ rows: Reading[]; source: string }> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,surface_pressure&past_days=${days}&forecast_days=0`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as {
    hourly?: {
      time?: string[];
      temperature_2m?: (number | null)[];
      relative_humidity_2m?: (number | null)[];
      surface_pressure?: (number | null)[];
    };
  };
  const times: string[] = data?.hourly?.time || [];
  const temps: (number | null)[] = data?.hourly?.temperature_2m || [];
  const hums: (number | null)[] = data?.hourly?.relative_humidity_2m || [];
  const press: (number | null)[] = data?.hourly?.surface_pressure || [];

  if (times.length < 120) {
    throw new Error(`Insufficient data returned from API (${times.length} rows, minimum 120 required).`);
  }

  const rows: Reading[] = times.map((t, idx) => {
    // Open-Meteo timestamps are in UTC format "YYYY-MM-DDTHH:00"
    const timestamp = new Date(t + 'Z').getTime();
    return {
      timestamp,
      temperature: temps[idx] != null ? +temps[idx]!.toFixed(2) : null,
      pressure: press[idx] != null ? +press[idx]!.toFixed(2) : null,
      humidity: hums[idx] != null ? +hums[idx]!.toFixed(2) : null,
      label: 'normal',
    };
  });

  return {
    rows,
    source: `Live Station: ${locationName} (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E)`,
  };
}

