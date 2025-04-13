chrome.runtime.onInstalled.addListener(function (object) {
	if (object.reason === chrome.runtime.OnInstalledReason.INSTALL) {
		chrome.tabs.create({url: "/pages/options.html"});
	}
});

// Default values
var override = false;
var onYoutube = false;
var timeLeft = 1800;
var currentTab = null; // Initialize to null
var popupOpen = false;
var pauseOutOfFocus = true;
var youtubekidsEnabled = true;
var checkBrowserFocusTimer = null;
var timer = null;
var noLimit = false;
var whitelistedHandles = [];
var tempOverrideTabs = []; // Keep track of tabs where overlay is hidden by override

checkReset();

var days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
// Updates noLimit variable
chrome.storage.local.get({"customizeLimits":false, "dayLimits":{}}, function(data) {
	if (data.customizeLimits) {
		var today = new Date();
		var day = days[today.getDay()];
		if (day in data.dayLimits && data.dayLimits[day] === false) {
			noLimit = true;
		}
	}
});

// Function to load/update the whitelist cache
function updateWhitelistCache() {
    chrome.storage.local.get({ "whitelistedHandles": [] }, function(data) {
        if (chrome.runtime.lastError) {
            console.error("Error getting whitelist from storage:", chrome.runtime.lastError.message);
            whitelistedHandles = []; // Reset to empty on error
        } else {
            whitelistedHandles = data.whitelistedHandles || []; // Ensure it's an array
            // console.log("Whitelist cache updated:", whitelistedHandles);
        }
    });
}

// Initial load and listener for whitelist changes
updateWhitelistCache();
chrome.storage.onChanged.addListener(function(changes, namespace) {
	if (namespace === 'local') {
        // Update whitelist cache if it changes
        if (changes.whitelistedHandles) {
            updateWhitelistCache();
        }
         // Keep timeLeft in sync if changed externally (e.g., options page save)
        if (changes.timeLeft) {
            timeLeft = changes.timeLeft.newValue;
            // console.log("Background timeLeft updated from storage:", timeLeft);
            // Update badge immediately if timer is running or should be shown as 0:00
             if (onYoutube || timeLeft <= 0) {
                 updateBadge();
             }
        }
        // Update override status
        if (changes.override) {
            override = changes.override.newValue;
            // Update badge/behavior based on new override status
            if (currentTab && currentTab.url && isYoutube(currentTab.url)) {
                 checkTabForYouTube(currentTab.url); // Re-evaluate current tab state
            }
            // console.log("Background override updated from storage:", override);
        }
         // Update tempOverrideTabs if changed externally
        if (changes.tempOverrideTabs) {
            tempOverrideTabs = changes.tempOverrideTabs.newValue || [];
            // console.log("Background tempOverrideTabs updated from storage:", tempOverrideTabs);
        }
        // Update other settings as needed
        if (changes.noLimit) {
             noLimit = changes.noLimit.newValue;
        }
        if (changes.pauseOutOfFocus) {
            pauseOutOfFocus = changes.pauseOutOfFocus.newValue;
             // Manage focus timer based on new setting
             if (pauseOutOfFocus && checkBrowserFocusTimer == null) {
                 checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);
             } else if (!pauseOutOfFocus && checkBrowserFocusTimer != null) {
                 clearInterval(checkBrowserFocusTimer);
                 checkBrowserFocusTimer = null;
                 // If timer should be running (not paused), ensure it is
                 checkWindowsForTimerStart();
             }
        }
         if (changes.youtubekidsEnabled) {
            youtubekidsEnabled = changes.youtubekidsEnabled.newValue;
             // Re-evaluate timer state based on this change
             if (currentTab && currentTab.url) checkTabForYouTube(currentTab.url);
             else checkWindowsForTimerStart();
        }
        // Note: Changes to timeLimit, overrideLimit, resetTime, dayLimits, customizeLimits
        // are handled via messages from the options page save function now.
	}
});


chrome.storage.local.get({
    "override":override,
    "pauseOutOfFocus":pauseOutOfFocus,
    "youtubekidsEnabled":youtubekidsEnabled,
    "timeLeft":timeLeft,
    "tempOverrideTabs": [] // Load temp override tabs
}, function(data) {
	override = data.override;
	pauseOutOfFocus = data.pauseOutOfFocus;
	youtubekidsEnabled = data.youtubekidsEnabled;
    tempOverrideTabs = data.tempOverrideTabs || []; // Ensure it's an array

	if (pauseOutOfFocus) {
		checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);
	}

    // Load timeLeft only if it's a valid number
	if (!Number.isNaN(data.timeLeft))
		timeLeft = data.timeLeft;
	else {
		// Fallback to default limit if timeLeft is invalid
		chrome.storage.local.get({"timeLimit":30}, function(data) {
			timeLeft = data.timeLimit*60;
            chrome.storage.local.set({"timeLeft": timeLeft}); // Save valid fallback
		});
	}
     updateBadge(); // Set initial badge state
});

