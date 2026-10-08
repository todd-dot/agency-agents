/**
 * God Tier Search Terms Report - MCC Master Script
 * (Patched for Todd's Uptick portfolio — 2026-04-22)
 *
 * Changes from the original:
 *   1. MCC_SPREADSHEET_URL pre-set to the Uptick master sheet.
 *   2. End-of-run rename block commented out so the filename stays stable.
 *
 * This script automates the generation of a comprehensive search query analysis for all accounts in an MCC.
 * It creates a master Google Sheet that acts as both a control panel and a dashboard, allowing you to
 * manage and analyze search term performance across your entire account portfolio from a single place.
 *
 * --- HOW TO USE ---
 *
 * 1. FIRST RUN:
 *    - Leave the `MCC_SPREADSHEET_URL` setting below BLANK.
 *    - Run the script.
 *    - The script will create a new "Master Analysis Report" spreadsheet in your Google Drive.
 *    - It will automatically populate the 'Settings' tab in this sheet with ALL accounts from your MCC.
 *    - Finally, it will process all enabled accounts and generate their reports.
 *
 * 2. SUBSEQUENT RUNS:
 *    - After the first run, copy the URL of the newly created spreadsheet.
 *    - Paste this URL into the `MCC_SPREADSHEET_URL` setting in the script.
 *    - From now on, when you run the script, it will use and update this existing spreadsheet.
 *
 * --- CONTROLLING THE SCRIPT ---
 *
 * All script behavior is controlled from the 'Settings' tab in the generated Google Sheet.
 * You can configure each account individually:
 *
 * - Process? (Yes/No): Turn processing on or off for an account.
 * - Date Range (Days): Set a custom lookback period for analysis.
 * - Impression Thresholds: Define the minimum impression criteria for search terms.
 * - Skip Processed Campaigns?: Force a full re-run of a report for an account.
 * - Resume & Filter Campaigns: Process only specific campaigns or resume from a certain point.
 *
 * The 'Account Analysis' tab provides a high-level dashboard with a heatmap to quickly identify
 * problem areas and opportunities across all your accounts.
 *
 * ---
 *
 * Author: Taylor Thain (somemarketing.ca)
 * Based on: Ed Leake's God Tier Ads methodology
 * License: For internal use and Ed's GTA client distribution only. Provided without warranty.
 */

// --- NEW: Currency Utility to map codes to symbols ---
const CURRENCY_UTIL = {
    codeToSymbol: {
        'USD': '$', 'CAD': '$', 'AUD': '$',
        'EUR': 'â‚¬',
        'GBP': 'Â£',
        'JPY': 'Â¥',
        'INR': 'â‚¹'
    },
    getSymbol: function(code) {
        return this.codeToSymbol[code] || (code + ' ');
    }
};
// --- END NEW ---

