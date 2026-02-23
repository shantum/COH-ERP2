/**
 * Attendance Calculation — pure functions
 *
 * Exception-based: only leaves are stored. Sundays are visual-only (don't affect salary math).
 */

/** Returns a Set of day-of-month numbers that are Sundays */
export function getSundays(month: number, year: number): Set<number> {
  const sundays = new Set<number>();
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month - 1, day).getDay() === 0) {
      sundays.add(day);
    }
  }
  return sundays;
}

interface LeaveForCalc {
  type: string; // "absent" | "half_day"
}

export function calculatePayableDays(
  daysInMonth: number,
  leaves: LeaveForCalc[],
): { fullDayLeaves: number; halfDayLeaves: number; payableDays: number } {
  let fullDayLeaves = 0;
  let halfDayLeaves = 0;

  for (const leave of leaves) {
    if (leave.type === 'absent') fullDayLeaves++;
    else if (leave.type === 'half_day') halfDayLeaves++;
  }

  const payableDays = Math.max(0, daysInMonth - fullDayLeaves - halfDayLeaves * 0.5);
  return { fullDayLeaves, halfDayLeaves, payableDays };
}
