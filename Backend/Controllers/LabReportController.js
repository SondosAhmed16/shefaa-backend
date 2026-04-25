const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { key, endpoint } = require("../config/azureConfig");

// Azure client
const client = new DocumentAnalysisClient(
    endpoint,
    new AzureKeyCredential(key)
);

// Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
        responseMimeType: "application/json"
    }
});

// Main controller
exports.analyzeReport = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        // 1) Extract text from image/pdf using Azure
        const poller = await client.beginAnalyzeDocument(
            "prebuilt-layout",
            req.file.buffer,
            {
                contentType: req.file.mimetype
            }
        );

        const result = await poller.pollUntilDone();
        const extractedText = result.content;

        console.log("AZURE RAW TEXT:", extractedText);

        // 2) Clean extracted text
        const cleanedText = cleanText(extractedText);

        console.log("CLEANED TEXT:", cleanedText);

        // 3) Send to Gemini
        const aiAnalysis = await analyzeWithAI(cleanedText);

        // 4) Return final response
        return res.status(200).json({
            success: true,
            data: aiAnalysis
        });

    } catch (err) {
        console.error("PIPELINE ERROR:", err);

        return res.status(500).json({
            success: false,
            message: "AI Analysis failed",
            error: err.message
        });
    }
};

// Clean OCR text
function cleanText(text) {
    return text
        .replace(/\n+/g, "\n")
        .replace(/[^\x00-\x7F\u0600-\u06FF0-9.%/ \n:-]/g, "")
        .trim();
}

// Gemini analysis
async function analyzeWithAI(rawText) {
    const prompt = `
Analyze the following medical lab report text and return ONLY valid JSON.

Rules:
1. Include all findings with available values.
2. Determine status based on reference range.
3. For abnormal urine findings like pus cells or RBC, explain possible causes.
4. Give a simple summary for the patient.
5. Give actionable health tips.
6. dangerScore from 0 to 10.

Lab Report Text:
${rawText}

Expected JSON format:
{
  "patientName": "string",
  "findings": [
    {
      "testName": "string",
      "result": "string or number",
      "unit": "string",
      "status": "Normal/High/Low/Abnormal",
      "interpretation": "string"
    }
  ],
  "dangerScore": 0,
  "summary": "string",
  "tips": ["string", "string", "string"]
}
`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;

        let text = response.text().trim();

        console.log("AI RAW RESPONSE:", text);

        // Remove markdown if exists
        text = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        // Parse JSON directly
        return JSON.parse(text);

    } catch (error) {
        console.error("AI PARSE ERROR:", error);

        return {
            error: "Failed to parse AI response",
            raw: rawText.substring(0, 300)
        };
    }
}