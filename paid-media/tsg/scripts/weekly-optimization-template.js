/**
 * ============================================================
 * TSG — Weekly Optimisation Data Script
 * TEMPLATE — customise per client (see SETUP NOTES)
 * Component 1 of 3: Google Ads Script
 *
 * --- SETUP NOTES (read before first run) ---
 * 1. Create a NEW Google Sheet for the client (don't reuse another
 *    client's sheet). Copy its URL into CONFIG.SPREADSHEET_URL below.
 * 2. Paste this whole file into the client's Google Ads account:
 *    Tools > Bulk Actions > Scripts > (+) New script.
 * 3. Authorise when prompted, then Preview/Run once.
 * 4. Open the Sheet and fill in the 5_Settings tab with the client's
 *    real Monthly Budget and Target CPA. Until then the script falls back
 *    to the DEFAULT_* values in CONFIG. Set DEFAULT_TARGET_CPA to the
 *    client's conversion type (cost per lead OR cost per sale).
 * -------------------------------------------------------------
 *
 * v1.2 — 6_MTD_Pacing now includes YoY same-period comparison
 *        (spend, conversions, CPL) alongside prior month.
 *        Historical queries include REMOVED campaigns so deleted
 *        campaigns still show up in YoY/prior month totals.
 * v1.1 — Adds 6_MTD_Pacing sheet for spend, conversions, CPL
 *        pacing vs. Monthly Budget and Target CPA from 5_Settings.
 * ============================================================
 * WHAT IT DOES:
 * Pulls campaign, keyword, ad, search term, and MTD pacing data
 * from your Google Ads account and writes it to a Google Sheet.
 * Then triggers the AI analysis via Apps Script.
 *
 * SETUP (do this once):
 * 1. In Google Ads, go to Tools > Bulk Actions > Scripts
 * 2. Open your existing script (or create a new one with the + button)
 * 3. Replace the entire script contents with this file
 * 4. Confirm SPREADSHEET_URL below matches your Sheet URL
 * 5. Authorise when prompted
 * ============================================================
 */
