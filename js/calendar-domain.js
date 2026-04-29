(function initOvertimeCalendarDomain() {
  const config = window.OvertimeAppConfig;
  const shared = window.OvertimeAppShared;

  if (!config || !shared) {
    throw new Error("config.js and shared.js are required before calendar-domain.js");
  }

  const {
    DEFAULT_MIN_YEAR,
    WEEKDAY_OVERTIME,
    REST_DAY_OVERTIME,
    HOLIDAY_WORK,
    REGULAR_DAY_WORK,
  } = config;

  const {
    cleanText,
    dateFromCompact,
    dateKey,
    compactDate,
  } = shared;

  window.OvertimeCalendarDomain = {
    buildHolidayMap,
    getCalendarInfo,
    inferDayType,
    getCellMetaText,
    getYearBounds,
    normalizeYearMonth,
  };

  function buildHolidayMap(rows) {
    const map = new Map();

    for (const row of rows) {
      const day = dateFromCompact(row.rawDate);
      if (!day) {
        continue;
      }

      const key = dateKey(day);
      map.set(key, {
        key,
        rawDate: row.rawDate,
        name: cleanText(row.name),
        category: cleanText(row.category),
        description: cleanText(row.description),
        isHoliday: Boolean(row.isHoliday),
        source: cleanText(row.source) || "快取",
      });
    }

    return map;
  }

  function getCalendarInfo(holidayMap, day) {
    return holidayMap.get(dateKey(day)) || createFallbackInfo(day);
  }

  function inferDayType(info, day) {
    const combined = `${info.name} ${info.category} ${info.description}`;
    if (!info.isHoliday) {
      return WEEKDAY_OVERTIME;
    }
    if (info.name && info.name !== "例假日") {
      return HOLIDAY_WORK;
    }
    if (combined.includes("星期六") || combined.includes("星期日") || info.category === "週末") {
      return day.getDay() === 6 ? REST_DAY_OVERTIME : REGULAR_DAY_WORK;
    }
    return HOLIDAY_WORK;
  }

  function getCellMetaText(day, info, currentMonth) {
    if (day.getMonth() + 1 !== currentMonth) {
      return "";
    }
    if (info.name) {
      return info.name;
    }
    if (info.category) {
      if (!info.isHoliday && (day.getDay() === 0 || day.getDay() === 6)) {
        return "補班日";
      }
      if (info.category === "星期六、星期日") {
        return day.getDay() === 6 ? "休息日" : "例假";
      }
      return info.category;
    }
    return "平日";
  }

  function getYearBounds(holidayMap, today) {
    const years = [...holidayMap.values()]
      .map((info) => Number(info.rawDate.slice(0, 4)))
      .filter((year) => Number.isInteger(year));

    const currentYear = today.getFullYear();
    return {
      minYear: years.length ? Math.min(...years) : DEFAULT_MIN_YEAR,
      maxYear: years.length ? Math.max(currentYear, Math.max(...years)) : currentYear,
    };
  }

  function normalizeYearMonth(year, month, minYear, maxYear) {
    let normalizedYear = year;
    let normalizedMonth = month;

    while (normalizedMonth < 1) {
      normalizedMonth += 12;
      normalizedYear -= 1;
    }
    while (normalizedMonth > 12) {
      normalizedMonth -= 12;
      normalizedYear += 1;
    }
    if (normalizedYear < minYear) {
      return { year: minYear, month: 1 };
    }
    if (normalizedYear > maxYear) {
      return { year: maxYear, month: 12 };
    }
    return { year: normalizedYear, month: normalizedMonth };
  }

  function createFallbackInfo(day) {
    if (day.getDay() === 0 || day.getDay() === 6) {
      return {
        key: dateKey(day),
        rawDate: compactDate(day),
        name: "",
        isHoliday: true,
        category: "週末",
        description: "未取得政府資料時，以星期六、星期日作為假日備援。",
        source: "備援",
      };
    }

    return {
      key: dateKey(day),
      rawDate: compactDate(day),
      name: "",
      isHoliday: false,
      category: "",
      description: "",
      source: "備援",
    };
  }
}());
