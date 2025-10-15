import React, { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  LinearScale,
  TimeScale,
  PointElement,
  Filler,
  Tooltip,
  Legend
} from 'chart.js'
import 'chartjs-adapter-date-fns'
import { startOfHour, startOfDay, startOfWeek, startOfMonth, format as formatDateFns } from 'date-fns'

ChartJS.register(LineElement, LinearScale, TimeScale, PointElement, Filler, Tooltip, Legend)

const MODE = { PNL: 'pnl', ACCOUNT: 'account' }

function generateDemoRows(days = 90) {
  const header = ['DateTime','Symbol','Quantity','IBCommission','FifoPnlRealized','Buy/Sell']
  const rows = [header]
  const now = new Date()
  const symbols = ['AAPL','AMZN','NVDA','TSLA','NET','GCT','JD','COIN','BTC']
  for (let d = days; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 24 * 3600 * 1000)
    // 40% of days have trades
    if (Math.random() > 0.4) continue
    const sessions = 1 + Math.floor(Math.random() * 2) // 1-2 sessions per active day
    for (let s = 0; s < sessions; s++) {
      const fills = 1 + Math.floor(Math.random() * 3) // 1-3 fills per session
      const sym = symbols[Math.floor(Math.random() * symbols.length)]
      const baseMs = day.getTime() + (8 + Math.floor(Math.random() * 8)) * 3600 * 1000 // 8-16h
      let sessionPnl = (Math.random() - 0.3) * 1500 // bias positive
      for (let f = 0; f < fills; f++) {
        const t = new Date(baseMs + f * (3 + Math.floor(Math.random() * 5)) * 60 * 1000) // 3-8 min apart
        const y = t.getFullYear().toString().padStart(4,'0')
        const m = (t.getMonth()+1).toString().padStart(2,'0')
        const dd = t.getDate().toString().padStart(2,'0')
        const hh = t.getHours().toString().padStart(2,'0')
        const mm = t.getMinutes().toString().padStart(2,'0')
        const ss = t.getSeconds().toString().padStart(2,'0')
        const dt = `${y}-${m}-${dd}, ${hh}:${mm}:${ss}`
        // split session pnl across fills with small noise
        const part = sessionPnl / fills + (Math.random()-0.5) * 50
        const commission = Math.max(0, Math.round((Math.abs(part) * 0.002) * 100) / 100)
        const side = part >= 0 ? 'SELL' : 'BUY'
        const qty = side === 'SELL' ? -100 : 100
        rows.push([dt, sym, String(qty), String(commission), String(Math.round(part * 100)/100), side])
      }
    }
  }
  return rows
}

function useCsvAutoload() {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    const generated = generateDemoRows(90)
    setRows(generated)
  }, [])
  return rows
}

function findSectionIndices(rows, prefix) {
  const out = []
  for (let i = 0; i < rows.length; i++) if (rows[i][0]?.startsWith(prefix)) out.push(i)
  return out
}

