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

    const normalizedCryptoSymbol = symbol.replace(/[\\/:_-]/g,"");
    if (market === "crypto" && /^[A-Z0-9]{2,10}USD$/.test(normalizedCryptoSymbol) && !/(USDT|USDC|BUSD)$/.test(normalizedCryptoSymbol)) {
      if (!start || !end) return json({error:"Choose both From Date and To Date for an exact USD-quoted crypto replay."},400);
      const productId = normalizedCryptoSymbol.slice(0,-3) + "-USD";
      const parseUtcBoundary = (value:string,isEnd:boolean) => /^\\d{4}-\\d{2}-\\d{2}$/.test(value)
        ? Date.parse(value + (isEnd ? "T23:59:59.999Z" : "T00:00:00.000Z"))
        : Date.parse(value.replace(" ","T") + "Z");
      const startMs = parseUtcBoundary(start,false);
      const endMs = parseUtcBoundary(end,true);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return json({error:"Invalid Coinbase date range."},400);
      const targetMs: Record<string,number> = {"1m":60000,"5m":300000,"15m":900000,"30m":1800000,"1h":3600000,"2h":7200000,"4h":14400000,"1d":86400000};
      const requestedMs = targetMs[interval];
      if (!requestedMs) return json({error:"Unsupported Coinbase timeframe."},400);
      const baseSeconds = interval === "30m" ? 60 : (interval === "2h" || interval === "4h") ? 3600 : requestedMs/1000;
      const baseMs = baseSeconds*1000;
      const windows: Array<{start:number;end:number}> = [];
      let cursor = Math.floor(startMs/baseMs)*baseMs;
      while (cursor <= endMs && windows.length < 180) {
        const windowEnd = Math.min(endMs,cursor+baseMs*299-1);
        windows.push({start:cursor,end:windowEnd});
        cursor = windowEnd+1;
      }
      if (cursor <= endMs) return json({error:"This USD crypto date range is too large for the public Coinbase candle limit. Narrow the selected dates or use the exact Binance USDT market."},413);
      const baseCandles: any[] = [];
      for (let i=0;i<windows.length;i+=4) {
        const batch = await Promise.all(windows.slice(i,i+4).map(async (w) => {
          const url = new URL("https://api.exchange.coinbase.com/products/"+encodeURIComponent(productId)+"/candles");
          url.searchParams.set("granularity",String(baseSeconds));
          url.searchParams.set("start",new Date(w.start).toISOString());
          url.searchParams.set("end",new Date(w.end).toISOString());
          const response = await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(15000)});
          const payload = await response.json().catch(()=>null);
          if (!response.ok) {
            const detail = payload && !Array.isArray(payload) ? String(payload.message||payload.error||"") : "";
            throw new Error("Coinbase "+productId+" returned HTTP "+response.status+(detail?": "+detail:"")+". Check that this exact USD pair is listed.");
          }
          if (!Array.isArray(payload)) throw new Error("Coinbase returned an invalid candle response for "+productId+".");
          return payload;
        }));
        for (const rows of batch) for (const row of rows) {
          if (!Array.isArray(row) || row.length < 6) continue;
          const t=Number(row[0])*1000;
          const candle={t:Math.floor(t/1000),o:+row[3],h:+row[2],l:+row[1],c:+row[4],v:+(row[5]||0)};
          if (Number.isFinite(t) && t>=startMs && t<=endMs && [candle.o,candle.h,candle.l,candle.c].every(Number.isFinite)) baseCandles.push(candle);
        }
      }
      let candles=[...new Map(baseCandles.map((bar:any)=>[bar.t,bar])).values()].sort((a:any,b:any)=>a.t-b.t);
      if (requestedMs>baseMs) {
        const buckets=new Map<number,any>();
        for (const bar of candles) {
          const bucket=Math.floor((bar.t*1000)/requestedMs)*requestedMs;
          const current=buckets.get(bucket);
          if (!current) buckets.set(bucket,{t:Math.floor(bucket/1000),o:bar.o,h:bar.h,l:bar.l,c:bar.c,v:bar.v});
          else {current.h=Math.max(current.h,bar.h);current.l=Math.min(current.l,bar.l);current.c=bar.c;current.v+=bar.v;}
        }
        candles=[...buckets.values()].sort((a:any,b:any)=>a.t-b.t);
      }
      if (candles.length<10) return json({error:"Fewer than 10 Coinbase candles were returned for "+productId+" in the selected period. The exact USD pair may not be listed or may not have traded then."},404);
      if (candles.length>=50000) return json({error:"The selected Coinbase period reached the 50,000-candle safety limit. Narrow the date range."},413);
      return json({candles,provider:"Coinbase Exchange Spot ("+productId+")",timezone:"UTC",symbol:productId,interval,market:"crypto",dataType:"exchange_ohlc"});
    }

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
      if (rows.length >= limit) throw new Error("The futures provider reached the requested candle limit. Narrow the selected date range; no partial backtest was run.");
      const candles = rows.map((x:any)=>({t:Math.floor(Number(x.window_start)/1e6),o:+x.open,h:+x.high,l:+x.low,c:+x.close,v:+(x.volume||0)}))
        .filter((x:any)=>Number.isFinite(x.t)&&[x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a:any,b:any)=>a.t-b.t);
      if (candles.length < 10) throw new Error("Fewer than 10 futures candles returned. Check the expiry contract and selected date range.");
      return json({candles,provider:"Massive Futures",timezone:"UTC",symbol,interval});
    }


    if (market === "futures") return json({error:"A dated exchange-listed futures contract is required. Continuous futures aliases and root symbols are not silently converted to another instrument."},400);

    const key = Deno.env.get("TWELVEDATA_API_KEY");
    if (!key) return json({error:"Market data provider is not configured. Add TWELVEDATA_API_KEY in Supabase Edge Function Secrets. Crypto can still use the direct Binance feed."},503);
    let tdSymbol = symbol;
    if (market === "forex" && /^[A-Z]{6}$/.test(symbol)) tdSymbol = symbol.slice(0,3)+"/"+symbol.slice(3);
    if (market === "commodities" && /^(XAU|XAG|XPT|XPD)USD$/.test(symbol)) tdSymbol = symbol.slice(0,3)+"/USD";
    const tdInterval: Record<string,string> = {"1m":"1min","3m":"1min","5m":"5min","15m":"15min","30m":"30min","1h":"1h","2h":"2h","4h":"4h","1d":"1day"};
    const requestedOutputSize = Math.min(interval==="3m" ? limit*3 : limit, 5000);
    const metaHolder: any = {};
    const fetchChunk = async (chunkStart: string, chunkEnd: string, depth = 0): Promise<any[]> => {
      const url = new URL("https://api.twelvedata.com/time_series");
      url.searchParams.set("symbol",tdSymbol);
      url.searchParams.set("interval",tdInterval[interval] || interval);
      url.searchParams.set("outputsize",String(5000));
      url.searchParams.set("order","ASC");
      url.searchParams.set("format","JSON");
      // Request the complete provider precision and a single consistent UTC
      // timeline for intraday candles. Daily bars remain exchange-session based.
      url.searchParams.set("dp","11");
      url.searchParams.set("timezone",tf.timespan==="day"?"Exchange":"UTC");
      url.searchParams.set("apikey",key);
      if (chunkStart) url.searchParams.set("start_date",chunkStart);
      if (chunkEnd) url.searchParams.set("end_date",chunkEnd);
      const response = await fetch(url, {signal:AbortSignal.timeout(25000)});
      const payload = await response.json().catch(()=>({}));
      if (!response.ok || payload?.status === "error" || !Array.isArray(payload?.values)) {
        const message = payload?.message || payload?.code || "Twelve Data returned HTTP " + response.status + ".";
        throw new Error(String(message) + " Check symbol spelling, plan access and interval availability.");
      }
      if (!metaHolder.meta && payload?.meta) metaHolder.meta = payload.meta;
      // Twelve Data caps a single response at 5,000 records. Split saturated
      // date windows recursively, so every candle in the user's chosen range
      // is fetched rather than silently accepting a truncated response.
      if (payload.values.length >= 5000) {
        const a = Date.parse(chunkStart);
        const b = Date.parse(chunkEnd);
        if (!Number.isFinite(a) || !Number.isFinite(b) || b-a < 2000 || depth >= 16) {
          throw new Error("Twelve Data's 5,000-record cap could not be safely paginated for this date range. No partial backtest was run.");
        }
        const mid = Math.floor((a+b)/2);
        const leftEnd = new Date(mid).toISOString().replace("T"," ").replace(/\.\d{3}Z$/,"");
        const rightStart = leftEnd;
        const left = await fetchChunk(chunkStart,leftEnd,depth+1);
        const right = await fetchChunk(rightStart,chunkEnd,depth+1);
        return left.concat(right);
      }
      return payload.values;
    };
    const values = await fetchChunk(start,end);
    const meta = metaHolder.meta || {};
    const type = String(meta?.type || "").toLowerCase();
    const fxOrCrypto = market === "forex" || market === "crypto" || type.includes("forex") || type.includes("currency") || type.includes("crypto");
    const timezone = tf.timespan==="day" ? String(meta?.exchange_timezone || "UTC") : "UTC";
    let candles = values.map((x:any)=>({
      t:parseTwelveDate(String(x.datetime),timezone,fxOrCrypto || tf.timespan!=="day"),
      o:+x.open,h:+x.high,l:+x.low,c:+x.close,v:+(x.volume||0)
    })).filter((x:any)=>Number.isFinite(x.t)&&[x.o,x.h,x.l,x.c].every(Number.isFinite))
      .sort((a:any,b:any)=>a.t-b.t);
    // Adjacent split windows can share their exact boundary candle; keep one record per timestamp.
    candles = [...new Map(candles.map((bar:any)=>[bar.t,bar])).values()].sort((a:any,b:any)=>a.t-b.t);
    if (interval === "3m") {
      const buckets = new Map<number,any>();
      for (const bar of candles) {
        const bucket = Math.floor(bar.t/180000)*180000;
        const current = buckets.get(bucket);
        if (!current) buckets.set(bucket,{t:bucket,o:bar.o,h:bar.h,l:bar.l,c:bar.c,v:bar.v,count:1});
        else {current.h=Math.max(current.h,bar.h);current.l=Math.min(current.l,bar.l);current.c=bar.c;current.v+=bar.v;current.count++;}
      }
      candles=[...buckets.values()].filter(x=>x.count===3).map(({t,o,h,l,c,v})=>({t,o,h,l,c,v}));
    }
    if (candles.length < 10) throw new Error("Fewer than 10 complete historical candles returned. The symbol/timeframe may not be available on your provider plan.");
    return json({candles:candles.slice(-limit),provider:interval==="3m"?"Twelve Data 1m → 3m aggregation":"Twelve Data",timezone,symbol:tdSymbol,interval,market,dataType:"provider_ohlc",meta});
  } catch (error) {
    console.error("market-data error:",error);
    return json({error:error instanceof Error?error.message:"Unexpected market data error."},502);
  }
});