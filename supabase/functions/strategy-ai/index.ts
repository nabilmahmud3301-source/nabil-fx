// Nabil FX Strategy AI — Supabase Edge Function
// Deploy with JWT verification enabled. Store GEMINI_API_KEY in Supabase Secrets.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("AI backend is not configured yet. Add GEMINI_API_KEY to Supabase Edge Function Secrets.");

    const body = await req.json();
    const strategy = String(body?.strategy || "").trim().slice(0, 12000);
    if (strategy.length < 8) {
      return new Response(JSON.stringify({ error: "Describe your entry, stop-loss and take-profit rules in more detail." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are the strategy-rule analyst for Nabil FX Backtesting. Analyze the user's trading strategy text.
This backtesting engine currently executes ONLY this exact rule family:
- LONG: current candle closes above the immediately previous candle high.
- SHORT: current candle closes below the immediately previous candle low.
- LONG stop: immediately previous candle low.
- SHORT stop: immediately previous candle high.
- Take profit: a fixed positive risk multiple (R).
You may recognize natural-language variations of those same rules, but MUST NOT pretend other strategies are executable. Indicator-based, liquidity/ICT, session, multi-timeframe, discretionary, trailing-stop, partial-exit, or any other strategy is unsupported unless it can be faithfully reduced to the exact rule family above.
Return ONLY valid JSON with keys:
supported (boolean), long (boolean), short (boolean), rewardRisk (number or null), normalizedRules (string), explanation (string), missing (array of strings), unsupportedReasons (array of strings).
If supported, require at least one direction, both matching previous-candle stop definitions for the selected directions, and a positive fixed R target. Set unsupported false otherwise. Do not invent missing rules. Keep explanation concise and mention limitations. User strategy:
${strategy}`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        store: false,
        system_instruction: "You are the strategy-rule analyst for Nabil FX Backtesting. Analyze trading strategy text. The engine executes ONLY: LONG when current candle closes above immediately previous candle high, stop at previous candle low; SHORT when current candle closes below immediately previous candle low, stop at previous candle high; take profit is a fixed positive risk multiple (R). Natural-language variations of those same rules are allowed. Indicators, liquidity/ICT, sessions, multi-timeframe, discretionary, trailing-stop, partial-exit, or any other strategy is unsupported unless faithfully reducible to the exact rule family. Return ONLY valid JSON with keys: supported (boolean), long (boolean), short (boolean), rewardRisk (number or null), normalizedRules (string), explanation (string), missing (array of strings), unsupportedReasons (array of strings). Require at least one direction, matching previous-candle stop definitions for selected directions, and positive fixed R. Do not invent missing rules. Keep explanation concise and mention limitations.",
        input: strategy
      })
    });

    const result = await response.json();
    if (!response.ok) {
      const message = result?.error?.message || "Gemini Interactions API request failed (HTTP " + response.status + ").";
      throw new Error(message);
    }
    const raw = Array.isArray(result?.steps)
      ? result.steps.filter((step: { type?: string }) => step.type === "model_output")
          .flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => Array.isArray(step.content) ? step.content : [])
          .filter((part: { type?: string; text?: string }) => part.type === "text")
          .map((part: { text?: string }) => part.text || "").join("")
      : "";
    if (!raw) throw new Error("Gemini returned an empty response. Please retry.");
    const parsed = JSON.parse(raw);
    const safe = {
      supported: parsed.supported === true,
      long: parsed.long === true,
      short: parsed.short === true,
      rewardRisk: Number.isFinite(Number(parsed.rewardRisk)) && Number(parsed.rewardRisk) > 0 ? Number(parsed.rewardRisk) : null,
      normalizedRules: String(parsed.normalizedRules || "").slice(0, 3000),
      explanation: String(parsed.explanation || "Strategy analyzed.").slice(0, 3000),
      missing: Array.isArray(parsed.missing) ? parsed.missing.map((x: unknown) => String(x).slice(0, 200)).slice(0, 12) : [],
      unsupportedReasons: Array.isArray(parsed.unsupportedReasons) ? parsed.unsupportedReasons.map((x: unknown) => String(x).slice(0, 200)).slice(0, 12) : [],
      model: "Gemini 3.8 Flash",
    };

    return new Response(JSON.stringify(safe), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected AI error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
