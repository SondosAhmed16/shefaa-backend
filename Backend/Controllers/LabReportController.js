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
        { "testName": "string", "result": "number", "unit": "string", "status": "Normal/High/Low/Pre-Risk" }
      ],
      "dangerScore": 0-100 (where 0 is perfectly healthy and 100 is a critical medical emergency requiring immediate hospitalization)",
      "summary": "Brief analysis in English",
      "tips": ["Tip 1", "Tip 2", "Tip 3"]
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

        return JSON.parse(text);
    } catch (parseError) {
        console.error("JSON Parse Error:", parseError);
        // Fallback so the server doesn't 500
        return { error: "Failed to parse AI response", raw: rawText.substring(0, 100) };
    }
}