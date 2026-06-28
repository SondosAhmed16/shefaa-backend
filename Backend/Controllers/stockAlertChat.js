const { AzureOpenAI } = require("openai");
const { openAIKey, openAIEndpoint } = require("../config/azureConfig");
const { getAIChatContext } = require("./Aicontextcontroller"); // ✅ الـ context من الـ DB

const openaiClient = new AzureOpenAI({
  endpoint: openAIEndpoint,
  apiKey: openAIKey,
  apiVersion: "2024-02-01",
  deployment: "gpt-4o",
});

// ════════════════════════════════════════════════════════════════════════════
// 1) Smart Stock Alert (Predictive Depletion)
// ════════════════════════════════════════════════════════════════════════════

async function generateStockAlert(item) {
  const result = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `You are a pharmacy inventory analyst for "Shefaa Pharmacy".
Given current stock and recent weekly sales rate for a medicine, estimate how many days until it runs out.
Respond in ENGLISH, one short sentence only, in this style:
"Paracetamol will run out in 4 days based on recent sales."
If sales rate is 0, say the item is not moving and stock is stable.
Do not add any extra commentary, just the one sentence.`,
      },
      {
        role: "user",
        content: `Medicine: ${item.name}
Current stock: ${item.currentStock}
Reorder threshold: ${item.threshold}
Units sold in the last 7 days: ${item.weeklySales}`,
      },
    ],
  });

  return result.choices[0]?.message?.content?.trim() || "";
}

exports.getSmartStockAlerts = async (req, res) => {
  try {
    const { items } = req.body; // [{ name, currentStock, threshold, weeklySales }]

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing or invalid 'items' array in request body",
      });
    }

    const lowStockItems = items.filter((i) => i.currentStock <= i.threshold);

    if (lowStockItems.length === 0) {
      return res.status(200).json({ success: true, data: { alerts: [] } });
    }

    const alerts = [];
    for (const item of lowStockItems) {
      try {
        const message = await generateStockAlert(item);
        alerts.push({
          name: item.name,
          currentStock: item.currentStock,
          threshold: item.threshold,
          weeklySales: item.weeklySales,
          message,
        });
      } catch (err) {
        console.warn(`Stock alert failed for ${item.name}:`, err.message);
        alerts.push({
          name: item.name,
          currentStock: item.currentStock,
          threshold: item.threshold,
          weeklySales: item.weeklySales,
          message: `${item.name} has reached the reorder threshold (${item.currentStock} units remaining).`,
        });
      }
    }

    return res.status(200).json({ success: true, data: { alerts } });
  } catch (err) {
    console.error("getSmartStockAlerts error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to generate stock alerts",
      error: err.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// 2) Admin Chat Assistant
// ════════════════════════════════════════════════════════════════════════════

async function generateChatAnswer(question, contextData, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: `You are an internal admin chat assistant for "Shefaa Pharmacy".
Answer the admin's question using ONLY the JSON data provided below — do not invent numbers.
Answer in ENGLISH, clearly and directly, in 1-3 sentences.
If the data needed to answer isn't available in the provided context, say so honestly in English.

Pharmacy Data:
${JSON.stringify(contextData)}`,
          },
          {
            role: "user",
            content: question,
          },
        ],
      });

      const text = result.choices[0]?.message?.content || "";
      if (!text) throw new Error("Empty response from AI");
      return text;
    } catch (err) {
      console.warn(`Admin chat attempt ${attempt} failed:`, err.message);
      if (attempt === retries)
        throw new Error(`AI failed after ${retries} attempts: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

exports.adminChatAssistant = async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        success: false,
        message: "Missing 'question' in request body",
      });
    }

    // ✅ جيب الـ context من الـ DB مباشرة بدل ما تاخده من الـ frontend
    const contextResult = await getAIChatContext(req.user);

    if (!contextResult.success) {
      return res.status(404).json({
        success: false,
        message: contextResult.error || "Failed to load pharmacy context",
      });
    }

    const answer = await generateChatAnswer(question, contextResult.data);

    return res.status(200).json({ success: true, data: { question, answer } });
  } catch (err) {
    console.error("adminChatAssistant error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to generate answer",
      error: err.message,
    });
  }
};