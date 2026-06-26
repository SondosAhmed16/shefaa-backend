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
    const lab = await Lab.findOne({ userId: req.user._id });
    
    if (lab) {
      const pendingRequests = await LabRequest.find({ labId: lab._id, status: "pending" })
        .populate({
          path: 'patientId',
          model: 'Patient', 
          populate: { path: 'userId', model: 'User', select: 'name' }
        })
        .populate('services', 'name estimatedTime')
        .lean();

      const now = new Date();

      for (const reqItem of pendingRequests) {
        const patientName = reqItem.patientId?.userId?.name || "Offline Patient";
        const servicesNames = reqItem.services && reqItem.services.length > 0 
          ? reqItem.services.map(s => s.name).join(', ') 
          : "Medical Analysis";
        
        let maxHours = 0;
        if (reqItem.services && reqItem.services.length > 0) {
          reqItem.services.forEach(service => {
            const hours = parseInt(service.estimatedTime) || 24;
            if (hours > maxHours) maxHours = hours;
          });
        }
        const expectedDelivery = new Date(reqItem.createdAt);
        expectedDelivery.setHours(expectedDelivery.getHours() + maxHours);

        let finalType = "new_booking";
        let finalTitle = "New Booking Received! 🧪";
        let finalMessage = `New request registered for patient (${patientName}) for [${servicesNames}].`;

        if (now > expectedDelivery) {
          finalType = "timeout_alert";
          finalTitle = "Analysis Timeout Alert! ⚠️";
          finalMessage = `The expected delivery time for patient (${patientName}) tests (${servicesNames}) has ended. Please upload the results immediately.`;
        }

        const existingNotification = await Notification.findOne({
          recipient: req.user._id,
          relatedId: reqItem._id,
          type: finalType
        });

        if (!existingNotification) {
          const newAlert = new Notification({
            recipient: req.user._id,
            title: finalTitle,
            message: finalMessage,
            type: finalType,
            relatedId: reqItem._id,
            isRead: false,
            createdAt: reqItem.createdAt 
          });
          await newAlert.save();
        } 
        else if (existingNotification.type === 'new_booking' && finalType === 'timeout_alert') {
          existingNotification.type = 'timeout_alert';
          existingNotification.title = finalTitle;
          existingNotification.message = finalMessage;
          existingNotification.isRead = false; 
          await existingNotification.save();
        }
      }
    }

    const allNotifications = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    const unreadCount = allNotifications.filter(n => !n.isRead).length;


    const notificationsGrouped = {
      unreadCount: unreadCount,
      new: allNotifications.filter(n => !n.isRead), 
      earlier: allNotifications.filter(n => n.isRead) 
    };

    res.status(200).json(notificationsGrouped);

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};