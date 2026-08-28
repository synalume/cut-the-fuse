// dates.js — deterministic local-date helpers for the daily challenge.
// All values are in the player's local timezone; a "day" is a calendar day.

/** "YYYY-MM-DD" for a given date (default: now). */
export function todayStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Whole calendar days since the Unix epoch, in LOCAL time. */
export function dayNumber(d = new Date()) {
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

/** "YYYY-MM-DD" of the day before a "YYYY-MM-DD" string. */
export function yesterdayOf(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const t = new Date(y, m - 1, d);
    t.setDate(t.getDate() - 1);
    return todayStr(t);
}
