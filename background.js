chrome.runtime.onInstalled.addListener(function (object) {
	if (object.reason === chrome.runtime.OnInstalledReason.INSTALL) {
		chrome.tabs.create({url: "/pages/options.html"});
	}
});

var override = false;
var onYoutubeVideoPage = false; // True if timer is active on a YT video page
var timeLeft = 1800; // Default time in seconds
var currentTab = null;
var popupOpen = false;
var pauseOutOfFocus = true;
var youtubekidsEnabled = true;
var checkBrowserFocusTimer = null;
var timer = null; // Holds the setInterval ID
var noLimit = false; // True if no time limit for the current day
var whitelistedHandles = []; // Stores whitelisted @handles and UC... IDs
var tempOverrideTabs = []; // Stores tab IDs temporarily overridden
var resetCheckAlarmName = "youtubeTimeResetCheck";

checkReset();
setupResetCheckAlarm();

var days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

chrome.storage.local.get({"customizeLimits":false, "dayLimits":{}}, function(data) {
	if (data.customizeLimits) {
		var today = new Date();
		var day = days[today.getDay()];
		if (day in data.dayLimits && data.dayLimits[day] === false) {
			noLimit = true;
		}
	}
});

function updateWhitelistCache() {
    chrome.storage.local.get({ "whitelistedHandles": [] }, function(data) {
        if (chrome.runtime.lastError) {
            console.error("BG: Error getting whitelist from storage:", chrome.runtime.lastError.message);
            whitelistedHandles = [];
        } else {
            whitelistedHandles = data.whitelistedHandles || [];
        }
        // console.log("BG: Whitelist cache updated:", whitelistedHandles);
        if (currentTab && currentTab.url) { // Re-check if a tab is active
            checkTabStatus(currentTab.url);
        }
    });
}
updateWhitelistCache();

chrome.storage.onChanged.addListener(function(changes, namespace) {
	if (namespace === 'local') {
        if (changes.whitelistedHandles) {
            updateWhitelistCache(); // This will re-check current tab status
        }
        if (changes.timeLeft) {
            timeLeft = changes.timeLeft.newValue;
            // No immediate badge update here, let checkTabStatus or regular updates handle it
        }
        if (changes.override) {
            override = changes.override.newValue;
            if (currentTab && currentTab.url && isYoutube(currentTab.url)) checkTabStatus(currentTab.url);
        }
        if (changes.tempOverrideTabs) {
            tempOverrideTabs = changes.tempOverrideTabs.newValue || [];
            if (currentTab && currentTab.url) checkTabStatus(currentTab.url);
        }
        if (changes.noLimit) {
             noLimit = changes.noLimit.newValue;
             if (noLimit && timer !=null) stopTime(); // stopTime calls updateBadge
             else updateBadge(); // If timer wasn't running but noLimit changes, update badge
             if(noLimit) hideOverlayOnAllWindows();
             if (currentTab && currentTab.url) checkTabStatus(currentTab.url);
        }
        if (changes.pauseOutOfFocus) {
            pauseOutOfFocus = changes.pauseOutOfFocus.newValue;
             if (pauseOutOfFocus && checkBrowserFocusTimer == null) checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);
             else if (!pauseOutOfFocus && checkBrowserFocusTimer != null) { clearInterval(checkBrowserFocusTimer); checkBrowserFocusTimer = null; checkWindowsForTimerStart(); }
        }
         if (changes.youtubekidsEnabled) {
            youtubekidsEnabled = changes.youtubekidsEnabled.newValue;
             if (currentTab && currentTab.url) checkTabStatus(currentTab.url); else checkWindowsForTimerStart();
        }
	}
});

chrome.storage.local.get({
    "override":override, "pauseOutOfFocus":pauseOutOfFocus, "youtubekidsEnabled":youtubekidsEnabled,
    "timeLeft":timeLeft, "tempOverrideTabs": []
}, function(data) {
	override = data.override;
	pauseOutOfFocus = data.pauseOutOfFocus;
	youtubekidsEnabled = data.youtubekidsEnabled;
    tempOverrideTabs = data.tempOverrideTabs || [];
	if (pauseOutOfFocus) checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);
	if (!Number.isNaN(data.timeLeft)) timeLeft = data.timeLeft;
	else {
		chrome.storage.local.get({"timeLimit":30}, function(dataLimit) {
			timeLeft = dataLimit.timeLimit*60;
            chrome.storage.local.set({"timeLeft": timeLeft});
		});
	}
    updateBadge();
});

