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
      'medication',          
      'new_prescription',    
      'new_order',          
      'order_status',       
      'low_stock',         
      'appointment',         
      'payment_confirmed',  
      'lab_result',  
      'new_booking',    
      'timeout_alert',        
      'system'              
    ],
    default: 'system'
  },

  relatedId: { type: mongoose.Schema.Types.ObjectId },

  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Notification", notificationSchema);