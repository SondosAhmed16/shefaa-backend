const Notification = require('../Models/Notification');

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