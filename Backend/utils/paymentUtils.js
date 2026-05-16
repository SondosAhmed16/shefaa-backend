/**
 * utils/paymentUtils.js
 *
 * Fake Visa card validation for the graduation project.
 * Mimics real-world card checks without processing real payments.
 */

// ── Luhn Algorithm ────────────────────────────────────────────────────────────
// Every real card number passes this checksum. We use it to validate
// "fake but structurally valid" card numbers.
const luhnCheck = (cardNumber) => {
  const digits = cardNumber.replace(/\s+/g, "").split("").reverse().map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[i];
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

// ── Card type detection ───────────────────────────────────────────────────────
const detectCardType = (cardNumber) => {
  const num = cardNumber.replace(/\s+/g, "");
  if (/^4/.test(num)) return "Visa";
  if (/^5[1-5]/.test(num) || /^2[2-7]/.test(num)) return "Mastercard";
  if (/^3[47]/.test(num)) return "Amex";
  return "Unknown";
};

// ── Expiry validation ─────────────────────────────────────────────────────────
const isExpiryValid = (month, year) => {
  const now = new Date();
  const expiry = new Date(
    2000 + parseInt(year, 10),
    parseInt(month, 10) - 1,
    1
  );
  // expiry is valid if it hasn't passed (month/year level)
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return expiry >= currentMonth;
};

// ── CVV validation ────────────────────────────────────────────────────────────
// Visa/Mastercard → 3 digits, Amex → 4 digits
const isCVVValid = (cvv, cardType) => {
  if (cardType === "Amex") return /^\d{4}$/.test(cvv);
  return /^\d{3}$/.test(cvv);
};

/**
 * validateCard({ cardNumber, expiryMonth, expiryYear, cvv, cardholderName })
 *
 * Returns { valid: true } or { valid: false, error: "reason" }
 *
 * For the graduation project we ONLY accept Visa cards.
 */
const validateCard = ({ cardNumber, expiryMonth, expiryYear, cvv, cardholderName }) => {
  // ── 1. Cardholder name ────────────────────────
  if (!cardholderName || cardholderName.trim().length < 2) {
    return { valid: false, error: "Cardholder name is required." };
  }

  // ── 2. Strip spaces and check digits only ─────
  const stripped = (cardNumber || "").replace(/\s+/g, "");
  if (!/^\d{13,19}$/.test(stripped)) {
    return { valid: false, error: "Card number must be 13–19 digits." };
  }

  // ── 3. Card type — only Visa accepted ─────────
  const cardType = detectCardType(stripped);
  if (cardType !== "Visa") {
    return { valid: false, error: "Only Visa cards are accepted." };
  }

  // ── 4. Luhn check ─────────────────────────────
  if (!luhnCheck(stripped)) {
    return { valid: false, error: "Invalid card number (checksum failed)." };
  }

  // ── 5. Expiry ─────────────────────────────────
  const em = parseInt(expiryMonth, 10);
  const ey = parseInt(expiryYear, 10);
  if (isNaN(em) || em < 1 || em > 12) {
    return { valid: false, error: "Invalid expiry month (1–12)." };
  }
  if (isNaN(ey) || ey < 0 || ey > 99) {
    return { valid: false, error: "Invalid expiry year (YY format)." };
  }
  if (!isExpiryValid(em, ey)) {
    return { valid: false, error: "Card has expired." };
  }

  // ── 6. CVV ────────────────────────────────────
  if (!isCVVValid(cvv, cardType)) {
    return { valid: false, error: "CVV must be 3 digits for Visa." };
  }

  return { valid: true, cardType };
};

module.exports = { validateCard, detectCardType, luhnCheck };