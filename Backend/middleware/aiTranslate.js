const crypto = require("crypto");
const { translateWithAI } = require("./aiTranslate");

class LRUCache {
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  get size() { return this.cache.size; }
}

const cache = new LRUCache(500);

function cacheKey(body, lang) {
  const str = JSON.stringify(body) + lang;
  return crypto.createHash("md5").update(str).digest("hex");
}

const SUPPORTED = ["ar", "en", "fr", "de", "es", "tr"];

function detectLanguage(req) {
  if (req.headers["x-lang"] && SUPPORTED.includes(req.headers["x-lang"])) return req.headers["x-lang"];
  if (req.query.lang && SUPPORTED.includes(req.query.lang)) return req.query.lang;
  const acceptLang = req.headers["accept-language"];
  if (acceptLang) {
    const primary = acceptLang.split(",")[0].split("-")[0].toLowerCase();
    if (SUPPORTED.includes(primary)) return primary;
  }
  return "en";
}

function cachedAiTranslate(options = {}) {
  const defaultLang = options.defaultLang || "en";
  const skipRoutes = options.skipRoutes || [];

  return function (req, res, next) {
    const lang = detectLanguage(req);
    req.lang = lang;

    if (lang === defaultLang) return next();
    if (skipRoutes.some((r) => req.path.startsWith(r))) return next();

    const originalJson = res.json.bind(res);

    res.json = async function (body) {
      // ✅ restore أول حاجة عشان منعملش infinite loop
      res.json = originalJson;

      try {
        const key = cacheKey(body, lang);
        const cached = cache.get(key);

        if (cached) {
          console.log(`[translateCache] HIT (lang=${lang})`);
          return originalJson(cached);
        }

        // ✅ الترجمة بتتعمل وبعدين بنبعت النتيجة
        const translated = await translateWithAI(body, lang);
        cache.set(key, translated);
        console.log(`[translateCache] STORED (lang=${lang}, size=${cache.size})`);
        return originalJson(translated);

      } catch (err) {
        console.error("[translateCache] failed:", err.message);
        return originalJson(body);
      }
    };

    next();
  };
}

module.exports = cachedAiTranslate;
module.exports.cache = cache;