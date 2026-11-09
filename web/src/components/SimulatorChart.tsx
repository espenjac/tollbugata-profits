import { formatDate, formatMoney, formatNumber, formatPct } from "../core/format";
import type { SimMode } from "../core/simulator";
import type { SimulatorEquityPoint } from "../lib/api";

const WIDTH = 820;
const HEIGHT = 300;
const PAD = { left: 56, right: 18, top: 20, bottom: 34 };
const MODE_LABELS: Record<SimMode, string> = {
  swing: "Swing",
  etrade: "Etrade",
  trend: "Trend",
};
const MODE_COLORS: Record<SimMode, string> = {
  swing: "#38d6b0",
  etrade: "#5aa7ff",
  trend: "#bd8aff",
};
const BENCHMARK_COLOR = "#f0b429";

interface Series {
  mode: SimMode;
  values: Array<{ x: number; y: number; value: number }>;
  last: number;
}

interface BenchmarkPoint {
  index: number;
  value: number;
  raw: number;
}

function buildSeries(
  points: SimulatorEquityPoint[],
  days: string[],
  xFor: (index: number) => number,
  yFor: (value: number) => number,
): Series[] {
  const byMode = new Map<SimMode, Map<string, number>>();
  for (const point of points) {
    if (!byMode.has(point.mode)) {
      byMode.set(point.mode, new Map());
    }
    byMode.get(point.mode)?.set(point.day, point.equity);
  }

  const series: Series[] = [];
  for (const mode of ["swing", "etrade", "trend"] as const) {
    const values = byMode.get(mode);
    if (!values) {
      continue;
    }
    let carried: number | null = null;
    const line: Series["values"] = [];
    days.forEach((day, index) => {
      const value = values.get(day);
      if (value !== undefined) {
        carried = value;
      }
      if (carried !== null) {
        line.push({ x: xFor(index), y: yFor(carried), value: carried });
      }
    });
    if (line.length > 0) {
      series.push({
        mode,
        values: line,
        last: line[line.length - 1].value,
      });
    }
  }
  return series;
}

/**
 * Normalizes the OSEBX index level to the same starting cash as the paper
 * portfolios, so all three lines show percentage development from day one.
 */
function normalizeBenchmark(
  points: SimulatorEquityPoint[],
  days: string[],
  startingCash: number,
): BenchmarkPoint[] {
  const byDay = new Map<string, number>();
  for (const point of points) {
    if (
      point.benchmark !== null &&
      Number.isFinite(point.benchmark) &&
      point.benchmark > 0 &&
      !byDay.has(point.day)
    ) {
      byDay.set(point.day, point.benchmark);
    }
  }

  let base: number | null = null;
  let carried: number | null = null;
  const line: BenchmarkPoint[] = [];
  days.forEach((day, index) => {
    const raw = byDay.get(day);
    if (raw !== undefined) {
      if (base === null) {
        base = raw;
      }
      carried = raw;
    }
    if (base !== null && carried !== null) {
      line.push({
        index,
        raw: carried,
        value: (carried / base) * startingCash,
      });
    }
  });
  return line;
}