function buildClosedTrades(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return []

  // Utility to find a column by trying multiple possible header names
  const idxOf = (header, names) => names.map(n => header.indexOf(n)).find(i => i > -1) ?? -1
  const toNum = v => {
    if (v === null || v === undefined || v === '') return 0
    return Number(String(v).replace(/[,€\s]/g, '')) || 0
  }

  // Try Flex Executions/Trade Confirmations header first
  const header = rows[0]
  const isHeader = Array.isArray(header) && header.some(h => typeof h === 'string' && /Symbol|Date.?Time|Quantity|Buy\/Sell|Proceeds/.test(h))
  const looksLikeFlex = isHeader
  if (looksLikeFlex) {
    const iDate = idxOf(header, ['DateTime', 'Date/Time'])
    const iSymbol = idxOf(header, ['Symbol'])
    const iQty = idxOf(header, ['Quantity', 'Qty'])
    const iFees = idxOf(header, ['IBCommission', 'IB Commission', 'Commission'])
    let iReal = idxOf(header, ['FifoPnlRealized', 'Realized P/L', 'Realized PnL', 'RealizedPNL'])
    const iProceeds = idxOf(header, ['Proceeds', 'Trade Money', 'Net Cash'])
    const iCostBasis = idxOf(header, ['Cost Basis', 'CostBasis'])
    const iSide = idxOf(header, ['Buy/Sell'])
    const trades = []
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      if (!r || !r.length) continue
      const t = parseIbTime(r[iDate])
      if (Number.isNaN(t.getTime())) continue
      const rawQty = toNum(r[iQty]) || 0
      const side = String(r[iSide] || '').toUpperCase()
      const qty = side === 'SELL' ? -Math.abs(rawQty) : Math.abs(rawQty)
      const fees = toNum(r[iFees])
      let realized = iReal > -1 ? toNum(r[iReal]) : 0
      if (iReal === -1) {
        const proceeds = toNum(r[iProceeds])
        const costBasis = toNum(r[iCostBasis])
        if (proceeds || costBasis || fees) realized = proceeds - fees - costBasis
      }
      trades.push({ t, symbol: r[iSymbol], qty, fees, realized, side })
    }
    trades.sort((a, b) => a.t - b.t)
    return trades
  }

  // Fallback: parse German Activity Statement 'Transaktionen' section
  const starts = findSectionIndices(rows, 'Transaktionen')
  if (starts.length === 0) return []
  const start = starts[0]
  const trades = []
  for (let i = start + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r[0]) continue
    if (r[0] !== 'Transaktionen') break
    if (r[1] !== 'Data') continue
    const code = r[13] || ''
    if (!code.includes('C')) continue
    trades.push({
      t: parseIbTime(r[5]),
      symbol: r[4],
      qty: Number(String(r[6]).replaceAll(',', '')),
      fees: Number(r[9] || 0),
      realized: Number(r[11] || 0),
      side: Number(String(r[6]).replaceAll(',', '')) < 0 ? 'SELL' : 'BUY'
    })
  }
  trades.sort((a, b) => a.t - b.t)
  return trades
}

function parseIbTime(v) {
  try {
    const [d, t] = String(v).split(',')
    return new Date(`${d.trim()}T${t.trim()}`)
  } catch {
    return new Date()
  }
}

function cumulativePnL(trades) {
  let sum = 0
  return trades.map(tr => ({ t: tr.t, v: (sum += tr.realized) }))
}

function formatCurrency(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '—'
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / (60 * 24))
  const h = Math.floor((m % (60 * 24)) / 60)
  const mm = m % 60
  if (d > 0) return `${d}d ${h}h ${mm}m`
  if (h > 0) return `${h}h ${mm}m`
  return `${mm}m`
}

function groupTradesIntoSessions(trades, gapMinutes = 15) {
  const gapMs = gapMinutes * 60 * 1000
  const bySymbol = new Map()
  for (const t of trades) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, [])
    bySymbol.get(t.symbol).push(t)
  }

  const sessions = []
  for (const [symbol, arr] of bySymbol.entries()) {
    arr.sort((a, b) => a.t - b.t)
    let current = null
    for (const trade of arr) {
      if (!current) {
        current = { symbol, trades: [trade], start: trade.t, end: trade.t, realized: Number(trade.realized) || 0, fees: Number(trade.fees) || 0, qtySum: Number(trade.qty) || 0 }
        continue
      }
      const withinGap = trade.t - current.end <= gapMs
      if (withinGap) {
        current.trades.push(trade)
        current.end = trade.t
        current.realized += Number(trade.realized) || 0
        current.fees += Number(trade.fees) || 0
        current.qtySum += Number(trade.qty) || 0
      } else {
        const duration = current.end - current.start
        // Determine direction from side field if available, else from qty sum
        const side = current.trades[0]?.side || (current.qtySum < 0 ? 'SELL' : 'BUY')
        const direction = side === 'BUY' ? 'Long' : 'Short'
        sessions.push({ symbol, start: current.start, end: current.end, duration, realized: current.realized, fees: current.fees, net: current.realized - current.fees, fills: current.trades.length, direction, trades: current.trades })
        current = { symbol, trades: [trade], start: trade.t, end: trade.t, realized: Number(trade.realized) || 0, fees: Number(trade.fees) || 0, qtySum: Number(trade.qty) || 0 }
      }
    }
    if (current) {
      const duration = current.end - current.start
      const side = current.trades[0]?.side || (current.qtySum < 0 ? 'SELL' : 'BUY')
      const direction = side === 'BUY' ? 'Long' : 'Short'
      sessions.push({ symbol, start: current.start, end: current.end, duration, realized: current.realized, fees: current.fees, net: current.realized - current.fees, fills: current.trades.length, direction, trades: current.trades })
    }
  }
  return sessions
}

