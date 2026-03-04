const Clinic = require('../Models/Clinic');
const Doctor = require('../Models/Doctors');

const getDoctorId = async (userId) => {
    const doctor = await Doctor.findOne({ userId });
    return doctor ? doctor._id : null;
};

exports.createClinic = async (req, res) => {
    try {
        const doctorId = await getDoctorId(req.user._id);
        if (!doctorId) return res.status(404).json({ message: 'Doctor profile not found' });

        const {
            name, city, address, location,
            availableDays, daysOfWeek, dailyCapacity,
            slotDuration, capacityPerSlot, price
        } = req.body;

        const clinic = new Clinic({
            doctorId: doctorId,
            name,
            city,
            address,
            location,
            availableDays,
            daysOfWeek,
            dailyCapacity,
            slotDuration,
            capacityPerSlot,
            price
        });

        await clinic.save();
        await Doctor.findByIdAndUpdate(doctorId, {
            $push: { clinics: clinic._id }
        });

        res.status(201).json({ message: 'Clinic created successfully', clinic });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.updateClinic = async (req, res) => {
    try {
        const doctorId = await getDoctorId(req.user._id);

        const clinic = await Clinic.findOneAndUpdate(
            { _id: req.params.id, doctorId: doctorId },
            req.body,
            { new: true, runValidators: true }
        );

        if (!clinic) return res.status(404).json({ message: 'Clinic not found or not yours' });
        res.json({ message: 'Clinic updated successfully', clinic });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.deleteClinic = async (req, res) => {
    try {
        const doctorId = await getDoctorId(req.user._id);
        const clinic = await Clinic.findOneAndDelete({ _id: req.params.id, doctorId: doctorId });

        if (!clinic) return res.status(404).json({ message: 'Clinic not found' });
        res.json({ message: 'Clinic deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.getDoctorClinics = async (req, res) => {
    try {
        const doctorId = await getDoctorId(req.user._id);
        const clinics = await Clinic.find({ doctorId: doctorId });
        res.json(clinics);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
exports.getAllClinics = async (req, res) => {
    try {
        const clinics = await Clinic.find().populate('doctorId', 'specialization about');
        res.json(clinics);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

exports.getClinicById = async (req, res) => {
    try {
        const clinic = await Clinic.findById(req.params.id).populate('doctorId');
        if (!clinic) return res.status(404).json({ message: 'Clinic not found' });
        res.json(clinic);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};