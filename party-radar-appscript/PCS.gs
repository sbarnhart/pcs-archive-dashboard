/*********************************************************************
 * PCS.gs — PCS API SYNC MODULE — v2.7
 * (add as 2nd file in the same project; pairs with main file v2.6)
 * Source of truth: pulls next-30-days party bookings hourly from the
 * PCS API (READ-ONLY). No Gmail access is used.
 *
 * VERSION HISTORY:
 *  v1.0 — discoverPCS/setupPCS/syncPCS, cancellation detection,
 *         defensive field mapping (pending discoverPCS() confirmation)
 *  v2.1 — API-only paged sync, tracked-order reconciliation, sales,
 *         refunds, guest-of-honor, and line-item mapping
 *  v2.2 — incremental order-type scans avoid PCS combined-filter SQL timeouts
 *  v2.3 — verified OrderDate windows replace unreliable OrderType queries
 *  v2.4 — pairs with clearly labeled disabled legacy entry points
 *  v2.5 — pairs with automatic Dashboard creation and target-sheet diagnostics
 *  v2.6 — accelerated history bootstrap and party-local date/time mapping
 *  v2.7 — treats zone-less PCS event timestamps as UTC before Pacific conversion
 *
 * REQUIRES from the main file: tab_(), runLog_(), mgmtEmail_(), TABS,
 *   HEADERS, upsertEvent_(), validate_(), upsells_(). Keep both files
 *   in the same Apps Script project — do not paste one into the other.
 *
 * SETUP:
 * 1) Script Properties: PCS_FACILITY_ID = 36-character facility credential UUID
 *                       PCS_COMPANY_ID = numeric company id (636)
 * 2) Run discoverPCS() once -> check Run Log. If orders list correctly, run setupPCS().
 * 3) setupPCS() adds the hourly sync trigger.
 *********************************************************************/


const PCS = {
  VERSION: '2.7',
  BASE: 'https://api.partycs.com',
  TYPE_PARTY: [1, 3],        // 1=Event/In-House Party, 3=Online Party
  STATUS: { OPEN: 1, CANCELLED: 2, CLOSED: 3, QUOTE: 4, PENDING: 5 },
  DAYS_AHEAD: 30,
  PAGE_SIZE: 100,
  RECENT_BOOKING_DAYS: 14,
  HISTORY_WINDOW_DAYS: 30,
  HISTORY_MAX_DAYS: 365,
};


/*********************** ONE-TIME ***********************/
function setupPCS() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncPCS') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncPCS').timeBased().everyHours(1).create();
  runLog_('setupPCS', 'OK', 'PCS module v' + PCS.VERSION + ' — hourly sync trigger created');
}


/** Run once after installation to discover older bookings without one oversized API query. */
function bootstrapUpcomingPCS() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('PCS_HISTORY_DAYS_BACK', String(PCS.RECENT_BOOKING_DAYS));
  props.deleteProperty('PCS_HISTORY_BOOTSTRAP_COMPLETE');
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'bootstrapUpcomingPCSStep') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('bootstrapUpcomingPCSStep').timeBased().everyMinutes(5).create();
  runLog_('bootstrapUpcomingPCS', 'STARTED', 'Scanning older booking windows every 5 minutes.');
  bootstrapUpcomingPCSStep();
}


function bootstrapUpcomingPCSStep() {
  syncPCS();
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('PCS_HISTORY_BOOTSTRAP_COMPLETE') !== 'TRUE') return;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'bootstrapUpcomingPCSStep') ScriptApp.deleteTrigger(t);
  });
  buildDashboard();
  runLog_('bootstrapUpcomingPCS', 'COMPLETE', 'Older booking history scanned; temporary trigger removed.');
}


/** Run once. Verifies auth, finds your facilityId, and dumps one raw
 *  order to the Run Log so field mapping can be confirmed. */
