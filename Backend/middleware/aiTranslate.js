// middleware/aiTranslate.js
// Uses your existing Azure OpenAI client to translate API responses on-the-fly.
// Works as an Express middleware — wraps res.json() transparently.

const { AzureOpenAI } = require("openai");
const { openAIKey, openAIEndpoint } = require("../config/azureConfig");

const openaiClient = new AzureOpenAI({
    endpoint: openAIEndpoint,
    apiKey: openAIKey,
    apiVersion: "2024-02-01",
    deployment: "gpt-4o",
});

// Keys that should NEVER be translated (IDs, dates, numbers, statuses used in logic)
const SKIP_KEYS = new Set([
    "id", "_id", "userId", "pharmacyId", "orderId", "patientId",
    "createdAt", "updatedAt", "date", "timestamp",
    "email", "phone", "password", "token",
    "price", "amount", "quantity", "count", "total",
    "lat", "lng", "latitude", "longitude",
    "status",      // keep raw status for frontend logic (e.g. if status === 'pending')
    "code", "sku",
]);

// ─── Core translation function ─────────────────────────────────────────────

async function translateWithAI(data, targetLang) {
    if (!data || targetLang === "en") return data;

    const { strings, skeleton } = extractStrings(data);
    if (Object.keys(strings).length === 0) return data;

    const stringCount = Object.keys(strings).length;
    if (stringCount > 100) {
        console.warn(`[aiTranslate] Too many strings (${stringCount}), skipping`);
        return data;
    }

    // ✅ هنا كانت المشكلة — langName متعرفتش
    const langName = targetLang === "ar" ? "Arabic"
        : targetLang === "fr" ? "French"
            : targetLang === "de" ? "German"
                : targetLang === "es" ? "Spanish"
                    : targetLang === "tr" ? "Turkish"
                        : targetLang;


    const prompt = `You are a translation engine for a pharmacy app (Shefaa).
Translate the following JSON values to ${langName}.
Rules:
- Keep medical/pharmaceutical terms accurate
- Keep numbers, emails, dates, and IDs exactly as-is
- Keep the JSON structure identical — only change the values
- Do NOT translate keys, only values
- Return ONLY valid JSON, no explanation

${JSON.stringify(strings, null, 2)}`;

    const result = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: "You are a precise translation engine. Return only valid JSON." },
            { role: "user", content: prompt },
        ],
    });

    const translated = JSON.parse(result.choices[0].message.content);
    return rehydrate(skeleton, translated);
}

// ─── String extraction helpers ─────────────────────────────────────────────

// Walks the object, pulls out translatable strings with flat dot-notation keys
function extractStrings(obj, prefix = "", strings = {}, skeleton = {}) {
    if (Array.isArray(obj)) {
        skeleton[prefix] = [];
        obj.forEach((item, i) => {
            const { strings: s, skeleton: sk } = extractStrings(item, `${prefix}[${i}]`, {}, {});
            Object.assign(strings, s);
            skeleton[prefix].push(sk);
        });
    } else if (obj && typeof obj === "object") {
        skeleton[prefix] = {};
        for (const [key, val] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (SKIP_KEYS.has(key)) {
                skeleton[prefix][key] = val; // keep as-is
            } else {
                extractStrings(val, fullKey, strings, skeleton[prefix]);
            }
        }
    } else if (typeof obj === "string" && obj.trim().length > 1) {
        strings[prefix] = obj;
        skeleton[prefix] = "__TRANSLATE__";
    } else {
        skeleton[prefix] = obj;
    }

    return { strings, skeleton };
}

// Puts translated strings back into the skeleton
function rehydrate(skeleton, translated) {
    if (skeleton === "__TRANSLATE__") return translated; // leaf node replaced

    if (Array.isArray(skeleton)) {
        return skeleton.map((item, i) => rehydrate(item, translated));
    }

    if (skeleton && typeof skeleton === "object") {
        const result = {};
        for (const [key, val] of Object.entries(skeleton)) {
            result[key] = rehydrate(val, translated[key] ?? val);
        }
        return result;
    }

    return skeleton;
}

// ─── Language detection (same logic as i18n middleware) ───────────────────

const SUPPORTED = ["ar", "en", "fr", "de", "es", "tr"];

function detectLanguage(req) {
    if (req.query.lang && SUPPORTED.includes(req.query.lang)) return req.query.lang;
    const xLang = req.headers["x-lang"];
    if (xLang && SUPPORTED.includes(xLang)) return xLang;
    const acceptLang = req.headers["accept-language"];
    if (acceptLang) {
        const primary = acceptLang.split(",")[0].split("-")[0].toLowerCase();
        if (SUPPORTED.includes(primary)) return primary;
    }
    return "en";
}

// ─── Express middleware ────────────────────────────────────────────────────

function aiTranslateMiddleware(options = {}) {
    const {
        defaultLang = "en",
        skipRoutes = [],          // e.g. ['/api/auth', '/api/upload']
        onlyRoutes = null,        // if set, only translate these routes
        translateKeys = null,     // if set, only translate these top-level keys (e.g. ['message', 'data'])
    } = options;

    return function (req, res, next) {
        const lang = detectLanguage(req);
        req.lang = lang;

        // Skip translation if language is English (source language)
        if (lang === defaultLang) return next();

        // Skip if route is excluded
        const path = req.path;
        if (skipRoutes.some((r) => path.startsWith(r))) return next();
        if (onlyRoutes && !onlyRoutes.some((r) => path.startsWith(r))) return next();

        // Intercept res.json()
        const originalJson = res.json.bind(res);

        res.json = async function (body) {
            try {
                let toTranslate = body;

                // Optionally translate only specific top-level keys
                if (translateKeys && body && typeof body === "object") {
                    toTranslate = {};
                    const rest = {};
                    for (const [k, v] of Object.entries(body)) {
                        if (translateKeys.includes(k)) toTranslate[k] = v;
                        else rest[k] = v;
                    }
                    const translated = await translateWithAI(toTranslate, lang);
                    return originalJson({ ...rest, ...translated });
                }

                const translated = await translateWithAI(body, lang);
                return originalJson(translated);

            } catch (err) {
                console.error("[aiTranslate] Translation failed, returning original:", err.message);
                return originalJson(body); // graceful fallback — never break the response
            }
        };

        next();
    };
}

module.exports = aiTranslateMiddleware;