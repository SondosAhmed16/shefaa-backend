const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const { key, endpoint } = require("../config/azureConfig");

const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));

exports.analyzeReport = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        // 1. Get text from Azure
        const poller = await client.beginAnalyzeDocument("prebuilt-layout", req.file.buffer, { contentType: req.file.mimetype });
        const { content } = await poller.pollUntilDone();

        const cleanedText = cleanText(content);
        const aiAnalysis = await analyzeWithAI(cleanedText);
        //helping
        // 3. Send final structured JSON to Flutter
        res.status(200).json({
            success: true,
            data: aiAnalysis
        });
    } catch (err) {
        console.error("Pipeline Error:", err);
        res.status(500).json({ message: "AI Analysis failed ya albi", error: err.message });
    }
};
function cleanText(text) {
    return text
        .replace(/\n+/g, "\n")
        .replace(/[^\x00-\x7F\u0600-\u06FF0-9.%/ \n]/g, "") // remove noise
        .trim();
}
function extractJSON(text) {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? match[0] : null;
}
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Change your model initialization to this:
const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview" // The 2026 stable workhorse
});

async function analyzeWithAI(rawText) {
    const prompt = `
Analyze the following medical lab report text and extract data into a STRICT JSON format.
Follow these logic rules:
1. "findings": Include ALL tests where a result is present, especially "Microscopic Examination" items like Mucus, Epithelial Cells, and Crystals, even if they aren't numeric.
2. "status": Determine based on the "Reference Range" provided in the text. For non-numeric results (e.g., "Some", "Slightly Turbid"), mark status as "Abnormal" or "Attention" if they deviate from "Nil/Clear".
3. "summary": Provide a concise explanation for a non-medical user. If Pus Cells or RBCs are elevated, explain what this might indicate (e.g., irritation or infection).
4. "tips": Provide specific, actionable advice based on the findings (e.g., if specific gravity is high, suggest hydration; if pH is low, suggest reducing acidic foods).
5. "dangerScore": Scale 0-10 (0: Perfectly normal, 10: Critical emergency).

Lab Report Text:
"${rawText}"

STRICT JSON OUTPUT ONLY:
{
  "patientName": "string",
  "findings": [
    { 
      "testName": "string", 
      "result": "string or number", 
      "unit": "string", 
      "status": "Normal/High/Low/Abnormal",
      "interpretation": "Briefly explain what this specific result means"
    }
  ],
  "dangerScore": number,
  "summary": "string (in simple terms)",
  "tips": ["string", "string", "string"]
}
`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text().trim();

        // FIX: Remove markdown backticks if the AI added them
        if (text.startsWith("```")) {
            text = text.replace(/^```json/, "").replace(/```$/, "").trim();
        }


        let jsonText = extractJSON(text);

        if (!jsonText) {
            return { error: "No JSON found", raw: text.substring(0, 200) };
        }

        return JSON.parse(jsonText);
    } catch (parseError) {
        console.error("JSON Parse Error:", parseError);
        // Fallback so the server doesn't 500
        return { error: "Failed to parse AI response", raw: rawText.substring(0, 100) };
    }
}