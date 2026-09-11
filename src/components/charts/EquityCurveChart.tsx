"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function EquityCurveChart({ data }: { data: { t: number; equity: number }[] }) {
  const formatted = data.map((d) => ({ ...d, date: new Date(d.t).toLocaleDateString() }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={formatted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3ddc97" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#3ddc97" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1c2531" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#7d8b9c" }} minTickGap={40} axisLine={{ stroke: "#1c2531" }} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "#7d8b9c" }} axisLine={false} tickLine={false} width={50} domain={["auto", "auto"]} />
        <Tooltip
          contentStyle={{ background: "#0f1520", border: "1px solid #1c2531", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#7d8b9c" }}
          formatter={(value: number) => [value.toFixed(2), "Equity"]}
        />
        <Area type="monotone" dataKey="equity" stroke="#3ddc97" strokeWidth={1.5} fill="url(#equityFill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
