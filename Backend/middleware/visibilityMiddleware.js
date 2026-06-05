/**
 * visibilityMiddleware.js
 *
 * Attaches a `visibleOnly` filter to req so public pharmacy queries
 * automatically exclude hidden/suspended pharmacies.
 *
 * Usage in routes:
 *   router.get("/search", requireVisiblePharmacy, handler);
 *
 * In controller:
 *   const filter = { ...req.visibleFilter, ...otherFilters };
 *   await Pharmacy.find(filter);
 */

/**
 * Middleware: adds req.visibleFilter = { visibilityStatus: "active" }
 * to all public (unauthenticated or patient) routes.
 */
function publicVisibilityFilter(req, _res, next) {
  req.visibleFilter = { visibilityStatus: "active" };
  next();
}

/**
 * Middleware: blocks the request if the pharmacy resolved from
 * req.pharmacyId / req.pharmacy is not "active".
 * Used to prevent hidden pharmacies from appearing in patient-facing APIs.
 */
function requireActivePharmacy(req, res, next) {
  const pharmacy = req.pharmacy; // set by earlier middleware
  if (!pharmacy) return next(); // let the main handler 404
  if (pharmacy.visibilityStatus !== "active") {
    return res.status(403).json({
      success: false,
      message: "This pharmacy is currently unavailable.",
    });
  }
  next();
}

module.exports = { publicVisibilityFilter, requireActivePharmacy };