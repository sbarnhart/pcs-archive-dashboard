/**
 * PCS SALES BY HOUR — HOLIDAY PLANNING — v1.0
 *
 * Standalone Google Apps Script for a Google Sheet.
 * Pulls read-only PCS order data in resumable batches, converts PCS UTC
 * timestamps to America/Los_Angeles, and builds holiday/hour planning views.
 *
 * VERSION HISTORY
 * v1.0 — initial resumable API backfill, hourly data, holiday calendar,
 *        holiday overview, logs, and automatic continuation triggers.
 *
 * REQUIRED SCRIPT PROPERTIES
 * PCS_FACILITY_ID   36-character PCS facility UUID
 * PCS_COMPANY_ID    PCS company ID (for example 636)
 *
 * OPTIONAL SCRIPT PROPERTIES
 * PCS_API_BASE_URL  defaults to https://api.partycs.com
 * PCS_START_DATE    defaults to 2013-01-01
 * PCS_END_DATE      defaults to today
 */

const SBH = Object.freeze({
  VERSION: '1.0',
  TZ: 'America/Los_Angeles',
  WINDOW_DAYS: 14,
  PAGE_SIZE: 100,
  MAX_RUNTIME_MS: 4.5 * 60 * 1000,
  TABS: {
    OVERVIEW: 'Holiday Overview',
    CALENDAR: 'Holiday Calendar',
    HOURLY: 'All Hourly Data',
    CACHE: 'Order Cache',
    METHOD: 'Method and Sources',
    LOG: 'Sales By Hour Log',
  },
  STATE_KEYS: {
    ACTIVE: 'SBH_ACTIVE',
    WINDOW_START: 'SBH_WINDOW_START',
    PAGE: 'SBH_PAGE',
    END: 'SBH_END',
  },
});

function onOpen() {
  SpreadsheetApp.getUi().createMenu('PCS Sales By Hour')
    .addItem('1. Setup tabs', 'setupSalesByHour')
    .addItem('2. Start/resume historical backfill', 'startSalesByHourBackfill')
    .addItem('Run one batch now', 'runSalesByHourBatch')
    .addItem('Rebuild holiday views', 'rebuildSalesByHourViews')
    .addSeparator()
    .addItem('Stop automatic backfill', 'stopSalesByHourBackfill')
    .addItem('Show sync status', 'showSalesByHourStatus')
    .addToUi();
}

function setupSalesByHour() {
  const ss = SpreadsheetApp.getActive();
  const definitions = [
    [SBH.TABS.OVERVIEW, ['Year','Holiday','Holiday Date','Weekday','Holiday Sales','15-Day Sales','Orders','Peak Date','Peak-Day Sales','Peak Hour','Peak-Hour Sales']],
    [SBH.TABS.CALENDAR, ['Year','Holiday','Offset','Date','Weekday','Orders','Daily Sales'].concat(hourLabels_(8, 23)).concat(['Other Hours'])],
    [SBH.TABS.HOURLY, ['Date','Hour','Orders','Sales']],
    [SBH.TABS.CACHE, ['Order ID','Order Number','Order Date','Close Date','Close Hour','Sales','Status','Cancelled','Source Window','Synced At']],
    [SBH.TABS.METHOD, ['Topic','Rule','Source','Limitation']],
    [SBH.TABS.LOG, ['Timestamp','Function','Status','Details']],
  ];

  definitions.forEach(([name, headers]) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader_(sh.getRange(1, 1, 1, headers.length));
    sh.setFrozenRows(1);
  });

  const method = ss.getSheetByName(SBH.TABS.METHOD);
  method.getRange(2, 1, 7, 4).setValues([
    ['Version', `PCS Sales By Hour v${SBH.VERSION}`, 'This Apps Script project', 'Update this row and the file header when the script changes.'],
    ['Sales', 'Non-cancelled closed order total, grouped by PCS close hour.', 'https://api.partycs.com/orders', 'Planning estimate; PCS may apply additional tag, item, discount, void, or refund rules.'],
    ['Time zone', 'PCS close timestamps are treated as UTC and converted to America/Los_Angeles.', 'PCS order dateClosed field', 'This corrects the missing timezone marker returned by PCS.'],
    ['Holiday window', 'Seven days before through seven days after each holiday.', 'Built-in US holiday rules', 'School breaks and local events are not included yet.'],
    ['Backfill', 'Fourteen order-date days per window; pages resume automatically.', 'PCS orders API', 'A full historical backfill can take many trigger runs.'],
    ['Cache', 'One row per order returned during this backfill.', SBH.TABS.CACHE, 'Starting a new backfill clears the cache to avoid duplicates.'],
    ['Use', 'Staffing, operating hours, promotions, and inventory planning.', 'Holiday Overview and Holiday Calendar', 'Not an accounting closeout or tax report.'],
  ]);
  method.getRange('A:D').setWrap(true);
  method.setColumnWidths(1, 1, 145);
  method.setColumnWidths(2, 1, 420);
  method.setColumnWidths(3, 1, 350);
  method.setColumnWidths(4, 1, 420);
  ss.getSheetByName(SBH.TABS.CACHE).hideSheet();
  logSalesByHour_('setupSalesByHour', 'OK', `PCS Sales By Hour v${SBH.VERSION} tabs created`);
  SpreadsheetApp.getUi().alert('Setup complete. Add the required Script Properties, then run “Start/resume historical backfill.”');
}