function discoverPCS() {
  const facId = PropertiesService.getScriptProperties().getProperty('PCS_FACILITY_ID');
  if (!facId) throw new Error('PCS_FACILITY_ID missing from Script Properties');
  runLog_('discoverPCS', 'FACILITY CREDENTIAL FOUND', 'Length ' + String(facId).length);
  const orders = pcsGet_('/orders', { Page: 1, Size: 3 });
  runLog_('discoverPCS', 'ORDERS SAMPLE', JSON.stringify(orders).substring(0, 2000));
  const first = pcsItems_(orders)[0];
  if (first) {
    const oid = first.id || first.Id || first.orderId || first.OrderId;
    runLog_('discoverPCS', 'ORDER DETAIL', JSON.stringify(pcsGet_('/orders/' + oid)).substring(0, 2500));
    runLog_('discoverPCS', 'ORDER PARTY', JSON.stringify(pcsGet_('/orders/' + oid + '/party')).substring(0, 1500));
  }
  runLog_('discoverPCS', 'DONE', 'Review rows above; paste to Claude if fields need remapping');
}


/*********************** HOURLY SYNC ***********************/
function syncPCS() {
  const props = PropertiesService.getScriptProperties();
  const facId = props.getProperty('PCS_FACILITY_ID');
  if (!facId) { runLog_('syncPCS', 'SKIP', 'Run discoverPCS() first'); return; }


  let orders;
  try { orders = pcsSyncCandidates_(); }
  catch (e) { runLog_('syncPCS', 'ERROR', String(e)); return; }


  let scanned = 0, upserted = 0, cancelled = 0, skipped = 0;
  const seenItems = existingItemOrders_();
  const itemRows = [];
  orders.forEach(o => {
    scanned++;
    const type = num_(o, ['type', 'Type', 'orderType', 'OrderType']);
    const status = num_(o, ['status', 'Status', 'orderStatus', 'OrderStatus']);
    if (PCS.TYPE_PARTY.indexOf(type) === -1) { skipped++; return; }          // POS/store/membership out
    if (status === PCS.STATUS.QUOTE || status === PCS.STATUS.PENDING) { skipped++; return; } // not confirmed yet


    const oid = o.id || o.Id || o.orderId || o.OrderId;
    const orderNum = num_(o, ['orderNumber', 'OrderNumber']) || oid;
    if (status === PCS.STATUS.CANCELLED) { if (markCancelled_(orderNum)) cancelled++; return; }
    if (status !== PCS.STATUS.OPEN && status !== PCS.STATUS.CLOSED) { skipped++; return; }

    // The order summary already contains the event timestamp. Filter before
    // requesting four subresources so each Apps Script run stays bounded.
    const summaryDate = str_(o, ['eventStartDateTime', 'EventStartDateTime', 'startDateTime', 'StartDateTime']);
    const summaryDays = daysUntil_(summaryDate);
    if (summaryDays === null || summaryDays < -1 || summaryDays > PCS.DAYS_AHEAD) { skipped++; return; }


    const rec = pcsOrderToRec_(oid, o);
    if (!rec) { skipped++; return; }
    const d = daysUntil_(rec.partyDate);
    if (d === null || d < -1 || d > PCS.DAYS_AHEAD) { skipped++; return; }   // 30-day window


    rec.flags = validate_(rec);
    rec.upsells = upsells_(rec);
    const isNew = upsertEvent_(rec);
    if (isNew) { queueMessage_(rec, 'BOOKING_CONFIRMATION', new Date()); recommendFixes_(rec); }
    const rows = itemRowsFor_(rec, seenItems);
    if (rows.length) {
      itemRows.push.apply(itemRows, rows);
      seenItems.add(String(rec.orderNum));
    }
    upserted++;
  });

  const itemsWritten = appendItemRows_(itemRows);
  props.setProperty('PCS_LAST_SYNC', new Date().toISOString());
  runLog_('syncPCS', 'OK', scanned + ' scanned; ' + upserted + ' parties upserted; ' +
    cancelled + ' cancelled; ' + itemsWritten + ' line items; ' + skipped + ' skipped (type/status/window)');
}


/** Recently booked orders plus one older booking window and every order
 * already tracked in Upcoming Events. OrderDateStart/OrderDateEnd are the
 * same indexed filters verified by the restartable archive exporter. */
