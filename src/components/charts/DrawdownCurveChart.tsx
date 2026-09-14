"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function DrawdownCurveChart({ data }: { data: { t: number; drawdownPct: number }[] }) {
  const formatted = data.map((d) => ({ ...d, date: new Date(d.t).toLocaleDateString(), drawdown: -d.drawdownPct }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={formatted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="drawdownFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e5484d" stopOpacity={0} />
            <stop offset="100%" stopColor="#e5484d" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1c2531" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#7d8b9c" }} minTickGap={40} axisLine={{ stroke: "#1c2531" }} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "#7d8b9c" }} axisLine={false} tickLine={false} width={50} domain={["auto", 0]} />
        <Tooltip
          contentStyle={{ background: "#0f1520", border: "1px solid #1c2531", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#7d8b9c" }}
          formatter={(value: number) => [`${value.toFixed(2)}%`, "Drawdown"]}
        />
        <Area type="monotone" dataKey="drawdown" stroke="#e5484d" strokeWidth={1.5} fill="url(#drawdownFill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
