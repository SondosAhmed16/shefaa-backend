const BillingRecord = require('../Models/BillingRecord');
const Transaction   = require('../Models/Transaction');
const User          = require('../Models/Users');
const Doctor        = require('../Models/Doctors');
const Pharmacy      = require('../Models/Pharmaces');
const Lab           = require('../Models/Labs');
const Appointment   = require('../Models/Appointment');
const logger        = require('../config/loggerConfig');

const RATES = { doctor: 0.015, pharmacy: 0.01, lab: 0.01 };

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const monthBounds = (month, year) => ({
  start: new Date(year, month - 1, 1),
  end:   new Date(year, month, 0, 23, 59, 59, 999),
});

// ─── GET /admin/billing/summary ───────────────────────────────────────────────
/**
 * Returns totals for the current month:
 * collected, outstanding, breakdown by entity type.
 */
exports.getBillingSummary = async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();

    const records = await BillingRecord.find({ month, year })
      .populate('entity', 'name email')
      .lean();

    const totalDue       = records.reduce((a, r) => a + r.dueAmount, 0);
    const totalCollected = records
      .filter(r => r.paid)
      .reduce((a, r) => a + r.dueAmount, 0);
    const totalUnpaid    = totalDue - totalCollected;

    // Break down by entity type
    const byType = ['doctor', 'pharmacy', 'lab'].map(type => {
      const group = records.filter(r => r.entityType === type);
      return {
        type,
        total:     group.reduce((a, r) => a + r.dueAmount, 0),
        collected: group.filter(r => r.paid).reduce((a, r) => a + r.dueAmount, 0),
        count:     group.length,
        paidCount: group.filter(r => r.paid).length,
      };
    });

    res.json({
      month, year,
      totalDue, totalCollected, totalUnpaid,
      byType, records,
    });
  } catch (err) {
    logger.error('Error fetching billing summary: ' + err.message);
    res.status(500).json({ message: 'Error fetching billing summary' });
  }
};

// ─── GET /admin/billing/records ───────────────────────────────────────────────
/**
 * Paginated list of billing records, filterable by type/month/year/paid.
 */
exports.getBillingRecords = async (req, res) => {
  try {
    const month  = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year   = parseInt(req.query.year)  || new Date().getFullYear();
    const filter = { month, year };

    if (req.query.type) filter.entityType = req.query.type;
    if (req.query.paid !== undefined) filter.paid = req.query.paid === 'true';

    const records = await BillingRecord.find(filter)
      .populate('entity', 'name email')
      .sort({ dueAmount: -1 })
      .lean();

    res.json({ month, year, total: records.length, records });
  } catch (err) {
    logger.error('Error fetching billing records: ' + err.message);
    res.status(500).json({ message: 'Error fetching billing records' });
  }
};

// ─── PATCH /admin/billing/records/:id/pay ─────────────────────────────────────
/**
 * Mark a billing record as paid and create a matching payout transaction.
 */
exports.markPaid = async (req, res) => {
  try {
    const record = await BillingRecord.findById(req.params.id);
    if (!record)      return res.status(404).json({ message: 'Billing record not found' });
    if (record.paid)  return res.status(400).json({ message: 'Already marked as paid' });

    record.paid   = true;
    record.paidAt = new Date();
    await record.save();

    // Create a payout transaction so it shows up in Finance screen
    await Transaction.create({
      recipient:    record.entity,
      amount:       record.dueAmount,
      currency:     'EGP',
      type:         'payout',
      status:       'completed',
      relatedModel: null,
      note: `Monthly billing payout — ${record.entityType} — ${record.month}/${record.year}`,
    });

    logger.info(`Billing record ${record._id} marked paid — EGP ${record.dueAmount}`);
    res.json({ message: 'Marked as paid', record });
  } catch (err) {
    logger.error('Error marking billing paid: ' + err.message);
    res.status(500).json({ message: 'Error marking as paid' });
  }
};

// ─── PATCH /admin/billing/records/:id/suspend ─────────────────────────────────
/**
 * Suspend an entity for non-payment — deactivates their User account.
 */
exports.suspendForNonPayment = async (req, res) => {
  try {
    const record = await BillingRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Billing record not found' });

    record.suspended = true;
    await record.save();

    await User.findByIdAndUpdate(record.entity, { isVerified: false });

    logger.warn(`Entity ${record.entity} suspended for non-payment`);
    res.json({ message: 'Account suspended for non-payment', record });
  } catch (err) {
    logger.error('Error suspending entity: ' + err.message);
    res.status(500).json({ message: 'Error suspending entity' });
  }
};

