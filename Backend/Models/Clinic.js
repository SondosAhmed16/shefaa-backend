import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import '../PageCss/ClinicManagement.css';
import { useSearchParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const API_BASE = "https://shefaa-backend.vercel.app/api/clinic";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const getWeekStart = (d) => {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 6 ? 0 : day + 1;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
};

const buildWeek = (weekStart) => {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push(d);
  }
  return days;
};

const fmtDate = (d) =>
  d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtDateFull = (d) =>
  d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const isSameDay = (a, b) => a.toDateString() === b.toDateString();
const isBeforeToday = (d) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return d < t;
};
const isToday = (d) => isSameDay(d, new Date());
const dayName = (d) => d.toLocaleDateString("en-US", { weekday: "long" });

const timeToMins = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const minsToTime = (m) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const overlaps = (s1, e1, s2, e2) => s1 < e2 && e1 > s2;

// ─────────────────────────────────────────────
// useNow — live clock that ticks every minute
// Returns current time as total minutes (e.g. 09:30 → 570).
// Any component using this will auto-rerender the moment a slot crosses into the past.
// The timeout aligns the first tick to the next full minute boundary so
// the interval doesn't drift (fires at :31:00.000, :32:00.000, …).
// ─────────────────────────────────────────────
const getNowMins = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};

const msUntilNextMinute = () => {
  const n = new Date();
  return (60 - n.getSeconds()) * 1000 - n.getMilliseconds();
};

function useNow() {
  const [nowMins, setNowMins] = useState(getNowMins);

  useEffect(() => {
    let intervalId;
    const timeoutId = setTimeout(() => {
      setNowMins(getNowMins());
      intervalId = setInterval(() => setNowMins(getNowMins()), 60_000);
    }, msUntilNextMinute());

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  return nowMins;
}

// ─────────────────────────────────────────────
// SLOT GENERATOR
// ─────────────────────────────────────────────
const generateSlots = ({ startTime, endTime, sessionMins, slotCount, useSlotCount, breaks, markExpired = false, nowMins = 0 }) => {
  const start = timeToMins(startTime), end = timeToMins(endTime);
  if (start >= end || sessionMins < 5) return [];

  const blocked = (breaks || [])
    .filter((b) => b.enabled && b.from && b.to)
    .map((b) => ({ from: timeToMins(b.from), to: timeToMins(b.to) }))
    .filter((b) => b.from < b.to);

  const valid = [];
  for (let t = start; t + sessionMins <= end; t += sessionMins) {
    if (!blocked.some((b) => overlaps(t, t + sessionMins, b.from, b.to))) {
      valid.push(minsToTime(t));
    }
  }
  const count = useSlotCount ? Math.min(slotCount, valid.length) : valid.length;
  return valid.slice(0, count).map((time) => {
    const expired = markExpired && timeToMins(time) < nowMins;
    return {
      time,
      patient: null,
      type: expired ? "Expired" : "Available",
      status: expired ? "expired" : "available",
    };
  });
};

// ─────────────────────────────────────────────
// MAP BACKEND CLINIC → UI shape
// ─────────────────────────────────────────────
const mapClinicFromApi = (apiClinic) => {
  const sched = apiClinic.defaultSchedule || {};
  const days = sched.days || [];
  const activeDays = days.filter((d) => d.isActive).map((d) => d.day.slice(0, 3));

  // defaultDayMap: keyed by full day name, from defaultSchedule only
  const defaultDayMap = {};
  days.forEach((d) => { defaultDayMap[d.day] = d; });

  return {
    id: apiClinic._id,
    name: apiClinic.name,
    location: `${apiClinic.city} · ${apiClinic.address}`,
    color: apiClinic.color || "#1a56a0",
    days: activeDays,
    defaultDayMap,                          // ← default schedule days
    weeklyOverrides: apiClinic.weeklyOverrides || [], // ← overrides array
    slotDuration: sched.slotDuration || 30,
    dailyCapacity: sched.dailyCapacity || 10,
    closed: false,
    isBookingLocked: false,
    isDayLocked: false,
    settingsOpen: true,
    saving: false,
    saveError: null,
    saveSuccess: false,
    _raw: apiClinic,
  };
};

// ─────────────────────────────────────────────
// resolveDay  —  mirrors the backend resolveWeek logic in the frontend.
// Returns the effective day settings for a given date by merging
// defaultSchedule with the matching weeklyOverride (if any).
// Returns null if the day is not active in either.
// ─────────────────────────────────────────────
const resolveDay = (clinic, selectedDate) => {
  const fullDayName = dayName(selectedDate);
  const ws = getWeekStart(selectedDate);
  ws.setHours(0, 0, 0, 0);
  const wsISO = ws.toISOString();

  // Find override for this week
  const override = (clinic.weeklyOverrides || []).find(
    (o) => new Date(o.weekStart).toISOString() === wsISO
  );

  const defDay = clinic.defaultDayMap?.[fullDayName];
  const ovDay  = override?.days?.find((d) => d.day === fullDayName);

  // Merge: override wins over default
  const merged = ovDay
    ? { ...(defDay || {}), ...ovDay }
    : defDay || null;

  if (!merged || merged.isActive === false) return null;

  const slotDur = merged.slotDuration ?? clinic.slotDuration ?? 30;
  const cap     = merged.dailyCapacity ?? clinic.dailyCapacity ?? 10;

  return {
    startTime:       merged.open  != null ? minsToTime(merged.open)  : "08:00",
    endTime:         merged.close != null ? minsToTime(merged.close) : "17:00",
    sessionMins:     slotDur,
    slotCount:       cap,
    useSlotCount:    true,
    isDayLocked:     merged.isDayLocked     || false,
    isBookingLocked: merged.isBookingLocked || false,
    hasAppointments: merged.hasAppointments || false,
    breaks: (merged.breaks || []).map(b => ({
      id: b._id || b.start,
      from: minsToTime(b.start),
      to:   minsToTime(b.end),
      label: b.label || "Break",
      enabled: true,
    })),
  };
};

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const DURATIONS = [15, 20, 30, 45, 60];

const STATUS_CFG = {
  done:      { dot: "#22c55e", label: "Done",      bg: "#f0fdf4", text: "#15803d" },
  pending:   { dot: "#3b82f6", label: "Pending",   bg: "#eff6ff", text: "#1d4ed8" },
  urgent:    { dot: "#ef4444", label: "Urgent",    bg: "#fef2f2", text: "#b91c1c" },
  cancelled: { dot: "#f59e0b", label: "Cancelled", bg: "#fffbeb", text: "#b45309" },
  available: { dot: "#94a3b8", label: "Available", bg: "#f8fafc", text: "#64748b" },
  expired:   { dot: "#cbd5e1", label: "Expired",   bg: "#f1f5f9", text: "#94a3b8" },
};

// ─────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────
const Toggle = ({ checked, onChange, color, disabled }) => (
  <label className={`toggle${disabled ? " toggle--disabled" : ""}`}>
    <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
    <span className="toggle-track" style={checked && color ? { background: color } : {}} />
    <span className="toggle-thumb" />
  </label>
);

const IconSettings = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
  </svg>
);

const IconLock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
);

