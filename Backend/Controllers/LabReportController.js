const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const { key, endpoint } = require("../config/azureConfig");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
    }
});

// ===== Helper Functions =====

function cleanText(text) {
    return text
        .replace(/\n+/g, "\n")
        .replace(/[^\x00-\x7F\u0600-\u06FF0-9.%/ \n]/g, "")
        .trim();
}

function isValidAnalysis(obj) {
    return obj &&
        Array.isArray(obj.findings) &&
        obj.findings.length > 0 &&
        typeof obj.dangerScore === "number";
}

// ===== AI Analysis =====

async function analyzeWithAI(rawText, retries = 3) {
    const prompt = `
Analyze the following medical lab report text and extract data into a STRICT JSON format.

Return ONLY valid JSON in this structure:

{
  "patientName": "string",
  "findings": [
    { 
      "testName": "string", 
      "result": "string or number", 
      "unit": "string", 
      "status": "Normal/High/Low/Abnormal",
      "interpretation": "Brief explanation"
    }
  ],
  "dangerScore": number,
  "summary": "simple explanation",
  "tips": ["string", "string", "string"]
}

Lab Report Text:
"""
${rawText}
"""
`;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;

            let text = response.text().trim();
            console.log(`AI RAW RESPONSE (attempt ${attempt}):`, text);

            const parsed = JSON.parse(text);

            if (!isValidAnalysis(parsed)) {
                throw new Error("Invalid response structure");
            }

            return parsed;

        } catch (err) {
            console.warn(`Attempt ${attempt} failed:`, err.message);

            if (attempt === retries) {
                return {
                    error: "AI failed after retries",
                    details: err.message
                };
            }

            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
}

// ===== Main Controller =====

exports.analyzeReport = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        // 1. Extract text from document via Azure
        const poller = await client.beginAnalyzeDocument(
            "prebuilt-layout",
            req.file.buffer,
            { contentType: req.file.mimetype }
        );
        const { content } = await poller.pollUntilDone();

        // 2. Clean text and analyze with AI
        const cleanedText = cleanText(content);
        const aiAnalysis = await analyzeWithAI(cleanedText);

        // 3. Return structured response
        res.status(200).json({
            success: true,
            data: aiAnalysis
        });

    } catch (err) {
        console.error("Pipeline Error:", err);
        res.status(500).json({ message: "AI Analysis failed", error: err.message });
    }
};