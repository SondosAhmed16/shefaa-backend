const BillingRecord = require('../Models/BillingRecord');
const Transaction   = require('../Models/Transaction');
const Doctor        = require('../Models/Doctors');
const Pharmacy      = require('../Models/Pharmaces');
const Lab           = require('../Models/Labs');
const Appointment   = require('../Models/Appointment');
const logger        = require('../config/loggerConfig');

const RATES = { doctor: 0.015, pharmacy: 0.01, lab: 0.01 };
const PROFILE_MODELS = { doctor: Doctor, pharmacy: Pharmacy, lab: Lab };

const monthBounds = (month, year) => ({
  start: new Date(year, month - 1, 1),
  end:   new Date(year, month, 0, 23, 59, 59, 999),
});

// ─── helper: يحظر/يفك الحظر عن entity — بيأثر على visibilityStatus بس،
//     ومايلمسش isVerified أو أي حاجة متعلقة باللوجين ───────────────────────
async function setEntityVisibility(record, status, reason = null) {
  const Model = PROFILE_MODELS[record.entityType];
  if (!Model) return;

  await Model.findByIdAndUpdate(record.entityProfile, {
    visibilityStatus: status,
    ...(status === 'suspended'
      ? { hiddenAt: new Date(), hiddenReason: reason }
      : { hiddenAt: null, hiddenReason: null }),
  });
}

// ─── GET /admin/billing/summary ───────────────────────────────────────────────
exports.getBillingSummary = async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();

    const records = await BillingRecord.find({ month, year })
      .populate('entity', 'name email')
      .lean();

    const totalDue       = records.reduce((a, r) => a + r.dueAmount, 0);
    const totalCollected = records.filter(r => r.paid).reduce((a, r) => a + r.dueAmount, 0);
    const totalUnpaid    = totalDue - totalCollected;

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

    res.json({ month, year, totalDue, totalCollected, totalUnpaid, byType, records });
  } catch (err) {
    logger.error('Error fetching billing summary: ' + err.message);
    res.status(500).json({ message: 'Error fetching billing summary' });
  }
};

// ─── GET /admin/billing/records ───────────────────────────────────────────────
// يدعم نوعين استخدام:
//  1) شهر محدد (الديفولت): ?month=&year=
//  2) كل التاريخ:           ?scope=all&status=paid|unpaid&entityType=&year=
exports.getBillingRecords = async (req, res) => {
  try {
    const { scope, status, entityType, year } = req.query;
    const filter = {};

    if (scope === 'all') {
      if (year) filter.year = parseInt(year);
    } else {
      filter.month = parseInt(req.query.month) || new Date().getMonth() + 1;
      filter.year  = parseInt(req.query.year)  || new Date().getFullYear();
    }

    if (entityType) filter.entityType = entityType;
    if (status === 'paid')   filter.paid = true;
    if (status === 'unpaid') filter.paid = false;

    const records = await BillingRecord.find(filter)
      .populate('entity', 'name email')
      .sort({ paidAt: -1, createdAt: -1 })
      .lean();

    res.json({ total: records.length, records });
  } catch (err) {
    logger.error('Error fetching billing records: ' + err.message);
    res.status(500).json({ message: 'Error fetching billing records' });
  }
};

// ─── PATCH /admin/billing/records/:id/pay ─────────────────────────────────────
exports.markPaid = async (req, res) => {
  try {
    const record = await BillingRecord.findById(req.params.id);
    if (!record)      return res.status(404).json({ message: 'Billing record not found' });
    if (record.paid)  return res.status(400).json({ message: 'Already marked as paid' });

    record.paid      = true;
    record.paidAt    = new Date();
    record.suspended = false;
    await record.save();

    // فك الحظر فورًا — يرجع يظهر للمرضى تاني
    await setEntityVisibility(record, 'active');

    await Transaction.create({
      recipient:    record.entity,
      amount:       record.dueAmount,
      currency:     'EGP',
      type:         'payout',
      status:       'completed',
      relatedModel: null,
      note: `Monthly billing payout — ${record.entityType} — ${record.month}/${record.year}`,
    });

    logger.info(`Billing record ${record._id} marked paid & unblocked`);
    res.json({ message: 'Marked as paid', record });
  } catch (err) {
    logger.error('Error marking billing paid: ' + err.message);
    res.status(500).json({ message: 'Error marking as paid' });
  }
};

