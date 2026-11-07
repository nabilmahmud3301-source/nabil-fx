// Historical exchange ticks and market depth gateway for Nabil FX.
// Databento schemas: trades (tick-by-tick), mbp-10 (L2), mbo (L3).
// Requires DATABENTO_API_KEY. This endpoint returns provider records without synthesizing missing depth.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
function decodeRecords(raw: string): any[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.data)) return parsed.data;
    if (Array.isArray(parsed?.records)) return parsed.records;
    return [parsed];
  } catch {
    return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const action = String(body?.action || "ticks").toLowerCase();
    const dataset = String(body?.dataset || "GLBX.MDP3").trim();
    const symbol = String(body?.symbol || "").trim().toUpperCase();
    const start = String(body?.start || "").trim();
    const end = String(body?.end || "").trim();
    const schema = String(body?.schema || (action === "orderbook" ? "mbp-10" : "trades")).toLowerCase();
    const limit = Math.max(1, Math.min(50000, Number(body?.limit) || 10000));
    if (!symbol || !start || !end) return json({ error: "symbol, start and end are required. Use an exchange-listed contract symbol and ISO-8601 UTC dates." }, 400);
    if (!["ticks", "orderbook"].includes(action)) return json({ error: "action must be ticks or orderbook." }, 400);
    if (action === "ticks" && !["trades", "tbbo"].includes(schema)) return json({ error: "Tick replay supports trades or tbbo schemas." }, 400);
    if (action === "orderbook" && !["mbp-10", "mbo"].includes(schema)) return json({ error: "Historical depth requires mbp-10 (L2) or mbo (L3)." }, 400);
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
      return json({ error: "Invalid date range. end must be later than start." }, 400);
    }
    const key = Deno.env.get("DATABENTO_API_KEY");
    if (!key) return json({
      error: "Historical exchange data is not configured. Add DATABENTO_API_KEY in Supabase Edge Function Secrets.",
      provider: "Databento",
      requiredSecret: "DATABENTO_API_KEY",
      dataAvailable: false,
    }, 503);
    const url = new URL("https://hist.databento.com/v0/timeseries.get_range");
    url.searchParams.set("dataset", dataset);
    url.searchParams.set("symbols", symbol);
    url.searchParams.set("schema", schema);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("stype_in", String(body?.stype_in || "raw_symbol"));
    url.searchParams.set("stype_out", "raw_symbol");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("encoding", "json");
    const auth = btoa(key + ":");
    const response = await fetch(url, {
      headers: { Authorization: "Basic " + auth, Accept: "application/json" },
      signal: AbortSignal.timeout(55000),
    });
    const raw = await response.text();
    if (!response.ok) {
      let detail = raw.slice(0, 1200);
      try { const p = JSON.parse(raw); detail = String(p?.detail || p?.message || p?.error || detail); } catch { /* retain provider text */ }
      return json({ error: "Databento historical request failed (" + response.status + "): " + detail, provider: "Databento", dataset, schema, dataAvailable: false }, response.status === 401 || response.status === 403 ? 502 : response.status);
    }
    let records: any[];
    try { records = decodeRecords(raw); } catch {
      return json({ error: "Databento returned a format this endpoint cannot safely decode. No data was used.", provider: "Databento", schema, dataAvailable: false }, 502);
    }
    if (!records.length) return json({ error: "No historical records were returned for this symbol, dataset and date range.", provider: "Databento", dataset, schema, dataAvailable: false }, 404);
    return json({
      provider: "Databento",
      dataset,
      symbol,
      schema,
      dataType: schema === "trades" ? "exchange_tick_trades" : schema === "tbbo" ? "top_of_book_quotes_and_trades" : schema === "mbp-10" ? "level_2_market_by_price" : "level_3_market_by_order",
      timestampPrecision: "provider_event_timestamp",
      records,
      recordCount: records.length,
      truncatedAtLimit: records.length >= limit,
      dataAvailable: true,
      disclaimer: "Exchange-specific data only. Futures records represent the named futures contract, not a broker CFD or OTC spot quote. No synthetic ticks or book levels are added.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected historical data error.";
    return json({ error: message, dataAvailable: false }, 502);
  }
});
