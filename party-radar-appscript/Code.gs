/*********************************************************************
 * LAZERTAG EXTREME — PARTY RADAR — v2.6
 * Scope: PCS read-only API -> Google Sheet -> message queue (Outbox)
 * NO SMS IS SENT in this version. GoTo wiring comes in v2.
 * PCS is READ-ONLY. All fixes/charges go to "Recommended Changes".
 *
 * VERSION HISTORY:
 *  v1.0 — email watcher, parser, Outbox, daily run, reports
 *  v1.1 — HTML-email parser fix (asterisks), real-change-only Changes Log
 *  v1.2 — Archive tab + auto-archive of past/cancelled events
 *  v1.3 — Booked-date backfill, Change Requests tab, cleanupV12, reply-first wording
 *  v1.4 — Offers tab: customer-facing upsells appended to queued texts
 *  v1.5 — Recommended Changes self-audit, archiveNow() + louder archive logging
 *  v1.6 — diagnoseArchive(): read-only "why is this row still here" report
 *  v1.7 — sales capture (subtotal/tax/tip/total/payments), Line Items tab,
 *         quarter-by-quarter history backfill with self-verifying reconciliation,
 *         YoY/MoM Dashboard, archived-order dedupe + cancellation reclassify
 *  v1.8 — backfill files historical parties straight into Completed/Cancelled
 *         (no longer dumps them into Upcoming Events); batched archive sweep
 *  v1.9 — standalone Party Radar deployment; creates a separate spreadsheet in
 *         the dedicated Party Tracker folder and installs its spreadsheet menu trigger
 *  v2.0 — API-only ingestion; removes Gmail setup/triggers and syncs PCS before daily jobs
 *  v2.1 — removes remaining Gmail lookups and uses verified paged PCS field mapping
 *  v2.2 — avoids PCS combined-filter SQL timeouts with incremental order-type scans
 *  v2.3 — uses verified OrderDate windows after PCS OrderType queries also timed out
 *  v2.4 — labels disabled legacy email/backfill entry points in the function menu
 *  v2.5 — setup creates the Dashboard and the menu identifies the target spreadsheet
 *  v2.6 — pairs with accelerated PCS history discovery and corrected local event times
 *
 * INSTALL:
 * 1) script.google.com -> New project -> name it "Party Radar"
 * 2) Run setup() once, authorize when prompted
 * That's it. Triggers and spreadsheet tabs are created for you.
 *********************************************************************/


const CFG = {
  VERSION: '2.6',
  HISTORY_START_YEAR: 2024,      // earliest year to attempt in backfill
  FOLDER_ID: '1fGls7iwb4gElAasWPcj_wLybKCpwR4hB',   // Party Tracker project folder
  SS_NAME: 'Party Radar',
  PROTECTED_REFERENCE_SS_ID: '1CcSvio9FN1uKRtUd2vNvrFirFNFEHOReNqC94tm1C7Q',
  DATA_SOURCE: 'PCS_API',
  TZ: 'America/Los_Angeles',
  WAIVER_LINK: 'https://lazertagextreme.pcsparty.com/sign',
  VENUE_PHONE: '805-577-8400',
  VENUE_NAME: 'Lazertag Extreme',
  ALERT_DAYS: [14, 7, 5, 2],
};


const TABS = {
  EVENTS: 'Upcoming Events',
  COMPLETED: 'Completed Events',
  CANCELLED_TAB: 'Cancelled Events',
  OUTBOX: 'Outbox',
  MSGLOG: 'Message Log',
  CHANGES: 'Changes Log',
  RECS: 'Recommended Changes',
  REQUESTS: 'Change Requests',
  OFFERS: 'Offers',
  ITEMS: 'Line Items',
  BACKFILL: 'Backfill Log',
  DASH: 'Dashboard',
  CAPTAINS: 'Captains',
  RUNLOG: 'Run Log',
  SETTINGS: 'Settings',
};


const HEADERS = {
  [TABS.EVENTS]: ['Order #','Booked','Customer','Phone','Email','Address','Party Date','Party Time','Guest Count','Package','Add-Ons','Balance Due','Captain','Captain Report Sent','Last Contact','Contact Method','Alert Status','Flags','Upsell Suggestions','Status','Last Synced','Event Changes','Sub Total','Sales Tax','Tip','Total With Tip','Amount Paid','Payment Methods','Reversals','Item Count'],
  [TABS.OUTBOX]: ['Queued At','Order #','Customer','Phone','Message Type','Scheduled Send','Message Text','Status','Approved By','Sent At'],
  [TABS.MSGLOG]: ['Timestamp','Order #','Customer','Message Type','Direction','Channel','Status','Text'],
  [TABS.CHANGES]: ['Timestamp','Order #','Field','Old Value','New Value','Source'],
  [TABS.RECS]: ['Date','Order #','Customer','Type','Description','Status','Resolved By'],
  [TABS.REQUESTS]: ['Date','Order #','Customer','Phone','Request (raw text)','Category','Status','Handled By','Notes'],
  [TABS.OFFERS]: ['Offer Name','Message Text','Attach To','Condition','Active'],
  [TABS.ITEMS]: ['Order #','Party Date','Customer','Item','Qty','Unit Price','Line Total','Category','Source'],
  [TABS.BACKFILL]: ['Run At','Quarter','Emails','Orders','Parties','Storefront','Rows Written','Rows Updated','Line Items','Items $','Subtotals $','Verified','Notes'],
  [TABS.CAPTAINS]: ['Name','Phone','Email','Active'],
  [TABS.RUNLOG]: ['Timestamp','Function','Result','Details'],
  [TABS.SETTINGS]: ['Key','Value'],
};
HEADERS[TABS.COMPLETED] = HEADERS[TABS.EVENTS];   // mirrors Upcoming Events
HEADERS[TABS.CANCELLED_TAB] = HEADERS[TABS.EVENTS];


const DEFAULT_SETTINGS = [
  ['SENDING_ENABLED','FALSE'],          // master switch — stays FALSE until GoTo is wired
  ['SEND_WINDOW_START','9'],            // 9 AM
  ['SEND_WINDOW_END','19'],             // 7 PM
  ['AUTO_APPROVE_BOOKING_CONFIRMATION','FALSE'],
  ['AUTO_APPROVE_DAY15_DEPOSIT','FALSE'],
  ['AUTO_APPROVE_DAY7_GUEST_COUNT','FALSE'],
  ['AUTO_APPROVE_DAY6_CATERING','FALSE'],
  ['AUTO_APPROVE_DAY2_BALANCE','FALSE'],
  ['AUTO_APPROVE_DAY1_DETAILS','FALSE'],
  ['AUTO_APPROVE_DAY_AFTER_THANKS','FALSE'],
];


/******************** MESSAGE TEMPLATES ********************
 * Placeholders: {first} {customer} {date} {time} {count} {balance} {kid}
 * Edit wording here, or edit individual messages in the Outbox before approving.
 ***********************************************************/
const TEMPLATES = {
  BOOKING_CONFIRMATION:
    "Hi {first}! This is " + CFG.VENUE_NAME + " — your party on {date} at {time} is confirmed! " +
    "Save time on party day: have your guests sign waivers online now: " + CFG.WAIVER_LINK + " " +
    "Questions? Call " + CFG.VENUE_PHONE + ". Reply STOP to opt out.",
  DAY15_DEPOSIT:
    "Hi {first}, it's " + CFG.VENUE_NAME + ". Friendly reminder about your party on {date}: " +
    "if you need to reschedule, letting us know at least 14 days ahead keeps your deposit fully usable " +
    "toward a new date. Reply to this text or call " + CFG.VENUE_PHONE + " with any changes!",
  DAY7_GUEST_COUNT:
    "Hi {first}! One week until the big party on {date}! You're currently booked for {count} guests. " +
    "Expecting more? Extra guests are $50 each up to 16, and our SUPERSIZE room combo handles up to 32. " +
    "Reply or call " + CFG.VENUE_PHONE + " to update your count.",
  DAY6_CATERING:
    "Hi {first} — last call for food! Catering orders (pizza, wings, platters) must be in 5 days before " +
    "your {date} party. Want to add anything? Reply to this text or call " + CFG.VENUE_PHONE + " today. " +
    "(Outside food other than birthday dessert has a $50 fee.)",
  DAY2_BALANCE:
    "Hi {first}! Almost party time — {date} at {time}. Your remaining balance is {balance}, due at the " +
    "end of your event. See you soon! " + CFG.VENUE_NAME + " " + CFG.VENUE_PHONE,
  DAY1_DETAILS:
    "Tomorrow's the day, {first}! Party details: arrive 10-15 min early. Birthday dessert is welcome — " +
    "no other outside food/drinks please. No helium balloons (very high ceilings!). " +
    "Waivers not signed yet? " + CFG.WAIVER_LINK + " See you at {time}!",
  DAY_AFTER_THANKS:
    "Thank you for celebrating with us at " + CFG.VENUE_NAME + ", {first}! We hope {kid} had a blast. " +
    "We'd love to hear how we did — and we'd be honored to host next year's party too!",
};


