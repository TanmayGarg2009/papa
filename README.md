# NSE Option Chain Viewer

A high-performance, real-time NSE Option Chain analytical web application modeled after professional trading tools with Set A / Set B baseline strike splitting, golden exact-match highlights, floating pinned headers & summary totals, and dynamic random auto-refresh.

## Features

- **Strict Core Metrics**:
  - **CALLS (CE)**: IV, OI Chg, Volume, LTP, OI, CALL OI%
  - **CENTER**: Strike Price
  - **PUTS (PE)**: PUT OI%, OI, LTP, Volume, OI Chg, IV
- **Set A & Set B Baseline Division**:
  - Automatically splits strikes into Set A (> Spot) and Set B (< Spot).
  - Center baseline divider bar displaying live Underlying Spot.
  - Automatically centers viewport on the spot price.
  - Configurable strike depth (default 20 strikes above & 20 below).
  - Exact match strike highlighted in **Golden color**.
- **Dynamic Calculation**:
  - `CALL OI%` & `PUT OI%` per strike.
  - Pinned bottom summary footer with dynamic sums of visible `OI` and `OI Change`.
- **Random 1–3 Minute Refresh Engine**:
  - Dynamically picks a random duration strictly between 1 and 3 minutes ($61\text{s} \le t \le 179\text{s}$) after each fetch.
  - Visual countdown timer + "Refresh Now" manual button.
- **NSE Proxy & Fallback Handshake**:
  - Handles NSE cookies, headers, and anti-scraping automatically.
  - Includes offline/fallback mode with visual notification alerts.

---

## Deployment on Render

1. Create a new **Web Service** on [Render](https://render.com).
2. Connect your GitHub repository: `papa`.
3. Set the following settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Click **Deploy Web Service**.

---

## Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start server:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000` in your browser.
4. On Windows, you can also double-click `start.bat`.
