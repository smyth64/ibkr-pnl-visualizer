/* global Papa, Chart */

const fileInput = document.getElementById('fileInput')
const loadSampleBtn = document.getElementById('loadSample')
const modeToggle = document.getElementById('modeToggle')
const rangeButtons = document.getElementById('rangeButtons')
const chartTitle = document.getElementById('chartTitle')
const statValue = document.getElementById('statValue')
const tradesTableBody = document.querySelector('#tradesTable tbody')

let rawRows = []
let chart

const MODE = {
  PNL: 'pnl',
  ACCOUNT: 'account'
}

let currentMode = MODE.PNL
let currentRange = '24h'

function parseCsvText(text) {
  const parsed = Papa.parse(text, { header: false, skipEmptyLines: true })
  return parsed.data
}

function loadCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(parseCsvText(e.target.result))
    reader.onerror = reject
    reader.readAsText(file)
  })
}

async function loadDefaultCsvIfPresent() {
  const candidates = [
    './Kontoauszüge Jan 2025 to Oct 2025.csv',
    './Kontoauszu\u0308ge Jan 2025 to Oct 2025.csv',
    './Kontoauszuege Jan 2025 to Oct 2025.csv',
    './data.csv',
    './statement.csv'
  ]
  for (const path of candidates) {
    try {
      const res = await fetch(encodeURI(path))
      if (res.ok) {
        const text = await res.text()
        return parseCsvText(text)
      }
    } catch (e) { }
  }
  return null
}

function findSectionIndices(rows, sectionPrefix) {
  const indices = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].startsWith(sectionPrefix)) indices.push(i)
  }
  return indices
}

function extractTransactions(rows) {
  // IBKR CSV section starting with 'Transaktionen'
  const sectionStarts = findSectionIndices(rows, 'Transaktionen')
  if (sectionStarts.length === 0) return []
  const start = sectionStarts[0]
  // grab until next header that is not Data/SubTotal/Total for this section
  const out = []
  for (let i = start + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r[0]) continue
    if (r[0] !== 'Transaktionen') break
    const discriminator = r[1]
    if (discriminator === 'Data') {
      out.push(r)
    } else if (discriminator === 'SubTotal' || discriminator === 'Total') {
      out.push(r)
    }
  }
  return out
}

function buildClosedTrades(transactionRows) {
  // Build trades where discriminator is Data and Code includes 'C' (closed)
  const trades = []
  for (const r of transactionRows) {
    if (r[1] !== 'Data') continue
    const code = r[13] || ''
    const isClose = code.includes('C')
    if (!isClose) continue

    const assetClass = r[2]
    const currency = r[3]
    const symbol = r[4]
    const dateTime = r[5]
    const qty = Number(String(r[6]).replaceAll(',', ''))
    const price = Number(r[7])
    const proceeds = Number(r[8])
    const fees = Number(r[9])
    const basis = Number(r[10])
    const realized = Number(r[11])

    trades.push({
      dateTime: parseIbTime(dateTime),
      symbol,
      assetClass,
      currency,
      qty,
      price,
      proceeds,
      fees,
      basis,
      realized
    })
  }
  // sort by time asc
  trades.sort((a, b) => a.dateTime - b.dateTime)
  return trades
}

function parseIbTime(val) {
  // IBKR example: "2025-08-18, 09:34:59"
  try {
    const [datePart, timePart] = String(val).split(',')
    const iso = `${datePart.trim()}T${timePart.trim()}`
    return new Date(iso)
  } catch (e) {
    return new Date()
  }
}

function rollingSeriesFromTrades(trades) {
  // cumulative realized pnl
  let total = 0
  const points = trades.map(t => {
    total += t.realized
    return { t: t.dateTime, v: total }
  })
  return points
}

function accountValueFromSections(rows) {
  // pull Endwert from 'Veränderung des NAV' and create a flat series at that level at generation time
  // also try to parse 'Nettovermögenswert,Data,Gesamt' current value to seed a single point
  const values = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r[0] === 'Veränderung des NAV' && r[1] === 'Data' && r[2] === 'Endwert') {
      const v = Number(r[3])
      values.push(v)
    }
    if (r[0] === 'Nettovermögenswert' && r[1] === 'Data' && r[2] === 'Gesamt') {
      const v = Number(r[6])
      values.push(v)
    }
  }
  const latest = values.length ? values[values.length - 1] : 0
  const now = new Date()
  // create a simple 30-day synthetic line trending to latest using realized pnl as rough steps
  return [{ t: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30), v: Math.max(0, latest * 0.95) }, { t: now, v: latest }]
}

