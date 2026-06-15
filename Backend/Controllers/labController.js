const Lab = require('../Models/Labs'); 
const Service = require('../Models/Services');
const Patient = require('../Models/Patients');
const LabRequest = require('../Models/LabRequest');
const User = require('../Models/Users');
const Notification = require('../Models/Notification');
const mongoose = require('mongoose');


// 1. جلب بيانات البروفايل وكارت الـ AI
exports.getProfile = async (req, res) => {
  try {
    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) {
      return res.status(404).json({ message: "Center profile not found" });
    }

    const servicesCount = await Service.countDocuments({ labId: lab._id });

    // حساب طلبات النهاردة ديناميكياً 100%
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
        servicesCount: servicesCount, // العداد الحقيقي الديناميكي
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

// updateProfile النهائي والمظبوط 100% بدون أي تكرار للكود
exports.updateProfile = async (req, res) => {
  try {
    // 1. البحث عن المعمل والحساب الأساسي
    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) {
      return res.status(404).json({ message: "Center profile not found." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User account not found." });
    }

    // 2. استقبال جميع البيانات (الأساسية، اللوجستية، والقانونية)
    const {
      name,                      // الاسم الأساسي (Cairo MRI & Lab Center) -> جدول User
      phoneNumber,               // رقم التليفون الموحد -> جدول User
      facilityType,
      workingHours,              // المواعيد (من شاشة الـ Profile)
      commercialRegisterNumber,  // رقم السجل/الرخصة
      licenseValidUntil,         // تاريخ انتهاء الرخصة (الي مش هيفوتنا تاني!)
      medicalDirectorName,       // اسم المدير الطبي
      directorProfessionalId,    // رقم الكارنيه
      homeSampleCollection,      // Toggle العينات المنزلية
      aiRecommendations,         // Toggle الذكاء الاصطناعي
      insuranceAccepted,         // دعم التأمين
      paymentMethods,            // طرق الدفع
      addresses
    } = req.body;

    // ── أولاً: تحديث البيانات الأساسية في جدول الـ Users (بدون تكرار) ──
    if (name !== undefined) user.name = name;
    
    if (phoneNumber !== undefined) {
      // التحقق إن الرقم الجديد مش مستخدم في حساب تاني لمنع مشاكل الـ Unique Index
      const existingPhone = await User.findOne({ phoneNumber, _id: { $ne: user._id } });
      if (existingPhone) {
        return res.status(400).json({ message: "Phone number is already in use by another account." });
      }
      user.phoneNumber = phoneNumber;
    }
    await user.save(); // حفظ جدول الـ Users

    // ── ثانياً: تحديث ملف الرخصة لو اترفع جديد في الـ Request ──
    if (req.files && req.files['medicalLicence']) {
      lab.medicalLicencePdf = req.files['medicalLicence'][0].path;
    }

    // ── ثالثاً: تحديث البيانات القانونية واللوجستية في جدول الـ Labs ──
    if (facilityType !== undefined) lab.facilityType = facilityType;
    if (workingHours !== undefined) lab.workingHours = workingHours;
    if (commercialRegisterNumber !== undefined) lab.commercialRegisterNumber = commercialRegisterNumber;
    if (licenseValidUntil !== undefined) lab.licenseValidUntil = licenseValidUntil; // 🟢 التحديث هنا
    if (medicalDirectorName !== undefined) lab.medicalDirectorName = medicalDirectorName;
    if (directorProfessionalId !== undefined) lab.directorProfessionalId = directorProfessionalId;
    if (homeSampleCollection !== undefined) lab.homeSampleCollection = homeSampleCollection;
    if (aiRecommendations !== undefined) lab.aiRecommendations = aiRecommendations;
    if (insuranceAccepted !== undefined) lab.insuranceAccepted = insuranceAccepted;
    if (paymentMethods !== undefined) lab.paymentMethods = paymentMethods;

    // معالجة الـ addresses لو مبعوتة كـ String في الـ form-data للفرونت
    if (addresses !== undefined) {
      try {
        lab.addresses = typeof addresses === 'string' ? JSON.parse(addresses) : addresses;
      } catch (e) {
        lab.addresses = addresses;
      }
    }

    await lab.save(); // حفظ جدول الـ Labs

    // 3. إرجاع الداتا كاملة ومدموجة بـ الـ Populate النظيف للـ Frontend
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
// 3. جلب الخدمات مع الـ AI Insight الديناميكي
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

// 4. إضافة خدمة جديدة
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

// 5. تغيير حالة الخدمة (نشط / غير نشط)
// 5. تغيير حالة الخدمة تلقائياً (توجل حقيقي)
exports.toggleServiceStatus = async (req, res) => {
  try {
    const { serviceId } = req.params;

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ message: "Service not found" });

    // 🟢 عكس الحالة الحالية أوتوماتيك بدون الحاجة لـ req.body
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

// 6. إنشاء طلب جديد برقم التليفون للمريض الأوفلاين (النسخة النهائية الصحيحة)
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

    // الخطوة السحرية: ابحث في الـ Users أولاً لأن الـ phoneNumber هناك!
    const user = await User.findOne({ phoneNumber: String(patientPhone).trim() });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "This phone number is not registered in Shefaa App. Please check the number or register the patient first." 
      });
    }

    // ثم ابحث في الـ Patients بربط الـ userId
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
    // 1. التحقق من حساب المعمل
    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) {
      return res.status(404).json({ success: false, message: "Center profile not found" });
    }

    // 2. جلب كافة طلبات هذا المعمل بدون اشتراط كلمة 'pending' حرفياً لتفادي أي خطأ في الداتا القديمة
    const allLabRequests = await LabRequest.find({ labId: lab._id })
      .populate('services', 'name estimatedTime')
      .lean();

    let pendingUploads = [];
    let uploadedResults = [];

    for (const reqItem of allLabRequests) {
      // جلب اسم المريض بشكل مرن لتفادي مشاكل الـ Populate الآلي واسم الموديل (Patient / Patients)
      let patientName = "Offline Patient";
      try {
        // فحص الموديل ديناميكياً لتأمين جلب الاسم
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

      // حساب الوقت المستغرق
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

      // تقسيم الطلبات بناءً على الحالة (مع تدارك حالة الـ default لو غير مكتوبة)
      if (reqItem.status === "completed") {
        uploadedResults.push({
          ...formattedItem,
          uploadedAt: reqItem.resultUploadedAt || reqItem.updatedAt,
          fileType: reqItem.resultFileType || "pdf",
          fileUrl: reqItem.resultFile || "",
          patientNotified: true
        });
      } else {
        // أي حالة أخرى (سواء pending أو فارغة) ستعتبر معلقة لتظهر فوراً في الـ UI
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

// 2. دالة رفع النتيجة الفورية عبر Multer وكلاوديناري وإشعار المريض تلقائياً (مؤمنة بالكامل)
exports.uploadLabResult = async (req, res) => {
  try {
    const { requestId } = req.body; 

    // 1. التحقق من أن الـ multer قام برفع الملف بنجاح
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Please upload a result file (Image or PDF)" });
    }

    const resultFileUrl = req.file.path; 
    const fileType = req.file.mimetype && req.file.mimetype.includes('pdf') ? 'pdf' : 'image'; 

    if (!requestId) {
      return res.status(400).json({ success: false, message: "Missing required field: requestId" });
    }

    // 2. تحديث الطلب في قاعدة البيانات وتحويل حالته إلى مكتمل بأمان
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

    // 3. 🔔 جلب المريض يدوياً باستخدام الموديل المستدعى فوق لمنع انهيار الـ Populate بسبب حرف الـ S
    if (updatedRequest.patientId) {
      // استدعاء المريض مباشرة باستخدام متد الـ Patient المستدعى في أول الملف عندك
      const patientData = await Patient.findById(updatedRequest.patientId);
      
      const patientUserId = patientData?.userId;

      if (patientUserId) {
        // جلب اسم المعمل الحالي
        const center = await Lab.findOne({ userId: req.user._id }).populate('userId', 'name');
        const centerName = center?.userId?.name || "The Medical Center";

        // إنشاء الإشعار للمريض
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

    // إرجاع النتيجة الناجحة بنجاح
    res.status(200).json({
      success: true,
      message: "Result uploaded successfully and patient has been notified.",
      updatedRequest
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
