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
// tempOverrideTabs will store objects like { tabId: 123, videoId: "dQw4w9WgXcQ" }
var tempOverrideTabs = []; 
var resetCheckAlarmName = "youtubeTimeResetCheck";

checkReset();
setupResetCheckAlarm();

var days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

chrome.runtime.onInstalled.addListener(function (object) {
	if (object.reason === chrome.runtime.OnInstalledReason.INSTALL) {
		chrome.tabs.create({url: "/pages/options.html"});
	}
});

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
        if (currentTab && currentTab.url) { 
            checkTabStatus(currentTab.url);
        }
    });
}
updateWhitelistCache();

chrome.storage.onChanged.addListener(function(changes, namespace) {
	if (namespace === 'local') {
        if (changes.whitelistedHandles) {
            updateWhitelistCache(); 
        }
        if (changes.timeLeft) {
            timeLeft = changes.timeLeft.newValue;
        }
        if (changes.tempOverrideTabs) { // This now reflects changes to the array of {tabId, videoId} objects
            tempOverrideTabs = changes.tempOverrideTabs.newValue || [];
            if (currentTab && currentTab.url) checkTabStatus(currentTab.url);
        }
        if (changes.noLimit) {
             noLimit = changes.noLimit.newValue;
             if (noLimit && timer !=null) stopTime(); 
             else updateBadge(); 
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
    "pauseOutOfFocus":pauseOutOfFocus, "youtubekidsEnabled":youtubekidsEnabled,
    "timeLeft":timeLeft, "tempOverrideTabs": []
}, function(data) {
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
            currentTab = null; onYoutubeVideoPage = false; stopTime(); 
        }
	});
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
	checkReset();
	if(tab.active && (changeInfo.url || changeInfo.status === 'complete')){
		currentTab = tab;
		checkTabStatus(tab.url); // This will now re-evaluate based on the new URL/video ID
	}
});

chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
    // Remove all overrides associated with the closed tab
    const initialLength = tempOverrideTabs.length;
    tempOverrideTabs = tempOverrideTabs.filter(override => override.tabId !== tabId);
    if (tempOverrideTabs.length !== initialLength) {
        chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
    }

    if (currentTab && currentTab.id === tabId) {
        currentTab = null;
        if (!pauseOutOfFocus) checkWindowsForTimerStop(); 
        else if (onYoutubeVideoPage) { onYoutubeVideoPage = false; stopTime(); }
        else { updateBadge(); }
    }
});

// Helper function to extract video ID from YouTube URL
function getVideoId(url) {
    if (!url) return null;
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === "www.youtube.com" || urlObj.hostname === "youtube.com" || urlObj.hostname === "m.youtube.com" || urlObj.hostname === "www.youtubekids.com" || urlObj.hostname === "youtubekids.com") {
            if (urlObj.pathname === "/watch") {
                return urlObj.searchParams.get("v");
            }
            // For shorts, e.g., /shorts/VIDEO_ID
            const shortsMatch = urlObj.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
            if (shortsMatch) {
                return shortsMatch[1];
            }
        }
    } catch (e) {
        console.warn("BG: Error parsing URL for video ID:", url, e);
    }
    return null;
}

// Helper function to check if the current video in a specific tab is overridden
function isCurrentVideoOverridden(tabId, videoId) {
    if (!tabId || !videoId) return false;
    return tempOverrideTabs.some(override => override.tabId === tabId && override.videoId === videoId);
}


