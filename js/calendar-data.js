(function initOvertimeCalendarData() {
  const shared = window.OvertimeAppShared;

  if (!shared) {
    throw new Error("OvertimeAppShared is required before calendar-data.js");
  }

  const {
    DATASET_URL,
    DGPA_DATASET_PAGE,
    CALENDAR_STORE_KEY,
    readStorage,
    writeStorage,
    cleanText,
    normalizeRawDate,
    isYes,
    dateFromCompact,
    dateKey,
    compactDate,
    decodeHtml,
    decodeURIComponentSafe,
  } = shared;

  window.OvertimeCalendarData = {
    readStoredCalendarRows,
    fetchBundledCalendarRows,
    fetchAndStoreRemoteCalendarRows,
    normalizeCalendarRow,
    fallbackDayInfo,
  };

  function readStoredCalendarRows() {
    try {
      const rows = JSON.parse(readStorage(CALENDAR_STORE_KEY, "[]"));
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
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

  async function fetchAndStoreRemoteCalendarRows() {
    const rows = await fetchRemoteCalendarRows();
    writeStorage(CALENDAR_STORE_KEY, JSON.stringify(rows));
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
}());