// ─── POST /admin/billing/generate ─────────────────────────────────────────────
/**
 * Generate (or refresh) billing records for a given month/year.
 * Safe to run multiple times — uses upsert so it won't duplicate.
 *
 * For doctors  : sums appointment fees from Transaction where type='appointment_fee'
 *                and recipient = doctor's userId (or falls back to Appointment count).
 * For pharmacies: sums pharmacy_order transactions where recipient = pharmacy userId.
 *
 * Call this:
 *   - Via a monthly cron job on the 1st of each month
 *   - Or manually from the admin panel
 */
exports.generateMonthlyBilling = async (req, res) => {
  try {
    const month = parseInt(req.body.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.body.year)  || new Date().getFullYear();
    const { start, end } = monthBounds(month, year);

    const created   = [];
    const updated   = [];

    // ── DOCTORS ────────────────────────────────────────────────────────────────
    const doctors = await Doctor.find().populate('userId', 'name email isVerified').lean();

    for (const doc of doctors) {
      if (!doc.userId) continue;

      // Sum appointment fees received by this doctor this month
      const revenueAgg = await Transaction.aggregate([
        {
          $match: {
            recipient: doc.userId._id,
            type:      'appointment_fee',
            status:    'completed',
            createdAt: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);

      // Fallback: count appointments if no transactions exist yet
      const appointmentCount = await Appointment.countDocuments({
        doctor:    doc._id,
        createdAt: { $gte: start, $lte: end },
      });

      const totalRevenue  = revenueAgg[0]?.total ?? 0;
      const activityCount = revenueAgg[0]?.count ?? appointmentCount;
      const dueAmount     = parseFloat((totalRevenue * RATES.doctor).toFixed(2));

      const result = await BillingRecord.findOneAndUpdate(
        { entity: doc.userId._id, month, year },
        {
          $set: {
            entityProfile:      doc._id,
            entityProfileModel: 'Doctor',
            entityType:         'doctor',
            totalRevenue,
            activityCount,
            rate:               RATES.doctor,
            dueAmount,
          },
          $setOnInsert: { paid: false, suspended: false },
        },
        { upsert: true, new: true }
      );

      (result.createdAt?.getTime() === result.updatedAt?.getTime()
        ? created : updated
      ).push(result._id);
    }

    // ── PHARMACIES ─────────────────────────────────────────────────────────────
    const pharmacies = await Pharmacy.find().populate('userId', 'name email').lean();

    for (const ph of pharmacies) {
      if (!ph.userId) continue;

      const revenueAgg = await Transaction.aggregate([
        {
          $match: {
            recipient: ph.userId._id,
            type:      'pharmacy_order',
            status:    'completed',
            createdAt: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);

      const totalRevenue  = revenueAgg[0]?.total ?? 0;
      const activityCount = revenueAgg[0]?.count ?? 0;
      const dueAmount     = parseFloat((totalRevenue * RATES.pharmacy).toFixed(2));

      const result = await BillingRecord.findOneAndUpdate(
        { entity: ph.userId._id, month, year },
        {
          $set: {
            entityProfile:      ph._id,
            entityProfileModel: 'Pharmacy',
            entityType:         'pharmacy',
            totalRevenue,
            activityCount,
            rate:               RATES.pharmacy,
            dueAmount,
          },
          $setOnInsert: { paid: false, suspended: false },
        },
        { upsert: true, new: true }
      );

      (result.createdAt?.getTime() === result.updatedAt?.getTime()
        ? created : updated
      ).push(result._id);
    }

    // ── LABS ───────────────────────────────────────────────────────────────────
    const labs = await Lab.find().populate('userId', 'name email').lean();

    for (const lab of labs) {
      if (!lab.userId) continue;

      const revenueAgg = await Transaction.aggregate([
        {
          $match: {
            recipient: lab.userId._id,
            type:      'lab_test_fee',
            status:    'completed',
            createdAt: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);

      const totalRevenue  = revenueAgg[0]?.total ?? 0;
      const activityCount = revenueAgg[0]?.count ?? 0;
      const dueAmount     = parseFloat((totalRevenue * RATES.lab).toFixed(2));

      await BillingRecord.findOneAndUpdate(
        { entity: lab.userId._id, month, year },
        {
          $set: {
            entityProfile:      lab._id,
            entityProfileModel: 'Lab',
            entityType:         'lab',
            totalRevenue,
            activityCount,
            rate:               RATES.lab,
            dueAmount,
          },
          $setOnInsert: { paid: false, suspended: false },
        },
        { upsert: true, new: true }
      );
    }

    logger.info(`Billing generated for ${month}/${year} — ${created.length} created, ${updated.length} updated`);
    res.json({
      message: `Billing generated for ${month}/${year}`,
      created: created.length,
      updated: updated.length,
    });
  } catch (err) {
    logger.error('Error generating billing: ' + err.message);
    res.status(500).json({ message: 'Error generating billing', detail: err.message });
  }
};