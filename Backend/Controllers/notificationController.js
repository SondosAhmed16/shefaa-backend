const Notification = require('../Models/Notification');
const LabRequest = require('../Models/LabRequest');
const Lab = require('../Models/Labs');

exports.getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ message: "Notification marked as read" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getNotificationsForUI = async (req, res) => {
  try {
    const allNotifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 });

    const unreadCount = allNotifications.filter(n => !n.isRead).length;


    const notificationsGrouped = {
      unreadCount: unreadCount,
      new: allNotifications.filter(n => !n.isRead),
      earlier: allNotifications.filter(n => n.isRead)
    };

    res.status(200).json(notificationsGrouped);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );
    res.status(200).json({ message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 1. الدالة المخصصة والمنفصلة كلياً لإشعارات المعمل باللغة الإنجليزية 🇬🇧
exports.getLabNotificationsForUI = async (req, res) => {
  try {
    // A) جلب إشعارات المعمل الأساسية المسجلة من الداتابيز مرتبة من الأحدث
    const allNotifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    // B) حساب عدد الإشعارات الأساسية غير المقروءة لتظهر في العداد 🔢
    const unreadCount = allNotifications.filter(n => !n.isRead).length;

    // C) جلب بروفايل المعمل الحالي لمعالجة تنبيهات الـ Deadline ديناميكياً
    const lab = await Lab.findOne({ userId: req.user._id });
    
    let timeOutAlerts = [];

    if (lab) {
      // جلب الطلبات المعلقة (pending) فقط عشان نحسب وقت تسليمها المتوقع
      const pendingRequests = await LabRequest.find({ labId: lab._id, status: "pending" })
        .populate({
          path: 'patientId',
          model: 'Patients', 
          populate: { path: 'userId', model: 'User', select: 'name' }
        })
        .populate('services', 'name estimatedTime')
        .lean();

      const now = new Date();

      pendingRequests.forEach(reqItem => {
        // 🧠 الحسبة الذكية لأطول مده: نأخذ أقصى عدد ساعات بين الخدمات المطلوبة في الطلب
        let maxHours = 0;
        if (reqItem.services && reqItem.services.length > 0) {
          reqItem.services.forEach(service => {
            const hours = parseInt(service.estimatedTime) || 24; // افتراضي 24 ساعة لو لم يحدد وقت
            if (hours > maxHours) maxHours = hours;
          });
        }

        // حساب تاريخ وقت التسليم المتوقع بناءً على أطول مدة (maxHours) ⏱️
        const expectedDelivery = new Date(reqItem.createdAt);
        expectedDelivery.setHours(expectedDelivery.getHours() + maxHours);

        // 🚨 إذا تخطى الوقت الحالي موعد التسليم والنتيجة لسه pending -> توليد تنبيه فوري بالإنجليزية
        if (now > expectedDelivery) {
          const patientName = reqItem.patientId?.userId?.name || "Offline Patient";
          const servicesNames = reqItem.services ? reqItem.services.map(s => s.name).join(', ') : "Tests";

          timeOutAlerts.push({
            _id: `timeout-${reqItem._id}`, // معرف فريد ومميز للفرونت إند
            title: "Analysis Timeout Alert! ⚠️",
            message: `The expected delivery time for patient (${patientName}) tests (${servicesNames}) has ended. Please upload the results immediately.`,
            type: "timeout_alert",
            isRead: false,
            createdAt: expectedDelivery, // تاريخ التنبيه هو نفس وقت انتهاء الصلاحية للترتيب التاريخي
            details: {
              patientName,
              servicesNames,
              maxHoursCalculated: maxHours,
              isHomeVisit: reqItem.viaAI || false 
            }
          });
        }
      });
    }

    // D) دمج الإشعارات القادمة من قاعدة البيانات مع تنبيهات انتهاء الوقت الفورية
    const combinedNotifications = [...timeOutAlerts, ...allNotifications];

    // ترتيب الدمج النهائي تنازلياً (الأحدث دائماً فوق) لراحة المستخدم في الـ UI
    combinedNotifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // E) تقسيم وتنسيق الداتا لـ (New) و (Earlier) بالظبط لتطابق كروت وتصميم الـ UI 📋
    const notificationsGrouped = {
      unreadCount: unreadCount + timeOutAlerts.length, // إجمالي العداد الكلي فوق شامل تنبيهات الوقت
      new: combinedNotifications.filter(n => !n.isRead || n.type === 'timeout_alert'),
      earlier: combinedNotifications.filter(n => n.isRead && n.type !== 'timeout_alert')
    };

    res.status(200).json(notificationsGrouped);

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};