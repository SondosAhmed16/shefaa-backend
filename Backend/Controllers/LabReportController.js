const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const { key, endpoint } = require("../config/azureConfig");

const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));

exports.analyzeReport = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        // 1. Extract text from Azure OCR
        const poller = await client.beginAnalyzeDocument(
            "prebuilt-layout",
            req.file.buffer,
            { contentType: req.file.mimetype }
        );

        const { content } = await poller.pollUntilDone();

        // 2. Send text to AI
        const aiAnalysis = await analyzeWithAI(content);

        // 3. Return response
        res.status(200).json({
            success: true,
            data: aiAnalysis
        });

    } catch (err) {
        console.error("Pipeline Error:", err);
        res.status(500).json({
            message: "AI Analysis failed",
            error: err.message
        });
    }
};

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ استخدم موديل مستقر
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash"
});

async function analyzeWithAI(rawText) {
    const prompt = `
You are a medical lab expert.

Analyze the following OCR text from a lab report:
"${rawText}"

Return ONLY a valid JSON object with this exact structure:
{
  "patientName": "string",
  "findings": [
    { "testName": "string", "result": "number", "unit": "string", "status": "Normal/High/Low/Pre-Risk" }
  ],
  "dangerScore": 0,
  "summary": "Brief analysis in English",
  "tips": ["Tip 1", "Tip 2", "Tip 3"]
}

STRICT RULES:
- Output MUST be pure JSON (no text, no explanation)
- No markdown
- No backticks
- No extra text before or after JSON
- Always include all fields

GUIDELINES FOR TIPS:
1. Lifestyle only
2. No medicines
3. Max 10 words per tip
4. Exactly 3 tips
`;

    try {
        // ✅ إجبار الموديل يرجع JSON
        const result = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }]
                }
            ],
            generationConfig: {
                responseMimeType: "application/json"
            }
        });

        const response = await result.response;
        let text = response.text().trim();

        // ✅ تنظيف أي markdown لو ظهر
        text = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        // ✅ debugging
        console.log("AI RAW RESPONSE:", text);

        return JSON.parse(text);

    } catch (error) {
        console.error("JSON Parse Error:", error);

        return {
            error: "AI returned invalid JSON",
            aiRaw: error.message
        };
    }
}