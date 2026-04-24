const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const { key, endpoint } = require("../config/azureConfig");

const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));

exports.analyzeReport = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        // 1. Get text from Azure
        const poller = await client.beginAnalyzeDocument("prebuilt-layout", req.file.buffer, { contentType: req.file.mimetype });
        const { content } = await poller.pollUntilDone();

        // 2. Send text to Gemini for Medical Reasoning
        const aiAnalysis = await analyzeWithAI(content);
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

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Change your model initialization to this:
const model = genAI.getGenerativeModel({ 
    model: "gemini-3-flash-preview" // The 2026 stable workhorse
});

async function analyzeWithAI(rawText) {
    const prompt = `
You are a medical lab expert. Analyze the following OCR text from a lab report:
"${rawText}"

Return ONLY a JSON object with this exact structure:
{
  "patientName": "string",
  "findings": [
    { 
      "testName": "string", 
      "result": 0, 
      "unit": "string", 
      "status": "Normal/High/Low/Pre-Risk" 
    }
  ],
  "dangerScore": 0,
  "summary": "Brief analysis in English",
  "tips": ["Tip 1", "Tip 2", "Tip 3"]
}

IMPORTANT RULES:
- dangerScore MUST be a number between 0 and 100
- result MUST be numeric (number only, not string)
- tips MUST contain exactly 3 items
- NO extra text, ONLY valid JSON
`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text().trim();

        // Remove markdown code blocks if present
        if (text.startsWith("```")) {
            text = text
                .replace(/^```json/, "")
                .replace(/^```/, "")
                .replace(/```$/, "")
                .trim();
        }

        // Parse JSON safely
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (err) {
            console.error("JSON Parse Error:", err);
            return { error: "Failed to parse AI response", raw: text.substring(0, 200) };
        }

        // =========================
        // SANITIZATION LAYER
        // =========================

        // 1. patientName
        if (typeof parsed.patientName !== "string") {
            parsed.patientName = "";
        }

        // 2. findings normalization
        if (!Array.isArray(parsed.findings)) {
            parsed.findings = [];
        } else {
            parsed.findings = parsed.findings.map(f => {
                if (!f) return null;

                let numericResult = Number(f.result);
                if (!Number.isFinite(numericResult)) numericResult = null;

                return {
                    testName: typeof f.testName === "string" ? f.testName : "",
                    result: numericResult,
                    unit: typeof f.unit === "string" ? f.unit : "",
                    status: typeof f.status === "string" ? f.status : ""
                };
            }).filter(Boolean);
        }

        // 3. dangerScore clamp 0–100
        let ds = Number(parsed.dangerScore);
        if (!Number.isFinite(ds)) ds = 0;

        parsed.dangerScore = Math.max(0, Math.min(100, Math.round(ds)));

        // 4. summary
        if (typeof parsed.summary !== "string") {
            parsed.summary = "";
        }

        // 5. tips validation (exactly 3)
        if (!Array.isArray(parsed.tips) || parsed.tips.length !== 3) {
            parsed.tips = ["", "", ""];
        } else {
            parsed.tips = parsed.tips.map(t =>
                typeof t === "string" ? t : ""
            );
        }

        return parsed;

    } catch (err) {
        console.error("AI analyze error:", err);
        return {
            error: "AI analysis failed",
            raw: rawText.substring(0, 200)
        };
    }
}