function pcsSyncCandidates_() {
  const byId = {};
  const now = new Date();
  const recentStart = new Date(now.getTime() - PCS.RECENT_BOOKING_DAYS * 86400000);
  pcsOrderDateWindow_(recentStart, now).forEach(o => {
    const id = o.orderId || o.id || o.OrderId || o.Id;
    if (id) byId[String(id)] = o;
  });

  const props = PropertiesService.getScriptProperties();
  let historyEndDays = Number(props.getProperty('PCS_HISTORY_DAYS_BACK')) ||
    PCS.RECENT_BOOKING_DAYS;
  const historyStartDays = historyEndDays + PCS.HISTORY_WINDOW_DAYS;
  const historyStart = new Date(now.getTime() - historyStartDays * 86400000);
  const historyEnd = new Date(now.getTime() - historyEndDays * 86400000);
  pcsOrderDateWindow_(historyStart, historyEnd).forEach(o => {
    const id = o.orderId || o.id || o.OrderId || o.Id;
    if (id) byId[String(id)] = o;
  });
  if (historyStartDays >= PCS.HISTORY_MAX_DAYS)
    props.setProperty('PCS_HISTORY_BOOTSTRAP_COMPLETE', 'TRUE');
  historyEndDays = historyStartDays >= PCS.HISTORY_MAX_DAYS
    ? PCS.RECENT_BOOKING_DAYS + PCS.HISTORY_WINDOW_DAYS
    : historyStartDays;
  props.setProperty('PCS_HISTORY_DAYS_BACK', String(historyEndDays));

  const sh = tab_(TABS.EVENTS);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(row => {
      const orderNum = row[0];
      if (orderNum === '') return;
      pcsItems_(pcsGet_('/orders', { OrderNumber: orderNum, Page: 1, Size: 10 })).forEach(o => {
        if (String(num_(o, ['orderNumber', 'OrderNumber'])) !== String(orderNum)) return;
        const id = o.orderId || o.id || o.OrderId || o.Id;
        if (id) byId[String(id)] = o;
      });
    });
  }
  return Object.keys(byId).map(id => byId[id]);
}


function pcsOrderDateWindow_(start, end) {
  const rows = [];
  let page = 1;
  while (page <= 50) {
    const response = pcsGet_('/orders', {
      OrderDateStart: start.toISOString(),
      OrderDateEnd: end.toISOString(),
      Sort: 'orderId_asc',
      Page: page,
      Size: PCS.PAGE_SIZE,
    });
    rows.push.apply(rows, pcsItems_(response));
    if (!response || response.hasNextPage !== true) break;
    page++;
  }
  if (page > 50) throw new Error('PCS booking-date window exceeded 50 pages; reduce the window size.');
  return rows;
}


