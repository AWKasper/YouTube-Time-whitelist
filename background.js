chrome.runtime.onInstalled.addListener(function (object) {
	if (object.reason === chrome.runtime.OnInstalledReason.INSTALL) {
		chrome.tabs.create({url: "/pages/options.html"});
	}
});

// Default values
var override = false;
var onYoutube = false;
var timeLeft = 1800;
var currentTab;
var popupOpen = false;
var pauseOutOfFocus = true;
var youtubekidsEnabled = true;
var checkBrowserFocusTimer = null;
var timer = null;
var noLimit = false;
var whitelistedHandles = [];

// chrome.storage.local.set({"lastDate":(new Date().getDate()-1).toString()}); //for debugging

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
    // IMPORTANT: Ensure options.js saves to "whitelistedHandles" now
    chrome.storage.local.get({ "whitelistedHandles": [] }, function(data) {
        whitelistedHandles = data.whitelistedHandles;
        // console.log("Whitelist cache updated:", whitelistedHandles);
    });
}

// Call this function initially and whenever the storage might change
updateWhitelistCache();
// Also, listen for storage changes to keep the cache updated
chrome.storage.onChanged.addListener(function(changes, namespace) {
	if (namespace === 'local' && changes.whitelistedHandles) { // Changed key name
	  updateWhitelistCache();
	}
});

chrome.storage.local.get({"override":override, "pauseOutOfFocus":pauseOutOfFocus, "youtubekidsEnabled":youtubekidsEnabled}, function(data) {
	override = data.override;
	pauseOutOfFocus = data.pauseOutOfFocus;
	youtubekidsEnabled = data.youtubekidsEnabled;

	if (pauseOutOfFocus) {
		checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);
	}
});

chrome.storage.local.get({"timeLeft":timeLeft}, function(data) {
	var time = data.timeLeft;
	if (!Number.isNaN(time))
		timeLeft = time;
	else {
		chrome.storage.local.get({"timeLimit":30}, function(data) {
			timeLeft = data.timeLimit*60;
		});
	}
});

chrome.tabs.onActivated.addListener(function(activeInfo) {
	checkReset();
	chrome.tabs.get(activeInfo.tabId, function(tab){
		currentTab = tab;
		checkTabForYouTube(tab.url)
	});
});

chrome.tabs.onUpdated.addListener(function(tabId, changedInfo, tab) {
	checkReset();
	if(tab.active && changedInfo.url){
		currentTab = tab;
		checkTabForYouTube(changedInfo.url)
	}
});

chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
	if (tabId) {
		// Removes id of closed tab from savedVideoURLs and tempOverrideTabs (if present)
		chrome.storage.local.get({savedVideoURLs:{}, tempOverrideTabs:[]}, function(data) {
			delete data.savedVideoURLs[tabId];

			var index = data.tempOverrideTabs.indexOf(tabId);
			if (index !== -1)
				data.tempOverrideTabs.splice(index, 1);
			chrome.storage.local.set({savedVideoURLs: data.savedVideoURLs, tempOverrideTabs: data.tempOverrideTabs});
		});
	}
});

function getHandleFromUrl(tabUrl) {
    if (!tabUrl) return null;
    try {
        const urlObj = new URL(tabUrl);
        const pathParts = urlObj.pathname.split('/');
        // Look for /@handle format
        if (pathParts.length > 1 && pathParts[1].startsWith('@')) {
            // Basic validation: ensure it's just the handle part
            if (/^@[\w.-]+$/.test(pathParts[1])) {
                 return pathParts[1]; // e.g., "@username"
            }
        }
        // Add checks for other potential URL structures if needed
    } catch (e) {
        // console.error("Error parsing URL for handle:", e);
    }
    return null;
}

function checkBrowserFocus(){
	if(typeof timer != 'undefined') {
		chrome.windows.getLastFocused(function(window){
			if(window && window.focused) {
				if(!onYoutube) {
					var getInfo = {populate: true};
					chrome.windows.getLastFocused(getInfo, function(window) {
						for(var i = 0; i < window.tabs.length; i++) {
							if(window.tabs[i].active) {
								checkTabForYouTube(window.tabs[i].url)
							}
						}
					});
				}
			} else {
				if (popupOpen) {
					var getInfo = {populate: true};
					chrome.windows.getLastFocused(getInfo, function(window) {
						for(var i = 0; i < window.tabs.length; i++) {
							if(window.tabs[i].active) {
								checkTabForYouTube(window.tabs[i].url)
							}
						}
					});
				} else if (onYoutube) {
					onYoutube = false;
					stopTime();
				}

		  	}
		})
	}
}

