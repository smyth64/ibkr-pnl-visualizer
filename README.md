IBKR Chart

Quick start

- Open `index.html` in a browser
- Click "CSV im Repo laden" to auto-load the included IBKR CSV
- Or upload your own exported IBKR CSV (Deutsch) via the file picker

Features

- Toggle between Realized PnL and Account Value
- Time ranges: 24h, 1w, 1m, All
- Table of closed trades parsed from the Transaktionen section

Notes

- ESLint enforces no semicolons per project style
- The Account Value series is a simple two-point line from historical to current value when the CSV lacks a full time series; you can evolve this later by providing daily NAV history


