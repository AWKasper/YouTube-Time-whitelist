ga('send', 'pageview', '/options.html');

let settingsChanged = false; // Flag to track unsaved changes
const statusMessageEl = document.getElementById('statusMessage'); // For showing save status

// --- Utility Functions ---
function setSettingsChanged() {
	settingsChanged = true;
    statusMessageEl.textContent = ''; // Clear status on new change
    // console.log("Settings changed"); // For debugging
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
        [storageKey]: [] // Include whitelist handles
    }, function(data) {
        // General Time Limit
        $("#minutes").val(data.timeLimit);

        // Customize Limits Checkbox & Section
        $('#customizeLimits').prop('checked', data.customizeLimits);
        if (data.customizeLimits) {
            $("#customLimitsDiv").show();
            $("#minutes, #saveMinutes").prop("disabled", true); // Keep general limit disabled visually
            populateDayLimits(data.dayLimits, data.timeLimit); // Pass defaults
        } else {
            $("#customLimitsDiv").hide();
            $("#minutes, #saveMinutes").prop("disabled", false);
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

        // Render Whitelist (using existing function)
        renderWhitelist(data[storageKey]); // Pass the loaded handles

        // Add change listeners AFTER loading initial values
        addChangeListeners();

        // Reset change flag after loading
        settingsChanged = false;
    });
}


function populateDayLimits(dayLimits, defaultTimeLimit) {
    // No need to get from storage again, use passed data
    $(".day-row").each(function() {
        var day = $(this).data("day");
        var minuteInput = $(this).find(".day-minute-input");
        var noLimitInput = $(this).find(".no-limit-input");
        // var saveButton = $(this).find(".save-day-limit"); // No longer needed

        if (day in dayLimits) {
            if (dayLimits[day] === false) { // No limit set for this day
                // saveButton.prop("disabled", true); // No longer needed
                minuteInput.prop("disabled", true).val(''); // Clear and disable
                noLimitInput.prop('checked', true);
            } else { // Specific limit set for this day
                minuteInput.val(dayLimits[day]).prop("disabled", false);
                // saveButton.prop("disabled", false); // No longer needed
                noLimitInput.prop('checked', false);
            }
        } else { // No specific setting, use default
            minuteInput.val(defaultTimeLimit).prop("disabled", false);
            // saveButton.prop("disabled", false); // No longer needed
            noLimitInput.prop('checked', false);
        }
    });
    // No need for $("#customLimitsDiv").show(); here, done in loadSettings
}

// --- Whitelist Variables & Functions (Keep existing logic, modify add/remove) ---
const storageKey = "whitelistedHandles";
const whitelistInput = document.getElementById('whitelistChannelHandle');
const addWhitelistBtn = document.getElementById('addWhitelistBtn');
const whitelistUl = document.getElementById('whitelistHandles');

// Function to render the whitelist from storage (Modified to accept data)
function renderWhitelist(handles) {
    whitelistUl.innerHTML = ''; // Clear current list
    handles.forEach(channelHandle => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        li.textContent = channelHandle;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-danger btn-sm remove-whitelist-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.dataset.channelHandle = channelHandle;

        li.appendChild(removeBtn);
        whitelistUl.appendChild(li);
    });
}

// Function to add a channel to the whitelist (Modified to set flag)
function addChannelToWhitelist() {
    let channelHandle = whitelistInput.value.trim();

    if (channelHandle.length > 1 && channelHandle.startsWith('@')) {
        if (channelHandle.startsWith('/@')) {
             channelHandle = channelHandle.substring(1);
         }
        chrome.storage.local.get({ [storageKey]: [] }, function(data) {
            const currentWhitelist = data[storageKey];
            if (!currentWhitelist.includes(channelHandle)) {
                // Don't save here, just update UI and mark as changed
                currentWhitelist.push(channelHandle); // Add to local copy for rendering
                whitelistInput.value = '';
                renderWhitelist(currentWhitelist); // Re-render based on local copy
                setSettingsChanged(); // Mark settings as changed
                statusMessageEl.textContent = 'Handle added to list (not saved yet).';
                clearStatusMessage();
                 // ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Whitelist Add Handle Pending', eventLabel: channelHandle});
            } else {
                statusMessageEl.textContent = 'Channel handle is already in the list.';
                 clearStatusMessage();
            }
        });
    } else {
        statusMessageEl.textContent = 'Invalid YouTube Channel Handle format. It should start with "@" (e.g., @google).';
        clearStatusMessage();
    }
}

