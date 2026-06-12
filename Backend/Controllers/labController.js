const Lab = require('../Models/Labs'); 
const Service = require('../Models/Services');
const Patient = require('../Models/Patients');
const LabRequest = require('../Models/LabRequest');

// 1. جلب بيانات البروفايل وكارت الـ AI
exports.getProfile = async (req, res) => {
  try {
    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) {
      return res.status(404).json({ message: "Center profile not found" });
    }

    // تعديل صايع: نعد الخدمات الحقيقية النشطة للمعمل ده من جدول الـ Services مباشرة
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

// 2. تحديث البروفايل والسويتشات
exports.updateProfile = async (req, res) => {
  try {
    const lab = await Lab.findOne({ userId: req.user._id });
    if (!lab) return res.status(404).json({ message: "Center profile not found" });

    const {
      centerName, phone, workingHours, facilityType, paymentMethods,
      addresses, homeSampleCollection, aiRecommendations, insuranceAccepted
    } = req.body;

    if (centerName !== undefined) lab.centerName = centerName;
    if (phone !== undefined) lab.phone = phone;
    if (workingHours !== undefined) lab.workingHours = workingHours;
    if (facilityType !== undefined) lab.facilityType = facilityType;
    if (paymentMethods !== undefined) lab.paymentMethods = paymentMethods;
    if (addresses !== undefined) lab.addresses = addresses;
    if (homeSampleCollection !== undefined) lab.homeSampleCollection = homeSampleCollection;
    if (aiRecommendations !== undefined) lab.aiRecommendations = aiRecommendations;
    if (insuranceAccepted !== undefined) lab.insuranceAccepted = insuranceAccepted;

    await lab.save();
    res.json({
      success: true,
      message: "Profile updated successfully",
      updatedData: {
        centerName: lab.centerName,
        phone: lab.phone,
        workingHours: lab.workingHours,
        facilityType: lab.facilityType,
        paymentMethods: lab.paymentMethods,
        addresses: lab.addresses,
        settings: {
          homeSampleCollection: lab.homeSampleCollection,
          aiRecommendations: lab.aiRecommendations,
          insuranceAccepted: lab.insuranceAccepted
        }
      }
    });
  } catch (err) {
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
    const { name, category, price, estimatedTime, instructions, sessionDuration, imageUrl } = req.body;
    
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
exports.toggleServiceStatus = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { isActive } = req.body;

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ message: "Service not found" });

    service.isActive = isActive;
    await service.save();

    res.json({ success: true, message: `Service status updated to ${isActive}`, service });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 6. إنشاء طلب جديد برقم التليفون للمريض الأوفلاين
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

    const patient = await Patient.findOne({ phone: patientPhone });
    if (!patient) {
      return res.status(404).json({ 
        success: false, 
        message: "This phone number is not registered in Shefaa App. Please check the number or register the patient first." 
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
      message: `Request added successfully for patient (${patient.name}) and linked to Shefaa App`, 
      newRequest 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};