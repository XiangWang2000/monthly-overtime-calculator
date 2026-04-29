const APP_TITLE = "月度加班費試算";
const DATASET_URL = "https://data.ntpc.gov.tw/api/datasets/308DCD75-6434-45BC-A95F-584DA4FED251/json?page=0&size=10000";
const DGPA_DATASET_PAGE = "https://data.gov.tw/dataset/14718?page=3";
const HOURLY_DIVISOR = 240;
const DAY_TYPES = ["平日加班", "休息日加班", "國定假日/特休出勤", "例假出勤"];
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const DEFAULT_MIN_YEAR = 2017;
const DEFAULT_SALARY = "30000";
const STORE_KEY = "overtime-calendar-static-v1";
const CALENDAR_STORE_KEY = "overtime-calendar-static-cache-v1";
const WEEKDAY_OVERTIME = DAY_TYPES[0];
const REST_DAY_OVERTIME = DAY_TYPES[1];
const HOLIDAY_WORK = DAY_TYPES[2];
const REGULAR_DAY_WORK = DAY_TYPES[3];
const ELEMENT_IDS = [
  "pageTitle",
  "yearInput",
  "monthInput",
  "refreshCalendar",
  "todayButton",
  "cacheFile",
  "statusText",
  "weekdayGrid",
  "calendarGrid",
  "selectedInfo",
  "salaryInput",
  "dayTypeInput",
  "hoursInput",
  "minutesInput",
  "saveDay",
  "clearDay",
  "resultText",
  "breakdownText",
  "warningText",
  "toast",
];
const WEEKDAY_WARNING_LIMIT = 240;
const REST_DAY_WARNING_LIMIT = 720;
const MONTHLY_EXTENSION_LIMIT = 46 * 60;
const MAX_MONTHLY_EXTENSION_LIMIT = 54 * 60;

const state = {
  holidayData: new Map(),
  entries: {},
  salary: DEFAULT_SALARY,
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  selectedDate: dateKey(new Date()),
  minYear: DEFAULT_MIN_YEAR,
  maxYear: new Date().getFullYear(),
  today: new Date(),
  summaryTimer: 0,
  toastTimer: 0,
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  populateStaticControls();
  bindEvents();
  loadUserState();
  renderAll();
  await loadCalendar(false);
  renderAll();
}

