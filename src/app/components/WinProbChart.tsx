'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer
} from 'recharts'

interface DataPoint {
  game_seconds: number
  home_win_prob: number
  quarter: number
  score_diff: number
}

interface Props {
  data: DataPoint[]
  gameId: string
}

const QUARTER_LINES = [720, 1440, 2160]
const QUARTER_LABELS: Record<number, string> = { 0: 'Q1', 720: 'Q2', 1440: 'Q3', 2160: 'Q4' }

function formatTime(seconds: number): string {
  const q = Math.min(Math.floor(seconds / 720) + 1, 4)
  const secInQ = seconds % 720
  const remaining = 720 - secInQ
  const m = Math.floor(remaining / 60)
  const s = remaining % 60
  return `Q${q} ${m}:${String(s).padStart(2, '0')}`
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const prob = payload[0].value as number
    const diff = payload[0].payload.score_diff
    return (
      <div className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
        <div className="text-gray-300">{formatTime(label)}</div>
        <div className="text-white font-semibold">
          Home win prob: {(prob * 100).toFixed(1)}%
        </div>
        <div className="text-gray-400">
          Score diff: {diff > 0 ? '+' : ''}{diff}
        </div>
      </div>
    )
  }
  return null
}

export default function WinProbChart({ data }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-400">Away team advantage →</span>
        <span className="text-sm text-gray-400">← Home team advantage</span>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="probGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F97316" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#F97316" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="game_seconds"
            tickFormatter={(v) => `Q${Math.min(Math.floor(v / 720) + 1, 4)}`}
            ticks={[0, 720, 1440, 2160, 2880]}
            stroke="#4b5563"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
            stroke="#4b5563"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0.5} stroke="#6b7280" strokeDasharray="4 4" />
          {QUARTER_LINES.map((s) => (
            <ReferenceLine key={s} x={s} stroke="#374151" strokeDasharray="3 3" />
          ))}
          <Area
            type="monotone"
            dataKey="home_win_prob"
            stroke="#F97316"
            strokeWidth={2}
            fill="url(#probGradient)"
            dot={false}
            activeDot={{ r: 4, fill: '#F97316' }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-500 mt-2 text-center">
        Home team win probability — calibrated XGBoost model
      </p>
    </div>
  )
}