// Message schedule: queue when daysUntil <= at (skip if past floor)
const SCHEDULE = [
  { type: 'DAY15_DEPOSIT',    at: 15, floor: 14 },
  { type: 'DAY7_GUEST_COUNT', at: 7,  floor: 6 },
  { type: 'DAY6_CATERING',    at: 6,  floor: 5 },
  { type: 'DAY2_BALANCE',     at: 2,  floor: 2 },
  { type: 'DAY1_DETAILS',     at: 1,  floor: 1 },
  { type: 'DAY_AFTER_THANKS', at: -1, floor: -1 },
];


/*********************** SETUP (run once) ***********************/
function setup() {
  const ss = getSS_();
  // Build tabs + headers
  Object.keys(HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEADERS[name]);
      sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      // migration: append any newly added header columns to existing tabs
      const cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
      HEADERS[name].forEach(h => {
        if (cur.indexOf(h) === -1) {
          sh.getRange(1, cur.length + 1).setValue(h).setFontWeight('bold');
          cur.push(h);
        }
      });
    }
  });
  // Default settings
  const st = ss.getSheetByName(TABS.SETTINGS);
  if (st.getLastRow() < 2) DEFAULT_SETTINGS.forEach(r => st.appendRow(r));
  // Seed example offers (edit/deactivate anytime in the Offers tab)
  const of = ss.getSheetByName(TABS.OFFERS);
  if (of && of.getLastRow() < 2) {
    of.appendRow(['Game card bundle', 'Party perk: add game cards for every guest before party day and save!', 'DAY7_GUEST_COUNT', 'NO_GAMECARD', 'YES']);
    of.appendRow(['Churro + ice cream special', 'Sweet deal: churro + a scoop of ice cream special — ask your party captain!', 'DAY1_DETAILS', '', 'YES']);
  }
  // Remove default "Sheet1"
  const s1 = ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  // Triggers: remove legacy email/outbox triggers and recreate API-only jobs.
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['processNewEmails','dailyRun','processOutbox','onOpen'].includes(t.getHandlerFunction()))
      ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onOpen').forSpreadsheet(ss).onOpen().create();
  ScriptApp.newTrigger('dailyRun').timeBased().atHour(8).everyDays(1).inTimezone(CFG.TZ).create();
  buildDashboard();
  runLog_('setup', 'OK', 'Main file v' + CFG.VERSION + ' installed. Sheet: ' + ss.getUrl());
}


function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎉 Party Radar')
    .addItem('Show Party Radar spreadsheet', 'showPartyRadarLocation')
    .addSeparator()
    .addItem('Sync PCS API now', 'syncPCS')
    .addItem('Run daily jobs now', 'dailyRun')
    .addItem('Archive past parties now', 'archiveNow')
    .addItem('Why are past parties still here?', 'diagnoseArchive')
    .addItem('Re-check recommended changes', 'recheckRecommendations')
    .addSeparator()
    .addItem('Rebuild dashboard', 'buildDashboard')
    .addSeparator()
    .addItem('Fix mis-filed cancellations', 'fixMisfiledCancellations')
    .addItem('Re-run setup', 'setup')
    .addToUi();
}


function showPartyRadarLocation() {
  const ss = getSS_();
  const url = ss.getUrl();
  runLog_('showPartyRadarLocation', 'INFO', url);
  SpreadsheetApp.getUi().alert('Party Radar spreadsheet', url, SpreadsheetApp.getUi().ButtonSet.OK);
}


/*********************** REMOVED EMAIL ENTRY POINTS ***********************/
function DISABLED_processNewEmails() {
  runLog_('DISABLED_processNewEmails', 'DISABLED', 'API-only mode: run syncPCS() instead.');
}


function DISABLED_reprocessAllEmails() {
  runLog_('DISABLED_reprocessAllEmails', 'DISABLED', 'API-only mode has no mailbox state to reset.');
}


// Field-aware equality: treats "8/27/2026" == "Thu, Aug 27, 2026" and
// "650" == "$650.00" as the same, so the Changes Log only records real changes.
function same_(field, oldRaw, newVal) {
  const A = (oldRaw instanceof Date) ? '' : String(oldRaw).trim();
  const B = String(newVal).trim();
  if (A === B) return true;
  if (/Date|Booked/i.test(field)) {
    const da = (oldRaw instanceof Date) ? oldRaw : parseDate_(A);
    const db = parseDate_(B);
    if (da && db && da.getFullYear() === db.getFullYear() &&
        da.getMonth() === db.getMonth() && da.getDate() === db.getDate()) return true;
  }
  if (/Balance/i.test(field)) {
    const na = Number(String(oldRaw).replace(/[^0-9.\-]/g, ''));
    const nb = Number(B.replace(/[^0-9.\-]/g, ''));
    if (!isNaN(na) && !isNaN(nb) && Math.abs(na - nb) < 0.005) return true;
  }
  return false;
}


// Split an email body into one chunk per "Order Number NNNNNN"
function splitOrders_(body) {
  const parts = body.split(/(?=Order Number\s+\d{4,})/);
  return parts.filter(p => /Order Number\s+\d{4,}/.test(p));
}


