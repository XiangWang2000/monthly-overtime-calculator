(function initOvertimeViewFormatters() {
  const config = window.OvertimeAppConfig;
  const shared = window.OvertimeAppShared;
  const summaryModule = window.OvertimeSummary;

  if (!config || !shared || !summaryModule) {
    throw new Error("config.js, shared.js, and summary.js are required before view-formatters.js");
  }

  const { DAY_TYPES } = config;
  const { WARNING_CODES } = summaryModule;
  const { formatMonthDay, minutesToText, money, escapeHtml } = shared;

  window.OvertimeViewFormatters = {
    formatSelectedInfo,
    formatDayEntryText,
    formatDayAriaLabel,
    formatSummaryTexts,
  };

  function formatSelectedInfo({ selectedDate, info, dayType }) {
    return [
      selectedDate,
      info.name,
      info.category,
      info.description,
      `目前類型：${dayType}`,
    ].filter(Boolean).join("\n");
  }

  function formatDayEntryText(entry) {
    return entry && entry.minutes > 0 ? `加班 ${minutesToText(entry.minutes)}` : "";
  }

  function formatDayAriaLabel({ dateKey, metaText, entryText }) {
    return escapeHtml([dateKey, metaText, entryText].filter(Boolean).join(" "));
  }

  function formatSummaryTexts(summary) {
    if (!summary.salaryValid) {
      return {
        resultText: "請輸入月薪",
        breakdownText: "",
        warningText: "",
      };
    }

    return {
      resultText: `加班費：${money(summary.totalPay)} 元\n本月薪資試算：${money(summary.monthlyTotal)} 元`,
      breakdownText: formatSummaryBreakdown(summary),
      warningText: formatWarnings(summary.warnings),
    };
  }

  function formatSummaryBreakdown(summary) {
    const lines = [`平日每小時工資：${money(summary.hourlyWage)} 元`];

    for (const dayType of DAY_TYPES) {
      const totalMinutes = summary.totalsByType[dayType];
      const subtotal = summary.subtotalsByType[dayType];
      if (totalMinutes || subtotal) {
        lines.push(`${dayType}：${minutesToText(totalMinutes)}，${money(subtotal)} 元`);
      }
    }

    if (lines.length === 1) {
      lines.push("尚未輸入本月加班資料。");
    }

    lines.push(`46小時計入：${minutesToText(summary.extensionMinutes)}`);
    return lines.join("\n");
  }

  function formatWarnings(warnings) {
    const messages = warnings.map((warning) => {
      switch (warning.code) {
        case WARNING_CODES.WEEKDAY_LIMIT:
          return `${formatMonthDay(warning.dateKey)} 平日加班超過4小時，請確認是否符合一日上限。`;
        case WARNING_CODES.REST_DAY_LIMIT:
          return `${formatMonthDay(warning.dateKey)} 休息日出勤超過12小時，請確認是否合法。`;
        case WARNING_CODES.REGULAR_DAY_WORK:
          return `${formatMonthDay(warning.dateKey)} 例假出勤通常限天災、事變或突發事件。`;
        case WARNING_CODES.MONTHLY_EXTENSION_LIMIT:
          return "平日加班加休息日出勤已超過每月46小時。";
        case WARNING_CODES.MAX_MONTHLY_EXTENSION_LIMIT:
          return "已超過每月54小時，通常即使有勞資會議或工會同意也不得超過。";
        default:
          return "";
      }
    }).filter(Boolean);

    return [...new Set(messages)].join("\n");
  }
}());
