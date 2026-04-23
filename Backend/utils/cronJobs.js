const cron = require('node-cron');
const Patient = require('../Models/Patients');
const Notification = require('../Models/Notification');
const moment = require('moment'); 

// وظيفة تعمل كل دقيقة
cron.schedule('* * * * *', async () => {
    // استخدمي الصيغة دي بالظبط عشان تطابق اللي بنبعته من بوست مان
    const currentTime = moment().format('hh:mm A'); 
    console.log(`[Cron Job] Checking at: ${currentTime}`); // عشان تشوفيها في الكونسول كل دقيقة

    try {
        // البحث عن المرضى اللي عندهم دواء في الوقت ده "بالظبط"
        const patients = await Patient.find({ 
            "medications.schedule": currentTime,
            "medications.isActive": true 
        });

        if (patients.length > 0) {
            console.log(`Found ${patients.length} patients with meds at ${currentTime}`);
            for (const patient of patients) {
                // فلترة الأدوية اللي موعدها دلوقتي
                const meds = patient.medications.filter(m => m.schedule.includes(currentTime));
                
                for (const med of meds) {
                    await Notification.create({
                        recipient: patient.userId,
                        title: "Medication Reminder 💊",
                        message: `It's time for your ${med.name} dose (${med.dosage}).`,
                        type: 'medication'
                    });
                }
            }
        }
    } catch (err) {
        console.error("Cron Job Error:", err);
    }
});