/*********************** PARSER ***********************/
function parseOrder_(text) {
  // HTML-formatted PCS emails render bold as *asterisks* in plain text
  // (e.g. "*Phone:* 310-570-5541"), which broke field matching. Strip them,
  // along with non-breaking spaces, before parsing.
  text = text.replace(/\*/g, '').replace(/\u00A0/g, ' ');
  const g = (re) => { const m = text.match(re); return m ? m[1].trim() : ''; };
  const rec = {
    orderNum: g(/Order Number\s+(\d{4,})/),
    orderDate: g(/Order Date:\s*([\d\/]+\s+[\d:]+\s*[AP]M)/i),
    isStorefront: /Storefront\s+Invoice/i.test(text) || !/Party Date:/i.test(text),
    isCancelled: /\bCANCELL?ED\b/i.test(text) || /Order Status:\s*Cancell?ed/i.test(text),
    customer: g(/Customer Information\s*\n\s*([^\n]+)/i),
    phone: g(/Phone:\s*([\d\-\.\(\)\s]{7,})/i),
    email: g(/Email:\s*([^\s\n]+@[^\s\n]+)/i),
    partyDate: g(/Party Date:\s*([^\n]+)/i),
    partyTime: g(/Party Time:\s*([^\n]+)/i),
    guestCount: g(/Guest Count:\s*(\d+)/i),
    balanceDue: g(/Balance Due:\s*(\$[\d,\.]+)/i),
    kid: g(/Guests of Honor\s*\n\s*(?:\([MF]\)\s*)?([^\(\n]+)/i),
    host: g(/Host\(s\)\s*\n\s*([^\n]+)/i),
  };
  // Address: lines between customer name and Phone:
  const am = text.match(/Customer Information\s*\n[^\n]+\n([\s\S]*?)\n\s*Phone:/i);
  rec.address = am ? am[1].replace(/\n/g, ', ').trim() : '';
  // Products between "Products" header and "Sub Total"
  const pm = text.match(/Products[\s\S]*?Total\s*\n([\s\S]*?)Sub Total:/i);
  if (pm) {
    const junk = /^[\s\d\.,x\$†\t]+$/i;   // lines that are only qty/price noise
    const lines = pm[1].split('\n').map(l => l.trim()).filter(l => l && !junk.test(l));
    const clean = (l) => l.replace(/[\s\t]+\d+\s*x\b[\s\S]*$/i, '')
      .replace(/(?:\t| {2,})\$[\d,\.]+(?:\s+\$[\d,\.]+)*\s*$/, '').trim();
    rec.package = lines.length ? clean(lines[0]) : '';
    rec.addons = lines.slice(1).map(clean).filter(l => l.length > 2).join(' | ');
  } else { rec.package = ''; rec.addons = ''; }
  // "Lastname, Firstname" -> first name for texts
  const nm = rec.customer.match(/^([^,]+),\s*(.+)$/);
  rec.first = nm ? nm[2].trim() : rec.customer.split(' ')[0];
  rec.sales = parseSales_(text);
  rec.items = parseItems_(text);
  return rec;
}


/** Money string -> number. Handles "$1,234.56" and negatives as $(658.26). */
function moneyNum_(s) {
  if (s === '' || s === null || s === undefined) return '';
  const str = String(s);
  const neg = /\(/.test(str);
  const n = Number(str.replace(/[^0-9.\-]/g, ''));
  if (isNaN(n)) return '';
  return neg ? -n : n;
}


/** Totals + payment roll-up from an invoice body (asterisks already stripped). */
function parseSales_(text) {
  const g = (re) => { const m = text.match(re); return m ? m[1].trim() : ''; };
  const sales = {
    subTotal:   moneyNum_(g(/Sub Total:\s*\$?([\d,\.]+)/i)),
    tax:        moneyNum_(g(/Sales Tax:\s*\$?([\d,\.]+)/i)),
    tip:        moneyNum_(g(/Tip:\s*\$?([\d,\.]+)/i)),
    grandTotal: moneyNum_(g(/Total with Tip:\s*\$?([\d,\.]+)/i)),
  };
  // Payments block: sum them, note methods, catch reversals (negative amounts)
  const sec = text.match(/Payments[\s\S]*?\n([\s\S]*?)Balance Due:/i);
  let paid = 0; const methods = {}; const reversals = [];
  if (sec) {
    sec[1].split('\n').forEach(line => {
      const l = line.trim();
      if (!l || /^Date\s/.test(l)) return;
      const m = l.match(/^([\d\/]+\s+[\d:]+\s*[AP]M)(?:\t| {2,})(\w+)(?:\t| {2,})(.*?)(?:\t| {2,})\$?\(?([\d,\.]+)\)?\s*$/);
      if (!m) return;
      const neg = /\$\(|\(\d/.test(l);
      const amt = (neg ? -1 : 1) * (moneyNum_(m[4]) || 0);
      paid += amt;
      methods[m[2]] = (methods[m[2]] || 0) + 1;
      if (amt < 0) reversals.push(m[2] + ' ' + amt.toFixed(2) +
        (m[3].replace(/No memo provided/i, '').replace(/"/g, '').trim()
          ? ' ("' + m[3].replace(/No memo provided/i, '').replace(/"/g, '').trim() + '")' : ''));
    });
  }
  sales.amountPaid = paid ? Math.round(paid * 100) / 100 : '';
  sales.methods = Object.keys(methods).map(k => k + (methods[k] > 1 ? ' x' + methods[k] : '')).join(', ');
  sales.reversals = reversals.join(' | ');
  return sales;
}


/** One entry per product line: {name, qty, unit, total}. */
function parseItems_(text) {
  const out = [];
  const pm = text.match(/Products[^\n]*\n([\s\S]*?)Sub Total:/i);
  if (!pm) return out;
  pm[1].split('\n').forEach(line => {
    const l = line.trim();
    if (!l) return;
    const m = l.match(/^(.+?)(?:\t| {2,})(\d+)\s*x(?:\t| {2,})\$([\d,\.]+)(?:\t| {2,})\$([\d,\.]+)\s*$/);
    if (!m) return;
    out.push({
      name: m[1].replace(/^\d+\.\s*/, '').replace(/\u2020/g, '').trim(),
      qty: Number(m[2]),
      unit: moneyNum_(m[3]),
      total: moneyNum_(m[4]),
    });
  });
  return out;
}


/** Rough category for analytics, from the product name. */
function itemCategory_(name) {
  const n = String(name).toLowerCase();
  if (/pizza|wings|platter|soda|pitcher|water|juice|coffee|cater/.test(n)) return 'FOOD/DRINK';
  if (/game card|arcade|token/.test(n)) return 'GAME CARD';
  if (/party|supersize|lazertag|laser tag|camp|event/.test(n)) return 'PACKAGE';
  if (/parent|play pass|sock|glow|shirt|favor|gift/.test(n)) return 'RETAIL/ADD-ON';
  return 'OTHER';
}


/*********************** VALIDATION & UPSELLS ***********************/
function validate_(r) {
  const flags = [];
  const digits = (r.phone || '').replace(/\D/g, '');
  if (!digits) flags.push('MISSING PHONE');
  else {
    const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
    if (d.length !== 10) flags.push('PHONE NOT 10 DIGITS');
    else if (/^(\d)\1{9}$/.test(d)) flags.push('PHONE LOOKS FAKE');
    else if (d[0] === '0' || d[0] === '1') flags.push('PHONE INVALID AREA CODE');
  }
  if (!r.email) flags.push('MISSING EMAIL');
  else {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) flags.push('EMAIL MALFORMED');
    if (/@(gmial|gamil|gmal|gnail)\./i.test(r.email) || /\.(cm|con|comm|cmo)$/i.test(r.email))
      flags.push('EMAIL LIKELY TYPO');
  }
  const gc = parseInt(r.guestCount, 10);
  if (!isNaN(gc)) {
    if (gc <= 1 && /party/i.test(r.package)) flags.push('GUEST COUNT SUSPICIOUS (' + gc + ')');
    if (gc > 16 && !/supersize|camp|event/i.test(r.package)) flags.push('OVER ROOM MAX 16 — needs 2nd room or SUPERSIZE');
  }
  if (!r.address) flags.push('MISSING ADDRESS');
  const pd = parseDate_(r.partyDate);
  // Historical rows are expected to be in the past — only flag it for live bookings
  if (pd && pd < today_() && !r.isHistorical) flags.push('PARTY DATE IN PAST');
  return flags.join('; ');
}


function upsells_(r) {
  const ups = [];
  const items = (r.addons || '').toLowerCase();
  const gc = parseInt(r.guestCount, 10) || 0;
  if (!/pizza|wings|platter|catering/.test(items))
    ups.push('No food ordered — pitch pizza/wings before 5-day catering cutoff');
  if (gc >= 12 && gc < 16)
    ups.push('At/near package max (' + gc + ') — mention $50/guest up to 16');
  if (gc >= 14)
    ups.push('Trending toward 16 — suggest SUPERSIZE $899 (up to 32 guests)');
  if (!/parent play pass/.test(items))
    ups.push('No Parent Play Pass — offer at check-in ($15)');
  if (!/platter|fruit|dessert/.test(items))
    ups.push('No platter/dessert add-on — last-chance offer');
  return ups.join('; ');
}


function recommendFixes_(r) {
  if (!r.flags) return;
  const sh = tab_(TABS.RECS);
  r.flags.split('; ').forEach(f => {
    const isCharge = /OVER ROOM MAX/.test(f);
    sh.appendRow([now_(), r.orderNum, r.customer, isCharge ? 'CHARGE' : 'DATA FIX',
      f + (isCharge ? ' — add 2nd room $150 or upgrade in PCS' : ' — verify with customer & fix in PCS'),
      'OPEN', '']);
  });
}


/*********************** SHEET UPSERT + CHANGE DETECTION ***********************/
function upsertEvent_(r) {
  const S = r.sales || {};
  const sh = tab_(TABS.EVENTS);
  const data = sh.getDataRange().getValues();
  const H = HEADERS[TABS.EVENTS];
  const col = (n) => H.indexOf(n);
  let rowIdx = -1;
  for (let i = 1; i < data.length; i++)
    if (String(data[i][0]) === String(r.orderNum)) { rowIdx = i; break; }


  const rowVals = [r.orderNum, r.orderDate, r.customer, r.phone, r.email, r.address,
    r.partyDate, r.partyTime, r.guestCount, r.package, r.addons, r.balanceDue,
    r.host && !/not yet assigned/i.test(r.host) ? r.host : '', '', '', '', '',
    r.flags, r.upsells, 'ACTIVE', now_(), '',
    S.subTotal, S.tax, S.tip, S.grandTotal, S.amountPaid, S.methods, S.reversals,
    (r.items || []).length];


  if (rowIdx === -1) {
    sh.appendRow(rowVals);
    logMsg_(r.orderNum, r.customer, 'NEW BOOKING DETECTED', 'SYSTEM', 'PCS API', 'LOGGED', r.partyDate + ' ' + r.partyTime);
    return true;
  }
  // Existing order — diff the fields that matter, keep manual columns intact
  const watch = ['Booked','Customer','Phone','Email','Address','Party Date','Party Time','Guest Count','Package','Add-Ons','Balance Due'];
  const old = data[rowIdx];
  watch.forEach(f => {
    const c = col(f);
    const newVal = rowVals[c];
    if (!same_(f, old[c], newVal) && newVal !== '') {
      tab_(TABS.CHANGES).appendRow([now_(), r.orderNum, f, old[c], newVal, 'PCS API']);
      sh.getRange(rowIdx + 1, c + 1).setValue(newVal);
      // Reschedules get a visible note right on the event row
      if (f === 'Party Date' || f === 'Party Time') {
        const ec = col('Event Changes');
        const prev = String(old[ec] || '');
        const oldDisp = (old[c] instanceof Date)
          ? Utilities.formatDate(old[c], CFG.TZ, 'M/d/yyyy') : String(old[c]);
        const note = 'MOVED ' + f.replace('Party ', '').toLowerCase() + ': ' +
          oldDisp + ' → ' + newVal + ' (' + todayStr_() + ')';
        sh.getRange(rowIdx + 1, ec + 1).setValue(prev ? prev + ' | ' + note : note);
      }
    }
  });
  // Refresh computed cols + captain if newly assigned in PCS
  sh.getRange(rowIdx + 1, col('Flags') + 1).setValue(r.flags);
  sh.getRange(rowIdx + 1, col('Upsell Suggestions') + 1).setValue(r.upsells);
  sh.getRange(rowIdx + 1, col('Last Synced') + 1).setValue(now_());
  if (r.host && !/not yet assigned/i.test(r.host) && !old[col('Captain')])
    sh.getRange(rowIdx + 1, col('Captain') + 1).setValue(r.host);
  // Sales figures are authoritative from the invoice — always refresh in one write
  const salesCols = ['Sub Total','Sales Tax','Tip','Total With Tip','Amount Paid','Payment Methods','Reversals','Item Count'];
  const c0 = col(salesCols[0]);
  if (c0 > -1 && S.subTotal !== '' && S.subTotal !== undefined) {
    sh.getRange(rowIdx + 1, c0 + 1, 1, salesCols.length).setValues([[
      S.subTotal, S.tax, S.tip, S.grandTotal, S.amountPaid, S.methods, S.reversals,
      (r.items || []).length]]);
  }
  return false;
}


/** Line Items rows for one order, or [] if already recorded. Pass a Set of
 *  order numbers already in the tab to keep backfill from duplicating. */
function itemRowsFor_(r, existingSet) {
  if (!r.items || !r.items.length) return [];
  if (existingSet && existingSet.has(String(r.orderNum))) return [];
  return r.items.map(it => [r.orderNum, r.partyDate, r.customer, it.name,
    it.qty, it.unit, it.total, itemCategory_(it.name), 'PCS API']);
}


/** Set of order numbers already present in Line Items (dedupe guard). */
function existingItemOrders_() {
  const sh = tab_(TABS.ITEMS);
  const set = new Set();
  if (!sh) return set;
  const last = sh.getLastRow();
  if (last < 2) return set;
  sh.getRange(2, 1, last - 1, 1).getValues().forEach(row => {
    if (row[0] !== '') set.add(String(row[0]));
  });
  return set;
}


/** Append many Line Items rows in ONE write (fast, avoids the 6-min limit). */
function appendItemRows_(rows) {
  if (!rows || !rows.length) return 0;
  const sh = tab_(TABS.ITEMS);
  if (!sh) return 0;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return rows.length;
}


/*********************** DAILY RUN (8 AM) ***********************/
function dailyRun() {
  syncPCS();                   // API is the sole ingestion path
  archiveEvents_();            // move past & cancelled rows out of Upcoming Events
  recheckRecommendations();    // auto-close items already fixed in PCS
  buildDashboard();            // refresh YoY / MoM figures
  const sh = tab_(TABS.EVENTS);
  const data = sh.getDataRange().getValues();
  const H = HEADERS[TABS.EVENTS];
  const col = (n) => H.indexOf(n);
  const alertsOut = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[col('Status')] === 'CANCELLED') continue;
    const rec = rowToRec_(row, col);
    const d = daysUntil_(rec.partyDate);
    if (d === null) continue;


    // 1) Queue scheduled customer messages
    SCHEDULE.forEach(s => {
      if (d <= s.at && d >= s.floor && !alreadyQueued_(rec.orderNum, s.type))
        queueMessage_(rec, s.type, new Date());
    });


    // 2) No-contact alerts at 14/7/5/2 days
    const stamped = String(row[col('Alert Status')] || '');
    CFG.ALERT_DAYS.forEach(ad => {
      if (d === ad && stamped.indexOf(ad + '✓') === -1) {
        const lc = row[col('Last Contact')];
        const stale = !lc || (today_() - new Date(lc)) / 86400000 > 7;
        if (stale) {
          alertsOut.push('⚠️ Order ' + rec.orderNum + ' — ' + rec.customer + ' — party ' + rec.partyDate +
            ' is ' + ad + ' days out. Last contact: ' + (lc ? Utilities.formatDate(new Date(lc), CFG.TZ, 'M/d') : 'NONE') +
            '. Balance: ' + (rec.balanceDue || 'n/a') + '. Phone: ' + rec.phone);
          sh.getRange(i + 1, col('Alert Status') + 1).setValue(stamped ? stamped + ',' + ad + '✓' : ad + '✓');
        }
      }
    });


    // 3) Captain briefing (email) once assigned, within 8 days of party
    if (row[col('Captain')] && !row[col('Captain Report Sent')] && d <= 8 && d >= 0) {
      if (sendCaptainReport_(rec, row[col('Captain')]))
        sh.getRange(i + 1, col('Captain Report Sent') + 1).setValue(now_());
    }
  }
  if (alertsOut.length) mgmtEmail_('⚠️ Party contact alerts — ' + todayStr_(), alertsOut.join('\n\n'));
  sendMgmtReport_();
  runLog_('dailyRun', 'OK', alertsOut.length + ' alerts');
}


/** Keeps Upcoming Events clean:
 *  - past parties (more than 1 day ago, so the day-after thank-you has queued)
 *    move to the "Completed Events" tab, marked COMPLETED
 *  - CANCELLED parties move to the "Cancelled Events" tab
 *  Full row history is preserved either way. */
function archiveEvents_() {
  const sh = tab_(TABS.EVENTS);
  const comp = tab_(TABS.COMPLETED);
  const canc = tab_(TABS.CANCELLED_TAB);
  if (!comp || !canc) {
    runLog_('archiveEvents_', 'SKIP', 'Missing tab(s): ' +
      (!comp ? TABS.COMPLETED + ' ' : '') + (!canc ? TABS.CANCELLED_TAB : '') +
      ' — run setup() first');
    return;
  }
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;
  const H = HEADERS[TABS.EVENTS]; const col = (n) => H.indexOf(n);
  const keep = [], done = [], cancelled = [];


  for (let i = 1; i < data.length; i++) {
    const row = data[i].slice(0, H.length);
    while (row.length < H.length) row.push('');
    if (String(row[0]) === '') continue;                 // drop blank filler rows
    const d = daysUntil_(row[col('Party Date')]);
    const isCancelled = String(row[col('Status')]) === 'CANCELLED';
    const isPast = (d !== null && d < -1);
    if (isCancelled) {
      if (!row[col('Event Changes')]) row[col('Event Changes')] = 'CANCELLED (' + todayStr_() + ')';
      cancelled.push(row);
    } else if (isPast) {
      row[col('Status')] = 'COMPLETED';
      done.push(row);
    } else {
      keep.push(row);
    }
  }
  if (!done.length && !cancelled.length) return;         // nothing to move


  // Batched: one append per destination, one rewrite of the source. Fast enough
  // for a large backfill cleanup without hitting the 6-minute execution limit.
  appendRows_(TABS.COMPLETED, done);
  appendRows_(TABS.CANCELLED_TAB, cancelled);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, H.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, H.length).setValues(keep);


  runLog_('archiveEvents_', 'OK', done.length + ' moved to Completed Events; ' +
    cancelled.length + ' moved to Cancelled Events; ' + keep.length + ' remain upcoming');
}


/*********************** OUTBOX / MESSAGE QUEUE ***********************/
function queueMessage_(rec, type, sendDate) {
  let text = fill_(TEMPLATES[type], rec);
  const offer = pickOffer_(type, rec);
  if (offer) text += ' ' + offer;
  tab_(TABS.OUTBOX).appendRow([now_(), rec.orderNum, rec.customer, rec.phone, type,
    Utilities.formatDate(sendDate, CFG.TZ, 'M/d/yyyy'), text, 'PENDING', '', '']);
  logMsg_(rec.orderNum, rec.customer, type, 'OUTBOUND', 'SMS', 'QUEUED — awaiting approval', text);
}


/** Returns the first ACTIVE offer matching this message type & conditions.
 *  Offers tab columns: Offer Name | Message Text | Attach To | Condition | Active
 *  - Attach To: a message type (e.g. DAY7_GUEST_COUNT) or ANY
 *  - Condition: blank = always; NO_FOOD = only if no food ordered;
 *               NO_GAMECARD = only if no game card add-on on the order */
function pickOffer_(type, rec) {
  const sh = tab_(TABS.OFFERS);
  if (!sh) return '';
  const data = sh.getDataRange().getValues();
  const items = String(rec.addons || '').toLowerCase();
  for (let i = 1; i < data.length; i++) {
    const [name, text, attachTo, condition, active] = data[i];
    if (String(active).toUpperCase() !== 'YES') continue;
    const target = String(attachTo || 'ANY').toUpperCase().trim();
    if (target !== 'ANY' && target !== type) continue;
    const cond = String(condition || '').toUpperCase().trim();
    if (cond === 'NO_FOOD' && /pizza|wings|platter|catering/.test(items)) continue;
    if (cond === 'NO_GAMECARD' && /game card/.test(items)) continue;
    if (text) return String(text).trim();
  }
  return '';
}


function alreadyQueued_(orderNum, type) {
  const data = tab_(TABS.OUTBOX).getDataRange().getValues();
  for (let i = 1; i < data.length; i++)
    if (String(data[i][1]) === String(orderNum) && data[i][4] === type) return true;
  return false;
}


// Runs every 5 min. In v1 SENDING_ENABLED=FALSE, so approved messages wait here.
function processOutbox() {
  if (setting_('SENDING_ENABLED') !== 'TRUE') return;
  const sh = tab_(TABS.OUTBOX);
  const data = sh.getDataRange().getValues();
  const hr = parseInt(Utilities.formatDate(new Date(), CFG.TZ, 'H'), 10);
  const inWindow = hr >= parseInt(setting_('SEND_WINDOW_START'), 10) && hr < parseInt(setting_('SEND_WINDOW_END'), 10);
  if (!inWindow) return;
  for (let i = 1; i < data.length; i++) {
    if (data[i][7] !== 'APPROVED') continue;
    const ok = sendSMS_(data[i][3], data[i][6]);   // v2: GoTo call goes here
    if (ok) {
      sh.getRange(i + 1, 8).setValue('SENT');
      sh.getRange(i + 1, 10).setValue(now_());
      logMsg_(data[i][1], data[i][2], data[i][4], 'OUTBOUND', 'SMS', 'SENT', data[i][6]);
    }
  }
}


function sendSMS_(phone, text) {
  // *** v2: GoTo Connect Messaging API call will live here. ***
  runLog_('sendSMS_', 'BLOCKED', 'GoTo not connected yet — message NOT sent to ' + phone);
  return false;
}


/*********************** REPORTS & EMAIL ***********************/
function sendMgmtReport_() {
  const data = tab_(TABS.EVENTS).getDataRange().getValues();
  const H = HEADERS[TABS.EVENTS]; const col = (n) => H.indexOf(n);
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const d = daysUntil_(data[i][col('Party Date')]);
    if (d === null || d < -1 || data[i][col('Status')] === 'CANCELLED') continue;
    rows.push({ d: d, r: data[i] });
  }
  rows.sort((a, b) => a.d - b.d);
  let html = '<h2>' + CFG.VENUE_NAME + ' — Daily Party Report — ' + todayStr_() + '</h2>' +
    '<table border="1" cellpadding="5" style="border-collapse:collapse;font-family:Arial;font-size:12px">' +
    '<tr style="background:#222;color:#fff"><th>Days</th><th>Date</th><th>Order</th><th>Customer</th>' +
    '<th>Guests</th><th>Balance</th><th>Captain</th><th>⚠ Flags</th><th>💰 Upsells</th></tr>';
  rows.forEach(x => {
    const r = x.r;
    const noCap = !r[col('Captain')] && x.d <= 10;
    html += '<tr' + (r[col('Flags')] || noCap ? ' style="background:#fff3cd"' : '') + '><td>' + x.d + '</td>' +
      '<td>' + r[col('Party Date')] + '</td><td>' + r[col('Order #')] + '</td>' +
      '<td>' + r[col('Customer')] + '<br>' + r[col('Phone')] + '</td>' +
      '<td>' + r[col('Guest Count')] + '</td><td>' + r[col('Balance Due')] + '</td>' +
      '<td>' + (r[col('Captain')] || (noCap ? '<b>NONE ⚠</b>' : '—')) + '</td>' +
      '<td>' + (r[col('Flags')] || '') + '</td><td>' + (r[col('Upsell Suggestions')] || '') + '</td></tr>';
  });
  html += '</table>';
  const pending = tab_(TABS.OUTBOX).getDataRange().getValues().filter(r => r[7] === 'PENDING').length;
  const openRecs = tab_(TABS.RECS).getDataRange().getValues().filter(r => r[5] === 'OPEN').length;
  html += '<p><b>' + pending + '</b> messages in Outbox awaiting your approval | <b>' + openRecs +
    '</b> open items in Recommended Changes</p><p><a href="' + getSS_().getUrl() + '">Open the tracker</a></p>';
  mgmtEmail_('📊 Daily Party Report — ' + todayStr_(), html, true);
}


function sendCaptainReport_(rec, captainName) {
  const caps = tab_(TABS.CAPTAINS).getDataRange().getValues();
  let email = '';
  for (let i = 1; i < caps.length; i++)
    if (String(caps[i][0]).toLowerCase().trim() === String(captainName).toLowerCase().trim()) email = caps[i][2];
  const body = 'PARTY CAPTAIN BRIEFING — Order ' + rec.orderNum + '\n\n' +
    'Party: ' + rec.partyDate + ' ' + rec.partyTime + '\n' +
    'Guest of honor: ' + (rec.kid || 'see order') + '\n' +
    'Customer: ' + rec.customer + ' — ' + rec.phone + '\n' +
    'Guest count: ' + rec.guestCount + '\nPackage: ' + rec.package + '\n' +
    'Food/Add-ons: ' + (rec.addons || 'NONE ordered') + '\n' +
    'Balance to collect at end: ' + (rec.balanceDue || '$0') + '\n\n' +
    'UPSELL TALK TRACKS:\n' + (rec.upsells ? rec.upsells.split('; ').map(u => '• ' + u).join('\n') : '• none') + '\n\n' +
    'FLAGS TO VERIFY:\n' + (rec.flags ? rec.flags.split('; ').map(f => '• ' + f).join('\n') : '• none');
  if (email) {
    MailApp.sendEmail(email, '🎉 Captain Briefing: ' + rec.customer + ' party ' + rec.partyDate, body);
    logMsg_(rec.orderNum, rec.customer, 'CAPTAIN_BRIEFING', 'OUTBOUND', 'EMAIL', 'SENT to ' + captainName, body.substring(0, 200));
    return true;
  }
  mgmtEmail_('⚠ Captain "' + captainName + '" has no email in Captains tab', 'Order ' + rec.orderNum + ' briefing could not be delivered. Add them to the Captains tab.');
  return false;
}


/*********************** HELPERS ***********************/
function getSS_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SS_ID');
  if (id === CFG.PROTECTED_REFERENCE_SS_ID) {
    throw new Error('Safety stop: SS_ID points to the protected reference Party SMS Tracker. Delete the SS_ID Script Property and run setup() again.');
  }
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  const folder = DriveApp.getFolderById(CFG.FOLDER_ID);
  const existing = folder.getFilesByName(CFG.SS_NAME);
  let ss;
  if (existing.hasNext()) ss = SpreadsheetApp.openById(existing.next().getId());
  else {
    ss = SpreadsheetApp.create(CFG.SS_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
  }
  props.setProperty('SS_ID', ss.getId());
  return ss;
}
function tab_(name) { return getSS_().getSheetByName(name); }
function setting_(key) {
  const data = tab_(TABS.SETTINGS).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) if (data[i][0] === key) return String(data[i][1]).toUpperCase();
  return '';
}
function mgmtEmail_(subject, body, isHtml) {
  const to = PropertiesService.getScriptProperties().getProperty('MGMT_EMAILS') || Session.getActiveUser().getEmail();
  if (isHtml) MailApp.sendEmail({ to: to, subject: subject, htmlBody: body });
  else MailApp.sendEmail(to, subject, body);
}
function logMsg_(order, customer, type, direction, channel, status, text) {
  tab_(TABS.MSGLOG).appendRow([now_(), order, customer, type, direction, channel, status, text]);
}
function runLog_(fn, result, details) { tab_(TABS.RUNLOG).appendRow([now_(), fn, result, details]); }
function fill_(t, r) {
  return t.replace('{first}', r.first || 'there').replace('{customer}', r.customer || '')
    .replace(/\{date\}/g, r.partyDate || '').replace(/\{time\}/g, r.partyTime || '')
    .replace('{count}', r.guestCount || '?').replace('{balance}', r.balanceDue || 'your balance')
    .replace('{kid}', (r.kid || 'the birthday star').trim());
}
function rowToRec_(row, col) {
  return { orderNum: row[col('Order #')], customer: row[col('Customer')], phone: row[col('Phone')],
    email: row[col('Email')], partyDate: row[col('Party Date')], partyTime: row[col('Party Time')],
    guestCount: row[col('Guest Count')], package: row[col('Package')], addons: row[col('Add-Ons')],
    balanceDue: row[col('Balance Due')], flags: row[col('Flags')], upsells: row[col('Upsell Suggestions')],
    kid: '', first: (String(row[col('Customer')]).match(/,\s*(.+)$/) || [,''])[1] || String(row[col('Customer')]).split(' ')[0] };
}
function parseDate_(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const d = new Date(String(s).replace(/^[^A-Za-z0-9]+/, '').replace(/^[A-Za-z]{3},\s*/, ''));
  return isNaN(d) ? null : d;
}
function daysUntil_(partyDate) {
  const d = parseDate_(partyDate);
  if (!d) return null;
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today_()) / 86400000);
}
function today_() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function now_() { return Utilities.formatDate(new Date(), CFG.TZ, 'M/d/yyyy h:mm a'); }
function todayStr_() { return Utilities.formatDate(new Date(), CFG.TZ, 'EEE M/d/yyyy'); }


