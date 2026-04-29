const shared = window.OvertimeAppShared;
const calendarData = window.OvertimeCalendarData;
const overtimeSummary = window.OvertimeSummary;

const {
  APP_TITLE,
  DAY_TYPES,
  WEEKDAYS,
  DEFAULT_MIN_YEAR,
  DEFAULT_SALARY,
  STORE_KEY,
  WEEKDAY_OVERTIME,
  REST_DAY_OVERTIME,
  HOLIDAY_WORK,
  REGULAR_DAY_WORK,
  readStorage,
  writeStorage,
  parseDateKey,
  dateKey,
  isDateKey,
  minutesToText,
  pad2,
  toInteger,
  clamp,
  cleanText,
  escapeHtml,
  getCalendarStart,
  addDays,
} = shared;

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
  els.salaryInput.addEventListener("input", handleSalaryInput);
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

function handleSalaryInput() {
  state.salary = els.salaryInput.value;
  saveUserState();
  scheduleSummaryUpdate();
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

async function loadCalendar(refresh) {
  if (refresh) {
    await refreshCalendar();
    return;
  }
  await loadInitialCalendar();
}

async function loadInitialCalendar() {
  const storedRows = calendarData.readStoredCalendarRows();
  if (storedRows.length) {
    applyCalendarRowsAndRender(storedRows, `已載入瀏覽器本機快取，共 ${storedRows.length.toLocaleString()} 筆。`);
    return;
  }

  try {
    const bundledRows = await calendarData.fetchBundledCalendarRows();
    applyCalendarRowsAndRender(bundledRows, `已載入隨附行事曆快取，共 ${bundledRows.length.toLocaleString()} 筆。`);
  } catch (bundledError) {
    try {
      const remoteRows = await calendarData.fetchAndStoreRemoteCalendarRows();
      applyCalendarRowsAndRender(remoteRows, `已載入線上政府行事曆，共 ${remoteRows.length.toLocaleString()} 筆。`);
    } catch (remoteError) {
      useWeekendFallback(`無法讀取隨附快取或線上資料，改用週末備援：${remoteError.message || bundledError.message}`);
    }
  }
}

async function refreshCalendar() {
  setStatus("正在嘗試線上更新政府行事曆...");
  try {
    const remoteRows = await calendarData.fetchAndStoreRemoteCalendarRows();
    applyCalendarRowsAndRender(remoteRows, `已更新線上政府行事曆，共 ${remoteRows.length.toLocaleString()} 筆。`);
    showToast("行事曆已更新");
  } catch (error) {
    const storedRows = calendarData.readStoredCalendarRows();
    if (storedRows.length) {
      applyCalendarRowsAndRender(storedRows, `線上更新失敗，沿用本機快取：${error.message}`);
      showToast("線上更新失敗，沿用本機快取");
      return;
    }

    try {
      const bundledRows = await calendarData.fetchBundledCalendarRows();
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

function applyCalendarRows(rows, message) {
  const map = new Map();
  for (const row of rows) {
    const info = calendarData.normalizeCalendarRow(row);
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

    const validRows = rows.map(calendarData.normalizeCalendarRow).filter(Boolean);
    if (!validRows.length) {
      throw new Error("沒有找到可用的行事曆資料。");
    }

    writeStorage(shared.CALENDAR_STORE_KEY, JSON.stringify(rows));
    applyCalendarRowsAndRender(rows, `已匯入政府行事曆快取，共 ${validRows.length.toLocaleString()} 筆。`);
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
  return state.holidayData.get(dateKey(day)) || calendarData.fallbackDayInfo(day);
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

function updateYearBoundsFromCalendar() {
  const currentYear = state.today.getFullYear();
  const years = [...state.holidayData.values()]
    .map((info) => Number(info.rawDate.slice(0, 4)))
    .filter((year) => Number.isInteger(year));

  state.minYear = years.length ? Math.min(...years) : DEFAULT_MIN_YEAR;
  state.maxYear = years.length ? Math.max(currentYear, Math.max(...years)) : currentYear;
}

function scheduleSummaryUpdate() {
  window.clearTimeout(state.summaryTimer);
  state.summaryTimer = window.setTimeout(updateSummary, 80);
}

function updateSummary() {
  state.salary = els.salaryInput.value;
  saveUserState();

  const summary = overtimeSummary.summarizeMonthEntries({
    year: state.year,
    month: state.month,
    entries: state.entries,
    salaryInput: state.salary,
  });

  els.resultText.textContent = summary.resultText;
  els.breakdownText.textContent = summary.breakdownText;
  els.warningText.textContent = summary.warningText;
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
