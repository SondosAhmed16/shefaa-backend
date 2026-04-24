const cron = require('node-cron');
const Patient = require('../Models/Patients');
const Notification = require('../Models/Notification');
const moment = require('moment'); 

// وظيفة تعمل كل دقيقة
cron.schedule('* * * * *', async () => {
    const currentTime = moment().format('hh:mm A'); 
    console.log(`[Cron Job] Checking at: ${currentTime}`); 

    try {
        // استخدمنا $in للتأكد من البحث داخل المصفوفة بشكل صحيح
        const patients = await Patient.find({ 
            "medications.schedule": { $in: [currentTime] },
            "medications.isActive": true 
        });

        console.log(`Matching patients found: ${patients.length}`); // سطر مهم للتأكد

        for (const patient of patients) {
            // تصفية الدواء اللي وقته "دلوقتي"
            const meds = patient.medications.filter(m => m.schedule.includes(currentTime));
            
            for (const med of meds) {
                await Notification.create({
                    recipient: patient.userId,
                    title: "Medication Reminder 💊",
                    message: `It's time for your ${med.name} dose (${med.dosage}).`,
                    type: 'medication'
                });
                console.log(`✅ Notification created for: ${med.name}`);
            }
        }
    } catch (err) {
        console.error("Cron Job Error:", err);
    }
});