function startSalesByHourBackfill() {
  validateConfiguration_();
  ensureTabs_();
  const props = PropertiesService.getScriptProperties();
  const start = props.getProperty('PCS_START_DATE') || '2013-01-01';
  const end = props.getProperty('PCS_END_DATE') || Utilities.formatDate(new Date(), SBH.TZ, 'yyyy-MM-dd');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('PCS_START_DATE and PCS_END_DATE must use YYYY-MM-DD.');
  }

  const cache = SpreadsheetApp.getActive().getSheetByName(SBH.TABS.CACHE);
  if (cache.getLastRow() > 1) cache.getRange(2, 1, cache.getLastRow() - 1, cache.getLastColumn()).clearContent();
  props.setProperties({
    [SBH.STATE_KEYS.ACTIVE]: 'true',
    [SBH.STATE_KEYS.WINDOW_START]: start,
    [SBH.STATE_KEYS.PAGE]: '1',
    [SBH.STATE_KEYS.END]: end,
  });
  installContinuationTrigger_();
  logSalesByHour_('startSalesByHourBackfill', 'STARTED', `${start} through ${end}`);
  runSalesByHourBatch();
}

function runSalesByHourBatch() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    validateConfiguration_();
    ensureTabs_();
    const started = Date.now();
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(SBH.STATE_KEYS.ACTIVE) !== 'true') return;

    const finalEnd = props.getProperty(SBH.STATE_KEYS.END);
    let windowStart = props.getProperty(SBH.STATE_KEYS.WINDOW_START);
    let page = Number(props.getProperty(SBH.STATE_KEYS.PAGE) || 1);
    const cache = SpreadsheetApp.getActive().getSheetByName(SBH.TABS.CACHE);
    let appended = 0;

    while (Date.now() - started < SBH.MAX_RUNTIME_MS && windowStart <= finalEnd) {
      const windowEnd = minYmd_(addDaysYmd_(windowStart, SBH.WINDOW_DAYS - 1), finalEnd);
      const payload = pcsGet_('/orders', {
        OrderDateStart: `${windowStart}T00:00:00.000Z`,
        OrderDateEnd: `${windowEnd}T23:59:59.999Z`,
        Sort: 'orderId_asc',
        Page: page,
        Size: SBH.PAGE_SIZE,
      });
      const orders = payload.items || payload.Items || [];
      const now = new Date();
      const rows = orders.map(orderCacheRow_(windowStart, windowEnd, now)).filter(Boolean);
      if (rows.length) {
        cache.getRange(cache.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        appended += rows.length;
      }

      const hasNext = Boolean(payload.hasNextPage ?? payload.HasNextPage);
      if (hasNext) {
        page += 1;
      } else {
        windowStart = addDaysYmd_(windowEnd, 1);
        page = 1;
      }
      props.setProperty(SBH.STATE_KEYS.WINDOW_START, windowStart);
      props.setProperty(SBH.STATE_KEYS.PAGE, String(page));
    }

    if (windowStart > finalEnd) {
      props.setProperty(SBH.STATE_KEYS.ACTIVE, 'false');
      removeContinuationTriggers_();
      rebuildSalesByHourViews();
      logSalesByHour_('runSalesByHourBatch', 'COMPLETE', `${cache.getLastRow() - 1} cached orders; holiday views rebuilt`);
    } else {
      installContinuationTrigger_();
      logSalesByHour_('runSalesByHourBatch', 'PAUSED', `${appended} rows added; next ${windowStart}, page ${page}`);
    }
  } catch (error) {
    logSalesByHour_('runSalesByHourBatch', 'ERROR', String(error && error.stack || error));
    installContinuationTrigger_();
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function stopSalesByHourBackfill() {
  PropertiesService.getScriptProperties().setProperty(SBH.STATE_KEYS.ACTIVE, 'false');
  removeContinuationTriggers_();
  logSalesByHour_('stopSalesByHourBackfill', 'STOPPED', 'Automatic continuation trigger removed');
}

function showSalesByHourStatus() {
  const p = PropertiesService.getScriptProperties();
  const cache = SpreadsheetApp.getActive().getSheetByName(SBH.TABS.CACHE);
  SpreadsheetApp.getUi().alert([
    `Active: ${p.getProperty(SBH.STATE_KEYS.ACTIVE) === 'true' ? 'Yes' : 'No'}`,
    `Next window: ${p.getProperty(SBH.STATE_KEYS.WINDOW_START) || 'not started'}`,
    `Next page: ${p.getProperty(SBH.STATE_KEYS.PAGE) || '1'}`,
    `End date: ${p.getProperty(SBH.STATE_KEYS.END) || 'not set'}`,
    `Cached orders: ${cache ? Math.max(0, cache.getLastRow() - 1).toLocaleString() : 0}`,
  ].join('\n'));
}

function rebuildSalesByHourViews() {
  ensureTabs_();
  const ss = SpreadsheetApp.getActive();
  const cache = ss.getSheetByName(SBH.TABS.CACHE);
  const hourly = {};
  const chunk = 20000;
  for (let row = 2; row <= cache.getLastRow(); row += chunk) {
    const count = Math.min(chunk, cache.getLastRow() - row + 1);
    const values = cache.getRange(row, 1, count, 10).getValues();
    values.forEach(record => {
      const closeDate = record[3];
      const hour = Number(record[4]);
      const sales = Number(record[5]) || 0;
      const cancelled = record[7] === true || String(record[7]).toLowerCase() === 'true';
      if (!closeDate || cancelled || hour < 0 || hour > 23) return;
      const day = Utilities.formatDate(new Date(closeDate), SBH.TZ, 'yyyy-MM-dd');
      const key = `${day}|${hour}`;
      if (!hourly[key]) hourly[key] = { day, hour, orders: 0, sales: 0 };
      hourly[key].orders += 1;
      hourly[key].sales += sales;
    });
  }

  const hourlyRows = Object.values(hourly).sort((a, b) => a.day.localeCompare(b.day) || a.hour - b.hour);
  const hourlySheet = ss.getSheetByName(SBH.TABS.HOURLY);
  hourlySheet.clearContents();
  hourlySheet.getRange(1, 1, 1, 4).setValues([['Date','Hour','Orders','Sales']]);
  styleHeader_(hourlySheet.getRange(1, 1, 1, 4));
  if (hourlyRows.length) hourlySheet.getRange(2, 1, hourlyRows.length, 4).setValues(hourlyRows.map(r => [ymdToDate_(r.day), `${pad2_(r.hour)}:00`, r.orders, r.sales]));
  hourlySheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');
  hourlySheet.getRange('D:D').setNumberFormat('$#,##0.00');

  const daily = {};
  hourlyRows.forEach(row => {
    if (!daily[row.day]) daily[row.day] = { orders: 0, sales: 0, hours: Array(24).fill(0) };
    daily[row.day].orders += row.orders;
    daily[row.day].sales += row.sales;
    daily[row.day].hours[row.hour] += row.sales;
  });
  const days = Object.keys(daily).sort();
  if (!days.length) throw new Error('No closed-order hourly data is available in Order Cache.');
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const holidayRows = buildHolidayRows_(daily, firstDay, lastDay);
  writeHolidayCalendar_(ss.getSheetByName(SBH.TABS.CALENDAR), holidayRows);
  writeHolidayOverview_(ss.getSheetByName(SBH.TABS.OVERVIEW), holidayRows, firstDay, lastDay);
  logSalesByHour_('rebuildSalesByHourViews', 'OK', `${hourlyRows.length} hourly rows; ${firstDay} through ${lastDay}`);
}

function orderCacheRow_(windowStart, windowEnd, syncedAt) {
  return order => {
    const id = order.orderId || order.id;
    if (!id) return null;
    const status = Number(order.statusCode ?? order.status ?? 0);
    const cancelled = Boolean(order.cancelDate || order.isDeleted || status === 6);
    const closed = pcsUtcToPacific_(order.dateClosed);
    return [
      String(id), order.orderNumber || '', order.orderDate || '', closed ? closed.date : '', closed ? closed.hour : '',
      Math.max(0, Number(order.orderTotal || 0)), status, cancelled, `${windowStart} to ${windowEnd}`, syncedAt,
    ];
  };
}

function pcsUtcToPacific_(value) {
  if (!value) return null;
  const text = String(value);
  const instant = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
  if (isNaN(instant.getTime())) return null;
  return { date: Utilities.formatDate(instant, SBH.TZ, 'yyyy-MM-dd'), hour: Number(Utilities.formatDate(instant, SBH.TZ, 'H')) };
}

function buildHolidayRows_(daily, firstDay, lastDay) {
  const firstYear = Number(firstDay.slice(0, 4));
  const lastYear = Number(lastDay.slice(0, 4));
  const rows = [];
  for (let year = firstYear; year <= lastYear; year++) {
    holidaysForYear_(year).forEach(holiday => {
      if (holiday.day < firstDay || holiday.day > lastDay) return;
      for (let offset = -7; offset <= 7; offset++) {
        const date = addDays_(holiday.date, offset);
        const day = Utilities.formatDate(date, SBH.TZ, 'yyyy-MM-dd');
        const data = daily[day] || { orders: 0, sales: 0, hours: Array(24).fill(0) };
        rows.push({ year, holiday: holiday.name, holidayDate: holiday.date, offset, date, day, orders: data.orders, sales: data.sales, hours: data.hours });
      }
    });
  }
  return rows;
}

function writeHolidayCalendar_(sheet, rows) {
  const hours = Array.from({ length: 16 }, (_, i) => i + 8);
  sheet.clear();
  const headers = ['Year','Holiday','Offset','Date','Weekday','Orders','Daily Sales'].concat(hours.map(h => `${pad2_(h)}:00`)).concat(['Other Hours']);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleHeader_(sheet.getRange(1, 1, 1, headers.length));
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows.map(r => [
    r.year, r.holiday, r.offset, r.date, Utilities.formatDate(r.date, SBH.TZ, 'EEE'), r.orders, r.sales,
    ...hours.map(h => r.hours[h]), r.hours.slice(0, 8).reduce((a, b) => a + b, 0),
  ]));
  sheet.getRange('D:D').setNumberFormat('mmm d, yyyy');
  sheet.getRange(2, 7, Math.max(1, rows.length), 18).setNumberFormat('$#,##0');
  if (rows.length) {
    const heat = sheet.getRange(2, 8, rows.length, 17);
    const rule = SpreadsheetApp.newConditionalFormatRule().setGradientMinpoint('#FFFFFF').setGradientMidpoint('#BFDBFE').setGradientMaxpoint('#1D4ED8').setRanges([heat]).build();
    sheet.setConditionalFormatRules([rule]);
  }
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(5);
  sheet.autoResizeColumns(1, headers.length);
}