// MCC-WIDE SETTINGS
const MCC_CONFIG = {

    // --- MCC Master Sheet Assignment---
     // PATCHED 2026-04-22: Pre-set to Todd's Uptick master sheet so the script
     // reads/writes the existing shared workbook instead of creating a new one
     // in the script-runner's Drive. Sheet must be shared (Editor) with the
     // Google account that authorizes this MCC script.
     MCC_SPREADSHEET_URL: "https://docs.google.com/spreadsheets/d/1yoIA4ODQVGErinLhL7rFa96IlPfT7MRCjFWNEjTa95M/edit",
     MCC_SKIP_PROCESSED_ACCOUNTS: false, // If true, skip accounts already listed in the MCC_SPREADSHEET_URL sheet
     // ------------------------------------

    MAX_ACCOUNTS_PER_RUN: 30,

    START_FROM_CID: "",
    INCLUDE_CID_LIST: [],

    DATE_RANGE_DAYS: 90,

    DATE_FORMAT: "yyyy-MM-dd",
    TIME_FORMAT: "HH-mm",

    // ***
    // Use UTC timezone - works 100% MCC level
    // ***
    get RUN_DATE() {
      return Utilities.formatDate(new Date(), 'UTC', this.DATE_FORMAT);
    },

    get RUN_TIMESTAMP() {
      return Utilities.formatDate(new Date(), 'UTC', `${this.DATE_FORMAT}_${this.TIME_FORMAT}`);
    },


    // --- Account Report Default Settings ---
    ACCOUNT_REPORT_DEFAULTS: {

        // Resume settings for large accounts (within a single account run)
        RESUME_EXECUTION: false,
        STARTING_CAMPAIGN_NAME: "",
        PROCESS_ONLY_CAMPAIGNS: [],
        SKIP_PROCESSED_CAMPAIGNS: true,

        // Include/exclude settings
        INCLUDE_PAUSED_AD_GROUPS: false,
        INCLUDE_EXCLUDED_KEYWORDS: false,
        INCLUDE_ADDED_KEYWORDS: false,

        // Filter thresholds - THERE MUST BE A VALUE IN ONE OF THE IMPRESSION THRESHOLDS FOR THE SCRIPT TO RUN.
        FILTERS: {
            IMPRESSIONS: {
                MINIMUM: 30, // Minimum total impressions for the date range
                MONTHLY_MINIMUM: 0, // Minimum monthly impressions (set to 0 to disable)
                DAILY_MINIMUM: 0 // Minimum daily impressions (set to 0 to disable)
            },
            //DO NOT MODIFY ANYTHING BELOW THIS LINE.***************************************
            CONVERSIONS: {
                NONE: 0.01, // For Lost Spend
                LOW: 0.50,  // For Hidden Waste, Ad Rank Killers, Really High CPC
                GOOD: 1.00, // For Favorable Message-match, High CTR - No Conversion
                HIGH: 2.00  // For High Value
            },
            CTR: {
                LOW_THRESHOLD: 0.50, // 50% of ad group average for Stick or Twist
                HIGH_THRESHOLD: 1.50 // 150% of ad group average for Favorable Message-match
            },
            CPC: {
                MULTIPLIER: 2.0 // For Really High CPC (2x ad group average)
            },
            CPA: {
                HIGH_THRESHOLD: 100.0 // High CPA threshold for efficiency analysis
            },
            COST: {
                HIGH: 100 // High cost threshold in currency units
            },
            EFFICIENCY: {
                VOLUME_THRESHOLD: 1.5 // 150% threshold for efficiency vs volume
            },
            CONVERSION_RATE: {
                LOW_THRESHOLD: 0.50 // 50% of ad group average for Stick or Twist
            }
        },

        // CPA/ROAS targets - These are Fallback Values. Leave as Null. The Script will try to use your Ad Group Averages for the filter when able.
        TARGET_CPA: null, // Set to null to use campaign average
        TARGET_ROAS: null, // Set to null to use campaign average

        // Debug flag
        DEBUG: false, // Set to true for detailed logging within account reports

        // DANGER --- DO NOT TOUCH---
        SPREADSHEET_URL: null // DANGER: Setting this during MCC runs WILL cause all accounts to write to the SAME sheet. Leave as null unless processing a single account or debugging. Ignored if MCC_SPREADSHEET_URL is set.
    }
    // ------------------------------------
  };



  // Main MCC controller function
  function main() {
    // First, make sure we're in MCC mode
    if (!MccApp) {
      throw new Error("This script must be run from an MCC account");
    }

    // Get MCC account name for master sheet
    let mccAccountName = "God Tier Analysis Dashboard"; // Default fallback name

    // Create or load master spreadsheet and its required sheets ('Settings', 'Account Analysis')
    const {
        spreadsheet: masterSpreadsheet,
        settingsSheet,
        analysisSheet,
        settingsHeaderMap,
        analysisHeaderMap
    } = setupOrLoadMaster(mccAccountName);

    // --- Phase 1: Sync Account List with the 'Settings' sheet ---
    Logger.log("Phase 1: Syncing account list with Settings sheet...");
    syncAccountsWithSettingsSheet(settingsSheet, settingsHeaderMap);
    Logger.log("Sync complete.");

    // --- Phase 2: Process Enabled Accounts from the 'Settings' Sheet ---
    Logger.log("Phase 2: Processing enabled accounts from Settings sheet...");

    const settingsDataRange = settingsSheet.getDataRange();
    const settingsData = settingsDataRange.getValues();
    const settingsHeader = settingsData.shift(); // Remove header row

    // Loop through each row in the Settings sheet to check for instructions
    settingsData.forEach((row, index) => {
        const shouldProcess = row[settingsHeaderMap.get('Process? (Yes/No)') - 1];

        // Skip any row that isn't explicitly marked 'Yes'
        if (String(shouldProcess).toLowerCase() !== 'yes') {
            return;
        }

        // Get account info and custom settings from the row
        const accountName = row[settingsHeaderMap.get('Account Name') - 1];
        const cid = row[settingsHeaderMap.get('CID') - 1];
        const customCurrencyCode = row[settingsHeaderMap.get('Currency Code') - 1] || null;
        const customDateRange = row[settingsHeaderMap.get('Date Range (Days)') - 1] || null;
        const impressionType = row[settingsHeaderMap.get('Impression Threshold Type') - 1] || null;
        const impressionValue = row[settingsHeaderMap.get('Impression Threshold Value') - 1] || null;
        const customImpressionSettings = {
            type: impressionType,
            value: impressionValue
        };
        const skipProcessedCampaigns = (row[settingsHeaderMap.get('Skip Processed Campaigns? (Yes/No)') - 1] || 'Yes').toLowerCase() === 'yes';
        const startingCampaignName = row[settingsHeaderMap.get('Starting Campaign Name') - 1] || null;
        const processOnlyCampaignsCSV = row[settingsHeaderMap.get('Process Only Campaigns (CSV)') - 1] || null;
        const processOnlyCampaigns = processOnlyCampaignsCSV ? processOnlyCampaignsCSV.split(',').map(name => name.trim()) : [];

        Logger.log(`Processing account: ${accountName} (${cid}) with Date Range: ${customDateRange || 'Default'}, Impression Settings: ${JSON.stringify(customImpressionSettings)}, Skip Processed: ${skipProcessedCampaigns}.`);

        let existingUrl = null;
        try {
            // Find this account in the analysis sheet to get its existing report URL
            const analysisData = analysisSheet.getDataRange().getValues();
            const analysisCidCol = analysisHeaderMap.get('CID') - 1;
            const analysisLinkCol = analysisHeaderMap.get('Report Link') - 1;

            for (let i = 1; i < analysisData.length; i++) { // Start at 1 to skip header
                if (normalizeCid(analysisData[i][analysisCidCol]) === normalizeCid(cid)) {
                    const formula = analysisSheet.getRange(i + 1, analysisLinkCol + 1).getFormula();
                     if (formula && formula.toUpperCase().startsWith('=HYPERLINK(')) {
                        const urlMatch = formula.match(/=HYPERLINK\("([^\"]+)"/i);
                        if (urlMatch && urlMatch[1]) {
                            existingUrl = urlMatch[1];
                            Logger.log(`Found existing report URL for ${accountName}: ${existingUrl}`);
                        }
                    }
                    break;
                }
            }
        } catch(e) {
            Logger.log(`Could not find or parse existing report for ${accountName}. This is normal for new accounts.`)
        }

        try {
            // Select the account in the MCC to run the report against it
            const accountIter = MccApp.accounts().withIds([cid]).get();
            if (!accountIter.hasNext()) {
                throw new Error(`Account with CID ${cid} not found in MCC or is not accessible.`);
            }
            const account = accountIter.next();
            MccApp.select(account);

            // --- NEW: Auto-populate currency code on first run ---
            const currencyCodeCell = settingsSheet.getRange(index + 2, settingsHeaderMap.get('Currency Code'));
            if (currencyCodeCell.isBlank()) {
                const detectedCurrencyCode = AdsApp.currentAccount().getCurrencyCode();
                currencyCodeCell.setValue(detectedCurrencyCode);
                 Logger.log(`Auto-populated currency code '${detectedCurrencyCode}' for ${accountName}.`);
            }
            // --- END NEW ---

            // Run the main report function, passing the custom settings from the sheet
            const result = runAccountReport(existingUrl, customDateRange, customImpressionSettings, skipProcessedCampaigns, startingCampaignName, processOnlyCampaigns, customCurrencyCode);

            // --- Update the 'Account Analysis' sheet with the new results ---
            const outputRowData = [
                accountName,   // Account Name
                cid,           // CID
                `=HYPERLINK("${result.reportUrl}", "View Report")`,  // Report Link
                result.categoryCounts.CONVERTING_WELL || 0,
                result.categoryCounts.HIDDEN_WASTE || 0,
                result.categoryCounts.LOST_SPEND || 0,
                result.categoryCounts.EFFICIENCY || 0,
                result.categoryCounts.CONVERSION_VOLUME || 0,
                result.categoryCounts.STICK_OR_TWIST || 0,
                result.categoryCounts.FAVORABLE_MESSAGE_MATCH || 0,
                result.categoryCounts.AD_RANK_KILLERS || 0,
                result.categoryCounts.HIGH_CTR_NO_CONVERSION || 0,
                result.categoryCounts.REALLY_HIGH_CPC || 0,
                result.dateRange // Date range of report string
            ];

            // Find the row for the current account to update it, or append if it's new
            const analysisRowToUpdate = findRowByCid(analysisSheet, cid, analysisHeaderMap.get('CID'));
            if (analysisRowToUpdate) {
                Logger.log(`Updating existing row for ${accountName} in Account Analysis sheet.`);
                analysisSheet.getRange(analysisRowToUpdate, 1, 1, outputRowData.length).setValues([outputRowData]);
            } else {
                Logger.log(`Appending new row for ${accountName} to Account Analysis sheet.`);
                analysisSheet.appendRow(outputRowData);
            }

        } catch (e) {
            Logger.log(`âš ï¸ Error processing account ${accountName} (${cid}): ${e.message} ${e.stack}`);
            const analysisRowToUpdate = findRowByCid(analysisSheet, cid, analysisHeaderMap.get('CID'));
            const errorData = [accountName, cid, `Error: ${e.message}`];
            if (analysisRowToUpdate) {
                 analysisSheet.getRange(analysisRowToUpdate, 1, 1, errorData.length).setValues([errorData]);
            } else {
                analysisSheet.appendRow(errorData);
            }
        }
    });

    // Auto-resize columns for better readability after all data is added
    analysisSheet.autoResizeColumns(1, analysisHeaderMap.size);
    settingsSheet.autoResizeColumns(1, settingsHeaderMap.size);

    // --- NEW: Cleanup empty rows from Settings sheet ---
    cleanupSettingsSheet(settingsSheet);
    // --- END NEW ---

    // --- Rename Master Spreadsheet with Completion Timestamp ---
    // PATCHED 2026-04-22: Rename disabled to keep the filename stable across runs.
    // Uncomment the block below if you want the timestamped rename behavior back.
    /*
    try {
      const newSsName = `${mccAccountName} - Master Analysis Report - ${MCC_CONFIG.RUN_TIMESTAMP}`;
      masterSpreadsheet.rename(newSsName);
      Logger.log(`Renamed master spreadsheet to: "${newSsName}"`);
    } catch (e) {
      Logger.log(`âš ï¸ Error renaming master spreadsheet: ${e.message}`);
    }
    */

    Logger.log("Completed processing all enabled accounts.");
  }
    // The main account-level report function
    function runAccountReport(existingUrl = null, customDateRangeDays = null, customImpressionSettings = null, skipProcessedCampaigns = true, startingCampaignName = null, processOnlyCampaigns = [], customCurrencyCode = null) {

        let currencySymbol = '$'; // Default symbol, will be updated per account
        let currencyFormatString = '"$"#,##0.00'; // Default format string for sheets

        // CONFIG OBJECT REMOVED FROM HERE
        // Moved to MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS

        // Debug flag to control verbose logging - MOVED TO MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG
        // const DEBUG = false; // Set to true for detailed logging

        // Global variables for campaign averages - DO NOT TOUCH.
        const CAMPAIGN_AVERAGES = {
          avgCTR: 0.025, // 2.5%
          avgCPC: 1.50,  // $1.50
          avgCPA: 25.00, // $25.00
          avgROAS: 1.75  // 175%
        };

        /**
         * Utility function to execute a function with exponential backoff retry
         * @param {Function} fn The function to execute
         * @param {number} maxRetries Maximum number of retries
         * @param {number} initialBackoff Initial backoff in milliseconds
         * @return {any} The result of the function
         */
        function executeWithRetry(fn, maxRetries = 5, initialBackoff = 500) {
          let retries = 0;
          let backoff = initialBackoff;

          while (retries <= maxRetries) {
            try {
              return fn();
            } catch (error) {
              retries++;

              // Check if we've exceeded retry limit
              if (retries > maxRetries) {
                Logger.log(`Max retries (${maxRetries}) exceeded. Last error: ${error.message}`);
                throw error;
              }

              // If it's a quota error, use longer backoff
              const isQuotaError = error.message &&
                (error.message.includes("quota") ||
                 error.message.includes("Quota") ||
                 error.message.includes("rate limit") ||
                 error.message.includes("too many requests"));

              if (isQuotaError) {
                Logger.log(`Quota error detected: ${error.message}. Retry ${retries}/${maxRetries}`);
                backoff *= 2; // Double the backoff for quota errors
              } else {
                Logger.log(`Error: ${error.message}. Retry ${retries}/${maxRetries}`);
              }

              // Calculate backoff with jitter to avoid thundering herd
              const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15 random multiplier
              const actualBackoff = Math.floor(backoff * jitter);

              Logger.log(`Waiting ${actualBackoff}ms before retry...`);
              Utilities.sleep(actualBackoff);

              // Increase backoff for next retry
              backoff = Math.min(backoff * 1.5, 30000); // Cap at 30 seconds
            }
          }
        }

        /**
         * Main function that runs when the script is executed
         */
        function executeAccountReport() {
          // --- NEW: Get account-specific currency with override ---
          try {
            let currencyCode;
            if (customCurrencyCode) {
              currencyCode = customCurrencyCode;
              Logger.log(`Using override currency code from Settings sheet: ${currencyCode}`);
            } else {
              currencyCode = AdsApp.currentAccount().getCurrencyCode();
            }

            currencySymbol = CURRENCY_UTIL.getSymbol(currencyCode);
            // Google Sheets needs the symbol wrapped in quotes inside the format string
            currencyFormatString = '"' + currencySymbol + '"#,##0.00';
            Logger.log(`Processing account with currency: ${currencyCode} (${currencySymbol})`);
          } catch(e) {
            Logger.log(`Could not determine currency, defaulting to '$'. Error: ${e.message}`);
            currencySymbol = '$';
            currencyFormatString = '"$"#,##0.00';
          }
          // --- END NEW ---

          // The number of days for the report, taken from the master sheet or fallback to config.
          const dateRangeToUse = customDateRangeDays || MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DATE_RANGE_DAYS || MCC_CONFIG.DATE_RANGE_DAYS;
          // This is now an object, the logic is handled inside getSearchTermData
          // const impressionThresholdToUse = customImpressionThreshold || MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.IMPRESSIONS.MINIMUM;

          // Make entry log conditional
          if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
            Logger.log('Google Ads Search Term Report Script (GOD TIER SEARCH TERMS REPORT)');
          }

          try {
            // Create or open the spreadsheet
            const spreadsheet = getOrCreateSpreadsheet(existingUrl);

            // Get all campaigns
            let campaigns = getCampaigns(); // Use let to allow reassignment after filtering
            Logger.log(`Found ${campaigns.length} campaigns to analyze.`);

            // Apply filtering logic if resuming execution
            let campaignsToProcess = filterCampaignsToProcess(campaigns, spreadsheet, startingCampaignName, processOnlyCampaigns);
            Logger.log(`Will process ${campaignsToProcess.length} campaigns out of ${campaigns.length} total.`);

            // Store per-campaign counts here
            const campaignCategoryCountsData = {};

            // Variables to track total metrics
            let totalProcessed = 0;
            let totalSpend = 0;
            let totalConversions = 0;
            let hiddenWasteSpend = 0;
            let converterCount = 0;

            // Initialize account-wide category counts
            const accountCategoryCounts = {
                CONVERTING_WELL: 0, HIDDEN_WASTE: 0, LOST_SPEND: 0, EFFICIENCY: 0,
                CONVERSION_VOLUME: 0, STICK_OR_TWIST: 0, FAVORABLE_MESSAGE_MATCH: 0,
                AD_RANK_KILLERS: 0, HIGH_CTR_NO_CONVERSION: 0, REALLY_HIGH_CPC: 0
            };

            // Process each campaign
            campaignsToProcess.forEach(function(campaign) {
              try {
                const campaignName = campaign.getName();
                Logger.log(`Processing campaign: ${campaignName}`);

                // Check if we should skip this campaign because it already has a sheet
                if (skipProcessedCampaigns && sheetExists(spreadsheet, campaignName)) {
                  Logger.log(`Skipping campaign ${campaignName} as it already has a sheet in the spreadsheet.`);
                  return; // Skip to the next campaign
                }

                // Create a sheet for this campaign
                let sheet;
                try {
                  sheet = spreadsheet.insertSheet(sanitizeSheetName(campaignName));
                } catch (sheetError) {
                  // If the sheet exists, get it and clear it
                  Logger.log(`Sheet for campaign ${campaignName} already exists. Getting and clearing it.`);
                  sheet = spreadsheet.getSheetByName(sanitizeSheetName(campaignName));
                  sheet.clear();
                }

                // Process the campaign, now passing the impression threshold
                const campaignResult = processCampaign(sheet, campaign, customImpressionSettings);
                totalProcessed++;

                // Add up totals from this campaign's data
                try {
                  // Get stats from the campaign
                  const stats = campaign.getStatsFor("LAST_30_DAYS");
                  totalSpend += stats.getCost();
                  totalConversions += stats.getConversions();

                  // Get metrics from processed categories
                  if (campaign._hiddenWasteSpend) {
                    hiddenWasteSpend += campaign._hiddenWasteSpend || 0;
                    converterCount += campaign._converterCount || 0;
                  }
                } catch (e) {
                  Logger.log(`Error collecting campaign metrics: ${e.message}`);
                }

                // Aggregate category counts from the campaign
                if (campaignResult && campaignResult.categoryCounts) {
                    for (const category in accountCategoryCounts) {
                        if (campaignResult.categoryCounts.hasOwnProperty(category)) {
                            accountCategoryCounts[category] += campaignResult.categoryCounts[category];
                        }
                    }
                }

                // Store the campaign counts
                if (campaignResult && campaignResult.categoryCounts) {
                    campaignCategoryCountsData[campaign.getName()] = campaignResult.categoryCounts;
                }
              } catch (campaignError) {
                Logger.log('Error processing campaign ' + campaign.getName() + ': ' + campaignError.message);
              }
            });

            // Create or update summary sheet AFTER processing campaigns
            // Only update the summary sheet if we're not resuming execution,
            // or if we're processing the full set of campaigns
            const isResumeMode = startingCampaignName || (processOnlyCampaigns && processOnlyCampaigns.length > 0);
            if (!isResumeMode || campaigns.length === campaignsToProcess.length) {
              // Pass both the list of campaigns *actually processed* and the now populated counts data
              createSummarySheet(spreadsheet, campaignsToProcess, campaignCategoryCountsData, dateRangeToUse, skipProcessedCampaigns, startingCampaignName, processOnlyCampaigns);
            } else {
              Logger.log("Skipping Summary sheet update in resume mode (to avoid overwriting with partial data).");
            }

            Logger.log(`Processed ${totalProcessed} campaigns out of ${campaigns.length} total.`);

            // Calculate date range string once for the whole report
            const endDate = new Date();
            endDate.setDate(endDate.getDate() - 1); // Yesterday
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - dateRangeToUse);
            const formattedStartDate = Utilities.formatDate(startDate, AdsApp.currentAccount().getTimeZone(), 'MMM d, yyyy');
            const formattedEndDate = Utilities.formatDate(endDate, AdsApp.currentAccount().getTimeZone(), 'MMM d, yyyy');
            const dateRangeString = `${dateRangeToUse} days (${formattedStartDate} to ${formattedEndDate})`;

            // Return the results object including counts and date range
            return {
              reportUrl: spreadsheet.getUrl(),
              spend: totalSpend,
              conversions: totalConversions,
              hiddenWaste: hiddenWasteSpend,
              convertingWell: converterCount,
              categoryCounts: accountCategoryCounts,
              dateRange: dateRangeString
            };

          } catch (error) {
            Logger.log(`Error executing script: ${error.message}`);
            throw error;
          }
        }

        /**
         * Filters campaigns based on resume execution settings
         * @param {Array} campaigns All campaigns
         * @param {Spreadsheet} spreadsheet The spreadsheet
         * @return {Array} Filtered campaigns to process
         */
        function filterCampaignsToProcess(campaigns, spreadsheet, startingCampaignName, processOnlyCampaigns) {
          // If no resume settings are provided, return all campaigns
          if (!startingCampaignName && (!processOnlyCampaigns || processOnlyCampaigns.length === 0)) {
            return campaigns;
          }

          // If specific campaigns are specified, use only those (this takes precedence)
          if (processOnlyCampaigns && processOnlyCampaigns.length > 0) {
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                Logger.log(`Processing only specific campaigns from Settings sheet: ${processOnlyCampaigns.join(', ')}`);
            }
            return campaigns.filter(campaign => processOnlyCampaigns.includes(campaign.getName()));
          }

          // If resuming from a specific campaign
          if (startingCampaignName) {
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                Logger.log(`Resuming execution from campaign from Settings sheet: ${startingCampaignName}`);
            }

            // Find the index of the starting campaign
            let startIndex = -1;
            for (let i = 0; i < campaigns.length; i++) {
              if (campaigns[i].getName() === startingCampaignName) {
                startIndex = i;
                break;
              }
            }

            // If starting campaign not found, log a warning and return all campaigns
            if (startIndex === -1) {
              Logger.log(`WARNING: Starting campaign "${startingCampaignName}" not found. Processing all campaigns.`);
              return campaigns;
            }

            // Return campaigns from the starting point
            return campaigns.slice(startIndex);
          }

          // Default: return all campaigns
          return campaigns;
        }

        /**
         * Checks if a sheet with the given name exists in the spreadsheet
         * @param {Spreadsheet} spreadsheet The spreadsheet to check
         * @param {string} campaignName The campaign name
         * @return {boolean} True if the sheet exists
         */
        function sheetExists(spreadsheet, campaignName) {
          const sanitizedName = sanitizeSheetName(campaignName);
          const sheet = spreadsheet.getSheetByName(sanitizedName);
          return sheet !== null;
        }

        /**
         * Creates or opens the Google Sheets spreadsheet
         * @return {Spreadsheet} The spreadsheet object
         */
        function getOrCreateSpreadsheet(existingUrl) {
          let spreadsheet;

          // --- Overwrite Logic ---
          if (existingUrl) {
            try {
                // Make opening log conditional
                if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                    Logger.log(`Opening existing report URL for overwrite: ${existingUrl}`);
                }
                spreadsheet = SpreadsheetApp.openByUrl(existingUrl);
                // Make opened log conditional
                if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                    Logger.log(`Opened existing spreadsheet: ${spreadsheet.getName()}`);
                }

                // Clear existing sheets except the first one (Summary)
                const sheets = spreadsheet.getSheets();
                let summarySheet = null;
                for (let i = sheets.length - 1; i >= 0; i--) {
                  if (sheets[i].getName() === 'Summary') {
                    summarySheet = sheets[i];
                  } else {
                    spreadsheet.deleteSheet(sheets[i]);
                  }
                }

                // Ensure Summary sheet exists and clear it
                if (summarySheet) {
                  summarySheet.clear();
                  // Make cleared log conditional
                  if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                      Logger.log('Cleared existing Summary sheet.');
                  }
                } else {
                  // If no Summary sheet existed somehow, create it
                  summarySheet = spreadsheet.insertSheet('Summary', 0);
                  // Make created log conditional
                  if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                     Logger.log('Created new Summary sheet as it was missing.');
                  }
                }

                // If not resuming campaign execution within the sheet, ensure Summary is the only sheet
                if (!MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.RESUME_EXECUTION) {
                   // This block is redundant now due to the loop above deleting non-summary sheets
                   // Logger.log('Ensuring only Summary sheet remains for overwrite.');
                } else {
                   Logger.log('Resuming execution within the overwritten sheet. Existing Summary sheet cleared.');
                }

            } catch (e) {
                Logger.log(`âš ï¸ Error opening or clearing existing report URL ${existingUrl}: ${e.message}. Falling back to creating a new report.`);
                // Fall through to creation logic if opening/clearing fails
                existingUrl = null; // Prevent trying to use the bad URL again
            }
          }
          // --- End Overwrite Logic ---

          // If not overwriting (existingUrl was null or opening failed), create new
          if (!spreadsheet) {
              if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.SPREADSHEET_URL) { // Check account-level default URL (less common in MCC flow)
                // Open existing spreadsheet based on account-level config
                spreadsheet = SpreadsheetApp.openByUrl(MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.SPREADSHEET_URL);
                // Make opened log conditional
                if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                    Logger.log(`Opened existing spreadsheet from ACCOUNT_REPORT_DEFAULTS.SPREADSHEET_URL: ${spreadsheet.getName()}`);
                }

                if (!MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.RESUME_EXECUTION) {
                  // If not resuming, clear existing sheets except the first one
                  const sheets = spreadsheet.getSheets();
                  for (let i = sheets.length - 1; i > 0; i--) {
                    spreadsheet.deleteSheet(sheets[i]);
                  }

                  // Rename and clear the first sheet
                  const summarySheet = sheets[0];
                  summarySheet.setName('Summary');
                  summarySheet.clear();
                  // Make cleared log conditional
                  if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                      Logger.log('Cleared existing Summary sheet.');
                  }
                } else {
                  // If resuming, make sure there's a Summary sheet
                  let summarySheet = spreadsheet.getSheetByName('Summary');
                  if (!summarySheet) {
                    // If there's no Summary sheet, rename the first sheet or create one
                    if (spreadsheet.getSheets().length > 0) {
                      summarySheet = spreadsheet.getSheets()[0];
                      summarySheet.setName('Summary');
                    } else {
                      summarySheet = spreadsheet.insertSheet('Summary');
                    }
                  }
                  // Make resuming log conditional
                  if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                    Logger.log('Using existing spreadsheet for resumed execution.');
                  }
                }
              } else {
                // Get account name
                const accountName = AdsApp.currentAccount().getName();

                // Create new spreadsheet with account name and datestamp
                const now = new Date();
                // Use a default timezone (UTC) instead of Session.getScriptTimeZone()
                const timestamp = Utilities.formatDate(now, 'UTC', 'yyyy-MM-dd_HH-mm');
                const spreadsheetName = `${accountName} - Search Query Report - ${timestamp}`;

                spreadsheet = SpreadsheetApp.create(spreadsheetName);
                // Make created log conditional
                if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                    Logger.log(`Created new spreadsheet: ${spreadsheet.getName()}`);
                }

                // Log the URL so users can copy it for resume if needed
                Logger.log(`Spreadsheet URL for resuming: ${spreadsheet.getUrl()}`);

                // Rename the default sheet
                spreadsheet.getSheets()[0].setName('Summary');
              }
          }

          return spreadsheet;
        }

        /**
         * Gets all enabled campaigns in the account
         * @return {Array} Array of campaign objects
         */
        function getCampaigns() {
          const campaignIterator = AdsApp.campaigns()
            .withCondition('Status = ENABLED')
            .withCondition('CampaignType IN ["SEARCH"]')
            .orderBy('Cost DESC')
            .get();

          const campaigns = [];
          while (campaignIterator.hasNext()) {
            campaigns.push(campaignIterator.next());
          }

          return campaigns;
        }

        /**
         * Creates the summary sheet with campaign overview
         * @param {Spreadsheet} spreadsheet The spreadsheet object
         * @param {Array} campaigns Array of campaign objects
         */
        function createSummarySheet(spreadsheet, campaigns, campaignCategoryCountsData, dateRangeToUse, skipProcessedCampaigns, startingCampaignName, processOnlyCampaigns) {
          const summarySheet = spreadsheet.getSheetByName('Summary');

          // Set up header row with the correct title
          summarySheet.getRange('A1:M1').setValues([
            ['Campaign Name', 'Status', 'Budget', 'Impressions', 'Clicks', 'CTR', 'CPC', 'Cost', 'Conv. Rate', 'Conversions', 'Conv. Value', 'CPA', 'ROAS']
          ]);

          // Format header row with Google blue background and white text
          summarySheet.getRange('A1:M1').setFontWeight('bold')
            .setBackground('#4284f3')
            .setFontColor('white');

          // Calculate date range (excluding today)
          const endDate = new Date();
          endDate.setDate(endDate.getDate() - 1); // Yesterday
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - dateRangeToUse);

          // Format dates for Google Ads API
          const startDateStr = Utilities.formatDate(startDate, AdsApp.currentAccount().getTimeZone(), 'yyyyMMdd');
          const endDateStr = Utilities.formatDate(endDate, AdsApp.currentAccount().getTimeZone(), 'yyyyMMdd');

          // Format the date strings for display
          const formattedStartDate = Utilities.formatDate(startDate, AdsApp.currentAccount().getTimeZone(), 'MMM d, yyyy');
          const formattedEndDate = Utilities.formatDate(endDate, AdsApp.currentAccount().getTimeZone(), 'MMM d, yyyy');

          // Determine the actual date range to display
          let actualDateRangeUsed = `${dateRangeToUse} days (${formattedStartDate} to ${formattedEndDate})`;
          let fallbackDateRange = null;

          // Add campaign data
          let rowIndex = 2;
          campaigns.forEach(function(campaign) {
            try {
              // Get stats for the custom date range
              let stats;
              let fallbackDateRange = null;
              let actualDateRangeUsed = null;

              try {
                // Use two separate parameters for dateFrom and dateTo
                stats = campaign.getStatsFor(startDateStr, endDateStr);
              } catch (e) {
                Logger.log(`Error with custom date range for ${campaign.getName()}, falling back to predefined range: ${e.message}`);

                // Set fallback date range if not already set
                if (!fallbackDateRange) {
                  if (dateRangeToUse <= 7) {
                    fallbackDateRange = 'LAST_7_DAYS';
                  } else if (dateRangeToUse <= 14) {
                    fallbackDateRange = 'LAST_14_DAYS';
                  } else if (dateRangeToUse <= 30) {
                    fallbackDateRange = 'LAST_30_DAYS';
                  } else {
                    fallbackDateRange = 'LAST_30_DAYS';
                  }

                  actualDateRangeUsed = fallbackDateRange.replace('LAST_', '').replace('_', ' ').toLowerCase();
                }

                stats = campaign.getStatsFor(fallbackDateRange);
              }

              // Get all metrics
              const impressions = stats.getImpressions();
              const clicks = stats.getClicks();
              const cost = stats.getCost();
              const conversions = stats.getConversions();
              const cpc = clicks > 0 ? cost / clicks : 0;

              // Get conversion value and calculate ROAS
              let conversionValue = 0;
              try {
                if (typeof stats.getConversionValue === 'function') {
                  conversionValue = stats.getConversionValue();
                } else if (typeof stats.getConversionsValue === 'function') {
                  conversionValue = stats.getConversionsValue();
                } else {
                  // Try to get it from the report
                  const reportQuery = fallbackDateRange ?
                    `SELECT campaign.id, metrics.conversions_value
                    FROM campaign
                    WHERE campaign.id = ${campaign.getId()}
                    AND segments.date DURING ${fallbackDateRange}` :
                    `SELECT campaign.id, metrics.conversions_value
                    FROM campaign
                    WHERE campaign.id = ${campaign.getId()}
                    AND segments.date >= '${startDateStr}'
                    AND segments.date <= '${endDateStr}'`;

                  const report = AdsApp.report(reportQuery);
                  const rows = report.rows();
                  if (rows.hasNext()) {
                    const row = rows.next();
                    conversionValue = parseFloat(row['metrics.conversions_value']) || 0;
                  }
                }
              } catch (e) {
                Logger.log("Error getting conversion value: " + e.message);
                conversionValue = 0;
              }

              // Calculate derived metrics
              const ctr = impressions > 0 ? clicks / impressions : 0;
              const convRate = clicks > 0 ? conversions / clicks : 0;
              const cpa = conversions > 0 ? cost / conversions : 0;
              const roas = cost > 0 ? conversionValue / cost : 0;

              // Set values in the summary sheet
              summarySheet.getRange(rowIndex, 1, 1, 13).setValues([[
                campaign.getName(),
                campaign.isEnabled() ? 'ENABLED' : 'PAUSED',
                campaign.getBudget().getAmount(),
                impressions,
                clicks,
                ctr,
                cpc,
                cost,
                convRate,
                conversions,
                conversionValue,
                cpa,
                roas
              ]]);

              // Format specific columns
              summarySheet.getRange(rowIndex, 3).setNumberFormat(currencyFormatString);  // Budget
              summarySheet.getRange(rowIndex, 6).setNumberFormat('0.00%');      // CTR
              summarySheet.getRange(rowIndex, 7).setNumberFormat(currencyFormatString);  // CPC
              summarySheet.getRange(rowIndex, 8).setNumberFormat(currencyFormatString);  // Cost
              summarySheet.getRange(rowIndex, 9).setNumberFormat('0.00%');      // Conv. Rate
              summarySheet.getRange(rowIndex, 10).setNumberFormat('#,##0.00'); // Conversions - Add formatting
              summarySheet.getRange(rowIndex, 11).setNumberFormat(currencyFormatString); // Conversion Value
              summarySheet.getRange(rowIndex, 12).setNumberFormat(currencyFormatString); // CPA
              summarySheet.getRange(rowIndex, 13).setNumberFormat('0.00%');     // ROAS

              rowIndex++;

            } catch (error) {
              Logger.log('Error processing campaign ' + campaign.getName() + ': ' + error.message);
            }
          });

          // Auto-resize columns
          summarySheet.autoResizeColumns(1, MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.RESUME_EXECUTION ? 14 : 13);

          // Add link to documentation and date range note
          summarySheet.getRange('A' + (rowIndex + 2)).setValue('Report generated using the Search Term Report Rules from God Tier Ads');
          summarySheet.getRange('A' + (rowIndex + 3)).setValue(`Date range: ${actualDateRangeUsed}`);

          // --- Add Per-Campaign Category Counts Table ---
          let categoryTableStartRow = rowIndex + 5; // Start a few rows below notes

          // Add table title
          summarySheet.getRange(categoryTableStartRow, 1, 1, 11).merge(); // Merge A to K for the title
          summarySheet.getRange(categoryTableStartRow, 1)
              .setValue('Category Counts per Campaign')
              .setFontWeight('bold')
              .setFontSize(12)
              .setHorizontalAlignment('center')
              .setBackground('#f3f3f3');
          categoryTableStartRow++;

          // Define category table headers (11 columns: Name + 10 categories)
          const categoryHeaders = ["Campaign Name", "Converting Well", "Hidden Waste", "Lost Spend", "Efficiency", "Volume", "Stick or Twist", "Favorable Message Match", "Ad Rank Killers", "High CTR No Conversion", "Really High CPC"];
          summarySheet.getRange(categoryTableStartRow, 1, 1, categoryHeaders.length).setValues([categoryHeaders]);
          summarySheet.getRange(categoryTableStartRow, 1, 1, categoryHeaders.length)
              .setFontWeight('bold')
              .setBackground('#e8f0fe'); // Light blue background for header
          categoryTableStartRow++;

          // Populate the table with data
          campaigns.forEach(function(campaign) {
              const campaignName = campaign.getName();
              if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { Logger.log(`DEBUG: Summary Sheet Table - Looking up counts for campaign: ${campaignName}`); }
              const counts = campaignCategoryCountsData[campaignName] || {}; // Get counts, default to empty object
              if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { Logger.log(`DEBUG: Summary Sheet Table - Found counts: ${JSON.stringify(counts)}`); }

              const rowData = [
                  campaignName,
                  counts.CONVERTING_WELL || 0,
                  counts.HIDDEN_WASTE || 0,
                  counts.LOST_SPEND || 0,
                  counts.EFFICIENCY || 0,
                  counts.CONVERSION_VOLUME || 0,
                  counts.STICK_OR_TWIST || 0,
                  counts.FAVORABLE_MESSAGE_MATCH || 0,
                  counts.AD_RANK_KILLERS || 0,
                  counts.HIGH_CTR_NO_CONVERSION || 0,
                  counts.REALLY_HIGH_CPC || 0       // Index 10
              ];
              if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { Logger.log(`DEBUG: Summary Sheet Table - Writing rowData: ${JSON.stringify(rowData)}`); }
              // Writing to sheet columns 1 to 11 (rowData.length is 11)
              summarySheet.getRange(categoryTableStartRow, 1, 1, rowData.length).setValues([rowData]);

              // Formatting sheet columns 2 to 11 (10 columns total)
              summarySheet.getRange(categoryTableStartRow, 2, 1, 10).setNumberFormat('#,##0');

              // Optional: Add alternating row color
              if ((categoryTableStartRow - (rowIndex + 7)) % 2 === 1) { // Check row index relative to table start
                  summarySheet.getRange(categoryTableStartRow, 1, 1, rowData.length).setBackground('#f8f9fa'); // Light gray
              }

              categoryTableStartRow++;
          });

          // Optionally resize columns for the new table (A + B-K) if needed
          // summarySheet.autoResizeColumns(2, 10); // Resize B-K based on count data
          // --- End Per-Campaign Category Counts Table ---

           // Add resume information if applicable
            const isResumeMode = startingCampaignName || (processOnlyCampaigns && processOnlyCampaigns.length > 0);

            // If any override/resume settings were used, display them.
            if (isResumeMode || !skipProcessedCampaigns) {
                // Position this section below the category table, using categoryTableStartRow
                let resumeStartRow = categoryTableStartRow + 1; // Start one row below the table

                let resumeInfo = 'Report generated with these custom settings:';
                summarySheet.getRange('A' + resumeStartRow).setValue(resumeInfo);
                summarySheet.getRange('A' + resumeStartRow).setFontWeight('bold');
                let currentRow = resumeStartRow + 1;

                if (startingCampaignName) {
                    summarySheet.getRange('A' + currentRow).setValue(`â€¢ Resumed from campaign: ${startingCampaignName}`);
                    currentRow++;
                }

                if (processOnlyCampaigns && processOnlyCampaigns.length > 0) {
                    summarySheet.getRange('A' + currentRow).setValue(`â€¢ Processed only campaigns: ${processOnlyCampaigns.join(', ')}`);
                    currentRow++;
                }

                // Always show the skip setting used
                summarySheet.getRange('A' + currentRow).setValue(`â€¢ Skip processed campaigns: ${skipProcessedCampaigns ? 'Yes' : 'No'}`);
                currentRow++;

                // Removed the "Last updated" line as requested
            }

          if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { Logger.log(`DEBUG: createSummarySheet finished successfully for sheet: ${summarySheet.getParent().getName()}`); }
          summarySheet.autoResizeColumns(1, 13); // Resize original table columns A-M AFTER all content is added
          SpreadsheetApp.flush(); // Force spreadsheet updates to apply immediately
        }

        /**
         * Processes a campaign and adds the data to the sheet
         * @param {Sheet} sheet The sheet to add the data to
         * @param {Campaign} campaign The campaign to process
         */
        function processCampaign(sheet, campaign, customImpressionSettings) {
          try {
            // The number of days for the report, taken from the master sheet or fallback to config.
            const dateRangeToUse = customDateRangeDays || MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DATE_RANGE_DAYS || MCC_CONFIG.DATE_RANGE_DAYS;

            // Calculate date range for consistent use throughout the function
            const endDate = new Date();
            endDate.setDate(endDate.getDate() - 1); // Yesterday
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - dateRangeToUse);

            // Format dates for Google Ads API query
            const startDateStr = Utilities.formatDate(startDate, AdsApp.currentAccount().getTimeZone(), 'yyyyMMdd');
            const endDateStr = Utilities.formatDate(endDate, AdsApp.currentAccount().getTimeZone(), 'yyyyMMdd');

            // Format dates for display
            const formattedStartDate = Utilities.formatDate(startDate, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
            const formattedEndDate = Utilities.formatDate(endDate, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');

            // Log date range being used
            let actualDateRangeUsed = `${dateRangeToUse} days (${formattedStartDate} to ${formattedEndDate})`;
            // Make date range log conditional
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                Logger.log(`Date range being used: ${actualDateRangeUsed}`);
            }

            // Create adGroupStatsMap to store ad group level metrics
            // Make collecting stats log conditional
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                Logger.log(`Collecting ad group stats for campaign: ${campaign.getName()}`);
            }
            const adGroupStatsMap = {};
            const adGroupIterator = campaign.adGroups().withCondition('Status = ENABLED').get();

            while (adGroupIterator.hasNext()) {
              const ag = adGroupIterator.next();
              const agId = ag.getId();

              try {
                // Get stats for the ad group using the same date range as campaign
                const stats = ag.getStatsFor(startDateStr, endDateStr);
                const convs = stats.getConversions();
                const cost = stats.getCost();
                const convVal = (typeof stats.getConversionValue === 'function') ? stats.getConversionValue() : 0;
                const impressions = stats.getImpressions();
                const clicks = stats.getClicks();

                // Store ad group metrics
                adGroupStatsMap[agId] = {
                  avgCPA: convs > 0 ? cost / convs : 0,
                  avgROAS: cost > 0 ? convVal / cost : 0,
                  avgCTR: impressions > 0 ? clicks / impressions : 0,
                  avgCPC: clicks > 0 ? cost / clicks : 0,
                  conversions: convs,
                  cost: cost,
                  convValue: convVal,
                  impressions: impressions,
                  clicks: clicks,
                  name: ag.getName()
                };
              } catch (e) {
                Logger.log(`Error getting stats for ad group ${ag.getName()}: ${e.message}`);
                // Add empty placeholder to avoid errors when accessing this ad group
                adGroupStatsMap[agId] = {
                  avgCPA: 0,
                  avgROAS: 0,
                  avgCTR: 0,
                  avgCPC: 0,
                  conversions: 0,
                  cost: 0,
                  convValue: 0,
                  impressions: 0,
                  clicks: 0,
                  name: ag.getName()
                };
              }
            }
            // Make collected stats log conditional
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                Logger.log(`Collected stats for ${Object.keys(adGroupStatsMap).length} ad groups`);
            }

            // Get search term data with categories, passing the specific impression threshold
            const searchTermData = getSearchTermData(campaign, startDate, endDate, customImpressionSettings);

            // Make retrieved data log conditional
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                Logger.log(`Search term data retrieved: ${searchTermData.searchTerms.length} terms`);
            }

            // Store ad group stats map for access by other functions
            processCampaign.adGroupStatsMap = adGroupStatsMap;

            // Add campaign header with bidding strategy
            addCampaignHeader(sheet, campaign, getCampaignBiddingStrategy(campaign));

            // Check if we have any search terms
            if (searchTermData.searchTerms.length === 0) {
              Logger.log('No search terms found for campaign, marking as insufficient data');
              flagCampaignWithInsufficientData(sheet, campaign);
              return;
            }

            // Categorize search terms, now passing adGroupStatsMap
            const categorizationResult = categorizeSearchTerms(searchTermData.searchTerms, campaign, adGroupStatsMap);
            const categorizedTerms = categorizationResult.categories; // Access the term arrays

            // REMOVE DUPLICATES within each category:
            Object.keys(categorizedTerms).forEach(categoryName => { // Iterate over the categories object directly
              categorizedTerms[categoryName] = deduplicateTerms(categorizedTerms[categoryName]); // Pass the array for this category
            });

            // Log section data counts for debugging
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { // Make log conditional
                Logger.log(`DEBUG: Section counts after categorization:
                  Converting Well: ${categorizedTerms.CONVERTING_WELL.length}
                  Hidden Waste: ${categorizedTerms.HIDDEN_WASTE.length}
                  Lost Spend: ${categorizedTerms.LOST_SPEND.length}
                  Efficiency: ${categorizedTerms.EFFICIENCY.length}
                  Conversion Volume: ${categorizedTerms.CONVERSION_VOLUME.length}
                  Stick or Twist: ${categorizedTerms.STICK_OR_TWIST.length}
                  Favorable Message Match: ${categorizedTerms.FAVORABLE_MESSAGE_MATCH.length}
                  Ad Rank Killers: ${categorizedTerms.AD_RANK_KILLERS.length}
                  High CTR No Conversion: ${categorizedTerms.HIGH_CTR_NO_CONVERSION.length}
                  Really High CPC: ${categorizedTerms.REALLY_HIGH_CPC.length}
                `);
            }

            // Log sample data from first section with data for debugging
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { // Make log conditional
                for (const category in categorizedTerms) {
                  if (categorizedTerms[category].length > 0) {
                    Logger.log(`DEBUG: Sample data from ${category}:`);
                    const sample = categorizedTerms[category][0];
                    Logger.log(`DEBUG: Search Term: ${sample.searchTerm}`);
                    Logger.log(`DEBUG: Ad Group: ${sample.adGroupId} - ${sample.adGroupName || 'Unknown'}`);
                    Logger.log(`DEBUG: Metrics: Impressions=${sample.impressions}, Clicks=${sample.clicks}, Conv=${sample.conversions}, Cost=${sample.cost}`);
                    Logger.log(`DEBUG: Status: ${sample.status}, Match Type: ${sample.matchType}`);
                    break;
                  }
                }
            }

            // Add categorized data to sheet
            // Make adding data log conditional
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                Logger.log('Adding categorized data to sheet...');
            }
            applyFiltersAndAddToSheet(sheet, categorizedTerms, campaign, getCampaignBiddingStrategy(campaign), searchTermData.searchTerms);

            // Format the sheet
            formatCampaignSheet(sheet);

            formatCampaignSheet(sheet); // Call formatting before final log

            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { Logger.log(`DEBUG: Finished processing campaign: ${campaign.getName()}`); }

            // Calculate counts *after* deduplication
            const finalCounts = {};
            for (const categoryName in categorizedTerms) {
                finalCounts[categoryName] = categorizedTerms[categoryName].length;
            }

            // Return category counts
            return {
              categoryCounts: finalCounts // Return counts calculated *after* deduplication
            };
          } catch (error) {
            Logger.log(`Error processing campaign ${campaign.getName()}: ${error.message}`);

            // Add error message to sheet
            const errorRange = sheet.getRange(8, 1, 1, 10);
            errorRange.merge();
            errorRange.setValue(`Error processing campaign: ${error.message}`).setBackground('#f4cccc');
          }
        }

        /**
         * Sanitizes a campaign name for use as a sheet name
         * @param {string} campaignName The campaign name
         * @return {string} Sanitized sheet name
         */
        function sanitizeSheetName(campaignName) {
          // Sheet names in Google Sheets have a 100 character limit and cannot contain certain characters
          let sheetName = campaignName.substring(0, 90); // Leave room for potential suffix

          // Replace invalid characters
          sheetName = sheetName.replace(/[\\\/\*\?\[\]]/g, '_');

          // Ensure uniqueness by adding a suffix if needed
          // This is a simplified approach - in a real script you might need more robust uniqueness checking
          return sheetName;
        }

        /**
         * Adds campaign header information to the sheet
         * @param {Sheet} sheet The sheet to add the header to
         * @param {Campaign} campaign The campaign object
         * @param {string} biddingStrategy The bidding strategy type
         */
        function addCampaignHeader(sheet, campaign, biddingStrategy) {
          try {
            // The number of days for the report, taken from the master sheet or fallback to config.
            const dateRangeToUse = customDateRangeDays || MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DATE_RANGE_DAYS || MCC_CONFIG.DATE_RANGE_DAYS;

            // Calculate date range (excluding today)
            const endDate = new Date();
            endDate.setDate(endDate.getDate() - 1); // Yesterday
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - dateRangeToUse);

            // Format dates for Google Ads API
            const startDateStr = Utilities.formatDate(startDate, AdsApp.currentAccount().getTimeZone(), 'yyyyMMdd');
            const endDateStr = Utilities.formatDate(endDate, AdsApp.currentAccount().getTimeZone(), 'yyyyMMdd');

            // Format the date strings for display
            const formattedStartDate = Utilities.formatDate(startDate, AdsApp.currentAccount().getTimeZone(), 'MMM d, yyyy');
            const formattedEndDate = Utilities.formatDate(endDate, AdsApp.currentAccount().getTimeZone(), 'MMM d, yyyy');

            // Determine the actual date range to display
            let actualDateRangeUsed = `${dateRangeToUse} days (${formattedStartDate} to ${formattedEndDate})`;

            // Get campaign stats
            let stats;
            let fallbackDateRange = null;

            try {
              // Use two separate parameters for dateFrom and dateTo
              stats = campaign.getStatsFor(startDateStr, endDateStr);
            } catch (e) {
              Logger.log(`Error with custom date range for ${campaign.getName()}, falling back to predefined range: ${e.message}`);

              // Set fallback date range if not already set
              if (!fallbackDateRange) {
                if (dateRangeToUse <= 7) {
                  fallbackDateRange = 'LAST_7_DAYS';
                } else if (dateRangeToUse <= 14) {
                  fallbackDateRange = 'LAST_14_DAYS';
                } else if (dateRangeToUse <= 30) {
                  fallbackDateRange = 'LAST_30_DAYS';
                } else {
                  fallbackDateRange = 'LAST_30_DAYS';
                }

                actualDateRangeUsed = fallbackDateRange.replace('LAST_', '').replace('_', ' ').toLowerCase();
              }

              stats = campaign.getStatsFor(fallbackDateRange);
            }

            // Get all metrics
            const impressions = stats.getImpressions();
            const clicks = stats.getClicks();
            const cost = stats.getCost();
            const conversions = stats.getConversions();
            const cpc = clicks > 0 ? cost / clicks : 0;

            // Get conversion value and calculate ROAS
            let conversionValue = 0;
            try {
              if (typeof stats.getConversionValue === 'function') {
                conversionValue = stats.getConversionValue();
              } else if (typeof stats.getConversionsValue === 'function') {
                conversionValue = stats.getConversionsValue();
              } else {
                // Try to get it from the report
                const reportQuery = fallbackDateRange ?
                  `SELECT campaign.id, metrics.conversions_value
                  FROM campaign
                  WHERE campaign.id = ${campaign.getId()}
                  AND segments.date DURING ${fallbackDateRange}` :
                  `SELECT campaign.id, metrics.conversions_value
                  FROM campaign
                  WHERE campaign.id = ${campaign.getId()}
                  AND segments.date >= '${startDateStr}'
                  AND segments.date <= '${endDateStr}'`;

                const report = executeWithRetry(() => AdsApp.report(reportQuery));
                const rows = report.rows();
                if (rows.hasNext()) {
                  const row = rows.next();
                  conversionValue = parseFloat(row['metrics.conversions_value']) || 0;
                }
              }
            } catch (e) {
              Logger.log("Error getting conversion value: " + e.message);
              conversionValue = 0;
            }

            // Calculate derived metrics
            const ctr = impressions > 0 ? clicks / impressions : 0;
            const convRate = clicks > 0 ? conversions / clicks : 0;
            const cpa = conversions > 0 ? cost / conversions : 0;
            const roas = cost > 0 ? conversionValue / cost : 0;

            // Add campaign header information
            sheet.getRange(1, 1, 1, 10).setValues([[
              'Campaign Name',
              'Status',
              'Budget',
              'Impressions',
              'Clicks',
              'Cost',
              'Conversions',
              'Conv. Value',
              'CPA',
              'ROAS'
            ]]);

            // Add campaign data
            sheet.getRange(2, 1, 1, 10).setValues([[
              campaign.getName(),
              campaign.isEnabled() ? 'ENABLED' : 'PAUSED',
              campaign.getBudget().getAmount(),
              impressions,
              clicks,
              cost,
              conversions,
              conversionValue,
              cpa,
              roas
            ]]);

            // Format the header row
            sheet.getRange(1, 1, 1, 10)
              .setFontWeight('bold')
              .setBackground('#4284f3')
              .setFontColor('white');

            // Format specific cells in the data row
            sheet.getRange(2, 3).setNumberFormat(currencyFormatString); // Budget
            sheet.getRange(2, 4).setNumberFormat('#,##0'); // Impressions
            sheet.getRange(2, 5).setNumberFormat('#,##0'); // Clicks
            sheet.getRange(2, 6).setNumberFormat(currencyFormatString); // Cost
            sheet.getRange(2, 7).setNumberFormat('#,##0.00'); // Conversions - Ensure two decimal places
            sheet.getRange(2, 8).setNumberFormat(currencyFormatString); // Conv. Value
            sheet.getRange(2, 9).setNumberFormat(currencyFormatString); // CPA
            sheet.getRange(2, 10).setNumberFormat('0.00%'); // ROAS

            // Add date range information
            sheet.getRange(3, 1).setValue('Date Range: ' + actualDateRangeUsed);
            sheet.getRange(3, 1).setFontStyle('italic');

            // Add bidding strategy information
            sheet.getRange(4, 1).setValue('Bidding Strategy: ' + biddingStrategy);
            sheet.getRange(4, 1).setFontStyle('italic');

            // Resize header columns A-J to fit header content
            sheet.autoResizeColumns(1, 10);

          } catch (error) {
            Logger.log('Error in addCampaignHeader: ' + error.message);
            throw error;
          }
        }

        /**
         * Gets search term data for a campaign
         * @param {Campaign} campaign The campaign to get data for
         * @param {Date} [startDate] Optional custom start date. If not provided, uses MCC_CONFIG.DATE_RANGE_DAYS
         * @param {Date} [endDate] Optional custom end date. If not provided, uses yesterday
         * @return {Object} The search term data
         */
        function getSearchTermData(campaign, startDate, endDate, customImpressionSettings) {
          // This function now receives pre-calculated start and end dates from processCampaign.
          // The logic to use customDateRangeDays has been moved up to processCampaign.
          if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
              Logger.log(`DEBUG: Getting search term data for campaign: ${campaign.getName()}`);
          }

          // Calculate date range
          if (!endDate) {
            endDate = new Date();
            endDate.setDate(endDate.getDate() - 1); // Yesterday
          }
          if (!startDate) {
            startDate = new Date(endDate);
            startDate.setDate(endDate.getDate() - (MCC_CONFIG.DATE_RANGE_DAYS -1) ); // N days ago
          }

          // Format dates for GAQL
          const formattedStartDate = formatDateForGaql(startDate);
          const formattedEndDate = formatDateForGaql(endDate);

          // Make date range log conditional
          if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
            Logger.log(`Date range: ${formattedStartDate} to ${formattedEndDate}`);
          }

          let scaledMinImpressions = 1; // Default to 1 as a safe minimum

          const dateRangeInDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

          // Determine threshold type and value, prioritizing sheet settings then script defaults
          let thresholdType = 'Minimum'; // Default type
          let thresholdValue = MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.IMPRESSIONS.MINIMUM;

          if (customImpressionSettings && customImpressionSettings.type && customImpressionSettings.value !== null && customImpressionSettings.value !== '') {
              thresholdType = customImpressionSettings.type;
              thresholdValue = customImpressionSettings.value;
              if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                  Logger.log(`Using impression threshold settings from sheet: Type='${thresholdType}', Value='${thresholdValue}'`);
              }
          } else {
              if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                  Logger.log(`Using default impression threshold settings from script config.`);
              }
              // Fallback to defaults if not set in sheet
              const configDefaults = MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.IMPRESSIONS;
              if (configDefaults.MINIMUM > 0) {
                  thresholdType = 'Minimum';
                  thresholdValue = configDefaults.MINIMUM;
              } else if (configDefaults.MONTHLY_MINIMUM > 0) {
                  thresholdType = 'Monthly Minimum';
                  thresholdValue = configDefaults.MONTHLY_MINIMUM;
              } else if (configDefaults.DAILY_MINIMUM > 0) {
                  thresholdType = 'Daily Minimum';
                  thresholdValue = configDefaults.DAILY_MINIMUM;
              }
          }

          // Calculate scaled impressions based on the final type and value
          if (thresholdValue > 0) {
              switch (thresholdType) {
                  case 'Minimum':
                      scaledMinImpressions = thresholdValue;
                      if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) Logger.log(`Applying 'Minimum' impression threshold: ${scaledMinImpressions}`);
                      break;
                  case 'Monthly Minimum':
                      scaledMinImpressions = Math.ceil((dateRangeInDays / 30) * thresholdValue);
                      if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) Logger.log(`Applying 'Monthly Minimum' impression threshold: ${thresholdValue}, scaled to ${scaledMinImpressions} for ${dateRangeInDays} days.`);
                      break;
                  case 'Daily Minimum':
                      scaledMinImpressions = Math.ceil(dateRangeInDays * thresholdValue);
                      if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) Logger.log(`Applying 'Daily Minimum' impression threshold: ${thresholdValue}, scaled to ${scaledMinImpressions} for ${dateRangeInDays} days.`);
                      break;
                  default:
                      if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) Logger.log(`Unknown threshold type '${thresholdType}'. Defaulting to 1.`);
                      scaledMinImpressions = 1;
                      break;
              }
          } else {
              if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) Logger.log('Impression threshold value is not positive. Defaulting to 1.');
              scaledMinImpressions = 1;
          }

          if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
            Logger.log(`Final minimum impressions threshold used for query: ${scaledMinImpressions}`);
          }

          const comprehensiveQuery = `
              SELECT
                  search_term_view.search_term,
                  ad_group.id,
                  ad_group.name,
                  metrics.impressions,
                  metrics.clicks,
                  metrics.cost_micros,
                  metrics.conversions,
                  metrics.conversions_value,
                  metrics.ctr,
                  metrics.average_cpc,
                  metrics.cost_per_conversion,
                  metrics.all_conversions_from_interactions_rate,
                  search_term_view.status
              FROM search_term_view
              WHERE
                  campaign.id = ${campaign.getId()}
                  AND segments.date BETWEEN '${formattedStartDate}' AND '${formattedEndDate}'
                  AND metrics.impressions >= ${scaledMinImpressions}
          `;

          let allSearchTerms = [];
          const report = executeWithRetry(() => AdsApp.report(comprehensiveQuery));
          const rows = report.rows();

          while (rows.hasNext()) {
            const row = rows.next();
            const searchTerm = {
                searchTerm: row['search_term_view.search_term'],
                adGroupId: row['ad_group.id'],
                adGroupName: row['ad_group.name'] || 'Unknown',
                matchType: 'Unknown', // Default match type since we can't get it from the API
                impressions: parseInt(row['metrics.impressions']),
                clicks: parseInt(row['metrics.clicks']),
                cost: parseFloat(row['metrics.cost_micros']) / 1000000,
                conversions: parseFloat(row['metrics.conversions']),
                conversionValue: parseFloat(row['metrics.conversions_value']),
                ctr: parseFloat(row['metrics.ctr']),
                avgCpc: parseFloat(row['metrics.average_cpc']) / 1000000,
                costPerConversion: parseFloat(row['metrics.cost_per_conversion']) / 1000000,
                conversionRate: parseFloat(row['metrics.all_conversions_from_interactions_rate']),
                status: row['search_term_view.status'],
                category: null // Category is now assigned later in categorizeSearchTerms
            };
            allSearchTerms.push(searchTerm);
          }

          return { searchTerms: allSearchTerms };
        }

        /**
         * Formats a date for use in GAQL queries
         * @param {Date} date The date to format
         * @return {string} Formatted date string (YYYY-MM-DD)
         */
        function formatDateForGaql(date) {
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          return `${year}-${month}-${day}`;
        }

        /**
         * Flags a campaign with insufficient data
         * @param {Sheet} sheet The sheet to add the flag to
         * @param {Campaign} campaign The campaign
         */
        function flagCampaignWithInsufficientData(sheet, campaign) {
          try {
            // The number of days for the report, taken from the master sheet or fallback to config.
            const dateRangeToUse = customDateRangeDays || MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DATE_RANGE_DAYS || MCC_CONFIG.DATE_RANGE_DAYS;

            // Get the headers to determine column count
            const headers = [
              'Campaign Overview',
              'Impressions',
              'Clicks',
              'CTR',
              'CPC',
              'Cost',
              'Conversions',
              'Conv. Rate',
              'CPA',
              'ROAS'
            ];
            const columnCount = headers.length;

          // Add warning message
            sheet.getRange(9, 1, 1, columnCount).merge();
            sheet.getRange('A9').setValue(`âš ï¸ WARNING: Insufficient search term data for analysis.`)
            .setBackground('#f4cccc')
            .setFontWeight('bold');

          // Add explanation
            sheet.getRange(11, 1, 3, columnCount).merge();
            sheet.getRange(11, 1).setValue(
              `This campaign does not have enough search term data to provide meaningful insights for any of the filter sections, during your selected date range of ${dateRangeToUse} days.\n\n` +
            `Possible reasons:\n` +
            `- The campaign is new or has very low traffic\n` +
            `- The campaign uses primarily Display or other non-search targeting\n` +
            `- The campaign has very restrictive targeting that limits search term volume\n\n` +
              `Recommendation: First, re-run this report with a longer lookback window. If issue persists: review campaign settings and consider broadening targeting or increasing budget to generate more search term data.`
            );
            sheet.getRange(11, 1).setWrap(true);
          } catch (error) {
            Logger.log(`Error in flagCampaignWithInsufficientData: ${error.message}`);
            try {
              // Simpler approach if the above fails
              sheet.getRange('A9').setValue(`âš ï¸ WARNING: Insufficient search term data for analysis.`)
                .setBackground('#f4cccc')
                .setFontWeight('bold');
            } catch (e) {
              Logger.log(`Failed to add warning message to sheet: ${e.message}`);
            }
          }
        }

        /**
         * Applies all filters and adds the data to the sheet
         * @param {Sheet} sheet The sheet to add the data to
         * @param {Object} sectionData The data for each section
         * @param {Campaign} campaign The campaign
         * @param {string} biddingStrategy The campaign bidding strategy
         * @param {Object} searchTermData The complete search term data object
         */
        function applyFiltersAndAddToSheet(sheet, sectionData, campaign, biddingStrategy, searchTermData) {
          try {
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { Logger.log(`DEBUG: Adding filter sections for campaign: ${campaign.getName()}`); }

            // Start from row 8 after the header section (which ends at row 7)
            let currentRow = 8;

            // Get all ad group IDs from the search terms
            const adGroupIds = new Set();
            if (searchTermData && searchTermData.searchTerms) {
              searchTermData.searchTerms.forEach(term => {
                if (term.adGroupId) adGroupIds.add(term.adGroupId);
              });
            }

            // Try to get adGroupStatsMap from the parent context (passed from processCampaign)
            try {
              if (typeof window === 'undefined') window = {};
              if (processCampaign.adGroupStatsMap) {
                window.adGroupStatsMap = processCampaign.adGroupStatsMap;
                // Make found stats log conditional
                if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                    Logger.log(`Found ${Object.keys(window.adGroupStatsMap).length} ad groups in stats map`);
                }
              }
            } catch (e) {
              Logger.log(`No adGroupStatsMap found: ${e.message}`);
            }

          // Add general information
            const infoRange = sheet.getRange(currentRow, 1, 1, 12);
            infoRange.merge();
            infoRange.setValue('Search Term Analysis Results').setFontWeight('bold').setBackground('#f3f3f3');
            currentRow++;

            // Add analysis note
            const noteRange = sheet.getRange(currentRow, 1, 1, 12);
            noteRange.merge();
            noteRange.setValue('Analysis based on search term data with section-specific lookback periods')
              .setBackground('#e6f4ea')
              .setFontWeight('bold');
            currentRow += 2; // Add extra space after note

            // Add each filter section
            currentRow = addFilterSection(sheet, currentRow, 'Converting Well',
              sectionData.CONVERTING_WELL,
            'These search terms are performing well with good CTR and conversions. Consider adding them as keywords.',
            true, biddingStrategy);

            currentRow = addFilterSection(sheet, currentRow, 'Hidden Waste',
              sectionData.HIDDEN_WASTE,
            'These search terms have low volume but are costly. Consider adding them as negative keywords.',
            true, biddingStrategy);

            currentRow = addFilterSection(sheet, currentRow, 'Lost Spend',
              sectionData.LOST_SPEND,
            'These search terms have no conversions and high cost. Consider adding them as negative keywords.',
            true, biddingStrategy);

            currentRow = addFilterSection(sheet, currentRow, 'Going for Efficiency',
              sectionData.EFFICIENCY,
            'These search terms convert but are above the average ' + (biddingStrategy === 'CPA' ? 'CPA' : 'ROAS') +
            ' of the Ad Group. Consider pausing or adjusting bids.',
            true, biddingStrategy);

            currentRow = addFilterSection(sheet, currentRow, 'Going for Conversion Volume',
              sectionData.CONVERSION_VOLUME,
            'These search terms convert but are 30-50% above the average ' + (biddingStrategy === 'CPA' ? 'CPA' : 'ROAS') +
            ' of the Ad Group. Consider adding them to a more appropriate Ad Group.',
            true, biddingStrategy);

            currentRow = addFilterSection(sheet, currentRow, 'Stick or Twist?',
              sectionData.STICK_OR_TWIST,
            'These search terms have low CTR but still convert. Consider improving ad copy to match these queries better.',
              true, biddingStrategy);

            currentRow = addFilterSection(sheet, currentRow, 'Favorable Message Match',
              sectionData.FAVORABLE_MESSAGE_MATCH,
            'These search terms have above average CTR and match your ad copy well. Consider adding them as keywords.',
            true, biddingStrategy);

            currentRow = addFilterSection(sheet, currentRow, 'Ad Rank Killers',
              sectionData.AD_RANK_KILLERS,
              'These search terms have poor performance with few clicks and no conversions. Consider adding as exact negatives.',
              true, biddingStrategy);

            currentRow = addFilterSection(sheet, currentRow, 'High CTR No Conversion',
              sectionData.HIGH_CTR_NO_CONVERSION,
            'These search terms have high CTR but no conversions. Consider reviewing landing page issues.',
            true, biddingStrategy);

            currentRow = addFilterSection(sheet, currentRow, 'Really High CPC',
              sectionData.REALLY_HIGH_CPC,
            'These search terms have high CPC. Ensure they convert effectively.',
            true, biddingStrategy);

            // Auto-resize columns for better readability
            // sheet.autoResizeColumns(1, 12); // Resizing handled elsewhere

            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { Logger.log(`DEBUG: Finished adding all filter sections for campaign: ${campaign.getName()}`); }
          } catch (error) {
            Logger.log(`Error in applyFiltersAndAddToSheet: ${error.message}`);
            try {
              sheet.getRange(8, 1).setValue(`Error processing filter sections: ${error.message}`).setBackground('#f4cccc');
            } catch (e) {
              Logger.log(`Failed to add error message to sheet: ${e.message}`);
            }
          }
        }

        /**
         * Formats the campaign sheet for readability
         * @param {Sheet} sheet The sheet to format
         */
        function formatCampaignSheet(sheet) {
          try {
            // --- Defensive Check: Minimum Rows ---
            const minRequiredRows = 8; // Header rows + at least one potential section header row
            if (sheet.getLastRow() < minRequiredRows) {
                Logger.log(`Skipping formatting for sheet ${sheet.getName()}: Not enough rows (${sheet.getLastRow()})`);
                return; // Exit function gracefully
            }
            // -------------------------------------

            // Format the header section
            const headerRange = sheet.getRange('A1:J1');
            headerRange.setBackground('#4284f3');
            headerRange.setFontColor('white');
            headerRange.setFontSize(14);
            headerRange.setFontWeight('bold');

            // Format campaign overview section
            const overviewRange = sheet.getRange('A2:J4');
            overviewRange.setBorder(true, true, true, true, true, true);

            // Format section headers
            const sectionHeaders = sheet.getRange('A:A').getValues();
            for (let i = 0; i < sectionHeaders.length; i++) {
              if (sectionHeaders[i][0] && typeof sectionHeaders[i][0] === 'string') {
                const headerText = sectionHeaders[i][0];
                if (headerText.includes('*Insert Exact Filters Used for this Ad Group*')) {
                  // Check row validity before getting range
                  if (i + 1 >= 1) {
                    const headerRange = sheet.getRange(i + 1, 1, 1, 10);
                    headerRange.merge();
                    headerRange.setFontWeight('bold');
                    headerRange.setBackground('#f3f3f3');
                  }
                }
              }
            }

            // Format column headers
            const columnHeaders = sheet.getRange('A:J').getValues();
            for (let i = 0; i < columnHeaders.length; i++) {
              // Check row validity before getting range
              if (i + 1 >= 1 && columnHeaders[i][0] === 'Search Term') {
                const headerRange = sheet.getRange(i + 1, 1, 1, 11);
                headerRange.setBackground('#f3f3f3');
                headerRange.setFontWeight('bold');
              }
            }

            // Format data cells
            const dataRange = sheet.getDataRange();
            // Ensure dataRange is valid before proceeding
            if (dataRange && dataRange.getLastRow() > 0 && dataRange.getLastColumn() > 0) {
                dataRange.setHorizontalAlignment('left');
                // Set specific column alignments (check if columns exist)
                if (dataRange.getLastColumn() >= 10) {
                    sheet.getRange(1, 3, dataRange.getLastRow(), 8).setHorizontalAlignment('right'); // C:J Right align metrics
                }
                 if (dataRange.getLastColumn() >= 11) {
                     sheet.getRange(1, 11, dataRange.getLastRow(), 1).setHorizontalAlignment('center'); // K Status center align
                 }
            }


            // Add borders to data sections
            const dataSections = sheet.getRange('A:J').getValues();
            let inDataSection = false;
            let sectionStart = 0;

            // --- Wrap border logic in try...catch ---
            try {
              for (let i = 0; i < dataSections.length; i++) {
                // Ensure dataSections[i] exists and is an array
                if (!dataSections[i] || !Array.isArray(dataSections[i])) continue;

                if (dataSections[i][0] && typeof dataSections[i][0] === 'string') {
                  if (dataSections[i][0].includes('*Insert Exact Filters Used for this Ad Group*')) {
                    if (inDataSection) {
                      // Format previous section
                      const height = i - sectionStart;
                       //--- Defensive Check: Validate range before formatting ---
                       if (sectionStart >= 1 && height > 0) {
                          // Check if the calculated range exceeds sheet bounds
                          if (sectionStart + height - 1 <= sheet.getMaxRows()) {
                              const sectionRange = sheet.getRange(sectionStart, 1, height, 11);
                              sectionRange.setBorder(true, true, true, true, true, true);
                          } else {
                               Logger.log(`Skipping border format: Calculated range height (${height}) exceeds sheet boundary from start row ${sectionStart}.`);
                          }
                       }
                       //--------------------------------------------------------
                    }
                    inDataSection = true;
                    sectionStart = i + 2; // Skip header and column headers
                  } else if (dataSections[i][0].includes('Total Search Terms:')) {
                    inDataSection = false;
                    // Format the section
                    const height = i - sectionStart;
                   //--- Defensive Check: Validate range before formatting ---
                   if (sectionStart >= 1 && height > 0) {
                        // Check if the calculated range exceeds sheet bounds
                        if (sectionStart + height - 1 <= sheet.getMaxRows()) {
                           const sectionRange = sheet.getRange(sectionStart, 1, height, 11);
                           sectionRange.setBorder(true, true, true, true, true, true);
                        } else {
                           Logger.log(`Skipping border format: Calculated range height (${height}) exceeds sheet boundary from start row ${sectionStart}.`);
                        }
                   }
                   //--------------------------------------------------------
                  }
                }
              }
               // After the loop, format the last section if still inDataSection
               if (inDataSection) {
                    const lastDataRowIndex = dataSections.length; // End of the data
                    const height = lastDataRowIndex - sectionStart;
                     //--- Defensive Check: Validate range before formatting ---
                   if (sectionStart >= 1 && height > 0) {
                        // Check if the calculated range exceeds sheet bounds
                        if (sectionStart + height - 1 <= sheet.getMaxRows()) {
                           const sectionRange = sheet.getRange(sectionStart, 1, height, 11);
                           sectionRange.setBorder(true, true, true, true, true, true);
                        } else {
                           Logger.log(`Skipping border format for last section: Calculated range height (${height}) exceeds sheet boundary from start row ${sectionStart}.`);
                        }
                   }
                   //--------------------------------------------------------
               }

            } catch (borderError) {
                Logger.log(`Error during border formatting loop in formatCampaignSheet for sheet ${sheet.getName()}: ${borderError.message} ${borderError.stack}`);
                // Continue with other formatting if possible
            }
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { Logger.log(`DEBUG: Attempting to auto-resize columns 1-11 for sheet: ${sheet.getName()}`); }

            sheet.autoResizeColumns(1, 11);
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { Logger.log(`DEBUG: Finished auto-resizing columns 1-11 for sheet: ${sheet.getName()}`); }
            // ------------------------------------

            // Freeze the top 3 rows (Campaign Header, Data, Date Range/Bidding)
            sheet.setFrozenRows(3); // Changed from 1
            // Make completion log conditional
            if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                Logger.log('Sheet formatting completed');
            }
          } catch (error) {
            Logger.log(`Error in formatCampaignSheet: ${error.message}`); // Keep: Error
          }
        }



        /**
         * Checks if a search term should be excluded based on negative keywords
         * This function is a secondary check after checking the status field directly.
         * While the status field (EXCLUDED) should capture all negative keywords at various levels,
         * this function provides an additional check against the ad group negative keywords list
         * for enhanced filtering and to catch newly added negatives.
         *
         * @param {string} searchTerm The search term to check
         * @param {Object} negativeKeywords Map of ad group IDs to negative keywords
         * @param {boolean} checkStatusOnly If true, only check the status field and ignore the custom negatives list
         * @return {boolean} True if the search term is a negative keyword
         */
        function isNegativeKeyword(searchTerm, negativeKeywords, checkStatusOnly = false) {
          // If the search term is null or undefined, play it safe
          if (!searchTerm) {
            return false;
          }

          // If INCLUDE_EXCLUDED_KEYWORDS is enabled, always return false
          if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.INCLUDE_EXCLUDED_KEYWORDS) {
            return false;
          }

          // When checking status only (for filters that specifically check term.status !== "NONE"),
          // we don't need to check against the negativeKeywords
          if (checkStatusOnly) {
            return false;
          }

          // If the negativeKeywords parameter is incorrectly formatted, play it safe
          if (!negativeKeywords || typeof negativeKeywords !== 'object') {
            return false;
          }

          // Check if the search term is a negative keyword in any ad group
          for (let adGroupId in negativeKeywords) {
            const negatives = negativeKeywords[adGroupId];
            if (Array.isArray(negatives) && negatives.includes(searchTerm.toLowerCase())) {
              return true;
            }
          }

          return false;
        }

        /**
         * Checks if a search term has been added as a keyword
         * @param {Object} searchTerm The search term object to check
         * @return {boolean} True if the search term has ADDED status
         */
        function isAddedKeyword(searchTerm) {
          // If the search term is null or undefined, play it safe
          if (!searchTerm) {
            return false;
          }

          // If INCLUDE_ADDED_KEYWORDS is enabled, always return false (don't filter out)
          if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.INCLUDE_ADDED_KEYWORDS) {
            return false;
          }

          // Check if the search term has ADDED status
          return searchTerm.status === "ADDED";
        }

        /**
         * Detects the campaign bidding strategy type
         * @param {Campaign} campaign The campaign to check
         * @return {string} The bidding strategy type ('CPA', 'ROAS', or 'MANUAL')
         */
        function getCampaignBiddingStrategy(campaign) {
          try {
            // Get the bidding strategy type using the correct method
            const biddingStrategyType = campaign.bidding().getStrategyType();

            // Map to a simplified type for our purposes
            if (biddingStrategyType === 'TARGET_CPA' || biddingStrategyType === 'MAXIMIZE_CONVERSIONS') {
              return 'CPA';
            } else if (biddingStrategyType === 'TARGET_ROAS' || biddingStrategyType === 'MAXIMIZE_CONVERSION_VALUE') {
              return 'ROAS';
            } else {
              return 'MANUAL'; // For manual CPC or other strategies
            }
          } catch (e) {
            Logger.log(`Error detecting bidding strategy: ${e.message}`);
            return 'MANUAL'; // Default to manual if detection fails
          }
        }

        /**
         * Gets negative keywords for all ad groups in a campaign
         * @param {Campaign} campaign The campaign to analyze
         * @return {Object} Object mapping ad group IDs to arrays of negative keywords
         */
        function getNegativeKeywords(campaign) {
          Logger.log(`Getting negative keywords for campaign: ${campaign.getName()}`);

          const negativeKeywords = {};

          // Get all ad groups in the campaign
          const adGroupIterator = campaign.adGroups().get();

          while (adGroupIterator.hasNext()) {
            const adGroup = adGroupIterator.next();
            const adGroupId = adGroup.getId();

            // Initialize array for this ad group
            negativeKeywords[adGroupId] = [];

            // Get negative keywords for this ad group
            const negativeKeywordIterator = adGroup.negativeKeywords().get();

            while (negativeKeywordIterator.hasNext()) {
              const negativeKeyword = negativeKeywordIterator.next();

              // Include all match types, but mark them accordingly
              const keyword = negativeKeyword.getText().toLowerCase();
              const matchType = negativeKeyword.getMatchType();

              // Store with match type indicator for potential future improvements
              // For backward compatibility, we're still just storing as strings in an array
              negativeKeywords[adGroupId].push(keyword);

              // Log the match type for debugging
              if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG && matchType !== 'EXACT') {
                Logger.log(`Including non-exact match negative keyword: ${keyword} (${matchType}) for ad group: ${adGroup.getName()}`);
              }
            }
          }

          return negativeKeywords;
        }

        /**
         * Adds a filter section to the sheet
         * @param {Sheet} sheet The sheet to add the section to
         * @param {number} startRow The row to start at
         * @param {string} title The section title
         * @param {Array} results The filtered search terms
         * @param {string} description The section description
         * @param {boolean} hasEnoughData Whether there is enough data for this section
         * @param {string} biddingStrategy The campaign bidding strategy
         * @return {number} The next row after this section
         */
        function addFilterSection(sheet, startRow, title, results, description, hasEnoughData, biddingStrategy) {
          try {
             // Make start log conditional
             if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
                Logger.log(`Adding filter section: ${title} with ${results.length} results`);
             }

            // Add some space before the section header
            sheet.getRange(startRow, 1, 1, 11).merge();
            sheet.getRange(startRow, 1).setValue('');
            startRow++;

            // Add section header with enhanced styling - using same blue as top header
            const headerRange = sheet.getRange(startRow, 1, 1, 11); // Extended to include status column
            headerRange.merge();
            headerRange.setValue(title)
              .setBackground('#4284f3')  // Google blue - matching main header
              .setFontColor('white')     // White text for contrast
              .setFontWeight('bold')
              .setFontSize(14);          // Larger font size for section headers

            // Add description with subtle background
            const descRange = sheet.getRange(startRow + 1, 1, 1, 11);
            descRange.merge();
            descRange.setValue(description)
              .setBackground('#e8f0fe')  // Light blue background
              .setFontWeight('bold');

            // Group search terms by ad group
            const termsByAdGroup = {};
            results.forEach(term => {
              const adGroupName = term.adGroupName || 'Unknown';
              if (!termsByAdGroup[adGroupName]) {
                termsByAdGroup[adGroupName] = [];
              }
              termsByAdGroup[adGroupName].push(term);
            });

            let currentRow = startRow + 2;

            // Define column headers once
            const headers = [
              'Search Term',
              'Ad Group',
              'Impressions',
              'Clicks',
              'CTR',
              'Cost',
              'Conversions',
              'Conv. Rate',
              'CPA',
              'ROAS',
              'Status'
            ];

            // If no results for any ad group, add a message
            if (Object.keys(termsByAdGroup).length === 0) {
              const noResultsRange = sheet.getRange(currentRow, 1, 1, 11);
              noResultsRange.merge();
              noResultsRange.setValue(`No search terms meet the criteria for ${title}`)
                .setBackground('#e6f4ea') // Light green
                .setFontWeight('bold');
              currentRow += 2; // Add some space after the message

              // Add separator
              sheet.getRange(currentRow, 1, 1, 11).merge();
              sheet.getRange(currentRow, 1).setValue('---------------------');
              currentRow++;

              return currentRow;
            }

            // Add data for each ad group
            for (const adGroupName in termsByAdGroup) {
              if (termsByAdGroup.hasOwnProperty(adGroupName)) {
                const terms = termsByAdGroup[adGroupName];



                // Create the actual filter formula for this ad group based on the section
                let filterFormula = getFilterFormulaForSection(title, adGroupName, biddingStrategy);

                // Add ad group header with real filter formula - styled with an accent color
                const adGroupHeaderRange = sheet.getRange(currentRow, 1, 1, 11);
                adGroupHeaderRange.merge();
                adGroupHeaderRange.setValue(`${adGroupName}: ${filterFormula}`)
                  .setFontWeight('bold')
                  .setBackground('#dfe6f7') // Light blue/gray background
                  .setFontSize(12);         // Slightly larger font for ad group headers
                currentRow++;

                // Add column headers for this ad group with distinctive styling
                sheet.getRange(currentRow, 1, 1, headers.length).setValues([headers]);
                sheet.getRange(currentRow, 1, 1, headers.length)
                  .setBackground('#f3f3f3')
                  .setFontWeight('bold')
                  .setBorder(true, true, true, true, true, true); // Add borders to make headers stand out
                currentRow++;

                // If no terms for this ad group, add a message
                if (terms.length === 0) {
                  const noTermsRange = sheet.getRange(currentRow, 1, 1, 11);
                  noTermsRange.merge();
                  noTermsRange.setValue(`No Search Terms Meet this Filter in This Ad Group`)
                    .setBackground('#e6f4ea') // Light green
                    .setFontStyle('italic');
                  currentRow++;
                } else {
                  // Create data rows
                  const dataRows = terms.map(term => {
                    // Calculate metrics (ensure proper currency conversion)
                    const ctr = term.clicks > 0 && term.impressions > 0 ? term.clicks / term.impressions : 0;
                    const convRate = term.clicks > 0 ? term.conversions / term.clicks : 0;
                    // CPA calculation - use the costPerConversion from API if available, or calculate it
                    const cpa = term.costPerConversion || (term.conversions > 0 ? term.cost / term.conversions : 0);
                    // ROAS calculation
                    const roas = term.cost > 0 ? term.conversionValue / term.cost : 0;

                return [
                  term.searchTerm,
                      term.adGroupName || 'Unknown',
                  term.impressions,
                  term.clicks,
                      ctr,
                  term.cost,
                  term.conversions,
                      convRate,
                      cpa,
                      roas,
                      term.status
                ];
              });

                  // Add data if we have any
                  const dataRange = sheet.getRange(currentRow, 1, dataRows.length, headers.length);
                  dataRange.setValues(dataRows);

                  // Add alternating row colors for better readability
                  for (let i = 0; i < dataRows.length; i++) {
                    if (i % 2 === 1) { // Apply to odd-numbered rows
                      sheet.getRange(currentRow + i, 1, 1, headers.length)
                        .setBackground('#f8f9fa'); // Very light gray
                    }
                  }

                  // Format numbers
                  sheet.getRange(currentRow, 3, dataRows.length, 1).setNumberFormat('#,##0'); // Impressions
                  sheet.getRange(currentRow, 4, dataRows.length, 1).setNumberFormat('#,##0'); // Clicks
                  sheet.getRange(currentRow, 5, dataRows.length, 1).setNumberFormat('0.00%'); // CTR
                  sheet.getRange(currentRow, 6, dataRows.length, 1).setNumberFormat(currencyFormatString); // Cost
                  sheet.getRange(currentRow, 7, dataRows.length, 1).setNumberFormat('#,##0.00'); // Conversions - Ensure two decimal places
                  sheet.getRange(currentRow, 8, dataRows.length, 1).setNumberFormat('0.00%'); // Conv. Rate
                  sheet.getRange(currentRow, 9, dataRows.length, 1).setNumberFormat(currencyFormatString); // CPA
                  sheet.getRange(currentRow, 10, dataRows.length, 1).setNumberFormat('0.00%'); // ROAS

                  // Add thin borders around the data for better separation
                  dataRange.setBorder(true, true, true, true, null, null, '#d9d9d9', SpreadsheetApp.BorderStyle.SOLID);

                  currentRow += dataRows.length;
                }

                // Add totals row with distinctive styling
                const totalRowRange = sheet.getRange(currentRow, 1, 1, 11);
                totalRowRange.merge();
                totalRowRange.setValue(`Total Search Terms: ${terms.length}`)
                  .setFontWeight('bold')
                  .setBackground('#f3f3f3'); // Light gray background for totals
                currentRow++;

                // Add separator - made more distinctive
                const separatorRange = sheet.getRange(currentRow, 1, 1, 11);
                separatorRange.merge();
                separatorRange.setValue('');
                separatorRange.setBackground('#efefef'); // Gray background for separator
                separatorRange.setBorder(false, false, true, false, false, false, '#b6b6b6', SpreadsheetApp.BorderStyle.SOLID_MEDIUM); // Bottom border only
                currentRow++;

                // Add a small delay to avoid hitting API limits
                Utilities.sleep(1100);
              }
            }

            return currentRow;
          } catch (error) {
            Logger.log(`Error in addFilterSection: ${error.message}`);
            return startRow;
          }
        }

        /**
         * Get the appropriate filter formula for a section
         * @param {string} sectionName The name of the section
         * @param {string} adGroupName The name of the ad group
         * @param {string} biddingStrategy The bidding strategy
         * @return {string} The filter formula
         */

        // ---------- Utility formatting functions ----------

      function formatNumber(value, decimals = 2) {
        return value.toFixed(decimals);
      }

      function formatPercent(value, decimals = 2) {
        return (value * 100).toFixed(decimals) + "%";
      }

      // ---------- End formatting helpers ----------

      /**
 * Get the appropriate filter formula for a section
 * @param {string} sectionName The name of the section
 * @param {string} adGroupName The name of the ad group
 * @param {string} biddingStrategy The bidding strategy
 * @return {string} The filter formula
 */
