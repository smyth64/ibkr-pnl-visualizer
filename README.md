IBKR PnL Visualizer

Quick start

- Open `index.html` or deploy with Vite (npm run dev/build)
- On first load, demo data appears so you can try it instantly
- Click "Upload CSV" to visualize your own IBKR Flex CSV

Live demo

- Deployed on Railway: [ibkr-visualizer.up.railway.app](https://ibkr-visualizer.up.railway.app/)

Features

- Smooth cumulative Realized PnL chart with hover tooltips
- Time ranges: 24h, 1w, 1m, all (auto weekly bucketing for long spans)
- Aggregated "trade sessions" view (groups fills within ~15 min)
- Completed trades table (chronological)
- Client‑side only: your CSV stays in the browser

Export instructions (Flex Query)

Important: Use "Closed Lots" (or include the Realized P/L fields). This guarantees correct realized PnL.

1) Log in to IBKR Client Portal
2) Reports → Flex Queries → Activity Flex Query
3) Sections: Closed Lots (recommended) or Executions
4) Include columns:
   - Date/Time (DateTime)
   - Symbol
   - Asset Class / Currency
   - Quantity
   - Proceeds
   - Commission (IB Commission)
   - Cost Basis
   - Realized P/L (or FifoPnlRealized)
   - Buy/Sell
5) Output: CSV
6) Run → download → click "Upload CSV" in the app

Notes

- ESLint enforces no semicolons per project style
- Demo data is generated on-the-fly for a pleasant first impression
- Privacy: All processing happens locally in your browser. Files are never uploaded to a server.