chrome.tabs.onActivated.addListener(function(activeInfo) {
	checkReset();
	chrome.tabs.get(activeInfo.tabId, function(tab){
	    if (chrome.runtime.lastError) { return; }
        if (tab) {
		    currentTab = tab;
		    checkTabStatus(tab.url);
        } else {
            currentTab = null; onYoutubeVideoPage = false; stopTime(); // updateBadge is called in stopTime
        }
	});
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
	checkReset();
	if(tab.active && (changeInfo.url || changeInfo.status === 'complete')){
		currentTab = tab;
		checkTabStatus(tab.url);
	}
});

chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
    var index = tempOverrideTabs.indexOf(tabId);
    if (index !== -1) {
        tempOverrideTabs.splice(index, 1);
        chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
    }
    if (currentTab && currentTab.id === tabId) {
        currentTab = null;
        if (!pauseOutOfFocus) checkWindowsForTimerStop(); // Will call updateBadge if timer stops
        else if (onYoutubeVideoPage) { onYoutubeVideoPage = false; stopTime(); }
        else { updateBadge(); }
    }
});

function getIdentifierFromUrlPath(path) {
    if (!path) return null;
    let match = path.match(/^\/(@[a-zA-Z0-9._-]{3,30})/);
    if (match) return match[1];
    match = path.match(/^\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    if (match) return match[1];
    // Generic ID match - used as a fallback for URLs that might just have the ID
    match = path.match(/^\/([a-zA-Z0-9_-]{24})$/);
    if (match && match[1].startsWith('UC')) return match[1]; // Ensure it looks like a channel ID
    return null;
}

function getIdentifierFromFullUrl(tabUrl) {
    if (!tabUrl) return null;
    try {
        const urlObj = new URL(tabUrl);
        let identifier = getIdentifierFromUrlPath(urlObj.pathname);
        if (identifier && identifier.includes('%')) {
             try { identifier = decodeURIComponent(identifier); } catch (e) { console.warn("BG: Error decoding identifier from URL:", identifier, e); }
        }
        return identifier;
    } catch (e) { /* console.warn("BG: Error parsing URL in getIdentifierFromFullUrl:", tabUrl, e); */ }
    return null;
}

function checkBrowserFocus(){
    if (pauseOutOfFocus) {
        chrome.windows.getLastFocused({ populate: false }, function(window) {
             if (chrome.runtime.lastError) { return; }
            if (window && window.focused) {
                chrome.tabs.query({ active: true, windowId: window.id }, function(tabs) {
                     if (chrome.runtime.lastError) { return; }
                    if (tabs && tabs[0]) {
                         if (!currentTab || currentTab.id !== tabs[0].id || (tabs[0].url && (!currentTab.url || currentTab.url !== tabs[0].url))) {
                            currentTab = tabs[0]; checkTabStatus(currentTab.url);
                        } else if (!onYoutubeVideoPage && currentTab && currentTab.url && isYoutubeVideo(currentTab.url)) {
                             checkTabStatus(currentTab.url);
                        }
                    } else {
                         if (onYoutubeVideoPage) { onYoutubeVideoPage = false; stopTime(); }
                         else { updateBadge(); }
                         currentTab = null;
                    }
                });
            } else {
                if (onYoutubeVideoPage && !popupOpen) { onYoutubeVideoPage = false; stopTime(); }
            }
        });
    }
}

chrome.windows.onFocusChanged.addListener(function(windowId) {
	checkReset();
	if (pauseOutOfFocus) {
		if(windowId == chrome.windows.WINDOW_ID_NONE) {
            if (onYoutubeVideoPage && !popupOpen) { onYoutubeVideoPage = false; stopTime(); }
		} else {
            chrome.tabs.query({ active: true, windowId: windowId }, function(tabs) {
                if (chrome.runtime.lastError) { return; }
                if (tabs && tabs[0]) {
                    currentTab = tabs[0]; checkTabStatus(currentTab.url);
                } else {
                    if(onYoutubeVideoPage) { onYoutubeVideoPage = false; stopTime(); }
                    else { updateBadge(); }
                    currentTab = null;
                }
            });
		}
	} else {
         checkWindowsForTimerStart();
    }
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
	switch(request.msg) {
        case "updateTimeLeftNow":
            if (typeof request.newTime === 'number' && !isNaN(request.newTime)) {
                timeLeft = Math.max(0, request.newTime);
                if (timeLeft > 0) {
                     if (currentTab && currentTab.id) hideOverlayOnTab(currentTab.id);
                     checkWindowsForTimerStart();
                } else {
                     if (timer != null) stopTime();
                     if (currentTab && currentTab.url) checkTabStatus(currentTab.url);
                }
                 updateBadge(); sendResponse({status: "TimeLeft updated directly"});
            } else { sendResponse({status: "Invalid time value received"}); }
            return true;
		case "override":
            handleOverrideRequest(sender.tab); sendResponse({status: "Override processing started"});
			break;
		case "checkReset":
			checkReset(); sendResponse({status: "Reset check initiated"});
			break;
		case "popupOpen":
			popupOpen = true; checkWindowsForTimerStart(); sendResponse({status: "Popup noted as open"});
			break;
		case "popupUnfocus":
			popupOpen = false; if (pauseOutOfFocus) checkBrowserFocus(); sendResponse({status: "Popup noted as closed"});
			break;
		case "checkPageStatus":
			if (sender.tab && sender.tab.url && sender.tab.id) {
					const url = sender.tab.url; const tabId = sender.tab.id;
                    const isVideoPage = isYoutubeVideo(url);
					isChannelWhitelisted(url, tabId).then(isWhitelisted => {
						const isOverridden = tempOverrideTabs.includes(tabId);
						const shouldOverlay = timeLeft <= 0 && isVideoPage && !override && !noLimit && !isWhitelisted && !isOverridden;
						sendResponse({ shouldOverlay: shouldOverlay });
					}).catch(error => {
						console.error("BG: Error in checkPageStatus/isChannelWhitelisted:", error);
						sendResponse({ shouldOverlay: false });
					});
					return true;
			} else { sendResponse({ shouldOverlay: false }); }
			break;
        case "pauseOutOfFocus":
             pauseOutOfFocus = request.val;
             if (pauseOutOfFocus && checkBrowserFocusTimer == null) checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);
             else if (!pauseOutOfFocus && checkBrowserFocusTimer != null) { clearInterval(checkBrowserFocusTimer); checkBrowserFocusTimer = null; checkWindowsForTimerStart(); }
             sendResponse({status: "Pause setting updated"}); break;
        case "youtubekidsEnabled":
            youtubekidsEnabled = request.val;
            if (currentTab && currentTab.url) checkTabStatus(currentTab.url); else checkWindowsForTimerStart();
            sendResponse({status: "YouTube Kids setting updated"}); break;
        case "resetTimeUpdated": sendResponse({status: "Reset time change noted"}); break;
        case "noLimitInputChange":
            var todayDate = new Date(); var dayName = days[todayDate.getDay()];
            if (request.day == dayName) {
                 noLimit = true; if (timer != null) stopTime(); updateBadge(); hideOverlayOnAllWindows();
                 if (currentTab && currentTab.url) checkTabStatus(currentTab.url);
            } sendResponse({status: "No limit change processed"}); break;
        case "dayTimeLimitUpdated":
            var todayDateLimit = new Date(); var dayNameLimit = days[todayDateLimit.getDay()];
            if (request.day == dayNameLimit) {
                noLimit = false; checkWindowsForTimerStart(); updateBadge(); hideOverlayOnAllWindows();
                if (currentTab && currentTab.url) checkTabStatus(currentTab.url);
            } sendResponse({status: "Day time limit change noted"}); break;
        case "customizeLimitsFalse":
            noLimit = false; checkWindowsForTimerStart(); updateBadge(); hideOverlayOnAllWindows();
            if (currentTab && currentTab.url) checkTabStatus(currentTab.url);
            sendResponse({status: "Customize limits disabled processed"}); break;
        default: sendResponse({status: "Unknown message type"}); break;
	}
    return false;
});