function getFilterFormulaForSection(sectionName, adGroupName, biddingStrategy) {
    // Try to get ad group ID from adGroupName
    let adGroupId = null;

    // First check for a global adGroupStatsMap (from processCampaign)
    let adGroupStats = null;
    let statsSource = "campaign";

    // Try to get ad group stats from window or processCampaign
    try {
      // Check for window.adGroupStatsMap first
      if (typeof window !== 'undefined' && window.adGroupStatsMap) {
        // First try to find by adGroupId
        for (const id in window.adGroupStatsMap) {
          if (window.adGroupStatsMap[id].name === adGroupName) {
            adGroupStats = window.adGroupStatsMap[id];
            adGroupId = id;
            statsSource = "ad group";
            break;
          }
        }
      }
      // Then check processCampaign.adGroupStatsMap
      else if (processCampaign && processCampaign.adGroupStatsMap) {
        // First try to find by adGroupId
        for (const id in processCampaign.adGroupStatsMap) {
          if (processCampaign.adGroupStatsMap[id].name === adGroupName) {
            adGroupStats = processCampaign.adGroupStatsMap[id];
            adGroupId = id;
            statsSource = "ad group";
            break;
          }
        }
      }
    } catch (e) {
      Logger.log(`Error getting adGroupStats: ${e.message}`);
    }

    // Get campaign averages as fallback
    const campaignAvgs = getCampaignAverages(adGroupName);

    // Use ad group stats if available, otherwise fall back to campaign averages
    const avgCTR = adGroupStats ? adGroupStats.avgCTR : campaignAvgs.avgCTR;
    const avgCPC = adGroupStats ? adGroupStats.avgCPC : campaignAvgs.avgCPC;
    const avgCPA = adGroupStats ? adGroupStats.avgCPA : campaignAvgs.avgCPA;
    const avgROAS = adGroupStats ? adGroupStats.avgROAS : campaignAvgs.avgROAS;

    // Log the source of stats for debugging
    if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
      Logger.log(`DEBUG: Using ${statsSource} stats for ${adGroupName}: CTR=${avgCTR}, CPC=${avgCPC}, CPA=${avgCPA}, ROAS=${avgROAS}`);
    }

    // Format values for display in filter formulas
    const formattedAvgCTR = formatPercent(avgCTR);
    const formattedAvgCPC = formatCurrency(avgCPC);
    const formattedAvgCPA = formatCurrency(avgCPA);
    // Ensure avgROAS is formatted correctly, adding isFinite check for safety
    const formattedAvgROAS = formatPercent(isFinite(avgROAS) ? avgROAS : 0);

    switch (sectionName) {
      case 'Converting Well':
        if (biddingStrategy === 'ROAS') {
          // --- Apply Fix Here ---
          // Use the correctly formatted average ROAS from above
          return `Conversions >= ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.HIGH} AND ROAS >= ${formattedAvgROAS}`;
          // --- End Fix ---
        } else if (biddingStrategy === 'CPA') {
          return `Conversions >= ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.HIGH} AND CPA <= ${formattedAvgCPA}`;
        } else {
          return `Conversions >= ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.HIGH}`;
        }
        break;

      case 'Hidden Waste':
        if (biddingStrategy === 'ROAS') {
          return `Conversions < 0.5 AND ROAS < ${formattedAvgROAS}`;
        } else if (biddingStrategy === 'CPA') {
          return `Conversions < 0.5 AND CPA > ${formattedAvgCPA}`;
        } else {
          return `Conversions < 0.5 AND Cost > $0`;
        }
        break;

      case 'Lost Spend':
        return `Conversions < ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.NONE} AND Cost > ${formatCurrency(MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.COST.HIGH)}`;

      case 'Going for Efficiency':
        if (biddingStrategy === 'ROAS') {
          return `Conversions > 0 AND Status = NONE AND ROAS < ${formatPercent(avgROAS * 0.8)}`;
        } else if (biddingStrategy === 'CPA') {
          return `Conversions > 0 AND Status = NONE AND CPA > ${formatCurrency(avgCPA * 1.2)}`;
        } else {
          return `Conversions > 0 AND Status = NONE`;
        }
        break;

      case 'Going for Conversion Volume':
        if (biddingStrategy === 'ROAS') {
          return `Conversions >= ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.HIGH} AND Status = NONE AND ROAS < ${formattedAvgROAS} AND ROAS > ${formatPercent(avgROAS * 0.7)}`;
        } else if (biddingStrategy === 'CPA') {
          return `Conversions >= ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.HIGH} AND Status = NONE AND CPA > ${formattedAvgCPA} AND CPA < ${formatCurrency(avgCPA * 1.5)}`;
        } else {
          return `Conversions >= ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.HIGH} AND Status = NONE`;
        }
        break;

      case 'Stick or Twist?':
        return `Conversions > 0 AND Status = NONE AND CTR < ${formatPercent(avgCTR * MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CTR.LOW_THRESHOLD)}`;

      case 'Favorable Message Match':
        return `Conversions >= ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.GOOD} AND CTR > ${formatPercent(avgCTR * MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CTR.HIGH_THRESHOLD)}`;

      case 'Ad Rank Killers':
        return `Conversions < ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.LOW} AND Clicks <= 1 AND Impressions > 50`;

      case 'High CTR No Conversion':
        return `Conversions < ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.GOOD} AND CTR > ${formatPercent(avgCTR * MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CTR.HIGH_THRESHOLD)}`;

      case 'Really High CPC':
        return `Conversions < ${MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.LOW} AND CPC > ${formatCurrency(avgCPC * MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CPC.MULTIPLIER)}`;

      default:
        return 'Custom Filter';
    }
  }

  /**
   * Format a number as a currency string
   * @param {number} value The number to format
   * @param {number} decimals The number of decimal places
   * @return {string} The formatted currency string
   */
  function formatCurrency(value, decimals = 2) {
    return currencySymbol + value.toFixed(decimals);
  }

  /**
   * Format a number as a percentage string
   * @param {number} value The number to format (0-1)
   * @param {number} decimals The number of decimal places
   * @return {string} The formatted percentage string
   */
  function formatPercent(value, decimals = 2) {
    return (value * 100).toFixed(decimals) + '%';
  }

        /**
         * Gets metrics for use in filter formulas, prioritizing ad group metrics when available
         * @param {string} adGroupName The ad group name
         * @return {Object} Object with avgCTR, avgCPC, avgCPA, avgROAS
         */
        function getCampaignAverages(adGroupName) {
          // Passed from outer scope in applyFiltersAndAddToSheet
          if (typeof window !== 'undefined' && window.adGroupStatsMap && adGroupName) {
            // Try to find the ad group by name
            for (const adGroupId in window.adGroupStatsMap) {
              if (window.adGroupStatsMap[adGroupId].name === adGroupName) {
                if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) { Logger.log(`DEBUG: Using ad group stats for ${adGroupName} in filter formula`); }
                return {
                  avgCTR: window.adGroupStatsMap[adGroupId].avgCTR,
                  avgCPC: window.adGroupStatsMap[adGroupId].avgCPC,
                  avgCPA: window.adGroupStatsMap[adGroupId].avgCPA,
                  avgROAS: window.adGroupStatsMap[adGroupId].avgROAS
                };
              }
            }
          }

          // Check if we have global averages stored
          if (typeof CAMPAIGN_AVERAGES !== 'undefined' && CAMPAIGN_AVERAGES) {
            return CAMPAIGN_AVERAGES;
          }

          // Default fallback values
          return {
            avgCTR: 0.025, // 2.5%
            avgCPC: 1.50,  // $1.50
            avgCPA: 25.00, // $25.00
            avgROAS: 1.75  // 175%
          };
        }

        /**
         * Adds section headers to the sheet
         * @param {Sheet} sheet The sheet to add headers to
         */
        function addSectionHeaders(sheet) {
          // Define the headers for the report
          const headers = [
            'Campaign Overview',
            'Impressions',
            'Clicks',
            'CTR',
            'CPC',
            'Cost',
            'Conversions',
            'Conv. Rate',
            'CPA',
            'ROAS'
          ];

          // Add headers to row 1
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
          sheet.getRange(1, 1, 1, headers.length).setBackground('#4284f3');
          sheet.getRange(1, 1, 1, headers.length).setFontColor('white');

          // Apply better number formatting to header row cells
          // This ensures the header cells have the right number format for their data type
          sheet.getRange(1, 2, 1, 1).setNumberFormat('#,##0');       // Impressions
          sheet.getRange(1, 3, 1, 1).setNumberFormat('#,##0');       // Clicks
          sheet.getRange(1, 4, 1, 1).setNumberFormat('0.00%');       // CTR
          sheet.getRange(1, 5, 1, 1).setNumberFormat('$#,##0.00');   // CPC
          sheet.getRange(1, 6, 1, 1).setNumberFormat('$#,##0.00');   // Cost
          sheet.getRange(1, 7, 1, 1).setNumberFormat('#,##0.00');       // Conversions
          sheet.getRange(1, 8, 1, 1).setNumberFormat('0.00%');       // Conv. Rate
          sheet.getRange(1, 9, 1, 1).setNumberFormat('$#,##0.00');   // CPA
          sheet.getRange(1, 10, 1, 1).setNumberFormat('0.00%');      // ROAS
        }

        /**
         * Checks if a search term should be excluded due to basic filters
         * @param {Object} term The search term data
         * @param {Object} negativeKeywords Map of ad group IDs to negative keywords
         * @param {Object} filterCounts Object to track filter counts
         * @param {boolean} excludeZeroCost Whether to exclude terms with zero cost
         * @return {boolean} True if the term should be excluded, false if it should be processed
         */
        function shouldExcludeTerm(term, negativeKeywords, filterCounts, excludeZeroCost = false) {
          // Check EXCLUDED status first
          if (term.status === "EXCLUDED") {
            if (filterCounts) filterCounts.excluded++;
            // If user wants to see excluded terms, don't exclude based on status alone
            if (!MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.INCLUDE_EXCLUDED_KEYWORDS) {
                return true;
            }
            // Otherwise (if user wants to see them), continue checks (like added status)
          }

          // Skip terms that are in our negative keywords list
          if (isNegativeKeyword(term.searchTerm, negativeKeywords)) {
            if (filterCounts) filterCounts.negative++;
            // isNegativeKeyword already respects INCLUDE_EXCLUDED_KEYWORDS
            return true;
          }

          // Skip terms that have been added as keywords (status = ADDED), unless user wants them
          if (isAddedKeyword(term)) {
            if (filterCounts) filterCounts.added++;
            // isAddedKeyword already respects INCLUDE_ADDED_KEYWORDS
            return true;
          }

          // Filter for status other than NONE - only for specific analysis types
          // This is now handled directly in the analysis functions that need it
          // (Stick or Twist, Efficiency, and Conversion Volume)

          // Optionally skip terms with zero or undefined cost
          if (excludeZeroCost && (!term.cost || term.cost <= 0)) {
            if (filterCounts) filterCounts.zeroCost++;
            return true;
          }

          return false;
        }

        /**
         * Categorizes search terms based on performance metrics
         * @param {Array} searchTerms The array of search terms to categorize
         * @param {Campaign} campaign The campaign object
         * @param {Object} adGroupStatsMap Map of ad group IDs to their statistics
         * @return {Object} Object containing search terms categorized by performance
         */
        function categorizeSearchTerms(searchTerms, campaign, adGroupStatsMap) {
          // Initialize categories
          const categories = {
            CONVERTING_WELL: [],
            HIDDEN_WASTE: [],
            LOST_SPEND: [],
            EFFICIENCY: [],
            CONVERSION_VOLUME: [],
            STICK_OR_TWIST: [],
            FAVORABLE_MESSAGE_MATCH: [],
            AD_RANK_KILLERS: [],
            HIGH_CTR_NO_CONVERSION: [],
            REALLY_HIGH_CPC: []
          };

          // Initialize variables for campaign totals for fallback
          let totalImpressions = 0;
          let totalClicks = 0;
          let totalCost = 0;
          let totalConversions = 0;
          let totalConversionValue = 0;

          // Calculate campaign totals
          searchTerms.forEach(term => {
            totalImpressions += term.impressions || 0;
            totalClicks += term.clicks || 0;
            totalCost += term.cost || 0;
            totalConversions += term.conversions || 0;
            totalConversionValue += term.conversionValue || 0;
          });

          // Calculate campaign averages for fallback
          const campaignAvgCTR = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
          const campaignAvgCPC = totalClicks > 0 ? totalCost / totalClicks : 0;
          const campaignAvgCPA = totalConversions > 0 ? totalCost / totalConversions : 0;
          const campaignAvgROAS = totalCost > 0 ? totalConversionValue / totalCost : 0;

          // Store campaign averages in global variable for use in header formatting
          CAMPAIGN_AVERAGES.avgCTR = campaignAvgCTR;
          CAMPAIGN_AVERAGES.avgCPC = campaignAvgCPC;
          CAMPAIGN_AVERAGES.avgCPA = campaignAvgCPA;
          CAMPAIGN_AVERAGES.avgROAS = campaignAvgROAS;

          // Get the bidding strategy
          const biddingStrategy = getCampaignBiddingStrategy(campaign);
          // Make averaging log conditional
          if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
              Logger.log(`Campaign averaging - CTR: ${campaignAvgCTR}, CPC: ${campaignAvgCPC}, CPA: ${campaignAvgCPA}, ROAS: ${campaignAvgROAS}, Strategy: ${biddingStrategy}`);
          }

          // Categorize each search term
          searchTerms.forEach(term => {
            if (shouldExcludeTerm(term)) return;
            if (!term.impressions) return;

            // Get ad group stats for this term, fall back to campaign stats if not available
            const agStats = term.adGroupId && adGroupStatsMap && adGroupStatsMap[term.adGroupId]
              ? adGroupStatsMap[term.adGroupId]
              : null;

            // Use ad group stats if available, otherwise fall back to campaign averages
            const avgCTR = agStats ? agStats.avgCTR : campaignAvgCTR;
            const avgCPC = agStats ? agStats.avgCPC : campaignAvgCPC;
            const avgCPA = agStats ? agStats.avgCPA : campaignAvgCPA;
            const avgROAS = agStats ? agStats.avgROAS : campaignAvgROAS;

            // If using ad group stats, log for debugging
            if (agStats && MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
              Logger.log(`Using ad group stats for term ${term.searchTerm}: Ad Group ${agStats.name}, CPA: ${avgCPA}, CTR: ${avgCTR}`);
            }

            // Calculate metrics for this term
            const termCTR = term.clicks > 0 && term.impressions > 0 ? term.clicks / term.impressions : 0;
            const termConvRate = term.clicks > 0 ? term.conversions / term.clicks : 0;
            const termCPA = term.conversions > 0 ? term.cost / term.conversions : 0;
            const termROAS = term.cost > 0 ? term.conversionValue / term.cost : 0;

            // CONVERTING_WELL - terms that convert at an efficient CPA/ROAS
            if (term.conversions >= MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.HIGH &&
                ((biddingStrategy === 'CPA' && termCPA <= avgCPA) ||
                 (biddingStrategy === 'ROAS' && termROAS >= avgROAS) ||
                 (biddingStrategy === 'MANUAL' && termROAS > 0))) {
              categories.CONVERTING_WELL.push(term);
            }

            // HIDDEN_WASTE - terms with high impressions but low CTR and no or few conversions
            else if (
              term.conversions < 0.5 && // Only <0.5 conversions terms (as in GAQL)
              (
                (biddingStrategy === 'ROAS' &&
                  term.cost > 0 &&
                  (term.conversionValue / term.cost) < avgROAS // low ROAS
                ) ||
                (biddingStrategy === 'CPA' &&
                  term.cost > 0 &&
                  term.conversions > 0 &&
                  (term.cost / term.conversions) > avgCPA // high CPA even on those barely converting
                )
              )
            ) {
              categories.HIDDEN_WASTE.push(term);
            }

            // LOST_SPEND - terms with high cost but no conversions
            else if (term.cost > MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.COST.HIGH &&
                     term.conversions < MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.NONE) {
              categories.LOST_SPEND.push(term);
            }

            // EFFICIENCY - terms with good volume but not efficient
            else if (term.conversions > 0 &&
                     term.status === 'NONE' &&
                     ((biddingStrategy === 'CPA' && termCPA > avgCPA * 1.2) ||
                      (biddingStrategy === 'ROAS' && termROAS < avgROAS * 0.8))) {
              categories.EFFICIENCY.push(term);
            }

            // CONVERSION_VOLUME - terms with above average efficiency but still within a threshold
            else if (term.conversions > MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.HIGH &&
                     term.status === 'NONE' &&
                     ((biddingStrategy === 'CPA' && termCPA > avgCPA && termCPA < avgCPA * 1.5) ||
                      (biddingStrategy === 'ROAS' && termROAS < avgROAS && termROAS > avgROAS * 0.7))) {
              categories.CONVERSION_VOLUME.push(term);
            }

            // STICK_OR_TWIST - terms with low CTR but still convert
            else if (term.conversions > 0 &&
                     term.status === 'NONE' &&
                     termCTR < avgCTR * MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CTR.LOW_THRESHOLD) {
              categories.STICK_OR_TWIST.push(term);
            }

            // FAVORABLE_MESSAGE_MATCH - terms with high CTR that match ad copy well
            else if (term.conversions >= MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.GOOD &&
                     termCTR > avgCTR * MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CTR.HIGH_THRESHOLD) {
              categories.FAVORABLE_MESSAGE_MATCH.push(term);
            }

            // AD_RANK_KILLERS - terms with poor performance
            else if (term.conversions < MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.LOW &&
                     term.clicks <= 1 &&
                     term.impressions > 50) {
              categories.AD_RANK_KILLERS.push(term);
            }

            // HIGH_CTR_NO_CONVERSION - terms with high CTR but no conversions
            else if (term.conversions < MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.GOOD &&
                     termCTR > avgCTR * MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CTR.HIGH_THRESHOLD) {
              categories.HIGH_CTR_NO_CONVERSION.push(term);
            }

            // REALLY_HIGH_CPC - terms with high CPC
            else if (term.conversions < MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CONVERSIONS.LOW &&
                     term.avgCpc > avgCPC * MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.FILTERS.CPC.MULTIPLIER) {
              categories.REALLY_HIGH_CPC.push(term);
            }
          });

          // Make Section Counts log conditional
          if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
              Logger.log(`Section counts after categorization:
                Converting Well: ${categories.CONVERTING_WELL.length}
                Hidden Waste: ${categories.HIDDEN_WASTE.length}
                Lost Spend: ${categories.LOST_SPEND.length}
                Efficiency: ${categories.EFFICIENCY.length}
                Conversion Volume: ${categories.CONVERSION_VOLUME.length}
                Stick or Twist: ${categories.STICK_OR_TWIST.length}
                Favorable Message Match: ${categories.FAVORABLE_MESSAGE_MATCH.length}
                Ad Rank Killers: ${categories.AD_RANK_KILLERS.length}
                High CTR No Conversion: ${categories.HIGH_CTR_NO_CONVERSION.length}
                Really High CPC: ${categories.REALLY_HIGH_CPC.length}
              `);
          }

          // Make Sample Data log conditional
          if (MCC_CONFIG.ACCOUNT_REPORT_DEFAULTS.DEBUG) {
              for (const category in categories) {
                  if (categories[category].length > 0) {
                      Logger.log(`Sample data from ${category}:`);
                      const sample = categories[category][0];
                      Logger.log(`Search Term: ${sample.searchTerm}`);
                      Logger.log(`Ad Group: ${sample.adGroupId} - ${sample.adGroupName || 'Unknown'}`);
                      Logger.log(`Metrics: Impressions=${sample.impressions}, Clicks=${sample.clicks}, Conv=${sample.conversions}, Cost=${sample.cost}`);
                      Logger.log(`Status: ${sample.status}, Match Type: ${sample.matchType}`);
                      break;
                  }
              }
          }

          // Return the categories and their counts
          const categoryCounts = {};
          for (const category in categories) {
            categoryCounts[category] = categories[category].length;
          }
          return { categories, categoryCounts };
        }

        function deduplicateTerms(termArray) {
          const seen = new Set();
          const deduped = [];
          for (const term of termArray) {
            const key = `${term.searchTerm}|${term.adGroupName}|${term.impressions}|${term.clicks}|${term.cost.toFixed(2)}|${term.conversions.toFixed(2)}`;
            if (!seen.has(key)) {
              seen.add(key);
              deduped.push(term);
            }
          }
          return deduped;
        }

        // All other functions remain the same
        // ...

        // Return the result from executeAccountReport
        return executeAccountReport();
      }

  // Helper function to set up or load the master tracking spreadsheet
  function setupOrLoadMaster(mccAccountName) {
    const ssName = `${mccAccountName} - Master Analysis Report - ${MCC_CONFIG.RUN_TIMESTAMP}`;
    let ss;
    let settingsSheet, analysisSheet;

    // --- Define Headers and Notes for Both Sheets ---
    const settingsHeader = [["Process? (Yes/No)", "Account Name", "CID", "Currency Code", "Date Range (Days)", "Impression Threshold Type", "Impression Threshold Value", "Skip Processed Campaigns? (Yes/No)", "Starting Campaign Name", "Process Only Campaigns (CSV)"]];
    const settingsNotes = [["Set to 'Yes' to enable.", "Account Name", "Customer ID", "Auto-detected on first run. Can be manually overridden (e.g., 'EUR').", "Number of past days to analyze (e.g., 90).", "Select the type of impression filter.", "Enter the value for the selected threshold type.", "Select 'No' to force a full re-run of the report for this account.", "Optional: Enter a campaign name to resume processing from that point.", "Optional: Enter a comma-separated list of campaign names to process only those."]];

    const analysisHeader = [[
        "Account Name", "CID", "Report Link", "Converting Well", "Hidden Waste", "Lost Spend", "Efficiency",
        "Volume", "Stick or Twist", "Favorable Message Match", "Ad Rank Killers", "High CTR No Conversion", "Really High CPC", "Date range of report"
    ]];
    const analysisNotes = [[
        "Account Name", "Customer ID", "Link to the detailed, multi-tab report.",
        "Search terms that are crushing it: strong CTR, solid conversions, and aligned with performance targets.",
        "Low-volume terms that fly under the radar but still eat up budget without converting.",
        "The big-ticket offenders: search terms with zero (or negligible) conversions but significant spend.",
        "These are converting search terms, but they're underperforming on CPA or ROAS.",
        "These are terms that convert consistently, but they might cost a bit more. Great candidates for scaling or restructuring.",
        "Low CTR search terms that still convertâ€”suggesting ad copy mismatch. Should you stick with them or twist (change the messaging)?",
        "Search terms with high CTR and solid engagementâ€”proof that your ad copy is landing well with these queries.",
        "Poor performers with low engagement and no conversions, likely dragging down your overall ad rank.",
        "Search terms that attract clicks but don't convertâ€”a red flag for landing page or offer issues.",
        "Terms with spiking CPCs, significantly above their ad group's average. These might need to be cut or managed carefully.",
        "The date range covered by the data in this row."
    ]];

    const settingsHeaderMap = new Map(settingsHeader[0].map((h, i) => [h, i + 1]));
    const analysisHeaderMap = new Map(analysisHeader[0].map((h, i) => [h, i + 1]));

    const headerFormat = (range) => range.setFontWeight("bold").setBackground("#4285f4").setFontColor("white");

    const setupSheet = (spreadsheet, sheetName, header, notes) => {
        let sheet = spreadsheet.getSheetByName(sheetName);
        if (!sheet) {
            sheet = spreadsheet.insertSheet(sheetName);
            Logger.log(`Created new sheet: "${sheetName}"`);
        }
        // Ensure header and notes are up-to-date on every run
        const headerRange = sheet.getRange(1, 1, 1, header[0].length);
        headerRange.setValues(header);
        headerRange.setNotes(notes);
        headerFormat(headerRange);

        // --- Add Dropdown for 'Process?' column in Settings ---
        if (sheetName === "Settings") {
            // Dropdown for "Process?"
            const processCol = settingsHeaderMap.get('Process? (Yes/No)');
            if (processCol) {
                const processRule = SpreadsheetApp.newDataValidation()
                    .requireValueInList(['Yes', 'No'], true)
                    .setAllowInvalid(false)
                    .setHelpText("Select 'Yes' to process this account.")
                    .build();
                sheet.getRange(2, processCol, sheet.getMaxRows() - 1).setDataValidation(processRule);
            }

            // Dropdown for "Impression Threshold Type"
            const thresholdTypeCol = settingsHeaderMap.get('Impression Threshold Type');
            if (thresholdTypeCol) {
                const thresholdRule = SpreadsheetApp.newDataValidation()
                    .requireValueInList(['Minimum', 'Monthly Minimum', 'Daily Minimum'], true)
                    .setAllowInvalid(false)
                    .setHelpText("Select the type of impression threshold.")
                    .build();
                sheet.getRange(2, thresholdTypeCol, sheet.getMaxRows() - 1).setDataValidation(thresholdRule);
            }

            // Dropdown for "Skip Processed Campaigns? (Yes/No)"
            const skipCol = settingsHeaderMap.get('Skip Processed Campaigns? (Yes/No)');
            if (skipCol) {
                const skipRule = SpreadsheetApp.newDataValidation()
                    .requireValueInList(['Yes', 'No'], true)
                    .setAllowInvalid(false)
                    .setHelpText("Select 'No' to re-process all campaigns for this account.")
                    .build();
                sheet.getRange(2, skipCol, sheet.getMaxRows() - 1).setDataValidation(skipRule);
            }
        }
        // --- End Dropdown Code ---

        return sheet;
    };

    // --- Main Logic: Find or Create Spreadsheet, then Set Up Sheets ---
    if (MCC_CONFIG.MCC_SPREADSHEET_URL) {
        try {
            Logger.log(`Attempting to resume from MCC Spreadsheet URL: ${MCC_CONFIG.MCC_SPREADSHEET_URL}`);
            ss = SpreadsheetApp.openByUrl(MCC_CONFIG.MCC_SPREADSHEET_URL);
        } catch (e) {
            Logger.log(`âš ï¸ Error opening MCC Spreadsheet URL: ${e.message}. Falling back to creating a new spreadsheet.`);
            ss = SpreadsheetApp.create(ssName);
            Logger.log(`Created new master sheet: ${ss.getUrl()}`);
        }
    } else {
        ss = SpreadsheetApp.create(ssName);
        Logger.log(`Created new master sheet: ${ss.getUrl()}`);
    }

    // Set up both sheets
    settingsSheet = setupSheet(ss, "Settings", settingsHeader, settingsNotes);
    analysisSheet = setupSheet(ss, "Account Analysis", analysisHeader, analysisNotes);

    // Clean up default "Sheet1" if it exists and there are other sheets
    const defaultSheet = ss.getSheetByName("Sheet1");
    if (ss.getSheets().length > 1 && defaultSheet) {
        ss.deleteSheet(defaultSheet);
    }

    // Move Account Analysis to the first position, Settings to second.
    ss.setActiveSheet(analysisSheet);
    ss.moveActiveSheet(1);
    ss.setActiveSheet(settingsSheet);
    ss.moveActiveSheet(2);

    // NEW: Apply heatmap formatting to the analysis sheet
    applyHeatmapFormatting(analysisSheet, analysisHeaderMap);

    return {
        spreadsheet: ss,
        settingsSheet: settingsSheet,
        analysisSheet: analysisSheet,
        settingsHeaderMap: settingsHeaderMap,
        analysisHeaderMap: analysisHeaderMap
    };
}


