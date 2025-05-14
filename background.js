chrome.runtime.onInstalled.addListener(function (object) {
	if (object.reason === chrome.runtime.OnInstalledReason.INSTALL) {
		chrome.tabs.create({url: "/pages/options.html"});
	}
});

// Default values
var override = false;
var onYoutubeVideoPage = false; // Renamed for clarity
var timeLeft = 1800;
var currentTab = null;
var popupOpen = false;
var pauseOutOfFocus = true;
var youtubekidsEnabled = true;
var checkBrowserFocusTimer = null;
var timer = null;
var noLimit = false;
var whitelistedHandles = [];
var tempOverrideTabs = [];
var resetCheckAlarmName = "youtubeTimeResetCheck";

checkReset();

var days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
// Updates noLimit variable based on initial storage check
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
            whitelistedHandles = [];
        } else {
            whitelistedHandles = (data.whitelistedHandles || []).map(handle => {
                try {
                    return decodeURIComponent(handle);
                } catch (e) {
                    console.warn("Failed to decode handle from storage:", handle);
                    return handle;
                }
            });
            // console.log("Whitelist cache updated:", whitelistedHandles); // Debugging
        }
    });
}


// Initial load and listener for whitelist changes
updateWhitelistCache();
chrome.storage.onChanged.addListener(function(changes, namespace) {
	if (namespace === 'local') {
        if (changes.whitelistedHandles) {
            updateWhitelistCache();
        }
        if (changes.timeLeft) {
            timeLeft = changes.timeLeft.newValue;
            // console.log("Background timeLeft updated from storage:", timeLeft); // Debugging
             if (onYoutubeVideoPage || timeLeft <= 0) { // Use new flag name
                 updateBadge();
             }
        }
        if (changes.override) {
            override = changes.override.newValue;
            if (currentTab && currentTab.url && isYoutube(currentTab.url)) { // Still check if on YouTube domain broadly
                 checkTabStatus(currentTab.url); // Renamed check function
            }
            // console.log("Background override updated from storage:", override); // Debugging
        }
        if (changes.tempOverrideTabs) {
            tempOverrideTabs = changes.tempOverrideTabs.newValue || [];
            // console.log("Background tempOverrideTabs updated from storage:", tempOverrideTabs); // Debugging
        }
        if (changes.noLimit) {
             noLimit = changes.noLimit.newValue;
        }
        if (changes.pauseOutOfFocus) {
            pauseOutOfFocus = changes.pauseOutOfFocus.newValue;
             if (pauseOutOfFocus && checkBrowserFocusTimer == null) {
                 checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);
             } else if (!pauseOutOfFocus && checkBrowserFocusTimer != null) {
                 clearInterval(checkBrowserFocusTimer);
                 checkBrowserFocusTimer = null;
                 checkWindowsForTimerStart();
             }
        }
         if (changes.youtubekidsEnabled) {
            youtubekidsEnabled = changes.youtubekidsEnabled.newValue;
             if (currentTab && currentTab.url) checkTabStatus(currentTab.url); // Use new check function
             else checkWindowsForTimerStart();
        }
	}
});


chrome.storage.local.get({
    "override":override,
    "pauseOutOfFocus":pauseOutOfFocus,
    "youtubekidsEnabled":youtubekidsEnabled,
    "timeLeft":timeLeft,
    "tempOverrideTabs": []
}, function(data) {
	override = data.override;
	pauseOutOfFocus = data.pauseOutOfFocus;
	youtubekidsEnabled = data.youtubekidsEnabled;
    tempOverrideTabs = data.tempOverrideTabs || [];

	if (pauseOutOfFocus) {
		checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);
	}

	if (!Number.isNaN(data.timeLeft))
		timeLeft = data.timeLeft;
	else {
		chrome.storage.local.get({"timeLimit":30}, function(data) {
			timeLeft = data.timeLimit*60;
            chrome.storage.local.set({"timeLeft": timeLeft});
		});
	}
     updateBadge();
});

chrome.tabs.onActivated.addListener(function(activeInfo) {
	checkReset();
	chrome.tabs.get(activeInfo.tabId, function(tab){
	    if (chrome.runtime.lastError) { console.warn(chrome.runtime.lastError.message); return; }
        if (tab) {
		    currentTab = tab;
		    checkTabStatus(tab.url); // Use new check function
        } else {
            currentTab = null;
            onYoutubeVideoPage = false; // Use new flag name
            stopTime();
        }
	});
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
	checkReset();
	if(tab.active && changeInfo.url){ // Check status if URL changed on active tab
		currentTab = tab;
		checkTabStatus(changeInfo.url); // Use new check function
	}
    // Also check if status becomes 'complete' for the active tab, even if URL didn't change (e.g., SPA navigation)
    else if (tab.active && changeInfo.status === 'complete' && currentTab && currentTab.id === tabId) {
        currentTab = tab;
        checkTabStatus(tab.url); // Use new check function
    }
});


chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
    var index = tempOverrideTabs.indexOf(tabId);
    if (index !== -1) {
        tempOverrideTabs.splice(index, 1);
        chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
        // console.log("Removed closed tab", tabId, "from tempOverrideTabs"); // Debugging
    }

    if (currentTab && currentTab.id === tabId) {
        currentTab = null;
        if (!pauseOutOfFocus) {
            // Check if any *other* active video tabs require the timer
            checkWindowsForTimerStop();
        } else if (onYoutubeVideoPage) { // Use new flag name
             // If the closed tab was the one running the timer (and focus matters)
             onYoutubeVideoPage = false;
             stopTime();
        }
    }
});

function getHandleFromUrl(tabUrl) {
    if (!tabUrl) return null;
    try {
        const urlObj = new URL(tabUrl);
        const pathParts = urlObj.pathname.split('/');

        if (pathParts.length > 1 && pathParts[1].startsWith('@')) {
            let handlePart = pathParts[1];
            let decodedHandlePart = handlePart;

            try {
                decodedHandlePart = decodeURIComponent(handlePart);
            } catch (e) {
                 console.warn("Could not decode handle part from URL:", handlePart, e);
            }

            if (/^@[^\/\s]+$/.test(decodedHandlePart)) {
                 return decodedHandlePart;
            }
        }
    } catch (e) {
        console.warn("Error parsing URL in getHandleFromUrl:", tabUrl, e);
    }
    return null;
}

function checkBrowserFocus(){
    if (pauseOutOfFocus) {
        chrome.windows.getLastFocused({ populate: false }, function(window) {
             if (chrome.runtime.lastError) { console.warn("Error getting focused window:", chrome.runtime.lastError.message); return; }

            if (window && window.focused) {
                chrome.tabs.query({ active: true, windowId: window.id }, function(tabs) {
                     if (chrome.runtime.lastError) { console.warn("Error querying active tab:", chrome.runtime.lastError.message); return; }
                    if (tabs && tabs[0]) {
                         // Update current tab and check its status if it changed
                         if (!currentTab || currentTab.id !== tabs[0].id || (tabs[0].url && (!currentTab.url || currentTab.url !== tabs[0].url))) {
                            currentTab = tabs[0];
                            checkTabStatus(currentTab.url); // Use new check function
                        } else if (!onYoutubeVideoPage && currentTab && currentTab.url && isYoutubeVideo(currentTab.url)) { // Use new flag and video check
                             // If browser focused and on a YT video page but timer isn't running, re-check status
                             checkTabStatus(currentTab.url);
                        }
                    } else {
                         // No active tab found in focused window? Stop timer.
                         if (onYoutubeVideoPage) { // Use new flag name
                             onYoutubeVideoPage = false;
                             stopTime();
                         }
                         currentTab = null;
                    }
                });
            } else {
                // Browser lost focus
                if (onYoutubeVideoPage && !popupOpen) { // Use new flag name
                    onYoutubeVideoPage = false;
                    stopTime();
                }
            }
        });
    }
}


chrome.windows.onFocusChanged.addListener(function(windowId) {
	checkReset();

	if (pauseOutOfFocus) {
		if(windowId == chrome.windows.WINDOW_ID_NONE) {
            // Lost focus
            if (onYoutubeVideoPage && !popupOpen) { // Use new flag name
			    onYoutubeVideoPage = false;
			    stopTime();
            }
		} else {
            // Gained focus - check active tab in the newly focused window
            chrome.tabs.query({ active: true, windowId: windowId }, function(tabs) {
                if (chrome.runtime.lastError) { console.warn("Error querying focused window tab:", chrome.runtime.lastError.message); return; }
                if (tabs && tabs[0]) {
                    currentTab = tabs[0];
                    checkTabStatus(currentTab.url); // Use new check function
                } else {
                    // No active tab? Stop timer.
                    if(onYoutubeVideoPage) { // Use new flag name
                        onYoutubeVideoPage = false;
                        stopTime();
                    }
                    currentTab = null;
                }
            });
		}
	} else {
         // If pauseOutOfFocus is OFF, timer runs if *any* active YT video tab exists
         checkWindowsForTimerStart();
    }
});