const IconBreak = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M17 8h1a4 4 0 010 8h-1" />
    <path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z" />
    <line x1="6" y1="1" x2="6" y2="4" />
    <line x1="10" y1="1" x2="10" y2="4" />
    <line x1="14" y1="1" x2="14" y2="4" />
  </svg>
);

const IconSave = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconWarning = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

// ─────────────────────────────────────────────
// OPEN-CLOSED-DAY MODAL
// Used when a day has no clinics scheduled and doctor wants to open one clinic
// for just this week.
// ─────────────────────────────────────────────
function OpenDayModal({ selectedDate, allClinics, onConfirm, onClose }) {
  const [selectedClinicId, setSelectedClinicId] = useState(null);
  const [localSettings, setLocalSettings] = useState({
    startTime: "09:00",
    endTime: "17:00",
    sessionMins: 30,
    slotCount: 10,
    useSlotCount: true,
  });
  const setSetting = (k, v) => setLocalSettings(p => ({ ...p, [k]: v }));

  const fullDayName = dayName(selectedDate);

  // Check which clinics have conflicts on this day
  const clinicsWithConflict = useMemo(() => {
    return allClinics.reduce((acc, clinic) => {
      // A clinic "conflicts" if it's already scheduled on this day in its default schedule
      const alreadyOnDay = clinic.defaultDayMap?.[fullDayName]?.isActive === true;
      acc[clinic.id] = alreadyOnDay;
      return acc;
    }, {});
  }, [allClinics, fullDayName]);

  const startInvalid = timeToMins(localSettings.startTime) >= timeToMins(localSettings.endTime);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Open clinic for {fmtDate(selectedDate)}</h3>
            <p className="modal-sub">This day has no scheduled clinics. Choose one to open for this week only.</p>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <p className="modal-section-label">Select clinic</p>
          <div className="modal-clinic-list">
            {allClinics.map(clinic => {
              const hasConflict = clinicsWithConflict[clinic.id];
              const isSelected = selectedClinicId === clinic.id;
              return (
                <button
                  key={clinic.id}
                  className={`modal-clinic-option${isSelected ? " selected" : ""}${hasConflict ? " has-conflict" : ""}`}
                  onClick={() => setSelectedClinicId(clinic.id)}
                >
                  <span className="modal-clinic-dot" style={{ background: clinic.color }} />
                  <div className="modal-clinic-info">
                    <span className="modal-clinic-name">{clinic.name}</span>
                    <span className="modal-clinic-loc">{clinic.location}</span>
                  </div>
                  {hasConflict && (
                    <span className="modal-conflict-badge">
                      <IconWarning /> Already scheduled
                    </span>
                  )}
                  {isSelected && !hasConflict && (
                    <span className="modal-selected-badge"><IconCheck /></span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedClinicId && (
            <>
              <p className="modal-section-label" style={{ marginTop: 18 }}>Session settings for this day</p>

              <div className="cc-settings-row" style={{ marginBottom: 12 }}>
                <div className="cc-settings-field">
                  <label className="cc-label">Start time</label>
                  <input type="time" className="cm-time-input" value={localSettings.startTime}
                    onChange={e => setSetting("startTime", e.target.value)} />
                </div>
                <span className="cc-arrow">→</span>
                <div className="cc-settings-field">
                  <label className="cc-label">End time</label>
                  <input type="time" className="cm-time-input" value={localSettings.endTime}
                    onChange={e => setSetting("endTime", e.target.value)} />
                </div>
              </div>
              {startInvalid && <p className="cc-error">⚠ End time must be after start time</p>}

              <div className="cc-settings-field" style={{ marginBottom: 14 }}>
                <label className="cc-label">Session duration</label>
                <div className="cm-duration-pills">
                  {DURATIONS.map(d => (
                    <button key={d}
                      className={`cm-dur-pill${localSettings.sessionMins === d ? " active" : ""}`}
                      onClick={() => setSetting("sessionMins", d)}>{d}m</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="modal-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="modal-confirm-btn"
            disabled={!selectedClinicId || startInvalid}
            onClick={() => onConfirm(selectedClinicId, localSettings)}
          >
            <IconPlus /> Open this clinic
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// NO-CLINICS-DAY CARD
// Shown when no clinic is scheduled on this day
// ─────────────────────────────────────────────
function NoClinicsCard({ selectedDate, isPast, onOpenDay }) {
  return (
    <div className="cc-card cc-card--no-clinics-day">
      <div className="no-clinics-day-content">
        <div className="no-clinics-day-icon">📅</div>
        <h3 className="no-clinics-day-title">No clinics on {fmtDate(selectedDate)}</h3>
        <p className="no-clinics-day-sub">
          None of your clinics are scheduled to open on this day.
        </p>
        {!isPast && (
          <button className="no-clinics-open-btn" onClick={onOpenDay}>
            <IconPlus />
            Open a clinic for this day only
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CLINIC CARD
// ─────────────────────────────────────────────
function ClinicCard({
  clinic,
  selectedDate,
  daySettings,
  isActiveDayLocked,
  isPast,
  isStartedToday,
  onUpdate,
  onSave,
  breaks,
  allClinics,
  token,
  isExtraDay, // true = this clinic was opened for this day via the modal (not in default schedule)
}) {
  const notScheduled = !daySettings && !isExtraDay;

  // Live clock — re-renders this card every minute so expired slots update automatically
  const nowMins = useNow();

  const [localSettings, setLocalSettings] = useState(
    daySettings || { startTime: "08:00", endTime: "17:00", sessionMins: 30, slotCount: 10, useSlotCount: true }
  );
  const [localBookingLocked, setLocalBookingLocked] = useState(daySettings?.isBookingLocked || false);
  const [localDayClosed, setLocalDayClosed] = useState(false);

  useEffect(() => {
    if (daySettings) {
      setLocalSettings(daySettings);
      setLocalBookingLocked(daySettings.isBookingLocked || false);
    }
    setLocalDayClosed(false);
  }, [selectedDate.toDateString(), clinic.id]);

  // ── Business rules ──────────────────────────────────────────────────────────
  const hasAppointments = daySettings?.hasAppointments || false;

  // Can close the day fully?
  //  - Past → never
  //  - Day started + has appointments → NO (can only lock bookings)
  //  - Day started + no appointments → YES
  //  - Future + anything → YES
  const canCloseFully = !isPast && !(isStartedToday && hasAppointments);

  // Can edit time settings?
  // Lock ONLY if: past, day-locked, OR (day started AND already has appointments)
  // If day started but NO appointments yet → doctor can still edit times freely
  const isReadOnly = isPast || isActiveDayLocked;
  const canEditTimes = !isReadOnly && !(isStartedToday && hasAppointments) && !notScheduled;

  // Can toggle booking lock?
  const canToggleBooking = !isPast && !isActiveDayLocked && !notScheduled;

  // ── Conflicts ───────────────────────────────────────────────────────────────
  const conflicts = useMemo(() => {
    if (notScheduled || localDayClosed) return [];
    const myStart = timeToMins(localSettings.startTime);
    const myEnd   = timeToMins(localSettings.endTime);
    return allClinics
      .filter((c) => c.id !== clinic.id)
      .filter((c) => {
        const od = c._activeDaySettings;
        if (!od) return false;
        return overlaps(myStart, myEnd, timeToMins(od.startTime), timeToMins(od.endTime));
      })
      .map((c) => c.name);
  }, [localSettings.startTime, localSettings.endTime, allClinics, clinic.id, localDayClosed]);

  const hasConflict = conflicts.length > 0;
  const startInvalid = !notScheduled && timeToMins(localSettings.startTime) >= timeToMins(localSettings.endTime);

  const slots = useMemo(() => {
    if (notScheduled || localDayClosed || hasConflict || startInvalid) return [];
    return generateSlots({ ...localSettings, breaks, markExpired: isStartedToday, nowMins });
  }, [localSettings, breaks, localDayClosed, hasConflict, startInvalid, notScheduled, isStartedToday, nowMins]);

  const maxByTime = useMemo(() => {
    if (startInvalid || notScheduled) return 0;
    const start = timeToMins(localSettings.startTime);
    const end   = timeToMins(localSettings.endTime);
    const blocked = (breaks || [])
      .filter((b) => b.enabled && b.from && b.to)
      .map((b) => ({ from: timeToMins(b.from), to: timeToMins(b.to) }))
      .filter((b) => b.from < b.to);
    let count = 0;
    for (let t = start; t + localSettings.sessionMins <= end; t += localSettings.sessionMins) {
      if (!blocked.some((b) => overlaps(t, t + localSettings.sessionMins, b.from, b.to))) count++;
    }
    return count;
  }, [localSettings, breaks, startInvalid, notScheduled]);

  const counts = useMemo(() => ({
    done:      slots.filter((s) => s.status === "done").length,
    pending:   slots.filter((s) => s.status === "pending").length,
    cancelled: slots.filter((s) => s.status === "cancelled").length,
    expired:   slots.filter((s) => s.status === "expired").length,
    total:     slots.filter((s) => s.status !== "available" && s.status !== "expired").length,
  }), [slots]);

  const setSetting = (key, val) => setLocalSettings((p) => ({ ...p, [key]: val }));

  const isDirty = JSON.stringify(localSettings) !== JSON.stringify(daySettings) ||
    localBookingLocked !== (daySettings?.isBookingLocked || false) ||
    localDayClosed !== false;

  const handleSave = () => {
    onSave(clinic.id, {
      localSettings,
      isBookingLocked: localBookingLocked,
      closed: localDayClosed,
      selectedDate,
      hasAppointments, // ✅ carry the existing flag through so the PATCH doesn't overwrite it
    });
  };

  return (
    <div className={[
      "cc-card",
      notScheduled   ? "cc-card--not-scheduled" : "",
      localDayClosed ? "cc-card--closed" : "",
      isPast         ? "cc-card--past" : "",
      hasConflict    ? "cc-card--conflict" : "",
      isExtraDay     ? "cc-card--extra-day" : "",
    ].join(" ")}>

      {/* ── Header ── */}
      <div className="cc-header">
        <div className="cc-header-left">
          <span className="cc-color-dot"
            style={{ background: (localDayClosed || notScheduled || isPast) ? "#94a3b8" : clinic.color }} />
          <div>
            <h2 className="cc-name">{clinic.name}</h2>
            <p className="cc-location">{clinic.location}</p>
          </div>
        </div>
        <div className="cc-header-right">
          <div className="cc-days">
            {clinic.days.map((d) => (
              <span key={d} className="cc-day-tag">{d}</span>
            ))}
          </div>

          {isExtraDay && (
            <span className="cc-status-badge cc-status-badge--extra">This week only</span>
          )}
          {isPast && (
            <span className="cc-status-badge cc-status-badge--past">Past</span>
          )}
          {!isPast && notScheduled && (
            <span className="cc-status-badge cc-status-badge--off">Not scheduled</span>
          )}
          {!isPast && !notScheduled && localDayClosed && (
            <span className="cc-status-badge cc-status-badge--closed"><IconLock /> Closed</span>
          )}
          {!isPast && !notScheduled && localBookingLocked && !localDayClosed && (
            <span className="cc-status-badge cc-status-badge--locked"><IconLock /> Booking locked</span>
          )}

          {/* Close/open toggle */}
          {!isPast && !notScheduled && (
            canCloseFully ? (
              <button
                className={`cc-close-btn${localDayClosed ? " active" : ""}`}
                onClick={() => setLocalDayClosed((v) => !v)}
                title={localDayClosed ? "Reopen clinic" : "Close clinic for this day"}
              >
                <IconLock />
                <span>{localDayClosed ? "Closed" : "Open"}</span>
              </button>
            ) : (
              /* Day started + has appointments → show disabled close with tooltip */
              <button
                className="cc-close-btn cc-close-btn--disabled"
                title="Cannot close: appointments already booked today"
                disabled
              >
                <IconLock />
                <span>Has appts</span>
              </button>
            )
          )}

          {/* Settings toggle */}
          {!notScheduled && !isPast && !localDayClosed && (
            <button
              className={`cc-settings-btn${clinic.settingsOpen ? " open" : ""}`}
              onClick={() => onUpdate(clinic.id, { settingsOpen: !clinic.settingsOpen })}
              title="Session settings"
            >
              <IconSettings />
            </button>
          )}
        </div>
      </div>

      {/* ── Past banner ── */}
      {isPast && (
        <div className="cc-past-banner"><span>📅 Past day — read only</span></div>
      )}

      {/* ── Not scheduled ── */}
      {!isPast && notScheduled && (
        <div className="cc-not-scheduled-banner">
          <span>This clinic is not scheduled on {fmtDate(selectedDate)}</span>
        </div>
      )}

      {/* ── Closed banner ── */}
      {!isPast && !notScheduled && localDayClosed && (
        <div className="cc-closed-banner">
          <IconLock />
          <span>This clinic is closed for bookings on this day</span>
          {canCloseFully && (
            <button className="cc-reopen-btn" onClick={() => setLocalDayClosed(false)}>Reopen</button>
          )}
        </div>
      )}

      {/* ── Day started banner — only shown when appointments exist (times are now locked) ── */}
      {isStartedToday && !isPast && !notScheduled && !localDayClosed && hasAppointments && (
        <div className="cc-started-banner">
          ⏰ Day started with appointments — time settings are locked. You can only lock/unlock new bookings.
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Lock new bookings</span>
            <Toggle checked={localBookingLocked} onChange={() => setLocalBookingLocked((v) => !v)} color="#ef4444" />
          </div>
        </div>
      )}

      {/* ── Conflict warning ── */}
      {!localDayClosed && hasConflict && (
        <div className="cc-conflict-banner">
          ⚠ Time overlap with: <strong>{conflicts.join(", ")}</strong>
        </div>
      )}

      {/* ── Settings panel ── */}
      {clinic.settingsOpen && !localDayClosed && !notScheduled && !isPast && (
        <div className="cc-settings-panel">
          <p className="cc-settings-title">Session settings</p>

          <div className="cc-settings-row">
            <div className="cc-settings-field">
              <label className="cc-label">Start time</label>
              <input type="time" className="cm-time-input" value={localSettings.startTime}
                disabled={!canEditTimes}
                onChange={(e) => setSetting("startTime", e.target.value)} />
            </div>
            <span className="cc-arrow">→</span>
            <div className="cc-settings-field">
              <label className="cc-label">End time</label>
              <input type="time" className="cm-time-input" value={localSettings.endTime}
                disabled={!canEditTimes}
                onChange={(e) => setSetting("endTime", e.target.value)} />
            </div>
            {!canEditTimes && !isStartedToday && (
              <span className="cc-lock-hint"><IconLock /> Locked</span>
            )}
          </div>

          {startInvalid && <p className="cc-error">⚠ End time must be after start time</p>}

          {canEditTimes && (
            <div className="cc-settings-field" style={{ marginTop: 14 }}>
              <label className="cc-label">Session duration</label>
              <div className="cm-duration-pills">
                {DURATIONS.map((d) => (
                  <button key={d}
                    className={`cm-dur-pill${localSettings.sessionMins === d ? " active" : ""}`}
                    onClick={() => setSetting("sessionMins", d)}>{d}m</button>
                ))}
                <div className="cm-dur-custom">
                  <input type="number" className="cm-dur-input" min={5} max={120}
                    value={localSettings.sessionMins}
                    onChange={(e) => setSetting("sessionMins", Math.max(5, Math.min(120, +e.target.value)))} />
                  <span className="cm-dur-unit">min</span>
                </div>
              </div>
            </div>
          )}

          {canEditTimes && (
            <>
              <div className="cc-slot-count-row">
                <div>
                  <label className="cc-label">Set slot count manually</label>
                  <p className="cc-sublabel">
                    {localSettings.useSlotCount
                      ? `Max from time: ${maxByTime} · active: ${Math.min(localSettings.slotCount, maxByTime)}`
                      : `Auto from time range: ${maxByTime} slots`}
                  </p>
                </div>
                <Toggle checked={localSettings.useSlotCount}
                  onChange={() => setSetting("useSlotCount", !localSettings.useSlotCount)}
                  color={clinic.color} />
              </div>

              {localSettings.useSlotCount && (
                <div className="cc-slot-stepper">
                  <button className="cc-step-btn"
                    onClick={() => setSetting("slotCount", Math.max(1, localSettings.slotCount - 1))}>−</button>
                  <div className="cc-step-display">
                    <span className="cc-step-num">{Math.min(localSettings.slotCount, maxByTime)}</span>
                    <span className="cc-step-label">slots</span>
                  </div>
                  <button className="cc-step-btn"
                    onClick={() => setSetting("slotCount", Math.min(maxByTime || 99, localSettings.slotCount + 1))}>+</button>
                </div>
              )}
            </>
          )}

          {!isStartedToday && canToggleBooking && (
            <div className="cc-slot-count-row" style={{ marginTop: 12 }}>
              <div>
                <label className="cc-label">Lock new bookings</label>
                <p className="cc-sublabel">Prevent new appointments on this day</p>
              </div>
              <Toggle checked={localBookingLocked} onChange={() => setLocalBookingLocked((v) => !v)} color="#ef4444" />
            </div>
          )}
        </div>
      )}

      {/* ── Summary + Slots ── */}
      {!localDayClosed && !notScheduled && (
        <>
          {!isPast && (
            <div className="cm-summary">
              {[
                { key: "done",      label: "Done",      val: counts.done },
                { key: "pending",   label: "Pending",   val: counts.pending },
                { key: "cancelled", label: "Cancelled", val: counts.cancelled },
                ...(counts.expired > 0 ? [{ key: "expired", label: "Expired", val: counts.expired }] : []),
                { key: "total",     label: "Total",     val: counts.total, dot: clinic.color, bg: `${clinic.color}18`, text: clinic.color },
              ].map(({ key, label, val, dot, bg, text }) => {
                const cfg = STATUS_CFG[key] || { dot, bg, text };
                return (
                  <span key={key} className="cm-badge" style={{ background: cfg.bg, color: cfg.text }}>
                    <span className="cm-badge-dot" style={{ background: cfg.dot }} />
                    {val} {label}
                  </span>
                );
              })}
            </div>
          )}

          <div className="cc-schedule-label">
            <span className="cc-schedule-title">
              {isPast ? `Past · ${fmtDate(selectedDate)}` : isStartedToday ? "Today's schedule" : `Schedule · ${fmtDate(selectedDate)}`}
            </span>
          </div>

          <div className={`cm-slots${isPast ? " cm-slots--past" : ""}`}>
            {slots.length === 0 && (
              <p className="cm-empty-slots">
                {hasConflict ? "Resolve time conflict to see slots." : isPast ? "No records for this day." : "No slots — adjust settings."}
              </p>
            )}
            {slots.map((slot, i) => {
              const cfg = STATUS_CFG[slot.status] || STATUS_CFG.available;
              const isExpired = slot.status === "expired";
              return (
                <div key={i}>
                  <div className={`cm-slot${isExpired ? " cm-slot--expired" : ""}`}>
                    <span className={`cm-slot-time${isExpired ? " cm-slot-time--expired" : ""}`}>
                      {slot.time}
                    </span>
                    <div className="cm-slot-info">
                      <div className={`cm-slot-name${slot.status === "available" || isExpired ? " available-label" : ""}`}>
                        {slot.patient ?? slot.type}
                      </div>
                      <div className="cm-slot-type">{slot.type}</div>
                    </div>
                    {(slot.status !== "available") && (
                      <span className="cm-slot-status-chip" style={{ background: cfg.bg, color: cfg.text }}>
                        {isExpired ? "Expired" : cfg.label}
                      </span>
                    )}
                    <span className="cm-slot-dot" style={{ background: cfg.dot }} />
                  </div>
                  {i < slots.length - 1 && <div className="cm-divider" />}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Save button ── */}
      {!isPast && !notScheduled && (
        <div className="cc-save-row">
          {clinic.saveSuccess && (
            <span className="cc-save-success"><IconCheck /> Saved!</span>
          )}
          {clinic.saveError && (
            <span className="cc-save-error">{clinic.saveError}</span>
          )}
          <button
            className={`cc-save-btn${isDirty ? " dirty" : ""}${clinic.saving ? " saving" : ""}`}
            onClick={handleSave}
            disabled={clinic.saving || (!isDirty && !clinic.saveError)}
          >
            {clinic.saving ? <span className="cc-spinner" /> : <IconSave />}
            {clinic.saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// BREAK TIMES SECTION
// ─────────────────────────────────────────────
function BreakTimesSection({ breaks, onBreaksChange, enabled, onToggle }) {
  const addBreak = () => {
    onBreaksChange([
      ...breaks,
      { id: Date.now(), from: "12:00", to: "13:00", label: "Lunch break", enabled: true },
    ]);
  };
  const updateBreak = (id, patch) =>
    onBreaksChange(breaks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const removeBreak = (id) => onBreaksChange(breaks.filter((b) => b.id !== id));

  return (
    <div className={`breaks-card${!enabled ? " breaks-card--off" : ""}`}>
      <div className="breaks-header">
        <div className="breaks-header-left">
          <span className="breaks-icon"><IconBreak /></span>
          <div>
            <h3 className="breaks-title">Break Times</h3>
            <p className="breaks-sub">Blocked across all clinics</p>
          </div>
        </div>
        <Toggle checked={enabled} onChange={onToggle} color="#1a56a0" />
      </div>

      {enabled && (
        <div className="breaks-body">
          {breaks.length === 0 && (
            <p className="breaks-empty">No break times added — all hours available.</p>
          )}
          {breaks.map((b) => (
            <div key={b.id} className={`break-row${!b.enabled ? " break-row--off" : ""}`}>
              <Toggle checked={b.enabled} onChange={() => updateBreak(b.id, { enabled: !b.enabled })} />
              <input className="break-label-input" value={b.label}
                onChange={(e) => updateBreak(b.id, { label: e.target.value })} placeholder="Label" />
              <div className="break-times">
                <input type="time" className="cm-time-input cm-time-input--sm" value={b.from}
                  onChange={(e) => updateBreak(b.id, { from: e.target.value })} />
                <span className="cc-arrow">→</span>
                <input type="time" className="cm-time-input cm-time-input--sm" value={b.to}
                  onChange={(e) => updateBreak(b.id, { to: e.target.value })} />
              </div>
              {b.enabled && b.from && b.to && timeToMins(b.from) < timeToMins(b.to) && (
                <span className="break-duration">{timeToMins(b.to) - timeToMins(b.from)} min</span>
              )}
              <button className="break-remove-btn" onClick={() => removeBreak(b.id)} title="Remove">×</button>
            </div>
          ))}
          <button className="breaks-add-btn" onClick={addBreak}>+ Add break</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────
export default function ClinicManagement() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, token } = useSelector((state) => state.auth);

  const clinicIds = useMemo(() => {
    const raw = searchParams.get("clinicIds");
    return raw ? raw.split(",").filter(Boolean) : [];
  }, [searchParams]);

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);

  const weekStart = useMemo(() => getWeekStart(today), [today]);
  const week      = useMemo(() => buildWeek(weekStart), [weekStart]);

  const [selectedDate, setSelectedDate] = useState(today);
  const [clinics, setClinics]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [fetchError, setFetchError]     = useState(null);
  const [dayLocked, setDayLocked]       = useState(false);
  const [breaks, setBreaks]             = useState([
    { id: 1, from: "13:00", to: "14:00", label: "Lunch break", enabled: true },
  ]);
  const [breaksEnabled, setBreaksEnabled] = useState(true);

  // Modal state
  const [showOpenDayModal, setShowOpenDayModal] = useState(false);

  // Fetch clinics fresh from API — this ensures weeklyOverrides are always up-to-date
  // (Redux user.clinics may be stale or only contain IDs, not full populated objects)
  useEffect(() => {
    if (!clinicIds.length || !token) { setLoading(false); return; }

    const fetchClinics = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const results = await Promise.all(
          clinicIds.map(id =>
            fetch(`${API_BASE}/${id}`, {
              headers: { Authorization: `Bearer ${token}` },
            }).then(r => r.json())
          )
        );
        const mapped = results
          .filter(r => r.clinic)
          .map(r => ({
            ...mapClinicFromApi(r.clinic),
            settingsOpen: true,
            saving: false,
            saveError: null,
            saveSuccess: false,
          }));
        setClinics(mapped);
      } catch (err) {
        setFetchError("Failed to load clinics. Please refresh.");
      } finally {
        setLoading(false);
      }
    };

    fetchClinics();
  }, [clinicIds.join(","), token]);;

  const isPast          = isBeforeToday(selectedDate);
  const isTodaySelected = isSameDay(selectedDate, today);
  const isStartedToday  = isTodaySelected;

  const updateClinic = useCallback((id, patch) => {
    setClinics((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const handleSaveClinic = useCallback(
    async (clinicId, { localSettings, isBookingLocked, closed, selectedDate, hasAppointments }) => {
      updateClinic(clinicId, { saving: true, saveError: null, saveSuccess: false });

      const fullDayName = dayName(selectedDate);
      const ws = getWeekStart(selectedDate);
      ws.setHours(0, 0, 0, 0);

      const body = {
        weekStart: ws.toISOString(),
        days: [{
          day: fullDayName,
          isActive: !closed,
          open: timeToMins(localSettings.startTime),
          close: timeToMins(localSettings.endTime),
          slotDuration: localSettings.sessionMins,
          dailyCapacity: localSettings.useSlotCount ? localSettings.slotCount : null,
          isBookingLocked,
          isDayLocked: false,
          // ✅ preserve the flag — never let a settings save accidentally wipe it
          hasAppointments: hasAppointments ?? false,
        }],
      };

      try {
        const res = await fetch(`${API_BASE}/${clinicId}/schedule/override`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Error ${res.status}`);
        }

        updateClinic(clinicId, { saving: false, saveSuccess: true, saveError: null });
        setTimeout(() => updateClinic(clinicId, { saveSuccess: false }), 3000);

        // Re-fetch this clinic so weeklyOverrides are reflected immediately
        // without needing a full page refresh
        try {
          const refreshRes = await fetch(`${API_BASE}/${clinicId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const refreshData = await refreshRes.json();
          if (refreshData.clinic) {
            updateClinic(clinicId, {
              ...mapClinicFromApi(refreshData.clinic),
              settingsOpen: true,   // keep panel open
              saving: false,
              saveSuccess: false,
              saveError: null,
            });
          }
        } catch (_) {
          // silent — the save succeeded, UI just won't reflect override until next full load
        }
      } catch (err) {
        updateClinic(clinicId, { saving: false, saveError: err.message, saveSuccess: false });
      }
    },
    [token, updateClinic]
  );

  // Handle opening a clinic for an extra day (not in default schedule)
  // Persists immediately via the override API so it survives refresh
  const handleOpenExtraDay = useCallback(async (clinicId, settings) => {
    setShowOpenDayModal(false);

    const fullDayName = dayName(selectedDate);
    const ws = getWeekStart(selectedDate);
    ws.setHours(0, 0, 0, 0);

    const body = {
      weekStart: ws.toISOString(),
      days: [{
        day:             fullDayName,
        isActive:        true,
        open:            timeToMins(settings.startTime),
        close:           timeToMins(settings.endTime),
        slotDuration:    settings.sessionMins,
        dailyCapacity:   settings.useSlotCount ? settings.slotCount : null,
        isBookingLocked: false,
        isDayLocked:     false,
        hasAppointments: false,
      }],
    };

    try {
      const res = await fetch(`${API_BASE}/${clinicId}/schedule/override`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to open extra day:", err.message);
        return;
      }

      // Re-fetch the clinic so weeklyOverrides include the new day
      const refreshRes = await fetch(`${API_BASE}/${clinicId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const refreshData = await refreshRes.json();
      if (refreshData.clinic) {
        updateClinic(clinicId, {
          ...mapClinicFromApi(refreshData.clinic),
          settingsOpen: true,
          saving: false,
          saveSuccess: false,
          saveError: null,
        });
      }
    } catch (err) {
      console.error("handleOpenExtraDay error:", err);
    }
  }, [selectedDate, token, updateClinic]);

  const activeBreaks = breaksEnabled ? breaks : [];

  // Attach _activeDaySettings to each clinic for conflict detection
  // resolveDay merges defaultSchedule + weeklyOverrides, so extra days added
  // via the modal (which now persists to API) are automatically included
  const clinicsWithDay = useMemo(() => {
    return clinics.map((clinic) => {
      const ds = resolveDay(clinic, selectedDate);
      return { ...clinic, _activeDaySettings: ds };
    });
  }, [clinics, selectedDate]);

  // All clinics active on the selected day (default schedule OR override)
  const scheduledClinics = clinicsWithDay.filter(c => c._activeDaySettings);

  const dayFullyClosed = scheduledClinics.length === 0;

  return (
    <div className="cm-root">
      {/* ── Header ── */}
      <div className="cm-header">
        <div>
          <h1>My Schedule</h1>
          <p>Manage clinics &amp; availability</p>
        </div>
        <div className="cm-header-actions">
          <button
            className={`cm-day-lock-btn${dayLocked ? " active" : ""}`}
            onClick={() => setDayLocked((v) => !v)}
            title={dayLocked ? "Unlock day" : "Lock entire day"}
          >
            <IconLock />
            {dayLocked ? "Day locked" : "Lock day"}
          </button>
          <button className="cm-back-btn" onClick={() => navigate(-1)} title="Back">←</button>
        </div>
      </div>

      {dayLocked && (
        <div className="cm-day-locked-banner">
          🔒 <strong>All bookings are locked</strong> for this day across all clinics.
          <button className="cc-reopen-btn" onClick={() => setDayLocked(false)}>Unlock</button>
        </div>
      )}

      {/* ── Week Strip ── */}
      <div className="cm-date-strip">
        <div className="cm-week-label">
          Week of {weekStart.toLocaleDateString("en-US", { month: "long", day: "numeric" })}
        </div>
        <div className="cm-dates">
          {week.map((d, i) => {
            const past = isBeforeToday(d);
            const tod  = isSameDay(d, today);
            const sel  = isSameDay(d, selectedDate);
            const hasClinics = clinics.some((c) => {
              const fullName = d.toLocaleDateString("en-US", { weekday: "long" });
              if (c.defaultDayMap?.[fullName]?.isActive === true) return true;
              const ws = getWeekStart(d); ws.setHours(0,0,0,0);
              const ov = (c.weeklyOverrides || []).find(
                o => new Date(o.weekStart).toISOString() === ws.toISOString()
              );
              return ov?.days?.some(od => od.day === fullName && od.isActive !== false) || false;
            });

            return (
              <button key={i}
                className={[
                  "cm-day-btn",
                  past ? "past" : "",
                  tod  ? "today" : "",
                  sel  ? "selected" : "",
                  !hasClinics && !loading ? "no-clinics" : "",
                ].join(" ")}
                onClick={() => setSelectedDate(new Date(d))}
              >
                <span className="cm-day-name">
                  {d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                </span>
                <span className="num">{d.getDate()}</span>
                {hasClinics && !past && <span className="cm-day-dot" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Selected day label ── */}
      <div className="cm-selected-day-label">
        <span className="cm-selected-day-text">
          {isPast ? "📅 " : isStartedToday ? "🟢 " : "📆 "}
          {fmtDateFull(selectedDate)}
        </span>
        {isPast         && <span className="cm-selected-day-badge cm-badge--past">Past</span>}
        {isStartedToday && <span className="cm-selected-day-badge cm-badge--today">Today</span>}
        {dayFullyClosed && !isPast && !loading && (
          <span className="cm-selected-day-badge cm-badge--closed"><IconLock /> No clinics</span>
        )}
      </div>

      {loading  && <div className="cm-loading"><span className="cm-loading-spinner" />Loading clinics...</div>}
      {fetchError && <div className="cm-fetch-error">{fetchError}</div>}

      {/* ── Break Times ── */}
      {!loading && (
        <BreakTimesSection
          breaks={breaks} onBreaksChange={setBreaks}
          enabled={breaksEnabled} onToggle={() => setBreaksEnabled((v) => !v)}
        />
      )}

      {/* ── Clinic Cards ── */}
      {!loading && (
        <div className="cm-clinics-grid">
          {clinicsWithDay.length === 0 && (
            <div className="cm-no-clinics">
              <p>No clinics found. Add clinic IDs as props to load them.</p>
            </div>
          )}

          {/* Regular + override-opened clinics (resolveDay handles both) */}
          {scheduledClinics.map((clinic) => (
            <ClinicCard
              key={clinic.id}
              clinic={clinic}
              selectedDate={selectedDate}
              daySettings={resolveDay(clinic, selectedDate)}
              isActiveDayLocked={dayLocked}
              isPast={isPast}
              isStartedToday={isStartedToday}
              onUpdate={updateClinic}
              onSave={handleSaveClinic}
              breaks={activeBreaks}
              allClinics={clinicsWithDay}
              token={token}
              isExtraDay={false}
            />
          ))}

          {/* No clinics card — shown when day is empty */}
          {dayFullyClosed && !loading && (
            <NoClinicsCard
              selectedDate={selectedDate}
              isPast={isPast}
              onOpenDay={() => setShowOpenDayModal(true)}
            />
          )}

          {/* Add another clinic for this day (only if some clinics exist but not all are active) */}
          {!dayFullyClosed && !isPast && clinics.length > scheduledClinics.length && (
            <button className="cc-add-extra-clinic-btn" onClick={() => setShowOpenDayModal(true)}>
              <IconPlus />
              Add another clinic for this day
            </button>
          )}
        </div>
      )}

      {/* ── Open Day Modal ── */}
      {showOpenDayModal && (
        <OpenDayModal
          selectedDate={selectedDate}
          allClinics={clinicsWithDay}
          onConfirm={handleOpenExtraDay}
          onClose={() => setShowOpenDayModal(false)}
        />
      )}
    </div>
  );
}