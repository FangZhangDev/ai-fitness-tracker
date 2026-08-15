"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

export interface StrengthPoint {
  date: string;
  /** 估算 1RM */
  e1rm: number | null;
  /** 该次记录重量 */
  weight: number | null;
}

export default function StrengthChart({ data }: { data: StrengthPoint[] }) {
  const chartData = data.map((d) => ({
    date: d.date.slice(5),
    "1RM": d.e1rm,
    重量: d.weight,
  }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          {/* 网格/坐标轴的颜色交给 globals.css 里的 .recharts-* 规则, 跟随深浅色 */}
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.5} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              // 这三个必须显式给: recharts 默认白底, 深色模式下会在暗页面上炸出一块白
              background: "var(--chart-surface)",
              border: "1px solid var(--chart-border)",
              color: "var(--chart-text)",
            }}
            labelStyle={{ color: "var(--chart-text)" }}
            itemStyle={{ color: "var(--chart-text)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="1RM" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line type="monotone" dataKey="重量" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
