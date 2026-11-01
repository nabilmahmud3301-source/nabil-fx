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
    if (strategy.length < 8) {
      return new Response(JSON.stringify({ error: "Please describe your entry, stop-loss and take-profit rules in more detail." }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const systemInstruction = `You are the multilingual natural-language strategy compiler for Nabil FX Backtesting. The user may write in ANY human language or mix multiple languages, use transliteration, abbreviations, trading slang, or imperfect grammar. Detect the input language automatically; understand it directly, internally normalize/translate it as needed, and compile the intended trading rules into the deterministic schema below. Do not require the user to write English. Keep normalizedRules and explanation in the same language as the user's input whenever practical (otherwise use clear English). Convert the user's strategy into a deterministic executable rule specification. Never invent conditions that the user did not state. If a rule is ambiguous, unsupported by the schema, discretionary, or depends on unavailable external/order-book data, set supported=false and explain exactly what is missing.
Return ONLY JSON with keys: supported, long, short, rewardRisk, normalizedRules, explanation, missing, unsupportedReasons, execution.
execution schema:
{
 "longConditions":[condition,...], "shortConditions":[condition,...],
 "entry":"next_open" or "signal_close",
 "stop":{"type":"signal_candle"|"previous_candle"|"atr"|"percent","value":number},
 "targetR":positive number,
 "maxBarsInTrade":positive integer or null
}
Conditions are ANDed; empty side means disabled. Parse natural-language descriptions in any language, including translated equivalents of buy/long, sell/short, crosses above/below, greater/less than, stop loss, take profit, R-multiple, candle, and lookback. Never reject a strategy merely because its language is not English. Preserve every essential rule the schema can express; if an essential condition cannot be represented exactly, clearly list it and set supported=false rather than silently dropping it or pretending it was tested. Allowed condition forms:
- {"type":"ema_cross","fast":integer,"slow":integer,"direction":"bullish"|"bearish"}
- {"type":"sma_cross","fast":integer,"slow":integer,"direction":"bullish"|"bearish"}
- {"type":"close_vs_ema","period":integer,"operator":"above"|"below"}
- {"type":"close_vs_sma","period":integer,"operator":"above"|"below"}
- {"type":"rsi","period":integer,"operator":"above"|"below","value":number}
- {"type":"macd_cross","direction":"bullish"|"bearish"}
- {"type":"breakout","lookback":integer,"direction":"above"|"below"}
- {"type":"candle_direction","direction":"bullish"|"bearish"}
- {"type":"close_vs_open","operator":"above"|"below"}
Indicator periods must be 2..200; breakout lookback 2..500; RSI value 0..100. Only translate if the user's rules faithfully match these forms. Do not claim arbitrary ICT/FVG/liquidity/session/multi-timeframe rules are supported unless expressible exactly in this schema. For unsupported concepts, return supported=false rather than approximating. Default targetR to explicit user target only; if missing, report it in missing and supported=false. Stop must be explicit and mapped to one of allowed stop types. If entry timing not specified, use next_open and disclose this in explanation. If the strategy says both directions, create conditions for each direction. For EMA crossover set EMA cross conditions. Long/short arrays are evaluated independently. Include a concise normalizedRules description.`;

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
        const validTypes = new Set(["ema_cross","sma_cross","close_vs_ema","close_vs_sma","rsi","macd_cross","breakout","candle_direction","close_vs_open"]);
        const validConditions = (items: any[]) => Array.isArray(items) && items.length <= 12 && items.every((c: any) => c && validTypes.has(c.type));
        const executionValid = !!execution &&
          validConditions(execution.longConditions) && validConditions(execution.shortConditions) &&
          ["next_open","signal_close"].includes(execution.entry) &&
          !!execution.stop && ["signal_candle","previous_candle","atr","percent"].includes(execution.stop.type) &&
          Number.isFinite(Number(execution.targetR)) && Number(execution.targetR) > 0 &&
          ["signal_candle","previous_candle"].includes(execution.stop.type) ||
          (!!execution && validConditions(execution.longConditions) && validConditions(execution.shortConditions) &&
          ["next_open","signal_close"].includes(execution.entry) && !!execution.stop &&
          ["atr","percent"].includes(execution.stop.type) && Number(execution.stop.value)>0 &&
          Number.isFinite(Number(execution.targetR)) && Number(execution.targetR)>0);
        const safe = {
          supported: parsed.supported === true && executionValid,
          long: parsed.long === true,
          short: parsed.short === true,
          rewardRisk: Number.isFinite(Number(parsed.rewardRisk)) && Number(parsed.rewardRisk) > 0 ? Number(parsed.rewardRisk) : null,
          normalizedRules: String(parsed.normalizedRules || "").slice(0, 3000),
          explanation: String(parsed.explanation || "Strategy analyzed.").slice(0, 3000),
          missing: Array.isArray(parsed.missing) ? parsed.missing.map((x: unknown) => String(x).slice(0, 200)).slice(0, 12) : [],
          unsupportedReasons: Array.isArray(parsed.unsupportedReasons) ? parsed.unsupportedReasons.map((x: unknown) => String(x).slice(0, 200)).slice(0, 12) : [],
          execution: executionValid ? {
            longConditions: execution.longConditions,
            shortConditions: execution.shortConditions,
            entry: execution.entry,
            stop: execution.stop,
            targetR: Number(execution.targetR),
            maxBarsInTrade: Number.isFinite(Number(execution.maxBarsInTrade)) ? Math.max(1, Math.min(5000, Number(execution.maxBarsInTrade))) : null,
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