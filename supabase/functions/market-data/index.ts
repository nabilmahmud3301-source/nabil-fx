// Unified historical candle gateway for Nabil FX.
// Secrets: TWELVEDATA_API_KEY for FX/stocks/indices/commodities; MASSIVE_API_KEY for futures.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
function intervalParts(value: string) {
  const m = /^(1|3|5|15|30|60|120|240)m?$/.exec(value);
  if (m) return { multiplier: Number(m[1]), timespan: "minute" };
  if (value === "1h") return { multiplier: 1, timespan: "hour" };
  if (value === "2h") return { multiplier: 2, timespan: "hour" };
  if (value === "4h") return { multiplier: 4, timespan: "hour" };
  if (value === "1d") return { multiplier: 1, timespan: "day" };
  throw new Error("Unsupported timeframe. Choose 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h or 1d.");
}
function localDateTimeToUtc(value: string, timeZone: string) {
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!parts) return Date.parse(value + "Z");
  const target = Date.UTC(+parts[1], +parts[2]-1, +parts[3], +parts[4], +parts[5], +parts[6]);
  let guess = target;
  for (let i=0;i<3;i++) {
    const d = new Date(guess);
    const f = new Intl.DateTimeFormat("en-CA", {timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
    const p: any = {};
    for (const x of f.formatToParts(d)) if (x.type !== "literal") p[x.type] = x.value;
    const represented = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    guess += target - represented;
  }
  return guess;
}
function parseTwelveDate(value: string, timezone: string, isFxOrCrypto: boolean) {
  if (isFxOrCrypto) return Date.parse(value.replace(" ", "T") + "Z");
  return localDateTimeToUtc(value, timezone || "America/New_York");
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  if (req.method !== "POST") return json({error:"Method not allowed"},405);
  try {
    const body = await req.json();
    const market = String(body?.market || "").toLowerCase();
    const symbol = String(body?.symbol || "").trim().toUpperCase();
    const interval = String(body?.interval || "5m");
    const limit = Math.max(50, Math.min(50000, Number(body?.limit) || 5000));
    const start = body?.start ? String(body.start) : "";
    const end = body?.end ? String(body.end) : "";
    if (!symbol) return json({error:"Enter a market symbol."},400);
    const tf = intervalParts(interval);

    if (market === "futures") {
      const key = Deno.env.get("MASSIVE_API_KEY");
      if (!key) return json({error:"Futures data provider is not configured. Add MASSIVE_API_KEY in Supabase Edge Function Secrets. Use an actual expiry contract symbol (for example ESU6), not a continuous chart alias."},503);
      const url = new URL("https://api.massive.com/futures/v1/aggs/" + encodeURIComponent(symbol));
      url.searchParams.set("resolution", tf.multiplier + (tf.timespan === "minute" ? "min" : tf.timespan === "hour" ? "hour" : "session"));
      url.searchParams.set("limit",String(limit));
      url.searchParams.set("apiKey",key);
      if (start) url.searchParams.set("window_start.gte",start);
      if (end) url.searchParams.set("window_start.lte",end);
      const response = await fetch(url);
      const payload = await response.json().catch(()=>({}));
      if (!response.ok || payload?.status === "ERROR") {
        throw new Error(payload?.error || payload?.message || "Futures provider returned HTTP " + response.status + ". Check contract symbol, plan access and date range.");
      }
      const rows = Array.isArray(payload?.results) ? payload.results : [];
      const candles = rows.map((x:any)=>({t:Math.floor(Number(x.window_start)/1e6),o:+x.open,h:+x.high,l:+x.low,c:+x.close,v:+(x.volume||0)}))
        .filter((x:any)=>Number.isFinite(x.t)&&[x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a:any,b:any)=>a.t-b.t);
      if (candles.length < 10) throw new Error("Fewer than 10 futures candles returned. Check the expiry contract and selected date range.");
      return json({candles,provider:"Massive Futures",timezone:"UTC",symbol,interval});
    }

    if (interval === "3m") throw new Error("Twelve Data does not provide 3-minute candles. Use 1m, 5m, 15m, 30m, 1h, 2h, 4h or 1d for this market.");
    const key = Deno.env.get("TWELVEDATA_API_KEY");
    if (!key) return json({error:"Market data provider is not configured. Add TWELVEDATA_API_KEY in Supabase Edge Function Secrets. Crypto can still use the direct Binance feed."},503);
    let tdSymbol = symbol;
    if (market === "forex" && /^[A-Z]{6}$/.test(symbol)) tdSymbol = symbol.slice(0,3)+"/"+symbol.slice(3);
    if (market === "commodities" && /^(XAU|XAG|XPT|XPD)USD$/.test(symbol)) tdSymbol = symbol.slice(0,3)+"/USD";
    const tdInterval: Record<string,string> = {"1m":"1min","3m":"3min","5m":"5min","15m":"15min","30m":"30min","1h":"1h","2h":"2h","4h":"4h","1d":"1day"};
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol",tdSymbol);
    url.searchParams.set("interval",tdInterval[interval] || interval);
    url.searchParams.set("outputsize",String(Math.min(limit,5000)));
    url.searchParams.set("order","ASC");
    url.searchParams.set("format","JSON");
    url.searchParams.set("apikey",key);
    if (start) url.searchParams.set("start_date",start);
    if (end) url.searchParams.set("end_date",end);
    const response = await fetch(url);
    const payload = await response.json().catch(()=>({}));
    if (!response.ok || payload?.status === "error" || !Array.isArray(payload?.values)) {
      const message = payload?.message || payload?.code || "Twelve Data returned HTTP " + response.status + ".";
      throw new Error(String(message) + " Check symbol spelling, plan access and interval availability.");
    }
    const meta = payload?.meta || {};
    const type = String(meta?.type || "").toLowerCase();
    const fxOrCrypto = market === "forex" || market === "crypto" || type.includes("forex") || type.includes("currency") || type.includes("crypto");
    const timezone = String(meta?.exchange_timezone || "UTC");
    const candles = payload.values.map((x:any)=>({
      t:parseTwelveDate(String(x.datetime),timezone,fxOrCrypto),
      o:+x.open,h:+x.high,l:+x.low,c:+x.close,v:+(x.volume||0)
    })).filter((x:any)=>Number.isFinite(x.t)&&[x.o,x.h,x.l,x.c].every(Number.isFinite))
      .sort((a:any,b:any)=>a.t-b.t);
    if (candles.length < 10) throw new Error("Fewer than 10 historical candles returned. The symbol/timeframe may not be available on your provider plan.");
    return json({candles,provider:"Twelve Data",timezone,symbol:tdSymbol,interval,meta});
  } catch (error) {
    console.error("market-data error:",error);
    return json({error:error instanceof Error?error.message:"Unexpected market data error."},502);
  }
});