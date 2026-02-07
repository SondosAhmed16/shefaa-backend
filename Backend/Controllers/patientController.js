const Patient = require('../Models/Patients');
const Appointment = require('../Models/Appointment');
const MedicalRecord = require('../Models/MedicalRecord');

const getPatientByUserId = async (userId) => {
    return await Patient.findOne({ userId: userId });
};

exports.getProfile = async (req, res) => {
  try {
    const patient = await Patient.findOne({ userId: req.user._id }).populate('userId', 'name email');
    if (!patient) return res.status(404).json({ message: 'Patient profile not found' });
    res.json(patient);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    // إضافة height و weight للبيانات المستلمة
    const { address, phoneNumber, age, gender, bloodType, allergies, height, weight } = req.body;
    
    const patient = await Patient.findOneAndUpdate(
      { userId: req.user._id },
      { address, phoneNumber, age, gender, bloodType, allergies, height, weight },
      { new: true, runValidators: true }
    );

    if (!patient) return res.status(404).json({ message: 'Patient not found' });
    res.json({ message: 'Profile updated successfully', patient });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAppointments = async (req, res) => {
  try {
    const patient = await getPatientByUserId(req.user._id);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    // البحث بـ patient._id مش req.user._id
    const appointments = await Appointment.find({ patient: patient._id })
      .populate('doctor clinic')
      .sort({ date: -1 });
    
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.uploadAttachment = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    
    const patient = await getPatientByUserId(req.user._id);
    
    const record = await MedicalRecord.create({
      patientId: patient._id,
      doctorId: req.body.doctorId || null, 
      diagnosis: req.body.diagnosis || 'Self-uploaded attachment',
      attachments: [{
        fileName: req.file.originalname,
        fileUrl: req.file.path // رابط كلوديناري
      }],
      visitDate: new Date(),
      notes: req.body.notes || 'Uploaded by patient'
    });

    res.json({ message: 'File uploaded successfully to Cloudinary', fileUrl: req.file.path, record });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMedicalHistory = async (req, res) => {
  try {
    const patient = await getPatientByUserId(req.user._id);
    if (!patient) return res.status(404).json({ message: 'Patient not found' });

    const records = await MedicalRecord.find({ patientId: patient._id })
      .populate('doctorId', 'name'); // بنجيب اسم الدكتور
    
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};