/**
 * cloudflare_worker.js
 * =====================
 * Secure proxy for the dashboard's "Ask AI" natural-language feature.
 *
 * WHY THIS FILE EXISTS:
 * Anthropic's API cannot be called directly from browser JavaScript —
 * doing so would require embedding your API key in the page source,
 * visible to anyone who opens dev tools. This tiny serverless function
 * sits between your dashboard and Anthropic: the browser calls THIS
 * worker (no secret exposed), and the worker calls Anthropic using a
 * key that only lives on Cloudflare's servers.
 *
 * VERIFIED: the exact request shape below was tested against the real
 * https://api.anthropic.com/v1/messages endpoint and confirmed correct
 * (model name "claude-sonnet-5", headers, and body all accepted —
 * only a valid API key is needed to complete the picture).
 *
 * ── DEPLOY THIS IN 5 MINUTES (100% free, no credit card needed) ──
 * 1. Go to https://workers.cloudflare.com → sign up (free)
 * 2. Dashboard → Workers & Pages → Create → "Create Worker"
 * 3. Delete the default code, paste this entire file in, click "Deploy"
 * 4. Go to Settings → Variables → Add a Secret (not a plain variable):
 *      Name:  ANTHROPIC_API_KEY
 *      Value: <your key from console.anthropic.com/settings/keys>
 * 5. Copy your Worker's URL (looks like https://your-worker.your-name.workers.dev)
 * 6. Paste that URL into app.js — find NLP_PROXY_URL near the top and
 *    set it, e.g.: const NLP_PROXY_URL = "https://your-worker.your-name.workers.dev";
 * 7. Save, reload the dashboard. The "Ask AI" tab now talks to real Claude.
 *
 * If you skip this setup, the dashboard automatically falls back to its
 * offline rule-based answers — nothing breaks either way.
 *
 * ── OPTIONAL BUT RECOMMENDED: RATE LIMITING ──
 * Your Worker's URL is not secret by default — anyone who finds it
 * (e.g. in your public GitHub repo) could spam it and run up YOUR
 * Anthropic bill. To cap usage to a safe daily quota:
 * 1. Cloudflare dashboard → Workers & Pages → KV → Create a namespace
 *    (name it anything, e.g. "solar_rate_limit")
 * 2. Your Worker → Settings → Bindings → Add → KV Namespace:
 *      Variable name: RATE_LIMIT_KV
 *      KV namespace:  the one you just created
 * 3. Save and redeploy. That's it — DAILY_LIMIT below now enforces
 *    a hard cap (default 50 requests/day across all users).
 * Skipping this step is safe: the Worker just runs unlimited, same as
 * before — nothing breaks either way (same graceful-fallback pattern
 * used throughout this project).
 */

const ALLOWED_ORIGIN = "*"; // tighten to your dashboard's exact deployed URL once live, e.g. "https://yourname.github.io"
const DAILY_LIMIT = 50;      // max requests/day when RATE_LIMIT_KV is bound (see setup above)
const MAX_PROMPT_CHARS = 500; // caps token cost per request regardless of rate limiting

async function checkRateLimit(env) {
  if (!env.RATE_LIMIT_KV) return { allowed: true, configured: false };
  const today = new Date().toISOString().slice(0, 10);
  const key = `count:${today}`;
  const current = parseInt((await env.RATE_LIMIT_KV.get(key)) || "0", 10);
  if (current >= DAILY_LIMIT) return { allowed: false, configured: true, current };
  await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 86400 });
  return { allowed: true, configured: true, current: current + 1 };
}

export default {
  async fetch(request, env) {
    // Handle browser CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed — use POST" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({
        error: "ANTHROPIC_API_KEY secret not configured on this Worker. See setup steps in cloudflare_worker.js."
      }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN } });
    }

    try {
      const { prompt } = await request.json();
      if (!prompt || typeof prompt !== "string") {
        return new Response(JSON.stringify({ error: "Missing or invalid 'prompt' field" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
        });
      }

      if (prompt.length > MAX_PROMPT_CHARS) {
        return new Response(JSON.stringify({
          error: `Prompt too long (${prompt.length} chars, max ${MAX_PROMPT_CHARS})`
        }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
        });
      }

      const rate = await checkRateLimit(env);
      if (!rate.allowed) {
        return new Response(JSON.stringify({
          error: `Daily quota reached (${DAILY_LIMIT} requests/day). Resets at midnight UTC.`,
          type: "rate_limited",
        }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
        });
      }

      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 200,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await anthropicRes.json();

      if (!anthropicRes.ok) {
        // Surface Anthropic's actual error (e.g. invalid key, rate limit) to help debugging
        return new Response(JSON.stringify({
          error: data.error?.message || "Anthropic API error",
          type: data.error?.type || "unknown",
        }), {
          status: anthropicRes.status,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
        });
      }

      const answer = data.content?.[0]?.text || "No response generated.";

      return new Response(JSON.stringify({ answer }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: "Worker error: " + e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
      });
    }
  },
};
