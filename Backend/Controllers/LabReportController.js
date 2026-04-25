const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const { AzureOpenAI } = require("openai");
const { key, endpoint, openAIKey, openAIEndpoint } = require("../config/azureConfig");

const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));

const openaiClient = new AzureOpenAI({
    endpoint: openAIEndpoint,
    apiKey: openAIKey,
    apiVersion: "2024-02-01",
    deployment: "gpt-4o"
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
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await openaiClient.chat.completions.create({
                model: "gpt-4o-mini",
                temperature: 0.1,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: `You are a medical lab report analyzer. 
Always respond with valid JSON only in this structure:
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
}`
                    },
                    {
                        role: "user",
                        content: `Analyze this lab report:\n"""\n${rawText}\n"""`
                    }
                ]
            });

            console.log(`AI RAW RESPONSE (attempt ${attempt}):`, result.choices[0].message.content);

            const parsed = JSON.parse(result.choices[0].message.content);

            if (!isValidAnalysis(parsed)) {
                throw new Error("Invalid response structure");
            }

            return parsed;

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

exports.analyzeReport = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const poller = await client.beginAnalyzeDocument(
            "prebuilt-layout",
            req.file.buffer,
            { contentType: req.file.mimetype }
        );
        const { content } = await poller.pollUntilDone();

        const cleanedText = cleanText(content);
        const aiAnalysis = await analyzeWithAI(cleanedText);

        res.status(200).json({
            success: true,
            data: aiAnalysis
        });

    } catch (err) {
        console.error("Pipeline Error:", err);
        res.status(500).json({ message: "AI Analysis failed", error: err.message });
    }
};