// --- Message Handling ---
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // console.log("Background received message:", request.msg); // Debugging
	switch(request.msg) {
        case "updateTimeLeftNow":
            if (typeof request.newTime === 'number' && !isNaN(request.newTime)) {
                // console.log("Received direct timeLeft update:", request.newTime); // Debugging
                timeLeft = Math.max(0, request.newTime);
                if (timeLeft > 0) {
                     if (currentTab && currentTab.id) {
                          hideOverlayOnTab(currentTab.id);
                     }
                     checkWindowsForTimerStart();
                } else {
                     if (timer != null) {
                         stopTime();
                     }
                     if (currentTab && currentTab.url) {
                         checkTabStatus(currentTab.url);
                     }
                }
                 updateBadge();
                 sendResponse({status: "TimeLeft updated directly"});
            } else {
                 console.warn("Invalid newTime received in updateTimeLeftNow:", request.newTime);
                 sendResponse({status: "Invalid time value received"});
            }
            return true;

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
            // If timer wasn't running due to focus loss, start it now if conditions met
            checkWindowsForTimerStart();
            sendResponse({status: "Popup noted as open"});
			break;
		case "popupUnfocus":
			popupOpen = false;
            // Re-check focus immediately when popup closes if focus pausing is on
            if (pauseOutOfFocus) checkBrowserFocus();
             sendResponse({status: "Popup noted as closed"});
			break;
		case "checkPageStatus": // Content script asks if it should show overlay
			if (sender.tab && sender.tab.url && sender.tab.id) {
					const url = sender.tab.url;
					const tabId = sender.tab.id;
                    // Overlay should only show on VIDEO pages when time is up
                    const isVideoPage = isYoutubeVideo(url);

					isChannelWhitelisted(url, tabId).then(isWhitelisted => {
						const isOverridden = tempOverrideTabs.includes(tabId);
						// Determine if overlay should be shown
                        // Show overlay if: Time is up, AND on a VIDEO page, AND not overriding, AND not no limit, AND NOT whitelisted
						const shouldOverlay = timeLeft <= 0 && isVideoPage && !override && !noLimit && !isWhitelisted && !isOverridden;
						sendResponse({ shouldOverlay: shouldOverlay });
					}).catch(error => {
						console.error("Error checking whitelist status for overlay:", error);
						sendResponse({ shouldOverlay: false });
					});
					return true; // Indicate async response
			} else {
					console.warn("checkPageStatus request missing tab info.");
					sendResponse({ shouldOverlay: false });
			}
			break; // Break needed here

        // Options page messages (no changes needed here)
        case "pauseOutOfFocus":
             pauseOutOfFocus = request.val;
             if (pauseOutOfFocus && checkBrowserFocusTimer == null) {
                 checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);
             } else if (!pauseOutOfFocus && checkBrowserFocusTimer != null) {
                 clearInterval(checkBrowserFocusTimer);
                 checkBrowserFocusTimer = null;
                 checkWindowsForTimerStart();
             }
             sendResponse({status: "Pause setting updated"});
             break;
        case "youtubekidsEnabled":
            youtubekidsEnabled = request.val;
            if (currentTab && currentTab.url) checkTabStatus(currentTab.url);
            else checkWindowsForTimerStart();
            sendResponse({status: "YouTube Kids setting updated"});
            break;
        case "resetTimeUpdated":
             sendResponse({status: "Reset time change noted"});
            break;
         case "noLimitInputChange":
            var todayDate = new Date();
			var dayName = days[todayDate.getDay()];
            if (request.day == dayName) {
                 noLimit = true;
                 if (timer != null) stopTime();
                 updateBadge();
                 hideOverlayOnAllWindows();
            }
             sendResponse({status: "No limit change processed"});
            break;
        case "dayTimeLimitUpdated":
            var todayDateLimit = new Date();
			var dayNameLimit = days[todayDateLimit.getDay()];
            if (request.day == dayNameLimit) {
                noLimit = false;
                checkWindowsForTimerStart();
                updateBadge();
                 hideOverlayOnAllWindows();
            }
            sendResponse({status: "Day time limit change noted"});
            break;
        case "customizeLimitsFalse":
            noLimit = false;
            checkWindowsForTimerStart();
             updateBadge();
             hideOverlayOnAllWindows();
            sendResponse({status: "Customize limits disabled processed"});
            break;

        default:
            // console.log("Background received unknown message:", request.msg); // Debugging
            sendResponse({status: "Unknown message type"});
            break;
	}
     return false;
});


