const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { key, endpoint } = require("../config/azureConfig");

const client = new DocumentAnalysisClient(
    endpoint,
    new AzureKeyCredential(key)
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
        responseMimeType: "application/json"
    }
});

exports.analyzeReport = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        // 1. Extract text from Azure OCR
        const poller = await client.beginAnalyzeDocument(
            "prebuilt-layout",
            req.file.buffer,
            {
                contentType: req.file.mimetype
            }
        );

        const { content } = await poller.pollUntilDone();

        // 2. Clean OCR text
        const cleanedText = cleanText(content);

        // 3. Analyze with Gemini
        const aiAnalysis = await analyzeWithAI(cleanedText);

        // 4. Return response
        return res.status(200).json({
            success: true,
            data: aiAnalysis
        });

    } catch (err) {
        console.error("Pipeline Error:", err);

        return res.status(500).json({
            success: false,
            message: "AI analysis failed",
            error: err.message
        });
    }
};

function cleanText(text) {
    return text
        .replace(/\n+/g, "\n")
        .replace(/[^\x00-\x7F\u0600-\u06FF0-9.%/ \n:-]/g, "")
        .trim();
}

async function analyzeWithAI(rawText) {
    const prompt = `
Analyze the following medical lab report text.

Return ONLY valid JSON in this exact structure:

{
  "patientName": "string",
  "findings": [
    {
      "testName": "string",
      "result": "string or number",
      "unit": "string",
      "status": "Normal/High/Low/Abnormal",
      "interpretation": "brief explanation"
    }
  ],
  "dangerScore": number,
  "summary": "simple explanation",
  "tips": ["tip1", "tip2", "tip3"]
}

Rules:
- Include all test results.
- Use reference ranges to determine status.
- Non numeric abnormal values should be "Abnormal".
- dangerScore from 0 to 10.
- Return JSON only.

Lab Report Text:
${rawText}
`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text().trim();

        // remove accidental markdown
        text = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        console.log("AI RAW RESPONSE:", text);

        try {
            return JSON.parse(text);
        } catch (parseErr) {
            console.error("JSON Parse Error:", parseErr);

            return {
                error: "Invalid JSON returned from AI",
                raw: text.substring(0, 500)
            };
        }

    } catch (err) {
        console.error("Gemini Error:", err);

        return {
            error: "AI processing failed",
            details: err.message
        };
    }
}