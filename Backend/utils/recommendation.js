exports.recommendNearbyClinics = (location, clinics) => {
  return clinics
    .map(clinic => ({
      clinic,
      distance: Math.sqrt(
        Math.pow(clinic.location.latitude - location.latitude, 2) +
        Math.pow(clinic.location.longitude - location.longitude, 2)
      ),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map(c => c.clinic);
};

exports.recommendPharmacies = (location, pharmacies, prescription) => {
  const filtered = pharmacies.filter(p =>
    p.stock.some(med => prescription.some(pm => pm.name === med.medicineName))
  );
  return filtered.sort((a, b) => {
    const da = Math.abs(a.location.latitude - location.latitude);
    const db = Math.abs(b.location.latitude - location.latitude);
    return da - db;
  });
};

exports.recommendLabs = (location, labs, requiredTests) => {
  const filtered = labs.filter(lab =>
    lab.availableTests.some(t => requiredTests.includes(t.testName))
  );
  return filtered.sort((a, b) => {
    const da = Math.abs(a.location.latitude - location.latitude);
    const db = Math.abs(b.location.latitude - location.latitude);
    return da - db;
  });
};