/** READ-ONLY diagnostic. Changes nothing. Explains, row by row, why anything
 *  still sitting in Upcoming Events has not been archived. Start here whenever
 *  past parties won't move. Full detail lands in the Run Log. */
function diagnoseArchive() {
  const out = [];
  out.push('Main file v' + CFG.VERSION);
  const comp = tab_(TABS.COMPLETED), canc = tab_(TABS.CANCELLED_TAB);
  out.push('Tab "' + TABS.COMPLETED + '": ' + (comp ? 'exists' : 'MISSING — run setup()'));
  out.push('Tab "' + TABS.CANCELLED_TAB + '": ' + (canc ? 'exists' : 'MISSING — run setup()'));
  const legacy = tab_('Archive');
  if (legacy) out.push('NOTE: old "Archive" tab still present with ' +
    Math.max(legacy.getLastRow() - 1, 0) + ' row(s) — move them to ' + TABS.COMPLETED + ' and delete it.');


  const sh = tab_(TABS.EVENTS);
  const data = sh.getDataRange().getValues();
  const H = HEADERS[TABS.EVENTS];
  const col = (n) => H.indexOf(n);
  const hdr = data.length ? data[0] : [];
  if (String(hdr[col('Party Date')]) !== 'Party Date')
    out.push('WARNING: column ' + (col('Party Date') + 1) + ' header is "' +
      hdr[col('Party Date')] + '", expected "Party Date" — run setup() to fix headers.');


  let movable = 0, stuck = 0, current = 0;
  const detail = [];
  for (let i = 1; i < data.length; i++) {
    const raw = data[i][col('Party Date')];
    const d = daysUntil_(raw);
    const status = String(data[i][col('Status')] || '');
    const order = String(data[i][0]);
    if (status === 'CANCELLED') { movable++; detail.push(order + ': CANCELLED -> should move'); continue; }
    if (d === null) {
      stuck++;
      detail.push(order + ': UNREADABLE Party Date ' + JSON.stringify(String(raw)) +
        ' (type ' + (raw instanceof Date ? 'Date' : typeof raw) + ') -> will never archive; fix this cell');
    } else if (d < -1) { movable++; detail.push(order + ': ' + d + ' days -> should move'); }
    else current++;
  }
  out.push('Rows in Upcoming Events: ' + (data.length - 1));
  out.push('  ' + current + ' current/upcoming (correctly staying)');
  out.push('  ' + movable + ' eligible to move NOW');
  out.push('  ' + stuck + ' blocked by an unreadable Party Date');
  if (movable > 0) out.push('=> ' + movable + ' row(s) are eligible, so archiving simply has not run. ' +
    'Use menu: Party Radar > Archive past parties now.');
  if (movable === 0 && stuck === 0) out.push('=> Nothing is eligible; everything left is genuinely current.');
  const msg = out.join('\n');
  runLog_('diagnoseArchive', 'INFO', msg.replace(/\n/g, ' | ') + (detail.length ? ' || ' + detail.join(' ; ') : ''));
  try { SpreadsheetApp.getUi().alert(msg + (detail.length ? '\n\nDetail:\n' + detail.slice(0, 25).join('\n') : '')); }
  catch (e) { /* running from editor, not sheet — Run Log has it */ }
}


