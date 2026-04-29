(function initOvertimeSummary() {
  const config = window.OvertimeAppConfig;

  if (!config) {
    throw new Error("config.js is required before summary.js");
  }

  const {
    DAY_TYPES,
    HOURLY_DIVISOR,
    WEEKDAY_OVERTIME,
    REST_DAY_OVERTIME,
    REGULAR_DAY_WORK,
    WEEKDAY_WARNING_LIMIT,
    REST_DAY_WARNING_LIMIT,
    MONTHLY_EXTENSION_LIMIT,
    MAX_MONTHLY_EXTENSION_LIMIT,
  } = config;

  const WARNING_CODES = {
    WEEKDAY_LIMIT: "WEEKDAY_LIMIT",
    REST_DAY_LIMIT: "REST_DAY_LIMIT",
    REGULAR_DAY_WORK: "REGULAR_DAY_WORK",
    MONTHLY_EXTENSION_LIMIT: "MONTHLY_EXTENSION_LIMIT",
    MAX_MONTHLY_EXTENSION_LIMIT: "MAX_MONTHLY_EXTENSION_LIMIT",
  };

  window.OvertimeSummary = {
    WARNING_CODES,
    summarizeMonth,
  };

  function summarizeMonth({ year, month, entries, salary }) {
    const emptyTotals = createDayTypeTotals();
    if (!Number.isFinite(salary) || salary < 0) {
      return {
        salaryValid: false,
        salary: 0,
        hourlyWage: 0,
        totalPay: 0,
        monthlyTotal: 0,
        extensionMinutes: 0,
        totalsByType: emptyTotals,
        subtotalsByType: createDayTypeTotals(),
        warnings: [],
      };
    }

    const hourlyWage = salary / HOURLY_DIVISOR;
    const totalsByType = createDayTypeTotals();
    const subtotalsByType = createDayTypeTotals();
    const warnings = [];
    let totalPay = 0;

    for (const [dateKey, entry] of monthEntries(year, month, entries)) {
      const normalizedEntry = normalizeEntry(entry);
      totalsByType[normalizedEntry.dayType] += normalizedEntry.minutes;

      const pay = calculateEntryPay(hourlyWage, normalizedEntry);
      subtotalsByType[normalizedEntry.dayType] += pay;
      totalPay += pay;

      if (normalizedEntry.dayType === WEEKDAY_OVERTIME && normalizedEntry.minutes > WEEKDAY_WARNING_LIMIT) {
        warnings.push({ code: WARNING_CODES.WEEKDAY_LIMIT, dateKey, minutes: normalizedEntry.minutes });
      }
      if (normalizedEntry.dayType === REST_DAY_OVERTIME && normalizedEntry.minutes > REST_DAY_WARNING_LIMIT) {
        warnings.push({ code: WARNING_CODES.REST_DAY_LIMIT, dateKey, minutes: normalizedEntry.minutes });
      }
      if (normalizedEntry.dayType === REGULAR_DAY_WORK) {
        warnings.push({ code: WARNING_CODES.REGULAR_DAY_WORK, dateKey, minutes: normalizedEntry.minutes });
      }
    }

    const extensionMinutes = totalsByType[WEEKDAY_OVERTIME] + totalsByType[REST_DAY_OVERTIME];
    if (extensionMinutes > MONTHLY_EXTENSION_LIMIT) {
      warnings.push({ code: WARNING_CODES.MONTHLY_EXTENSION_LIMIT, minutes: extensionMinutes });
    }
    if (extensionMinutes > MAX_MONTHLY_EXTENSION_LIMIT) {
      warnings.push({ code: WARNING_CODES.MAX_MONTHLY_EXTENSION_LIMIT, minutes: extensionMinutes });
    }

    return {
      salaryValid: true,
      salary,
      hourlyWage,
      totalPay,
      monthlyTotal: salary + totalPay,
      extensionMinutes,
      totalsByType,
      subtotalsByType,
      warnings,
    };
  }

  function createDayTypeTotals() {
    return Object.fromEntries(DAY_TYPES.map((type) => [type, 0]));
  }

  function monthEntries(year, month, entries) {
    const prefix = `${year}-${String(month).padStart(2, "0")}-`;
    return Object.entries(entries)
      .filter(([key, value]) => key.startsWith(prefix) && normalizeEntry(value))
      .sort(([a], [b]) => a.localeCompare(b));
  }

  function normalizeEntry(entry) {
    return !!(entry && DAY_TYPES.includes(entry.dayType) && Number(entry.minutes) > 0)
      ? { dayType: entry.dayType, minutes: Number(entry.minutes) }
      : null;
  }

  function calculateEntryPay(hourlyWage, entry) {
    if (entry.dayType === WEEKDAY_OVERTIME) {
      return weekdayOvertimePay(hourlyWage, entry.minutes);
    }
    if (entry.dayType === REST_DAY_OVERTIME) {
      return restDayOvertimePay(hourlyWage, entry.minutes);
    }
    return oneMoreDayPay(hourlyWage, entry.minutes);
  }

  function weekdayOvertimePay(hourlyWage, minutes) {
    const hours = minutes / 60;
    const first = Math.min(hours, 2);
    const second = Math.min(Math.max(hours - 2, 0), 2);
    const over = Math.max(hours - 4, 0);
    return hourlyWage * (first * 4 / 3 + second * 5 / 3 + over * 2);
  }

  function restDayOvertimePay(hourlyWage, minutes) {
    const hours = minutes / 60;
    const first = Math.min(hours, 2);
    const second = Math.min(Math.max(hours - 2, 0), 6);
    const over = Math.max(hours - 8, 0);
    return hourlyWage * (first * 4 / 3 + second * 5 / 3 + over * 8 / 3);
  }

  function oneMoreDayPay(hourlyWage, minutes) {
    return hourlyWage * (minutes / 60);
  }
}());