function getGrainForSpan(range, spanMs) {
  if (range === '24h') return 'hour'
  const threeMonths = 90 * 24 * 3600 * 1000
  if (spanMs > threeMonths) return 'week'
  return 'day'
}

function startOfBucket(date, grain) {
  if (grain === 'hour') return startOfHour(date)
  if (grain === 'week') return startOfWeek(date, { weekStartsOn: 1 })
  if (grain === 'month') return startOfMonth(date)
  return startOfDay(date)
}

function resampleSeries(series, grain) {
  if (!series.length) return series
  const bucketToPoint = new Map()
  for (const p of series) {
    const bucket = +startOfBucket(p.t, grain)
    const prev = bucketToPoint.get(bucket)
    // keep last value in bucket (cumulative curve)
    if (!prev || prev.t < p.t) bucketToPoint.set(bucket, { t: new Date(bucket), v: p.v })
  }
  return Array.from(bucketToPoint.values()).sort((a, b) => a.t - b.t)
}

function accountSeries(rows) {
  const values = []
  for (const r of rows) {
    if (r[0] === 'Veränderung des NAV' && r[1] === 'Data' && r[2] === 'Endwert') values.push(Number(r[3]))
    if (r[0] === 'Nettovermögenswert' && r[1] === 'Data' && r[2] === 'Gesamt') values.push(Number(r[6]))
  }
  const latest = values.at(-1) || 0
  const now = new Date()
  return [
    { t: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30), v: Math.max(0, latest * 0.95) },
    { t: now, v: latest }
  ]
}

function useSeries(rows, mode, range) {
  return useMemo(() => {
    if (!rows) return []
    const base = mode === MODE.PNL ? cumulativePnL(buildClosedTrades(rows)) : accountSeries(rows)
    const now = new Date()
    const start = range === '24h'
      ? new Date(now.getTime() - 24 * 3600 * 1000)
      : range === '1w'
        ? new Date(now.getTime() - 7 * 24 * 3600 * 1000)
        : new Date(now.getTime() - 30 * 24 * 3600 * 1000)
    const inRange = range === 'all' ? base : base.filter(p => p.t >= start)
    const spanMs = inRange.length ? (inRange[inRange.length - 1].t - inRange[0].t) : 0
    const grain = getGrainForSpan(range, spanMs)
    return resampleSeries(inRange, grain)
  }, [rows, mode, range])
}