/** Re-audits OPEN items in Recommended Changes against current event data.
 *  Anything whose flag no longer appears (fixed in PCS, or repaired by a
 *  parser update) is auto-closed. CHARGE items are never auto-closed —
 *  money owed stays a human decision. Also repairs old *asterisk* names.
 *  Runs nightly inside dailyRun(); safe to run manually anytime. */
function recheckRecommendations() {
  const sh = tab_(TABS.RECS);
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  const flagsByOrder = {}, nameByOrder = {};
  [TABS.EVENTS, TABS.COMPLETED, TABS.CANCELLED_TAB].forEach(t => {
    const s = tab_(t); if (!s) return;
    const d = s.getDataRange().getValues();
    const col = (n) => HEADERS[TABS.EVENTS].indexOf(n);
    for (let i = 1; i < d.length; i++) {
      const on = String(d[i][0]); if (!on) continue;
      flagsByOrder[on] = String(d[i][col('Flags')] || '');
      nameByOrder[on]  = String(d[i][col('Customer')] || '');
    }
  });
  let closed = 0, renamed = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][5]).toUpperCase() !== 'OPEN') continue;
    const order = String(data[i][1]);
    if (!(order in flagsByOrder)) continue;
    if (/\*/.test(String(data[i][2])) && nameByOrder[order]) {
      sh.getRange(i + 1, 3).setValue(nameByOrder[order]); renamed++;
    }
    if (String(data[i][3]).toUpperCase() === 'CHARGE') continue;
    const flag = String(data[i][4]).split(' — ')[0].trim();
    if (!flag) continue;
    if (flagsByOrder[order].indexOf(flag) === -1) {
      sh.getRange(i + 1, 6).setValue('RESOLVED');
      sh.getRange(i + 1, 7).setValue('auto-verified ' + todayStr_());
      closed++;
    }
  }
  runLog_('recheckRecommendations', 'OK', closed + ' stale items auto-closed; ' + renamed + ' names repaired');
}