chrome.tabs.onActivated.addListener(function(activeInfo) {
	checkReset();
	chrome.tabs.get(activeInfo.tabId, function(tab){
	    if (chrome.runtime.lastError) { console.warn(chrome.runtime.lastError.message); return; }
        if (tab) {
		    currentTab = tab;
		    checkTabForYouTube(tab.url);
        } else {
            currentTab = null;
            onYoutube = false;
            stopTime(); // Stop timer if tab doesn't exist
        }
	});
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
	checkReset();
    // Check URL only if it changed and the tab is active
	if(tab.active && changeInfo.url){
		currentTab = tab;
		checkTabForYouTube(changeInfo.url);
	}
    // If status changes to complete for the current active tab, re-check
    // Useful if navigating within YT SPA doesn't fire URL change but content script needs re-check
    else if (tab.active && changeInfo.status === 'complete' && currentTab && currentTab.id === tabId) {
        currentTab = tab; // Update tab info
        checkTabForYouTube(tab.url);
    }
});


chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
    // Remove from tempOverrideTabs if the closed tab was overriding
    var index = tempOverrideTabs.indexOf(tabId);
    if (index !== -1) {
        tempOverrideTabs.splice(index, 1);
        chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
        // console.log("Removed closed tab", tabId, "from tempOverrideTabs");
    }

    // If the removed tab was the current active tab, clear currentTab state
    if (currentTab && currentTab.id === tabId) {
        currentTab = null;
         // If timer should stop because no other YT tabs are active
        if (!pauseOutOfFocus) {
            checkWindowsForTimerStop();
        } else if (onYoutube) {
             onYoutube = false; // Assume focus is lost if active tab closes
             stopTime();
        }
    }
});


function getHandleFromUrl(tabUrl) {
    // Simplified check, content script is more reliable
    if (!tabUrl) return null;
    try {
        const urlObj = new URL(tabUrl);
        const pathParts = urlObj.pathname.split('/');
        if (pathParts.length > 1 && pathParts[1].startsWith('@')) {
            if (/^@[\w.-]+$/.test(pathParts[1])) {
                 return pathParts[1];
            }
        }
    } catch (e) { /* Ignore parsing errors */ }
    return null;
}

function checkBrowserFocus(){
    if (pauseOutOfFocus) {
        chrome.windows.getLastFocused({ populate: false }, function(window) {
             if (chrome.runtime.lastError) { console.warn("Error getting focused window:", chrome.runtime.lastError.message); return; }

            if (window && window.focused) {
                // Browser has focus, check the active tab in the focused window
                chrome.tabs.query({ active: true, windowId: window.id }, function(tabs) {
                     if (chrome.runtime.lastError) { console.warn("Error querying active tab:", chrome.runtime.lastError.message); return; }
                    if (tabs && tabs[0]) {
                         if (!currentTab || currentTab.id !== tabs[0].id || (tabs[0].url && (!currentTab.url || currentTab.url !== tabs[0].url))) {
                            // Update currentTab if it's different or URL changed
                            currentTab = tabs[0];
                            checkTabForYouTube(currentTab.url);
                        } else if (!onYoutube && currentTab && currentTab.url && isYoutube(currentTab.url)) {
                             // If browser focused and on YT but timer isn't running, start it (unless whitelisted etc.)
                             checkTabForYouTube(currentTab.url); // This handles whitelist/time checks
                        }
                    } else {
                         // No active tab found? Should not happen often.
                         if (onYoutube) {
                             onYoutube = false;
                             stopTime();
                         }
                         currentTab = null;
                    }
                });
            } else {
                // Browser lost focus
                if (onYoutube && !popupOpen) { // Only stop if popup isn't keeping it alive
                    onYoutube = false;
                    stopTime();
                }
                 // Clear currentTab when focus is lost? Maybe not, keep last state.
            }
        });
    }
}


chrome.windows.onFocusChanged.addListener(function(windowId) {
	checkReset();

	if (pauseOutOfFocus) {
		if(windowId == chrome.windows.WINDOW_ID_NONE) {
            // Lost focus
            if (onYoutube && !popupOpen) { // Only stop if popup isn't keeping it alive
			    onYoutube = false;
			    stopTime();
            }
		} else {
            // Gained focus - re-check active tab in the newly focused window
            chrome.tabs.query({ active: true, windowId: windowId }, function(tabs) {
                if (chrome.runtime.lastError) { console.warn("Error querying focused window tab:", chrome.runtime.lastError.message); return; }
                if (tabs && tabs[0]) {
                    currentTab = tabs[0]; // Update current tab
                    checkTabForYouTube(currentTab.url);
                } else {
                    // No active tab in focused window? Stop timer if running.
                    if(onYoutube) {
                        onYoutube = false;
                        stopTime();
                    }
                    currentTab = null;
                }
            });
		}
	} else {
         // If pauseOutOfFocus is OFF, ensure timer is running if *any* YT tab is active
         checkWindowsForTimerStart();
    }
});