/*********************** ORDER -> RECORD ***********************/
function pcsOrderToRec_(oid, summary) {
  let detail = {}, party = {}, items = [], goh = [], cust = {};
  try { detail = pcsGet_('/orders/' + oid) || {}; } catch (e) {}
  try { party = pcsGet_('/orders/' + oid + '/party') || {}; } catch (e) {}
  try { items = pcsItems_(pcsGet_('/orders/' + oid + '/items')); } catch (e) {}
  try { goh = pcsItems_(pcsGet_('/orders/' + oid + '/guestsofhonor')); } catch (e) {}
  try { cust = pcsGet_('/orders/' + oid + '/customer') || {}; } catch (e) {}
  const src = Object.assign({}, summary, detail);


  const first = str_(cust, ['firstName', 'FirstName']) || '';
  const last = str_(cust, ['lastName', 'LastName']) || '';
  const customer = last && first ? last + ', ' + first
    : str_(cust, ['name', 'Name', 'organizationName', 'OrganizationName']) || str_(src, ['customerName', 'CustomerName']);


  const phones = cust.phones || cust.Phones || [];
  const phone = str_(cust, ['phone', 'Phone', 'phoneNumber', 'PhoneNumber', 'mobile', 'Mobile'])
    || (phones[0] ? (phones[0].number || phones[0].Number || '') : '');


  const addrParts = ['address1', 'Address1', 'address', 'Address', 'city', 'City', 'state', 'State', 'zip', 'Zip', 'zipCode', 'ZipCode']
    .map(k => cust[k]).filter(v => v);


  const pd = str_(party, ['partyDate', 'PartyDate', 'date', 'Date', 'eventDate', 'EventDate'])
    || str_(src, ['partyDate', 'PartyDate', 'eventDate', 'EventDate', 'scheduledDate', 'ScheduledDate',
      'eventStartDateTime', 'EventStartDateTime', 'startDateTime', 'StartDateTime']);
  if (!pd) return null;   // party orders without a date can't be scheduled


  const startT = str_(party, ['startTime', 'StartTime', 'partyTime', 'PartyTime']);
  const endT = str_(party, ['endTime', 'EndTime']);


  const itemNames = items.map(it => str_(it, ['name', 'Name', 'productName', 'ProductName', 'description', 'Description']))
    .filter(n => n);
  const eventStart = str_(src, ['eventStartDateTime', 'EventStartDateTime', 'startDateTime', 'StartDateTime']);
  const eventEnd = str_(src, ['eventEndDateTime', 'EventEndDateTime', 'endDateTime', 'EndDateTime']);
  const mappedItems = items.map(it => {
    const qty = num_(it, ['quantity', 'Quantity']) || 0;
    const unit = num_(it, ['price', 'Price', 'listPrice', 'ListPrice']) || 0;
    return {
      name: str_(it, ['productName', 'ProductName', 'name', 'Name', 'description', 'Description']),
      qty: qty,
      unit: unit,
      total: Math.round(qty * unit * 100) / 100,
    };
  });


  const rec = {
    orderNum: String(num_(src, ['orderNumber', 'OrderNumber']) || oid),
    orderDate: str_(src, ['createdDate', 'CreatedDate', 'orderDate', 'OrderDate', 'created', 'Created']),
    isStorefront: false,
    customer: customer || '',
    phone: String(phone || ''),
    email: str_(cust, ['email', 'Email', 'emailAddress', 'EmailAddress']) || str_(src, ['email', 'Email']),
    address: addrParts.join(', '),
    partyDate: eventStart ? fmtPcsDateTimeDate_(eventStart) : fmtDate_(pd),
    partyTime: eventStart ? fmtPcsDateTimeTime_(eventStart) +
      (eventEnd ? ' - ' + fmtPcsDateTimeTime_(eventEnd) : '')
      : (startT ? fmtTime_(startT) + (endT ? ' - ' + fmtTime_(endT) : '') : ''),
    guestCount: String(num_(party, ['guestCount', 'GuestCount', 'guests', 'Guests'])
      || num_(src, ['guestCount', 'GuestCount']) || ''),
    balanceDue: money_(num_(src, ['balanceDue', 'BalanceDue', 'balance', 'Balance'])),
    kid: goh.length ? goh.map(g => (str_(g, ['firstName', 'FirstName']) + ' ' + str_(g, ['lastName', 'LastName'])).trim()
      .replace(/\s+/g, ' ')).join(' & ') : '',
    host: str_(party, ['host', 'Host', 'hostName', 'HostName']) || '',
    notes: str_(src, ['notes', 'Notes', 'comments', 'Comments']) || str_(party, ['notes', 'Notes']) || '',
    package: itemNames.length ? itemNames[0] : str_(src, ['packageName', 'PackageName', 'partyPackage', 'PartyPackage']),
    addons: itemNames.slice(1).join(' | '),
    sales: {
      subTotal: num_(src, ['subTotal', 'SubTotal']) || 0,
      tax: num_(src, ['tax', 'Tax']) || 0,
      tip: num_(src, ['tip', 'Tip']) || 0,
      grandTotal: (num_(src, ['orderTotal', 'OrderTotal']) || 0) + (num_(src, ['tip', 'Tip']) || 0),
      amountPaid: num_(src, ['totalPayments', 'TotalPayments']) || 0,
      methods: '',
      reversals: (num_(src, ['totalRefunds', 'TotalRefunds']) || 0) ? 'Refund total $' + Number(num_(src, ['totalRefunds', 'TotalRefunds'])).toFixed(2) : '',
    },
    items: mappedItems,
  };
  const nm = (rec.customer || '').match(/^([^,]+),\s*(.+)$/);
  rec.first = nm ? nm[2].trim() : (rec.customer || '').split(' ')[0];
  // PCS DoNotSolicit flag -> respect it: flag so no marketing texts go out
  if (cust.doNotSolicit === true || cust.DoNotSolicit === true)
    rec.notes = ('DO NOT SOLICIT (per PCS). ' + rec.notes).trim();
  return rec;
}


