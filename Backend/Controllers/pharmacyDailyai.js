const { AzureOpenAI } = require("openai");
const { openAIKey, openAIEndpoint } = require("../config/azureConfig");
const { getAIChatContext } = require("./Aicontextcontroller"); // ✅ استخدم الـ context الحقيقي

const openaiClient = new AzureOpenAI({
  endpoint: openAIEndpoint,
  apiKey: openAIKey,
  apiVersion: "2024-02-01",
  deployment: "gpt-4o"
});

// ── AI call with retry ────────────────────────────────────────────────────
async function generateWithAI(context, retries = 3) {
  const { profile, inventory, orders, deliveryMen, financials } = context;

  const today = new Date().toLocaleDateString("en-EG", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // ── بناء الـ prompt من الـ context الكامل ──────────────────────────────
  const lowStockList = inventory.lowStockItems.length
    ? inventory.lowStockItems.map(m => `${m.name} (${m.quantity} left)`).join(", ")
    : "None";

  const outOfStockList = inventory.outOfStockItems.length
    ? inventory.outOfStockItems.map(m => m.name).join(", ")
    : "None";

  const expiringSoonList = inventory.expiringSoon.length
    ? inventory.expiringSoon.map(m => `${m.name} (expires ${new Date(m.expiryDate).toLocaleDateString()})`).join(", ")
    : "None";

  const recentOrdersSummary = orders.recentOrders.length
    ? orders.recentOrders
        .slice(0, 5)
        .map(o => `#${o.orderNumber} — ${o.status} — EGP ${o.totalPrice}`)
        .join(", ")
    : "No recent orders";

  const statusCounts = orders.statusCounts;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: `You are a smart pharmacy operations assistant for "${profile.pharmacyName || "Shefaa Pharmacy"}".
Write clear, professional daily summary reports in English for the pharmacy admin.
Be direct and highlight what needs attention. No bullet points — flowing paragraphs only.`,
          },
          {
            role: "user",
            content: `Generate a concise daily summary report for the pharmacy admin.

Today is ${today}.

=== ORDERS ===
- New/Pending: ${statusCounts.New || 0}
- Preparing: ${statusCounts.Preparing || 0}
- Ready: ${statusCounts.Ready || 0}
- Completed: ${statusCounts.Completed || 0}
- Cancelled: ${statusCounts.Cancelled || 0}
- Recent orders: ${recentOrdersSummary}

=== FINANCIALS ===
- Total revenue (all time): EGP ${financials.totalRevenue ?? 0}
- Total net earnings: EGP ${financials.totalNetEarnings ?? 0}
- Current due (commission): EGP ${financials.currentDue ?? 0}
- Payment status: ${financials.paymentStatus ?? "unknown"}
- Pending payments total: EGP ${financials.totalPending ?? 0}

=== INVENTORY ===
- Total items in stock: ${inventory.totalItems}
- Total stock value: EGP ${inventory.totalStockValue.toFixed(2)}
- Low stock items (${inventory.lowStockItems.length}): ${lowStockList}
- Out of stock items (${inventory.outOfStockItems.length}): ${outOfStockList}
- Expiring within 30 days (${inventory.expiringSoon.length}): ${expiringSoonList}

=== DELIVERY ===
- Available: ${deliveryMen.summary.Available || 0}
- Busy: ${deliveryMen.summary.Busy || 0}
- Offline: ${deliveryMen.summary.Offline || 0}

=== PHARMACY STATUS ===
- Open now: ${profile.openNow ? "Yes" : "No"}
- Delivery available: ${profile.deliveryAvailable ? "Yes" : "No"}
- Visibility: ${profile.visibilityStatus ?? "unknown"}

Write a 4-6 sentence summary covering:
1. Overall day performance and order activity
2. Financial highlights and any pending dues
3. Urgent inventory issues (low stock, out of stock, expiring soon)
4. Delivery staff availability
5. One actionable recommendation for tomorrow`,
          },
        ],
      });

      const text = result.choices[0]?.message?.content || "";
      if (!text) throw new Error("Empty response from AI");
      return text;

    } catch (err) {
      console.warn(`Daily summary attempt ${attempt} failed:`, err.message);
      if (attempt === retries) throw new Error(`AI failed after ${retries} attempts: ${err.message}`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// ── Main Controller ───────────────────────────────────────────────────────
exports.generateDailySummary = async (req, res) => {
  try {
    // ✅ جيب الـ context الكامل من الـ DB مباشرة بدل ما تعتمد على الـ frontend
    const contextResult = await getAIChatContext(req.user);

    if (!contextResult.success) {
      return res.status(404).json({
        success: false,
        message: contextResult.error || "Failed to load pharmacy context",
      });
    }

    const summary = await generateWithAI(contextResult.data);

    return res.status(200).json({ success: true, data: { summary } });

  } catch (err) {
    console.error("generateDailySummary error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to generate summary",
      error: err.message,
    });
  }
};