/** Run directly to sweep past/cancelled parties right now and get a
 *  plain-language report of what moved and what stayed behind (and why). */
function archiveNow() {
  const comp = tab_(TABS.COMPLETED), canc = tab_(TABS.CANCELLED_TAB);
  if (!comp || !canc) {
    const msg = 'Tabs missing — run setup() first, then re-run archiveNow().';
    runLog_('archiveNow', 'SKIP', msg);
    alert_(msg);
    return;
  }
  const before = tab_(TABS.EVENTS).getLastRow() - 1;
  archiveEvents_();
  const after = tab_(TABS.EVENTS).getLastRow() - 1;
  const data = tab_(TABS.EVENTS).getDataRange().getValues();
  const col = (n) => HEADERS[TABS.EVENTS].indexOf(n);
  let noDate = 0;
  for (let i = 1; i < data.length; i++)
    if (daysUntil_(data[i][col('Party Date')]) === null) noDate++;
  const msg = (before - after) + ' row(s) moved out. ' + after + ' still in Upcoming Events' +
    (noDate ? ', of which ' + noDate + ' have an unreadable Party Date (never archived — fix those cells).' : '.');
  runLog_('archiveNow', 'OK', msg);
  SpreadsheetApp.getUi().alert(msg);
}






/** Looks for an order already sitting in Completed/Cancelled Events. If found,
 *  refreshes its sales figures in place and returns the tab name — so backfill
 *  never recreates a duplicate row back in Upcoming Events.
 *  Also self-corrects status: an invoice marked cancelled that was filed as
 *  COMPLETED gets moved to Cancelled Events (and vice versa). */
