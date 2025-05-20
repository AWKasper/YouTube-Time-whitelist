// options.js

ga('send', 'pageview', '/options.html');

const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

let settingsChanged = false; // Flag to track unsaved changes
const statusMessageEl = document.getElementById('statusMessage'); // For showing save status

// Regex for standalone YouTube handles (e.g., @handle or @%encoded%)
const STANDALONE_HANDLE_REGEX = /^(@[^/?#\s]{3,})$/;
// Regex for standalone YouTube Channel IDs (e.g., UC...)
const STANDALONE_CHANNEL_ID_REGEX = /^(UC[a-zA-Z0-9_-]{22})$/;


// --- Utility Functions ---
function setSettingsChanged() {
	settingsChanged = true;
    statusMessageEl.textContent = ''; // Clear status on new change
}

function clearStatusMessage() {
    setTimeout(() => {
        statusMessageEl.textContent = '';
    }, 3000); // Clears the message after 3 seconds
}

// --- Load Initial Settings ---

function loadSettings() {
    chrome.storage.local.get({
        "timeLimit": 30,
        "customizeLimits": false,
        "dayLimits": {},
        "resetTime": "00:00",
        "limitOverrides": true,
        "overrideLimit": 5,
        "pauseOutOfFocus": true,
        "youtubekidsEnabled": true,
        "whitelistedHandles": [] // This will store both decoded handles and IDs
    }, function(data) {
        if (chrome.runtime.lastError) {
             console.error("Error loading settings:", chrome.runtime.lastError);
             statusMessageEl.textContent = 'Error loading settings.';
             return;
        }
        // General Time Limit
        $("#minutes").val(data.timeLimit);

        // Customize Limits Checkbox & Section
        $('#customizeLimits').prop('checked', data.customizeLimits);
        if (data.customizeLimits) {
            $("#customLimitsDiv").show();
            $("#minutes").prop("disabled", true);
            populateDayLimits(data.dayLimits, data.timeLimit);
        } else {
            $("#customLimitsDiv").hide();
            $("#minutes").prop("disabled", false);
        }

        // Reset Time
        $("#time").val(data.resetTime);

        // Limit Overrides Checkbox & Section
        $('#limitOverrides').prop('checked', data.limitOverrides);
        if (data.limitOverrides) {
            $('#overrideLimitRow').css("visibility", "visible");
            $("#overrideLimit").val(data.overrideLimit);
        } else {
            $('#overrideLimitRow').css("visibility", "hidden");
        }

        // Pause Out of Focus
        $('#pauseOutOfFocus').prop('checked', data.pauseOutOfFocus);

        // YouTube Kids Enabled
        $('#youtubekidsEnabled').prop('checked', data.youtubekidsEnabled);

        // Render Whitelist
        renderWhitelist(data.whitelistedHandles); // Assumes stored handles are decoded

        addChangeListeners();
        settingsChanged = false;
    });
}


function populateDayLimits(dayLimits, defaultTimeLimit) {
    $(".day-row").each(function() {
        var day = $(this).data("day");
        var minuteInput = $(this).find(".day-minute-input");
        var noLimitInput = $(this).find(".no-limit-input");

        if (day in dayLimits) {
            if (dayLimits[day] === false) {
                minuteInput.prop("disabled", true).val('');
                noLimitInput.prop('checked', true);
            } else {
                minuteInput.val(dayLimits[day]).prop("disabled", false);
                noLimitInput.prop('checked', false);
            }
        } else {
            minuteInput.val(defaultTimeLimit).prop("disabled", false);
            noLimitInput.prop('checked', false);
        }
    });
}

// --- Whitelist Variables & Functions ---
const whitelistInput = document.getElementById('whitelistChannelHandle');
const addWhitelistBtn = document.getElementById('addWhitelistBtn');
const whitelistUl = document.getElementById('whitelistHandles');


function renderWhitelist(identifiers) {
    whitelistUl.innerHTML = '';
    if (!Array.isArray(identifiers)) {
         console.error("Whitelist data is not an array:", identifiers);
         identifiers = [];
    }
    identifiers.forEach(identifier => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        li.textContent = identifier; // Display the identifier (should be decoded)

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-danger btn-sm remove-whitelist-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.dataset.identifier = identifier;

        li.appendChild(removeBtn);
        whitelistUl.appendChild(li);
    });
}

function addChannelToWhitelist() {
    let rawInput = whitelistInput.value.trim();
    let identifierToAdd = rawInput;

    // Pre-processing: Standardize input by removing potential leading path components
    if (identifierToAdd.startsWith('/channel/')) {
        identifierToAdd = identifierToAdd.substring('/channel/'.length);
    } else if (identifierToAdd.startsWith('/@')) {
        identifierToAdd = identifierToAdd.substring(1); // Keep the '@'
    } else if (identifierToAdd.startsWith('/')) { // Catch other generic leading slashes if any
        identifierToAdd = identifierToAdd.substring(1);
    }

    const isValidHandle = STANDALONE_HANDLE_REGEX.test(identifierToAdd);
    const isValidChannelID = STANDALONE_CHANNEL_ID_REGEX.test(identifierToAdd);

    if (isValidHandle || isValidChannelID) {
        // Decode if it's a handle and looks like it's percent-encoded.
        // Channel IDs are not expected to be percent-encoded in this way.
        if (isValidHandle && identifierToAdd.includes('%')) {
            try {
                identifierToAdd = decodeURIComponent(identifierToAdd);
            } catch(e) {
                 console.warn("Could not decode identifier input, using original:", identifierToAdd, e);
                 statusMessageEl.textContent = 'Warning: Could not decode handle. Added as is, may not work as expected.';
                 clearStatusMessage();
                 // Decide if you want to prevent adding or add the raw version.
                 // Adding raw might lead to mismatches if saveVideo.js always decodes.
                 // For now, it proceeds with the (potentially still encoded) identifierToAdd.
            }
        }

        const currentIdentifiersInUI = Array.from(whitelistUl.querySelectorAll('li'))
                                       .map(li => li.firstChild.textContent);

        if (!currentIdentifiersInUI.includes(identifierToAdd)) {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.textContent = identifierToAdd; // Add the processed (and decoded for handles) identifier

            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn btn-danger btn-sm remove-whitelist-btn';
            removeBtn.textContent = 'Remove';
            removeBtn.dataset.identifier = identifierToAdd;

            li.appendChild(removeBtn);
            whitelistUl.appendChild(li);

            whitelistInput.value = '';
            setSettingsChanged();
            statusMessageEl.textContent = 'Identifier added to list (Save to apply).';
            clearStatusMessage();
        } else {
            statusMessageEl.textContent = 'Channel handle or ID is already in the list.';
            clearStatusMessage();
        }
    } else {
        statusMessageEl.textContent = 'Invalid Format. Enter @handle (e.g., @Google), Channel ID (e.g., UC...), or paste a channel path.';
        clearStatusMessage();
    }
}


function removeChannelFromWhitelist(identifierToRemove) {
     const currentItems = Array.from(whitelistUl.querySelectorAll('li'));
     const updatedWhitelist = currentItems
         .map(li => li.firstChild.textContent)
         .filter(identifier => identifier !== identifierToRemove);

     renderWhitelist(updatedWhitelist);
     setSettingsChanged();
     statusMessageEl.textContent = 'Identifier removed from list (Save to apply).';
     clearStatusMessage();
}

// --- Event Handlers ---
function handleCustomizeLimitsChange() {
    if (this.checked) {
        $("#customLimitsDiv").show();
        $("#minutes").prop("disabled", true);
        chrome.storage.local.get({"timeLimit": 30, "dayLimits": {}}, function(data){
            if (!chrome.runtime.lastError) {
                 populateDayLimits(data.dayLimits, data.timeLimit);
            } else {
                console.error("Error getting limits for populating day limits:", chrome.runtime.lastError);
            }
        });
    } else {
        $("#customLimitsDiv").hide();
        $("#minutes").prop("disabled", false);
        $(".day-minute-input").val("");
        $(".no-limit-input").prop('checked', false);
        $(".day-minute-input").prop("disabled", false);
    }
    setSettingsChanged();
}

function handleNoLimitChange() {
    var dayRow = $(this).closest(".day-row");
	var minuteInput = dayRow.find(".day-minute-input");

	if (this.checked) {
		minuteInput.prop("disabled", true).val('');
	} else {
        let defaultMinutes = $("#minutes").val() || 30; // Use current general limit or 30 as fallback
		minuteInput.prop("disabled", false).val(defaultMinutes);
	}
    setSettingsChanged();
}

function handleLimitOverridesChange() {
	if (this.checked) {
		$('#overrideLimitRow').css("visibility", "visible");
	} else {
		$('#overrideLimitRow').css("visibility", "hidden");
	}
    setSettingsChanged();
}

// --- Save All Settings ---
function saveAllSettings() {
    statusMessageEl.textContent = 'Saving...';

    let timeLimit = Number($("#minutes").val());
    timeLimit = Math.max(0, Math.min(1439, Math.round(timeLimit))); // Max 23h 59m
    $("#minutes").val(timeLimit);

    const customizeLimits = $('#customizeLimits').is(':checked');
    let dayLimits = {};
    if (customizeLimits) {
        $(".day-row").each(function() {
            const day = $(this).data("day");
            const noLimit = $(this).find(".no-limit-input").is(':checked');
            const minuteInput = $(this).find(".day-minute-input");

            if (noLimit) {
                dayLimits[day] = false; // false signifies no limit for this day
            } else {
                let dayMinutes = Number(minuteInput.val());
                dayMinutes = Math.max(0, Math.min(1439, Math.round(dayMinutes)));
                minuteInput.val(dayMinutes);
                dayLimits[day] = dayMinutes;
            }
        });
    }

    const resetTime = $("#time").val();
    if (!/^[0-2][0-9]:[0-5][0-9]$/.test(resetTime)) {
        statusMessageEl.textContent = 'Error: Invalid Reset Time format. Use HH:MM.';
        clearStatusMessage();
        return;
    }

    const limitOverrides = $('#limitOverrides').is(':checked');
    let overrideLimit = Number($("#overrideLimit").val());
    overrideLimit = Math.max(0, Math.min(1000, Math.round(overrideLimit))); // Cap override limit
    $("#overrideLimit").val(overrideLimit);

    const pauseOutOfFocus = $('#pauseOutOfFocus').is(':checked');
    const youtubekidsEnabled = $('#youtubekidsEnabled').is(':checked');

    // Get whitelisted identifiers from the UI (they are already decoded)
    const whitelistedIdentifiers = Array.from(whitelistUl.querySelectorAll('li'))
                                 .map(li => li.firstChild.textContent);

    const settingsToSave = {
        timeLimit: timeLimit,
        customizeLimits: customizeLimits,
        dayLimits: dayLimits,
        resetTime: resetTime,
        limitOverrides: limitOverrides,
        overrideLimit: overrideLimit,
        // currentOverrideCount will be set based on overrideLimit or removed by background if !limitOverrides
        pauseOutOfFocus: pauseOutOfFocus,
        youtubekidsEnabled: youtubekidsEnabled,
        whitelistedHandles: whitelistedIdentifiers // Storing decoded identifiers
    };
    
    // Conditionally set currentOverrideCount or ensure it's managed correctly on reset/load
    if (settingsToSave.limitOverrides) {
        // Let background script handle the logic of currentOverrideCount on reset or load based on new overrideLimit
        // For now, we just save the new limit. Background script's reset logic should use this new limit.
        // Or, if we need to reset count immediately:
        // settingsToSave.currentOverrideCount = overrideLimit;
    } else {
        // If overrides are not limited, background script should ideally clear currentOverrideCount
        chrome.storage.local.remove("currentOverrideCount"); // Proactively remove
    }


    chrome.storage.local.set(settingsToSave, function() {
        if (chrome.runtime.lastError) {
            statusMessageEl.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
            console.error("Error saving settings:", chrome.runtime.lastError);
        } else {
            settingsChanged = false;
            statusMessageEl.textContent = 'Settings Saved Successfully!';

            // Inform background script about potential immediate changes
            let newTimeLeftForBackground;
            const savedDayLimits = settingsToSave.dayLimits;
            const savedCustomizeLimits = settingsToSave.customizeLimits;
            const savedTimeLimit = settingsToSave.timeLimit; // General time limit
            const todayDayName = days[new Date().getDay()];

            if (savedCustomizeLimits) { // If customized limits are active
                 if (todayDayName in savedDayLimits) { // If today has a specific setting
                     if (savedDayLimits[todayDayName] === false) { // No limit for today
                         newTimeLeftForBackground = -1; // Signal no limit
                         chrome.runtime.sendMessage({ msg: "noLimitInputChange", day: todayDayName });
                     } else { // Specific time limit for today
                         newTimeLeftForBackground = savedDayLimits[todayDayName] * 60;
                         chrome.runtime.sendMessage({ msg: "dayTimeLimitUpdated", day: todayDayName, newLimit: savedDayLimits[todayDayName] });
                     }
                 } else { // Today not specifically set, should not happen if UI forces all days, but as fallback:
                     newTimeLeftForBackground = savedTimeLimit * 60; // Use general limit if today has no specific custom setting
                 }
            } else { // Customized limits are NOT active, use general time limit
                newTimeLeftForBackground = savedTimeLimit * 60;
                chrome.runtime.sendMessage({ msg: "customizeLimitsFalse" }); // Inform background that general limit applies
            }

            // Send update for time left if it's not "no limit"
            // The background script's checkReset will ultimately determine the authoritative timeLeft.
            // This message primarily helps sync if a manual save changes today's applicable limit.
            if (newTimeLeftForBackground !== -1) { // -1 was our signal for no limit
                 chrome.runtime.sendMessage({
                     msg: "updateTimeLeftNow", // This message type should exist in background.js
                     newTime: newTimeLeftForBackground
                 }, response => {
                    if (chrome.runtime.lastError) console.warn("BG response error (updateTimeLeftNow):", chrome.runtime.lastError.message);
                 });
            }


            chrome.runtime.sendMessage({ msg: "pauseOutOfFocus", val: pauseOutOfFocus });
            chrome.runtime.sendMessage({ msg: "youtubekidsEnabled", val: youtubekidsEnabled });
            chrome.runtime.sendMessage({ msg: "resetTimeUpdated" }); // Inform that reset time might have changed

            ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Save All Settings'});
        }
        clearStatusMessage();
    });
}


function addChangeListeners() {
    // Clear existing listeners to prevent duplicates if loadSettings is called multiple times (though not typical)
    $('.setting-input').off('change input');
    $('#customizeLimits').off('change');
    $('.no-limit-input').off('change');
    $('#limitOverrides').off('change');
    $('#addWhitelistBtn').off('click');
    $(whitelistUl).off('click', '.remove-whitelist-btn');
    $('#saveAllSettingsBtn').off('click');
    $(window).off('beforeunload');

    // Add listeners
    $('.setting-input').on('change input', setSettingsChanged);
    $('#customizeLimits').on('change', handleCustomizeLimitsChange);
    $('.no-limit-input').on('change', handleNoLimitChange);
    $('#limitOverrides').on('change', handleLimitOverridesChange);

    if(addWhitelistBtn) addWhitelistBtn.addEventListener('click', addChannelToWhitelist);
    if(whitelistUl) whitelistUl.addEventListener('click', function(event) {
        if (event.target.classList.contains('remove-whitelist-btn')) {
            const identifier = event.target.dataset.identifier;
             removeChannelFromWhitelist(identifier);
        }
    });

    $('#saveAllSettingsBtn').on('click', saveAllSettings);

    $(window).on('beforeunload', function(e) {
        if (settingsChanged) {
            const confirmationMessage = 'You have unsaved changes. Are you sure you want to leave without saving?';
            (e || window.event).returnValue = confirmationMessage; // For IE and Firefox
            return confirmationMessage; // For Safari
        }
        return undefined; // No message if no unsaved changes
    });
}

document.addEventListener('DOMContentLoaded', function() {
    if (whitelistInput) {
        whitelistInput.placeholder = "Enter @handle, Channel ID, or channel path";
    }
    loadSettings();
});