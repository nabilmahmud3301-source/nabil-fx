// Nabil FX Strategy AI — resilient Gemini Interactions API backend
// GEMINI_API_KEY must remain in Supabase Edge Function Secrets.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function extractText(interaction: any): string {
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : [];
  return steps
    .filter((step: any) => step?.type === "model_output")
    .flatMap((step: any) => Array.isArray(step.content) ? step.content : [])
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

function parseModelJson(raw: string): any {
  // Models sometimes wrap otherwise-valid JSON in Markdown fences or add a short preface.
  let cleaned = raw.trim()
    .replace(/^\uFEFF/, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("The AI response did not contain a JSON object.");
  cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("AI backend is not configured: GEMINI_API_KEY secret is missing.");

    const body = await req.json();
    const strategy = String(body?.strategy || "").trim().slice(0, 12000);
    const market = String(body?.market || "unknown").slice(0,40);
    const symbol = String(body?.symbol || "unknown").slice(0,40);
    const interval = String(body?.interval || "unknown").slice(0,12);
    if (strategy.length < 8) {
      return new Response(JSON.stringify({ error: "Please describe your entry, stop-loss and take-profit rules in more detail." }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const systemInstruction = `You are a professional, multilingual, market-agnostic strategy compiler for Nabil FX. Current test context: market=${market}, symbol=${symbol}, candle timeframe=${interval}. The user may specify a location, exchange, named session, or timezone in ANY language. Resolve named places to valid IANA timezone IDs (examples: Europe/London, America/New_York, Asia/Tokyo, Asia/Dhaka); never assume the browser timezone or Bangladesh timezone when another location is named. If a place/timezone is ambiguous, return supported=false and ask for clarification. Convert the user's rules into a deterministic executable specification. Support broad reusable primitives and compose them; do not restrict strategies to a small list of named templates. The user may write in ANY human language or mix languages, transliteration, abbreviations, trading slang, or imperfect grammar. Detect language and preserve meaning.

You are the multilingual natural-language strategy compiler for Nabil FX Backtesting. The user may write in ANY human language or mix multiple languages, use transliteration, abbreviations, trading slang, or imperfect grammar. Detect the input language automatically; understand it directly, internally normalize/translate it as needed, and compile the intended trading rules into the deterministic schema below. Do not require the user to write English. Keep normalizedRules and explanation in the same language as the user's input whenever practical (otherwise use clear English). Convert the user's strategy into a deterministic executable rule specification. Never invent conditions that the user did not state. Use best-effort compilation for ordinary strategy descriptions in any language. If stop-loss, take-profit, or entry timing is omitted, apply clearly disclosed defaults: signal-candle stop, 2R target, and next-candle-open entry. For aggregated-trade event replay only, default the stop to previous_candle because each event has no candle range; disclose this assumption. Add an assumptions array describing every default or interpretation. Never silently drop a core entry condition. If the idea cannot be represented even approximately by the supported conditions, set supported=false and explain what is needed.
Return ONLY JSON with keys: supported, long, short, rewardRisk, normalizedRules, explanation, missing, unsupportedReasons, assumptions, execution.
execution schema:
{
 "longConditions":[condition,...], "shortConditions":[condition,...],
 "exitLongConditions"?:[condition,...], "exitShortConditions"?:[condition,...],
 "timezone"?: "IANA timezone ID used to display session and trade times (default UTC)",
 "entry":"next_open" or "signal_close",
 "stop":{"type":"signal_candle"|"previous_candle"|"atr"|"percent"|"signal_candle_offset","value":number,"unit"?: "price"|"pip"|"tick"|"point"|"percent","tickSize"?:number},
 "targetR":positive number,
 "maxBarsInTrade":positive integer or null,
 "dataMode"?: "candles"|"aggregated_trades"
}
For Binance crypto only, if the user explicitly requests tick-by-tick or trade-by-trade historical replay, set execution.dataMode="aggregated_trades". This uses Binance compressed aggregate trades: fills at the same time, price and taker order are combined, so it is trade-event replay, not raw individual fills, full order book, footprint or bid/ask depth. If the user needs raw individual fills, quotes, Level 2 or order flow, return supported=false. For any other market, tick replay is unsupported unless an explicitly connected historical tick provider is available. Event replay supports price-sequence rules, volume-per-event, indicators over event prices and clock/session filters; do not compile candle-body, inside-bar, opening-range, candle-range-expansion or ATR rules for event mode. Use price/percent/event-based stops, not ATR or pip-size assumptions.
For combinations of price levels, indicator thresholds, arithmetic comparisons or indicator crossovers not covered by a named primitive, use the safe generic expression condition instead of rejecting the strategy. Expression AST: {"type":"expression","expr":node}; node is {"value":number}, {"field":"open"|"high"|"low"|"close"|"volume"}, {"indicator":"ema"|"sma"|"rsi"|"atr"|"highest"|"lowest"|"volume_sma","period":integer,"source":"open"|"high"|"low"|"close"|"volume"}, or {"op":"gt"|"gte"|"lt"|"lte"|"eq"|"neq"|"crosses_above"|"crosses_below"|"and"|"or"|"not"|"add"|"sub"|"mul"|"div","args":[node,...]}. Binary operators require two args; not requires one; and/or accept 1..12 args. Crosses compare current and previous fully closed bar. Never emit executable code, scripts, eval, or arbitrary functions. AST depth maximum 10.
Any condition may include optional "timeframe":"1m"|"3m"|"5m"|"15m"|"30m"|"1h"|"2h"|"4h"|"1d". When the user explicitly assigns a rule to a timeframe (for example, 1H trend filter and 5M entry), tag each condition with its own timeframe. Evaluate it on the latest fully closed historical candle of that timeframe at each selected execution-candle close. If timeframe assignment is unclear, return supported=false and ask for clarification. The selected chart timeframe remains the execution/entry/exit timeframe. Preserve timeframe tags on nested conditions. Only set supported=true when every required timeframe is available from historical providers. Tick-level data is not candle data.
Conditions are ANDed by default; use {"type":"logic","operator":"all"|"any"|"not","conditions":[...]} to compose nested AND/OR/NOT expressions. Empty side means disabled. Preserve every logical grouping from the user's original strategy. Parse natural-language descriptions in any language, including translated equivalents of buy/long, sell/short, crosses above/below, greater/less than, stop loss, take profit, R-multiple, candle, and lookback. Never reject a strategy merely because its language is not English. Preserve every essential rule the schema can express; if an essential condition cannot be represented exactly, clearly list it and set supported=false rather than silently dropping it or pretending it was tested. Allowed condition forms:
- {"type":"ema_cross","fast":integer,"slow":integer,"direction":"bullish"|"bearish"}
- {"type":"sma_cross","fast":integer,"slow":integer,"direction":"bullish"|"bearish"}
- {"type":"close_vs_ema","period":integer,"operator":"above"|"below"}
- {"type":"close_vs_sma","period":integer,"operator":"above"|"below"}
- {"type":"rsi","period":integer,"operator":"above"|"below","value":number}
- {"type":"macd_cross","direction":"bullish"|"bearish"}
- {"type":"breakout","lookback":integer,"direction":"above"|"below"}
- {"type":"candle_direction","direction":"bullish"|"bearish"}
- {"type":"close_vs_open","operator":"above"|"below"}
- {"type":"close_vs_prev_highlow","level":"high"|"low","operator":"above"|"below"}
- {"type":"consecutive_candles","count":integer,"direction":"bullish"|"bearish"}
- {"type":"engulfing","direction":"bullish"|"bearish"}
- {"type":"inside_bar"}
- {"type":"liquidity_sweep","lookback":integer,"direction":"bullish"|"bearish"} (bullish means sweep below recent lows then close back above; bearish means sweep above recent highs then close back below)
- {"type":"volume_above_sma","period":integer}
- {"type":"logic","operator":"all"|"any"|"not","conditions":[condition,...]} (nest conditions to preserve OR/AND/NOT logic; maximum 5 levels)
- {"type":"session_filter","timezone":"IANA/Zone","startHour":integer,"startMinute":integer,"endHour":integer,"endMinute":integer,"weekdays"?:[0..6]} (all times are local wall-clock time in the named timezone; supports overnight sessions and DST)
- {"type":"session_opening_range_breakout","timezone":"IANA/Zone","sessionHour":integer,"sessionMinute":integer,"rangeMinutes":integer,"trigger":"wick"|"close","direction":"bullish"|"bearish"} (construct range from all candles inside the local-time range; test later candles for first breakout; handle timezone DST)
- {"type":"time_range_breakout","timezone":"IANA/Zone","startHour":0..23,"startMinute":0..59,"rangeMinutes":positive integer,"trigger":"wick"|"close","direction":"bullish"|"bearish"} (build that day's high/low from the exact local clock-time window, then signal only on its first breakout; rangeMinutes may describe one candle or a multi-candle opening range)
- {"type":"time_range_sweep","timezone":"IANA/Zone","startHour":0..23,"startMinute":0..59,"rangeMinutes":positive integer,"direction":"bullish"|"bearish"} (bullish: price wicks below the specified clock-time range low and closes back above it; bearish: wicks above the range high and closes back below it)
- {"type":"weekday_filter","timezone":"IANA/Zone","days":[0..6]} (0 Sunday, 6 Saturday)
- {"type":"clock_time_filter","timezone":"IANA/Zone","startHour":0..23,"startMinute":0..59,"endHour":0..23,"endMinute":0..59} (local wall-clock entry window)
- {"type":"candle_body_percent","operator":"above"|"below","value":0..100} (real body as percent of full candle range)
- {"type":"price_change_percent","lookback":1..500,"operator":"above"|"below","value":number} (close-to-close percentage change over lookback; use bearish direction for negative threshold)
- {"type":"range_expansion","lookback":2..200,"multiplier":positive number} (current candle range exceeds prior average range times multiplier)
- {"type":"expression","expr":node} (safe recursive expression AST using OHLCV fields, EMA/SMA/RSI/ATR/highest/lowest/volume SMA, arithmetic, comparisons, crossovers and boolean logic; use for custom combinations)\n- {"type":"fair_value_gap","direction":"bullish"|"bearish"} (three-candle gap: current low above candle two bars ago high, or current high below that low)
- {"type":"fair_value_gap_return","direction":"bullish"|"bearish","lookback":integer} (price returns into a previously confirmed three-candle FVG; signal only on the first touch; bullish zone is prior candle[2] high to middle candle low, bearish zone is middle candle high to prior candle[2] low)
- {"type":"market_structure_shift","direction":"bullish"|"bearish","lookback":integer} (close breaks the highest/lowest confirmed prior swing range over lookback candles; this is a deterministic rolling-structure proxy, not discretionary ICT swing labeling)
- {"type":"previous_day_sweep","direction":"bullish"|"bearish","timezone":"IANA/Zone"} (sweep previous local calendar day low/high and close back inside)
- {"type":"session_range_sweep","direction":"bullish"|"bearish","timezone":"IANA/Zone","startHour":0..23,"startMinute":0..59,"endHour":0..23,"endMinute":0..59} (sweep the completed local-time session range low/high and close back inside; e.g. Asia range)
- {"type":"order_block_return","direction":"bullish"|"bearish","lookback":integer} (return to the most recent opposing candle before a displacement candle; deterministic OHLC proxy, not volume/order-flow confirmation)
- {"type":"gap","direction":"bullish"|"bearish"} (current open gaps beyond previous candle high/low)
- stop type signal_candle_offset supports value plus unit price|pip|tick|point|percent; pip is symbol-aware; do not assume a universal tick size
Indicator periods must be 2..200; breakout lookback 2..500; RSI value 0..100. Only translate if the user's rules faithfully match these forms. Do not claim arbitrary ICT/FVG/liquidity/session/multi-timeframe rules are supported unless expressible exactly in this schema. For unsupported concepts, return supported=false rather than approximating. If target is missing, use targetR=2 and disclose the 2R default in assumptions and explanation. If stop-loss is missing, use signal_candle and disclose the default. If entry timing is not specified, use next_open and disclose the default. Set supported=true when all core entry conditions can be represented, even when these disclosed risk-management defaults are needed. For unsupported concepts that cannot be represented, clearly identify the limitation rather than pretending the exact strategy was tested. When a user specifies a session/location/timezone, put the exact IANA timezone in execution.timezone and in every time condition. For an opening range, faithfully use the specified start time, duration, and wick/close trigger; do not hardcode London or a five-minute timeframe. If the user says one pip beyond the signal candle, use stop={type:"signal_candle_offset",value:1,unit:"pip"}; pip size is calculated from the actual symbol. If a tick/point size is unknown, do not invent it. If the user specifies a rule-based exit (e.g. close a BUY when RSI crosses below a threshold, or close a SELL when an opposite candle pattern appears), compile it into execution.exitLongConditions or execution.exitShortConditions using the same condition schema. These exit conditions are checked on each later candle close; all conditions in each exit array are ANDed unless nested logic is used. Do not put entry triggers in exit arrays. If no custom exit rule is stated, return empty arrays. Preserve entry timing, direction, stop/target, filters, trade frequency, weekdays, and exit rules. If the strategy says both directions, create conditions for each direction. For EMA crossover set EMA cross conditions. Long/short arrays are evaluated independently. Include a concise normalizedRules description.`;

    // Try the requested model first, then Google's current stable Flash aliases if it is busy/unavailable.
    const models = ["gemini-3.8-flash", "gemini-flash-lite-latest"];
    const failures: string[] = [];

    for (const model of models) {
      try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            model,
            store: false,
            system_instruction: systemInstruction,
            input: strategy,
          }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = result?.error?.message || "Gemini API returned HTTP " + response.status + ".";
          failures.push(model + ": " + message);
          // Move to the next supported model for temporary capacity/model errors.
          if ([408, 429, 500, 502, 503, 504].includes(response.status) || response.status === 404) continue;
          throw new Error(message);
        }

        if (result?.status && result.status !== "completed") {
          failures.push(model + ": response status " + String(result.status));
          continue;
        }

        const raw = extractText(result);
        if (!raw) {
          failures.push(model + ": empty model output");
          continue;
        }

        let parsed: any;
        try {
          parsed = parseModelJson(raw);
        } catch (parseError) {
          failures.push(model + ": invalid JSON output");
          continue;
        }

        if (typeof parsed?.supported !== "boolean") {
          failures.push(model + ": missing supported boolean");
          continue;
        }

        const execution = parsed?.execution && typeof parsed.execution === "object" ? parsed.execution : null;

        // The simulator currently loads OHLCV candles for one selected interval only.
        // Reject rules requiring synchronized timeframes or historical event/tick data.
        const multiTimeframePattern = /multi[ -]?timeframe|\bmtf\b|higher[ -]?timeframe|lower[ -]?timeframe|multiple timeframes|timeframe alignment|top[ -]?down analysis|\b(?:1m|3m|5m|15m|30m|1h|2h|4h|1d)\b.{0,60}\b(?:1m|3m|5m|15m|30m|1h|2h|4h|1d)\b/i;
        const tickDataPattern = /tick[ -]?(?:level|by[ -]?tick|data|chart|feed)|every tick|trade[ -]?by[ -]?trade|each trade event/i;
        const orderFlowPattern = /order[ -]?flow|footprint|time[ -]?and[ -]?sales|tape[ -]?reading|bid[ -]?ask[ -]?stream|level[ -]?2|market[ -]?depth|\bDOM\b/i;
        const unsupportedDataReasons: string[] = [];
        const hasTimeframeTag = (items: any[]): boolean => Array.isArray(items) && items.some((c:any) => !!c?.timeframe || (c?.type === "logic" && hasTimeframeTag(c.conditions)));
        const mtfCompiled = hasTimeframeTag(execution?.longConditions) || hasTimeframeTag(execution?.shortConditions) || hasTimeframeTag(execution?.exitLongConditions) || hasTimeframeTag(execution?.exitShortConditions);
        if (multiTimeframePattern.test(strategy) && !mtfCompiled) unsupportedDataReasons.push("The strategy describes multiple timeframes, but the AI did not compile explicit timeframe-tagged conditions. Clarify which rule belongs to each timeframe.");
        const allConditions = [...(execution?.longConditions || []), ...(execution?.shortConditions || []), ...(execution?.exitLongConditions || []), ...(execution?.exitShortConditions || [])];
        const hasThreeMinute = (items:any[]):boolean => Array.isArray(items) && items.some((c:any)=>c?.timeframe==="3m" || (c?.type==="logic" && hasThreeMinute(c.conditions)));
        if (market !== "crypto" && market !== "futures" && hasThreeMinute(allConditions)) unsupportedDataReasons.push("The connected Twelve Data provider does not supply 3-minute candles for this market. Use a supported timeframe or a market with 3-minute historical coverage.");
        const hasConditionType = (items:any[],types:string[]):boolean => Array.isArray(items) && items.some((c:any)=>types.includes(c?.type) || (c?.type==="logic" && hasConditionType(c.conditions,types)));
        const tickRequested = tickDataPattern.test(strategy) || execution?.dataMode === "aggregated_trades";
        if (orderFlowPattern.test(strategy)) unsupportedDataReasons.push("Historical bid/ask depth, footprint and order-flow event data is not available from the connected free data source.");
        if (tickRequested && (market !== "crypto" || execution?.dataMode !== "aggregated_trades")) unsupportedDataReasons.push("Tick-event replay is currently available only for Binance crypto aggregated trades. Other markets require a tick-data subscription/provider.");
        if (execution?.dataMode === "aggregated_trades" && (hasConditionType(allConditions,["session_opening_range_breakout","time_range_breakout","time_range_sweep","candle_body_percent","range_expansion","inside_bar","engulfing","fair_value_gap"]) || execution?.stop?.type === "atr")) unsupportedDataReasons.push("This rule requires candle OHLC structure that cannot be faithfully evaluated on individual aggregated trade events. Use candle mode or rewrite it as an event-price rule.");
        if (execution?.dataMode === "aggregated_trades" && execution?.stop?.unit === "pip") unsupportedDataReasons.push("Pip-based stops are not valid for Binance crypto trade events. Specify a price or a verified tick-size offset.");
        const validTypes = new Set(["expression","ema_cross","sma_cross","close_vs_ema","close_vs_sma","rsi","macd_cross","breakout","candle_direction","close_vs_open","close_vs_prev_highlow","consecutive_candles","engulfing","inside_bar","liquidity_sweep","volume_above_sma","session_filter","session_opening_range_breakout","time_range_breakout","time_range_sweep","weekday_filter","clock_time_filter","candle_body_percent","price_change_percent","range_expansion","fair_value_gap","fair_value_gap_return","market_structure_shift","previous_day_sweep","session_range_sweep","order_block_return","gap","logic"]);
        const validExpression = (node:any,depth=0):boolean => {
          if(!node||typeof node!=="object"||depth>10)return false;
          if(Object.prototype.hasOwnProperty.call(node,"value"))return Number.isFinite(Number(node.value))&&Object.keys(node).length===1;
          if(node.field!==undefined)return ["open","high","low","close","volume"].includes(String(node.field))&&Object.keys(node).length===1;
          if(node.indicator!==undefined)return ["ema","sma","rsi","atr","highest","lowest","volume_sma"].includes(String(node.indicator))&&Number.isInteger(node.period)&&node.period>=2&&node.period<=500&&["open","high","low","close","volume"].includes(String(node.source||"close"));
          const op=String(node.op||"").toLowerCase(),args=node.args;
          if(!Array.isArray(args))return false;
          if(["and","or"].includes(op))return args.length>=1&&args.length<=12&&args.every((x:any)=>validExpression(x,depth+1));
          if(op==="not")return args.length===1&&validExpression(args[0],depth+1);
          if(["gt","gte","lt","lte","eq","neq","crosses_above","crosses_below","add","sub","mul","div"].includes(op))return args.length===2&&args.every((x:any)=>validExpression(x,depth+1));
          return false;
        };
        const validCondition = (c: any, depth = 0): boolean => {
          if (!c || typeof c !== "object" || depth > 5 || !validTypes.has(c.type)) return false;
          if (c.timeframe !== undefined && !["1m","3m","5m","15m","30m","1h","2h","4h","1d"].includes(String(c.timeframe))) return false;
          if (c.type === "expression") return validExpression(c.expr);
          if (c.type === "logic") return ["all","any","not"].includes(String(c.operator || "all").toLowerCase()) && Array.isArray(c.conditions) && c.conditions.length > 0 && c.conditions.length <= 12 && c.conditions.every((x: any) => validCondition(x, depth + 1));
          if (c.type === "session_range_sweep") return ["bullish","bearish"].includes(c.direction) && typeof c.timezone === "string" && [c.startHour,c.endHour].every((n:any)=>Number.isInteger(Number(n))&&Number(n)>=0&&Number(n)<=23) && [c.startMinute??0,c.endMinute??0].every((n:any)=>Number.isInteger(Number(n))&&Number(n)>=0&&Number(n)<=59);
          if (["session_filter","session_opening_range_breakout","time_range_breakout","time_range_sweep"].includes(c.type)) {
            const hour=Number(c.startHour ?? c.sessionHour ?? 0), minute=Number(c.startMinute ?? c.sessionMinute ?? 0);
            const duration=Number(c.rangeMinutes ?? 5);
            const direction=String(c.direction||"");
            return Number.isInteger(hour)&&hour>=0&&hour<=23&&Number.isInteger(minute)&&minute>=0&&minute<=59&&Number.isFinite(duration)&&duration>=1&&duration<=1440&&(!c.timezone||typeof c.timezone==="string")&&
              (c.type==="session_filter" || ["bullish","bearish"].includes(direction));
          }
          if (["ema_cross","sma_cross"].includes(c.type)) return Number.isInteger(c.fast) && Number.isInteger(c.slow) && c.fast >= 2 && c.slow > c.fast && c.slow <= 200 && ["bullish","bearish"].includes(c.direction);
          if (["close_vs_ema","close_vs_sma","rsi","volume_above_sma"].includes(c.type)) return Number.isInteger(c.period) && c.period >= 2 && c.period <= 200 && (c.type !== "rsi" || (Number.isFinite(Number(c.value)) && Number(c.value) >= 0 && Number(c.value) <= 100));
          if (c.type === "breakout" || c.type === "liquidity_sweep") return Number.isInteger(c.lookback) && c.lookback >= 2 && c.lookback <= 500 && ["above","below","bullish","bearish"].includes(c.direction);
          if (c.type === "candle_direction" || c.type === "consecutive_candles" || c.type === "engulfing") return ["bullish","bearish"].includes(c.direction) && (c.type !== "consecutive_candles" || (Number.isInteger(c.count) && c.count >= 2 && c.count <= 50));
          if (c.type === "weekday_filter") return Array.isArray(c.days) && c.days.length>0 && c.days.every((d: any)=>Number.isInteger(Number(d))&&Number(d)>=0&&Number(d)<=6) && (!c.timezone||typeof c.timezone==="string");
          if (c.type === "clock_time_filter") return [c.startHour,c.endHour].every((n: any)=>Number.isInteger(Number(n))&&Number(n)>=0&&Number(n)<=23) && [c.startMinute??0,c.endMinute??0].every((n: any)=>Number.isInteger(Number(n))&&Number(n)>=0&&Number(n)<=59) && (!c.timezone||typeof c.timezone==="string");
          if (c.type === "candle_body_percent") return ["above","below"].includes(c.operator)&&Number.isFinite(Number(c.value))&&Number(c.value)>=0&&Number(c.value)<=100;
          if (c.type === "price_change_percent") return Number.isInteger(c.lookback)&&c.lookback>=1&&c.lookback<=500&&["above","below","bullish","bearish"].includes(c.operator||c.direction)&&Number.isFinite(Number(c.value))&&Number(c.value)>=0;
          if (c.type === "range_expansion") return Number.isInteger(c.lookback)&&c.lookback>=2&&c.lookback<=200&&Number.isFinite(Number(c.multiplier))&&Number(c.multiplier)>0&&Number(c.multiplier)<=20;
          if (["fair_value_gap","gap"].includes(c.type)) return ["bullish","bearish"].includes(c.direction);
          if (["fair_value_gap_return","market_structure_shift","order_block_return"].includes(c.type)) return ["bullish","bearish"].includes(c.direction) && Number.isInteger(c.lookback) && c.lookback >= 3 && c.lookback <= 500;
          if (c.type === "previous_day_sweep") return ["bullish","bearish"].includes(c.direction) && typeof c.timezone === "string" && c.timezone.length > 0;
          if (c.type === "session_range_sweep") return ["bullish","bearish"].includes(c.direction) && typeof c.timezone === "string" && [c.startHour,c.endHour].every((n:any)=>Number.isInteger(Number(n))&&Number(n)>=0&&Number(n)<=23) && [c.startMinute??0,c.endMinute??0].every((n:any)=>Number.isInteger(Number(n))&&Number(n)>=0&&Number(n)<=59);
          if (c.type === "close_vs_open") return ["above","below"].includes(c.operator);
          if (c.type === "close_vs_prev_highlow") return ["high","low"].includes(c.level) && ["above","below"].includes(c.operator);
          return c.type === "inside_bar" || c.type === "macd_cross";
        };
        const validConditions = (items: any[]) => Array.isArray(items) && items.length <= 12 && items.every((c: any) => validCondition(c));
        const dataModeValid = execution?.dataMode === undefined || ["candles","aggregated_trades"].includes(String(execution.dataMode));
        const stop = execution?.stop;
        const stopOffsetUnit = String(stop?.unit || "price");
        const stopOffsetValid = stop?.type === "signal_candle_offset" &&
          Number.isFinite(Number(stop.value)) && Number(stop.value) > 0 &&
          ["price","pip","tick","point","percent"].includes(stopOffsetUnit) &&
          (!["tick","point"].includes(stopOffsetUnit) ||
            (Number.isFinite(Number(stop.tickSize ?? stop.pointSize)) && Number(stop.tickSize ?? stop.pointSize) > 0));
        const stopValid = !!stop && (
          ["signal_candle","previous_candle"].includes(stop.type) ||
          (["atr","percent"].includes(stop.type) && Number.isFinite(Number(stop.value)) && Number(stop.value) > 0) ||
          stopOffsetValid
        );
        const executionValid = !!execution && dataModeValid &&
          validConditions(execution.longConditions) &&
          validConditions(execution.shortConditions) &&
          (execution.exitLongConditions === undefined || validConditions(execution.exitLongConditions)) &&
          (execution.exitShortConditions === undefined || validConditions(execution.exitShortConditions)) &&
          (execution.longConditions.length > 0 || execution.shortConditions.length > 0) &&
          ["next_open","signal_close"].includes(execution.entry) &&
          stopValid &&
          Number.isFinite(Number(execution.targetR)) &&
          Number(execution.targetR) > 0;
        const safe = {
          supported: parsed.supported === true && executionValid && unsupportedDataReasons.length === 0 && !(Array.isArray(parsed.unsupportedReasons) && parsed.unsupportedReasons.length > 0),
          long: parsed.long === true,
          short: parsed.short === true,
          rewardRisk: Number.isFinite(Number(parsed.rewardRisk)) && Number(parsed.rewardRisk) > 0 ? Number(parsed.rewardRisk) : null,
          normalizedRules: String(parsed.normalizedRules || "").slice(0, 3000),
          explanation: String(parsed.explanation || "Strategy analyzed.").slice(0, 3000),
          missing: Array.isArray(parsed.missing) ? parsed.missing.map((x: unknown) => String(x).slice(0, 200)).slice(0, 12) : [],
          assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.map((x: unknown) => String(x).slice(0, 300)).slice(0, 12) : [],
          unsupportedReasons: [...(Array.isArray(parsed.unsupportedReasons) ? parsed.unsupportedReasons.map((x: unknown) => String(x).slice(0, 200)).slice(0, 12) : []), ...unsupportedDataReasons].slice(0, 12),
          execution: executionValid && unsupportedDataReasons.length === 0 && !(Array.isArray(parsed.unsupportedReasons) && parsed.unsupportedReasons.length > 0) ? {
            longConditions: execution.longConditions,
            shortConditions: execution.shortConditions,
            exitLongConditions: Array.isArray(execution.exitLongConditions) ? execution.exitLongConditions : [],
            exitShortConditions: Array.isArray(execution.exitShortConditions) ? execution.exitShortConditions : [],
            entry: execution.entry,
            stop: execution.stop,
            targetR: Number(execution.targetR),
            maxBarsInTrade: Number.isFinite(Number(execution.maxBarsInTrade)) ? Math.max(1, Math.min(5000, Number(execution.maxBarsInTrade))) : null,
            timezone: typeof execution.timezone === "string" ? execution.timezone.slice(0,80) : "UTC",
            dataMode: execution.dataMode === "aggregated_trades" ? "aggregated_trades" : "candles",
          } : null,
          model,
        };

        return new Response(JSON.stringify(safe), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (modelError) {
        const message = modelError instanceof Error ? modelError.message : "Unknown model error";
        failures.push(model + ": " + message);
        const timedOut = modelError instanceof Error && (modelError.name === "TimeoutError" || modelError.name === "AbortError");
        if (modelError instanceof Error && !timedOut && !/HTTP (408|429|500|502|503|504|404)/.test(message)) throw modelError;
      }
    }

    console.error("strategy-ai: all Gemini model attempts failed:", failures.join(" | "));
    throw new Error("Gemini is temporarily busy or returned an unreadable response. Both AI attempts timed out or failed. Please try again shortly; the request is now capped at about 20 seconds.");
  } catch (error) {
    console.error("strategy-ai error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected AI error." }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});