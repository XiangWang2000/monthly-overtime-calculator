(function initOvertimeSummary() {
  const shared = window.OvertimeAppShared;

  if (!shared) {
    throw new Error("OvertimeAppShared is required before overtime-summary.js");
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
    pad2,
    formatMonthDay,
    minutesToText,
    money,
    numberFromInput,
  } = shared;

  window.OvertimeSummary = {
    summarizeMonthEntries,
  };

  function summarizeMonthEntries({ year, month, entries, salaryInput }) {
    const salary = numberFromInput(salaryInput);
    if (!Number.isFinite(salary) || salary < 0) {
      return {
        resultText: "請輸入月薪",
        breakdownText: "",
        warningText: "",
      };
    }

    const hourlyWage = salary / HOURLY_DIVISOR;
    const totals = createDayTypeMap();
    const subtotal = createDayTypeMap();
    const warnings = [];
    let totalPay = 0;

    for (const [key, entry] of monthEntries(year, month, entries)) {
      const normalizedEntry = normalizeEntry(entry);
      totals[normalizedEntry.dayType] += normalizedEntry.minutes;

      const pay = calculateEntryPay(hourlyWage, normalizedEntry);
      subtotal[normalizedEntry.dayType] += pay;
      totalPay += pay;

      if (normalizedEntry.dayType === WEEKDAY_OVERTIME && normalizedEntry.minutes > WEEKDAY_WARNING_LIMIT) {
        warnings.push(`${formatMonthDay(key)} 平日加班超過4小時，請確認是否符合一日上限。`);
      }
      if (normalizedEntry.dayType === REST_DAY_OVERTIME && normalizedEntry.minutes > REST_DAY_WARNING_LIMIT) {
        warnings.push(`${formatMonthDay(key)} 休息日出勤超過12小時，請確認是否合法。`);
      }
      if (normalizedEntry.dayType === REGULAR_DAY_WORK) {
        warnings.push(`${formatMonthDay(key)} 例假出勤通常限天災、事變或突發事件。`);
      }
    }

    const extensionMinutes = totals[WEEKDAY_OVERTIME] + totals[REST_DAY_OVERTIME];
    if (extensionMinutes > MONTHLY_EXTENSION_LIMIT) {
      warnings.push("平日加班加休息日出勤已超過每月46小時。");
    }
    if (extensionMinutes > MAX_MONTHLY_EXTENSION_LIMIT) {
      warnings.push("已超過每月54小時，通常即使有勞資會議或工會同意也不得超過。");
    }

    const detailLines = [`平日每小時工資：${money(hourlyWage)} 元`];
    for (const dayType of DAY_TYPES) {
      if (totals[dayType] || subtotal[dayType]) {
        detailLines.push(`${dayType}：${minutesToText(totals[dayType])}，${money(subtotal[dayType])} 元`);
      }
    }
    if (detailLines.length === 1) {
      detailLines.push("尚未輸入本月加班資料。");
    }
    detailLines.push(`46小時計入：${minutesToText(extensionMinutes)}`);

    const monthlyTotal = salary + totalPay;
    return {
      resultText: `加班費：${money(totalPay)} 元\n本月薪資試算：${money(monthlyTotal)} 元`,
      breakdownText: detailLines.join("\n"),
      warningText: [...new Set(warnings)].join("\n"),
    };
  }

  function createDayTypeMap() {
    return Object.fromEntries(DAY_TYPES.map((type) => [type, 0]));
  }

  function monthEntries(year, month, entries) {
    const prefix = `${year}-${pad2(month)}-`;
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