function filterRange(points, rangeKey) {
  if (rangeKey === 'all') return points
  const now = new Date()
  let start
  if (rangeKey === '24h') start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  else if (rangeKey === '1w') start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  else if (rangeKey === '1m') start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  else start = new Date(0)
  return points.filter(p => p.t >= start)
}

function fmtCurrency(n) {
  const f = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
  return f.format(n)
}

function updateTable(trades) {
  const rows = trades.map(t => {
    const dir = t.qty < 0 ? 'Sell' : 'Buy'
    const dur = '—'
    const net = t.realized
    const pnlClass = net >= 0 ? 'pnl-pos' : 'pnl-neg'
    return `<tr>
      <td>${t.dateTime.toLocaleString()}</td>
      <td>${t.symbol}</td>
      <td>${dir}</td>
      <td>${dur}</td>
      <td class="${pnlClass}">${fmtCurrency(t.realized)}</td>
      <td>${fmtCurrency(t.fees || 0)}</td>
      <td class="${pnlClass}">${fmtCurrency(net)}</td>
      <td>1</td>
    </tr>`
  })
  tradesTableBody.innerHTML = rows.join('')
}

function renderChart(points) {
  const ctx = document.getElementById('mainChart')
  const labels = points.map(p => p.t)
  const data = points.map(p => p.v)
  const color = currentMode === MODE.PNL ? '#3be389' : '#37d4ff'
  const title = currentMode === MODE.PNL ? 'Realized PnL' : 'Account Value'
  chartTitle.textContent = title
  statValue.textContent = fmtCurrency(points.length ? points[points.length - 1].v : 0)

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        fill: true,
        borderColor: color,
        backgroundColor: ctx.getContext('2d').createLinearGradient(0, 0, 0, 200)
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { type: 'time', time: { unit: 'day' }, grid: { color: 'rgba(255,255,255,.08)' } },
        y: { grid: { color: 'rgba(255,255,255,.08)' } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      }
    }
  }

  // add gradient fill
  const ctx2d = ctx.getContext('2d')
  const gradient = ctx2d.createLinearGradient(0, 0, 0, 220)
  gradient.addColorStop(0, currentMode === MODE.PNL ? 'rgba(59,227,137,.35)' : 'rgba(55,212,255,.35)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  cfg.data.datasets[0].backgroundColor = gradient
  cfg.data.datasets[0].tension = 0.3
  cfg.data.datasets[0].borderWidth = 2
  cfg.data.datasets[0].pointRadius = 0

  if (chart) chart.destroy()
  chart = new Chart(ctx, cfg)
}

function update() {
  const transactions = extractTransactions(rawRows)
  const closedTrades = buildClosedTrades(transactions)
  updateTable(closedTrades)

  let series
  if (currentMode === MODE.PNL) {
    const pnlSeries = rollingSeriesFromTrades(closedTrades)
    series = filterRange(pnlSeries, currentRange)
  } else {
    const accSeries = accountValueFromSections(rawRows)
    series = filterRange(accSeries, currentRange)
  }

  renderChart(series)
}

fileInput.addEventListener('change', async e => {
  const file = e.target.files[0]
  if (!file) return
  rawRows = await loadCsv(file)
  update()
})

loadSampleBtn.addEventListener('click', async () => {
  const rows = await loadDefaultCsvIfPresent()
  if (rows) {
    rawRows = rows
    update()
  } else {
    alert('Keine CSV im Repo gefunden. Lade stattdessen eine Datei hoch.')
  }
})

modeToggle.addEventListener('change', () => {
  currentMode = modeToggle.checked ? MODE.ACCOUNT : MODE.PNL
  update()
})

rangeButtons.addEventListener('click', e => {
  const btn = e.target.closest('button')
  if (!btn) return
  currentRange = btn.dataset.range
  for (const b of rangeButtons.querySelectorAll('button')) b.classList.toggle('active', b === btn)
  update()
})

  // Attempt autoload on startup
  ; (async () => {
    const rows = await loadDefaultCsvIfPresent()
    if (rows) {
      rawRows = rows
      update()
    }
  })()