chrome.windows.onFocusChanged.addListener(function(windowId) {
	checkReset();

	if (pauseOutOfFocus) {
		if(windowId == chrome.windows.WINDOW_ID_NONE && typeof timer != 'undefined' && onYoutube) {
			if (popupOpen)
				return;

			onYoutube = false;
			stopTime();
		} else if(windowId != chrome.windows.WINDOW_ID_NONE) {
			var getInfo = {populate: true};
			chrome.windows.getLastFocused(getInfo, function(window) {
				for(var i = 0; i < window.tabs.length; i++) {
					if(window.tabs[i].active) {
						checkTabForYouTube(window.tabs[i].url)
					}
				}
			});
		}
	}
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
	switch(request.msg) {
		case "override":
			override = request.value;
			// console.log("override")
			chrome.storage.local.get({"savedVideoURLs":{}, "tempOverrideTabs":[]}, function(data) {
				// Effectively setting tempOverride to true for currentTab
				// (by adding the tab id to the tempOverrideTabs array)
				var tempOverrideTabs = data.tempOverrideTabs;
                // Ensure currentTab and its id exist before pushing
				if(currentTab && currentTab.id) {
				    tempOverrideTabs.push(currentTab.id);
				} else {
				    console.warn("Cannot override: currentTab is invalid.");
				    // Maybe return or handle this state appropriately
				    return;
				}

				var savedVideoURLs = data.savedVideoURLs;
				if (!savedVideoURLs[currentTab.id])
					savedVideoURLs[currentTab.id] = "https://www.youtube.com/"; // Placeholder if no URL saved

				chrome.storage.local.set({"override":request.value, "tempOverrideTabs":tempOverrideTabs, "savedVideoURLs":savedVideoURLs}, function() {
				    // Ensure we redirect only if a valid URL was saved and tab exists
                    chrome.tabs.get(currentTab.id, function(tab) {
                         if (tab && !chrome.runtime.lastError) {
                            if(savedVideoURLs[currentTab.id] && savedVideoURLs[currentTab.id] !== "https://www.youtube.com/") {
                                chrome.tabs.update(currentTab.id, {url: savedVideoURLs[currentTab.id]});
                            } else {
                                // Fallback if no valid URL was saved
                                chrome.tabs.update(currentTab.id, {url: "youtube.com"});
                            }
                        }
                    });
				});
			});
			break;
		case "checkReset":
			checkReset();
			break;
		case "timeLimitUpdated":
			chrome.storage.local.get({"timeLeft":timeLeft}, function(data) {
				timeLeft = data.timeLeft;
			});
			break;
		case "popupOpen":
			popupOpen = true;
			break;
		case "popupUnfocus":
			popupOpen = false;
			break;
		case "pauseOutOfFocus":
			if (request.val == true) {
				pauseOutOfFocus = true;
				if (checkBrowserFocusTimer == null)
					checkBrowserFocusTimer = setInterval(checkBrowserFocus, 1000);

				if(typeof timer != 'undefined') {
					// stop timer because active window must be settings page
					onYoutube = false;
					stopTime();
				}
			} else {
				pauseOutOfFocus = false;
				clearInterval(checkBrowserFocusTimer);
				checkBrowserFocusTimer = null;

				// see if window is open that has YouTube
				checkWindowsForTimerStart();
			}
			break;
		case "youtubekidsEnabled":
			if (request.val == true) {
				youtubekidsEnabled = true;

				if (!pauseOutOfFocus) {
					// In case youtubekids.com is currently active in another window
					checkWindowsForTimerStart();
				}
			} else {
				youtubekidsEnabled = false;

				if (!pauseOutOfFocus) {
					// In case no youtube.com tabs are active
					// (timer was only running because of youtubekids.com tab(s))
					checkWindowsForTimerStop();
				}
			}
			break;
		case "resetTimeUpdated":
			chrome.storage.local.get({"resetTime":"00:00"}, function(data) {
				var now = new Date();
				var resetTime = data.resetTime.split(":");
				var resetHour = parseInt(resetTime[0]);
				var resetMinute = parseInt(resetTime[1]);
				if (now.getHours() <= resetHour && now.getMinutes() < resetMinute) {
					// Ensures that time resets when changing resetTime to time in the future
					// Allows user to test different reset times and see the timer reset
					chrome.storage.local.set({"lastDate":"-1"});
				}
			});
			break;
		case "noLimitInputChange":
			var today = new Date();
			var day = days[today.getDay()];
			if (request.day == day) { // day is today
				chrome.storage.local.get({"dayLimits":{}, "timeLimit":30}, function(data) {
					if (day in data.dayLimits && data.dayLimits[day] === false) {
						noLimit = true;
						if (timer != null)
							stopTime();
					} else {
						noLimit = false;
						timeLeft = data.timeLimit*60;
						chrome.storage.local.set({"timeLeft": timeLeft}, function() {
							if (!pauseOutOfFocus) {
								// In case youtube is currently active in another window
								checkWindowsForTimerStart();
							}
						});
					}
				});
			}
			break;
		case "dayTimeLimitUpdated":
			var today = new Date();
			var day = days[today.getDay()];
			if (request.day == day) { // day is today
				chrome.storage.local.get({"dayLimits":{}}, function(data) {
				    if(day in data.dayLimits && data.dayLimits[day] !== false) { // Ensure it's not 'no limit'
					    timeLeft = data.dayLimits[day]*60;
					    chrome.storage.local.set({"timeLeft": timeLeft});
					}
				});
			}
			break;
		case "customizeLimitsFalse":
		    noLimit = false; // Reset noLimit flag when customization is turned off
			chrome.storage.local.get({"timeLimit":30}, function(data) {
				timeLeft = data.timeLimit*60;
				chrome.storage.local.set({"timeLeft": timeLeft});
				// Check if YouTube is open and timer should start
				checkWindowsForTimerStart();
			});
			break;
        // Add default case or handle unknown messages if necessary
        default:
            console.log("Received unknown message:", request.msg);
            break;
	}

});