function hideOverlayOnTab(tabId) {
     if (tabId) {
          chrome.tabs.sendMessage(tabId, { msg: "hideOverlay" }, (response) => {
               if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                  /* console.warn("BG: Could not send hideOverlay message to tab:", tabId, chrome.runtime.lastError.message); */
               }
          });
     }
}

function handleOverrideRequest(senderTab) {
     if (!senderTab || !senderTab.id) { console.warn("BG: Override request missing senderTab info."); return; }
     const tabId = senderTab.id;
     chrome.storage.local.get({"overrideLimit":5, "currentOverrideCount": null, "limitOverrides": true}, function(data) {
        let currentCount = data.currentOverrideCount !== null ? data.currentOverrideCount : data.overrideLimit;
        const limitEnabled = data.limitOverrides; let canProceedWithOverride = false;
        if (limitEnabled) { if (currentCount >= 1) { currentCount--; canProceedWithOverride = true; }
        } else { canProceedWithOverride = true; }

        if (canProceedWithOverride) {
            if (!tempOverrideTabs.includes(tabId)) tempOverrideTabs.push(tabId);
            const storageUpdate = { tempOverrideTabs: tempOverrideTabs };
            if (limitEnabled) storageUpdate.currentOverrideCount = currentCount;

            chrome.storage.local.set(storageUpdate, function() {
                 if (chrome.runtime.lastError) console.error("BG: Error saving override state:", chrome.runtime.lastError.message);
                 else if (senderTab) {
                     currentTab = senderTab;
                     checkTabStatus(senderTab.url);
                 }
            });
        }
    });
}