// Function to remove a channel from the whitelist (Modified to set flag)
function removeChannelFromWhitelist(handleToRemove) {
    // Don't get/set storage here, just update UI and mark as changed
     const currentItems = Array.from(whitelistUl.querySelectorAll('li'));
     const updatedWhitelist = currentItems
         .map(li => li.firstChild.textContent) // Get the handle text
         .filter(handle => handle !== handleToRemove);

     renderWhitelist(updatedWhitelist); // Re-render based on filtered list
     setSettingsChanged(); // Mark settings as changed
     statusMessageEl.textContent = 'Handle removed from list (not saved yet).';
     clearStatusMessage();
     // ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Whitelist Remove Handle Pending', eventLabel: handleToRemove});
}

// --- Event Handlers ---

function handleCustomizeLimitsChange() {
    if (this.checked) {
        $("#customLimitsDiv").show();
        $("#minutes").prop("disabled", true); // Visually disable general limit
        // Get current general limit to populate defaults
        chrome.storage.local.get({"timeLimit": 30, "dayLimits": {}}, function(data){
             populateDayLimits(data.dayLimits, data.timeLimit); // Populate with current defaults
        });
    } else {
        $("#customLimitsDiv").hide();
        $("#minutes").prop("disabled", false);
        // Optionally clear day-specific inputs visually when disabling
        $(".day-minute-input").val("");
        $(".no-limit-input").prop('checked', false);
		$(".save-day-limit, .day-minute-input").prop("disabled", false);
    }
    setSettingsChanged();
}

