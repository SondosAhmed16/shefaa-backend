const { AzureOpenAI } = require("openai");
const { openAIKey, openAIEndpoint } = require("../config/azureConfig");

const openaiClient = new AzureOpenAI({
  endpoint: openAIEndpoint,
  apiKey: openAIKey,
  apiVersion: "2024-02-01",
  deployment: "gpt-4o"
});

// ===== AI Summary =====

async function generateWithAI(data, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: `You are a smart pharmacy operations assistant for "Shefaa Pharmacy". 
Write clear, professional daily summary reports in English for the pharmacy admin.
Be direct and highlight what needs attention. No bullet points — flowing paragraphs only.`
          },
          {
            role: "user",
            content: `Generate a concise daily summary report for the pharmacy admin.

Today's data (${data.date}):
- Completed orders today: ${data.todayCompleted}
- Pending new orders: ${data.newPending}
- Cancelled orders today: ${data.cancelledToday}
- Today's gross revenue: EGP ${data.todayRevenue}
- Today's net earnings (after 1% commission): EGP ${data.todayEarnings}
- Top selling medicine: ${data.topMedicine}
- Low stock items (${data.lowStockCount} items): ${data.lowStockItems || "None"}
- Delivery staff: ${data.totalDeliveryMen} total, ${data.busyDm} busy, ${data.availableDm} available

Write a 4-6 sentence summary covering:
1. Overall day performance
2. Revenue highlight
3. Any urgent issues (low stock, pending orders, cancelled orders)
4. One actionable recommendation for tomorrow`
          }
        ]
      });

      const text = result.choices[0]?.message?.content || "";
      if (!text) throw new Error("Empty response from AI");

      return text;

    } catch (err) {
      console.warn(`Daily summary attempt ${attempt} failed:`, err.message);

      if (attempt === retries) {
        throw new Error(`AI failed after ${retries} attempts: ${err.message}`);
      }

      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// ===== Main Controller =====

exports.generateDailySummary = async (req, res) => {
  try {
    const {
      date,
      todayCompleted,
      newPending,
      cancelledToday,
      todayRevenue,
      todayEarnings,
      topMedicine,
      lowStockCount,
      lowStockItems,
      totalDeliveryMen,
      busyDm,
      availableDm,
    } = req.body;

    if (todayCompleted === undefined) {
      return res.status(400).json({ success: false, message: "Missing pharmacy data in request body" });
    }

    const summary = await generateWithAI({
      date,
      todayCompleted,
      newPending,
      cancelledToday,
      todayRevenue: Number(todayRevenue).toFixed(2),
      todayEarnings: Number(todayEarnings).toFixed(2),
      topMedicine,
      lowStockCount,
      lowStockItems: Array.isArray(lowStockItems) ? lowStockItems.join(", ") : lowStockItems,
      totalDeliveryMen,
      busyDm,
      availableDm,
    });

    return res.status(200).json({ success: true, data: { summary } });

  } catch (err) {
    console.error("generateDailySummary error:", err);
    return res.status(500).json({ success: false, message: "Failed to generate summary", error: err.message });
  }
};