function upsertArchived_(r) {
  const H = HEADERS[TABS.EVENTS];
  const col = (n) => H.indexOf(n);
  const S = r.sales || {};
  const wantCancelled = !!r.isCancelled;
  const tabs = [TABS.COMPLETED, TABS.CANCELLED_TAB];
  for (let t = 0; t < tabs.length; t++) {
    const sh = tab_(tabs[t]);
    if (!sh) continue;
    const d = sh.getDataRange().getValues();
    for (let i = 1; i < d.length; i++) {
      if (String(d[i][0]) !== String(r.orderNum)) continue;
      const c0 = col('Sub Total');
      if (c0 > -1 && S.subTotal !== '' && S.subTotal !== undefined) {
        sh.getRange(i + 1, c0 + 1, 1, 8).setValues([[S.subTotal, S.tax, S.tip, S.grandTotal,
          S.amountPaid, S.methods, S.reversals, (r.items || []).length]]);
      }
      const inCancelledTab = (tabs[t] === TABS.CANCELLED_TAB);
      if (wantCancelled !== inCancelledTab) {
        // Filed in the wrong tab — move the row across, preserving history
        const row = d[i].slice(0, H.length);
        while (row.length < H.length) row.push('');
        row[col('Status')] = wantCancelled ? 'CANCELLED' : 'COMPLETED';
        const note = (wantCancelled ? 'RECLASSIFIED to cancelled ' : 'RECLASSIFIED to completed ') +
          '(' + todayStr_() + ')';
        row[col('Event Changes')] = String(row[col('Event Changes')] || '')
          ? row[col('Event Changes')] + ' | ' + note : note;
        const dest = tab_(wantCancelled ? TABS.CANCELLED_TAB : TABS.COMPLETED);
        dest.appendRow(row);
        sh.deleteRow(i + 1);
        tab_(TABS.CHANGES).appendRow([now_(), r.orderNum, 'Status',
          (wantCancelled ? 'COMPLETED' : 'CANCELLED'), (wantCancelled ? 'CANCELLED' : 'COMPLETED'),
          'PCS invoice re-read']);
        return (wantCancelled ? TABS.CANCELLED_TAB : TABS.COMPLETED) + ' (moved)';
      }
      return tabs[t];
    }
  }
  return '';
}


/** Scans Completed Events for orders whose invoice says CANCELLED and files
 *  them correctly. Run once to clean up mis-filed history (e.g. 315482). */
function fixMisfiledCancellations() {
  const comp = tab_(TABS.COMPLETED);
  if (!comp) { alert_('No Completed Events tab — run setup() first.'); return; }
  const d = comp.getDataRange().getValues();
  const orders = [];
  for (let i = 1; i < d.length; i++) if (d[i][0] !== '') orders.push(String(d[i][0]));
  let moved = 0, checked = 0;
  const report = [];
  orders.forEach(on => {
    const matches = pcsItems_(pcsGet_('/orders', { OrderNumber: on, Page: 1, Size: 10 }));
    const found = matches.find(o => String(num_(o, ['orderNumber', 'OrderNumber'])) === on);
    checked++;
    if (found && num_(found, ['status', 'Status', 'statusCode', 'StatusCode']) === PCS.STATUS.CANCELLED) {
      const rec = { orderNum: on, isCancelled: true, sales: {}, items: [] };
      const where = upsertArchived_(rec);
      if (/moved/.test(where)) { moved++; report.push(on + ' -> Cancelled Events'); }
    }
  });
  const msg = checked + ' completed orders checked; ' + moved + ' moved to Cancelled Events.' +
    (report.length ? '\n' + report.join('\n') : '');
  runLog_('fixMisfiledCancellations', 'OK', msg.replace(/\n/g, ' | '));
  alert_(msg);
}




/** Which tab a freshly parsed record belongs in.
 *  Cancelled -> Cancelled Events. More than 1 day past -> Completed Events.
 *  Unreadable date -> Upcoming Events, deliberately, so a human notices it. */
function targetTab_(rec) {
  if (rec.isCancelled) return TABS.CANCELLED_TAB;
  const d = daysUntil_(rec.partyDate);
  if (d === null) return TABS.EVENTS;
  return (d < -1) ? TABS.COMPLETED : TABS.EVENTS;
}


/** Builds a full event row for a historical record, ready for batch append. */
function historicalRow_(r, statusValue) {
  const H = HEADERS[TABS.EVENTS];
  const S = r.sales || {};
  const row = new Array(H.length).fill('');
  const set = (n, v) => { const c = H.indexOf(n); if (c > -1) row[c] = v; };
  set('Order #', r.orderNum);       set('Booked', r.orderDate);
  set('Customer', r.customer);      set('Phone', r.phone);
  set('Email', r.email);            set('Address', r.address);
  set('Party Date', r.partyDate);   set('Party Time', r.partyTime);
  set('Guest Count', r.guestCount); set('Package', r.package);
  set('Add-Ons', r.addons);         set('Balance Due', r.balanceDue);
  set('Captain', r.host && !/not yet assigned/i.test(r.host) ? r.host : '');
  set('Flags', r.flags);            set('Upsell Suggestions', r.upsells);
  set('Status', statusValue);       set('Last Synced', now_());
  set('Sub Total', S.subTotal);     set('Sales Tax', S.tax);
  set('Tip', S.tip);                set('Total With Tip', S.grandTotal);
  set('Amount Paid', S.amountPaid); set('Payment Methods', S.methods);
  set('Reversals', S.reversals);    set('Item Count', (r.items || []).length);
  return row;
}


/** Append many rows to one tab in a single write. */
function appendRows_(tabName, rows) {
  if (!rows || !rows.length) return 0;
  const sh = tab_(tabName);
  if (!sh) return 0;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return rows.length;
}


/*********************** HISTORY BACKFILL (quarter by quarter) ***********************
 * Why quarters: Apps Script stops a run at ~6 minutes. A quarter fits comfortably,
 * and each quarter is verified on its own so a gap is easy to localise.
 *
 * USE: menu > Party Radar > Backfill: run next quarter   (repeat until it says DONE)
 *      menu > Party Radar > Backfill: status / verify all
 ************************************************************************************/


function quarterRange_(y, q) {
  const sm = (q - 1) * 3;
  const f = (d) => d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') +
                   '/' + String(d.getDate()).padStart(2, '0');
  return { label: y + '-Q' + q, after: f(new Date(y, sm, 1)), before: f(new Date(y, sm + 3, 1)) };
}


/** Which quarter runs next: resumes from a Script Property, oldest first. */
function nextQuarter_() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('BACKFILL_CURSOR');
  const now = new Date();
  const endY = now.getFullYear(), endQ = Math.floor(now.getMonth() / 3) + 1;
  let y, q;
  if (saved) { const p = saved.split('-'); y = Number(p[0]); q = Number(p[1]); }
  else { y = CFG.HISTORY_START_YEAR; q = 1; }
  if (y > endY || (y === endY && q > endQ)) return null;
  return { y: y, q: q, isLast: (y === endY && q === endQ) };
}


function advanceQuarter_(y, q) {
  q++; if (q > 4) { q = 1; y++; }
  PropertiesService.getScriptProperties().setProperty('BACKFILL_CURSOR', y + '-' + q);
}


/** Reset so the next run starts over at CFG.HISTORY_START_YEAR Q1. */
function DISABLED_backfillReset() {
  PropertiesService.getScriptProperties().deleteProperty('BACKFILL_CURSOR');
  runLog_('backfillReset', 'OK', 'Cursor cleared — next run starts at ' + CFG.HISTORY_START_YEAR + '-Q1');
  alert_('Backfill cursor cleared. Next run starts at ' + CFG.HISTORY_START_YEAR + '-Q1.');
}


