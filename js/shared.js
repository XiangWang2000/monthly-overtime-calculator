(function initOvertimeAppShared() {
  const DAY_TYPES = ["平日加班", "休息日加班", "國定假日/特休出勤", "例假出勤"];
  const shared = {
    APP_TITLE: "月度加班費試算",
    DATASET_URL: "https://data.ntpc.gov.tw/api/datasets/308DCD75-6434-45BC-A95F-584DA4FED251/json?page=0&size=10000",
    DGPA_DATASET_PAGE: "https://data.gov.tw/dataset/14718?page=3",
    HOURLY_DIVISOR: 240,
    DAY_TYPES,
    WEEKDAYS: ["日", "一", "二", "三", "四", "五", "六"],
    DEFAULT_MIN_YEAR: 2017,
    DEFAULT_SALARY: "30000",
    STORE_KEY: "overtime-calendar-static-v1",
    CALENDAR_STORE_KEY: "overtime-calendar-static-cache-v1",
    WEEKDAY_OVERTIME: DAY_TYPES[0],
    REST_DAY_OVERTIME: DAY_TYPES[1],
    HOLIDAY_WORK: DAY_TYPES[2],
    REGULAR_DAY_WORK: DAY_TYPES[3],
    WEEKDAY_WARNING_LIMIT: 240,
    REST_DAY_WARNING_LIMIT: 720,
    MONTHLY_EXTENSION_LIMIT: 46 * 60,
    MAX_MONTHLY_EXTENSION_LIMIT: 54 * 60,
    readStorage,
    writeStorage,
    parseDateKey,
    dateFromCompact,
    dateKey,
    compactDate,
    normalizeRawDate,
    isDateKey,
    formatMonthDay,
    minutesToText,
    money,
    numberFromInput,
    pad2,
    toInteger,
    clamp,
    cleanText,
    isYes,
    decodeHtml,
    decodeURIComponentSafe,
    escapeHtml,
    getCalendarStart,
    addDays,
  };

  window.OvertimeAppShared = shared;

  function readStorage(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function parseDateKey(value) {
    const text = cleanText(value);
    if (!isDateKey(text)) {
      return null;
    }
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function dateFromCompact(value) {
    const text = normalizeRawDate(value);
    if (!text) {
      return null;
    }
    return new Date(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)));
  }

  function dateKey(day) {
    return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`;
  }

  function compactDate(day) {
    return `${day.getFullYear()}${pad2(day.getMonth() + 1)}${pad2(day.getDate())}`;
  }

  function normalizeRawDate(value) {
    const text = cleanText(value).replace(/[/-]/g, "");
    return /^\d{8}$/.test(text) ? text : "";
  }

  function isDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
  }

  function formatMonthDay(key) {
    return key.slice(5).replace("-", "/");
  }

  function minutesToText(minutes) {
    const total = Math.max(0, Math.floor(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours && mins) {
      return `${hours}小時${mins}分`;
    }
    if (hours) {
      return `${hours}小時`;
    }
    if (mins) {
      return `${mins}分`;
    }
    return "0小時";
  }

  function money(value) {
    return Number(value || 0).toLocaleString("zh-TW", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function numberFromInput(value) {
    return Number(String(value || "").replace(/,/g, "").trim());
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function toInteger(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function cleanText(value) {
    return value == null ? "" : String(value).trim();
  }

  function isYes(value) {
    return ["是", "true", "1", "2", "y", "yes"].includes(cleanText(value).toLowerCase());
  }

  function decodeHtml(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function decodeURIComponentSafe(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getCalendarStart(year, month) {
    const first = new Date(year, month - 1, 1);
    return addDays(first, -first.getDay());
  }

  function addDays(day, count) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() + count);
  }
}());