// ─── INTERNAL: التوليد (تستخدم من الـ endpoint ومن الكرون) ───────────────────
exports.generateMonthlyBillingInternal = async (month, year) => {
  const { start, end } = monthBounds(month, year);
  const created = [];
  const updated = [];

  const TYPE_CONFIG = [
    { Model: Doctor,   txType: 'appointment_fee', rate: RATES.doctor,   entityType: 'doctor',   profileModel: 'Doctor'   },
    { Model: Pharmacy, txType: 'pharmacy_order',  rate: RATES.pharmacy, entityType: 'pharmacy', profileModel: 'Pharmacy' },
    { Model: Lab,      txType: 'lab_test_fee',    rate: RATES.lab,      entityType: 'lab',      profileModel: 'Lab'      },
  ];

  for (const { Model, txType, rate, entityType, profileModel } of TYPE_CONFIG) {
    const entities = await Model.find().populate('userId', 'name email').lean();

    for (const ent of entities) {
      if (!ent.userId) continue;

      const revenueAgg = await Transaction.aggregate([
        { $match: {
            recipient: ent.userId._id,
            type:      txType,
            status:    'completed',
            createdAt: { $gte: start, $lte: end },
        }},
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);

      let totalRevenue  = revenueAgg[0]?.total ?? 0;
      let activityCount = revenueAgg[0]?.count ?? 0;

      // fallback خاص بالدكاترة لما مفيش transactions متسجلة لسه
      if (entityType === 'doctor' && !revenueAgg[0]) {
        const appointmentCount = await Appointment.countDocuments({
          doctor: ent._id, createdAt: { $gte: start, $lte: end },
        });
        totalRevenue  = appointmentCount * (ent.clinicConsultationPrice || 0);
        activityCount = appointmentCount;
      }

      const dueAmount = parseFloat((totalRevenue * rate).toFixed(2));

      const result = await BillingRecord.findOneAndUpdate(
        { entity: ent.userId._id, month, year },
        {
          $set: {
            entityProfile: ent._id, entityProfileModel: profileModel, entityType,
            totalRevenue, activityCount, rate, dueAmount,
          },
          $setOnInsert: { paid: false, suspended: false },
        },
        { upsert: true, new: true }
      );

      (result.createdAt?.getTime() === result.updatedAt?.getTime() ? created : updated).push(result._id);
    }
  }

  logger.info(`Billing generated for ${month}/${year} — ${created.length} created, ${updated.length} updated`);
  return { created: created.length, updated: updated.length };
};

// ─── POST /admin/billing/generate ─────────────────────────────────────────────
exports.generateMonthlyBilling = async (req, res) => {
  try {
    const month = parseInt(req.body.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.body.year)  || new Date().getFullYear();
    const result = await exports.generateMonthlyBillingInternal(month, year);
    res.json({ message: `Billing generated for ${month}/${year}`, ...result });
  } catch (err) {
    logger.error('Error generating billing: ' + err.message);
    res.status(500).json({ message: 'Error generating billing', detail: err.message });
  }
};

// ─── INTERNAL: الحظر التلقائي بعد يوم سماح ────────────────────────────────────
exports.autoSuspendUnpaid = async () => {
  const now = new Date();
  const records = await BillingRecord.find({
    paid: false,
    suspended: false,
    $or: [
      { year: { $lt: now.getFullYear() } },
      { year: now.getFullYear(), month: { $lt: now.getMonth() + 1 } },
    ],
  });

  for (const record of records) {
    record.suspended = true;
    await record.save();
    await setEntityVisibility(record, 'suspended', 'Non-payment of platform commission');
    logger.warn(`Entity ${record.entity} (${record.entityType}) auto-suspended — unpaid ${record.month}/${record.year}`);
  }

  return records.length;
};