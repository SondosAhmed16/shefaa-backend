const cron = require('node-cron');
const Patient = require('../Models/Patients');
const Notification = require('../Models/Notification');
const moment = require('moment'); 

// وظيفة تعمل كل دقيقة
cron.schedule('* * * * *', async () => {
    // التأكد من جلب الوقت بصيغة مطابقة تماماً لما هو مخزن في الأطلس
    const currentTime = moment().format('hh:mm A'); 
    console.log(`[Cron Job] System Time: ${currentTime}`); 

    try {
        // البحث باستخدام $in للتأكد من وجود الوقت الحالي داخل مصفوفة الـ schedule
        const patients = await Patient.find({ 
            "medications.schedule": currentTime,
            "medications.isActive": true 
        });

        if (patients.length > 0) {
            for (const patient of patients) {
                // تصفية الأدوية التي تطابق هذا الوقت
                const meds = patient.medications.filter(m => m.schedule.includes(currentTime));
                
                for (const med of meds) {
                    const exists = await Notification.findOne({
                        recipient: patient.userId,
                        message: new RegExp(med.name, 'i'),
                        createdAt: { $gte: moment().startOf('minute').toDate() }
                    });

                    if (!exists) {
                        await Notification.create({
                            recipient: patient.userId,
                            title: "Medication Reminder 💊",
                            message: `It's time for your ${med.name} dose (${med.dosage}).`,
                            type: 'medication'
                        });
                        console.log(`Notification sent for ${med.name} to user ${patient.userId}`);
                    }
                }
            }
        }
    } catch (err) {
        console.error("Cron Job Error:", err);
    }
});