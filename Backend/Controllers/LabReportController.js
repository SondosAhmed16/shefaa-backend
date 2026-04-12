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
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    apiVersion: 'v1' 
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
      "dangerScore": 0-100,
      "summary": "Brief analysis in English",
      "summaryAr": "Brief analysis in Arabic",
      "tips": ["Tip 1", "Tip 2", "Tip 3"],
      "tipsAr": ["نصيحة 1", "نصيحة 2", "نصيحة 3"]
    }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    // Clean the response in case Gemini adds markdown backticks
    const text = response.text().replace(/```json|```/g, "");
    return JSON.parse(text);
}