// --- Helper to hide overlay on a specific tab ---
function hideOverlayOnTab(tabId) {
     if (tabId) {
          chrome.tabs.sendMessage(tabId, { msg: "hideOverlay" }, (response) => {
               if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
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
        const isYouTubeDomain = /^(www\.)?youtube(kids)?\.com$/.test(parsedUrl.hostname);
        const isBasePath = parsedUrl.pathname === '/' || parsedUrl.pathname === '';
        return isYouTubeDomain && isBasePath;
    } catch (e) {
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
                 return;
            }
        } else {
            canOverride = true;
        }

        if (canOverride) {
            override = true;
             tempOverrideTabs.push(tabId);

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
                     currentTab = senderTab;
                     checkTabStatus(senderTab.url); // Use new check function
                 }
            });
        }
    });
}


// Checks if URL is any YouTube page (broad check)
function isYoutube(url) {
    if (!url) return false;
	if (youtubekidsEnabled)
		return /https?:\/\/(?!music\.)(.+?\.)?youtube(kids)?\.com(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
	return /https?:\/\/(?!music\.)(.+?\.)?youtube\.com(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
}

// Checks if URL is a YouTube video page specifically
function isYoutubeVideo(url) {
    if (!url) return false;
	if (youtubekidsEnabled)
		return /https?:\/\/(?!music\.)(.+?\.)?youtube(kids)?\.com\/watch([A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
	return /https?:\/\/(?!music\.)(.+?\.)?youtube\.com\/watch([A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
}

// --- Badge Functions ---
function setWhitelistBadge() {
    chrome.action.setBadgeText({ "text": "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#28a745" }); // Green
}

function setOverrideBadge() {
    chrome.action.setBadgeText({ "text": "!" });
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
// Modified to reflect timer only runs on video pages
function updateBadge() {
    if (!currentTab || !currentTab.url || !currentTab.id) {
         clearBadge();
         return;
    }

    isChannelWhitelisted(currentTab.url, currentTab.id).then(isWhitelisted => {
        // Check if we are on *any* YouTube page first for context
        if (isYoutube(currentTab.url)) {
            const isOverridden = tempOverrideTabs.includes(currentTab.id);
            const isVideo = isYoutubeVideo(currentTab.url);

            if (isWhitelisted) {
                setWhitelistBadge(); // Show whitelist badge regardless of page type
            } else if (noLimit) {
                 chrome.action.setBadgeText({ "text": "∞" }); // Show no limit badge
                 chrome.action.setBadgeBackgroundColor({ color: "#6c757d" });
            } else if (isOverridden) {
                setOverrideBadge(); // Show override badge
            } else if (isVideo && onYoutubeVideoPage) { // Use new flag
                 setTimerBadge(); // Show running timer only on video pages
            } else if (timeLeft <= 0) {
                 // Show 0:00 if time is up (even on non-video pages, consistent with blocking)
                 setTimerBadge();
            } else {
                 // On YouTube but not a running video page (e.g., channel, homepage)
                 // Or timer paused due to focus loss
                 // Show remaining time, but maybe grey? Let's keep it red for simplicity.
                 setTimerBadge();
                 // Or clear badge completely if not on a video page and time > 0?
                 // clearBadge(); // Alternative: clear if not actively timing
            }
        } else {
            // Not on YouTube domain
            clearBadge();
        }
    }).catch(error => {
        console.error("Error updating badge:", error);
        clearBadge();
    });
}


// --- Timer Update Function ---
// Modified to check conditions before showing overlay
async function updateTime() {
	if (timeLeft > 0) {
		timeLeft--;
	} else {
		// --- Time is up ---
		timeLeft = 0;
        stopTime(); // Stop the interval timer itself

        // Check if overlay needs showing on the *current* tab
         if (currentTab && currentTab.id && currentTab.url && isYoutubeVideo(currentTab.url)) { // *** Check if VIDEO page ***
            const isWhitelisted = await isChannelWhitelisted(currentTab.url, currentTab.id);
            const isOverridden = tempOverrideTabs.includes(currentTab.id);

             // Show overlay only if on a VIDEO page AND conditions met
            if (!isWhitelisted && !noLimit && !isOverridden) {
                 chrome.tabs.sendMessage(currentTab.id, { msg: "showOverlay" }, (response) => {
                      if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                           console.warn("Could not send showOverlay message to tab:", currentTab.id, chrome.runtime.lastError.message);
                      }
                 });
            } else {
                 // Ensure overlay is hidden if whitelisted/overridden even if time is up
                 hideOverlayOnTab(currentTab.id);
            }
        } else if (currentTab && currentTab.id) {
             // If time is up but not on a video page, ensure overlay is hidden
             hideOverlayOnTab(currentTab.id);
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
            if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
               // Expected error, ignore silently.
            } else if (chrome.runtime.lastError) {
                console.warn("sendMessage error (updateTime):", chrome.runtime.lastError.message);
            }
        });
    }
}

// --- Start Timer Function ---
// Modified to only start if on a video page
async function startTime() {
    // console.log("Attempting to start timer..."); // Debugging

    // Check basic conditions first
    if (timer != null                      // Already running
        || timeLeft <= 0                   // No time left
        || noLimit                         // No limit today
        || !currentTab || !currentTab.id   // No valid current tab
        || !currentTab.url                 // No URL for current tab
        || (currentTab && tempOverrideTabs.includes(currentTab.id)) // Current tab is overridden
       ) {
        // console.log("Start timer condition(s) not met (basic)."); // Debugging
        if (timer != null) { stopTime(); } // Ensure stopped if conditions fail
        updateBadge();
        return;
    }

    // *** ADDED CHECK: Only proceed if it's a video page ***
    if (!isYoutubeVideo(currentTab.url)) {
        // console.log("Start timer condition not met: Not a video page."); // Debugging
        if (timer != null) { stopTime(); } // Ensure stopped if not on video page
        updateBadge();
        return;
    }

    // Check whitelist status (async)
    try {
         const isWhitelisted = await isChannelWhitelisted(currentTab.url, currentTab.id);
         if (isWhitelisted) {
             // console.log("Start timer prevented: Whitelisted."); // Debugging
             updateBadge();
             return;
         }
    } catch (e) {
        console.error("Error checking whitelist in startTime:", e);
        updateBadge();
        return; // Don't start on error
    }


    // If all checks pass (including being a video page), start the timer
    // console.log("Starting timer", timeLeft); // Debugging
    onYoutubeVideoPage = true; // Use new flag name
    setTimerBadge();
    timer = setInterval(updateTime, 1000);
}


// --- Stop Timer Function ---
// No change needed, but uses new flag name in logging/comments
function stopTime() {
    // console.log("Stopping timer", timeLeft); // Debugging
    clearInterval(timer);
    timer = null;
    // Badge is updated by the calling function (e.g., checkTabStatus, updateTime)
    // onYoutubeVideoPage flag is managed by the calling function
    updateBadge(); // Ensure badge reflects stopped state appropriately
}


// --- Format Time Function ---
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

// --- Reset Functions ---
function checkReset() {
    // console.log("Checking reset..."); // Debugging
    chrome.storage.local.get({
        "lastResetTimestamp": null,
        "resetTime": "00:00",
        "timeLimit": 30, // Ensure these are included if used within this scope
        "customizeLimits": false,
        "dayLimits": {},
        "overrideLimit": 5,
        "limitOverrides": true
        // tempOverrideTabs is handled correctly elsewhere, not needed for this part of get
    }, function(data) {
        if (chrome.runtime.lastError) {
            console.error("Error getting storage for reset check:", chrome.runtime.lastError.message);
            return;
        }

        var now = new Date();
        var nowTimestamp = now.getTime();
        var lastResetTimestampFromStorage = data.lastResetTimestamp || 0; // Use stored value, default to 0

        var resetTimeParts = data.resetTime.split(":");
        var resetHour = parseInt(resetTimeParts[0], 10);
        var resetMinute = parseInt(resetTimeParts[1], 10);

        if (isNaN(resetHour) || isNaN(resetMinute)) {
            console.warn("Invalid reset time format, defaulting to 00:00");
            resetHour = 0;
            resetMinute = 0;
        }

        // Determine the target reset point for the current day.
        // This is the timestamp for which a reset might be due.
        var targetResetForToday_DateObj = new Date(now); // Use current date as base
        targetResetForToday_DateObj.setHours(resetHour, resetMinute, 0, 0);
        var targetResetForToday_Timestamp = targetResetForToday_DateObj.getTime();

        // Condition for reset:
        // 1. Current time (nowTimestamp) must be at or after today's target reset time (targetResetForToday_Timestamp).
        // 2. The last recorded reset (lastResetTimestampFromStorage) must be *before* today's target reset time.
        //    This ensures the reset for 'targetResetForToday_Timestamp' happens only once.
        if (nowTimestamp >= targetResetForToday_Timestamp && lastResetTimestampFromStorage < targetResetForToday_Timestamp) {
            console.log("Performing daily timer reset. This reset is for the period ending at:", targetResetForToday_DateObj.toLocaleString());

            // Fetch limits (as they might have changed)
            // Note: data from the initial .get() already contains these, but re-fetching or using them directly is fine.
            // For simplicity, we'll use the 'data' object passed into this callback.
            var timeLimit = data.timeLimit;
            var dayLimits = data.dayLimits;
            var customizeLimits = data.customizeLimits;

            // Determine limits for the day of *this* reset
            var dayOfThisReset = new Date(targetResetForToday_Timestamp); // Use the timestamp of the reset being processed
            var dayName = days[dayOfThisReset.getDay()]; // 'days' array should be globally defined

            var noLimitTemp = false;
            if (customizeLimits) {
                if (dayName in dayLimits) {
                    if (dayLimits[dayName] === false) { // 'false' means no limit
                        noLimitTemp = true;
                    } else {
                        timeLimit = dayLimits[dayName]; // Use day-specific time limit
                    }
                }
                // If dayName is not in dayLimits, the general timeLimit (already fetched) will be used.
            }
            noLimit = noLimitTemp; // Update the global 'noLimit' flag

            let newTimeLeft = noLimit ? 0 : timeLimit * 60; // If noLimit, timeLeft becomes 0 (timer won't run due to noLimit flag)
            timeLeft = newTimeLeft; // Update global 'timeLeft'
            override = false;       // Reset override status
            tempOverrideTabs = [];  // Clear temporary override tabs

            const resetStorage = {
                "lastResetTimestamp": targetResetForToday_Timestamp, // KEY CHANGE: Store the timestamp of the reset we just performed
                "override": false,
                "timeLeft": newTimeLeft,
                "tempOverrideTabs": []
            };

            if (data.limitOverrides) {
                resetStorage.currentOverrideCount = data.overrideLimit;
            } else {
                // If overrides are not limited, ensure currentOverrideCount is removed from storage
                chrome.storage.local.remove("currentOverrideCount");
            }

            chrome.storage.local.set(resetStorage, function() {
                if (chrome.runtime.lastError) {
                    console.error("Error saving reset state:", chrome.runtime.lastError.message);
                    return;
                }

                if (timer != null) {
                    stopTime(); // stopTime() should also call updateBadge()
                } else {
                    updateBadge();
                }
                // Check if timer should start based on current tab status *after* reset
                checkWindowsForTimerStart(); // This will consider the new 'noLimit' and 'timeLeft'

                chrome.runtime.sendMessage({ msg: "checkDone", noLimit: noLimit }, response => {
                    if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                        console.warn("sendMessage error (checkDone):", chrome.runtime.lastError.message);
                    }
                });
                hideOverlayOnAllWindows();
                console.log("Timer reset complete. TimeLeft:", newTimeLeft, "NoLimit:", noLimit);
            });
        } else {
            // console.log("No reset needed. Now:", now.toLocaleString(),
            //             "Target Reset Today:", targetResetForToday_DateObj.toLocaleString(),
            //             "Last Reset:", new Date(lastResetTimestampFromStorage).toLocaleString());
        }
    });
}

function setupResetCheckAlarm() {
    chrome.alarms.get(resetCheckAlarmName, function(alarm) {
        if (!alarm) {
            chrome.alarms.create(resetCheckAlarmName, { periodInMinutes: 5 });
            console.log("Reset check alarm created (runs every 5 min).");
        }
    });
}

chrome.alarms.onAlarm.addListener(function(alarm) {
    if (alarm.name === resetCheckAlarmName) {
        // console.log("Reset check alarm triggered."); // Debugging
        checkReset();
    }
});

function hideOverlayOnAllWindows() {
    chrome.tabs.query({ url: ["*://*.youtube.com/*", "*://*.youtubekids.com/*"] }, function(tabs) {
         if (chrome.runtime.lastError) { console.warn("Error querying tabs to hide overlay:", chrome.runtime.lastError.message); return; }
        tabs.forEach(tab => {
            if (tab.id) {
                 hideOverlayOnTab(tab.id);
            }
        });
    });
}

function urlNoTime(url) { // Keep this helper if used elsewhere
    if (!url) return null;
	let arr = url.split("&t=");
	return arr.length >= 1 ? arr[0] : url;
}

// *** RENAMED checkTabForYouTube to checkTabStatus for clarity ***
// Main logic controller based on current tab's URL and state
async function checkTabStatus(url) {
    // console.log("Checking tab status:", url); // Debugging
    if (!currentTab || !currentTab.id) {
         // console.log("checkTabStatus: No current tab or ID."); // Debugging
         clearBadge();
         if (onYoutubeVideoPage) { onYoutubeVideoPage = false; stopTime(); }
        return;
    }
    if (!url) {
        // console.log("checkTabStatus: No URL provided."); // Debugging
        clearBadge();
         if (onYoutubeVideoPage) { onYoutubeVideoPage = false; stopTime(); }
        return;
    }

    const tabId = currentTab.id;
    const isCurrentlyYoutube = isYoutube(url); // Still useful to know if on YT domain
    const isVideoPage = isYoutubeVideo(url); // *** Key check for timer ***
    let isWhitelisted = false;
    let isOverridden = tempOverrideTabs.includes(tabId);

    // Perform whitelist check only if it's a YouTube URL
    if (isCurrentlyYoutube) {
        try {
            isWhitelisted = await isChannelWhitelisted(url, tabId);
        } catch (e) {
            console.error("Error checking whitelist in checkTabStatus:", e);
            isWhitelisted = false;
        }
    }

    // --- Determine Action based on state ---
    if (isCurrentlyYoutube) {
        if (isWhitelisted) {
            // --- Whitelisted Page (Video or Channel) ---
            if (onYoutubeVideoPage) { onYoutubeVideoPage = false; stopTime(); }
            hideOverlayOnTab(tabId); // Ensure no overlay
        } else if (noLimit) {
            // --- No Limit Today ---
            if (onYoutubeVideoPage) { onYoutubeVideoPage = false; stopTime(); }
            hideOverlayOnTab(tabId);
        } else if (isOverridden) {
            // --- Tab is Overridden ---
             if (onYoutubeVideoPage) { onYoutubeVideoPage = false; stopTime(); }
             hideOverlayOnTab(tabId);
        } else if (timeLeft <= 0) {
             // --- Time is up (Not whitelisted/noLimit/overridden) ---
             if (onYoutubeVideoPage) { onYoutubeVideoPage = false; stopTime(); } // Stop timer interval

             // Show overlay ONLY on video pages
             if (isVideoPage) {
                 chrome.tabs.sendMessage(tabId, { msg: "showOverlay" }, response => { /* Error handling */ });
             } else {
                 hideOverlayOnTab(tabId); // Ensure hidden on non-video pages
             }
        } else if (isVideoPage) {
            // --- On VIDEO page with Time Left (Not other conditions) ---
             if (!onYoutubeVideoPage) { // Start timer if not already running
                 onYoutubeVideoPage = true; // Tentatively set flag
                 if (!pauseOutOfFocus) {
                     startTime(); // startTime re-checks conditions
                 } else {
                     // Check focus before starting
                     chrome.windows.getLastFocused({ populate: false }, function(window) {
                         if (window && window.focused && currentTab && window.id === currentTab.windowId) {
                             startTime(); // Start only if focused
                         } else {
                             onYoutubeVideoPage = false; // Correct flag if not starting due to focus
                         }
                         // Update badge regardless of starting timer due to focus
                         updateBadge();
                     });
                 }
             }
             hideOverlayOnTab(tabId); // Ensure overlay hidden
        } else {
            // --- On YouTube but NOT a Video page (and time left) ---
            if (onYoutubeVideoPage) { // Stop timer if navigating away from a video
                onYoutubeVideoPage = false;
                stopTime();
            }
            hideOverlayOnTab(tabId); // Ensure overlay hidden
        }
    } else {
        // --- Not on YouTube Page ---
        if (onYoutubeVideoPage) { // Stop timer if leaving YT video page
            if (pauseOutOfFocus || popupOpen) {
                onYoutubeVideoPage = false; stopTime();
            } else {
                // Check if other video tabs require timer to continue
                checkWindowsForTimerStop();
            }
        }
        // Clean up override if leaving YouTube page
        if (isOverridden) {
             const index = tempOverrideTabs.indexOf(tabId);
             if (index !== -1) {
                 tempOverrideTabs.splice(index, 1);
                 chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
             }
        }
    }

    // Final badge update based on the determined state
    updateBadge();

} // End checkTabStatus


// --- Whitelist Check Function ---
async function isChannelWhitelisted(tabUrl, tabId) {
    // console.log(`Checking whitelist for: ${tabUrl} (Tab ID: ${tabId})`); // Debugging
    if (!tabUrl || !whitelistedHandles || whitelistedHandles.length === 0) {
        return false;
    }

    const handleFromUrl = getHandleFromUrl(tabUrl);
    if (handleFromUrl && whitelistedHandles.includes(handleFromUrl)) {
        // console.log(`Handle ${handleFromUrl} from URL is whitelisted.`); // Debugging
        return true;
    }

    if (isYoutubeVideo(tabUrl) && tabId) {
        try {
            // console.log("Asking content script for handle for tab:", tabId); // Debugging
            const response = await chrome.tabs.sendMessage(tabId, { msg: "getChannelHandleFromPage" });

            if (response && response.channelHandle) {
                const decodedHandleFromContent = response.channelHandle;
                // console.log("Received handle from content script:", decodedHandleFromContent); // Debugging
                if (whitelistedHandles.includes(decodedHandleFromContent)) {
                    // console.log(`Handle ${decodedHandleFromContent} from video page content script is whitelisted.`); // Debugging
                    return true;
                } else {
                     // console.log(`Handle ${decodedHandleFromContent} from video page not in whitelist.`); // Debugging
                }
            } else {
                // console.log("Content script did not return a handle for tab:", tabId); // Debugging
            }
        } catch (e) {
             if (!e.message.includes("Could not establish connection") && !e.message.includes("Receiving end does not exist") && !e.message.includes("message port closed before a response")) {
                console.warn(`Error messaging content script (Tab ID: ${tabId}) for channel handle:`, e.message);
             } else {
                 // console.log("Content script not available or ready for handle check on tab:", tabId); // Debugging
             }
        }
    } else {
        // console.log("Not a video page or no tabId, skipping content script check."); // Debugging
    }

    // console.log("URL/Handle not found in whitelist:", tabUrl); // Debugging
    return false;
}

// --- Check Windows Functions ---
// Modified to check for VIDEO pages specifically

async function checkWindowsForTimerStart() {
    // console.log("checkWindowsForTimerStart called"); // Debugging
    if (timer != null || noLimit || timeLeft <= 0) {
        // console.log("checkWindowsForTimerStart: Timer already running, noLimit, or time is up."); // Debugging
        return;
    }

    try {
        const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
        let eligibleVideoPageOpen = false; // Check if any eligible *video* page is active
        let activeTabIsEligibleVideo = false; // Check if the *focused* tab is an eligible *video* page

        for (let tab of tabs) {
            // *** Check if it's a VIDEO page ***
            if (tab && tab.url && tab.id && isYoutubeVideo(tab.url)) {
                let isTabOverridden = tempOverrideTabs.includes(tab.id);
                if (isTabOverridden) continue;

                const isWhitelisted = await isChannelWhitelisted(tab.url, tab.id);
                if (!isWhitelisted) {
                    eligibleVideoPageOpen = true; // Found at least one eligible video page
                    if (currentTab && currentTab.id === tab.id) {
                        activeTabIsEligibleVideo = true; // The focused tab is an eligible video page
                    }
                    if (!pauseOutOfFocus) break; // If focus doesn't matter, finding one is enough
                }
            }
        }

         // Start timer logic based on video page checks
         if (eligibleVideoPageOpen) {
              if (!pauseOutOfFocus) {
                  // Start if any eligible video page is active in any window
                  if (!onYoutubeVideoPage) { // Use new flag name
                      onYoutubeVideoPage = true;
                      startTime(); // startTime re-checks conditions
                  }
              } else {
                  // Start only if the focused tab is an eligible video page
                  if (activeTabIsEligibleVideo && !onYoutubeVideoPage) { // Use new flag name
                      onYoutubeVideoPage = true;
                       startTime(); // startTime re-checks conditions
                  } else if (!activeTabIsEligibleVideo && onYoutubeVideoPage) { // Use new flag name
                       // Stop if timer is running but the focused tab is no longer an eligible video page
                       onYoutubeVideoPage = false;
                       stopTime();
                  }
              }
         } else if (onYoutubeVideoPage) { // Use new flag name
              // Stop if no eligible video pages found but timer is running
              onYoutubeVideoPage = false;
              stopTime();
         }

    } catch (error) {
         console.error("Error querying tabs for timer start:", error);
    }
}


async function checkWindowsForTimerStop() {
    // console.log("checkWindowsForTimerStop called"); // Debugging
    // Only run if pause on focus loss is OFF and timer is running
    if (pauseOutOfFocus || timer == null) return;

	try {
        const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
		let eligibleVideoPageOpen = false; // Check for eligible *video* pages

		for (let tab of tabs) {
            // *** Check if it's a VIDEO page ***
			if (tab && tab.url && tab.id && isYoutubeVideo(tab.url)) {
                let isTabOverridden = tempOverrideTabs.includes(tab.id);
                if (isTabOverridden) continue;

                const isWhitelisted = await isChannelWhitelisted(tab.url, tab.id);
                 if (!isWhitelisted) {
				    eligibleVideoPageOpen = true; // Found one eligible video page
				    break; // Timer should continue
                 }
			}
		}
		// Stop only if timer is running AND no active eligible video pages found
		if (!eligibleVideoPageOpen && onYoutubeVideoPage) { // Use new flag name
			onYoutubeVideoPage = false;
			stopTime();
		}
	} catch (error) {
        console.error("Error querying tabs for timer stop:", error);
    }
}

// --- Initialization ---
setupResetCheckAlarm(); // Setup the periodic timer reset check