function isYoutube(url) {
    if (!url) return false;
	if (youtubekidsEnabled) return /https?:\/\/(?!music\.)(.+?\.)?youtube(kids)?\.com(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
	return /https?:\/\/(?!music\.)(.+?\.)?youtube\.com(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
}

function isYoutubeVideo(url) {
    if (!url) return false;
	if (youtubekidsEnabled) return /https?:\/\/(?!music\.)(.+?\.)?youtube(kids)?\.com\/watch([A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
	return /https?:\/\/(?!music\.)(.+?\.)?youtube\.com\/watch([A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?/.test(url);
}

function setWhitelistBadge() { chrome.action.setBadgeText({ "text": "✓" }); chrome.action.setBadgeBackgroundColor({ color: "#28a745" }); }
function setOverrideBadge() { chrome.action.setBadgeText({ "text": "!" }); chrome.action.setBadgeBackgroundColor({ color: "#ffc107" }); }
function setTimerBadge() { chrome.action.setBadgeText({ "text": formatTime(timeLeft) }); chrome.action.setBadgeBackgroundColor({ color: "#FF0000" }); }
function clearBadge() { chrome.action.setBadgeText({ "text": "" }); }

async function updateBadge() {
    if (!currentTab || !currentTab.url || !currentTab.id) { clearBadge(); return; }

    const isCurrentTabWhitelisted = await isChannelWhitelisted(currentTab.url, currentTab.id);
    const isCurrentTabVideo = isYoutubeVideo(currentTab.url);
    const isCurrentTabOverridden = tempOverrideTabs.includes(currentTab.id) || override;

    if (isYoutube(currentTab.url)) {
        if (isCurrentTabWhitelisted) {
            setWhitelistBadge();
        } else if (noLimit) {
            chrome.action.setBadgeText({ "text": "∞" });
            chrome.action.setBadgeBackgroundColor({ color: "#6c757d" });
        } else if (isCurrentTabOverridden) {
            setOverrideBadge();
        } else if (timeLeft <= 0) {
            setTimerBadge(); // Shows 0:00
        } else { // Time is left, not whitelisted, not noLimit, not overridden
            // Show active timer if on a video page and timer is running for it
            // Otherwise, just show remaining time if on any YouTube page.
            if (isCurrentTabVideo && onYoutubeVideoPage && timer != null) {
                setTimerBadge();
            } else { // On a YouTube page (general) or video page not actively timed, show remaining time
                setTimerBadge();
            }
        }
    } else {
        clearBadge();
    }
}

function updateTime() {
	if (timeLeft > 0) {
		timeLeft--;
	} else {
		timeLeft = 0;
        if (timer != null) {
            stopTime(); // This will clear timer, set onYoutubeVideoPage=false, and call updateBadge()
        }
        // After stopping, re-evaluate the current tab to show overlay if needed.
        if (currentTab && currentTab.url) {
            checkTabStatus(currentTab.url);
        } else {
            updateBadge(); // If no current tab for some reason, still update badge.
        }
        // Storing timeLeft should happen after it's confirmed to be 0.
        chrome.storage.local.set({ "timeLeft": timeLeft }, () => { if (chrome.runtime.lastError) { /*...*/ } });
		return; 
	}

	chrome.storage.local.set({ "timeLeft": timeLeft }, () => { if (chrome.runtime.lastError) { /* ... */ } });
    updateBadge();

	if (popupOpen) {
        chrome.runtime.sendMessage({ msg: "updateTime", time: timeLeft }, function(response) {
            if (chrome.runtime.lastError && !(chrome.runtime.lastError.message.includes("Could not establish connection") || chrome.runtime.lastError.message.includes("Receiving end does not exist"))) {
                /* console.warn("BG: sendMessage error (updateTime to popup):", chrome.runtime.lastError.message); */
            }
        });
    }
}

async function startTime() { // Argument 'isChannelWhitelistedOnPage' removed
    // 1. Initial guards
    if (timer != null || timeLeft <= 0 || noLimit || !currentTab || !currentTab.id || !currentTab.url ) {
        return;
    }
    if (!isYoutubeVideo(currentTab.url)) {
        return;
    }
    if (tempOverrideTabs.includes(currentTab.id) || override) {
        updateBadge(); 
        return;
    }

    // 2. Perform a definitive whitelist check *inside* startTime
    let isChannelWhitelistedForThisStartAttempt = false;
    if (isYoutube(currentTab.url)) { 
        try {
            isChannelWhitelistedForThisStartAttempt = await isChannelWhitelisted(currentTab.url, currentTab.id);
        } catch (e) {
            console.error("BG: Error in startTime's isChannelWhitelisted check for " + currentTab.url + ":", e);
            // If an error occurs, conservatively assume not whitelisted.
        }
    }

    // 3. If whitelisted, ensure timer is stopped and do not proceed to start it.
    if (isChannelWhitelistedForThisStartAttempt) {
        if (onYoutubeVideoPage || timer != null) { // If timer was perceived as running or active on page
            stopTime(); // This will also call updateBadge to show whitelist status
        } else {
            updateBadge(); // Ensure badge is correct (e.g., whitelist checkmark)
        }
        return; // Explicitly do not start the timer
    }

    // 4. If all checks pass (not whitelisted, time left, on video page, not overridden etc.)
    onYoutubeVideoPage = true;
    if (timer == null) { // Check to prevent multiple intervals if somehow called in quick succession
        timer = setInterval(updateTime, 1000);
    }
    updateBadge(); // Update badge when timer actually starts
}

function stopTime() {
    clearInterval(timer);
    timer = null;
    if (onYoutubeVideoPage) { // If it was true, set it to false
        onYoutubeVideoPage = false;
    }
    updateBadge();
}

function formatTime(totalSeconds) {
	var hours = Math.floor(totalSeconds / 3600);
	totalSeconds %= 3600;
	var minutes =  Math.floor(totalSeconds / 60);
	var seconds =  Math.floor(totalSeconds % 60);
	var result = "";
	if (hours > 0) {
		result += hours + ":";
		if (minutes < 10 && hours > 0) result += "0"; // Ensure leading zero for minutes only if hours are present.
		result += minutes;
	} else {
		result += minutes;
	}
	result += ":";
	if (seconds < 10) result += "0";
	result += seconds;
	return result;
}

function checkReset() {
    chrome.storage.local.get({
        "lastResetTimestamp": null, "resetTime": "00:00", "timeLimit": 30,
        "customizeLimits": false, "dayLimits": {}, "overrideLimit": 5, "limitOverrides": true
    }, function(data) {
        if (chrome.runtime.lastError) { console.error("BG: Error in checkReset storage.get:", chrome.runtime.lastError.message); return; }
        var now = new Date(); var nowTs = now.getTime();
        var lastResetTs = data.lastResetTimestamp || 0;
        var resetParts = data.resetTime.split(":");
        var resetH = parseInt(resetParts[0],10); var resetM = parseInt(resetParts[1],10);
        if (isNaN(resetH) || isNaN(resetM)) { resetH = 0; resetM = 0; }
        var targetResetToday = new Date(now); targetResetToday.setHours(resetH, resetM, 0, 0);
        var targetResetTodayTs = targetResetToday.getTime();

        if (nowTs >= targetResetTodayTs && lastResetTs < targetResetTodayTs) {
            var limitToday = data.timeLimit; var noLimitToday = false;
            if (data.customizeLimits) {
                var dayOfReset = new Date(targetResetTodayTs); var dayName = days[dayOfReset.getDay()];
                if (dayName in data.dayLimits) {
                    if (data.dayLimits[dayName] === false) noLimitToday = true;
                    else limitToday = data.dayLimits[dayName];
                }
            }
            noLimit = noLimitToday; timeLeft = noLimit ? 0 : limitToday * 60; // Use 0 for noLimit true, not -1
            override = false; tempOverrideTabs = [];
            const resetStore = { "lastResetTimestamp": targetResetTodayTs, "override": false, "timeLeft": timeLeft, "tempOverrideTabs": [] };
            if (data.limitOverrides) resetStore.currentOverrideCount = data.overrideLimit;
            else chrome.storage.local.remove("currentOverrideCount");

            chrome.storage.local.set(resetStore, function() {
                if (chrome.runtime.lastError) { console.error("BG: Error saving reset state:", chrome.runtime.lastError.message); return; }
                if (timer != null) stopTime();
                else updateBadge();

                if (currentTab && currentTab.url) {
                    checkTabStatus(currentTab.url);
                } else {
                    checkWindowsForTimerStart();
                }
                chrome.runtime.sendMessage({ msg: "checkDone", noLimit: noLimit }, r => { if (chrome.runtime.lastError && !(chrome.runtime.lastError.message.includes("Could not establish connection")||chrome.runtime.lastError.message.includes("Receiving end does not exist"))) { /* ... */ } });
                hideOverlayOnAllWindows();
            });
        }
    });
}

function setupResetCheckAlarm() {
    chrome.alarms.get(resetCheckAlarmName, (alarm) => {
        if (!alarm) { // Only create if it doesn't exist
            chrome.alarms.create(resetCheckAlarmName, { periodInMinutes: 1 });
        }
    });
}
chrome.alarms.onAlarm.addListener(function(alarm) { if (alarm.name === resetCheckAlarmName) checkReset(); });

function hideOverlayOnAllWindows() {
    chrome.tabs.query({}, function(tabs) {
        if (chrome.runtime.lastError) { console.warn("BG: Error querying tabs for hideOverlay:", chrome.runtime.lastError.message); return; }
        for (var i = 0; i < tabs.length; ++i) {
            if (tabs[i].url && isYoutube(tabs[i].url)) {
                 hideOverlayOnTab(tabs[i].id);
            }
        }
    });
}

async function checkTabStatus(url) {
    if (!currentTab || !currentTab.id || !url) {
        if (onYoutubeVideoPage) { // If timer was running for a now-invalid tab context
            stopTime();
        } else {
            updateBadge(); // Ensure badge is cleared or updated appropriately
        }
        return;
    }

    const tabId = currentTab.id;
    const isCurrentlyYoutubePage = isYoutube(url);
    const isVideoPage = isYoutubeVideo(url);
    let isChannelWhitelistedOnPage = false; // This will be determined by isChannelWhitelisted
    const isOverriddenForThisTab = tempOverrideTabs.includes(tabId);

    if (isCurrentlyYoutubePage) {
        try {
            // This check helps determine if an overlay needs to be hidden or if a stopTime is definitively needed
            // due to whitelisting, even if startTime will do its own check.
            isChannelWhitelistedOnPage = await isChannelWhitelisted(url, tabId);
        } catch (e) {
            console.error("BG: Error getting whitelist status in checkTabStatus for " + url + ":", e);
            // Potentially default isChannelWhitelistedOnPage to false or handle error
        }
    }

    let shouldAttemptTimerLogic = false;

    if (isCurrentlyYoutubePage) {
        if (isChannelWhitelistedOnPage || noLimit || isOverriddenForThisTab || override) {
            hideOverlayOnTab(tabId); // Ensure overlay is hidden if whitelisted/overridden/noLimit
            if (onYoutubeVideoPage) { // If timer was running for this tab
                 stopTime(); // Stop it as it's whitelisted or similar
            }
            shouldAttemptTimerLogic = false;
        } else if (timeLeft <= 0) {
            if (isVideoPage) {
                // Send message to show overlay
                chrome.tabs.sendMessage(tabId, { msg: "showOverlay" }, () => {
                    if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                        console.warn("BG: Error sending showOverlay to tab " + tabId + ": " + chrome.runtime.lastError.message);
                    }
                });
            } else {
                hideOverlayOnTab(tabId); // Not a video page, ensure no overlay
            }
            if (onYoutubeVideoPage) { // If timer was somehow running with timeLeft <= 0
                stopTime();
            }
            shouldAttemptTimerLogic = false;
        } else if (isVideoPage) { // Time is left, not whitelisted/overridden/noLimit, and it's a video page
            hideOverlayOnTab(tabId); // Ensure overlay is hidden as time is left
            shouldAttemptTimerLogic = true;
        } else { // On YouTube but not a video page (e.g., homepage, search results)
            hideOverlayOnTab(tabId);
            if (onYoutubeVideoPage && pauseOutOfFocus) { // If timer was running for a video and we navigated to a non-video YT page (and pauseOutOfFocus is on)
                 stopTime();
            } else if (onYoutubeVideoPage && !pauseOutOfFocus) {
                // If not pausing on focus, timer might be for another tab.
                // Stop it for now, checkWindowsForTimerStart will re-evaluate.
                stopTime();
                checkWindowsForTimerStart();
            }
            shouldAttemptTimerLogic = false;
        }
    } else { // Not a YouTube page
        if (onYoutubeVideoPage) { // If timer was running and user navigated away from YouTube
            stopTime();
        }
        // If this tab was temporarily overridden, clear that now since we left YouTube
        if (isOverriddenForThisTab) {
             const index = tempOverrideTabs.indexOf(tabId);
             if (index !== -1) {
                 tempOverrideTabs.splice(index, 1);
                 chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
             }
        }
        shouldAttemptTimerLogic = false;
    }

    if (shouldAttemptTimerLogic) {
        // Only attempt to start if timer isn't already considered active for a page,
        // or if focus logic allows. startTime() will do the final whitelist check.
        if (!onYoutubeVideoPage || timer == null) {
            if (!pauseOutOfFocus || popupOpen) {
                 await startTime(); // startTime will do its own robust whitelist check
            } else {
                 // Focus check logic - ensure current tab is active and focused
                 try {
                     const win = await chrome.windows.getLastFocused({ populate: false });
                     if (win && win.focused && currentTab && win.id === currentTab.windowId) {
                         await startTime(); // startTime will do its own robust whitelist check
                     } else {
                        // If window/tab lost focus and timer was on for *this* page.
                        if(onYoutubeVideoPage && currentTab && currentTab.id === tabId) {
                            stopTime();
                        }
                     }
                 } catch(e) {
                    console.error("BG: Error getting last focused window in checkTabStatus (timer start path):", e);
                    if(onYoutubeVideoPage && currentTab && currentTab.id === tabId) { stopTime(); }
                 }
             }
        }
        // If timer is already running (onYoutubeVideoPage && timer != null) and shouldAttemptTimerLogic is true,
        // startTime() will prevent duplicate starts. The main thing is that updateBadge() below will refresh the display.
    }
    // Always update the badge based on the final state
    updateBadge();
}


async function isChannelWhitelisted(tabUrl, tabId) {
    // If no URL, or no whitelisted handles are set, or the list is empty, it can't be whitelisted.
    if (!tabUrl || !whitelistedHandles || whitelistedHandles.length === 0) {
        return false;
    }

    // Only proceed if the tabId is valid and the URL is a YouTube URL.
    if (tabId && isYoutube(tabUrl)) {
        try {
            // Send a message to the content script in the specified tab to get channel identifiers.
            // Expecting a response like { channelHandle: "@handle", channelUcId: "UC..." }
            const response = await chrome.tabs.sendMessage(tabId, { msg: "getChannelHandleFromPage" });

            if (response) {
                const { channelHandle, channelUcId } = response; // Destructure the response

                // Check if the extracted @handle is in the whitelistedHandles array.
                if (channelHandle && whitelistedHandles.includes(channelHandle)) {
                    // console.log("BG: Whitelisted by @handle:", channelHandle);
                    return true; // Whitelisted by @handle
                }
                // Check if the extracted UCID is in the whitelistedHandles array.
                if (channelUcId && whitelistedHandles.includes(channelUcId)) {
                    // console.log("BG: Whitelisted by UCID:", channelUcId);
                    return true; // Whitelisted by UCID
                }
            }
        } catch (e) {
            // Log errors unless they are common benign errors indicating the content script isn't ready or available.
             if (!(e.message.includes("Could not establish connection") || 
                   e.message.includes("Receiving end does not exist") ||
                   e.message.includes("message port closed before a response"))) { // Added common error check
                console.warn(`BG: Error messaging content script (Tab ${tabId}, URL: ${tabUrl}):`, e.message);
             }
             // In case of error, assume not whitelisted for safety.
        }
    }
    
    // If no conditions for whitelisting were met, or if it's not a YouTube URL, return false.
    return false;
}

async function checkWindowsForTimerStart() {
    if (timer != null || noLimit || timeLeft <= 0) return;

    try {
        const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
        let anEligibleVideoPageIsOpenAndFocused = false;
        let eligibleTabForTimer = null;

        for (let win of allWindows) {
            if (pauseOutOfFocus && !win.focused) continue;

            for (let tab of win.tabs) {
                if (tab.active && tab.url && tab.id && isYoutubeVideo(tab.url)) {
                    if (tempOverrideTabs.includes(tab.id) || override) continue;
                    
                    const isWhitelisted = await isChannelWhitelisted(tab.url, tab.id);
                    if (!isWhitelisted) {
                        anEligibleVideoPageIsOpenAndFocused = true;
                        eligibleTabForTimer = tab;
                        break; 
                    }
                }
            }
            if (anEligibleVideoPageIsOpenAndFocused) break;
        }
        
         if (anEligibleVideoPageIsOpenAndFocused && eligibleTabForTimer) {
              if (!currentTab || currentTab.id !== eligibleTabForTimer.id) {
                  currentTab = eligibleTabForTimer; 
              }
              if (!onYoutubeVideoPage || timer == null) {
                  await startTime();
              } else {
                  updateBadge(); // If timer already running, just ensure badge is correct for current context
              }
         } else {
              if (onYoutubeVideoPage) { stopTime(); }
              else { updateBadge(); }
         }
    } catch (error) { console.error("BG: Error in checkWindowsForTimerStart:", error); if (onYoutubeVideoPage) stopTime(); else updateBadge(); }
}

async function checkWindowsForTimerStop() {
    if (pauseOutOfFocus || timer == null) return;
	try {
        const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
		let anEligibleVideoPageIsOpen = false;

		for (let win of allWindows) {
            for (let tab of win.tabs) {
                if (tab.active && tab.url && tab.id && isYoutubeVideo(tab.url)) {
                    if (tempOverrideTabs.includes(tab.id) || override) continue;
                    const isWhitelisted = await isChannelWhitelisted(tab.url, tab.id);
                     if (!isWhitelisted) { anEligibleVideoPageIsOpen = true; break; }
                }
            }
            if (anEligibleVideoPageIsOpen) break;
        }
		if (!anEligibleVideoPageIsOpen && onYoutubeVideoPage) { stopTime(); }
	} catch (error) { console.error("BG: Error in checkWindowsForTimerStop:", error); if(onYoutubeVideoPage) stopTime(); }
}