// --- Message Handling ---
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // console.log("Background received message:", request.msg); // Debugging
	switch(request.msg) {
        case "updateTimeLeftNow": // New handler
            if (typeof request.newTime === 'number' && !isNaN(request.newTime)) {
                console.log("Received direct timeLeft update:", request.newTime);
                timeLeft = Math.max(0, request.newTime); // Ensure non-negative

                // If the new time is > 0, make sure timer logic runs correctly
                if (timeLeft > 0) {
                     // Stop any active overlay if time is added back
                     if (currentTab && currentTab.id) {
                          hideOverlayOnTab(currentTab.id);
                     }
                     // Re-evaluate if the timer should start/stop based on the new time
                     checkWindowsForTimerStart();
                } else {
                     // If time is now 0, ensure timer is stopped and overlay logic runs
                     if (timer != null) {
                         stopTime();
                     }
                     // Check if overlay needs showing on current tab
                     if (currentTab && currentTab.url) {
                         checkTabForYouTube(currentTab.url);
                     }
                }

                 updateBadge(); // Update badge immediately
                 // No need to save to storage here, options page already did.
                 sendResponse({status: "TimeLeft updated directly"});
            } else {
                 console.warn("Invalid newTime received in updateTimeLeftNow:", request.newTime);
                 sendResponse({status: "Invalid time value received"});
            }
            break; // End new handler

		case "override":
            handleOverrideRequest(sender.tab);
            sendResponse({status: "Override processing started"});
			break;
		case "checkReset":
			checkReset();
            sendResponse({status: "Reset check initiated"});
			break;
		case "popupOpen":
			popupOpen = true;
            sendResponse({status: "Popup noted as open"});
			break;
		case "popupUnfocus":
			popupOpen = false;
            if (pauseOutOfFocus) checkBrowserFocus();
             sendResponse({status: "Popup noted as closed"});
			break;
		case "checkPageStatus":
			if (sender.tab && sender.tab.url) {
					const url = sender.tab.url;
					const tabId = sender.tab.id;
					const isHomepage = isYoutubeHomepage(url); // Check if homepage

					isChannelWhitelisted(url).then(isWhitelisted => {
						const isOverridden = tempOverrideTabs.includes(tabId);
						// Show overlay if: Time is up, AND not overriding, AND no limit, AND is YouTube, AND NOT whitelisted, AND NOT homepage
						const shouldOverlay = timeLeft <= 0 && !override && !noLimit && isYoutube(url) && !isWhitelisted && !isOverridden && !isHomepage;
						sendResponse({ shouldOverlay: shouldOverlay });
					}).catch(error => {
						console.error("Error checking whitelist status:", error);
						sendResponse({ shouldOverlay: false });
					});
					return true; // Indicate async response
			} else {
					sendResponse({ shouldOverlay: false });
			}
			break;

        // Keep messages needed by options save (these inform background of state changes)
        case "pauseOutOfFocus":
             pauseOutOfFocus = request.val;
             // Logic to start/stop focus timer based on request.val
             if (pauseOutOfFocus && checkBrowserFocusTimer == null) {
                 checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);
             } else if (!pauseOutOfFocus && checkBrowserFocusTimer != null) {
                 clearInterval(checkBrowserFocusTimer);
                 checkBrowserFocusTimer = null;
                 checkWindowsForTimerStart(); // Re-evaluate timer if pausing is turned off
             }
             sendResponse({status: "Pause setting updated"});
             break;
        case "youtubekidsEnabled":
            youtubekidsEnabled = request.val;
            // Re-evaluate timer state
            if (currentTab && currentTab.url) checkTabForYouTube(currentTab.url);
            else checkWindowsForTimerStart();
            sendResponse({status: "YouTube Kids setting updated"});
            break;
        case "resetTimeUpdated":
             // Background needs to know reset time might have changed for the checkReset logic
             // No immediate action needed other than checkReset running periodically or on next event
             sendResponse({status: "Reset time change noted"});
            break;
         case "noLimitInputChange": // Keep this for potential immediate state change
            var today = new Date();
			var day = days[today.getDay()];
            if (request.day == day) {
                 noLimit = true; // Assume 'false' dayLimit means no limit
                 if (timer != null) stopTime();
                 updateBadge();
                 hideOverlayOnAllWindows(); // Hide overlay if today becomes unlimited
            }
             sendResponse({status: "No limit change processed"});
            break;
        case "dayTimeLimitUpdated": // Keep this
            var today = new Date();
			var day = days[today.getDay()];
            if (request.day == day) {
                noLimit = false; // A specific limit means noLimit is false
                // TimeLeft will be updated by the direct updateTimeLeftNow message
                // but we need to ensure timer restarts if needed
                checkWindowsForTimerStart();
                updateBadge();
                 hideOverlayOnAllWindows(); // Hide overlay if time is added back
            }
            sendResponse({status: "Day time limit change noted"});
            break;
        case "customizeLimitsFalse": // Keep this
            noLimit = false; // Assume general limit applies, so noLimit is false
            // TimeLeft updated by direct message
            checkWindowsForTimerStart();
             updateBadge();
             hideOverlayOnAllWindows();
            sendResponse({status: "Customize limits disabled processed"});
            break;
        // NOTE: timeLimitUpdated message is effectively replaced by updateTimeLeftNow


        default:
            console.log("Background received unknown message:", request.msg);
            sendResponse({status: "Unknown message type"});
            break;
	}
     // Ensure synchronous messages return false or nothing if sendResponse wasn't called
     // For async messages like checkPageStatus, 'return true' is used inside the promise.
     return false;
});


