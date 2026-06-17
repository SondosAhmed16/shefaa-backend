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

exports.getLabNotificationsForUI = async (req, res) => {
  try {
    // A) جلب الإشعارات العادية والمباشرة من جدول الـ Notifications (إن وجدت)
    const allNotifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    const unreadCount = allNotifications.filter(n => !n.isRead).length;

    // B) جلب بروفايل المعمل الحالي
    const lab = await Lab.findOne({ userId: req.user._id });
    
    let liveTrackAlerts = []; // 🟢 الاسم هنا سليم وثابت

    if (lab) {
      // جلب كافة الطلبات المعلقة (pending) لربطها فوراً بالشاشة 🧪
      const pendingRequests = await LabRequest.find({ labId: lab._id, status: "pending" })
        .populate({
          path: 'patientId',
          model: 'Patient', 
          populate: { path: 'userId', model: 'User', select: 'name' }
        })
        .populate('services', 'name estimatedTime')
        .sort({ createdAt: -1 }) 
        .lean();

      const now = new Date();

      pendingRequests.forEach(reqItem => {
        const patientName = reqItem.patientId?.userId?.name || "Offline Patient";
        const servicesNames = reqItem.services && reqItem.services.length > 0 
          ? reqItem.services.map(s => s.name).join(', ') 
          : "Medical Analysis";
        
        // 🧠 الحسبة الذكية لأطول مدة تحليل
        let maxHours = 0;
        if (reqItem.services && reqItem.services.length > 0) {
          reqItem.services.forEach(service => {
            const hours = parseInt(service.estimatedTime) || 24;
            if (hours > maxHours) maxHours = hours;
          });
        }

        // حساب موعد التسليم المتوقع
        const expectedDelivery = new Date(reqItem.createdAt);
        expectedDelivery.setHours(expectedDelivery.getHours() + maxHours);

        // 🏠 معرفة هل التحليل من البيت ولا في المعمل
        const isHomeVisit = reqItem.viaAI ? "Yes (Home Visit)" : "No (At Center)";

        // 🚨 السيناريو الأول: لو الوقت الحالي تخطى موعد التسليم -> تنبيه استعجال متأخر
        if (now > expectedDelivery) {
          liveTrackAlerts.push({
            _id: `timeout-${reqItem._id}`,
            title: "Analysis Timeout Alert! ⚠️",
            message: `The expected delivery time for patient (${patientName}) tests (${servicesNames}) has ended. Please upload the results immediately.`,
            type: "timeout_alert",
            isRead: false,
            createdAt: reqItem.createdAt, 
            details: { patientName, servicesNames, isHomeVisit, maxHours }
          });
        } 
        // 🆕 السيناريو الثاني: الريكويست لسه ميعاده مخلصش (لسه مكرية حالا) -> يظهر كـ حجز جديد فوراً!
        else {
          liveTrackAlerts.push({
            _id: `newbook-${reqItem._id}`,
            title: "New Booking Received! 🧪",
            message: `New request registered for patient (${patientName}) for [${servicesNames}]. Home Visit: ${isHomeVisit}.`,
            type: "new_booking",
            isRead: false,
            createdAt: reqItem.createdAt, 
            details: { patientName, servicesNames, isHomeVisit, expectedIn: `${maxHours} hrs` }
          });
        }
      });
    }

    // C) دمج الإشعارات الحية والمباشرة مع إشعارات الداتابيز
    const combinedNotifications = [...liveTrackAlerts, ...allNotifications];

    // الترتيب التاريخي التنازلي: الأحدث تظهر أول حاجة فوق في الصفحة
    combinedNotifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // D) تقسيم الداتا لـ (New) و (Earlier) بالظبط لتطابق كروت الـ UI 📋
   const notificationsGrouped = {
      // العداد بيعد الحجوزات أو التنبيهات اللي اتعملت في آخر ساعة بس ولسه مقروءتش
      unreadCount: unreadCount + liveTrackAlerts.filter(n => (new Date() - new Date(n.createdAt)) < 3600000).length, 
      
      // الـ New: يشتمل على الإشعارات العادية غير المقروءة + أي طلب حي (جديد أو متأخر) بقاله أقل من ساعة
      new: combinedNotifications.filter(n => {
        if (n.type === 'timeout_alert' || n.type === 'new_booking') {
          const minutesPassed = (new Date() - new Date(n.createdAt)) / (1000 * 60);
          return minutesPassed <= 60; // لو بقاله أقل من ساعة يفضل في الـ New
        }
        return !n.isRead; // للإشعارات التقليدية من قاعدة البيانات
      }),

      // الـ Earlier: ينزل فيه الإشعارات المقروءة + أي طلب حي (جديد أو متأخر) عدا عليه أكتر من ساعة
      earlier: combinedNotifications.filter(n => {
        if (n.type === 'timeout_alert' || n.type === 'new_booking') {
          const minutesPassed = (new Date() - new Date(n.createdAt)) / (1000 * 60);
          return minutesPassed > 60; // لو عدا عليه أكتر من ساعة (60 دقيقة) ينزل تلقائياً في الـ Earlier
        }
        return n.isRead; // للإشعارات التقليدية من قاعدة البيانات
      })
    };

    res.status(200).json(notificationsGrouped);

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};