function bindElements() {
  ELEMENT_IDS.forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function populateStaticControls() {
  document.title = APP_TITLE;
  els.pageTitle.textContent = APP_TITLE;
  renderWeekdayHeaders();
  els.dayTypeInput.innerHTML = DAY_TYPES.map((type) => `<option value="${escapeHtml(type)}">${type}</option>`).join("");
  els.salaryInput.value = DEFAULT_SALARY;
}

function bindEvents() {
  els.yearInput.addEventListener("change", applyYearMonthInputs);
  els.monthInput.addEventListener("change", applyYearMonthInputs);
  els.refreshCalendar.addEventListener("click", () => loadCalendar(true));
  els.todayButton.addEventListener("click", goToday);
  els.cacheFile.addEventListener("change", importCalendarFile);
  els.calendarGrid.addEventListener("click", handleCalendarClick);
  els.salaryInput.addEventListener("input", () => {
    state.salary = els.salaryInput.value;
    saveUserState();
    scheduleSummaryUpdate();
  });
  els.dayTypeInput.addEventListener("change", updatePreviewText);
  els.hoursInput.addEventListener("input", updatePreviewText);
  els.minutesInput.addEventListener("input", updatePreviewText);
  els.saveDay.addEventListener("click", saveSelectedEntry);
  els.clearDay.addEventListener("click", clearSelectedEntry);
}

function renderWeekdayHeaders() {
  els.weekdayGrid.innerHTML = WEEKDAYS.map((day) => `<div class="weekday">${day}</div>`).join("");
}

function handleCalendarClick(event) {
  const cell = event.target.closest(".day-cell");
  if (!cell || !els.calendarGrid.contains(cell)) {
    return;
  }
  selectDay(cell.dataset.date);
}

function loadUserState() {
  try {
    const saved = JSON.parse(readStorage(STORE_KEY, "{}"));
    if (saved && typeof saved === "object") {
      if (cleanText(saved.salary)) {
        state.salary = cleanText(saved.salary);
      }
      if (saved.entries && typeof saved.entries === "object") {
        state.entries = saved.entries;
      }
      if (isDateKey(saved.selectedDate)) {
        state.selectedDate = saved.selectedDate;
        const selected = parseDateKey(saved.selectedDate);
        if (selected) {
          state.year = selected.getFullYear();
          state.month = selected.getMonth() + 1;
        }
      }
    }
  } catch {
    state.entries = {};
  }
  els.salaryInput.value = state.salary;
}

function saveUserState() {
  writeStorage(
    STORE_KEY,
    JSON.stringify({
      salary: state.salary,
      entries: state.entries,
      selectedDate: state.selectedDate,
    }),
  );
}

function readStoredCalendarRows() {
  try {
    const rows = JSON.parse(readStorage(CALENDAR_STORE_KEY, "[]"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function loadCalendar(refresh) {
  if (refresh) {
    await refreshCalendar();
    return;
  }
  await loadInitialCalendar();
}

async function loadInitialCalendar() {
  const storedRows = readStoredCalendarRows();
  if (storedRows.length) {
    applyCalendarRowsAndRender(storedRows, `已載入瀏覽器本機快取，共 ${storedRows.length.toLocaleString()} 筆。`);
    return;
  }

  try {
    const bundledRows = await fetchBundledCalendarRows();
    applyCalendarRowsAndRender(bundledRows, `已載入隨附行事曆快取，共 ${bundledRows.length.toLocaleString()} 筆。`);
  } catch (bundledError) {
    try {
      const remoteRows = await fetchAndStoreRemoteCalendarRows();
      applyCalendarRowsAndRender(remoteRows, `已載入線上政府行事曆，共 ${remoteRows.length.toLocaleString()} 筆。`);
    } catch (remoteError) {
      useWeekendFallback(`無法讀取隨附快取或線上資料，改用週末備援：${remoteError.message || bundledError.message}`);
    }
  }
}

async function refreshCalendar() {
  setStatus("正在嘗試線上更新政府行事曆...");
  try {
    const remoteRows = await fetchAndStoreRemoteCalendarRows();
    applyCalendarRowsAndRender(remoteRows, `已更新線上政府行事曆，共 ${remoteRows.length.toLocaleString()} 筆。`);
    showToast("行事曆已更新");
  } catch (error) {
    const storedRows = readStoredCalendarRows();
    if (storedRows.length) {
      applyCalendarRowsAndRender(storedRows, `線上更新失敗，沿用本機快取：${error.message}`);
      showToast("線上更新失敗，沿用本機快取");
      return;
    }

    try {
      const bundledRows = await fetchBundledCalendarRows();
      applyCalendarRowsAndRender(bundledRows, `線上更新失敗，改載入隨附快取：${error.message}`);
      showToast("線上更新失敗，改載入隨附快取");
    } catch (bundledError) {
      useWeekendFallback(`無法讀取快取或線上資料，改用週末備援：${bundledError.message || error.message}`, "已改用週末備援");
    }
  }
}

function applyCalendarRowsAndRender(rows, message) {
  applyCalendarRows(rows, message);
  renderAll();
}

function useWeekendFallback(message, toastMessage = "") {
  state.holidayData = new Map();
  state.minYear = DEFAULT_MIN_YEAR;
  state.maxYear = state.today.getFullYear();
  setStatus(message);
  renderAll();
  if (toastMessage) {
    showToast(toastMessage);
  }
}

async function fetchAndStoreRemoteCalendarRows() {
  const remoteRows = await fetchRemoteCalendarRows();
  writeStorage(CALENDAR_STORE_KEY, JSON.stringify(remoteRows));
  return remoteRows;
}

async function fetchBundledCalendarRows() {
  const response = await fetch("./行政機關辦公日曆快取.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error("隨附快取格式不正確。");
  }
  return rows;
}

async function fetchRemoteCalendarRows() {
  const page = await fetchText(DGPA_DATASET_PAGE);
  const links = extractDgpaCsvLinks(page);
  if (!links.length) {
    throw new Error("資料集頁面沒有找到 CSV 連結。");
  }

  const merged = new Map();
  for (const link of links) {
    const csvText = await fetchText(link);
    const rows = parseDgpaCsv(csvText);
    for (const row of rows) {
      merged.set(row.date, row);
    }
  }

  if (!merged.size) {
    try {
      return await fetchNtpcCalendarRows();
    } catch {
      throw new Error("沒有讀到任何線上行事曆資料。");
    }
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchNtpcCalendarRows() {
  const text = await fetchText(DATASET_URL);
  const payload = JSON.parse(text);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.value)
      ? payload.value
      : [];
  return rows
    .map((row) => {
      const dateText = normalizeRawDate(row.date);
      if (!dateText) {
        return null;
      }
      return {
        date: dateText,
        name: cleanText(row.name),
        isholiday: isYes(row.isholiday) ? "是" : "否",
        holidaycategory: cleanText(row.holidaycategory),
        description: cleanText(row.description),
      };
    })
    .filter(Boolean);
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "";
  const charset = (contentType.match(/charset=([^;]+)/i) || [])[1];
  const encodings = charset ? [charset, "utf-8", "big5"] : ["utf-8", "big5"];
  return decodeBuffer(buffer, encodings);
}

function decodeBuffer(buffer, encodings) {
  const seen = new Set();
  for (const encoding of encodings) {
    const label = cleanText(encoding).toLowerCase();
    if (!label || seen.has(label)) {
      continue;
    }
    seen.add(label);
    try {
      return new TextDecoder(label, { fatal: true }).decode(buffer);
    } catch {
      continue;
    }
  }
  return new TextDecoder("utf-8").decode(buffer);
}

function extractDgpaCsvLinks(pageHtml) {
  const links = [];
  const patterns = [
    /href=["']([^"']*FileConversion[^"']+?\.csv[^"']*)["']/gi,
    /https:\/\/www\.dgpa\.gov\.tw\/FileConversion[^"'<>\s]+?\.csv[^"'<>\s]*/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(pageHtml)) !== null) {
      links.push(match[1] || match[0]);
    }
  }
  const seen = new Set();
  const cleaned = [];
  for (const raw of links) {
    const decoded = decodeHtml(raw);
    const absolute = decoded.startsWith("/") ? `https://www.dgpa.gov.tw${decoded}` : decoded;
    if (!absolute.toLowerCase().includes("www.dgpa.gov.tw")) {
      continue;
    }
    if (decodeURIComponentSafe(absolute).toLowerCase().includes("google")) {
      continue;
    }
    if (!seen.has(absolute)) {
      seen.add(absolute);
      cleaned.push(absolute);
    }
  }
  return cleaned;
}

function parseDgpaCsv(text) {
  const table = parseCsv(text);
  if (table.length < 2) {
    return [];
  }
  const headers = table[0].map((item) => cleanText(item).replace(/^\ufeff/, ""));
  const rows = [];
  for (const cells of table.slice(1)) {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cleanText(cells[index]);
    });
    const rawDate = normalizeRawDate(row["西元日期"]);
    if (!rawDate) {
      continue;
    }
    const day = dateFromCompact(rawDate);
    const note = cleanText(row["備註"]);
    const holiday = isYes(row["是否放假"]);
    let category = "";
    if (day.getDay() === 0 || day.getDay() === 6) {
      category = holiday ? "星期六、星期日" : "補行上班";
    } else if (holiday) {
      category = note ? "放假之紀念日及節日" : "放假日";
    }
    rows.push({
      date: rawDate,
      name: note,
      isholiday: holiday ? "是" : "否",
      holidaycategory: category,
      description: "",
    });
  }
  return rows;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function applyCalendarRows(rows, message) {
  const map = new Map();
  for (const row of rows) {
    const info = normalizeCalendarRow(row);
    if (!info) {
      continue;
    }
    map.set(info.key, info);
  }
  state.holidayData = map;
  updateYearBoundsFromCalendar();
  clampCurrentCalendar();
  setStatus(message || `已載入行事曆資料，共 ${map.size.toLocaleString()} 筆。`);
}

async function importCalendarFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) {
      throw new Error("JSON 根節點必須是陣列。");
    }
    const validRows = rows.map(normalizeCalendarRow).filter(Boolean);
    if (!validRows.length) {
      throw new Error("沒有找到可用的行事曆資料。");
    }
    writeStorage(CALENDAR_STORE_KEY, JSON.stringify(rows));
    applyCalendarRows(rows, `已匯入政府行事曆快取，共 ${validRows.length.toLocaleString()} 筆。`);
    renderAll();
    showToast("快取已匯入");
  } catch (error) {
    setStatus(`匯入失敗：${error.message}`);
    showToast("匯入失敗");
  } finally {
    event.target.value = "";
  }
}

function renderAll() {
  clampCurrentCalendar();
  renderControls();
  renderCalendar();
  loadSelectedEntryToForm();
  scheduleSummaryUpdate();
}

function renderControls() {
  els.yearInput.value = String(state.year);
  els.monthInput.value = String(state.month);
  els.yearInput.min = String(state.minYear);
  els.yearInput.max = String(state.maxYear);
  els.monthInput.min = "1";
  els.monthInput.max = "12";
}

function renderCalendar() {
  const todayKey = dateKey(state.today);
  const start = getCalendarStart(state.year, state.month);
  const cells = [];
  for (let offset = 0; offset < 42; offset += 1) {
    const day = addDays(start, offset);
    const key = dateKey(day);
    const info = getCalendarInfo(day);
    const entry = state.entries[key];
    const isOtherMonth = day.getMonth() + 1 !== state.month;
    const metaText = cellMetaText(day, info);
    const entryText = entry && entry.minutes > 0 ? `加班 ${minutesToText(entry.minutes)}` : "";
    cells.push(`
      <button class="${getDayCellClasses({ isOtherMonth, info, entry, key, todayKey }).join(" ")}" type="button" data-date="${key}" aria-label="${escapeHtml(`${key} ${metaText}`)}">
        <span class="day-number">${day.getDate()}</span>
        <span class="day-meta">${escapeHtml(metaText)}</span>
        <span class="day-entry">${escapeHtml(entryText)}</span>
      </button>
    `);
  }
  els.calendarGrid.innerHTML = cells.join("");
}

function getDayCellClasses({ isOtherMonth, info, entry, key, todayKey }) {
  const classes = ["day-cell"];
  if (isOtherMonth) classes.push("is-other-month");
  if (!isOtherMonth && info.isHoliday) classes.push("is-holiday");
  if (!isOtherMonth && !info.isHoliday && info.category) classes.push("is-workday");
  if (entry && entry.minutes > 0) classes.push("has-entry");
  if (key === todayKey) classes.push("is-today");
  if (key === state.selectedDate) classes.push("is-selected");
  return classes;
}

function loadSelectedEntryToForm() {
  const selected = parseDateKey(state.selectedDate);
  const entry = state.entries[state.selectedDate];
  if (entry && DAY_TYPES.includes(entry.dayType)) {
    els.dayTypeInput.value = entry.dayType;
    setDayDurationInputs(entry.minutes);
  } else {
    els.dayTypeInput.value = inferDayType(selected);
    setDayDurationInputs(0);
  }
  els.salaryInput.value = state.salary;
  updatePreviewText();
}

function setDayDurationInputs(totalMinutes) {
  els.hoursInput.value = String(Math.floor(totalMinutes / 60));
  els.minutesInput.value = String(totalMinutes % 60);
}

function updatePreviewText() {
  const selected = parseDateKey(state.selectedDate);
  const info = getCalendarInfo(selected);
  const pieces = [
    state.selectedDate,
    info.name,
    info.category,
    info.description,
    `目前類型：${els.dayTypeInput.value}`,
  ].filter(Boolean);
  els.selectedInfo.textContent = pieces.join("\n");
}

function saveSelectedEntry() {
  const hours = clamp(toInteger(els.hoursInput.value, 0), 0, 24);
  const minutes = clamp(toInteger(els.minutesInput.value, 0), 0, 59);
  els.hoursInput.value = String(hours);
  els.minutesInput.value = String(minutes);
  const total = hours * 60 + minutes;
  if (total === 0) {
    delete state.entries[state.selectedDate];
  } else {
    state.entries[state.selectedDate] = {
      dayType: DAY_TYPES.includes(els.dayTypeInput.value) ? els.dayTypeInput.value : WEEKDAY_OVERTIME,
      minutes: total,
    };
  }
  saveUserState();
  renderCalendar();
  updatePreviewText();
  scheduleSummaryUpdate();
  showToast("已儲存此日");
}

function clearSelectedEntry() {
  delete state.entries[state.selectedDate];
  saveUserState();
  loadSelectedEntryToForm();
  renderCalendar();
  scheduleSummaryUpdate();
  showToast("已清除此日");
}

function selectDay(key) {
  if (!isDateKey(key)) {
    return;
  }
  state.selectedDate = key;
  const selected = parseDateKey(key);
  state.year = selected.getFullYear();
  state.month = selected.getMonth() + 1;
  saveUserState();
  renderAll();
}

function applyYearMonthInputs() {
  const year = toInteger(els.yearInput.value, state.year);
  const month = toInteger(els.monthInput.value, state.month);
  const normalized = normalizeYearMonth(year, month);
  state.year = normalized.year;
  state.month = normalized.month;
  clampSelectedToVisibleMonth();
  renderAll();
}

function goToday() {
  state.year = state.today.getFullYear();
  state.month = state.today.getMonth() + 1;
  state.selectedDate = dateKey(state.today);
  saveUserState();
  renderAll();
}

function clampSelectedToVisibleMonth() {
  const selected = parseDateKey(state.selectedDate);
  if (!selected || selected.getFullYear() !== state.year || selected.getMonth() + 1 !== state.month) {
    state.selectedDate = dateKey(new Date(state.year, state.month - 1, 1));
    saveUserState();
  }
}

function normalizeYearMonth(year, month) {
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
  if (normalizedYear < state.minYear) {
    return { year: state.minYear, month: 1 };
  }
  if (normalizedYear > state.maxYear) {
    return { year: state.maxYear, month: 12 };
  }
  return { year: normalizedYear, month: normalizedMonth };
}

function clampCurrentCalendar() {
  const normalized = normalizeYearMonth(state.year, state.month);
  state.year = normalized.year;
  state.month = normalized.month;
}

function getCalendarInfo(day) {
  return state.holidayData.get(dateKey(day)) || fallbackDayInfo(day);
}

function fallbackDayInfo(day) {
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

function inferDayType(day) {
  const info = getCalendarInfo(day);
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

function cellMetaText(day, info) {
  if (day.getMonth() + 1 !== state.month) {
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

function normalizeCalendarRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const rawDate = normalizeRawDate(row.date);
  if (!rawDate) {
    return null;
  }
  const day = dateFromCompact(rawDate);
  if (!day) {
    return null;
  }
  return {
    key: dateKey(day),
    rawDate,
    name: cleanText(row.name),
    category: cleanText(row.holidaycategory),
    description: cleanText(row.description),
    isHoliday: isYes(row.isholiday),
    source: "快取",
  };
}

function updateYearBoundsFromCalendar() {
  const currentYear = state.today.getFullYear();
  const years = [...state.holidayData.values()]
    .map((info) => Number(info.rawDate.slice(0, 4)))
    .filter((year) => Number.isInteger(year));
  state.minYear = years.length ? Math.min(...years) : DEFAULT_MIN_YEAR;
  state.maxYear = years.length ? Math.max(currentYear, Math.max(...years)) : currentYear;
}

function getCalendarStart(year, month) {
  const first = new Date(year, month - 1, 1);
  return addDays(first, -first.getDay());
}

function addDays(day, count) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + count);
}

function scheduleSummaryUpdate() {
  window.clearTimeout(state.summaryTimer);
  state.summaryTimer = window.setTimeout(updateSummary, 80);
}

function updateSummary() {
  state.salary = els.salaryInput.value;
  saveUserState();
  const salary = numberFromInput(state.salary);
  if (!Number.isFinite(salary) || salary < 0) {
    els.resultText.textContent = "請輸入月薪";
    els.breakdownText.textContent = "";
    els.warningText.textContent = "";
    return;
  }

  const hourlyWage = salary / HOURLY_DIVISOR;
  const totals = Object.fromEntries(DAY_TYPES.map((type) => [type, 0]));
  const subtotal = Object.fromEntries(DAY_TYPES.map((type) => [type, 0]));
  const warnings = [];
  let totalPay = 0;

  for (const [key, entry] of monthEntries()) {
    const normalizedEntry = normalizeEntry(entry);
    if (!normalizedEntry) {
      continue;
    }
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
  els.resultText.textContent = `加班費：${money(totalPay)} 元\n本月薪資試算：${money(monthlyTotal)} 元`;
  els.breakdownText.textContent = detailLines.join("\n");
  els.warningText.textContent = [...new Set(warnings)].join("\n");
}

function monthEntries() {
  const prefix = `${state.year}-${pad2(state.month)}-`;
  return Object.entries(state.entries)
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

function setStatus(message) {
  els.statusText.textContent = message;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 1800);
}
