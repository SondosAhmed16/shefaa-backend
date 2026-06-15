const Lab = require('../Models/Labs'); 
const Service = require('../Models/Services');
const Patient = require('../Models/Patients');
const LabRequest = require('../Models/LabRequest');
const User = require('../Models/Users');


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

// 6. إنشاء طلب جديد برقم التليفون للمريض الأوفلاين (النسخة الصحيحة والنهائية)
exports.createRequest = async (req, res) => {
  try {
    const { patientPhone, serviceIds, viaAI } = req.body; 

    // 1. التحقق من المدخلات الأساسية
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

    // 2. البحث عن المستخدم في جدول Users أولاً باستخدام رقم الهاتف الصحيح
    const user = await User.findOne({ phoneNumber: String(patientPhone).trim() });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "This phone number is not registered in Shefaa App. Please check the number or register the patient first." 
      });
    }

    // 3. البحث عن الملف الطبي للمريض في جدول Patients باستخدام الـ userId الخاص بالحساب المكتشف
    const patient = await Patient.findOne({ userId: user._id });
    if (!patient) {
      return res.status(404).json({ 
        success: false, 
        message: "The user account exists, but no active patient profile was found associated with it." 
      });
    }

    // 4. التحقق من وجود المعمل/المركز الطبي الذي يرسل الطلب حالياً
    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) {
      return res.status(404).json({ success: false, message: "Center not found" });
    }

    // 5. إنشاء الطلب وربطه بـ id المريض الصحيح
    const newRequest = new LabRequest({
      labId: lab._id,
      patientId: patient._id, 
      services: serviceIds,
      viaAI: viaAI || false
    });

    await newRequest.save();

    // إرجاع استجابة ناجحة بالاسم المستخرج من جدول الـ User مباشرة
    res.status(201).json({ 
      success: true,
      message: `Request added successfully for patient (${user.name}) and linked to Shefaa App`, 
      newRequest 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};