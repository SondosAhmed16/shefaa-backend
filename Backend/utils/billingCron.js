const cron = require('node-cron');
const {
  generateMonthlyBillingInternal,
  autoSuspendUnpaid,
} = require('../Controllers/billingController');

// يوم 1 من كل شهر، الساعة 00:00 — يحسب فواتير الشهر اللي فات (مفيش حظر هنا)
cron.schedule('0 0 1 * *', async () => {
  console.log('[Billing Cron] توليد فواتير الشهر اللي فات...');
  try {
    const now = new Date();
    const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const year      = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const result = await generateMonthlyBillingInternal(lastMonth, year);
    console.log(`[Billing Cron] تم التوليد — created: ${result.created}, updated: ${result.updated}`);
  } catch (err) {
    console.error('[Billing Cron] خطأ في التوليد:', err);
  }
});

// يوم 2 من كل شهر، الساعة 00:00 — مهلة يوم كامل، وبعدها نحظر اللي لسه مش دافع
cron.schedule('0 0 2 * *', async () => {
  console.log('[Billing Cron] فحص الحظر التلقائي بعد مهلة السماح...');
  try {
    const count = await autoSuspendUnpaid();
    console.log(`[Billing Cron] تم حظر ${count} entity`);
  } catch (err) {
    console.error('[Billing Cron] خطأ في الحظر:', err);
  }
});