// --- Helper to hide overlay on a specific tab ---
function hideOverlayOnTab(tabId) {
     if (tabId) {
          chrome.tabs.sendMessage(tabId, { msg: "hideOverlay" }, (response) => {
               if (chrome.runtime.lastError && chrome.runtime.lastError.message !== "Could not establish connection. Receiving end does not exist.") {
                  console.warn("Could not send hideOverlay message to tab:", tabId, chrome.runtime.lastError.message);
               }
          });
     }
}

// --- Helper Function to check if URL is YouTube Homepage ---
function isYoutubeHomepage(url) {
    if (!url) return false;
    try {
        const parsedUrl = new URL(url);
        // Check if it's youtube.com or youtubekids.com and the path is effectively '/'
        const isYouTubeDomain = /^(www\.)?youtube(kids)?\.com$/.test(parsedUrl.hostname);
        // Paths like '/', '/?param=..', '/#anchor' should count as homepage
        const isBasePath = parsedUrl.pathname === '/' || parsedUrl.pathname === '';
        return isYouTubeDomain && isBasePath;
    } catch (e) {
        // console.error("Error parsing URL:", url, e);
        return false;
    }
}

// --- Function to handle override request ---
function handleOverrideRequest(senderTab) {
     if (!senderTab || !senderTab.id) {
         console.warn("Override request received without valid sender tab ID.");
         return;
     }
     const tabId = senderTab.id;

     chrome.storage.local.get({"overrideLimit":5, "currentOverrideCount": null, "limitOverrides": true}, function(data) {
        let currentCount = data.currentOverrideCount !== null ? data.currentOverrideCount : data.overrideLimit;
        const limitEnabled = data.limitOverrides;
        let canOverride = false;

        if (limitEnabled) {
            if (currentCount >= 1) {
                currentCount--;
                canOverride = true;
            } else {
                 console.log("No overrides left.");
                 // Inform content script override failed? (Optional)
                 // chrome.tabs.sendMessage(tabId, { msg: "overrideFailed" });
                 return; // Stop processing
            }
        } else {
            canOverride = true; // No limit
        }

        if (canOverride) {
            override = true; // Set global override state (might be redundant if storage listener catches it)
             tempOverrideTabs.push(tabId); // Add current tab to temporary override list

             const storageUpdate = {
                override: true,
                tempOverrideTabs: tempOverrideTabs
             };
             if (limitEnabled) {
                 storageUpdate.currentOverrideCount = currentCount;
             }

            chrome.storage.local.set(storageUpdate, function() {
                 if (chrome.runtime.lastError) {
                     console.error("Error saving override state:", chrome.runtime.lastError.message);
                 } else {
                     console.log("Override activated for tab:", tabId);
                     // Background already sent "hideOverlay" via the content script's request
                     // Update badge/state for the current tab
                     currentTab = senderTab; // Ensure currentTab is set correctly
                     checkTabForYouTube(senderTab.url); // Re-check state, should now show override badge if needed
                 }
            });
        }
    });
}