function getIdentifierFromUrlPath(path) {
    if (!path) return null;
    let match = path.match(/^\/(@[a-zA-Z0-9._-]{3,30})/);
    if (match) return match[1];
    match = path.match(/^\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    if (match) return match[1];
    match = path.match(/^\/([a-zA-Z0-9_-]{24})$/);
    if (match && match[1].startsWith('UC')) return match[1]; 
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
                    const videoId = getVideoId(url);
                    const isVideoPage = isYoutubeVideo(url); // or check if videoId is not null

					isChannelWhitelisted(url, tabId).then(isWhitelisted => {
						const isOverridden = isCurrentVideoOverridden(tabId, videoId);
						const shouldOverlay = timeLeft <= 0 && isVideoPage && !noLimit && !isWhitelisted && !isOverridden;
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
                 noLimit = true; 
                 if (timer != null) stopTime(); 
                 updateBadge(); 
                 hideOverlayOnAllWindows(); 
                 if (currentTab && currentTab.url) checkTabStatus(currentTab.url); 
            } sendResponse({status: "No limit change processed"}); break;
        case "dayTimeLimitUpdated": 
            var todayDateLimit = new Date(); var dayNameLimit = days[todayDateLimit.getDay()];
            if (request.day == dayNameLimit) { 
                noLimit = false; 
                checkWindowsForTimerStart(); 
                updateBadge(); 
                if (currentTab && currentTab.url) checkTabStatus(currentTab.url); 
            } sendResponse({status: "Day time limit change noted"}); break;
        case "customizeLimitsFalse": 
            noLimit = false; 
            checkWindowsForTimerStart(); 
            updateBadge(); 
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
     if (!senderTab || !senderTab.id || !senderTab.url) { 
         console.warn("BG: Override request missing senderTab info or URL."); 
         return; 
     }
     const tabId = senderTab.id;
     const videoId = getVideoId(senderTab.url);

     if (!videoId) {
         console.warn("BG: Could not get video ID for override request from URL:", senderTab.url);
         // Optionally, inform the user or just don't proceed with override for non-video pages.
         return;
     }

     chrome.storage.local.get({"overrideLimit":5, "currentOverrideCount": null, "limitOverrides": true}, function(data) {
        if (chrome.runtime.lastError) { console.error("BG: Error getting override settings:", chrome.runtime.lastError.message); return; }
        
        let currentCount = data.currentOverrideCount !== null ? data.currentOverrideCount : data.overrideLimit;
        const limitEnabled = data.limitOverrides;
        let canProceedWithOverride = false;

        if (limitEnabled) {
            if (currentCount >= 1) {
                currentCount--; 
                canProceedWithOverride = true;
            }
        } else { 
            canProceedWithOverride = true;
        }

        if (canProceedWithOverride) {
            // Remove any existing override for this specific video in this tab first, then add.
            // This handles re-overriding the same video if something went wrong, though unlikely.
            tempOverrideTabs = tempOverrideTabs.filter(ov => !(ov.tabId === tabId && ov.videoId === videoId));
            tempOverrideTabs.push({ tabId: tabId, videoId: videoId });
            
            const storageUpdate = { tempOverrideTabs: tempOverrideTabs };
            if (limitEnabled) {
                storageUpdate.currentOverrideCount = currentCount;
            }

            chrome.storage.local.set(storageUpdate, function() {
                 if (chrome.runtime.lastError) {
                     console.error("BG: Error saving override state:", chrome.runtime.lastError.message);
                 } else {
                     if (senderTab) { 
                         currentTab = senderTab; 
                         checkTabStatus(senderTab.url); 
                     }
                 }
            });
        } else {
            console.log("BG: Override denied, no overrides left or limit not enabled correctly.");
            // Potentially send a message to content script to update overlay if override fails
            chrome.tabs.sendMessage(tabId, { msg: "overrideFailed" }, () => {
                if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                    // console.warn("BG: Error sending overrideFailed to tab " + tabId + ": " + chrome.runtime.lastError.message);
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
    return getVideoId(url) !== null; // A simpler check using our helper
}

function setWhitelistBadge() { chrome.action.setBadgeText({ "text": "✓" }); chrome.action.setBadgeBackgroundColor({ color: "#28a745" }); }
function setOverrideBadge() { chrome.action.setBadgeText({ "text": "!" }); chrome.action.setBadgeBackgroundColor({ color: "#ffc107" }); }
function setTimerBadge() { chrome.action.setBadgeText({ "text": formatTime(timeLeft) }); chrome.action.setBadgeBackgroundColor({ color: "#FF0000" }); }
function clearBadge() { chrome.action.setBadgeText({ "text": "" }); }

async function updateBadge() {
    if (!currentTab || !currentTab.url || !currentTab.id) { clearBadge(); return; }

    const currentVideoId = getVideoId(currentTab.url);
    const isCurrentTabWhitelisted = await isChannelWhitelisted(currentTab.url, currentTab.id);
    const isCurrentTabVideo = isYoutubeVideo(currentTab.url);
    const isCurrentVideoNowOverridden = isCurrentVideoOverridden(currentTab.id, currentVideoId);

    if (isYoutube(currentTab.url)) {
        if (isCurrentTabWhitelisted) {
            setWhitelistBadge();
        } else if (noLimit) {
            chrome.action.setBadgeText({ "text": "∞" });
            chrome.action.setBadgeBackgroundColor({ color: "#6c757d" });
        } else if (isCurrentVideoNowOverridden && isCurrentTabVideo) { // Override badge only if it's a video and overridden
            setOverrideBadge();
        } else if (timeLeft <= 0) {
            setTimerBadge(); 
        } else { 
            if (isCurrentTabVideo && onYoutubeVideoPage && timer != null) {
                setTimerBadge();
            } else { 
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
            stopTime(); 
        }
        if (currentTab && currentTab.url) {
            checkTabStatus(currentTab.url);
        } else {
            updateBadge(); 
        }
        chrome.storage.local.set({ "timeLeft": timeLeft }, () => { if (chrome.runtime.lastError) { /* console.error(...) */ } });
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

async function startTime() { 
    if (timer != null || timeLeft <= 0 || noLimit || !currentTab || !currentTab.id || !currentTab.url ) {
        return;
    }
    const currentVideoId = getVideoId(currentTab.url);
    if (!currentVideoId) { // Not a video page
        return;
    }
    if (isCurrentVideoOverridden(currentTab.id, currentVideoId)) {
        updateBadge(); 
        return;
    }

    let isChannelWhitelistedForThisStartAttempt = false;
    if (isYoutube(currentTab.url)) { 
        try {
            isChannelWhitelistedForThisStartAttempt = await isChannelWhitelisted(currentTab.url, currentTab.id);
        } catch (e) {
            console.error("BG: Error in startTime's isChannelWhitelisted check for " + currentTab.url + ":", e);
        }
    }

    if (isChannelWhitelistedForThisStartAttempt) {
        if (onYoutubeVideoPage || timer != null) { 
            stopTime(); 
        } else {
            updateBadge(); 
        }
        return; 
    }

    onYoutubeVideoPage = true;
    if (timer == null) { 
        timer = setInterval(updateTime, 1000);
    }
    updateBadge(); 
}

function stopTime() {
    clearInterval(timer);
    timer = null;
    if (onYoutubeVideoPage) { 
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
		if (minutes < 10 && hours > 0) result += "0"; 
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
            noLimit = noLimitToday; timeLeft = noLimit ? 0 : limitToday * 60; 
            tempOverrideTabs = []; // Clear video-specific overrides
            const resetStore = { 
                "lastResetTimestamp": targetResetTodayTs, 
                "timeLeft": timeLeft, 
                "tempOverrideTabs": [] 
            };
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
        if (!alarm) { 
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
        if (onYoutubeVideoPage) { 
            stopTime();
        } else {
            updateBadge(); 
        }
        return;
    }

    const tabId = currentTab.id;
    const currentVideoId = getVideoId(url);
    const isCurrentlyYoutubePage = isYoutube(url);
    const isVideoPage = currentVideoId !== null; // True if we have a video ID
    let isChannelWhitelistedOnPage = false; 
    const isVideoNowOverridden = isCurrentVideoOverridden(tabId, currentVideoId);


    if (isCurrentlyYoutubePage) {
        try {
            isChannelWhitelistedOnPage = await isChannelWhitelisted(url, tabId);
        } catch (e) {
            console.error("BG: Error getting whitelist status in checkTabStatus for " + url + ":", e);
        }
    }

    let shouldAttemptTimerLogic = false;

    if (isCurrentlyYoutubePage) {
        if (isChannelWhitelistedOnPage || noLimit || (isVideoPage && isVideoNowOverridden)) {
            hideOverlayOnTab(tabId); 
            if (onYoutubeVideoPage) { 
                 stopTime(); 
            }
            shouldAttemptTimerLogic = false;
        } else if (timeLeft <= 0) { // Not whitelisted, not noLimit, not overridden, and time is up
            if (isVideoPage) { // Only show overlay on actual video pages
                chrome.tabs.sendMessage(tabId, { msg: "showOverlay" }, () => {
                    if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                        /* console.warn("BG: Error sending showOverlay to tab " + tabId + ": " + chrome.runtime.lastError.message); */
                    }
                });
            } else { // Not a video page (e.g. homepage, channel page), ensure no overlay
                hideOverlayOnTab(tabId); 
            }
            if (onYoutubeVideoPage) { 
                stopTime();
            }
            shouldAttemptTimerLogic = false;
        } else if (isVideoPage) { // Time is left, not whitelisted/noLimit/overridden, and it's a video page
            hideOverlayOnTab(tabId); 
            shouldAttemptTimerLogic = true;
        } else { // On YouTube but not a video page (e.g., homepage, search results)
            hideOverlayOnTab(tabId);
            if (onYoutubeVideoPage && pauseOutOfFocus) { 
                 stopTime();
            } else if (onYoutubeVideoPage && !pauseOutOfFocus) {
                stopTime();
                checkWindowsForTimerStart();
            }
            // If user navigates from an overridden video to a non-video YT page, the override for that videoId remains
            // but won't apply here. It will be re-checked if they go back to that specific video.
            shouldAttemptTimerLogic = false;
        }
    } else { // Not a YouTube page
        if (onYoutubeVideoPage) { 
            stopTime();
        }
        // Clear all overrides for this tab when navigating away from YouTube
        const initialLength = tempOverrideTabs.length;
        tempOverrideTabs = tempOverrideTabs.filter(override => override.tabId !== tabId);
        if (tempOverrideTabs.length !== initialLength) {
            chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
        }
        shouldAttemptTimerLogic = false;
    }

    if (shouldAttemptTimerLogic) {
        if (!onYoutubeVideoPage || timer == null) {
            if (!pauseOutOfFocus || popupOpen) {
                 await startTime(); 
            } else {
                 try {
                     const win = await chrome.windows.getLastFocused({ populate: false });
                     if (win && win.focused && currentTab && win.id === currentTab.windowId) {
                         await startTime(); 
                     } else {
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
    }
    updateBadge();
}


async function isChannelWhitelisted(tabUrl, tabId) {
    if (!tabUrl || !whitelistedHandles || whitelistedHandles.length === 0) {
        return false;
    }
    if (tabId && isYoutube(tabUrl)) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { msg: "getChannelHandleFromPage" });
            if (response) {
                const { channelHandle, channelUcId } = response; 
                if (channelHandle && whitelistedHandles.includes(channelHandle)) {
                    return true; 
                }
                if (channelUcId && whitelistedHandles.includes(channelUcId)) {
                    return true; 
                }
            }
        } catch (e) {
             if (!(e.message.includes("Could not establish connection") || 
                   e.message.includes("Receiving end does not exist") ||
                   e.message.includes("message port closed before a response"))) { 
                console.warn(`BG: Error messaging content script (Tab ${tabId}, URL: ${tabUrl}):`, e.message);
             }
        }
    }
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
                if (tab.active && tab.url && tab.id) {
                    const videoId = getVideoId(tab.url);
                    if (videoId) { // It's a video page
                        if (isCurrentVideoOverridden(tab.id, videoId)) continue; 
                        
                        const isWhitelisted = await isChannelWhitelisted(tab.url, tab.id);
                        if (!isWhitelisted) {
                            anEligibleVideoPageIsOpenAndFocused = true;
                            eligibleTabForTimer = tab;
                            break; 
                        }
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
                  updateBadge(); 
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
                 if (tab.active && tab.url && tab.id) {
                    const videoId = getVideoId(tab.url);
                    if (videoId) { // It's a video page
                        if (isCurrentVideoOverridden(tab.id, videoId)) continue; 
                        const isWhitelisted = await isChannelWhitelisted(tab.url, tab.id);
                         if (!isWhitelisted) { anEligibleVideoPageIsOpen = true; break; }
                    }
                }
            }
            if (anEligibleVideoPageIsOpen) break;
        }
		if (!anEligibleVideoPageIsOpen && onYoutubeVideoPage) { stopTime(); }
	} catch (error) { console.error("BG: Error in checkWindowsForTimerStop:", error); if(onYoutubeVideoPage) stopTime(); }
}