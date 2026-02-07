const Lab = require('../Models/Labs'); // تأكد من اسم الملف Labs.js
const LabTest = require('../Models/LabTest');
const MedicalRecord = require('../Models/MedicalRecord');
const Patient = require('../Models/Patients');

exports.getTests = async (req, res) => {
  try {
    const labId = req.user._id;
    const tests = await LabTest.find({ labId });
    res.json(tests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addTest = async (req, res) => {
  try {
    const { testName, price, estimatedTime } = req.body;
    if (!testName || !price)
      return res.status(400).json({ message: 'Test name and price are required' });

    const labId = req.user._id;
    const newTest = new LabTest({ labId, testName, price, estimatedTime });
    await newTest.save();

    res.status(201).json({ message: 'Lab test added successfully', newTest });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 📤 رفع نتيجة تحليل (Cloudinary)
exports.uploadResult = async (req, res) => {
  try {
    const { patientId, testName } = req.body; // يفضل نبعت اسم التحليل أو الـ ID
    
    if (!req.file)
      return res.status(400).json({ message: 'No file uploaded' });

    // اللينك اللي جاي من Cloudinary
    const fileUrl = req.file.path; 
    const fileName = req.file.originalname || "Lab Result";

   
    const record = new MedicalRecord({
      patientId,
      doctorId: null, 
      diagnosis: `Lab Test Result: ${testName || 'General Analysis'}`,
      notes: 'Lab result uploaded via Cloudinary',
      attachments: [{
        fileName: fileName,
        fileUrl: fileUrl, 
        uploadedAt: new Date()
      }],
      visitDate: new Date(),
    });

    await record.save();

    res.json({ 
      message: 'Result uploaded successfully to Cloudinary', 
      fileUrl: fileUrl,
      record 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.getPatientResults = async (req, res) => {
  try {
    const { patientId } = req.params;
    const records = await MedicalRecord.find({ patientId })
      .select('diagnosis notes attachments visitDate')
      .sort({ visitDate: -1 });

    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};