function writeHolidayOverview_(sheet, rows, firstDay, lastDay) {
  const groups = {};
  rows.forEach(r => {
    const key = `${r.year}|${r.holiday}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });
  const summary = Object.values(groups).map(group => {
    const holiday = group.find(r => r.offset === 0);
    const peakDay = group.reduce((best, r) => r.sales > best.sales ? r : best, group[0]);
    const hourTotals = Array(24).fill(0);
    group.forEach(r => r.hours.forEach((value, h) => hourTotals[h] += value));
    const peakHour = hourTotals.indexOf(Math.max.apply(null, hourTotals));
    return [holiday.year, holiday.holiday, holiday.holidayDate, Utilities.formatDate(holiday.holidayDate, SBH.TZ, 'EEEE'), holiday.sales,
      group.reduce((sum, r) => sum + r.sales, 0), group.reduce((sum, r) => sum + r.orders, 0), peakDay.date, peakDay.sales,
      `${pad2_(peakHour)}:00`, hourTotals[peakHour]];
  }).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  sheet.clear();
  sheet.getRange('A1:K1').merge().setValue(`Holiday sales by hour — PCS API v${SBH.VERSION}`).setFontSize(16).setFontWeight('bold').setFontColor('#172554');
  sheet.getRange('A2:K2').merge().setValue(`Closed archived orders from ${firstDay} through ${lastDay}; each holiday window covers seven days before through seven days after.`).setFontStyle('italic').setFontColor('#475569');
  const headers = ['Year','Holiday','Holiday Date','Weekday','Holiday Sales','15-Day Sales','Orders','Peak Date','Peak-Day Sales','Peak Hour','Peak-Hour Sales'];
  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
  styleHeader_(sheet.getRange(4, 1, 1, headers.length));
  if (summary.length) sheet.getRange(5, 1, summary.length, headers.length).setValues(summary);
  sheet.getRange('C:C').setNumberFormat('mmm d, yyyy');
  sheet.getRange('H:H').setNumberFormat('mmm d, yyyy');
  sheet.getRange('E:F').setNumberFormat('$#,##0');
  sheet.getRange('I:I').setNumberFormat('$#,##0');
  sheet.getRange('K:K').setNumberFormat('$#,##0');
  sheet.setFrozenRows(4);
  sheet.autoResizeColumns(1, headers.length);
}

function pcsGet_(endpoint, params) {
  const props = PropertiesService.getScriptProperties();
  const base = (props.getProperty('PCS_API_BASE_URL') || 'https://api.partycs.com').replace(/\/$/, '');
  const query = Object.keys(params).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join('&');
  const options = {
    method: 'get', muteHttpExceptions: true,
    headers: {
      accept: 'application/json',
      'pcs-facility-id': props.getProperty('PCS_FACILITY_ID'),
      'pcs-company-id': props.getProperty('PCS_COMPANY_ID'),
    },
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = UrlFetchApp.fetch(`${base}${endpoint}?${query}`, options);
    const status = response.getResponseCode();
    if (status >= 200 && status < 300) return JSON.parse(response.getContentText() || 'null');
    if ([429, 500, 502, 503, 504].indexOf(status) < 0) throw new Error(`PCS ${status} on ${endpoint}: ${response.getContentText().slice(0, 500)}`);
    Utilities.sleep(Math.min(Math.pow(2, attempt) * 1000, 30000));
  }
  throw new Error(`PCS request failed after retries: ${endpoint}`);
}

function installContinuationTrigger_() {
  removeContinuationTriggers_();
  ScriptApp.newTrigger('runSalesByHourBatch').timeBased().after(60 * 1000).create();
}

function removeContinuationTriggers_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'runSalesByHourBatch').forEach(t => ScriptApp.deleteTrigger(t));
}

function ensureTabs_() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SBH.TABS).forEach(key => {
    if (!ss.getSheetByName(SBH.TABS[key])) throw new Error(`Missing ${SBH.TABS[key]} tab. Run setupSalesByHour first.`);
  });
}

function validateConfiguration_() {
  const props = PropertiesService.getScriptProperties();
  ['PCS_FACILITY_ID','PCS_COMPANY_ID'].forEach(key => {
    if (!props.getProperty(key)) throw new Error(`Missing Script Property: ${key}`);
  });
}

function logSalesByHour_(fn, status, details) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SBH.TABS.LOG);
  if (sh) sh.appendRow([new Date(), fn, status, details]);
}

function styleHeader_(range) {
  range.setBackground('#1E3A8A').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
}

function hourLabels_(start, end) { return Array.from({ length: end - start + 1 }, (_, i) => `${pad2_(start + i)}:00`); }
function pad2_(value) { return String(value).padStart(2, '0'); }
function minYmd_(a, b) { return a < b ? a : b; }
function ymdToDate_(ymd) { const p = ymd.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
function addDaysYmd_(ymd, days) { return Utilities.formatDate(addDays_(ymdToDate_(ymd), days), SBH.TZ, 'yyyy-MM-dd'); }
function addDays_(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function nthWeekday_(year, month, weekday, nth) { const d = new Date(year, month, 1, 12); d.setDate(1 + ((7 + weekday - d.getDay()) % 7) + (nth - 1) * 7); return d; }
function lastWeekday_(year, month, weekday) { const d = new Date(year, month + 1, 0, 12); d.setDate(d.getDate() - ((7 + d.getDay() - weekday) % 7)); return d; }

function easterSunday_(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(year,month-1,day,12);
}

function holidaysForYear_(year) {
  const thanksgiving = nthWeekday_(year, 10, 4, 4);
  return [
    ["New Year's Day",new Date(year,0,1,12)],['Martin Luther King Jr. Day',nthWeekday_(year,0,1,3)],['Presidents Day',nthWeekday_(year,1,1,3)],
    ['Easter',easterSunday_(year)],["Mother's Day",nthWeekday_(year,4,0,2)],['Memorial Day',lastWeekday_(year,4,1)],
    ["Father's Day",nthWeekday_(year,5,0,3)],['Independence Day',new Date(year,6,4,12)],['Labor Day',nthWeekday_(year,8,1,1)],
    ['Halloween',new Date(year,9,31,12)],['Veterans Day',new Date(year,10,11,12)],['Thanksgiving',thanksgiving],
    ['Black Friday',addDays_(thanksgiving,1)],['Christmas Eve',new Date(year,11,24,12)],['Christmas Day',new Date(year,11,25,12)],
    ["New Year's Eve",new Date(year,11,31,12)],
  ].map(row => ({ name: row[0], date: row[1], day: Utilities.formatDate(row[1], SBH.TZ, 'yyyy-MM-dd') }));
}
