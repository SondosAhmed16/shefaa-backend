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
const model = genAI.getGenerativeModel({
    model: "gemini-1.0-pro"
});

const model = genAI.getGenerativeModel({
    model: "gemini-1.0-pro"
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
- Output MUST be pure JSON
- No markdown
- No extra text
- Always include all fields
`;

    try {
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

        text = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        console.log("AI RAW RESPONSE:", text);

        let parsed;

        try {
            parsed = JSON.parse(text);
        } catch (e) {
            return {
                error: "Invalid JSON from AI",
                raw: text
            };
        }

        if (!parsed.patientName || !parsed.findings) {
            return {
                error: "Incomplete AI response",
                raw: parsed
            };
        }

        return parsed;

    } catch (error) {
        return {
            error: "AI processing failed",
            details: error.message
        };
    }
}