function markCancelled_(oid) {
  const sh = tab_(TABS.EVENTS);
  const data = sh.getDataRange().getValues();
  const H = HEADERS[TABS.EVENTS]; const col = (n) => H.indexOf(n);
  for (let i = 1; i < data.length; i++) {
    // matches by order number OR raw id (rec stores orderNumber when present)
    if (String(data[i][0]) === String(oid) && data[i][col('Status')] !== 'CANCELLED') {
      sh.getRange(i + 1, col('Status') + 1).setValue('CANCELLED');
      tab_(TABS.CHANGES).appendRow([now_(), data[i][0], 'Status', 'ACTIVE', 'CANCELLED', 'PCS API']);
      logMsg_(data[i][0], data[i][col('Customer')], 'BOOKING CANCELLED', 'SYSTEM', 'PCS API', 'LOGGED', '');
      mgmtEmail_('❌ Party CANCELLED — Order ' + data[i][0] + ' (' + data[i][col('Customer')] + ')',
        'Party date was ' + data[i][col('Party Date')] + '. Deposit policy: non-refundable; ' +
        '14+ days notice = usable within 2 months. Check Recommended Changes for follow-up.');
      tab_(TABS.RECS).appendRow([now_(), data[i][0], data[i][col('Customer')], 'DATA FIX',
        'Cancelled in PCS — confirm deposit handling & remove pending Outbox messages', 'OPEN', '']);
      return true;
    }
  }
  return false;
}


/*********************** HTTP + FIELD HELPERS ***********************/
function pcsGet_(path, params) {
  const props = PropertiesService.getScriptProperties();
  const facilityId = props.getProperty('PCS_FACILITY_ID');
  if (!facilityId) throw new Error('PCS_FACILITY_ID missing from Script Properties');
  const companyId = props.getProperty('PCS_COMPANY_ID');
  if (!companyId) throw new Error('PCS_COMPANY_ID missing from Script Properties');
  const headers = {
    'pcs-facility-id': facilityId,
    'pcs-company-id': companyId,
    'accept': 'application/json'
  };
  let url = PCS.BASE + path;
  if (params) {
    const q = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
    url += '?' + q;
  }
  const resp = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
  const code = resp.getResponseCode();
  if (code === 401 || code === 403)
    throw new Error('PCS auth failed (' + code + '). Verify PCS_FACILITY_ID is the 36-character facility credential UUID and PCS_COMPANY_ID is 636.');
  if (code >= 400) throw new Error('PCS ' + code + ' on ' + path + ': ' + resp.getContentText().substring(0, 300));
  return JSON.parse(resp.getContentText());
}


// Paginated lists may arrive as {items:[...]} / {data:[...]} / bare array
function pcsItems_(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  return resp.items || resp.Items || resp.data || resp.Data || resp.results || resp.Results ||
    resp.people || resp.People || [];
}
function str_(o, keys) { for (const k of keys) if (o && o[k] != null && o[k] !== '') return String(o[k]); return ''; }
function num_(o, keys) { for (const k of keys) if (o && o[k] != null && o[k] !== '') return Number(o[k]); return null; }
function money_(n) { return n == null ? '' : '$' + Number(n).toFixed(2); }
function parsePcsDateTime_(s) {
  let raw = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw += 'Z';
  const d = new Date(raw);
  return isNaN(d) ? null : d;
}
function fmtPcsDateTimeDate_(s) {
  const d = parsePcsDateTime_(s);
  return d ? Utilities.formatDate(d, CFG.TZ, 'EEE, MMM d, yyyy') : String(s);
}
function fmtPcsDateTimeTime_(s) {
  const d = parsePcsDateTime_(s);
  return d ? Utilities.formatDate(d, CFG.TZ, 'h:mm a') : String(s);
}
function fmtDate_(s) { const d = parseDate_(s); return d ? Utilities.formatDate(d, CFG.TZ, 'EEE, MMM d, yyyy') : String(s); }
function fmtTime_(s) {
  if (/[AP]M/i.test(s)) return String(s).trim();
  const d = new Date(s); if (!isNaN(d)) return Utilities.formatDate(d, CFG.TZ, 'h:mm a');
  const m = String(s).match(/^(\d{1,2}):(\d{2})/);
  if (m) { let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + m[2] + ' ' + ap; }
  return String(s);
}
