"use client";

import { Bar, ComposedChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * MVP Bloque 4 — the first real candlestick/price chart in this app.
 * Recharts (2.13.3, the only charting library this repo uses — see
 * EquityCurveChart.tsx/DrawdownCurveChart.tsx/Sparkline.tsx) has no
 * built-in candlestick chart type, so this renders one via a `Bar` whose
 * `dataKey` is a `[low, high]` range (recharts' documented "range bar"
 * support: an array dataKey value makes the bar span [min, max] instead
 * of [0, value]) combined with a custom `shape` that draws the
 * high/low wick and the open/close body from the SAME range's pixel
 * geometry — never a second, independent y-scale computation that could
 * drift from what the axis actually shows.
 *
 * Never fabricates a candle: `bars` must come from an already-fetched
 * `OHLCVBar[]` (e.g. `getSymbolAnalysis().bars`, itself
 * `getMarketDataProvider().getOHLCV(...)` — the same real data pipeline
 * every other page already uses). An empty array renders an explicit
 * "no data" message, never a fabricated placeholder chart.
 */
export interface CandlestickBar {
  timestamp: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
}

const UP_COLOR = "#3ddc97"; // same accent green EquityCurveChart already uses
const DOWN_COLOR = "#f87171"; // matches the app's existing "danger" tone

interface CandleShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: CandlestickBar;
}

function CandleShape(props: CandleShapeProps) {
  const { x, y, width, height, payload } = props;
  if (x === undefined || y === undefined || width === undefined || height === undefined || !payload) return <g />;
  const { open, close, high, low } = payload;
  if (high === low || !Number.isFinite(high) || !Number.isFinite(low)) return <g />; // degenerate range — nothing real to draw

  const isUp = close >= open;
  const color = isUp ? UP_COLOR : DOWN_COLOR;
  const priceToY = (price: number) => y + ((high - price) / (high - low)) * height;
  const bodyTop = priceToY(Math.max(open, close));
  const bodyBottom = priceToY(Math.min(open, close));
  const bodyHeight = Math.max(1, bodyBottom - bodyTop);
  const bodyWidth = Math.max(1, width * 0.7);
  const bodyX = x + (width - bodyWidth) / 2;
  const wickX = x + width / 2;

  return (
    <g>
      <line x1={wickX} y1={y} x2={wickX} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={bodyX} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} />
    </g>
  );
}

interface ChartDatum extends CandlestickBar {
  label: string;
  range: [number, number];
}

export function CandlestickChart({ bars, height = 320 }: { bars: CandlestickBar[]; height?: number }) {
  if (bars.length === 0) {
    return <div className="flex h-[260px] items-center justify-center text-xs text-muted">Sin datos de mercado disponibles para este símbolo/timeframe.</div>;
  }

  const data: ChartDatum[] = bars.map((b) => ({
    ...b,
    label: new Date(b.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    range: [b.low, b.high],
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#1c2531" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#7d8b9c" }} minTickGap={60} axisLine={{ stroke: "#1c2531" }} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "#7d8b9c" }} axisLine={false} tickLine={false} width={60} domain={["auto", "auto"]} />
        <Tooltip
          contentStyle={{ background: "#0f1520", border: "1px solid #1c2531", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#7d8b9c" }}
          formatter={(_value, _name, item) => {
            const payload = (item as { payload?: ChartDatum })?.payload;
            if (!payload) return ["—", "OHLC"];
            return [`O ${payload.open} H ${payload.high} L ${payload.low} C ${payload.close}`, "OHLC"];
          }}
        />
        <Bar dataKey="range" shape={CandleShape} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
