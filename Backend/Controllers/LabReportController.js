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
//new
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

async function analyzeWithAI(rawText) {
    // ✅ تقليل الحجم
    const MAX_LENGTH = 5000;
    rawText = rawText.slice(0, MAX_LENGTH);

    const prompt = `
You are a medical lab expert...

Return ONLY valid JSON...
`;

    try {
        console.log("AI started");

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
            return { error: "Invalid JSON from AI", raw: text };
        }

        if (!parsed.patientName || !parsed.findings) {
            return { error: "Incomplete AI response", raw: parsed };
        }

        return parsed;

    } catch (error) {
        return {
            error: "AI processing failed",
            details: error.message
        };
    }
}