/**
 * Applies conditional formatting rules to the Account Analysis sheet to create a heatmap.
 * @param {Sheet} sheet The 'Account Analysis' sheet object.
 * @param {Map} headerMap A map of header names to their column numbers.
 */
function applyHeatmapFormatting(sheet, headerMap) {
    if (!sheet || !headerMap) {
        Logger.log("Skipping heatmap formatting due to missing sheet or header map.");
        return;
    }

    Logger.log("Applying heatmap conditional formatting to Account Analysis sheet.");

    // Clear any existing rules to avoid duplication on subsequent runs
    sheet.clearConditionalFormatRules();

    const lastRow = sheet.getMaxRows();

    // Define which columns get which color scale based on sentiment
    const positiveSentimentHeaders = ["Converting Well", "Volume", "Favorable Message Match"];
    const negativeSentimentHeaders = ["Hidden Waste", "Lost Spend", "Efficiency", "Stick or Twist", "Ad Rank Killers", "High CTR No Conversion", "Really High CPC"];

    // Helper function to get ranges from headers
    const getRanges = (headers) => {
        return headers
            .map(header => headerMap.get(header)) // Get column number
            .filter(colNum => colNum) // Filter out if header not found
            .map(colNum => sheet.getRange(2, colNum, lastRow - 1, 1)); // Get range object
    };

    const rules = sheet.getConditionalFormatRules();

    // --- Rule for Positive Sentiment (More is GOOD) ---
    const positiveRanges = getRanges(positiveSentimentHeaders);
    if (positiveRanges.length > 0) {
        const positiveRule = SpreadsheetApp.newConditionalFormatRule()
            .setRanges(positiveRanges)
            .setGradientMinpoint('#FFFFFF') // White for low values
            .setGradientMidpointWithValue('#d9ead3', SpreadsheetApp.InterpolationType.PERCENTILE, '50') // Light green for mid
            .setGradientMaxpoint('#6aa84f') // Dark green for high values
            .build();
        rules.push(positiveRule);
    }

    // --- Rule for Negative Sentiment (More is BAD) ---
    const negativeRanges = getRanges(negativeSentimentHeaders);
    if (negativeRanges.length > 0) {
        const negativeRule = SpreadsheetApp.newConditionalFormatRule()
            .setRanges(negativeRanges)
            .setGradientMinpoint('#FFFFFF') // White for low values
            .setGradientMidpointWithValue('#f4cccc', SpreadsheetApp.InterpolationType.PERCENTILE, '50') // Light red for mid
            .setGradientMaxpoint('#e06666') // Darker red for high values
            .build();
        rules.push(negativeRule);
    }

    sheet.setConditionalFormatRules(rules);
    Logger.log(`Heatmap formatting rules applied to ${positiveRanges.length} positive and ${negativeRanges.length} negative columns.`);
}


  // New function to synchronize the accounts in the MCC with the 'Settings' sheet.
  function syncAccountsWithSettingsSheet(settingsSheet, settingsHeaderMap) {
    // 1. Get all CIDs currently written in the Settings sheet.
    const cidColumnIndex = settingsHeaderMap.get('CID');
    const lastRow = settingsSheet.getLastRow();
    const sheetCids = new Set();
    if (lastRow > 1) { // Check if there's more than just the header
        const range = settingsSheet.getRange(2, cidColumnIndex, lastRow - 1, 1);
        range.getValues().forEach(row => {
            if (row[0]) {
                sheetCids.add(normalizeCid(row[0].toString()));
            }
        });
    }
    Logger.log(`Found ${sheetCids.size} accounts already in the Settings sheet.`);

    // 2. Get all accessible accounts from the MCC.
    const mccAccounts = MccApp.accounts().get();
    const newAccountsToAdd = [];

    // 3. Compare MCC accounts to sheet accounts to find new ones.
    while (mccAccounts.hasNext()) {
        const account = mccAccounts.next();
        const cid = account.getCustomerId();
        const normalizedCid = normalizeCid(cid);

        if (!sheetCids.has(normalizedCid)) {
            // This account is new. Prepare a row to append to the sheet with safe defaults.
            const newRow = new Array(settingsHeaderMap.size).fill('');
            newRow[settingsHeaderMap.get('Process? (Yes/No)') - 1] = 'Yes';
            newRow[settingsHeaderMap.get('Account Name') - 1] = account.getName();
            newRow[settingsHeaderMap.get('CID') - 1] = cid;
            // Set default date range and impression settings for new accounts
            newRow[settingsHeaderMap.get('Date Range (Days)') - 1] = MCC_CONFIG.DATE_RANGE_DAYS;
            newRow[settingsHeaderMap.get('Impression Threshold Type') - 1] = 'Minimum';
            newRow[settingsHeaderMap.get('Impression Threshold Value') - 1] = 30;
            newRow[settingsHeaderMap.get('Skip Processed Campaigns? (Yes/No)') - 1] = 'No';
            // Leave other optional settings blank
            newAccountsToAdd.push(newRow);
        }
    }

    // 4. Append all found new accounts to the sheet in a single operation.
    if (newAccountsToAdd.length > 0) {
        Logger.log(`Found ${newAccountsToAdd.length} new accounts to add to the Settings sheet.`);
        settingsSheet.getRange(settingsSheet.getLastRow() + 1, 1, newAccountsToAdd.length, newAccountsToAdd[0].length)
             .setValues(newAccountsToAdd);
    } else {
        Logger.log("No new accounts found in MCC to add to the Settings sheet.");
    }
}

  /**
   * Normalizes a CID by removing dashes for consistent comparison
   * @param {string} cid The CID to normalize
   * @return {string} The normalized CID without dashes
   */
   function normalizeCid(cid) {
    return cid.replace(/-/g, '');
  }

  // Helper function to find the row number for a given CID in the master sheet
  function findRowByCid(sheet, cidToFind, cidColumnIndex) {
      if (!cidToFind || !cidColumnIndex) return null;

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return null; // No data rows

      const cids = sheet.getRange(2, cidColumnIndex, lastRow - 1, 1).getValues();
      const normalizedCidToFind = normalizeCid(cidToFind.toString());

      for (let i = 0; i < cids.length; i++) {
          if (cids[i][0] && normalizeCid(cids[i][0].toString()) === normalizedCidToFind) {
              return i + 2; // Return the 1-indexed row number
          }
      }
      return null; // CID not found
  }

  /**
 * Cleans up the settings sheet by deleting any rows that are completely empty.
 * @param {Sheet} sheet The Google Sheet object for the 'Settings' tab.
 */
function cleanupSettingsSheet(sheet) {
    Logger.log("Starting cleanup of empty rows in Settings sheet...");
    const lastRow = sheet.getLastRow();
    // Start from row 2 to avoid checking the header.
    if (lastRow < 2) {
        Logger.log("No data rows to clean up.");
        return;
    }

    // We get all the data to check for emptiness, but delete from the bottom up.
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    let rowsDeleted = 0;

    // Iterate backwards to avoid issues with row indices changing after deletion.
    for (let i = values.length - 1; i >= 0; i--) {
        const row = values[i];
        const isEmpty = row.every(cell => cell.toString().trim() === '');
        if (isEmpty) {
            // The sheet row index is the loop index + the starting row (2).
            sheet.deleteRow(i + 2);
            rowsDeleted++;
        }
    }
    Logger.log(`Cleanup complete. Deleted ${rowsDeleted} empty rows.`);
}