/** Historical backfill now belongs to the restartable API exporter, not Gmail. */
function DISABLED_backfillNextQuarter() {
  const msg = 'Email backfill was removed. Use pcs-export export-all for historical API collection.';
  runLog_('backfillNextQuarter', 'DISABLED', msg);
  alert_(msg);
}


/** Progress + a reconciliation pass over every quarter already processed. */
function DISABLED_backfillStatus() {
  const sh = tab_(TABS.BACKFILL);
  const data = sh ? sh.getDataRange().getValues() : [];
  const nq = nextQuarter_();
  const lines = [];
  lines.push('Main file v' + CFG.VERSION);
  lines.push('Next quarter to run: ' + (nq ? nq.y + '-Q' + nq.q : 'none — backfill complete'));
  lines.push('Quarters processed: ' + Math.max(data.length - 1, 0));
  let ev = 0, items = 0, checks = [];
  for (let i = 1; i < data.length; i++) {
    ev += Number(data[i][4]) || 0;
    items += Number(data[i][8]) || 0;
    if (String(data[i][11]) !== 'VERIFIED') checks.push(data[i][1] + ': ' + data[i][12]);
  }
  lines.push('Total parties captured: ' + ev);
  lines.push('Total line items captured: ' + items);
  lines.push(checks.length ? '\nQuarters needing attention:\n' + checks.join('\n')
                           : '\nEvery processed quarter verified clean.');
  const msg = lines.join('\n');
  runLog_('backfillStatus', 'INFO', msg.replace(/\n/g, ' | '));
  alert_(msg);
}


/*********************** DASHBOARD (YoY / MoM) ***********************/


/** Rebuilds the Dashboard tab from Completed + Cancelled + Upcoming rows.
 *  Monthly block carries MoM and YoY comparisons; annual block carries YoY. */
function buildDashboard() {
  const sh = tab_(TABS.DASH) || getSS_().insertSheet(TABS.DASH);
  const H = HEADERS[TABS.EVENTS];
  const col = (n) => H.indexOf(n);
  const months = {};   // 'YYYY-MM' -> aggregates
  const years = {};


  [TABS.COMPLETED, TABS.EVENTS].forEach(t => {
    const s = tab_(t); if (!s) return;
    const d = s.getDataRange().getValues();
    for (let i = 1; i < d.length; i++) {
      if (String(d[i][col('Status')]) === 'CANCELLED') continue;
      const dt = parseDate_(d[i][col('Party Date')]);
      if (!dt) continue;
      const y = dt.getFullYear();
      const key = y + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      const rev = Number(d[i][col('Total With Tip')]) || Number(d[i][col('Sub Total')]) || 0;
      const tip = Number(d[i][col('Tip')]) || 0;
      const gc  = Number(d[i][col('Guest Count')]) || 0;
      [months[key] = months[key] || { ev: 0, rev: 0, tip: 0, gc: 0 },
       years[y]    = years[y]    || { ev: 0, rev: 0, tip: 0, gc: 0 }].forEach(a => {
        a.ev++; a.rev += rev; a.tip += tip; a.gc += gc;
      });
    }
  });


  const r2 = (n) => Math.round(n * 100) / 100;
  const pct = (cur, prev) => (prev > 0) ? r2((cur - prev) / prev * 100) + '%' : '';
  const rows = [];
  rows.push(['MONTH OVER MONTH', '', '', '', '', '', '', '', '', '']);
  rows.push(['Month', 'Events', 'Guests', 'Revenue', 'Tips', 'Avg Ticket', 'Avg Guests',
             'Tip %', 'vs Prior Month', 'vs Same Month Last Year']);
  Object.keys(months).sort().reverse().forEach(k => {
    const a = months[k];
    const [yy, mm] = k.split('-').map(Number);
    const prevM = (mm === 1 ? (yy - 1) + '-12' : yy + '-' + String(mm - 1).padStart(2, '0'));
    const prevY = (yy - 1) + '-' + String(mm).padStart(2, '0');
    rows.push([k, a.ev, a.gc, r2(a.rev), r2(a.tip),
      a.ev ? r2(a.rev / a.ev) : 0, a.ev ? r2(a.gc / a.ev) : 0,
      a.rev ? r2(a.tip / a.rev * 100) + '%' : '',
      pct(a.rev, months[prevM] ? months[prevM].rev : 0),
      pct(a.rev, months[prevY] ? months[prevY].rev : 0)]);
  });
  rows.push(['', '', '', '', '', '', '', '', '', '']);
  rows.push(['YEAR OVER YEAR', '', '', '', '', '', '', '', '', '']);
  rows.push(['Year', 'Events', 'Guests', 'Revenue', 'Tips', 'Avg Ticket', 'Avg Guests',
             'Tip %', 'vs Prior Year', '']);
  Object.keys(years).sort().reverse().forEach(y => {
    const a = years[y];
    rows.push([y, a.ev, a.gc, r2(a.rev), r2(a.tip),
      a.ev ? r2(a.rev / a.ev) : 0, a.ev ? r2(a.gc / a.ev) : 0,
      a.rev ? r2(a.tip / a.rev * 100) + '%' : '',
      pct(a.rev, years[Number(y) - 1] ? years[Number(y) - 1].rev : 0), '']);
  });
  rows.push(['', '', '', '', '', '', '', '', '', '']);
  rows.push(['Rebuilt ' + now_() + ' — main file v' + CFG.VERSION +
    '. Revenue uses Total With Tip; cancelled events excluded.', '', '', '', '', '', '', '', '', '']);


  sh.clear();
  sh.getRange(1, 1, rows.length, 10).setValues(rows);
  sh.getRange(1, 1, 1, 10).setFontWeight('bold');
  sh.getRange(2, 1, 1, 10).setFontWeight('bold');
  const yoyHeaderRow = rows.findIndex(r => r[0] === 'YEAR OVER YEAR') + 1;
  if (yoyHeaderRow > 0) {
    sh.getRange(yoyHeaderRow, 1, 1, 10).setFontWeight('bold');
    sh.getRange(yoyHeaderRow + 1, 1, 1, 10).setFontWeight('bold');
  }
  sh.setFrozenRows(2);
  runLog_('buildDashboard', 'OK', Object.keys(months).length + ' months, ' +
    Object.keys(years).length + ' years summarised');
}


/** Alert that also works when run from the script editor (no UI available). */
function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* editor run — see Run Log */ }
}


/** One-time cleanup: strips leftover "* " from Party Date cells and repairs
 *  PENDING Outbox rows (asterisk names, blank phones, stale text) using the
 *  now-clean data in Upcoming Events. Safe to run repeatedly. */
function cleanupV12() {
  const sh = tab_(TABS.EVENTS);
  const H = HEADERS[TABS.EVENTS]; const col = (n) => H.indexOf(n);
  const data = sh.getDataRange().getValues();
  let fixedDates = 0;
  const byOrder = {};
  for (let i = 1; i < data.length; i++) {
    const pd = String(data[i][col('Party Date')]);
    if (/^\*\s*/.test(pd)) {
      const clean = pd.replace(/^\*\s*/, '');
      sh.getRange(i + 1, col('Party Date') + 1).setValue(clean);
      data[i][col('Party Date')] = clean;
      fixedDates++;
    }
    byOrder[String(data[i][0])] = rowToRec_(data[i], col);
  }
  const ob = tab_(TABS.OUTBOX);
  const od = ob.getDataRange().getValues();
  let fixedMsgs = 0;
  for (let i = 1; i < od.length; i++) {
    if (od[i][7] !== 'PENDING') continue;
    const rec = byOrder[String(od[i][1])];
    if (!rec) continue;
    const needs = /\*/.test(String(od[i][2])) || !od[i][3] || /\*/.test(String(od[i][6]));
    if (!needs) continue;
    ob.getRange(i + 1, 3).setValue(rec.customer);
    ob.getRange(i + 1, 4).setValue(rec.phone);
    ob.getRange(i + 1, 7).setValue(fill_(TEMPLATES[od[i][4]] || '', rec));
    fixedMsgs++;
  }
  runLog_('cleanupV12', 'OK', fixedDates + ' dates cleaned; ' + fixedMsgs + ' Outbox messages repaired');
}
