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
var whitelistedHandles = []; // Cache for whitelisted handles (decoded)
var tempOverrideTabs = []; // Keep track of tabs where overlay is hidden by override
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
            whitelistedHandles = []; // Reset to empty on error
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
             if (onYoutube || timeLeft <= 0) {
                 updateBadge();
             }
        }
        if (changes.override) {
            override = changes.override.newValue;
            if (currentTab && currentTab.url && isYoutube(currentTab.url)) {
                 checkTabForYouTube(currentTab.url);
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
             if (currentTab && currentTab.url) checkTabForYouTube(currentTab.url);
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
		    checkTabForYouTube(tab.url);
        } else {
            currentTab = null;
            onYoutube = false;
            stopTime();
        }
	});
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
	checkReset();
	if(tab.active && changeInfo.url){
		currentTab = tab;
		checkTabForYouTube(changeInfo.url);
	}
    else if (tab.active && changeInfo.status === 'complete' && currentTab && currentTab.id === tabId) {
        currentTab = tab;
        checkTabForYouTube(tab.url);
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
            checkWindowsForTimerStop();
        } else if (onYoutube) {
             onYoutube = false;
             stopTime();
        }
    }
});

// *** MODIFIED getHandleFromUrl ***
function getHandleFromUrl(tabUrl) {
    if (!tabUrl) return null;
    try {
        const urlObj = new URL(tabUrl);
        const pathParts = urlObj.pathname.split('/');

        // Check if the second path part exists and starts with '@'
        if (pathParts.length > 1 && pathParts[1].startsWith('@')) {
            let handlePart = pathParts[1]; // This might be URL-encoded
            let decodedHandlePart = handlePart;

            // Decode the potential handle part
            try {
                decodedHandlePart = decodeURIComponent(handlePart);
            } catch (e) {
                 console.warn("Could not decode handle part from URL:", handlePart, e);
                 // Keep original if decoding fails (e.g., invalid sequence)
            }

            // *** Use the UPDATED REGEX on the decoded part ***
            // Check if the decoded part matches '@' followed by non-slash, non-whitespace chars
            if (/^@[^\/\s]+$/.test(decodedHandlePart)) {
                 return decodedHandlePart; // Return the DECODED handle if it matches
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
                         if (!currentTab || currentTab.id !== tabs[0].id || (tabs[0].url && (!currentTab.url || currentTab.url !== tabs[0].url))) {
                            currentTab = tabs[0];
                            checkTabForYouTube(currentTab.url);
                        } else if (!onYoutube && currentTab && currentTab.url && isYoutube(currentTab.url)) {
                             checkTabForYouTube(currentTab.url);
                        }
                    } else {
                         if (onYoutube) {
                             onYoutube = false;
                             stopTime();
                         }
                         currentTab = null;
                    }
                });
            } else {
                if (onYoutube && !popupOpen) {
                    onYoutube = false;
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
            if (onYoutube && !popupOpen) {
			    onYoutube = false;
			    stopTime();
            }
		} else {
            chrome.tabs.query({ active: true, windowId: windowId }, function(tabs) {
                if (chrome.runtime.lastError) { console.warn("Error querying focused window tab:", chrome.runtime.lastError.message); return; }
                if (tabs && tabs[0]) {
                    currentTab = tabs[0];
                    checkTabForYouTube(currentTab.url);
                } else {
                    if(onYoutube) {
                        onYoutube = false;
                        stopTime();
                    }
                    currentTab = null;
                }
            });
		}
	} else {
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
                         checkTabForYouTube(currentTab.url);
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
            sendResponse({status: "Popup noted as open"});
			break;
		case "popupUnfocus":
			popupOpen = false;
            if (pauseOutOfFocus) checkBrowserFocus();
             sendResponse({status: "Popup noted as closed"});
			break;
		case "checkPageStatus":
			if (sender.tab && sender.tab.url && sender.tab.id) {
					const url = sender.tab.url;
					const tabId = sender.tab.id;
					const isHomepage = isYoutubeHomepage(url);

					isChannelWhitelisted(url, tabId).then(isWhitelisted => {
						const isOverridden = tempOverrideTabs.includes(tabId);
						const shouldOverlay = timeLeft <= 0 && !override && !noLimit && isYoutube(url) && !isWhitelisted && !isOverridden && !isHomepage;
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
			break;

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
            if (currentTab && currentTab.url) checkTabForYouTube(currentTab.url);
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
     return false; // Explicitly return false for synchronous message handlers by default
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
        // console.error("Error parsing URL for homepage check:", url, e); // Debugging
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
                 // console.log("No overrides left."); // Debugging
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
                     // console.log("Override activated for tab:", tabId); // Debugging
                     currentTab = senderTab;
                     checkTabForYouTube(senderTab.url);
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
function updateBadge() {
    if (!currentTab || !currentTab.url || !currentTab.id) {
         clearBadge();
         return;
    }

    isChannelWhitelisted(currentTab.url, currentTab.id).then(isWhitelisted => {
        if (isYoutube(currentTab.url)) {
            const isOverridden = tempOverrideTabs.includes(currentTab.id);
            if (isWhitelisted) {
                setWhitelistBadge();
            } else if (noLimit) {
                 chrome.action.setBadgeText({ "text": "∞" });
                 chrome.action.setBadgeBackgroundColor({ color: "#6c757d" });
            } else if (isOverridden) {
                setOverrideBadge();
            } else {
                 setTimerBadge();
            }
        } else {
            clearBadge();
        }
    }).catch(error => {
        console.error("Error updating badge:", error);
        clearBadge();
    });
}


async function updateTime() {
	if (timeLeft > 0) {
		timeLeft--;
	} else {
		timeLeft = 0;
        stopTime();

         if (currentTab && currentTab.id && currentTab.url && isYoutube(currentTab.url)) {
            const isWhitelisted = await isChannelWhitelisted(currentTab.url, currentTab.id);
            const isOverridden = tempOverrideTabs.includes(currentTab.id);
            const isHomepage = isYoutubeHomepage(currentTab.url);

            if (!isWhitelisted && !noLimit && !isOverridden && !isHomepage) {
                 chrome.tabs.sendMessage(currentTab.id, { msg: "showOverlay" }, (response) => {
                      if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                           console.warn("Could not send showOverlay message to tab:", currentTab.id, chrome.runtime.lastError.message);
                      }
                 });
            } else {
                 hideOverlayOnTab(currentTab.id);
            }
        }
        updateBadge();
		return;
	}

	chrome.storage.local.set({ "timeLeft": timeLeft }, () => {
         if (chrome.runtime.lastError) console.warn("Error saving timeLeft:", chrome.runtime.lastError.message);
    });
    updateBadge();

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

async function startTime() {
    // console.log("Attempting to start timer..."); // Debugging
    if (timer != null
        || timeLeft <= 0
        || noLimit
        || !currentTab || !currentTab.id
        || !currentTab.url
        || !isYoutube(currentTab.url)
        || isYoutubeHomepage(currentTab.url)
        || (currentTab && tempOverrideTabs.includes(currentTab.id))
       ) {
        // console.log("Start timer condition(s) not met."); // Debugging
        if (timer != null) {
             stopTime();
        }
        updateBadge();
        return;
    }

    try {
         const isWhitelisted = await isChannelWhitelisted(currentTab.url, currentTab.id);
         if (isWhitelisted) {
             // console.log("Start timer prevented: Whitelisted."); // Debugging
             updateBadge();
             return;
         }
    } catch (e) {
        console.error("Error checking whitelist in startTime:", e);
        return;
    }

    // console.log("Starting timer", timeLeft); // Debugging
    onYoutube = true;
    setTimerBadge();
    timer = setInterval(updateTime, 1000);
}


function stopTime() {
    // console.log("Stopping timer", timeLeft); // Debugging
    clearInterval(timer);
    timer = null;
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


function checkReset() {
    // console.log("Checking reset..."); // Debugging
    chrome.storage.local.get({"lastResetTimestamp": null, "resetTime":"00:00", "tempOverrideTabs": []}, function(data) {
        if (chrome.runtime.lastError) { console.error("Error getting storage for reset check:", chrome.runtime.lastError.message); return; }

        var today = new Date();
        var nowTimestamp = today.getTime();

        var resetTimeParts = data.resetTime.split(":");
        var resetHour = parseInt(resetTimeParts[0], 10);
        var resetMinute = parseInt(resetTimeParts[1], 10);

        if (isNaN(resetHour) || isNaN(resetMinute)) {
            console.warn("Invalid reset time format, defaulting to 00:00");
            resetHour = 0; resetMinute = 0;
        }

        var nextReset = new Date();
        nextReset.setHours(resetHour, resetMinute, 0, 0);
        if (nextReset <= today) {
            nextReset.setDate(nextReset.getDate() + 1);
        }
        var nextResetTimestamp = nextReset.getTime();

        var lastResetTimestamp = data.lastResetTimestamp || 0;

        if (nowTimestamp >= nextResetTimestamp && lastResetTimestamp < nextResetTimestamp) {
            console.log("Performing daily timer reset. Next reset was scheduled for:", nextReset.toLocaleString());
            chrome.storage.local.get({"timeLimit":30, "customizeLimits":false, "dayLimits":{}, "overrideLimit":5, "limitOverrides": true}, function(limitsData) {
                if (chrome.runtime.lastError) { console.error("Error getting limits for reset:", chrome.runtime.lastError.message); return; }

                var timeLimit = limitsData.timeLimit;
                var dayLimits = limitsData.dayLimits;
                var customizeLimits = limitsData.customizeLimits;

                var dayAfterReset = new Date(nextResetTimestamp);
                var dayName = days[dayAfterReset.getDay()];

                var noLimitTemp = false;
                if (customizeLimits) {
                    if (dayName in dayLimits) {
                        if (dayLimits[dayName] === false) noLimitTemp = true;
                        else timeLimit = dayLimits[dayName];
                    }
                }
                noLimit = noLimitTemp;

                let newTimeLeft = noLimit ? 0 : timeLimit * 60;
                timeLeft = newTimeLeft;
                override = false;
                tempOverrideTabs = [];

                const resetStorage = {
                    "lastResetTimestamp": nextResetTimestamp,
                    "override": false,
                    "timeLeft": newTimeLeft,
                    "tempOverrideTabs": [],
                };

                if (limitsData.limitOverrides) {
                    resetStorage.currentOverrideCount = limitsData.overrideLimit;
                } else {
                     chrome.storage.local.remove("currentOverrideCount");
                }


                chrome.storage.local.set(resetStorage, function() {
                    if (chrome.runtime.lastError) { console.error("Error saving reset state:", chrome.runtime.lastError.message); return; }

                    if (timer != null) {
                         stopTime();
                    } else {
                         updateBadge();
                    }
                    checkWindowsForTimerStart();

                    chrome.runtime.sendMessage({ msg: "checkDone", noLimit: noLimit }, response => {
                         if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                             console.warn("sendMessage error (checkDone):", chrome.runtime.lastError.message);
                         }
                    });
                     hideOverlayOnAllWindows();
                     console.log("Timer reset complete. TimeLeft:", newTimeLeft, "NoLimit:", noLimit);
                });
            });
        } else {
             // console.log("No reset needed. Now:", today.toLocaleString(), "Next Reset:", nextReset.toLocaleString(), "Last Reset:", new Date(lastResetTimestamp).toLocaleString()); // Debugging
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


function urlNoTime(url) {
    if (!url) return null;
	let arr = url.split("&t=");
	return arr.length >= 1 ? arr[0] : url;
}

// Modify checkTabForYouTube to consolidate logic and use await for whitelist check
async function checkTabForYouTube(url) {
    // console.log("Checking tab:", url); // Debugging
    if (!currentTab || !currentTab.id) {
         // console.log("checkTabForYouTube: No current tab or ID."); // Debugging
         clearBadge();
         if (onYoutube) { onYoutube = false; stopTime(); }
        return;
    }
    if (!url) {
        // console.log("checkTabForYouTube: No URL provided."); // Debugging
        clearBadge();
         if (onYoutube) { onYoutube = false; stopTime(); }
        return;
    }

    const tabId = currentTab.id;
    const isCurrentlyYoutube = isYoutube(url);
    const isHomepage = isYoutubeHomepage(url);
    let isWhitelisted = false;
    let isOverridden = tempOverrideTabs.includes(tabId);

    if (isCurrentlyYoutube) {
        try {
            isWhitelisted = await isChannelWhitelisted(url, tabId);
        } catch (e) {
            console.error("Error checking whitelist in checkTabForYouTube:", e);
            isWhitelisted = false;
        }
    }

    if (isCurrentlyYoutube) {
        if (isWhitelisted) {
            if (onYoutube) { onYoutube = false; stopTime(); }
            hideOverlayOnTab(tabId);
        } else if (noLimit) {
            if (onYoutube) { onYoutube = false; stopTime(); }
            hideOverlayOnTab(tabId);
        } else if (isOverridden) {
             if (onYoutube) { onYoutube = false; stopTime(); }
             hideOverlayOnTab(tabId);
        } else if (isHomepage) {
             if (onYoutube) {
                 onYoutube = false;
                 stopTime();
             }
             hideOverlayOnTab(tabId);

        } else if (timeLeft <= 0) {
             if (onYoutube) { onYoutube = false; stopTime(); }
             chrome.tabs.sendMessage(tabId, { msg: "showOverlay" }, response => {
                  if (chrome.runtime.lastError && !chrome.runtime.lastError.message.includes("Could not establish connection") && !chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                       console.warn("Could not send showOverlay message to tab:", tabId, chrome.runtime.lastError.message);
                  }
             });
        } else {
             if (!onYoutube) {
                 onYoutube = true;
                 if (!pauseOutOfFocus) {
                     startTime();
                 } else {
                     chrome.windows.getLastFocused({ populate: false }, function(window) {
                         if (window && window.focused && currentTab && window.id === currentTab.windowId) {
                             startTime();
                         } else {
                             onYoutube = false;
                             updateBadge();
                         }
                     });
                 }
             } else {
                 updateBadge();
             }
             hideOverlayOnTab(tabId);
        }
    } else {
        if (onYoutube) {
            if (pauseOutOfFocus || popupOpen) {
                onYoutube = false; stopTime();
            } else {
                checkWindowsForTimerStop();
            }
        }
        if (isOverridden) {
             const index = tempOverrideTabs.indexOf(tabId);
             if (index !== -1) {
                 tempOverrideTabs.splice(index, 1);
                 chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
                 // console.log("Removed tab", tabId, "from tempOverrideTabs on navigating away."); // Debugging
             }
        }
    }

    updateBadge();

} // End checkTabForYouTube


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

async function checkWindowsForTimerStart() {
    // console.log("checkWindowsForTimerStart called"); // Debugging
    if (timer != null || noLimit || timeLeft <= 0) {
        // console.log("checkWindowsForTimerStart: Timer already running, noLimit, or time is up."); // Debugging
        return;
    }

    try {
        const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
        let nonWhitelistedYoutubeOpen = false;
        let activeTabIsEligible = false;

        for (let tab of tabs) {
            if (tab && tab.url && tab.id && isYoutube(tab.url) && !isYoutubeHomepage(tab.url)) {
                let isTabOverridden = tempOverrideTabs.includes(tab.id);
                if (isTabOverridden) continue;

                const isWhitelisted = await isChannelWhitelisted(tab.url, tab.id);
                if (!isWhitelisted) {
                    nonWhitelistedYoutubeOpen = true;
                    if (currentTab && currentTab.id === tab.id) {
                        activeTabIsEligible = true;
                    }
                    if (!pauseOutOfFocus) break;
                }
            }
        }

         if (nonWhitelistedYoutubeOpen) {
              if (!pauseOutOfFocus) {
                  if (!onYoutube) {
                      onYoutube = true;
                      startTime();
                  }
              } else {
                  if (activeTabIsEligible && !onYoutube) {
                      onYoutube = true;
                       startTime();
                  } else if (!activeTabIsEligible && onYoutube) {
                       onYoutube = false;
                       stopTime();
                  }
              }
         } else if (onYoutube) {
              onYoutube = false;
              stopTime();
         }

    } catch (error) {
         console.error("Error querying tabs for timer start:", error);
    }
}


async function checkWindowsForTimerStop() {
    // console.log("checkWindowsForTimerStop called"); // Debugging
    if (pauseOutOfFocus || timer == null) return;

	try {
        const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
		let nonWhitelistedYoutubeOpen = false;

		for (let tab of tabs) {
			if (tab && tab.url && tab.id && isYoutube(tab.url) && !isYoutubeHomepage(tab.url)) {
                let isTabOverridden = tempOverrideTabs.includes(tab.id);
                if (isTabOverridden) continue;

                const isWhitelisted = await isChannelWhitelisted(tab.url, tab.id);
                 if (!isWhitelisted) {
				    nonWhitelistedYoutubeOpen = true;
				    break;
                 }
			}
		}
		if (!nonWhitelistedYoutubeOpen && onYoutube) {
			onYoutube = false;
			stopTime();
		}
	} catch (error) {
        console.error("Error querying tabs for timer stop:", error);
    }
}

setupResetCheckAlarm();