export default function App() {
  const autoRows = useCsvAutoload()
  const [uploadedRows, setUploadedRows] = useState(null)
  const rows = uploadedRows || autoRows
  const isDemo = !uploadedRows && !!autoRows
  const mode = MODE.PNL
  const [range, setRange] = useState('all')
  const [fileError, setFileError] = useState('')
  const inputRef = useRef()
  const series = useSeries(rows, mode, range)
  const [tab, setTab] = useState('aggregated') // aggregated | trades
  const [showHelp, setShowHelp] = useState(false)

  const chartData = useMemo(() => ({
    labels: series.map(p => p.t),
    datasets: [{
      data: series.map(p => p.v),
      borderColor: mode === MODE.PNL ? '#3be389' : '#37d4ff',
      backgroundColor: (ctx) => {
        const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 220)
        g.addColorStop(0, mode === MODE.PNL ? 'rgba(59,227,137,.35)' : 'rgba(55,212,255,.35)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        return g
      },
      fill: true,
      tension: .55,
      cubicInterpolationMode: 'monotone',
      pointRadius: 0,
      borderWidth: 2
    }]
  }), [series, mode])

  const options = useMemo(() => {
    const spanMs = series.length ? (series[series.length - 1].t - series[0].t) : 0
    const grain = getGrainForSpan(range, spanMs)
    return ({
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { type: 'time', time: { unit: grain }, grid: { color: 'rgba(255,255,255,.08)' } },
      y: { grid: { color: 'rgba(255,255,255,.08)' }, ticks: { callback: v => formatCurrency(v) } }
    },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: items => {
            const ts = items?.[0]?.parsed?.x
            if (!ts) return ''
            const d = new Date(ts)
            const pattern = grain === 'hour' ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy'
            return formatDateFns(d, pattern)
          },
          label: ctx => `${mode === MODE.PNL ? 'PnL' : 'Account'}: ${formatCurrency(ctx.parsed.y)}`
        }
      }
    }
  })
  }, [series, range, mode])

  const closedTrades = useMemo(() => (rows ? buildClosedTrades(rows) : []), [rows])
  const sessions = useMemo(() => groupTradesIntoSessions(closedTrades), [closedTrades])
  // Chronological (desc) list of aggregated sessions across symbols
  const groupedChrono = useMemo(() => sessions.sort((a, b) => (b.end ?? 0) - (a.end ?? 0)), [sessions])
  const [expanded, setExpanded] = useState({})
  const toggle = s => setExpanded(prev => ({ ...prev, [s]: !prev[s] }))

  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError('')
    file.text()
      .then(text => {
        const parsed = Papa.parse(text, { header: false, skipEmptyLines: true })
        if (Array.isArray(parsed.data)) setUploadedRows(parsed.data)
      })
      .catch(() => setFileError('Could not read file'))
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <header className="sticky top-0 z-10 mb-4">
        <div className="flex items-center justify-between bg-panel/80 backdrop-blur border border-border rounded-xl px-4 py-3">
          <h1 className="text-lg font-semibold">IBKR PnL Visualizer</h1>
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <input ref={inputRef} type="file" accept=".csv" onChange={onFile} className="hidden" />
            <button className="button-primary" onClick={() => inputRef.current?.click()}>Upload CSV</button>
            <button className="button" onClick={()=>setShowHelp(true)}>How do I get my CSV?</button>
          </div>
        </div>
      </header>

      <section className="card p-5 mb-4">
        {isDemo && (
          <div className="w-full flex justify-center">
            <div className="text-xs text-emerald-200 bg-emerald-900/40 border border-emerald-800 rounded-md px-3 py-1 mb-3">
              Demo data preview — upload your CSV to see your own performance
            </div>
          </div>
        )}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="text-emerald-400 text-xs tracking-wide uppercase">All PnL (combined)</div>
            <div className="text-3xl font-semibold mt-1 text-emerald-300">
              {formatCurrency(series.at(-1)?.v ?? 0)}
            </div>
          </div>
          <div className="flex gap-2">
            {['24h','1w','1m','all'].map(r => (
              <button key={r} className={"button "+(range===r?'active':'')} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>
        <div className="h-[360px]"><Line data={chartData} options={options} /></div>
      </section>

      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={()=>setShowHelp(false)} />
          <div className="relative card w-[92vw] max-w-lg p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base">How to export your CSV from IBKR</h3>
              <button className="button" onClick={()=>setShowHelp(false)}>Close</button>
            </div>
            <ol className="list-decimal pl-6 text-sm text-gray-300 mt-1 space-y-1">
              <li>Log in to the IBKR Client Portal</li>
              <li>Go to Reports → Flex Queries → create an Activity Flex Query</li>
              <li>Sections: Executions (or Closed Lots). Include: DateTime, Symbol, Asset Class, Currency, Quantity, Proceeds, Commission, Cost Basis, Realized P/L, Buy/Sell</li>
              <li>Output format: CSV</li>
              <li>Run the query, download the file, then click “Upload CSV”</li>
            </ol>
          </div>
        </div>
      )}

      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="tabs">
            <button className={`tab ${tab==='aggregated'?'active':''}`} onClick={()=>setTab('aggregated')}>Aggregated</button>
            <button className={`tab ${tab==='trades'?'active':''}`} onClick={()=>setTab('trades')}>Completed Trades</button>
          </div>
        </div>
        {isDemo && (
          <div className="mb-3 text-xs text-emerald-200 bg-emerald-900/30 border border-emerald-800 rounded-md px-3 py-2">
            Demo data loaded — click “Upload CSV” to visualize your own trades
          </div>
        )}
        <div className="overflow-auto">
          {tab==='aggregated' ? (
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th>End Time</th>
                <th>Asset</th>
                <th>Direction</th>
                <th>Duration</th>
                <th>PnL</th>
                <th>Fees</th>
                <th>Net PnL</th>
                <th>Fills</th>
              </tr>
            </thead>
            <tbody>
              {groupedChrono.map(row => {
                const pnlCls = row.net >= 0 ? 'pnl-pos' : 'pnl-neg'
                return (
                  <>
                    <tr key={row.symbol} className="cursor-pointer" onClick={() => toggle(row.symbol)}>
                      <td className="whitespace-nowrap">{row.end?.toLocaleString?.() || '—'}</td>
                      <td className="whitespace-nowrap">{row.symbol}</td>
                      <td>{row.direction}</td>
                      <td>{formatDuration(row.duration)}</td>
                      <td className={row.realized>=0?'pnl-pos':'pnl-neg'}>{formatCurrency(row.realized)}</td>
                      <td>{formatCurrency(row.fees)}</td>
                      <td className={pnlCls}>{formatCurrency(row.net)}</td>
                      <td>{row.fills}</td>
                    </tr>
                    {expanded[row.symbol] && (
                      <tr>
                        <td colSpan={8}>
                          <div className="p-2 bg-panel2 rounded-lg border border-border/60">
                            <table className="min-w-full text-xs">
                              <thead>
                                <tr>
                                  <th>Time</th>
                                  <th>Qty</th>
                                  <th>PnL</th>
                                  <th>Fees</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.trades.map((t, i) => (
                                  <tr key={i}>
                                    <td>{t.t.toLocaleString()}</td>
                                    <td>{t.qty}</td>
                                    <td className={t.realized>=0?'pnl-pos':'pnl-neg'}>{formatCurrency(t.realized)}</td>
                                    <td>{formatCurrency(t.fees||0)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
          ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th>End Time</th>
                <th>Asset</th>
                <th>Direction</th>
                <th>Duration</th>
                <th>PnL</th>
                <th>Fees</th>
                <th>Net PnL</th>
                <th>Fills</th>
              </tr>
            </thead>
            <tbody>
              {closedTrades.slice().sort((a,b)=>b.t-a.t).map((t,i)=>{
                const net = (t.realized||0) - (t.fees||0)
                return (
                  <tr key={i}>
                    <td>{t.t.toLocaleString()}</td>
                    <td>{t.symbol}</td>
                    <td>{t.qty<0?'Long':'Short'}</td>
                    <td>—</td>
                    <td className={t.realized>=0?'pnl-pos':'pnl-neg'}>{formatCurrency(t.realized)}</td>
                    <td>{formatCurrency(t.fees||0)}</td>
                    <td className={net>=0?'pnl-pos':'pnl-neg'}>{formatCurrency(net)}</td>
                    <td>1</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          )}
        </div>
      </section>

      {/* Removed duplicate bottom list; it's already covered by the tabs above */}

      {fileError && <p className="text-red mt-3">{fileError}</p>}
    </div>
  )
}


