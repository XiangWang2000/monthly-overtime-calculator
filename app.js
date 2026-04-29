const config = window.OvertimeAppConfig;
const shared = window.OvertimeAppShared;
const calendarData = window.OvertimeCalendarData;
const calendarDomain = window.OvertimeCalendarDomain;
const summaryModule = window.OvertimeSummary;
const viewFormatters = window.OvertimeViewFormatters;

const {
  APP_TITLE,
  DAY_TYPES,
  WEEKDAYS,
  DEFAULT_MIN_YEAR,
  DEFAULT_SALARY,
  STORE_KEY,
  ELEMENT_IDS,
  WEEKDAY_OVERTIME,
  SUMMARY_DEBOUNCE_MS,
  TOAST_DURATION_MS,
} = config;

const {
  readStorage,
  writeStorage,
  parseDateKey,
  dateKey,
  isDateKey,
  numberFromInput,
  toInteger,
  clamp,
  cleanText,
  escapeHtml,
  getCalendarStart,
  addDays,
} = shared;

const state = {
  holidayMap: new Map(),
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
  els.weekdayGrid.innerHTML = WEEKDAYS.map((day) => `<div class="weekday">${day}</div>`).join("");
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
  state.holidayMap = calendarDomain.buildHolidayMap(rows);
  updateCalendarBounds();
  clampCurrentCalendar();
  setStatus(message || `已載入行事曆資料，共 ${state.holidayMap.size.toLocaleString()} 筆。`);
  renderAll();
}

function updateCalendarBounds() {
  const bounds = calendarDomain.getYearBounds(state.holidayMap, state.today);
  state.minYear = bounds.minYear;
  state.maxYear = bounds.maxYear;
}

function useWeekendFallback(message, toastMessage = "") {
  state.holidayMap = new Map();
  updateCalendarBounds();
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
    const rows = calendarData.parseImportedCalendarText(await file.text());
    if (!rows.length) {
      throw new Error("沒有找到可用的行事曆資料。");
    }
    calendarData.writeStoredCalendarRows(rows);
    applyCalendarRowsAndRender(rows, `已匯入政府行事曆快取，共 ${rows.length.toLocaleString()} 筆。`);
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
    const metaText = calendarDomain.getCellMetaText(day, info, state.month);
    const entryText = viewFormatters.formatDayEntryText(entry);

    cells.push(`
      <button class="${getDayCellClasses({ isOtherMonth, info, entry, key, todayKey }).join(" ")}" type="button" data-date="${key}" aria-label="${viewFormatters.formatDayAriaLabel({ dateKey: key, metaText, entryText })}">
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
    const inferredType = selected ? calendarDomain.inferDayType(getCalendarInfo(selected), selected) : WEEKDAY_OVERTIME;
    els.dayTypeInput.value = inferredType;
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
  if (!selected) {
    els.selectedInfo.textContent = "";
    return;
  }

  const info = getCalendarInfo(selected);
  els.selectedInfo.textContent = viewFormatters.formatSelectedInfo({
    selectedDate: state.selectedDate,
    info,
    dayType: els.dayTypeInput.value,
  });
}

function saveSelectedEntry() {
  const hours = clamp(toInteger(els.hoursInput.value, 0), 0, 24);
  const minutes = clamp(toInteger(els.minutesInput.value, 0), 0, 59);
  els.hoursInput.value = String(hours);
  els.minutesInput.value = String(minutes);

  const totalMinutes = hours * 60 + minutes;
  if (totalMinutes === 0) {
    delete state.entries[state.selectedDate];
  } else {
    state.entries[state.selectedDate] = {
      dayType: DAY_TYPES.includes(els.dayTypeInput.value) ? els.dayTypeInput.value : WEEKDAY_OVERTIME,
      minutes: totalMinutes,
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
  const normalized = calendarDomain.normalizeYearMonth(year, month, state.minYear, state.maxYear);
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

function clampCurrentCalendar() {
  const normalized = calendarDomain.normalizeYearMonth(state.year, state.month, state.minYear, state.maxYear);
  state.year = normalized.year;
  state.month = normalized.month;
}

function getCalendarInfo(day) {
  return calendarDomain.getCalendarInfo(state.holidayMap, day);
}

function scheduleSummaryUpdate() {
  window.clearTimeout(state.summaryTimer);
  state.summaryTimer = window.setTimeout(updateSummary, SUMMARY_DEBOUNCE_MS);
}

function updateSummary() {
  state.salary = els.salaryInput.value;
  saveUserState();

  const summary = summaryModule.summarizeMonth({
    year: state.year,
    month: state.month,
    entries: state.entries,
    salary: numberFromInput(state.salary),
  });

  const summaryTexts = viewFormatters.formatSummaryTexts(summary);
  els.resultText.textContent = summaryTexts.resultText;
  els.breakdownText.textContent = summaryTexts.breakdownText;
  els.warningText.textContent = summaryTexts.warningText;
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
  }, TOAST_DURATION_MS);
}
