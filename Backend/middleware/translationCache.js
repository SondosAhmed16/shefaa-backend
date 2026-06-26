// middleware/translationCache.js
// In-memory LRU cache — avoids calling AI twice for the same text+language.
// Drop-in wrapper around aiTranslate.js

const crypto = require("crypto");
const aiTranslateMiddleware = require("./aiTranslate");

// Simple LRU cache (no extra npm needed)
class LRUCache {
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      // Delete least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  get size() {
    return this.cache.size;
  }
}

const cache = new LRUCache(500);

function cacheKey(body, lang) {
  const str = JSON.stringify(body) + lang;
  return crypto.createHash("md5").update(str).digest("hex");
}

// ─── Cached middleware factory ─────────────────────────────────────────────

function cachedAiTranslate(options = {}) {
  const baseMiddleware = aiTranslateMiddleware(options);
  const defaultLang = options.defaultLang || "en";

  return function (req, res, next) {
    // Detect language early
    const lang = req.headers["x-lang"] ||
      req.query.lang ||
      (req.headers["accept-language"] || "en").split(",")[0].split("-")[0];

    if (lang === defaultLang) return next();

    // Intercept res.json BEFORE the base middleware does
    const originalJson = res.json.bind(res);

    res.json = async function (body) {
      const key = cacheKey(body, lang);
      const cached = cache.get(key);

      if (cached) {
        console.log(`[translateCache] HIT (lang=${lang}, size=${cache.size})`);
        return originalJson(cached);
      }

      // Restore original json so base middleware can intercept it
      res.json = originalJson;

      // Wrap again to capture the translated result
      const translatedJson = res.json.bind(res);
      res.json = async function (translatedBody) {
        cache.set(key, translatedBody);
        console.log(`[translateCache] STORED (lang=${lang}, size=${cache.size})`);
        return translatedJson(translatedBody);
      };

      // Call base middleware translation
      const fakeNext = () => {};
      await baseMiddleware(req, res, fakeNext);

      // Trigger the original flow with the intercepted body
      return res.json(body);
    };

    next();
  };
}

module.exports = cachedAiTranslate;
module.exports.cache = cache; // export for stats/clearing if needed