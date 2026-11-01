# Historical tick and order-book data

Nabil FX does not label candle-derived events or Binance aggregated trades as raw exchange ticks or full depth.

## Databento (exchange-listed futures and venues)

Deploy the Supabase Edge Function `historical-market-data` and add the secret:

- `DATABENTO_API_KEY` — API key from Databento.

POST to `/functions/v1/historical-market-data` with a Supabase-authenticated request.

Tick-by-tick exchange trades:

```json
{
  "action": "ticks",
  "dataset": "GLBX.MDP3",
  "symbol": "ESM6",
  "schema": "trades",
  "start": "2026-10-01T13:30:00Z",
  "end": "2026-10-01T14:00:00Z",
  "limit": 10000
}
```

L2 market-by-price depth (top ten price levels):

```json
{
  "action": "orderbook",
  "dataset": "GLBX.MDP3",
  "symbol": "ESM6",
  "schema": "mbp-10",
  "start": "2026-10-01T13:30:00Z",
  "end": "2026-10-01T13:31:00Z",
  "limit": 10000
}
```

Use `mbo` instead of `mbp-10` only when the dataset entitlement includes full order-by-order (L3) messages. Dataset, contract symbol, schema, historical entitlement and exchange licensing must match. Historical requests may incur provider charges.

The endpoint returns provider records unchanged; it does not reconstruct or invent missing book levels. Large date ranges should be split into small windows and fetched with a bounded record limit.

## Forex / Gold / CFD distinction

- OTC spot FX has no single consolidated exchange tape or universal Level-2 book. A broker-specific quote stream is not a global FX order book.
- Dukascopy historical tick files are a possible bid/ask source for supported instruments, but access is through its requester-pays historical-data bucket and requires AWS credentials/requester billing plus a validated LZMA decoder pipeline. This repository does not yet ingest those files.
- Gold and index futures can use the appropriate exchange dataset and contract (for example, COMEX gold or CME equity-index futures) through Databento when entitled. These are futures, not XAUUSD or broker CFD ticks.
- A futures proxy must be displayed with its exact contract and venue, never relabeled as spot XAUUSD, US30, NAS100 or a CFD.
- If the provider key, dataset entitlement, instrument, date range or raw schema is unavailable, backtesting must stop with a clear unavailable-data message. Never fall back silently to candles or simulated depth.
