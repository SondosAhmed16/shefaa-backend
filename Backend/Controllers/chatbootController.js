const { AzureOpenAI } = require("openai");
const { openAIKey, openAIEndpoint } = require("../config/azureConfig");

const openaiClient = new AzureOpenAI({
    endpoint: openAIEndpoint,
    apiKey: openAIKey,
    apiVersion: "2024-02-01",
    deployment: "gpt-4o"
});

// ===== Helper Functions =====

const SYSTEM_PROMPT = `You are a specialized Medical Assistant. You only answer questions related to medicine, health, anatomy, and pharmacology.
If a user asks a question outside of the medical field, politely inform them that you are only programmed to assist with medical inquiries.

Guidelines:
- Provide accurate, evidence-based medical information.
- Always recommend consulting a licensed healthcare professional for personal medical advice.
- Never diagnose conditions or prescribe treatments — only provide general medical knowledge.
- Be empathetic, clear, and concise in your responses.
- Keep responses SHORT and SUMMARIZED — maximum 3-4 sentences per answer.
- Use simple, easy-to-understand language. Avoid unnecessary medical jargon.
- If more detail is needed, the user can ask a follow-up question.`;

function buildMessages(conversationHistory, userMessage) {
    return [
        { role: "system", content: SYSTEM_PROMPT },
        ...conversationHistory,
        { role: "user", content: userMessage }
    ];
}

// ===== AI Chat =====

async function chatWithAI(conversationHistory, userMessage, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const messages = buildMessages(conversationHistory, userMessage);

            const result = await openaiClient.chat.completions.create({
                model: "gpt-4o-mini",
                temperature: 0.3,
                messages
            });

            const reply = result.choices[0].message.content;

            console.log(`AI CHAT RESPONSE (attempt ${attempt}):`, reply);

            if (!reply || reply.trim() === "") {
                throw new Error("Empty response from AI");
            }

            return {
                reply,
                usage: result.usage
            };

        } catch (err) {
            console.warn(`Attempt ${attempt} failed:`, err.message);

            if (attempt === retries) {
                return { error: "AI failed after retries", details: err.message };
            }

            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
}

// ===== Main Controller =====

exports.medicalChat = async (req, res) => {
    try {
        const { message, conversationHistory } = req.body;

        if (!message || message.trim() === "") {
            return res.status(400).json({ message: "No message provided" });
        }

        // Accept missing, null, or an array — reject anything else
        if (conversationHistory !== undefined && conversationHistory !== null && !Array.isArray(conversationHistory)) {
            return res.status(400).json({ message: "conversationHistory must be an array" });
        }

        const history = Array.isArray(conversationHistory) ? conversationHistory : [];

        const aiResponse = await chatWithAI(history, message);

        if (aiResponse.error) {
            return res.status(500).json({
                message: "Chatbot failed to respond",
                error: aiResponse.error,
                details: aiResponse.details
            });
        }

        const updatedHistory = [
            ...history,
            { role: "user", content: message },
            { role: "assistant", content: aiResponse.reply }
        ];

        res.status(200).json({
            success: true,
            data: {
                reply: aiResponse.reply,
                conversationHistory: updatedHistory,
                usage: aiResponse.usage
            }
        });

    } catch (err) {
        console.error("Chatbot Pipeline Error:", err);
        res.status(500).json({ message: "Chatbot failed", error: err.message });
    }
};