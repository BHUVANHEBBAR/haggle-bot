# Third-party notices

HaggleBot's server has **no npm dependencies**. The browser pages use these open-source libraries, copied
unmodified into `public/vendor/` (no CDN, no install step, works offline). Each folder contains the
library's licence text.

| Library | Version | Licence | Used for | Files |
|---|---|---|---|---|
| [AG Grid Community](https://www.ag-grid.com/) | 36.2.0 | MIT | Seller dashboard deals grid | `public/vendor/ag-grid/` |
| [AG Charts Community](https://www.ag-grid.com/charts/) | 14.2.0 | MIT | Price-over-time and dashboard charts | `public/vendor/ag-charts/` |
| [canvas-confetti](https://github.com/catdad/canvas-confetti) | 1.9.4 | ISC | "Deal closed" celebration | `public/vendor/confetti/` |

Source for each file: the official npm package of the same name and version
(`dist/ag-grid-community.min.js`, `dist/umd/ag-charts-community.min.js`, `dist/confetti.browser.js`).

AG Grid and AG Charts are products of AG Grid Ltd, a sponsor of the PayPal AI Hackathon.

## Frontend build (web/, bundled into public/app/)

The React app is built with the open-source packages below (exact versions in `web/package-lock.json`), compiled into `public/app/`. The server itself has no npm dependencies.

| Package | Licence |
|---|---|
| react, react-dom | MIT |
| react-router-dom | MIT |
| @tanstack/react-query | MIT |
| ag-grid-community / ag-grid-react, ag-charts-community / ag-charts-react | MIT |
| motion | MIT |
| sonner | MIT |
| lucide-react | ISC |
| clsx, tailwind-merge | MIT |
| canvas-confetti | ISC |
| @fontsource-variable/inter (Inter font) | SIL Open Font Licence 1.1 (font files bundled locally, no CDN) |
| Build tools: vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite, typescript | MIT / Apache-2.0 |
