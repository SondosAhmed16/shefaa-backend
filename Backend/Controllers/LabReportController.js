const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const { key, endpoint } = require("../config/azureConfig");

const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));

exports.analyzeReport = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });
        const poller = await client.beginAnalyzeDocument("prebuilt-layout", req.file.buffer);
        const { content, tables } = await poller.pollUntilDone();
        res.status(200).json({
            success: true,
            extractedText: content, 
            tableData: tables      
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};