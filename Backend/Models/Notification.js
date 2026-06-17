const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: { type: String, required: true },
  message: { type: String, required: true },

  type: {
    type: String,
    enum: [
      'medication',          // مستخدم فعلياً في كود المريض الحالي
      'new_prescription',    // للصيدلية عند استلام روشتة
      'new_order',           // للصيدلية عند طلب جديد
      'order_status',        // للمريض عند تجهيز طلبه
      'low_stock',           // للصيدلية (تنبيه المخزن)
      'appointment',         // للدكتور والمريض (المواعيد)
      'payment_confirmed',   // تأكيد الدفع في سكرين التتبع
      'lab_result',  
      'new_booking',    // 🟢 ضيفي ده هنا
      'timeout_alert',        // ننتقل له هنا لإشعار المريض بظهور النتيجة
      'system'               // إشعارات عامة
    ],
    default: 'system'
  },

  relatedId: { type: mongoose.Schema.Types.ObjectId },

  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Notification", notificationSchema);