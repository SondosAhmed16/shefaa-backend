const Lab = require('../Models/Labs');
const Service = require('../Models/Services');
const Patient = require('../Models/Patients');
const LabRequest = require('../Models/LabRequest');
const User = require('../Models/Users');
const Notification = require('../Models/Notification');
const mongoose = require('mongoose');


exports.getProfile = async (req, res) => {
  try {
    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) {
      return res.status(404).json({ message: "Center profile not found" });
    }

    const servicesCount = await Service.countDocuments({ labId: lab._id });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const todaysRequestsCount = await LabRequest.countDocuments({
      labId: lab._id,
      createdAt: { $gte: startOfToday, $lte: endOfToday }
    });

    let aiStatus = lab.aiRecommendations ? "Active" : "Inactive";
    let rankingText = "Turn on AI recommendations to see your local ranking";

    if (lab.aiRecommendations) {
      let rank = 3;
      if (lab.rating >= 4.8) rank = 1;
      else if (lab.rating >= 4.5) rank = 2;

      if (lab.facilityType === "both") {
        rankingText = `Ranking #${rank} for Radiology · #${rank + 1} for Lab in your zone`;
      } else if (lab.facilityType === "radiology center") {
        rankingText = `Ranking #${rank} for Radiology in your zone`;
      } else {
        rankingText = `Ranking #${rank} for Lab Tests in your zone`;
      }
    }

    let referralsText = "0 requests recorded today";
    if (todaysRequestsCount > 0) {
      referralsText = `${todaysRequestsCount} patients processed today via system`;
    }

    res.json({
      success: true,
      profileData: {
        id: lab._id,
        centerName: lab.centerName,
        phone: lab.phone,
        facilityType: lab.facilityType,
        workingHours: lab.workingHours,
        rating: lab.rating,
        servicesCount: servicesCount,
        paymentMethods: lab.paymentMethods,
        licenseNumber: lab.licenseNumber,
        licenseValidUntil: lab.licenseValidUntil,
        addresses: lab.addresses,
        aiVisibility: {
          status: aiStatus,
          text: rankingText,
          referrals: referralsText
        },
        settings: {
          homeSampleCollection: lab.homeSampleCollection,
          aiRecommendations: lab.aiRecommendations,
          insuranceAccepted: lab.insuranceAccepted
        },
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) {
      return res.status(404).json({ message: "Center profile not found." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User account not found." });
    }

    const {
      name,
      phoneNumber,
      facilityType,
      workingHours,
      commercialRegisterNumber,
      licenseValidUntil,
      medicalDirectorName,
      directorProfessionalId,
      homeSampleCollection,
      aiRecommendations,
      insuranceAccepted,
      paymentMethods,
      addresses
    } = req.body;

    if (name !== undefined) user.name = name;

    if (phoneNumber !== undefined) {
      const existingPhone = await User.findOne({ phoneNumber, _id: { $ne: user._id } });
      if (existingPhone) {
        return res.status(400).json({ message: "Phone number is already in use by another account." });
      }
      user.phoneNumber = phoneNumber;
    }
    await user.save();

    if (req.files && req.files['medicalLicence']) {
      lab.medicalLicencePdf = req.files['medicalLicence'][0].path;
    }

    if (facilityType !== undefined) lab.facilityType = facilityType;
    if (workingHours !== undefined) lab.workingHours = workingHours;
    if (commercialRegisterNumber !== undefined) lab.commercialRegisterNumber = commercialRegisterNumber;
    if (licenseValidUntil !== undefined) lab.licenseValidUntil = licenseValidUntil;
    if (medicalDirectorName !== undefined) lab.medicalDirectorName = medicalDirectorName;
    if (directorProfessionalId !== undefined) lab.directorProfessionalId = directorProfessionalId;
    if (homeSampleCollection !== undefined) lab.homeSampleCollection = homeSampleCollection;
    if (aiRecommendations !== undefined) lab.aiRecommendations = aiRecommendations;
    if (insuranceAccepted !== undefined) lab.insuranceAccepted = insuranceAccepted;
    if (paymentMethods !== undefined) lab.paymentMethods = paymentMethods;

    if (addresses !== undefined) {
      try {
        lab.addresses = typeof addresses === 'string' ? JSON.parse(addresses) : addresses;
      } catch (e) {
        lab.addresses = addresses;
      }
    }

    await lab.save();

    const updatedProfile = await Lab.findOne({ userId: user._id })
      .populate('userId', 'name email phoneNumber role');

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      profileData: updatedProfile
    });

  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        message: "This commercial register number or phone is already registered.",
        field: err.keyValue
      });
    }
    res.status(500).json({ message: err.message });
  }
};
exports.getServices = async (req, res) => {
  try {
    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) return res.status(404).json({ message: "Lab not found" });

    const { search } = req.query;
    let searchQuery = { labId: lab._id };
    if (search) searchQuery.name = { $regex: search, $options: 'i' };

    const services = await Service.find(searchQuery);

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const weeklyRequests = await LabRequest.find({
      labId: lab._id,
      createdAt: { $gte: oneWeekAgo }
    }).populate('services');

    let serviceCounts = {};
    let totalServicesCount = 0;

    weeklyRequests.forEach(req => {
      req.services.forEach(service => {
        if (service) {
          serviceCounts[service.name] = (serviceCounts[service.name] || 0) + 1;
          totalServicesCount++;
        }
      });
    });

    const sortedServices = Object.entries(serviceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    let aiInsightText = "No requests recorded this week to generate AI insights.";
    if (sortedServices.length > 0) {
      const insightParts = sortedServices.map(([name, count]) => {
        const percentage = Math.round((count / totalServicesCount) * 100);
        return `${name} (${percentage}%)`;
      });
      aiInsightText = `${insightParts.join(', ')} — Most requested this week.`;
    }

    const responseData = {
      labTests: lab.facilityType === 'lab' || lab.facilityType === 'both' ? services.filter(s => s.category === 'test') : [],
      radiology: lab.facilityType === 'radiology center' || lab.facilityType === 'both' ? services.filter(s => s.category === 'scan') : []
    };

    res.json({ success: true, facilityType: lab.facilityType, aiInsight: aiInsightText, data: responseData });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.addService = async (req, res) => {
  try {
    const { name, category, price, estimatedTime, instructions, sessionDuration } = req.body;
    const imageUrl = req.file ? req.file.path : undefined;
    if (!name || !price || !category || !estimatedTime) {
      return res.status(400).json({ message: 'Required fields are missing' });
    }

    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) return res.status(404).json({ message: "Center not found" });

    const newService = new Service({
      labId: lab._id,
      name,
      category,
      price,
      estimatedTime,
      instructions: category === 'test' ? instructions : undefined,
      sessionDuration: category === 'scan' ? sessionDuration : undefined,
      imageUrl: category === 'scan' ? imageUrl : undefined
    });

    await newService.save();

    lab.tests.push(newService._id);
    await lab.save();

    res.status(201).json({ message: 'Service added successfully', newService });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


exports.toggleServiceStatus = async (req, res) => {
  try {
    const { serviceId } = req.params;

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ message: "Service not found" });

    service.isActive = !service.isActive;
    await service.save();

    res.json({
      success: true,
      message: `Service status updated to ${service.isActive}`,
      service
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createRequest = async (req, res) => {
  try {
    const { patientPhone, serviceIds, viaAI } = req.body;

    if (!patientPhone) {
      return res.status(400).json({
        success: false,
        message: "Patient phone number is required to link this request with Shefaa App"
      });
    }

    if (!serviceIds || serviceIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one service/test"
      });
    }

    const user = await User.findOne({ phoneNumber: String(patientPhone).trim() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "This phone number is not registered in Shefaa App. Please check the number or register the patient first."
      });
    }

    const patient = await Patient.findOne({ userId: user._id });
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "The user account exists, but no active patient profile was found associated with it."
      });
    }

    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) {
      return res.status(404).json({ success: false, message: "Center not found" });
    }

    const newRequest = new LabRequest({
      labId: lab._id,
      patientId: patient._id,
      services: serviceIds,
      viaAI: viaAI || false
    });

    await newRequest.save();

    res.status(201).json({
      success: true,
      message: `Request added successfully for patient (${user.name}) and linked to Shefaa App`,
      newRequest
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getLabResultsDashboard = async (req, res) => {
  try {
    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) {
      return res.status(404).json({ success: false, message: "Center profile not found" });
    }

    const allLabRequests = await LabRequest.find({ labId: lab._id })
      .populate('services', 'name estimatedTime')
      .lean();

    let pendingUploads = [];
    let uploadedResults = [];

    for (const reqItem of allLabRequests) {
      let patientName = "Offline Patient";
      try {
        const PatientModel = mongoose.models.Patient || mongoose.models.Patients;
        if (PatientModel && reqItem.patientId) {
          const patientData = await PatientModel.findById(reqItem.patientId).populate("userId", "name");
          if (patientData && patientData.userId) {
            patientName = patientData.userId.name;
          }
        }
      } catch (err) {
        console.log("Patient populate error:", err.message);
      }

      let maxHours = 24;
      if (reqItem.services && reqItem.services.length > 0) {
        reqItem.services.forEach(service => {
          const hours = parseInt(service.estimatedTime) || 24;
          if (hours > maxHours) maxHours = hours;
        });
      }

      const expectedDelivery = new Date(reqItem.createdAt || new Date());
      expectedDelivery.setHours(expectedDelivery.getHours() + maxHours);

      const formattedItem = {
        requestId: reqItem._id,
        refCode: `REF-${String(reqItem._id).substring(18).toUpperCase()}`,
        patientName: patientName,
        services: reqItem.services ? reqItem.services.map(s => s.name) : [],
        createdAt: reqItem.createdAt,
        expectedDelivery: expectedDelivery
      };

      if (reqItem.status === "completed") {
        uploadedResults.push({
          ...formattedItem,
          uploadedAt: reqItem.resultUploadedAt || reqItem.updatedAt,
          fileType: reqItem.resultFileType || "pdf",
          fileUrl: reqItem.resultFile || "",
          patientNotified: true
        });
      } else {
        pendingUploads.push(formattedItem);
      }
    }

    res.status(200).json({
      success: true,
      pendingCount: pendingUploads.length,
      uploadedCount: uploadedResults.length,
      pendingUploads: pendingUploads,
      uploadedResults: uploadedResults
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.uploadLabResult = async (req, res) => {
  try {
    const { requestId } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "Please upload a result file (Image or PDF)" });
    }

    const resultFileUrl = req.file.path;
    const fileType = req.file.mimetype && req.file.mimetype.includes('pdf') ? 'pdf' : 'image';

    if (!requestId) {
      return res.status(400).json({ success: false, message: "Missing required field: requestId" });
    }

    const updatedRequest = await LabRequest.findByIdAndUpdate(
      requestId,
      {
        status: "completed",
        resultFile: resultFileUrl,
        resultFileType: fileType,
        resultUploadedAt: new Date()
      },
      { new: true }
    );

    if (!updatedRequest) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    if (updatedRequest.patientId) {
      const patientData = await Patient.findById(updatedRequest.patientId);

      const patientUserId = patientData?.userId;

      if (patientUserId) {
        const center = await Lab.findOne({ userId: req.user._id }).populate('userId', 'name');
        const centerName = center?.userId?.name || "The Medical Center";

        const newNotification = new Notification({
          recipient: patientUserId,
          title: "Medical Result Available! 📄",
          message: `Your test results from ${centerName} have been uploaded successfully. You can now view or download them from your profile.`,
          type: "lab_result",
          relatedId: updatedRequest._id
        });

        await newNotification.save();
      }
    }

    res.status(200).json({
      success: true,
      message: "Result uploaded successfully and patient has been notified.",
      updatedRequest
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.updateNotificationSettings = async (req, res) => {
  try {
    const { newBookings, resultDeadlines, systemAlerts } = req.body;

    const updatedLab = await Lab.findOneAndUpdate(
      { userId: req.user._id },
      {
        $set: {
          "notificationSettings.newBookings": newBookings,
          "notificationSettings.resultDeadlines": resultDeadlines,
          "notificationSettings.systemAlerts": systemAlerts
        }
      },
      { new: true, select: 'notificationSettings' }
    );

    if (!updatedLab) {
      return res.status(404).json({ success: false, message: "Center profile not found" });
    }

    res.status(200).json({
      success: true,
      message: "Notification settings updated successfully.",
      settings: updatedLab.notificationSettings
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};



exports.getLabDashboardForUI = async (req, res) => {
  try {
    const lab = await Lab.findOne({ userId: req.user._id }).populate('userId', 'name');
    if (!lab) {
      return res.status(404).json({ success: false, message: "Lab profile not found" });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const now = new Date();

    const allLabRequests = await LabRequest.find({ labId: lab._id })
      .populate({
        path: 'patientId',
        model: 'Patient',
        populate: { path: 'userId', model: 'User', select: 'name' }
      })
      .populate('services', 'name estimatedTime')
      .sort({ createdAt: -1 })
      .lean();


    const todaysRequestsCount = allLabRequests.filter(reqItem =>
      reqItem.createdAt >= startOfToday && reqItem.createdAt <= endOfToday
    ).length;

    const completedTodayCount = allLabRequests.filter(reqItem =>
      reqItem.status === 'completed' &&
      reqItem.resultUploadedAt >= startOfToday &&
      reqItem.resultUploadedAt <= endOfToday
    ).length;

    let timeoutPatientsList = [];

    const pendingRequests = allLabRequests.filter(reqItem => reqItem.status === 'pending');

    pendingRequests.forEach(reqItem => {
      let maxHours = 0;
      if (reqItem.services && reqItem.services.length > 0) {
        reqItem.services.forEach(s => {
          const hours = parseInt(s.estimatedTime) || 24;
          if (hours > maxHours) maxHours = hours;
        });
      }

      const expectedDelivery = new Date(reqItem.createdAt);
      expectedDelivery.setHours(expectedDelivery.getHours() + maxHours);

      if (now > expectedDelivery) {
        timeoutPatientsList.push({
          requestId: reqItem._id,
          patientName: reqItem.patientId?.userId?.name || "Offline Patient",
          tests: reqItem.services ? reqItem.services.map(s => s.name).join(', ') : "Medical Analysis"
        });
      }
    });

    const timeoutRequestsCount = timeoutPatientsList.length;


    const todaysRequestsList = allLabRequests
      .filter(reqItem => reqItem.createdAt >= startOfToday && reqItem.createdAt <= endOfToday)
      .map(reqItem => {
        const bookingTime = new Date(reqItem.createdAt).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit'
        });

        return {
          ref: reqItem._id.toString().substring(reqItem._id.toString().length - 6).toUpperCase(),
          patientName: reqItem.patientId?.userId?.name || "Offline Patient",
          analysisName: reqItem.services ? reqItem.services.map(s => s.name).join(', ') : "General Test",
          bookedAt: bookingTime,
          status: reqItem.status
        };
      });


    const resultsUploadedTodayList = allLabRequests
      .filter(reqItem =>
        reqItem.status === 'completed' &&
        reqItem.resultUploadedAt >= startOfToday &&
        reqItem.resultUploadedAt <= endOfToday
      )
      .map(reqItem => {
        const uploadTime = new Date(reqItem.resultUploadedAt).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit'
        });

        return {
          patientName: reqItem.patientId?.userId?.name || "Offline Patient",
          analysisName: reqItem.services ? reqItem.services.map(s => s.name).join(', ') : "General Test",
          uploadedAt: uploadTime,
          patientNotified: true
        };
      });

    res.status(200).json({
      success: true,
      labName: lab.userId?.name || "Your Lab Center",
      stats: {
        todaysRequests: todaysRequestsCount,
        completedToday: completedTodayCount,
        timeoutRequests: timeoutRequestsCount,
        timeoutPatients: timeoutPatientsList
      },
      todaysRequests: todaysRequestsList,
      resultsUploadedToday: resultsUploadedTodayList
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
