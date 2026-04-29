(function initOvertimeCalendarData() {
  const config = window.OvertimeAppConfig;
  const shared = window.OvertimeAppShared;

  if (!config || !shared) {
    throw new Error("config.js and shared.js are required before calendar-data.js");
  }

  const {
    BUNDLED_CALENDAR_PATH,
    DATASET_URL,
    DGPA_DATASET_PAGE,
    CALENDAR_STORE_KEY,
  } = config;

  const {
    readStorage,
    writeStorage,
    cleanText,
    normalizeRawDate,
    isYes,
    dateFromCompact,
    decodeHtml,
    decodeURIComponentSafe,
  } = shared;

  window.OvertimeCalendarData = {
    readStoredCalendarRows,
    writeStoredCalendarRows,
    fetchBundledCalendarRows,
    fetchAndStoreRemoteCalendarRows,
    parseImportedCalendarText,
  };

  function readStoredCalendarRows() {
    try {
      const rows = JSON.parse(readStorage(CALENDAR_STORE_KEY, "[]"));
      return parseCalendarRows(rows, "本機快取");
    } catch {
      return [];
    }
  }

  function writeStoredCalendarRows(rows) {
    return writeStorage(CALENDAR_STORE_KEY, JSON.stringify(rows));
  }

  async function fetchBundledCalendarRows() {
    const response = await fetch(BUNDLED_CALENDAR_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
      throw new Error("隨附快取格式不正確。");
    }
    return parseCalendarRows(rows, "隨附快取");
  }

  async function fetchAndStoreRemoteCalendarRows() {
    const rows = await fetchRemoteCalendarRows();
    writeStoredCalendarRows(rows);
    return rows;
  }

  function parseImportedCalendarText(text) {
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("JSON 解析失敗。");
    }

    if (!Array.isArray(payload)) {
      throw new Error("JSON 根節點必須是陣列。");
    }

    return parseCalendarRows(payload, "匯入");
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
        merged.set(row.rawDate, row);
      }
    }

    if (!merged.size) {
      try {
        return await fetchNtpcCalendarRows();
      } catch {
        throw new Error("沒有讀到任何線上行事曆資料。");
      }
    }

    return [...merged.values()].sort((a, b) => a.rawDate.localeCompare(b.rawDate));
  }

  async function fetchNtpcCalendarRows() {
    const text = await fetchText(DATASET_URL);
    const payload = JSON.parse(text);
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.value)
        ? payload.value
        : [];

    return parseCalendarRows(rows, "線上資料");
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
      const name = cleanText(row["備註"]);
      const isHoliday = isYes(row["是否放假"]);
      let category = "";

      if (day.getDay() === 0 || day.getDay() === 6) {
        category = isHoliday ? "星期六、星期日" : "補行上班";
      } else if (isHoliday) {
        category = name ? "放假之紀念日及節日" : "放假日";
      }

      rows.push({
        rawDate,
        name,
        category,
        description: "",
        isHoliday,
        source: "線上資料",
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
        if (char === "\"" && next === "\"") {
          value += "\"";
          index += 1;
        } else if (char === "\"") {
          quoted = false;
        } else {
          value += char;
        }
      } else if (char === "\"") {
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

  function parseCalendarRows(rows, defaultSource) {
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows
      .map((row) => normalizeCalendarRow(row, defaultSource))
      .filter(Boolean);
  }

  function normalizeCalendarRow(row, defaultSource) {
    if (!row || typeof row !== "object") {
      return null;
    }

    const rawDate = normalizeRawDate(row.rawDate || row.date);
    if (!rawDate) {
      return null;
    }

    return {
      rawDate,
      name: cleanText(row.name),
      category: cleanText(row.category || row.holidaycategory),
      description: cleanText(row.description),
      isHoliday: typeof row.isHoliday === "boolean" ? row.isHoliday : isYes(row.isholiday),
      source: cleanText(row.source) || defaultSource,
    };
  }
}());
