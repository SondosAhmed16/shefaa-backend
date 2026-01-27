exports.generateSlots = (startTime, endTime, slotDuration, dailyCapacity) => {
  const slots = [];
  let current = new Date(startTime);
  const end = new Date(endTime);
  let count = 0;

  while (current < end && count < dailyCapacity) {
    const next = new Date(current.getTime() + slotDuration * 60000);
    slots.push({
      startTime: new Date(current),
      endTime: new Date(next),
      isAvailable: true,
    });
    current = next;
    count++;
  }

  return slots;
};

exports.isSlotAvailable = (slots, date) => {
  return slots.some(slot => slot.date.toISOString() === date.toISOString() && slot.isAvailable);
};