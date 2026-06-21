const cron = require('node-cron');
const { autoSuspendUnpaidPharmacies } = require('../controllers/pharmacyBillingController');

// بتشتغل الساعة 00:00 بالظبط أول كل شهر (يوم 1)
cron.schedule('0 0 1 * *', async () => {
  console.log('[Billing Cron] بدء فحص الفواتير المتأخرة...');
  try {
    await autoSuspendUnpaidPharmacies();
  } catch (err) {
    console.error('[Billing Cron] خطأ:', err);
  }
});