export function SimulatorChart({
  points,
  startingCash,
}: {
  points: SimulatorEquityPoint[];
  startingCash: number;
}) {
  if (points.length === 0) {
    return (
      <div className="sim-chart-empty">
        <strong>Ingen simulerte tick ennå.</strong>
        <p>
          Grafen fylles når den planlagte jobben har kjørt mens Oslo Børs er
          åpen. Alle porteføljene starter på {formatMoney(startingCash, 0)}.
        </p>
      </div>
    );
  }

  const days = [...new Set(points.map((point) => point.day))].sort();
  const benchmarkPoints = normalizeBenchmark(points, days, startingCash);
  const values = [
    startingCash,
    ...points.map((point) => point.equity),
    ...benchmarkPoints.map((point) => point.value),
  ];
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  const padding = Math.max(50, (maximum - minimum) * 0.08);
  minimum -= padding;
  maximum += padding;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const yFor = (value: number): number =>
    PAD.top + ((maximum - value) / (maximum - minimum)) * plotHeight;
  const xFor = (index: number): number => {
    const plotWidth = WIDTH - PAD.left - PAD.right;
    return days.length <= 1
      ? PAD.left + plotWidth / 2
      : PAD.left + (index / (days.length - 1)) * plotWidth;
  };
  const series = buildSeries(points, days, xFor, yFor);
  const benchmarkSeries = benchmarkPoints.map((point) => ({
    x: xFor(point.index),
    y: yFor(point.value),
    value: point.value,
  }));
  const benchmarkLast =
    benchmarkSeries.length > 0
      ? benchmarkSeries[benchmarkSeries.length - 1].value
      : null;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(
    (fraction) => maximum - (maximum - minimum) * fraction,
  );
  const labelIndexes =
    days.length <= 2
      ? days.map((_, index) => index)
      : [0, Math.floor((days.length - 1) / 2), days.length - 1];

  return (
    <div className="sim-chart">
      <div className="sim-chart-legend">
        {(["swing", "etrade", "trend"] as const).map((mode) => {
          const line = series.find((item) => item.mode === mode);
          return (
            <div key={mode} className={`sim-legend sim-legend-${mode}`}>
              <span className="sim-legend-dot" aria-hidden="true" />
              <span>{MODE_LABELS[mode]}</span>
              <strong>{line ? formatMoney(line.last, 0) : "–"}</strong>
              {line ? (
                <small
                  className={
                    line.last >= startingCash ? "tone-positive" : "tone-negative"
                  }
                >
                  {formatPct(line.last / startingCash - 1)}
                </small>
              ) : null}
            </div>
          );
        })}
        <div className="sim-legend sim-legend-benchmark">
          <span className="sim-legend-dot" aria-hidden="true" />
          <span>OSEBX</span>
          <strong>
            {benchmarkLast === null ? "–" : formatMoney(benchmarkLast, 0)}
          </strong>
          {benchmarkLast === null ? null : (
            <small
              className={
                benchmarkLast >= startingCash
                  ? "tone-positive"
                  : "tone-negative"
              }
            >
              {formatPct(benchmarkLast / startingCash - 1)}
            </small>
          )}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Utvikling for Swing, Etrade og Trend-simulatorene og OSEBX-indeksen"
      >
        {ticks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y}
                y2={y}
                className="sim-grid-line"
              />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end">
                {formatNumber(tick, 0)}
              </text>
            </g>
          );
        })}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={yFor(startingCash)}
          y2={yFor(startingCash)}
          className="sim-start-line"
        />
        {series.map((line) => (
          <g key={line.mode}>
            <path
              d={line.values
                .map(
                  (point, index) =>
                    `${index === 0 ? "M" : "L"}${point.x} ${point.y}`,
                )
                .join(" ")}
              fill="none"
              stroke={MODE_COLORS[line.mode]}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {line.values.map((point) => (
              <circle
                key={`${line.mode}-${point.x}`}
                cx={point.x}
                cy={point.y}
                r={2.6}
                fill={MODE_COLORS[line.mode]}
              />
            ))}
          </g>
        ))}
        {benchmarkSeries.length > 0 ? (
          <g>
            <path
              d={benchmarkSeries
                .map(
                  (point, index) =>
                    `${index === 0 ? "M" : "L"}${point.x} ${point.y}`,
                )
                .join(" ")}
              fill="none"
              stroke={BENCHMARK_COLOR}
              strokeWidth={2}
              strokeDasharray="7 4"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.92}
            />
            {benchmarkSeries.map((point) => (
              <circle
                key={`benchmark-${point.x}`}
                cx={point.x}
                cy={point.y}
                r={2.4}
                fill={BENCHMARK_COLOR}
              />
            ))}
          </g>
        ) : null}
        {labelIndexes.map((index) => (
          <text
            key={`day-${days[index]}`}
            x={xFor(index)}
            y={HEIGHT - 12}
            textAnchor={
              index === 0
                ? "start"
                : index === days.length - 1
                  ? "end"
                  : "middle"
            }
          >
            {formatDate(days[index])}
          </text>
        ))}
      </svg>
      <p className="sim-chart-footnote">
        Hver verdi er siste simulerte tick per handledag. Startkapital{" "}
        {formatMoney(startingCash, 0)} per modus, før kurtasje. OSEBX er
        normalisert til samme startverdi.
      </p>
    </div>
  );
}
