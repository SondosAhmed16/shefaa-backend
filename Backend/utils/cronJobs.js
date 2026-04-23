const cron = require('node-cron');
const Patient = require('../Models/Patients');
const Notification = require('../Models/Notification');
const moment = require('moment'); 

// وظيفة تعمل كل دقيقة
cron.schedule('* * * * *', async () => {
    const currentTime = moment().format('hh:mm A'); // الوقت الحالي مثل 09:00 AM
    
    // البحث عن المرضى الذين لديهم دواء في هذا الوقت
    const patients = await Patient.find({ "medications.schedule": currentTime });

    for (const patient of patients) {
        const medsToRemind = patient.medications.filter(m => m.schedule.includes(currentTime));
        
        for (const med of medsToRemind) {
            await Notification.create({
                recipient: patient.userId,
                title: "Medication Reminder 💊",
                message: `It's time for your ${med.name} dose (${med.dosage}).`,
                type: 'medication'
            });
        }
    }
});