// ============================================================
// CONFIGURATION — edit these values
// ============================================================
var CONFIG = {
  // >>> paste the URL of the NEW client Google Sheet here <<<
  SPREADSHEET_URL: 'PASTE_WILLO_GOOGLE_SHEET_URL_HERE',
  LOOKBACK_DAYS: 7,               // how many days of data to pull on weekly runs
  FIRST_RUN_LOOKBACK_DAYS: 90,    // longer lookback on first run for baseline context
  MIN_IMPRESSIONS: 10,            // ignore search terms below this threshold
  MAX_ROWS_PER_SHEET: 500,        // cap rows to keep sheet manageable
  // Fallback defaults if 5_Settings hasn't been filled in yet.
  // Size these to the client — replace by filling the 5_Settings tab
  // with the client's actual numbers.
  DEFAULT_MONTHLY_BUDGET: 3000,   // placeholder — confirm with client
  DEFAULT_TARGET_CPA: 150,        // placeholder — target cost per conversion
  DEFAULT_MAX_CPA: 250,           // placeholder — upper tolerable CPA
  ACCOUNT_NAME: AdsApp.currentAccount().getName(),
  CURRENCY: AdsApp.currentAccount().getCurrencyCode()
};
// ============================================================
// HELPERS
// ============================================================
function parseMoney(val) {
  if (val === null || val === undefined || val === '') return 0;
  return parseFloat(String(val).replace(/,/g, '')) || 0;
}
// ============================================================
// MAIN — entry point
// ============================================================
function main() {
  Logger.log('TGD — starting for account: ' + CONFIG.ACCOUNT_NAME);
  var ss = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var isFirstRun = isFirstRunCheck(ss);
  var lookbackDays = isFirstRun ? CONFIG.FIRST_RUN_LOOKBACK_DAYS : CONFIG.LOOKBACK_DAYS;
  Logger.log(isFirstRun ? 'FIRST RUN detected — pulling ' + lookbackDays + ' days of baseline data.' : 'Weekly run — pulling ' + lookbackDays + ' days.');
  var dateRange = buildDateRanges(lookbackDays);
  writeCampaignData(ss, dateRange);
  writeKeywordData(ss, dateRange);
  writeAdData(ss, dateRange);
  writeSearchTermData(ss, dateRange);
  // New in v1.1 — MTD pacing. Wrapped in try/catch so a pacing failure
  // doesn't kill meta/settings writes downstream.
  try {
    writeMTDPacing(ss, new Date());
  } catch (e) {
    Logger.log('MTD Pacing failed: ' + e.message);
  }
  writeMetaSheet(ss, dateRange, isFirstRun);
  writeSettingsSheet(ss, isFirstRun);
  Logger.log('Data written. Triggering AI analysis...');
  triggerAIAnalysis(ss);
}
// ============================================================
// FIRST RUN DETECTION
// ============================================================
function isFirstRunCheck(ss) {
  var metaSheet = ss.getSheetByName('0_Meta');
  if (!metaSheet) return true;
  var data = metaSheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === 'Run Type' && (data[i][1] === 'BASELINE' || data[i][1] === 'WEEKLY')) {
      return false;
    }
  }
  return true;
}
// ============================================================
// DATE RANGES
// ============================================================
function buildDateRanges(lookbackDays) {
  var today = new Date();
  var currentEnd = new Date(today);
  currentEnd.setDate(currentEnd.getDate() - 1);
  var currentStart = new Date(currentEnd);
  currentStart.setDate(currentStart.getDate() - (lookbackDays - 1));
  var priorEnd = new Date(currentStart);
  priorEnd.setDate(priorEnd.getDate() - 1);
  var priorStart = new Date(priorEnd);
  priorStart.setDate(priorStart.getDate() - (lookbackDays - 1));
  return {
    lookbackDays: lookbackDays,
    current: { start: formatDate(currentStart), end: formatDate(currentEnd), label: formatDate(currentStart) + ' to ' + formatDate(currentEnd) },
    prior: { start: formatDate(priorStart), end: formatDate(priorEnd), label: formatDate(priorStart) + ' to ' + formatDate(priorEnd) }
  };
}
function formatDate(d) {
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return yyyy + mm + dd;
}
function formatDateReadable(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// ============================================================
// CAMPAIGN DATA
// ============================================================
function writeCampaignData(ss, dateRange) {
  var sheet = getOrCreateSheet(ss, '1_Campaigns');
  sheet.clearContents();
  var headers = [
    'Campaign', 'Status', 'Budget (daily)', 'Spend (period)',
    'Avg Daily Spend', 'Budget Utilisation %',
    'Impressions', 'Clicks', 'CTR %', 'Avg CPC',
    'Conversions', 'Conv Rate %', 'Cost/Conv', 'Conv Value', 'ROAS',
    'Impr Share %', 'Lost IS (Budget) %', 'Lost IS (Rank) %',
    'Prior Spend', 'Prior Conversions', 'Prior ROAS',
    'Spend Change %', 'Conv Change %', 'ROAS Change %'
  ];
  sheet.appendRow(headers);
  var currentReport = AdsApp.report(
    'SELECT CampaignName, CampaignStatus, Amount, Cost, Impressions, Clicks, ' +
    'Ctr, AverageCpc, Conversions, ConversionRate, CostPerConversion, ' +
    'ConversionValue, ValuePerConversion, SearchImpressionShare, ' +
    'SearchBudgetLostImpressionShare, SearchRankLostImpressionShare ' +
    'FROM CAMPAIGN_PERFORMANCE_REPORT ' +
    'WHERE CampaignStatus IN [ENABLED, PAUSED] ' +
    'DURING ' + dateRange.current.start + ',' + dateRange.current.end
  );
  var priorMap = {};
  var priorReport = AdsApp.report(
    'SELECT CampaignName, Cost, Conversions, ConversionValue ' +
    'FROM CAMPAIGN_PERFORMANCE_REPORT ' +
    'WHERE CampaignStatus IN [ENABLED, PAUSED] ' +
    'DURING ' + dateRange.prior.start + ',' + dateRange.prior.end
  );
  var priorRows = priorReport.rows();
  while (priorRows.hasNext()) {
    var r = priorRows.next();
    priorMap[r['CampaignName']] = {
      spend: parseMoney(r['Cost']) || 0,
      conversions: parseFloat(r['Conversions']) || 0,
      convValue: parseMoney(r['ConversionValue']) || 0
    };
  }
  var rows = currentReport.rows();
  var rowCount = 0;
  while (rows.hasNext() && rowCount < CONFIG.MAX_ROWS_PER_SHEET) {
    var row = rows.next();
    var campaignName = row['CampaignName'];
    var budget = parseMoney(row['Amount']) || 0;
    var spend = parseMoney(row['Cost']) || 0;
    var conversions = parseFloat(row['Conversions']) || 0;
    var convValue = parseMoney(row['ConversionValue']) || 0;
    var avgDailySpend = spend / CONFIG.LOOKBACK_DAYS;
    var budgetUtil = budget > 0 ? (avgDailySpend / budget * 100) : 0;
    var roas = spend > 0 ? (convValue / spend) : 0;
    var prior = priorMap[campaignName] || { spend: 0, conversions: 0, convValue: 0 };
    var priorRoas = prior.spend > 0 ? (prior.convValue / prior.spend) : 0;
    var spendChange = prior.spend > 0 ? ((spend - prior.spend) / prior.spend * 100) : 0;
    var convChange = prior.conversions > 0 ? ((conversions - prior.conversions) / prior.conversions * 100) : 0;
    var roasChange = priorRoas > 0 ? ((roas - priorRoas) / priorRoas * 100) : 0;
    sheet.appendRow([
      campaignName, row['CampaignStatus'], budget.toFixed(2), spend.toFixed(2),
      avgDailySpend.toFixed(2), budgetUtil.toFixed(1),
      parseInt(row['Impressions']), parseInt(row['Clicks']),
      parseFloat(row['Ctr']).toFixed(2), parseMoney(row['AverageCpc']).toFixed(2),
      conversions.toFixed(1), parseFloat(row['ConversionRate']).toFixed(2),
      parseMoney(row['CostPerConversion']).toFixed(2), convValue.toFixed(2), roas.toFixed(2),
      row['SearchImpressionShare'] || '', row['SearchBudgetLostImpressionShare'] || '', row['SearchRankLostImpressionShare'] || '',
      prior.spend.toFixed(2), prior.conversions.toFixed(1), priorRoas.toFixed(2),
      spendChange.toFixed(1), convChange.toFixed(1), roasChange.toFixed(1)
    ]);
    rowCount++;
  }
  formatHeaderRow(sheet);
  Logger.log('Campaigns: ' + rowCount + ' rows written');
}
// ============================================================
// KEYWORD DATA
// ============================================================
function writeKeywordData(ss, dateRange) {
  var sheet = getOrCreateSheet(ss, '2_Keywords');
  sheet.clearContents();
  var headers = [
    'Campaign', 'Ad Group', 'Keyword', 'Match Type', 'Status',
    'Impressions', 'Clicks', 'CTR %', 'Avg CPC',
    'Conversions', 'Conv Rate %', 'Cost', 'Cost/Conv',
    'Conv Value', 'ROAS', 'Quality Score', 'Top of Page IS %'
  ];
  sheet.appendRow(headers);
  var report = AdsApp.report(
    'SELECT CampaignName, AdGroupName, Criteria, KeywordMatchType, Status, ' +
    'Impressions, Clicks, Ctr, AverageCpc, Conversions, ConversionRate, ' +
    'Cost, CostPerConversion, ConversionValue, SearchTopImpressionShare, QualityScore ' +
    'FROM KEYWORDS_PERFORMANCE_REPORT ' +
    'WHERE Status IN [ENABLED, PAUSED] ' +
    'AND Impressions > 0 ' +
    'DURING ' + dateRange.current.start + ',' + dateRange.current.end
  );
  var rows = report.rows();
  var rowCount = 0;
  while (rows.hasNext() && rowCount < CONFIG.MAX_ROWS_PER_SHEET) {
    var row = rows.next();
    var spend = parseMoney(row['Cost']) || 0;
    var convValue = parseMoney(row['ConversionValue']) || 0;
    var roas = spend > 0 ? (convValue / spend) : 0;
    sheet.appendRow([
      row['CampaignName'], row['AdGroupName'], row['Criteria'], row['KeywordMatchType'], row['Status'],
      parseInt(row['Impressions']), parseInt(row['Clicks']),
      parseFloat(row['Ctr']).toFixed(2), parseMoney(row['AverageCpc']).toFixed(2),
      parseFloat(row['Conversions']).toFixed(1), parseFloat(row['ConversionRate']).toFixed(2),
      spend.toFixed(2), parseMoney(row['CostPerConversion']).toFixed(2),
      convValue.toFixed(2), roas.toFixed(2),
      row['QualityScore'] || '', row['SearchTopImpressionShare'] || ''
    ]);
    rowCount++;
  }
  formatHeaderRow(sheet);
  Logger.log('Keywords: ' + rowCount + ' rows written');
}
// ============================================================
// AD DATA
// ============================================================
function writeAdData(ss, dateRange) {
  var sheet = getOrCreateSheet(ss, '3_Ads');
  sheet.clearContents();
  var headers = [
    'Campaign', 'Ad Group', 'Ad Type', 'Headlines', 'Descriptions',
    'Final URL', 'Status', 'Ad Strength',
    'Impressions', 'Clicks', 'CTR %',
    'Conversions', 'Conv Rate %', 'Cost', 'Cost/Conv', 'Conv Value', 'ROAS'
  ];
  sheet.appendRow(headers);
  var report = AdsApp.report(
    'SELECT CampaignName, AdGroupName, AdType, HeadlinePart1, HeadlinePart2, ' +
    'Description, AdStrengthInfo, Status, Impressions, Clicks, Ctr, ' +
    'Conversions, ConversionRate, Cost, CostPerConversion, ConversionValue, ' +
    'CreativeFinalUrls ' +
    'FROM AD_PERFORMANCE_REPORT ' +
    'WHERE Status IN [ENABLED, PAUSED] ' +
    'AND Impressions > 0 ' +
    'DURING ' + dateRange.current.start + ',' + dateRange.current.end
  );
  var rows = report.rows();
  var rowCount = 0;
  while (rows.hasNext() && rowCount < CONFIG.MAX_ROWS_PER_SHEET) {
    var row = rows.next();
    var spend = parseMoney(row['Cost']) || 0;
    var convValue = parseMoney(row['ConversionValue']) || 0;
    var roas = spend > 0 ? (convValue / spend) : 0;
    sheet.appendRow([
      row['CampaignName'], row['AdGroupName'], row['AdType'],
      row['HeadlinePart1'] + ' | ' + row['HeadlinePart2'],
      row['Description'], row['CreativeFinalUrls'], row['Status'], row['AdStrengthInfo'] || '',
      parseInt(row['Impressions']), parseInt(row['Clicks']), parseFloat(row['Ctr']).toFixed(2),
      parseFloat(row['Conversions']).toFixed(1), parseFloat(row['ConversionRate']).toFixed(2),
      spend.toFixed(2), parseMoney(row['CostPerConversion']).toFixed(2),
      convValue.toFixed(2), roas.toFixed(2)
    ]);
    rowCount++;
  }
  formatHeaderRow(sheet);
  Logger.log('Ads: ' + rowCount + ' rows written');
}
// ============================================================
// SEARCH TERM DATA
// ============================================================
function writeSearchTermData(ss, dateRange) {
  var sheet = getOrCreateSheet(ss, '4_SearchTerms');
  sheet.clearContents();
  var headers = [
    'Campaign', 'Ad Group', 'Search Term', 'Matched Keyword', 'Match Type',
    'Impressions', 'Clicks', 'CTR %', 'Avg CPC',
    'Conversions', 'Conv Rate %', 'Cost', 'Cost/Conv', 'Conv Value', 'ROAS',
    'Added/Excluded'
  ];
  sheet.appendRow(headers);
  var report = AdsApp.report(
    'SELECT CampaignName, AdGroupName, Query, KeywordTextMatchingQuery, ' +
    'QueryMatchTypeWithVariant, Impressions, Clicks, Ctr, AverageCpc, ' +
    'Conversions, ConversionRate, Cost, CostPerConversion, ConversionValue, ' +
    'QueryTargetingStatus ' +
    'FROM SEARCH_QUERY_PERFORMANCE_REPORT ' +
    'WHERE Impressions >= ' + CONFIG.MIN_IMPRESSIONS + ' ' +
    'DURING ' + dateRange.current.start + ',' + dateRange.current.end
  );
  var rows = report.rows();
  var rowCount = 0;
  while (rows.hasNext() && rowCount < CONFIG.MAX_ROWS_PER_SHEET) {
    var row = rows.next();
    var spend = parseMoney(row['Cost']) || 0;
    var convValue = parseMoney(row['ConversionValue']) || 0;
    var roas = spend > 0 ? (convValue / spend) : 0;
    sheet.appendRow([
      row['CampaignName'], row['AdGroupName'], row['Query'],
      row['KeywordTextMatchingQuery'], row['QueryMatchTypeWithVariant'],
      parseInt(row['Impressions']), parseInt(row['Clicks']),
      parseFloat(row['Ctr']).toFixed(2), parseMoney(row['AverageCpc']).toFixed(2),
      parseFloat(row['Conversions']).toFixed(1), parseFloat(row['ConversionRate']).toFixed(2),
      spend.toFixed(2), parseMoney(row['CostPerConversion']).toFixed(2),
      convValue.toFixed(2), roas.toFixed(2),
      row['QueryTargetingStatus'] || ''
    ]);
    rowCount++;
  }
  formatHeaderRow(sheet);
  Logger.log('Search Terms: ' + rowCount + ' rows written');
}
// ============================================================
// MTD PACING (NEW in v1.1)
// ----------------------------------------------------------------
// Writes a 6_MTD_Pacing sheet with:
//   - Account-level pacing on spend, conversions, and CPL
//     measured against Monthly Budget + Target CPA from 5_Settings
//   - Per-campaign MTD spend, conv, CPL, and EOM projections
//
// Pacing math:
//   Expected MTD Spend  = Monthly Budget × (days elapsed / days in month)
//   Expected MTD Conv   = (Monthly Budget / Target CPA) × % month elapsed
//   Projected EOM       = MTD value / % month elapsed   (linear extrapolation)
//
// Status bands:
//   ON PACE        — |spend Δ| ≤ 10%, |conv Δ| ≤ 10%, |CPL Δ| ≤ 15%
//   AHEAD          — CPL beating target by >20%
//   OFF PACE - CPL — CPL >30% above target
//   OVER PACE      — spend >15% above expected
//   UNDER PACE     — spend >20% below expected
//   UNDER VOLUME   — conv >20% below expected, CPL roughly on
//   MIXED          — anything else
//
// NOTE (Willo): this is a low-volume lead-gen account, so single-week
// pacing percentages can swing hard on one or two extra leads. Read the
// pacing status as directional, and weight the prior-month / YoY
// same-period columns for seasonality rather than week-to-week noise.
// ============================================================
function writeMTDPacing(ss, today) {
  var sheet = getOrCreateSheet(ss, '6_MTD_Pacing');
  sheet.clearContents();
  var settings = readSettings(ss);
  var monthlyBudget = settings.monthlyBudget;
  var targetCPA = settings.targetCPA;
  var now = today || new Date();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  var daysInMonth = monthEndDate.getDate();
  var yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  // Edge case: if today is the 1st, yesterday is in the prior month — no MTD data yet
  if (yesterday.getMonth() !== now.getMonth() || yesterday.getFullYear() !== now.getFullYear()) {
    sheet.appendRow(['MTD Pacing — ' + getMonthName(now) + ' ' + now.getFullYear()]);
    sheet.appendRow(['']);
    sheet.appendRow(['No MTD data yet — month just started.']);
    sheet.appendRow(['Run will populate from the 2nd of the month onward.']);
    formatHeaderRow(sheet);
    Logger.log('MTD Pacing: skipped (no elapsed days yet in current month)');
    return;
  }
  var daysElapsed = yesterday.getDate();
  var daysRemaining = daysInMonth - daysElapsed;
  var pctElapsed = daysElapsed / daysInMonth;
  // Pull MTD campaign performance
  var mtdReport = AdsApp.report(
    'SELECT CampaignName, CampaignStatus, Amount, Cost, Impressions, Clicks, Conversions, ConversionValue ' +
    'FROM CAMPAIGN_PERFORMANCE_REPORT ' +
    'WHERE CampaignStatus IN [ENABLED, PAUSED] ' +
    'DURING ' + formatDate(monthStart) + ',' + formatDate(yesterday)
  );
  // Pull prior month same-period for comparison (e.g., Apr 1 - Apr 20 if today is May 21)
  // Includes REMOVED so campaigns deleted since the prior month are still counted.
  var priorMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var priorMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate(); // days in prior month
  var priorSamePeriodLastDay = Math.min(daysElapsed, priorMonthDays);
  var priorSamePeriodEnd = new Date(now.getFullYear(), now.getMonth() - 1, priorSamePeriodLastDay);
  var priorReport = AdsApp.report(
    'SELECT CampaignName, Cost, Conversions ' +
    'FROM CAMPAIGN_PERFORMANCE_REPORT ' +
    'WHERE CampaignStatus IN [ENABLED, PAUSED, REMOVED] ' +
    'DURING ' + formatDate(priorMonthStart) + ',' + formatDate(priorSamePeriodEnd)
  );
  var priorMap = {};
  var priorTotalSpend = 0, priorTotalConv = 0;
  var pRows = priorReport.rows();
  while (pRows.hasNext()) {
    var pr = pRows.next();
    var pSpend = parseMoney(pr['Cost']) || 0;
    var pConv = parseFloat(pr['Conversions']) || 0;
    priorMap[pr['CampaignName']] = { spend: pSpend, conversions: pConv };
    priorTotalSpend += pSpend;
    priorTotalConv += pConv;
  }
  // Pull same-period last year (e.g., May 1 - May 20, 2025 if today is May 21, 2026)
  // Captures seasonality (e.g. budget-cycle or weather-driven swings in
  // detention renovation demand). Math.min guards against Feb 29 in a leap
  // year comparing against a non-leap year.
  var yoyMonthStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  var yoyMonthDays = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0).getDate();
  var yoyLastDay = Math.min(daysElapsed, yoyMonthDays);
  var yoyPeriodEnd = new Date(now.getFullYear() - 1, now.getMonth(), yoyLastDay);
  var yoyReport = AdsApp.report(
    'SELECT CampaignName, Cost, Conversions ' +
    'FROM CAMPAIGN_PERFORMANCE_REPORT ' +
    'WHERE CampaignStatus IN [ENABLED, PAUSED, REMOVED] ' +
    'DURING ' + formatDate(yoyMonthStart) + ',' + formatDate(yoyPeriodEnd)
  );
  var yoyMap = {};
  var yoyTotalSpend = 0, yoyTotalConv = 0;
  var yRows = yoyReport.rows();
  while (yRows.hasNext()) {
    var yr = yRows.next();
    var ySpend = parseMoney(yr['Cost']) || 0;
    var yConv = parseFloat(yr['Conversions']) || 0;
    yoyMap[yr['CampaignName']] = { spend: ySpend, conversions: yConv };
    yoyTotalSpend += ySpend;
    yoyTotalConv += yConv;
  }
  // Aggregate MTD + build per-campaign rows
  var totalSpend = 0, totalConv = 0;
  var campaignRows = [];
  var rows = mtdReport.rows();
  while (rows.hasNext()) {
    var row = rows.next();
    var campaign = row['CampaignName'];
    var status = row['CampaignStatus'];
    var budget = parseMoney(row['Amount']) || 0;
    var spend = parseMoney(row['Cost']) || 0;
    var conv = parseFloat(row['Conversions']) || 0;
    // Skip paused campaigns with no MTD activity to keep the sheet tight
    if (String(status).toLowerCase() === 'paused' && spend === 0 && conv === 0) continue;
    totalSpend += spend;
    totalConv += conv;
    var cpl = conv > 0 ? spend / conv : 0;
    var expectedCampaignMTDSpend = budget * daysElapsed;
    var campaignBudgetPace = expectedCampaignMTDSpend > 0 ? (spend / expectedCampaignMTDSpend * 100) : 0;
    var projectedCampaignSpend = pctElapsed > 0 ? spend / pctElapsed : 0;
    var projectedCampaignConv = pctElapsed > 0 ? conv / pctElapsed : 0;
    var prior = priorMap[campaign] || { spend: 0, conversions: 0 };
    var yoy = yoyMap[campaign] || { spend: 0, conversions: 0 };
    campaignRows.push([
      campaign, status, budget.toFixed(2),
      expectedCampaignMTDSpend.toFixed(2), spend.toFixed(2), campaignBudgetPace.toFixed(0),
      conv.toFixed(1), cpl.toFixed(2),
      projectedCampaignSpend.toFixed(2), projectedCampaignConv.toFixed(1),
      prior.spend.toFixed(2), prior.conversions.toFixed(1),
      yoy.spend.toFixed(2), yoy.conversions.toFixed(1)
    ]);
  }
  // Account-level math
  var expectedMTDSpendAcct = monthlyBudget * pctElapsed;
  var spendVariance = totalSpend - expectedMTDSpendAcct;
  var spendVariancePct = expectedMTDSpendAcct > 0 ? (spendVariance / expectedMTDSpendAcct * 100) : 0;
  var projectedEOMSpend = pctElapsed > 0 ? totalSpend / pctElapsed : 0;
  var targetMonthlyConv = targetCPA > 0 ? monthlyBudget / targetCPA : 0;
  var expectedMTDConv = targetMonthlyConv * pctElapsed;
  var convVariance = totalConv - expectedMTDConv;
  var convVariancePct = expectedMTDConv > 0 ? (convVariance / expectedMTDConv * 100) : 0;
  var projectedEOMConv = pctElapsed > 0 ? totalConv / pctElapsed : 0;
  var actualCPL = totalConv > 0 ? totalSpend / totalConv : 0;
  var cplVariance = actualCPL - targetCPA;
  var cplVariancePct = targetCPA > 0 ? (cplVariance / targetCPA * 100) : 0;
  var priorCPL = priorTotalConv > 0 ? priorTotalSpend / priorTotalConv : 0;
  var yoyCPL = yoyTotalConv > 0 ? yoyTotalSpend / yoyTotalConv : 0;
  // YoY change %
  var yoySpendChangePct = yoyTotalSpend > 0 ? ((totalSpend - yoyTotalSpend) / yoyTotalSpend * 100) : 0;
  var yoyConvChangePct = yoyTotalConv > 0 ? ((totalConv - yoyTotalConv) / yoyTotalConv * 100) : 0;
  var yoyCPLChangePct = yoyCPL > 0 ? ((actualCPL - yoyCPL) / yoyCPL * 100) : 0;
  var status = computePacingStatus(spendVariancePct, convVariancePct, cplVariancePct);
  // Write account-level summary
  sheet.appendRow(['MTD Pacing — ' + getMonthName(now) + ' ' + now.getFullYear()]);
  sheet.appendRow(['']);
  sheet.appendRow(['Status', status]);
  sheet.appendRow(['Generated', new Date().toISOString()]);
  sheet.appendRow(['Through Date', formatDateReadable(yesterday)]);
  sheet.appendRow(['']);
  sheet.appendRow(['— TIME —']);
  sheet.appendRow(['Days in Month', daysInMonth]);
  sheet.appendRow(['Days Elapsed (through yesterday)', daysElapsed]);
  sheet.appendRow(['Days Remaining', daysRemaining]);
  sheet.appendRow(['% Month Elapsed', (pctElapsed * 100).toFixed(1) + '%']);
  sheet.appendRow(['']);
  sheet.appendRow(['— SPEND —']);
  sheet.appendRow(['Monthly Budget', monthlyBudget.toFixed(2)]);
  sheet.appendRow(['Expected MTD Spend', expectedMTDSpendAcct.toFixed(2)]);
  sheet.appendRow(['Actual MTD Spend', totalSpend.toFixed(2)]);
  sheet.appendRow(['Spend Variance ($)', spendVariance.toFixed(2)]);
  sheet.appendRow(['Spend Variance %', spendVariancePct.toFixed(1) + '%']);
  sheet.appendRow(['Projected EOM Spend', projectedEOMSpend.toFixed(2)]);
  sheet.appendRow(['Prior Month Same-Period Spend', priorTotalSpend.toFixed(2)]);
  sheet.appendRow(['YoY Same-Period Spend', yoyTotalSpend.toFixed(2)]);
  sheet.appendRow(['YoY Spend Change %', yoySpendChangePct.toFixed(1) + '%']);
  sheet.appendRow(['']);
  sheet.appendRow(['— CONVERSIONS —']);
  sheet.appendRow(['Target Monthly Conv (= Budget / Target CPA)', targetMonthlyConv.toFixed(1)]);
  sheet.appendRow(['Expected MTD Conv', expectedMTDConv.toFixed(1)]);
  sheet.appendRow(['Actual MTD Conv', totalConv.toFixed(1)]);
  sheet.appendRow(['Conv Variance', convVariance.toFixed(1)]);
  sheet.appendRow(['Conv Variance %', convVariancePct.toFixed(1) + '%']);
  sheet.appendRow(['Projected EOM Conv', projectedEOMConv.toFixed(1)]);
  sheet.appendRow(['Prior Month Same-Period Conv', priorTotalConv.toFixed(1)]);
  sheet.appendRow(['YoY Same-Period Conv', yoyTotalConv.toFixed(1)]);
  sheet.appendRow(['YoY Conv Change %', yoyConvChangePct.toFixed(1) + '%']);
  sheet.appendRow(['']);
  sheet.appendRow(['— CPL / CPA —']);
  sheet.appendRow(['Target CPL', targetCPA.toFixed(2)]);
  sheet.appendRow(['Actual MTD CPL', actualCPL.toFixed(2)]);
  sheet.appendRow(['CPL Variance vs Target ($)', cplVariance.toFixed(2)]);
  sheet.appendRow(['CPL Variance %', cplVariancePct.toFixed(1) + '%']);
  sheet.appendRow(['Prior Month Same-Period CPL', priorCPL.toFixed(2)]);
  sheet.appendRow(['YoY Same-Period CPL', yoyCPL.toFixed(2)]);
  sheet.appendRow(['YoY CPL Change %', yoyCPLChangePct.toFixed(1) + '%']);
  sheet.appendRow(['']);
  sheet.appendRow(['— PER-CAMPAIGN PACING —']);
  sheet.appendRow([
    'Campaign', 'Status', 'Daily Budget',
    'Expected MTD Spend', 'Actual MTD Spend', 'Budget Pace %',
    'MTD Conv', 'MTD CPL',
    'Projected EOM Spend', 'Projected EOM Conv',
    'Prior Mo Same-Period Spend', 'Prior Mo Same-Period Conv',
    'YoY Same-Period Spend', 'YoY Same-Period Conv'
  ]);
  // Sort campaigns by MTD spend descending
  campaignRows.sort(function(a, b) { return parseFloat(b[4]) - parseFloat(a[4]); });
  campaignRows.forEach(function(r) { sheet.appendRow(r); });
  // Formatting — title row, status row, section headers
  var titleRange = sheet.getRange(1, 1, 1, 2);
  titleRange.setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setColumnWidth(1, 320);
  sheet.setColumnWidth(2, 160);
  // Bold the section header rows
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    var cell = String(data[i][0] || '');
    if (cell.indexOf('—') === 0 || cell === 'Status' || cell === 'Campaign') {
      sheet.getRange(i + 1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
    }
  }
  Logger.log('MTD Pacing: ' + campaignRows.length + ' campaigns written. Status: ' + status);
}
function readSettings(ss) {
  var settings = {
    monthlyBudget: CONFIG.DEFAULT_MONTHLY_BUDGET,
    targetCPA: CONFIG.DEFAULT_TARGET_CPA,
    targetROAS: 0,
    maxAcceptableCPA: CONFIG.DEFAULT_MAX_CPA,
    priorityMode: 'Balanced',
    currencySymbol: '$'
  };
  var sheet = ss.getSheetByName('5_Settings');
  if (!sheet) return settings;
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0] || '').trim();
    var val = data[i][1];
    if (val === '' || val === null || val === undefined) continue;
    var num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
    if (key === 'Monthly Budget' && !isNaN(num) && num > 0) settings.monthlyBudget = num;
    else if (key === 'Target CPA' && !isNaN(num) && num > 0) settings.targetCPA = num;
    else if (key === 'Target ROAS' && !isNaN(num) && num > 0) settings.targetROAS = num;
    else if (key === 'Max Acceptable CPA' && !isNaN(num) && num > 0) settings.maxAcceptableCPA = num;
    else if (key === 'Priority Mode') settings.priorityMode = String(val).trim() || settings.priorityMode;
    else if (key === 'Currency Symbol') settings.currencySymbol = String(val).trim() || settings.currencySymbol;
  }
  return settings;
}
function computePacingStatus(spendPct, convPct, cplPct) {
  if (Math.abs(spendPct) <= 10 && Math.abs(convPct) <= 10 && Math.abs(cplPct) <= 15) return 'ON PACE';
  if (cplPct < -20) return 'AHEAD — CPL beating target';
  if (cplPct > 30) return 'OFF PACE — CPL too high';
  if (spendPct > 15) return 'OVER PACE — overspending';
  if (spendPct < -20) return 'UNDER PACE — underspending';
  if (convPct < -20) return 'UNDER VOLUME — short on conversions';
  return 'MIXED — see details';
}
function getMonthName(d) {
  var names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return names[d.getMonth()];
}
// ============================================================
// META SHEET
// ============================================================
function writeMetaSheet(ss, dateRange, isFirstRun) {
  var sheet = getOrCreateSheet(ss, '0_Meta');
  sheet.clearContents();
  var runType = isFirstRun ? 'BASELINE' : 'WEEKLY';
  sheet.appendRow(['God Tier Ads — Weekly Optimisation Data']);
  sheet.appendRow(['']);
  sheet.appendRow(['Account Name', CONFIG.ACCOUNT_NAME]);
  sheet.appendRow(['Account ID', AdsApp.currentAccount().getCustomerId()]);
  sheet.appendRow(['Currency', CONFIG.CURRENCY]);
  sheet.appendRow(['Run Type', runType]);
  sheet.appendRow(['Lookback Days', dateRange.lookbackDays]);
  sheet.appendRow(['Report Period', dateRange.current.label]);
  sheet.appendRow(['Prior Period', dateRange.prior.label]);
  sheet.appendRow(['Generated', new Date().toISOString()]);
  sheet.appendRow(['Script Version', '1.2-willo']);
  sheet.appendRow(['']);
  sheet.appendRow(['AI Analysis Status', 'READY_FOR_ANALYSIS']);
  Logger.log('Meta sheet written. Run type: ' + runType);
}
// ============================================================
// SETTINGS SHEET
// ============================================================
function writeSettingsSheet(ss, isFirstRun) {
  var sheet = ss.getSheetByName('5_Settings');
  if (sheet && !isFirstRun) {
    Logger.log('Settings sheet exists — leaving member settings intact.');
    return;
  }
  if (!sheet) sheet = ss.insertSheet('5_Settings');
  sheet.clearContents();
  sheet.appendRow(['God Tier Ads — Account Settings']);
  sheet.appendRow(['Edit these values to control how the AI analyses your account.']);
  sheet.appendRow(['']);
  sheet.appendRow(['Setting', 'Value', 'Notes']);
  sheet.appendRow(['Monthly Budget', '', 'e.g. 3000 — Willo total monthly Google Ads spend target']);
  sheet.appendRow(['Target CPA', '', 'e.g. 150 — ideal cost per LEAD (form fill / call)']);
  sheet.appendRow(['Target ROAS', '', 'Leave blank — Willo is lead-gen, not revenue-tracked']);
  sheet.appendRow(['Max Acceptable CPA', '', 'e.g. 250 — upper cost per lead you can tolerate for volume']);
  sheet.appendRow(['Priority Mode', 'Balanced', 'Options: Maximise Volume | Balanced | Maximise Efficiency']);
  sheet.appendRow(['Currency Symbol', '', 'e.g. $ — leave blank to auto-detect']);
  sheet.appendRow(['Account Notes', '', 'Optional: anything the AI should know about this account']);
  var headerRange = sheet.getRange(4, 1, 1, 3);
  headerRange.setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold');
  var titleRange = sheet.getRange(1, 1, 1, 3);
  titleRange.merge().setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 400);
  sheet.setFrozenRows(4);
  sheet.getRange(5, 2, 7, 1).setBackground('#fffde7');
  Logger.log('Settings sheet created with defaults.');
}
function createSettingsSheet() {
  var ss = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var existing = ss.getSheetByName('5_Settings');
  if (existing) {
    Logger.log('5_Settings sheet already exists — nothing to do.');
    return;
  }
  writeSettingsSheet(ss, true);
}
// ============================================================
// TRIGGER AI ANALYSIS
// ============================================================
function triggerAIAnalysis(ss) {
  var sheet = ss.getSheetByName('0_Meta');
  if (sheet) {
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === 'AI Analysis Status') {
        sheet.getRange(i + 1, 2).setValue('READY_FOR_ANALYSIS');
        break;
      }
    }
  }
  Logger.log('Trigger flag set. Apps Script will pick this up and run the AI analysis.');
}
// ============================================================
// UTILITIES
// ============================================================
function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}
function formatHeaderRow(sheet) {
  var headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  headerRange.setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
}
