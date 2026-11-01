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

    const systemInstruction = `You are the strategy-rule analyst for Nabil FX Backtesting. Analyze the user's trading strategy text.
The backtesting engine executes ONLY this exact rule family:
- LONG: current candle closes above the immediately previous candle high.
- SHORT: current candle closes below the immediately previous candle low.
- LONG stop: immediately previous candle low.
- SHORT stop: immediately previous candle high.
- Take profit: a fixed positive risk multiple (R).
Natural-language variations of those same rules are allowed. Do NOT claim that indicators, liquidity/ICT, sessions, multi-timeframe, discretionary, trailing-stop, partial-exit, or other strategies are executable unless they can be faithfully reduced to the exact rule family above.
Return ONLY one valid JSON object, without Markdown fences or extra text, with keys:
supported (boolean), long (boolean), short (boolean), rewardRisk (number or null), normalizedRules (string), explanation (string), missing (array of strings), unsupportedReasons (array of strings).
Require at least one direction, matching previous-candle stop definitions for selected directions, and a positive fixed R target. Do not invent missing rules. Keep explanation concise and mention engine limitations.`;

    // Try the requested model first, then Google's current stable Flash aliases if it is busy/unavailable.
    const models = ["gemini-3.8-flash", "gemini-flash-lite-latest", "gemini-flash-latest"];
    const failures: string[] = [];

    for (const model of models) {
      try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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

        const safe = {
          supported: parsed.supported === true,
          long: parsed.long === true,
          short: parsed.short === true,
          rewardRisk: Number.isFinite(Number(parsed.rewardRisk)) && Number(parsed.rewardRisk) > 0 ? Number(parsed.rewardRisk) : null,
          normalizedRules: String(parsed.normalizedRules || "").slice(0, 3000),
          explanation: String(parsed.explanation || "Strategy analyzed.").slice(0, 3000),
          missing: Array.isArray(parsed.missing) ? parsed.missing.map((x: unknown) => String(x).slice(0, 200)).slice(0, 12) : [],
          unsupportedReasons: Array.isArray(parsed.unsupportedReasons) ? parsed.unsupportedReasons.map((x: unknown) => String(x).slice(0, 200)).slice(0, 12) : [],
          model,
        };

        return new Response(JSON.stringify(safe), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (modelError) {
        const message = modelError instanceof Error ? modelError.message : "Unknown model error";
        failures.push(model + ": " + message);
        if (modelError instanceof Error && !/HTTP (408|429|500|502|503|504|404)/.test(message)) throw modelError;
      }
    }

    console.error("strategy-ai: all Gemini model attempts failed:", failures.join(" | "));
    throw new Error("Gemini is temporarily busy or returned an unreadable response. Automatic model fallback was attempted. Please try again shortly.");
  } catch (error) {
    console.error("strategy-ai error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected AI error." }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});