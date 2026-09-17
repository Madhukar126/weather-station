'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  FlaskConical,
  Gauge,
  Info,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Thermometer,
  Droplets,
  Wind,
  ChevronRight,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  MapPin,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  analyse,
  channels,
  demoData,
  evaluate,
  inject,
  names,
  parseCSV,
  toCSV,
  units,
  calculateDewPoint,
  calculateHeatIndex,
  fetchOpenMeteoStation,
  CITY_PRESETS,
  type Channel,
  type Method,
  type Reading,
  type Scenario,
} from '@/lib/engine';
const scenarioNames: Record<Scenario, string> = {
  none: 'No injected fault',
  drift: 'Gradual drift',
  spike: 'Sudden spikes',
  stuck: 'Stuck sensor',
  dropout: 'Missing readings',
  weather: 'Weather-like change',
};
const channelNames: Record<Channel, string> = {
  temperature: 'Temperature',
  pressure: 'Pressure',
  humidity: 'Humidity',
};
const methods: Method[] = ['rules', 'forest', 'guard'];
const time = (t: number) => new Date(t).toISOString().slice(11, 16);
const date = (t: number) =>
  new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const fmt = (n: number | null, d = 1) => (n === null ? '—' : n.toFixed(d));
function download(name: string, content: string, type = 'text/plain') {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function Picker<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <Select value={value} onValueChange={(v) => v && onChange(v as T)}>
        <SelectTrigger aria-label={label}>
          <SelectValue>{options[value]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(options).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text as string}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export default function Home() {
  const [base, setBase] = useState<Reading[]>(() => demoData()),
    [source, setSource] = useState('Synthetic station · MG-001');
  const [scenario, setScenario] = useState<Scenario>('drift'),
    [channel, setChannel] = useState<Channel>('temperature'),
    [severity, setSeverity] = useState(3),
    [seed, setSeed] = useState(73);
  const [method, setMethod] = useState<Method>('guard'),
    [playing, setPlaying] = useState(false),
    [cursor, setCursor] = useState(960),
    [selected, setSelected] = useState<number | null>(null);
  const [reviews, setReviews] = useState<
    Record<number, { status: string; at: string }>
  >(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('mausamguard_reviews');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return {};
  });
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [selectedCity, setSelectedCity] = useState<string>('delhi');
  const [loadingLive, setLoadingLive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('mausamguard_reviews', JSON.stringify(reviews));
    } catch {}
  }, [reviews]);

  const loadLiveStation = async (cityKey: string) => {
    const city = CITY_PRESETS[cityKey];
    if (!city) return;
    setLoadingLive(true);
    setError('');
    try {
      const result = await fetchOpenMeteoStation(city.lat, city.lon, city.name);
      setBase(result.rows);
      setSource(result.source);
      setScenario('none');
      setPlaying(false);
      setCursor(result.rows.length);
      setSelected(null);
      setNotice(
        `Loaded 14 days of real meteorological station observations for ${city.name} (${result.rows.length} hourly readings). Anomaly models calibrated.`,
      );
    } catch (err) {
      setError((err as Error).message || 'Failed to fetch live station data.');
    } finally {
      setLoadingLive(false);
    }
  };
  const rows = useMemo(
      () => inject(base, scenario, channel, severity),
      [base, scenario, channel, severity],
    ),
    analysis = useMemo(() => analyse(rows), [rows]);
  const visibleEnd = Math.min(cursor, rows.length),
    last = rows[Math.max(analysis.testStart, visibleEnd - 1)],
    metrics = evaluate(analysis, method, visibleEnd);
  const alertIndices = useMemo(
    () =>
      analysis.results[method]
        .flatMap((f, i) =>
          i >= analysis.testStart && i < visibleEnd && f.flagged ? [i] : [],
        )
        .reverse(),
    [analysis, method, visibleEnd],
  );
  const active =
      selected !== null && selected < visibleEnd ? selected : alertIndices[0],
    finding = active === undefined ? null : analysis.results[method][active];
  const chart = useMemo(
    () =>
      rows
        .slice(analysis.testStart, visibleEnd)
        .map((r, j) => ({
          timestamp: r.timestamp,
          observed: r[channel],
          expected: analysis.predictions[channel][analysis.testStart + j],
          alert: analysis.results[method][analysis.testStart + j].flagged
            ? r[channel]
            : null,
        })),
    [analysis, rows, visibleEnd, channel, method],
  );
  const resetView = () => {
    setPlaying(false);
    setCursor(base.length);
    setSelected(null);
    setReviews({});
  };
  const stateRef = useRef({ source, scenario, channel, severity, metrics: {} });
  stateRef.current = {
    source,
    scenario,
    channel,
    severity,
    metrics: Object.fromEntries(
      methods.map((m) => [m, evaluate(analysis, m, visibleEnd)]),
    ),
  };
  const configureRef = useRef((s: Scenario, c: Channel, n: number) => {});
  configureRef.current = (s, c, n) => {
    flushSync(() => {
      setScenario(s);
      setChannel(c);
      setSeverity(n);
      resetView();
    });
  };
  useEffect(() => {
    type Tool = {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    };
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: Tool,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      {
        name: 'get_weather_comparison',
        description:
          'Read the current source, scenario and calculated method comparison at the visible replay position.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => stateRef.current,
      },
      {
        name: 'configure_weather_experiment',
        description:
          'Change the visible test scenario, sensor and magnitude, show the full test period and reset session reviews. Only reviewed complete normal rows are modified.',
        inputSchema: {
          type: 'object',
          properties: {
            scenario: { type: 'string', enum: Object.keys(scenarioNames) },
            channel: { type: 'string', enum: channels },
            severity: { type: 'integer', minimum: 1, maximum: 5 },
          },
          required: ['scenario', 'channel', 'severity'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input) => {
          if (!input || typeof input !== 'object')
            throw Error('Expected experiment settings.');
          const v = input as Record<string, unknown>;
          if (
            typeof v.scenario !== 'string' ||
            !Object.hasOwn(scenarioNames, v.scenario) ||
            !channels.includes(v.channel as Channel) ||
            !Number.isInteger(v.severity) ||
            Number(v.severity) < 1 ||
            Number(v.severity) > 5 ||
            Object.keys(v).some(
              (k) => !['scenario', 'channel', 'severity'].includes(k),
            )
          )
            throw Error('Invalid scenario, channel or magnitude.');
          configureRef.current(
            v.scenario as Scenario,
            v.channel as Channel,
            Number(v.severity),
          );
          return stateRef.current;
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Browser feature is optional; the visible interface remains available. */
      }
    }
    return () => lifecycle.abort();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(
      () => setCursor((i) => Math.min(i + 2, rows.length)),
      160,
    );
    return () => clearInterval(id);
  }, [playing, rows.length]);
  useEffect(() => {
    if (cursor >= rows.length && playing) setPlaying(false);
  }, [cursor, rows.length, playing]);
  const review = (status: string) => {
    if (active === undefined) return;
    setReviews((r) => ({
      ...r,
      [active]: { status, at: new Date().toISOString() },
    }));
    setNotice(`Reading marked “${status}”. Included in the report export.`);
  };
  const exportReport = () =>
    download(
      'mausamguard-report.json',
      JSON.stringify(
        {
          product: 'MausamGuard SIH26073 prototype',
          exportedAt: new Date().toISOString(),
          source,
          scenario,
          channel,
          severity,
          seed,
          observations: rows.length,
          replayedTestObservations: visibleEnd - analysis.testStart,
          split: {
            training: [0, analysis.trainEnd],
            validation: [analysis.trainEnd, analysis.testStart],
            test: [analysis.testStart, visibleEnd],
          },
          thresholds: analysis.thresholds,
          methodology:
            '48-tree Isolation Forest; harmonic daily-cycle regression with sustained standardized residuals and rule checks. No calibrated fault probabilities. Training 60%, validation 20%, test 20%.',
          limitations: [
            'Synthetic demonstration is not field validation.',
            'Uploaded labels are user supplied.',
            'Weather-like scenario is constructed, not verified real weather.',
            'Daily rhythm is learned; seasonal adaptation is not implemented.',
            'False alerts are evaluated only on labelled normal/weather observations.',
            'Reviews do not retrain detectors or alter benchmark truth.',
          ],
          metrics: Object.fromEntries(
            methods.map((m) => [m, evaluate(analysis, m, visibleEnd)]),
          ),
          reviews,
          readings: rows
            .slice(analysis.testStart, visibleEnd)
            .map((r, j) => ({
              ...r,
              timestamp: new Date(r.timestamp).toISOString(),
              findings: Object.fromEntries(
                methods.map((m) => [
                  m,
                  analysis.results[m][analysis.testStart + j],
                ]),
              ),
            })),
        },
        null,
        2,
      ),
      'application/json',
    );
  const upload = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      if (file.size > 5_000_000) throw Error('File exceeds the 5 MB limit.');
      const next = parseCSV(await file.text());
      setBase(next);
      setSource(`Uploaded · ${file.name}`);
      setScenario('none');
      setPlaying(false);
      setCursor(next.length);
      setSelected(null);
      setReviews({});
      setNotice(
        `Loaded ${next.length.toLocaleString()} readings. Unknown labels are excluded from accuracy metrics.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Activity size={25} />
          </span>
          <div>
            Mausam<span>Guard</span>
            <small>WEATHER OBSERVATION LAB</small>
          </div>
        </div>
        <div className="header-right">
          <span className="local">
            <span />
            Browser-local processing
          </span>
          <span className="edition">SIH26073 · PROTOTYPE</span>
        </div>
      </header>
      <div className="workspace">
        <section className="page-heading">
          <div>
            <p className="eyebrow">STATION INTELLIGENCE / EXPERIMENT 01</p>
            <h1>Trust the observation.</h1>
            <p>Inspect sensor behaviour. Test faults. Compare the evidence.</p>
          </div>
          <Button variant="outline" onClick={exportReport}>
            <ArrowDownToLine />
            Export report
          </Button>
        </section>
        <div className="source-strip">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <FlaskConical size={18} />
            <strong>{source}</strong>
            <span className="divider" />
            <span>{base.length.toLocaleString()} observations</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span>
              {source.startsWith('Synthetic')
                ? 'Generated demonstration data · not a live IMD feed'
                : source.startsWith('Live Station')
                  ? 'Real-world station telemetry · Open-Meteo API feed'
                  : 'Single-station upload · labels supplied by user'}
            </span>
          </div>
        </div>
        <Tabs defaultValue="monitor" className="main-tabs">
          <TabsList variant="line">
            <TabsTrigger value="monitor">
              <Activity />
              Monitor
            </TabsTrigger>
            <TabsTrigger value="benchmark">
              <Gauge />
              Compare methods
            </TabsTrigger>
            <TabsTrigger value="data">
              <ArrowUpFromLine />
              Data workspace
            </TabsTrigger>
            <TabsTrigger value="method">
              <Info />
              How it works
            </TabsTrigger>
          </TabsList>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice('')}
              >
                ×
              </button>
            </div>
          )}
          <TabsContent value="monitor">
            <section className="stats">
              <article>
                <span>
                  <Thermometer />
                  Temperature
                </span>
                <strong>
                  {fmt(last.temperature)}
                  <small>°C</small>
                </strong>
                <p>Last replayed observation</p>
              </article>
              <article>
                <span>
                  <Wind />
                  Pressure
                </span>
                <strong>
                  {fmt(last.pressure)}
                  <small>hPa</small>
                </strong>
                <p>Station pressure</p>
              </article>
              <article>
                <span>
                  <Droplets />
                  Relative humidity
                </span>
                <strong>
                  {fmt(last.humidity)}
                  <small>%</small>
                </strong>
                <p>Last replayed observation</p>
              </article>
              <article>
                <span>
                  <Droplets />
                  Dew point
                </span>
                <strong>
                  {fmt(calculateDewPoint(last.temperature, last.humidity))}
                  <small>°C</small>
                </strong>
                <p>Moisture condensation temp</p>
              </article>
              <article>
                <span>
                  <Thermometer />
                  Heat index
                </span>
                <strong>
                  {fmt(calculateHeatIndex(last.temperature, last.humidity))}
                  <small>°C</small>
                </strong>
                <p>Apparent perceived temp</p>
              </article>
              <article className="stat-alert">
                <span>
                  <CircleHelp />
                  Alert events
                </span>
                <strong>
                  {metrics.alerts}
                  <small>for review</small>
                </strong>
                <p>
                  {alertIndices.length} flagged observations · {names[method]}
                </p>
              </article>
            </section>
            <div className="monitor-grid">
              <section className="panel chart-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">HELD-OUT OBSERVATIONS</p>
                    <h2>{channelNames[channel]} timeline</h2>
                  </div>
                  <div className="legend">
                    <span className="blue-dot" />
                    Observed
                    <span className="dash" />
                    Learned daily rhythm
                    <span className="amber-dot" />
                    Flagged
                  </div>
                </div>
                <div className="chart-controls">
                  <Picker
                    label="Measurement"
                    value={channel}
                    options={channelNames}
                    onChange={(v) => {
                      setChannel(v);
                      resetView();
                    }}
                  />
                  <Picker
                    label="Detector"
                    value={method}
                    options={names}
                    onChange={(v) => {
                      setMethod(v);
                      setSelected(null);
                    }}
                  />
                  <span className="timestamp">{date(last.timestamp)}</span>
                </div>
                <div
                  className="chart"
                  role="img"
                  aria-label={`${channelNames[channel]} in ${units[channel]} against UTC time; observed readings, learned daily rhythm and flagged observations.`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chart}
                      margin={{ top: 15, right: 24, bottom: 20, left: 5 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 5"
                        vertical={false}
                        stroke="#dfe7ef"
                      />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={time}
                        minTickGap={45}
                        tick={{ fontSize: 12, fill: '#5a6a7e' }}
                        label={{
                          value: 'Time (UTC)',
                          position: 'insideBottom',
                          offset: -14,
                          fill: '#5a6a7e',
                          fontSize: 12,
                        }}
                      />
                      <YAxis
                        domain={['auto', 'auto']}
                        tick={{ fontSize: 12, fill: '#5a6a7e' }}
                        width={55}
                        tickFormatter={(v) => Number(v).toFixed(0)}
                        label={{
                          value: units[channel],
                          angle: -90,
                          position: 'insideLeft',
                          fill: '#5a6a7e',
                        }}
                      />
                      <Tooltip
                        labelFormatter={(v) => date(Number(v))}
                        formatter={(v) =>
                          typeof v === 'number' ? v.toFixed(2) : v
                        }
                      />
                      <Line
                        name="Learned daily rhythm"
                        dataKey="expected"
                        stroke="#8799ae"
                        strokeDasharray="5 5"
                        dot={false}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                      <Line
                        name="Observed"
                        dataKey="observed"
                        stroke="#1768df"
                        dot={false}
                        strokeWidth={2.3}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                      <Line
                        name="Flagged reading"
                        dataKey="alert"
                        stroke="transparent"
                        dot={{ r: 3, fill: '#d88116', strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                      {active !== undefined && (
                        <ReferenceLine
                          x={rows[active].timestamp}
                          stroke="#b96b15"
                          strokeDasharray="3 4"
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="replay">
                  <Button
                    onClick={() => {
                      if (playing) setPlaying(false);
                      else {
                        if (cursor >= rows.length)
                          setCursor(analysis.testStart + 1);
                        setSelected(null);
                        setPlaying(true);
                      }
                    }}
                  >
                    {playing ? <Pause /> : <Play />}
                    {playing ? 'Pause replay' : 'Replay test period'}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label="Reset replay"
                    onClick={resetView}
                  >
                    <RotateCcw />
                  </Button>
                  <div className="replay-range">
                    <Slider
                      aria-label="Replayed observations"
                      value={[visibleEnd]}
                      min={analysis.testStart + 1}
                      max={rows.length}
                      onValueChange={(v) => {
                        setPlaying(false);
                        setCursor(Array.isArray(v) ? v[0] : v);
                        setSelected(null);
                      }}
                    />
                    <span>
                      {visibleEnd - analysis.testStart} /{' '}
                      {rows.length - analysis.testStart} test readings
                    </span>
                  </div>
                </div>
                <p className="caption">
                  {date(rows[analysis.testStart].timestamp)} —{' '}
                  {date(last.timestamp)}. Missing values remain gaps. The grey
                  line is a fitted reference, not a corrected observation.
                </p>
              </section>
              <aside className="panel simulator">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">CONTROLLED EXPERIMENT</p>
                    <h2>Fault laboratory</h2>
                  </div>
                  <FlaskConical className="accent-icon" />
                </div>
                <p>
                  Only complete test rows labelled normal are changed. Unknown,
                  faulty and missing readings stay untouched.
                </p>
                <Picker
                  label="Scenario"
                  value={scenario}
                  options={scenarioNames}
                  onChange={(v) => {
                    setScenario(v);
                    resetView();
                  }}
                />
                <Picker
                  label="Target sensor"
                  value={channel}
                  options={channelNames}
                  onChange={(v) => {
                    setChannel(v);
                    resetView();
                  }}
                />
                <div className="field">
                  <span>
                    Magnitude <b>{severity} / 5</b>
                  </span>
                  <Slider
                    aria-label="Fault magnitude"
                    min={1}
                    max={5}
                    step={1}
                    value={[severity]}
                    onValueChange={(v) => {
                      setSeverity(Array.isArray(v) ? v[0] : v);
                      resetView();
                    }}
                  />
                  <small>
                    {scenario === 'stuck' || scenario === 'dropout'
                      ? 'Magnitude does not affect stuck or missing readings.'
                      : scenario === 'weather'
                        ? 'Constructed cooling, humidity and pressure change; not a real event.'
                        : `Maximum injected offset: ${severity * { temperature: 2, pressure: 3, humidity: 6 }[channel]} ${units[channel]}.`}
                  </small>
                </div>
                <div className="split-block">
                  <span>Chronological data split</span>
                  <div className="split-bar">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div>
                    <span>60% train</span>
                    <span>20% calibrate</span>
                    <span>20% test</span>
                  </div>
                </div>
                <div className="callout">
                  <ShieldCheck size={20} />
                  <p>
                    Scores indicate unusual behaviour. They do not prove a
                    sensor is faulty.
                  </p>
                </div>
              </aside>
            </div>
            <div className="review-grid">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">OPERATOR QUEUE</p>
                    <h2>Flagged observations</h2>
                  </div>
                  <span className="count">{alertIndices.length} readings</span>
                </div>
                {!alertIndices.length ? (
                  <div className="empty">
                    <CheckCircle2 />
                    <h3>No readings flagged in this replay</h3>
                    <p>
                      Try a fault scenario or replay further into the test
                      period.
                    </p>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time (UTC)</TableHead>
                          <TableHead>Finding</TableHead>
                          <TableHead>Review</TableHead>
                          <TableHead>
                            <span className="sr-only">Inspect</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {alertIndices.slice(0, 40).map((i) => (
                          <TableRow key={i} data-selected={active === i}>
                            <TableCell>
                              {date(rows[i].timestamp).replace(' UTC', '')}
                            </TableCell>
                            <TableCell>
                              <span className="finding-badge">
                                {analysis.results[method][i].kind}
                              </span>
                            </TableCell>
                            <TableCell>
                              {reviews[i]?.status ?? 'Unreviewed'}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                aria-label={`Inspect ${date(rows[i].timestamp)}`}
                                onClick={() => setSelected(i)}
                              >
                                <ChevronRight />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="caption">
                  Latest 40 flags shown. Export includes all replayed test
                  readings. Reviews last for this session and reset when data or
                  scenario changes.
                </p>
              </section>
              <aside className="panel evidence">
                <p className="eyebrow">EVIDENCE & ACTION</p>
                <h2>{finding?.kind ?? 'Ready to inspect'}</h2>
                {finding && active !== undefined ? (
                  <>
                    <span className="timestamp">
                      {date(rows[active].timestamp)}
                    </span>
                    <p>{finding.reason}</p>
                    <dl>
                      {channels.map((c) => (
                        <div key={c}>
                          <dt>{channelNames[c]}</dt>
                          <dd>
                            {fmt(rows[active][c], 2)} {units[c]}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="caption">
                      Labels are not supplied to detectors. Operator decisions
                      do not change evaluation labels.
                    </p>
                    <div className="review-actions">
                      <Button onClick={() => review('Suspected fault')}>
                        Suspected fault
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => review('Valid weather')}
                      >
                        Valid weather
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => review('Needs investigation')}
                      >
                        Needs investigation
                      </Button>
                    </div>
                    {reviews[active] && (
                      <p role="status" className="reviewed">
                        Recorded: {reviews[active].status}
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    Select a flagged observation to see measurements and
                    supporting evidence.
                  </p>
                )}
              </aside>
            </div>
          </TabsContent>
          <TabsContent value="benchmark">
            <section className="panel benchmark">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">REPRODUCIBLE COMPARISON</p>
                  <h2>Same readings. Three approaches.</h2>
                </div>
                <Button variant="outline" onClick={exportReport}>
                  <ArrowDownToLine />
                  Download results
                </Button>
              </div>
              <p>
                Calculated from the current scenario and replay position.
                Results may favour any method; no improvement is assumed.
              </p>
              <div className="benchmark-context">
                <span>{scenarioNames[scenario]}</span>
                <span>{visibleEnd - analysis.testStart} test readings</span>
                <span>
                  {source.startsWith('Synthetic')
                    ? 'Synthetic labels'
                    : 'User-provided labels'}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead>Fault events detected</TableHead>
                    <TableHead>Event recall</TableHead>
                    <TableHead>Mean detection delay</TableHead>
                    <TableHead>False episodes / station-day</TableHead>
                    <TableHead>Total alert events</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {methods.map((m) => {
                    const v = evaluate(analysis, m, visibleEnd);
                    return (
                      <TableRow key={m}>
                        <TableCell>
                          <strong>{names[m]}</strong>
                          {m === 'guard' && (
                            <small className="cell-note">
                              Daily rhythm + persistence + checks
                            </small>
                          )}
                        </TableCell>
                        <TableCell>
                          {v.detected} / {v.events}
                        </TableCell>
                        <TableCell>
                          {v.recall === null
                            ? 'N/A'
                            : `${(v.recall * 100).toFixed(1)}%`}
                        </TableCell>
                        <TableCell>
                          {v.delay === null
                            ? 'N/A'
                            : `${v.delay.toFixed(1)} min`}
                        </TableCell>
                        <TableCell>
                          {v.falsePerDay === null
                            ? 'N/A'
                            : v.falsePerDay.toFixed(2)}
                        </TableCell>
                        <TableCell>{v.alerts}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="method-grid">
                <article>
                  <h3>What counts as an event?</h3>
                  <p>
                    Consecutive flagged readings form one alert. Consecutive
                    fault labels of the same type form one true event. A
                    detection must occur within that event.
                  </p>
                </article>
                <article>
                  <h3>What counts as a false alert?</h3>
                  <p>
                    Contiguous flagged segments on normal/weather labels count
                    as false episodes, even when part of a longer alarm.
                    Exposure uses actual intervals between reviewed normal rows;
                    gaps over 1.5× the training cadence are excluded.
                  </p>
                </article>
                <article>
                  <h3>Read these results carefully</h3>
                  <p>
                    {metrics.unknown
                      ? `${metrics.unknown} readings have unknown labels. `
                      : ''}
                    Synthetic success is not field validation. The weather-like
                    scenario is a constructed stress test, not a verified
                    weather event.
                  </p>
                </article>
              </div>
              <div className="callout">
                <Info />
                <p>
                  Thresholds are calibrated separately. Research claims also
                  need matched false-alert comparisons across multiple stations,
                  seasons and unseen fault severities.
                </p>
              </div>
            </section>
          </TabsContent>
          <TabsContent value="data">
            <section className="panel" style={{ marginBottom: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ maxWidth: '600px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span className="upload-icon" style={{ padding: '8px', borderRadius: '8px', background: '#e0f2fe', color: '#0369a1' }}>
                      <MapPin size={20} />
                    </span>
                    <p className="eyebrow" style={{ margin: 0 }}>METEOROLOGICAL TELEMETRY ARCHIVE</p>
                  </div>
                  <h2 style={{ margin: '6px 0 10px' }}>Connect Live Indian Weather Station</h2>
                  <p style={{ color: '#52667c', fontSize: '0.92rem', lineHeight: '1.6' }}>
                    Fetch authentic, real-world hourly sensor readings (past 14 days · 336 observations) directly from automated weather station archives across India via Open-Meteo. Runs anomaly detection and ridge regression models over real atmospheric data.
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '300px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#49627b' }}>
                    SELECT OBSERVATORY:
                  </label>
                  <select
                    value={selectedCity}
                    onChange={(e) => setSelectedCity(e.target.value)}
                    style={{
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid #c9d8e8',
                      background: '#fff',
                      fontSize: '0.9rem',
                      fontWeight: 500,
                      color: '#13263c',
                    }}
                  >
                    {Object.entries(CITY_PRESETS).map(([k, c]) => (
                      <option key={k} value={k}>
                        {c.name}, {c.state} ({c.lat.toFixed(2)}°N, {c.lon.toFixed(2)}°E)
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={loadingLive}
                    onClick={() => void loadLiveStation(selectedCity)}
                  >
                    <RefreshCw className={loadingLive ? 'animate-spin' : ''} />
                    {loadingLive ? 'Connecting to observatory...' : `Load 14-day telemetry for ${CITY_PRESETS[selectedCity]?.name}`}
                  </Button>
                </div>
              </div>
            </section>
            <div className="data-grid">
              <section className="panel upload-panel">
                <span className="upload-icon">
                  <ArrowUpFromLine size={32} />
                </span>
                <h2>Bring your station data</h2>
                <p>
                  Upload a CSV with 120–5,000 chronological observations from
                  one station. Maximum 5 MB.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  aria-label="Upload weather CSV"
                  onChange={(e) => void upload(e.target.files?.[0])}
                />
                <Button onClick={() => fileRef.current?.click()}>
                  <ArrowUpFromLine />
                  Choose CSV file
                </Button>
                <p className="caption">
                  Files are processed in this browser session. There is no
                  server upload or saved cloud copy.
                </p>
                <code>
                  timestamp,temperature,pressure,humidity,label
                  <br />
                  2026-08-01T00:00:00Z,25.2,1006.4,72,normal
                </code>
                <Button
                  variant="outline"
                  onClick={() =>
                    download(
                      'mausamguard-sample.csv',
                      toCSV(demoData()),
                      'text/csv',
                    )
                  }
                >
                  <ArrowDownToLine />
                  Download sample CSV
                </Button>
              </section>
              <section className="panel">
                <p className="eyebrow">INPUT CONTRACT</p>
                <h2>Prepare a clean import</h2>
                <ul className="instructions">
                  <li>
                    Use the exact column names shown. Units: °C, hPa and
                    relative humidity %.
                  </li>
                  <li>
                    Timestamps must include a timezone and be strictly
                    increasing. Duplicate or unsorted timestamps are rejected.
                  </li>
                  <li>
                    Use blank, null or -9999 for missing values. Missing
                    timestamps are detected when the next row arrives.
                  </li>
                  <li>
                    Optional label values: normal, weather, spike, drift, stuck,
                    dropout, unknown.
                  </li>
                  <li>
                    Only use normal or weather after review. Unlabelled data
                    cannot establish accuracy.
                  </li>
                  <li>
                    The first 60% should represent normal station behaviour.
                    Contaminated training data can degrade both models.
                  </li>
                </ul>
                <div className="data-actions">
                  <Button
                    variant="outline"
                    onClick={() =>
                      download(
                        'mausamguard-current.csv',
                        toCSV(rows),
                        'text/csv',
                      )
                    }
                  >
                    <ArrowDownToLine />
                    Export readings
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const next = seed + 1;
                      setSeed(next);
                      setBase(demoData(next));
                      setSource('Synthetic station · MG-001');
                      setScenario('drift');
                      setCursor(960);
                      setPlaying(false);
                      setReviews({});
                      setSelected(null);
                      setNotice(
                        `New deterministic demo generated with seed ${next}.`,
                      );
                    }}
                  >
                    <RotateCcw />
                    New demo seed
                  </Button>
                </div>
                <p className="caption">
                  Source: {source}. Seed {seed} applies to generated
                  observations only. Refreshing restores the default demo.
                </p>
              </section>
            </div>
          </TabsContent>
          <TabsContent value="method">
            <section className="panel methodology">
              <p className="eyebrow">SIH26073 / PROTOTYPE NOTES</p>
              <h2>Evidence before certainty.</h2>
              <p className="intro">
                An experiment in weather-observation quality control. Not
                connected to IMD; not a certified warning system.
              </p>
              <div className="method-grid">
                <article>
                  <span className="step">01</span>
                  <h3>Conventional checks</h3>
                  <p>
                    Physical ranges, interval-scaled sudden changes, six
                    identical readings and missing data. Settings are editable
                    in source. This is not an official IMD or WMO
                    implementation.
                  </p>
                </article>
                <article>
                  <span className="step">02</span>
                  <h3>Isolation Forest</h3>
                  <p>
                    A real 48-tree isolation ensemble trained on up to 128
                    samples per tree. Features: three readings, one-step
                    differences and trailing eight-reading variability. A
                    validation quantile sets the threshold.
                  </p>
                </article>
                <article>
                  <span className="step">03</span>
                  <h3>MausamGuard</h3>
                  <p>
                    Fits daily harmonic regression per measurement. Combines
                    standardized residuals, sustained twelve-reading deviations
                    and conventional checks. Learns daily rhythm; seasonal
                    adaptation is future work.
                  </p>
                </article>
              </div>
              <div className="method-grid">
                <article>
                  <h3>Chronology preserved</h3>
                  <p>
                    60% trains models; 20% calibrates thresholds; final 20%
                    evaluates. Fault injection affects only the final segment.
                    Rolling features use past and current observations only.
                  </p>
                </article>
                <article>
                  <h3>Uncertainty visible</h3>
                  <p>
                    Scores are not calibrated probabilities. Three measurements
                    cannot distinguish every real weather event from a sensor
                    fault. A flag does not establish a physical root cause.
                  </p>
                </article>
                <article>
                  <h3>Local and reproducible</h3>
                  <p>
                    JavaScript analysis with no external model APIs. A seeded
                    generator makes demos repeatable. Reports include
                    parameters, thresholds, findings, reviews and limitations.
                    No durable storage.
                  </p>
                </article>
              </div>
              <div className="callout">
                <Info />
                <p>
                  For a SIH research claim, add labelled Indian station data,
                  independent event validation, multiple seasons and matched
                  false-alert comparisons. Remaining sensor life is not
                  predicted.
                </p>
              </div>
              <div className="sources">
                <a
                  href="https://sih.gov.in/sih2026PS#ViewProblemStatement26073"
                  target="_blank"
                  rel="noreferrer"
                >
                  SIH problem statement ↗
                </a>
                <a
                  href="https://madis.ncep.noaa.gov/madis_sfc_qc_notes.shtml"
                  target="_blank"
                  rel="noreferrer"
                >
                  NOAA quality-control reference ↗
                </a>
                <a
                  href="https://www.bgc-jena.mpg.de/wetter/weather_data.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  Public weather data ↗
                </a>
              </div>
            </section>
          </TabsContent>
        </Tabs>
        <footer>
          <span>
            <Activity size={15} />
            MausamGuard · Built for investigation
          </span>
          <span>All times UTC · Prototype v1.0</span>
        </footer>
      </div>
    </main>
  );
}
