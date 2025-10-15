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
3) Sections: Closed Lots (recommended)
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

Run locally (with Vite)

This is a React + Vite app. Opening `index.html` from the file system won’t work (blank page) because the modules are served by the dev server. Use Vite:

1) Requirements: Node 18+ and npm
2) Install deps

```bash
npm ci
```

3) Start dev server

```bash
npm run dev
```

Open the printed URL (default `http://localhost:5174`).

4) Build static files (for hosting on any static host)

```bash
npm run build
npm run preview # optional local preview
```

Deploying

- Static hosting (recommended): Deploy the `dist/` folder to any static host (GitHub Pages, Cloudflare Pages, Netlify, Vercel static, NGINX). No backend required.
- Railway: either use a Static Site (publish dir `dist`) or a Node service with `npm run preview -- --host 0.0.0.0 --port $PORT`.

CSV export reminder

- Use Flex Query → Activity Flex Query → choose **Closed Lots** (recommended).
- Include: DateTime, Symbol, Currency, Quantity, Proceeds, Commission, Cost Basis, Realized P/L, Buy/Sell.
- Output: CSV → Run → download → Upload in the app.