function handleNoLimitChange() {
    var dayRow = $(this).closest(".day-row");
	var minuteInput = dayRow.find(".day-minute-input");
	// var saveButton = dayRow.find(".save-day-limit"); // No longer needed

	if (this.checked) {
		minuteInput.prop("disabled", true).val(''); // Disable and clear input
		// saveButton.prop("disabled", true); // No longer needed
	} else {
        // Re-enable and set default value (read from general input for immediate feedback)
        let defaultMinutes = $("#minutes").val() || 30;
		minuteInput.prop("disabled", false).val(defaultMinutes);
		// saveButton.prop("disabled", false); // No longer needed
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

    // 1. General Time Limit (always read, used if customizeLimits is false)
    let timeLimit = Number($("#minutes").val());
    timeLimit = Math.max(0, Math.min(1439, Math.round(timeLimit * 2) / 2)); // Validation
    $("#minutes").val(timeLimit); // Update input to validated value

    // 2. Customize Limits Checkbox and Individual Day Limits
    const customizeLimits = $('#customizeLimits').is(':checked');
    let dayLimits = {};
    let activeDayLimits = {}; // Store limits actually being used today/for messaging
    const today = new Date();
	const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const todayDayName = days[today.getDay()];


    if (customizeLimits) {
        $(".day-row").each(function() {
            const day = $(this).data("day");
            const noLimit = $(this).find(".no-limit-input").is(':checked');
            const minuteInput = $(this).find(".day-minute-input");

            if (noLimit) {
                dayLimits[day] = false;
                if(day === todayDayName) activeDayLimits[day] = false;
            } else {
                let dayMinutes = Number(minuteInput.val());
                dayMinutes = Math.max(0, Math.min(1439, Math.round(dayMinutes * 2) / 2));
                minuteInput.val(dayMinutes); // Update input to validated value
                dayLimits[day] = dayMinutes;
                 if(day === todayDayName) activeDayLimits[day] = dayMinutes;
            }
        });
    } else {
        // If not customizing, clear the stored dayLimits object
        dayLimits = {};
    }

    // 3. Reset Time
    const resetTime = $("#time").val();
    // Basic validation for time format HH:MM
    if (!/^[0-2][0-9]:[0-5][0-9]$/.test(resetTime)) {
        statusMessageEl.textContent = 'Error: Invalid Reset Time format. Use HH:MM.';
        clearStatusMessage();
        return; // Stop saving
    }

    // 4. Limit Overrides Checkbox and Value
    const limitOverrides = $('#limitOverrides').is(':checked');
    let overrideLimit = Number($("#overrideLimit").val());
    overrideLimit = Math.max(0, Math.min(1000, overrideLimit)); // Validation
    $("#overrideLimit").val(overrideLimit); // Update input

    // 5. Pause Out of Focus
    const pauseOutOfFocus = $('#pauseOutOfFocus').is(':checked');

    // 6. YouTube Kids Enabled
    const youtubekidsEnabled = $('#youtubekidsEnabled').is(':checked');

    // 7. Whitelist Handles
    const whitelistHandles = Array.from(whitelistUl.querySelectorAll('li'))
                                 .map(li => li.firstChild.textContent); // Read handles from the current list


    // --- Prepare data for storage ---
    const settingsToSave = {
        timeLimit: timeLimit,
        customizeLimits: customizeLimits,
        dayLimits: dayLimits,
        resetTime: resetTime,
        limitOverrides: limitOverrides,
        overrideLimit: overrideLimit,
        // Only update currentOverrideCount if limitOverrides is enabled
        // And generally reset it when the limit itself is saved
        currentOverrideCount: limitOverrides ? overrideLimit : undefined, // Reset or leave undefined
        pauseOutOfFocus: pauseOutOfFocus,
        youtubekidsEnabled: youtubekidsEnabled,
        [storageKey]: whitelistHandles // Use dynamic key
    };

    // Remove undefined currentOverrideCount if not limiting
    if (settingsToSave.currentOverrideCount === undefined) {
        delete settingsToSave.currentOverrideCount;
    }


    // --- Save to Chrome Storage ---
    chrome.storage.local.set(settingsToSave, function() {
        if (chrome.runtime.lastError) {
            statusMessageEl.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
            console.error("Error saving settings:", chrome.runtime.lastError);
        } else {
            settingsChanged = false; // Reset flag on successful save
            statusMessageEl.textContent = 'Settings Saved Successfully!';

             // Send messages to background script
             chrome.runtime.sendMessage({ msg: "pauseOutOfFocus", val: pauseOutOfFocus });
             chrome.runtime.sendMessage({ msg: "youtubekidsEnabled", val: youtubekidsEnabled });
             chrome.runtime.sendMessage({ msg: "resetTimeUpdated" }); // Inform background about potential reset time change


             // Determine correct message based on customization status
             if (customizeLimits) {
                 // Send message about the *current* day's limit if it changed
                 if (todayDayName in activeDayLimits) {
                      if (activeDayLimits[todayDayName] === false) {
                           chrome.runtime.sendMessage({ msg: "noLimitInputChange", day: todayDayName });
                      } else {
                           // Send specific day limit update
                           chrome.runtime.sendMessage({ msg: "dayTimeLimitUpdated", day: todayDayName });
                      }
                 } else {
                      // If today is not in dayLimits, it uses the general one, but since customizeLimits is true,
                      // we should probably ensure the background knows the general limit isn't the active one.
                      // A safe bet might be to resend the general limit, but background might handle this already.
                      // Let's assume background re-evaluates on customizeLimits change.
                      // Consider sending a generic "limits changed" message if needed.
                      // For now, let's rely on the background handling customizeLimits state change.
                 }
                  // Inform background customization is on (might be redundant if already known)
                 // chrome.runtime.sendMessage({ msg: "customizeLimitsTrue" }); // Needs corresponding handler in background.js if used

             } else {
                  // Send message that customization is OFF and the general limit applies
                 chrome.runtime.sendMessage({ msg: "customizeLimitsFalse" }); // This should trigger background to use timeLimit
                 chrome.runtime.sendMessage({ msg: "timeLimitUpdated" }); // Also send the general limit update
             }


            // GA Events (Optional: group them or make more specific)
            ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Save All Settings'});
        }
        clearStatusMessage(); // Clear message after a few seconds
    });
}

// --- Add Event Listeners ---
function addChangeListeners() {
    // Remove existing listeners to prevent duplicates if loadSettings is called again
    $('.setting-input').off('change input'); // Use a class for all inputs needing change tracking
    $('#addWhitelistBtn').off('click');
    $(whitelistUl).off('click', '.remove-whitelist-btn');
    $('#saveAllSettingsBtn').off('click');
    $(window).off('beforeunload');


    // General input changes
    $('.setting-input').on('change input', setSettingsChanged); // Track changes on various input types

    // Special handling for checkboxes that control visibility/disabling
    $('#customizeLimits').on('change', handleCustomizeLimitsChange);
    $('.no-limit-input').on('change', handleNoLimitChange);
    $('#limitOverrides').on('change', handleLimitOverridesChange);

    // Whitelist buttons
    addWhitelistBtn.addEventListener('click', addChannelToWhitelist);
    whitelistUl.addEventListener('click', function(event) {
        if (event.target.classList.contains('remove-whitelist-btn')) {
            const channelHandle = event.target.dataset.channelHandle;
             // No confirm here, just mark for removal. Confirmation happens on page leave if unsaved.
             removeChannelFromWhitelist(channelHandle);
        }
    });

    // Save All button
    $('#saveAllSettingsBtn').on('click', saveAllSettings);

    // Warn before leaving page if changes are unsaved
    $(window).on('beforeunload', function(e) {
        if (settingsChanged) {
            const confirmationMessage = 'You have unsaved changes. Are you sure you want to leave?';
            (e || window.event).returnValue = confirmationMessage; // Standard
            return confirmationMessage; // For older browsers
        }
        // If settingsChanged is false, return undefined (or nothing) to allow navigation
        return undefined;
    });
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', loadSettings);