function isYoutube(url) {
    if (!url) return false;
	if (youtubekidsEnabled)
		return /https?:\/\/(?!music\.)(.+?\.)?youtube(kids)?\.com(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
	return /https?:\/\/(?!music\.)(.+?\.)?youtube\.com(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
}

function isYoutubeVideo(url) {
    if (!url) return false;
	if (youtubekidsEnabled)
		return /https?:\/\/(?!music\.)(.+?\.)?youtube(kids)?\.com\/watch([A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
	return /https?:\/\/(?!music\.)(.+?\.)?youtube\.com\/watch([A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
}

function setWhitelistBadge() {
    chrome.action.setBadgeText({ "text": "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#28a745" }); // Green
}

function setOverrideBadge() {
    chrome.action.setBadgeText({ "text": "!" }); // Use exclamation mark for override
    chrome.action.setBadgeBackgroundColor({ color: "#ffc107" }); // Yellow/Warning color
}

function setTimerBadge() {
     chrome.action.setBadgeText({ "text": formatTime(timeLeft) });
     chrome.action.setBadgeBackgroundColor({ color: "#FF0000" }); // Red
}

function clearBadge() {
    chrome.action.setBadgeText({ "text": "" });
}

// Centralized function to update badge based on current state
function updateBadge() {
    if (!currentTab || !currentTab.url) {
         clearBadge();
         return;
    }

    isChannelWhitelisted(currentTab.url).then(isWhitelisted => {
        if (isYoutube(currentTab.url)) {
            if (isWhitelisted) {
                setWhitelistBadge();
            } else if (noLimit) {
                 chrome.action.setBadgeText({ "text": "∞" });
                 chrome.action.setBadgeBackgroundColor({ color: "#6c757d" }); // Grey
            } else if (override && tempOverrideTabs.includes(currentTab.id)) { // Check if override is active *for this specific tab*
                setOverrideBadge();
            } else if (timeLeft <= 0) {
                setTimerBadge(); // Show 0:00 but red
            } else if (onYoutube && timer != null) {
                 setTimerBadge(); // Show running time
            } else {
                 // On YouTube, time left, but timer not running (e.g., paused due to focus)
                 // Show the remaining time, but maybe a different color? Or keep it red? Let's keep it red.
                  setTimerBadge();
                 // Or potentially clear badge if timer is genuinely paused and not just 0:00?
                 // clearBadge(); // Alternative behavior
            }
        } else {
            clearBadge();
        }
    }).catch(error => {
        console.error("Error updating badge:", error);
        clearBadge(); // Clear badge on error
    });
}


async function updateTime() {
	if (timeLeft > 0) {
		timeLeft--;
	} else {
		// Time is up
		timeLeft = 0; // Ensure it doesn't go negative
        stopTime(); // Stop the interval timer itself

        // If on a YouTube page, check if it's a video page before showing overlay
         if (currentTab && currentTab.id && currentTab.url && isYoutube(currentTab.url)) {
            const isWhitelisted = await isChannelWhitelisted(currentTab.url);
            const isOverridden = tempOverrideTabs.includes(currentTab.id);
            const isHomepage = isYoutubeHomepage(currentTab.url); // Check if homepage

             // Show overlay only if NOT whitelisted, NOT overridden, NOT noLimit, AND NOT the homepage
            if (!isWhitelisted && !noLimit && !isOverridden && !isHomepage) {
                 chrome.tabs.sendMessage(currentTab.id, { msg: "showOverlay" }, (response) => {
                      if (chrome.runtime.lastError && chrome.runtime.lastError.message !== "Could not establish connection. Receiving end does not exist.") {
                           console.warn("Could not send showOverlay message to tab:", currentTab.id, chrome.runtime.lastError.message);
                      }
                 });
            } else if (isHomepage) {
                 // Ensure overlay is hidden on homepage even if time is up
                 hideOverlayOnTab(currentTab.id);
            }
        }
        updateBadge(); // Update badge to show 0:00 or relevant state
		return; // Stop further execution in this tick
	}

	// --- If timer is still running ---
	chrome.storage.local.set({ "timeLeft": timeLeft }, () => {
         if (chrome.runtime.lastError) console.warn("Error saving timeLeft:", chrome.runtime.lastError.message);
    });
    updateBadge(); // Update badge with current time

	// Send update message to popup if it's open
	if (popupOpen) {
        chrome.runtime.sendMessage({
            msg: "updateTime",
            time: timeLeft
        }, function(response) {
            if (chrome.runtime.lastError && chrome.runtime.lastError.message === "Could not establish connection. Receiving end does not exist.") {
               // Expected error when popup is not open, ignore silently.
            } else if (chrome.runtime.lastError) {
                console.warn("sendMessage error (updateTime):", chrome.runtime.lastError.message);
            }
        });
    }

	// No need to call checkReset every second
}

async function startTime() {
    // console.log("Attempting to start timer..."); // Debugging
    // Double-check all conditions before starting interval
    if (timer != null                      // Already running
        || timeLeft <= 0                   // No time left
        || noLimit                         // No limit today
        || !currentTab || !currentTab.id   // No valid current tab
        || !currentTab.url                 // No URL for current tab
        || !isYoutube(currentTab.url)      // Current tab isn't YouTube
        || isYoutubeHomepage(currentTab.url) // Current tab IS the homepage
        || (currentTab && tempOverrideTabs.includes(currentTab.id)) // Current tab is overridden
       ) {
        // console.log("Start timer condition(s) not met.");
        if (timer != null) { // If somehow timer was running, stop it
             stopTime();
        }
        return; // Do not start
    }

    // Final check: is it whitelisted? (await requires async)
    try {
         const isWhitelisted = await isChannelWhitelisted(currentTab.url);
         if (isWhitelisted) {
             // console.log("Start timer prevented: Whitelisted.");
             updateBadge(); // Ensure correct (whitelist) badge is shown
             return;
         }
    } catch (e) {
        console.error("Error checking whitelist in startTime:", e);
        return; // Don't start on error
    }


    // If all checks pass, start the timer
    // console.log("Starting timer", timeLeft);
    onYoutube = true; // Set flag *before* starting interval
    setTimerBadge(); // Show timer badge immediately
    timer = setInterval(updateTime, 1000);
}


function stopTime() { // Removed isDueToWhitelist parameter, badge updated via updateBadge()
    // console.log("Stopping timer", timeLeft);
    clearInterval(timer);
    timer = null;
    // Don't clear the badge here. updateBadge() will set the correct state
    // (e.g., show 0:00 if time is up, clear if not on YT, show override/whitelist).
    updateBadge();
}


function formatTime(totalSeconds) {
	var hours = Math.floor(totalSeconds / 3600);
	totalSeconds %= 3600;
	var minutes =  Math.floor(totalSeconds / 60);
	totalSeconds %= 60;
	var seconds =  Math.floor(totalSeconds);

	var result = "";
	if (hours > 0) {
		result += hours + ":";
		if (minutes < 10) result += "0";
		result += minutes;
	} else {
		result += minutes;
	}
	result += ":";
	if (seconds < 10) result += "0";
	result += seconds;
	return result;
}


// blockRedirect function is REMOVED


function checkReset() {
    // console.log("Checking reset..."); // Debugging
	chrome.storage.local.get({"lastDate":null, "resetTime":"00:00", "tempOverrideTabs": []}, function(data) {
        if (chrome.runtime.lastError) { console.error("Error getting storage for reset check:", chrome.runtime.lastError.message); return; }

		var today = new Date();
		var resetTimeParts = data.resetTime.split(":");
		var resetHour = parseInt(resetTimeParts[0], 10);
		var resetMinute = parseInt(resetTimeParts[1], 10);

		if (isNaN(resetHour) || isNaN(resetMinute)) {
		    resetHour = 0; resetMinute = 0;
		}

		// Determine the last reset date/time
		var lastReset = new Date();
		if (data.lastDate) {
		    let storedDay = parseInt(data.lastDate, 10);
            // Logic to correctly determine the actual last reset time based on stored date and reset hour/minute
             lastReset = new Date(); // Start with today
             lastReset.setDate(storedDay); // Set to the stored day
             lastReset.setHours(resetHour, resetMinute, 0, 0); // Set to the reset time on that day

             // If the stored date IS today, but the current time is BEFORE the reset time,
             // the last effective reset happened YESTERDAY at the reset time.
            let todayAtResetTime = new Date();
            todayAtResetTime.setHours(resetHour, resetMinute, 0, 0);

            if (today.getDate() === storedDay && today < todayAtResetTime) {
                 lastReset.setDate(lastReset.getDate() - 1);
             } else if (today.getDate() !== storedDay) {
                 // If stored date is not today, lastReset is already correctly set to that past day's reset time.
             } else {
                 // Stored date is today, and current time is AT or AFTER reset time. Last reset was today.
             }

		} else {
            // Assume last reset was long ago if no date stored
            lastReset.setDate(today.getDate() - 2);
            lastReset.setHours(resetHour, resetMinute, 0, 0);
		}

		// Determine the next reset time
        var nextReset = new Date();
        nextReset.setHours(resetHour, resetMinute, 0, 0);
        if (nextReset <= today) {
            nextReset.setDate(nextReset.getDate() + 1);
        }
         // console.log("Current Time:", today.toLocaleString());
         // console.log("Last Reset Time:", lastReset.toLocaleString());
         // console.log("Next Reset Time:", nextReset.toLocaleString());

        // --- Perform Reset if needed ---
		if (today >= nextReset && lastReset < nextReset) {
            console.log("Performing daily timer reset.");
			chrome.storage.local.get({"timeLimit":30, "customizeLimits":false, "dayLimits":{}, "overrideLimit":5}, function(limitsData) {
                if (chrome.runtime.lastError) { console.error("Error getting limits for reset:", chrome.runtime.lastError.message); return; }

				var timeLimit = limitsData.timeLimit;
				var dayLimits = limitsData.dayLimits;
                var customizeLimits = limitsData.customizeLimits;

				var noLimitTemp = false;
				if (customizeLimits) {
					var day = days[today.getDay()];
					if (day in dayLimits) {
						if (dayLimits[day] === false) noLimitTemp = true;
						else timeLimit = dayLimits[day];
					}
                    // If day not in dayLimits, timeLimit retains the general default
				}
				noLimit = noLimitTemp; // Update global flag

                let newTimeLeft = noLimit ? 0 : timeLimit * 60;
                timeLeft = newTimeLeft; // Update global variable
                override = false; // Reset override state
                tempOverrideTabs = []; // Clear temp override tabs

				chrome.storage.local.set({
					"lastDate": today.getDate().toString(),
					"override": false,
					"timeLeft": newTimeLeft,
					"savedVideoURLs": {}, // Clear saved URLs (no longer used for blocking)
					"tempOverrideTabs": [],
                    "currentOverrideCount": limitsData.overrideLimit // Reset override count
				}, function() {
				    if (chrome.runtime.lastError) { console.error("Error saving reset state:", chrome.runtime.lastError.message); return; }

                     // If timer was running, stop it now that time might be 0 or reset
                    if (timer != null) {
                         stopTime();
                    }
                    // If timer *should* be running now (e.g. reset from 0 to >0 while on YT), start it
                    checkWindowsForTimerStart();

                    // Update badge after reset
                    updateBadge();

                    // Inform popup/options about the reset state
                    chrome.runtime.sendMessage({ msg: "checkDone", noLimit: noLimit }, response => {
                         if (chrome.runtime.lastError && chrome.runtime.lastError.message !== "Could not establish connection. Receiving end does not exist.") {
                            console.warn("sendMessage error (checkDone):", chrome.runtime.lastError.message);
                         }
                    });
                     // Hide overlay on all tabs if reset happens
                     hideOverlayOnAllWindows();
				});

			});

		} else {
             // console.log("No reset needed.");
			// If no reset needed, still inform popup/options
            // No need to message 'checkDone' here, popup gets time updates directly
		}
	});
}


// Function to hide overlay on all relevant tabs (e.g., after reset)
function hideOverlayOnAllWindows() {
    chrome.tabs.query({ url: ["*://*.youtube.com/*", "*://*.youtubekids.com/*"] }, function(tabs) {
         if (chrome.runtime.lastError) { console.warn("Error querying tabs to hide overlay:", chrome.runtime.lastError.message); return; }
        tabs.forEach(tab => {
            if (tab.id) {
                 chrome.tabs.sendMessage(tab.id, { msg: "hideOverlay" }, (response) => {
                      if (chrome.runtime.lastError && chrome.runtime.lastError.message !== "Could not establish connection. Receiving end does not exist.") {
                            console.warn("Could not send hideOverlay message to tab:", tab.id, chrome.runtime.lastError.message);
                      }
                 });
            }
        });
    });
}


// checkOverride function is REMOVED (logic moved partially into checkTabForYouTube)


function urlNoTime(url) {
    if (!url) return null;
	let arr = url.split("&t=");
	return arr.length >= 1 ? arr[0] : url;
}

// Modify checkTabForYouTube to implement the new overlay logic
async function checkTabForYouTube(url) {
    // console.log("Checking tab:", url); // Debugging
    if (!currentTab || !currentTab.id) {
         clearBadge();
         if (onYoutube) { onYoutube = false; stopTime(); }
        return;
    }
    if (!url) {
        clearBadge();
         if (currentTab && onYoutube) { onYoutube = false; stopTime(); }
        return;
    }

    const isCurrentlyYoutube = isYoutube(url);
    const isHomepage = isYoutubeHomepage(url);
    let isWhitelisted = false;
    let isOverridden = tempOverrideTabs.includes(currentTab.id);

    if (isCurrentlyYoutube) {
        try {
            isWhitelisted = await isChannelWhitelisted(url);
        } catch (e) { console.error("Error checking whitelist:", e); isWhitelisted = false; }
    }

    // --- Determine Action ---
    if (isCurrentlyYoutube) {
        if (isWhitelisted) {
            // --- Whitelisted Page ---
            setWhitelistBadge();
            if (onYoutube) { onYoutube = false; stopTime(); }
            hideOverlayOnTab(currentTab.id);
        } else if (noLimit) {
            // --- No Limit Today ---
            chrome.action.setBadgeText({ "text": "∞" });
            chrome.action.setBadgeBackgroundColor({ color: "#6c757d" });
            if (onYoutube) { onYoutube = false; stopTime(); }
            hideOverlayOnTab(currentTab.id);
        } else if (timeLeft <= 0 && !isOverridden) {
             // --- Time is up, Not Whitelisted, Not Overridden ---
             setTimerBadge(); // Show 0:00
             if (onYoutube) { onYoutube = false; stopTime(); } // Stop timer interval if running

             if (!isHomepage) { // Show overlay only if NOT homepage
                 chrome.tabs.sendMessage(currentTab.id, { msg: "showOverlay" }, response => { /* Error handling */ });
             } else {
                 hideOverlayOnTab(currentTab.id); // Ensure hidden on homepage
             }
        } else if (isOverridden) {
            // --- Time might be up, but Tab is Overridden ---
             setOverrideBadge();
             if (onYoutube) { onYoutube = false; stopTime(); } // Stop timer if overridden
             hideOverlayOnTab(currentTab.id);
        } else if (isHomepage) {
            // --- On Homepage with Time Left (Not whitelisted/overridden/noLimit) ---
             if (onYoutube) { // If timer was running for another YT page, stop it
                 onYoutube = false;
                 stopTime();
             }
             setTimerBadge(); // Show remaining time, but timer is stopped
             hideOverlayOnTab(currentTab.id); // Ensure overlay hidden

        } else {
            // --- On other YT page with Time Left (Not homepage/whitelisted/overridden/noLimit) ---
            setTimerBadge(); // Show current time left
             if (!onYoutube) { // If timer isn't running, try to start it (respecting focus)
                 if (!pauseOutOfFocus) {
                     startTime(); // Will re-check conditions inside
                 } else {
                     // Check focus before starting
                     chrome.windows.getLastFocused({ populate: false }, function(window) {
                         if (window && window.focused && window.id === currentTab.windowId) {
                             startTime(); // Will re-check conditions inside
                         }
                     });
                 }
             }
             hideOverlayOnTab(currentTab.id); // Ensure overlay hidden
        }
    } else {
        // --- Not on YouTube Page ---
        clearBadge();
        if (onYoutube) {
            if (pauseOutOfFocus || popupOpen) {
                onYoutube = false; stopTime();
            } else {
                checkWindowsForTimerStop(); // Check if other tabs require timer
            }
        }
        if (isOverridden) { // Clean up override if leaving YT
             const index = tempOverrideTabs.indexOf(currentTab.id);
             if (index !== -1) {
                 tempOverrideTabs.splice(index, 1);
                 chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
             }
        }
    }

    // Final state correction
    if (timer == null && onYoutube) onYoutube = false;

} // End checkTabForYouTube

// Function remains largely the same, now used by background script only
async function isChannelWhitelisted(tabUrl) {
    // console.log("Checking whitelist for:", tabUrl); // Debugging
    if (!tabUrl || !whitelistedHandles || whitelistedHandles.length === 0) {
        return false; // No URL or no whitelist entries
    }

    // 1. Check direct URL for /@handle (works for channel pages)
    const handleFromUrl = getHandleFromUrl(tabUrl);
    if (handleFromUrl && whitelistedHandles.includes(handleFromUrl)) {
        // console.log(`Handle ${handleFromUrl} from URL is whitelisted.`);
        return true;
    }

    // 2. If it's a video page, ask the content script for the handle
    // Ensure currentTab is valid and matches the URL being checked
    if (isYoutubeVideo(tabUrl) && currentTab && currentTab.id && currentTab.url === tabUrl) {
        try {
            // console.log("Asking content script for handle for tab:", currentTab.id); // Debugging
            // Send message to get the handle from the page content
            const response = await chrome.tabs.sendMessage(currentTab.id, { msg: "getChannelHandleFromPage" });

            if (response && response.channelHandle) {
                // console.log("Received handle from content script:", response.channelHandle); // Debugging
                if (whitelistedHandles.includes(response.channelHandle)) {
                    // console.log(`Handle ${response.channelHandle} from video page content script is whitelisted.`);
                    return true;
                } else {
                     // console.log(`Handle ${response.channelHandle} from video page not in whitelist.`); // Debugging
                }
            } else {
                // console.log("Content script did not return a handle."); // Debugging
            }
        } catch (e) {
             // Ignore common errors when content script isn't ready or doesn't respond
             if (!e.message.includes("Could not establish connection") && !e.message.includes("Receiving end does not exist") && !e.message.includes("message port closed before a response")) {
                console.warn("Error messaging content script for channel handle:", e);
             } else {
                 // console.log("Content script not available or ready for handle check."); // Debugging
             }
             // Proceed without handle from content script if messaging fails
        }
    } else {
        // console.log("Not a video page or currentTab mismatch, skipping content script check."); // Debugging
    }

    // 3. If no match found yet
    // console.log("URL/Handle not found in whitelist:", tabUrl);
    return false;
}

// Check ALL active tabs across normal windows to see if timer should START
async function checkWindowsForTimerStart() {
    // console.log("checkWindowsForTimerStart called");
    // Conditions where timer should absolutely not run
    if (timer != null || noLimit || timeLeft <= 0) return;

    chrome.tabs.query({ active: true, windowType: "normal" }, async function(tabs) {
        if (chrome.runtime.lastError) { console.error("Error querying tabs for timer start:", chrome.runtime.lastError.message); return; }

        let nonWhitelistedYoutubeOpen = false;
        let activeTabIsEligible = false; // Track if the *current* active tab should have timer

        for (let tab of tabs) {
            if (tab && tab.url && isYoutube(tab.url) && !isYoutubeHomepage(tab.url)) { // <<<--- Added !isYoutubeHomepage
                let isTabOverridden = tempOverrideTabs.includes(tab.id);
                if (isTabOverridden) continue;

                const isWhitelisted = await isChannelWhitelisted(tab.url);
                if (!isWhitelisted) {
                    nonWhitelistedYoutubeOpen = true;
                    if (currentTab && currentTab.id === tab.id) {
                        activeTabIsEligible = true;
                    }
                    if (!pauseOutOfFocus) break; // Found one, enough to start if focus doesn't matter
                }
            }
        }

         // Start timer logic
         if (nonWhitelistedYoutubeOpen) {
              if (!pauseOutOfFocus) {
                  if (!onYoutube) startTime(); // startTime re-checks conditions
              } else {
                  if (activeTabIsEligible && !onYoutube) {
                       startTime(); // startTime re-checks conditions
                  } else if (!activeTabIsEligible && onYoutube) {
                       // Stop if current tab is no longer eligible (e.g., switched to homepage/whitelisted)
                       onYoutube = false;
                       stopTime();
                  }
              }
         } else if (onYoutube) {
              // Stop if no eligible tabs found but timer is running
              onYoutube = false;
              stopTime();
         }
    });
}


// Check ALL active tabs across normal windows to see if timer should STOP (only if pauseOutOfFocus is false)
async function checkWindowsForTimerStop() {
    // console.log("checkWindowsForTimerStop called");
    if (pauseOutOfFocus || timer == null) return; // Only run if pause on focus loss is OFF and timer is running

	chrome.tabs.query({ active: true, windowType: "normal" }, async function(tabs) {
        if (chrome.runtime.lastError) { console.error("Error querying tabs for timer stop:", chrome.runtime.lastError.message); return; }

		let nonWhitelistedYoutubeOpen = false;
		for (let tab of tabs) {
			if (tab && tab.url && isYoutube(tab.url) && !isYoutubeHomepage(tab.url)) { // <<<--- Added !isYoutubeHomepage
                let isTabOverridden = tempOverrideTabs.includes(tab.id);
                if (isTabOverridden) continue;

                const isWhitelisted = await isChannelWhitelisted(tab.url);
                 if (!isWhitelisted) {
				    nonWhitelistedYoutubeOpen = true;
				    break; // Found one, timer should continue
                 }
			}
		}
		if (!nonWhitelistedYoutubeOpen && onYoutube) { // Stop only if timer is running AND no active non-homepage/non-whitelisted/non-overridden YT tabs found
			onYoutube = false;
			stopTime();
		}
	});
}