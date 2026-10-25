# Nabil Fx Backtesting — upgraded free-first starter

## Included in this build
- Responsive dark trading dashboard and supplied profile photo.
- Market categories for forex, indices, crypto, stocks, commodities, and futures.
- Binance public historical OHLC data route for supported crypto spot symbols, with date filtering and candle pagination up to the configured candle count.
- Experimental Stooq daily CSV route for some non-crypto symbols. Coverage, ticker mapping, and browser CORS are not guaranteed.
- Previous-candle breakout model with explicit rule validation (not a general natural-language strategy interpreter).
- Win rate, profit factor, net P/L, max drawdown, trade count, average net R, expectancy, average win/loss, maximum losing streak, and equity curve.
- Configurable estimated total cost in R per trade. This is a simplified approximation and is not a substitute for instrument-specific commissions, spread, swaps/funding, or slippage modeling.
- Trade CSV export, saved-run CSV export, full JSON backup, browser-local run history, per-run delete, and clear-history control.
- Candle quality checks; no synthetic candles or invented backtest results are generated.

## Important limitations
- Only Binance crypto spot data is treated as a connected provider. The Stooq non-crypto route is experimental and can fail due to provider coverage or CORS.
- Strategy support is limited to this exact rule family: long when a candle closes above the previous candle high; short when it closes below the previous candle low; stop at the previous candle's opposite extreme; target at configured R multiple.
- A signal is evaluated at candle close; the simulation starts checking stop/target on following candles. If stop and target are both touched in one candle, stop is counted first.
- Costs are approximated as a fixed R deduction per trade. This is not a precise market microstructure simulation. Futures continuous contracts, contract rolls, dividends, funding, swaps, borrow costs, margin/liquidation, and broker-specific order rules are not modeled.
- Saved runs are local to this browser/device. Use the JSON backup and CSV exports to preserve them.
- This ZIP is not a public live website and has not been deployed. Hosting and domain setup require an account/authorization and must be completed on a hosting provider.

## Run locally
Keep `index.html` and `profile-photo.jpg` together. Open `index.html` in a modern browser. If a browser blocks API requests from a local file, use a static host or local web server. Binance public market data does not require an API key.

## Free hosting options (not deployed)
A static host such as GitHub Pages or Netlify can host the files at no cost within its free offering, subject to each provider's current terms. Upload/deployment still requires account access and explicit authorization. Do not publish API secrets in client-side code.


## Public sharing and profiles
- The bundled `hero-banner.png` and `profile-photo.jpg` are shared brand assets and appear for every visitor when the complete site folder is hosted.
- Founder attribution is fixed in the profile page: Nabil Al Mahmud. Visitor settings do not edit it.
- Visitors can create a local display profile, username, market preference, bio, photo, and notes. These are stored in their own browser localStorage.
- Important: this build does not yet include a server/database, sign-in, cross-device sync, or hosted public URL. Local profiles/history are not centrally private user accounts; deploying the static folder alone will not create real account isolation or cloud backups.


## Shared accounts and founder control preparation
- Added `supabase/schema.sql` as a database foundation with per-user row-level security and founder-role policies.
- Added `DEPLOYMENT_AND_OWNER_CONTROL.md` with a free-first deployment sequence and security checklist.
- These are setup assets only: authentication, live cloud database connection, founder console, and public hosting still need provider setup and testing.