function isYoutube(url) {
    if (!url) return false; // Add check for undefined/null URL
	// regex based on https://stackoverflow.com/a/32730577
	if (youtubekidsEnabled)
		return url.match(/(https?:\/\/(?!music\.)(.+?\.)?youtube(kids)?\.com(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/)
	return url.match(/(https?:\/\/(?!music\.)(.+?\.)?youtube\.com(\/[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/)
}

function isYoutubeVideo(url) {
    if (!url) return false; // Add check for undefined/null URL
	if (youtubekidsEnabled)
		return url.match(/(https?:\/\/(?!music\.)(.+?\.)?youtube(kids)?\.com\/watch([A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/)
	return url.match(/(https?:\/\/(?!music\.)(.+?\.)?youtube\.com\/watch([A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/)
}

function updateTime() {
	if (timeLeft > 0) {
		timeLeft--;
	} else {
		clearInterval(timer);
		timer = null;
		blockRedirect(); // Call blockRedirect when time hits 0
		return; // Stop further execution in this tick after blocking
	}

	// Use chrome.action API for badge updates in MV3
	chrome.action.setBadgeText({"text": formatTime(timeLeft)});
    // Optional: Set a background color for the badge when the timer is active
    chrome.action.setBadgeBackgroundColor({color: "#FF0000"});

	chrome.storage.local.set({"timeLeft":timeLeft});

	// Directly send the message. If popup isn't open, it's okay.
	chrome.runtime.sendMessage({
		msg: "updateTime",
		time: timeLeft
	}, function(response) {
        // Optional: Check for the specific error to avoid logging it, but otherwise ignore.
        if (chrome.runtime.lastError && chrome.runtime.lastError.message === "Could not establish connection. Receiving end does not exist.") {
           // Expected error when popup is not open, ignore silently.
        } else if (chrome.runtime.lastError) {
            // Log other unexpected errors
            console.warn("sendMessage error:", chrome.runtime.lastError.message);
        }
	});

	// Consider if checkReset() needs to run every second. Maybe less often?
	checkReset();
}

function startTime() {
	if (timer != null || noLimit || override || timeLeft <= 0) return; // Don't start if already running, no limit, override, or time is up
	// console.log("start", timeLeft)
	// Use chrome.action instead of chrome.browserAction
	chrome.action.setBadgeBackgroundColor({color: "#FF0000"}); // Red background for timer
	chrome.action.setBadgeText({"text": formatTime(timeLeft)});
	timer = setInterval(updateTime, 1000);
}

function stopTime() {
	// console.log("stopped", timeLeft)
	clearInterval(timer);
	timer = null;
	// Use chrome.action instead of chrome.browserAction
	chrome.action.setBadgeText({"text": ""});
}

function formatTime(totalSeconds) {
	var hours = Math.floor(totalSeconds / 3600);
	totalSeconds %= 3600; // Use modulo
	var minutes =  Math.floor(totalSeconds / 60);
	totalSeconds %= 60; // Use modulo
	var seconds =  Math.floor(totalSeconds);

	var result = "";
	if (hours > 0) {
		result += hours + ":";
		if (minutes < 10) result += "0"; // Add leading zero
		result += minutes;
	} else {
		result += minutes;
	}

	result += ":"; // Always show separator before seconds
	if (seconds < 10) result += "0"; // Add leading zero
	result += seconds;


	return result;
}

function blockRedirect() {
    // console.log("blockRedirect");
    if (!currentTab || !currentTab.id) {
        console.error("Cannot block redirect, currentTab is invalid.");
        return;
    }

    const tabIdToBlock = currentTab.id;
    const urlToBlock = currentTab.url;

    chrome.storage.local.get({"savedVideoURLs":{}}, function(data) {
        var videoURLs = data.savedVideoURLs || {}; // Ensure object exists

        if (isYoutubeVideo(urlToBlock)) {
            // Send message to the specific tab to get its current URL with time
            chrome.tabs.sendMessage(tabIdToBlock, {msg: "saveVideoURL"}, function(response) {
                // Check if response exists (content script might not be ready/injected)
                if (chrome.runtime.lastError) {
                    console.warn("Could not get video URL from content script:", chrome.runtime.lastError.message);
                    // Fallback: save the URL without the timestamp
                    videoURLs[tabIdToBlock] = urlNoTime(urlToBlock);
                } else if (response) {
                    videoURLs[tabIdToBlock] = response;
                } else {
                     videoURLs[tabIdToBlock] = urlNoTime(urlToBlock); // Fallback if response is empty
                }

                chrome.storage.local.set({"savedVideoURLs": videoURLs}, function() {
                    // Verify tab still exists before updating
                    chrome.tabs.get(tabIdToBlock, function(tab) {
                        if (tab && !chrome.runtime.lastError) {
                            chrome.tabs.update(tabIdToBlock, {url: "/pages/blocked.html"});
                        } else {
                           // console.log("Tab closed before redirection could complete.");
                        }
                    });
                });
            });
        } else {
            // If not on a YouTube video, just save the current URL
            videoURLs[tabIdToBlock] = urlToBlock;
            chrome.storage.local.set({"savedVideoURLs": videoURLs}, function() {
                 // Verify tab still exists before updating
                chrome.tabs.get(tabIdToBlock, function(tab) {
                    if (tab && !chrome.runtime.lastError) {
                        chrome.tabs.update(tabIdToBlock, {url: "/pages/blocked.html"});
                    } else {
                       // console.log("Tab closed before redirection could complete.");
                    }
                });
            });
        }
    });
}


function checkReset() {
	chrome.storage.local.get({"lastDate":null, "resetTime":"00:00"}, function(data) {
		var today = new Date();
		var resetTimeParts = data.resetTime.split(":");
		var resetHour = parseInt(resetTimeParts[0], 10);
		var resetMinute = parseInt(resetTimeParts[1], 10);

		// Check if reset time is valid
		if (isNaN(resetHour) || isNaN(resetMinute)) {
		    resetHour = 0;
		    resetMinute = 0;
		}

		// Determine the last reset date/time
		var lastReset = new Date();
		if (data.lastDate) {
            // Attempt to reconstruct the last reset date more accurately
            // This logic assumes reset happens *after* the reset time on a given day.
            // If reset time is 00:00, it resets when the day ticks over.
		    lastReset.setDate(parseInt(data.lastDate, 10)); // Set the day
		    // If the stored date is today, but the current time is before the reset time,
            // the actual last reset was *yesterday* after the reset time.
            if (today.getDate().toString() === data.lastDate &&
               (today.getHours() < resetHour || (today.getHours() === resetHour && today.getMinutes() < resetMinute))) {
                 lastReset.setDate(lastReset.getDate() - 1);
            }
		} else {
            // If no lastDate, assume last reset was long ago
            lastReset.setDate(today.getDate() - 2); // Set to two days ago to ensure reset happens
		}
		lastReset.setHours(resetHour, resetMinute, 0, 0); // Set to the reset time on that day


		// Determine the next reset time
        var nextReset = new Date();
        nextReset.setHours(resetHour, resetMinute, 0, 0);
        if (nextReset <= today) { // If reset time for today has already passed
            nextReset.setDate(nextReset.getDate() + 1); // Next reset is tomorrow
        }

        // --- Perform Reset if needed ---
		if (today >= nextReset && lastReset < nextReset) { // Reset if current time is past the next reset and the last reset was before it
			chrome.storage.local.get({"timeLimit":30, "customizeLimits":false, "dayLimits":{}}, function(data) {
				var timeLimit = data.timeLimit;
				var dayLimits = data.dayLimits;

				var noLimitTemp = false;
				if (data.customizeLimits) {
					var day = days[today.getDay()];
					if (day in dayLimits) {
						if (dayLimits[day] === false) {
							noLimitTemp = true;
						} else {
							timeLimit = dayLimits[day];
						}
					}
				}
				noLimit = noLimitTemp; // Update global noLimit flag

				if (noLimit && timer != null) stopTime(); // Stop timer if today is unlimited

				chrome.storage.local.set({
					"lastDate":today.getDate().toString(), // Store today's date as the last reset date
					"override":false,
					"timeLeft": noLimit ? 0 : timeLimit*60, // Set time to 0 if noLimit, else use limit
					"savedVideoURLs":{},
					"tempOverrideTabs":[]
				}, function() {
				    override = false; // Update global override flag
                    timeLeft = noLimit ? 0 : timeLimit*60; // Update global timeLeft
					chrome.runtime.sendMessage({
						msg: "checkDone",
						noLimit: noLimit
					});
					// If timer was stopped due to noLimit, ensure badge is cleared
					if (noLimit) chrome.action.setBadgeText({"text": ""});
				});


				// Reset number of available overrides for today
				chrome.storage.local.get({"overrideLimit":5}, function(data) {
					chrome.storage.local.set({"currentOverrideCount": data.overrideLimit});
				});

			});

		} else {
			// If no reset needed, still inform popup/options
			chrome.runtime.sendMessage({
				msg: "checkDone",
				noLimit: noLimit
			});
		}
	});
}

function checkOverride(url) {
	// console.log("check override")
	// checks if youtube page navigated to has been allowed
	// if not, user will be redirected back to block page

	// allows user to override and go back to most recent video
	// but not go to any other videos
	if (!currentTab || !currentTab.id) return; // Safety check

	chrome.storage.local.get({savedVideoURLs:{}, tempOverrideTabs:[]}, function(data) {
		// console.log("current url: " + url);
		// console.log("allowed url: " + data.savedVideoURLs);

		var videoURLs = data.savedVideoURLs || {};
		var tempOverrideTabs = data.tempOverrideTabs || [];

		var urlMatch = false;
		// Check if the current tab's ID has an associated allowed URL
        if (videoURLs[currentTab.id] && urlNoTime(videoURLs[currentTab.id]) === urlNoTime(url)) {
             urlMatch = true;
        }
		// // Old logic iterating through all saved URLs - less efficient and might allow wrong tab access
		// for (var tabId in videoURLs) {
		// 	if (urlNoTime(videoURLs[tabId]) == urlNoTime(url)) {
		// 		urlMatch = true;
		// 		break;
		// 	}
		// }

		var tempOverride = tempOverrideTabs.includes(currentTab.id);

		if (!urlMatch || !tempOverride) {
		    // If URL doesn't match the one specifically allowed for this tab, or tempOverride isn't active for this tab
			videoURLs[currentTab.id] = url; // Update the saved URL for this tab to the current one (which will be blocked)

			// Effectively setting tempOverride to false for currentTab
			// (by removing the tab id from the tempOverrideTabs array)
			var index = tempOverrideTabs.indexOf(currentTab.id);
			if (index !== -1)
				tempOverrideTabs.splice(index, 1);

			chrome.storage.local.set({savedVideoURLs: videoURLs, tempOverrideTabs: tempOverrideTabs}, function() {
			    // Verify tab still exists before updating
                chrome.tabs.get(currentTab.id, function(tab) {
                    if (tab && !chrome.runtime.lastError) {
				        chrome.tabs.update(currentTab.id, {url: "/pages/blocked.html"});
                    }
                });
			});

		}

	});
}

function urlNoTime(url) {
    if (!url) return null;
	let arr = url.split("&t=");
	if (arr.length >= 1) {
		return arr[0];
	}
	return url; // Return original url if no timestamp
}

async function checkTabForYouTube(url) {
    // console.log("checkTabForYouTube", url)
    if (!url) return; // Don't process if URL is invalid

    const isCurrentlyYoutube = isYoutube(url);
    const isWhitelisted = await isChannelWhitelisted(url); // Check whitelist status

    // --- Logic based on current state and whitelist status ---

    if (isCurrentlyYoutube) {
        if (isWhitelisted) {
            // On a whitelisted YouTube page
            // console.log("On whitelisted channel/video.");
            if (onYoutube) { // If timer is running, stop it (or check other tabs if focus doesn't matter)
                if (pauseOutOfFocus || popupOpen) { // Stop immediately if focus matters or popup is open
                    onYoutube = false;
                    stopTime();
                } else {
                    checkWindowsForTimerStop(); // Check if other non-whitelisted tabs are active
                }
            }
            // Ensure override doesn't block navigation *between* whitelisted pages
            if (override) {
                 // If override is on, but we are on a whitelisted page, remove current tab from temp override if necessary
                 // This prevents the block page from appearing when navigating from an overridden page *to* a whitelisted one.
                 chrome.storage.local.get({ tempOverrideTabs:[] }, function(data) {
                     var tempOverrideTabs = data.tempOverrideTabs || [];
                     var index = tempOverrideTabs.indexOf(currentTab.id);
                     if (index !== -1) {
                         tempOverrideTabs.splice(index, 1);
                         chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
                        // console.log("Removed tab from tempOverride as it's whitelisted.");
                     }
                 });
            }
        } else {
            // On a non-whitelisted YouTube page
            if (noLimit) {
                // console.log("No limit today.");
                if(onYoutube) { // Ensure timer is stopped if it was running
                     onYoutube = false;
                     stopTime();
                }
                return; // Do nothing if no limit today
            }

            if (timeLeft <= 0 && !override) {
                 // console.log("Time is up, blocking.");
                 blockRedirect(); // Redirect immediately if time is up
                 return;
            }

            if (override) {
                // console.log("Override is active, checking navigation.");
                checkOverride(url); // Check if navigation is allowed under override rules
            } else if (!onYoutube) {
                // console.log("Starting timer.");
                onYoutube = true;
                startTime(); // Start timer if not running, not overridden, and time > 0
            } else {
               // console.log("Timer already running.");
               // Timer is already running correctly for this non-whitelisted page
            }
        }
    } else {
        // Not on a YouTube page
        // console.log("Not on YouTube.");
        if (onYoutube && !override) { // Only stop if timer is running and not in override mode
            if (pauseOutOfFocus || popupOpen) { // Stop immediately if focus matters or popup is open
                onYoutube = false;
                stopTime();
            } else {
                checkWindowsForTimerStop(); // Check if other YT tabs are keeping the timer alive
            }
        }
        // If override is on, leaving YouTube should potentially deactivate temp override for this tab
         if (override) {
             chrome.storage.local.get({ tempOverrideTabs:[] }, function(data) {
                 var tempOverrideTabs = data.tempOverrideTabs || [];
                 var index = tempOverrideTabs.indexOf(currentTab.id);
                 if (index !== -1) {
                     tempOverrideTabs.splice(index, 1);
                     chrome.storage.local.set({ tempOverrideTabs: tempOverrideTabs });
                    // console.log("Left YouTube, removed tab from tempOverride.");
                 }
             });
        }
    }
}


// Function to extract channel ID from URL (basic example)
function getChannelIdFromUrl(tabUrl) {
    if (!tabUrl) return null;
    try {
        const urlObj = new URL(tabUrl);
        const pathParts = urlObj.pathname.split('/');

        // Look for /channel/UC...
        const channelIndex = pathParts.findIndex(part => part === 'channel');
        if (channelIndex !== -1 && pathParts.length > channelIndex + 1 && pathParts[channelIndex + 1].startsWith('UC') && pathParts[channelIndex + 1].length === 24) {
             return pathParts[channelIndex + 1];
        }

        // Look for /c/ChannelName or /user/UserName - less reliable for getting the actual ID
        // The content script method is preferred for these cases.

    } catch (e) {
        // console.error("Error parsing URL for channel ID:", e);
    }
    return null; // Return null if no standard channel ID found directly in the URL path
}

// Updated function to check whitelist based on @handle
async function isChannelWhitelisted(tabUrl) {
    // 1. Check direct URL for /@handle
    const handleFromUrl = getHandleFromUrl(tabUrl);
    if (handleFromUrl && whitelistedHandles.includes(handleFromUrl)) {
        // console.log(`Handle ${handleFromUrl} from URL is whitelisted.`);
        return true;
    }

    // 2. If it's a video page, ask the content script for the handle
    if (isYoutubeVideo(tabUrl) && currentTab && currentTab.id) {
        try {
            // Send message to get the handle from the page content
            const response = await chrome.tabs.sendMessage(currentTab.id, { msg: "getChannelHandleFromPage" });
            if (response && response.channelHandle && whitelistedHandles.includes(response.channelHandle)) {
                // console.log(`Handle ${response.channelHandle} from video page content script is whitelisted.`);
                return true;
            }
        } catch (e) {
             if (!e.message.includes("Could not establish connection") && !e.message.includes("Receiving end does not exist")) {
                // console.warn("Error messaging content script for channel handle:", e);
             }
        }
    }

    // console.log("URL/Handle not found in whitelist:", tabUrl);
    return false;
}

async function checkWindowsForTimerStart() { // Make async
	if (timer != null || noLimit || override || timeLeft <= 0) return; // Added checks

	chrome.tabs.query({active: true, windowType: "normal"}, async function(tabs) { // make callback async, query only normal windows
	    if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError); return; } // Error check

		var nonWhitelistedYoutubeOpen = false;
		for (var i = 0; i < tabs.length; i++) {
		    // Check if tab exists and has a URL before processing
			if (tabs[i] && tabs[i].url && isYoutube(tabs[i].url)) {
                const isWhitelisted = await isChannelWhitelisted(tabs[i].url); // Check whitelist
                if (!isWhitelisted) {
				    nonWhitelistedYoutubeOpen = true;
				    break; // Found one non-whitelisted YouTube tab, no need to check further
                }
			}
		}
		if (nonWhitelistedYoutubeOpen && !onYoutube) { // Start only if not already running
			onYoutube = true;
			startTime();
		}
		// Removed the 'else if' that stopped the timer here, checkWindowsForTimerStop handles stopping
	});
}

async function checkWindowsForTimerStop() { // Make async
    if (timer == null) return; // Don't check if timer isn't running

	chrome.tabs.query({active: true, windowType: "normal"}, async function(tabs) { // make callback async, query only normal windows
        if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError); return; } // Error check

		var nonWhitelistedYoutubeOpen = false;
		for (var i = 0; i < tabs.length; i++) {
		     // Check if tab exists and has a URL before processing
			if (tabs[i] && tabs[i].url && isYoutube(tabs[i].url)) {
                 const isWhitelisted = await isChannelWhitelisted(tabs[i].url); // Check whitelist
                 if (!isWhitelisted) {
				    nonWhitelistedYoutubeOpen = true;
				    break; // Found one non-whitelisted YouTube tab, timer should keep running
                 }
			}
		}
		if (!nonWhitelistedYoutubeOpen && onYoutube) { // Stop only if timer is running AND no active non-whitelisted YT tabs are found
			onYoutube = false;
			stopTime();
		}
		// Removed the 'else if' that started the timer here, checkWindowsForTimerStart handles starting
	});
}