ga('send', 'pageview', '/options.html');

const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

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
        "whitelistedHandles": [] // Use the actual key directly
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
            $("#minutes").prop("disabled", true); // Keep general limit disabled visually
            populateDayLimits(data.dayLimits, data.timeLimit); // Pass defaults
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

        // Render Whitelist (using existing function)
        renderWhitelist(data.whitelistedHandles); // Pass the loaded handles

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

        if (day in dayLimits) {
            if (dayLimits[day] === false) { // No limit set for this day
                minuteInput.prop("disabled", true).val(''); // Clear and disable
                noLimitInput.prop('checked', true);
            } else { // Specific limit set for this day
                minuteInput.val(dayLimits[day]).prop("disabled", false);
                noLimitInput.prop('checked', false);
            }
        } else { // No specific setting, use default
            minuteInput.val(defaultTimeLimit).prop("disabled", false);
            noLimitInput.prop('checked', false);
        }
    });
    // No need for $("#customLimitsDiv").show(); here, done in loadSettings
}

// --- Whitelist Variables & Functions ---
const storageKey = "whitelistedHandles"; // Keep variable for consistency if needed elsewhere
const whitelistInput = document.getElementById('whitelistChannelHandle');
const addWhitelistBtn = document.getElementById('addWhitelistBtn');
const whitelistUl = document.getElementById('whitelistHandles');

// Function to render the whitelist from storage (Accepts data)
function renderWhitelist(handles) {
    whitelistUl.innerHTML = ''; // Clear current list
    if (!Array.isArray(handles)) {
         console.error("Whitelist data is not an array:", handles);
         handles = []; // Default to empty array if data is invalid
    }
    handles.forEach(channelHandle => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        // Display the handle as is (it should be decoded already)
        li.textContent = channelHandle;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-danger btn-sm remove-whitelist-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.dataset.channelHandle = channelHandle; // Store handle for removal

        li.appendChild(removeBtn);
        whitelistUl.appendChild(li);
    });
}

// Function to add a channel to the whitelist (Sets flag, DECODES input)
function addChannelToWhitelist() {
    let channelHandle = whitelistInput.value.trim();

    if (channelHandle.length > 1 && channelHandle.startsWith('@')) {
         // Optional: Remove leading slash if user includes it (e.g. /@handle)
        if (channelHandle.startsWith('/@')) {
             channelHandle = channelHandle.substring(1); // Get '@handle'
         }

        // --- Decode the input handle ---
        let decodedHandle = channelHandle;
        try {
             // Decode percent-encoded characters if present in the input
             decodedHandle = decodeURIComponent(channelHandle);
             // console.log("Input handle decoded to:", decodedHandle); // Debugging
        } catch(e) {
             console.warn("Could not decode handle input, using original:", channelHandle, e);
             // Keep original handle if decoding fails (e.g., invalid sequences)
             decodedHandle = channelHandle;
        }
        // --- End Decode ---

        // Get current list directly from UI to check for duplicates before modifying UI
        const currentHandlesInUI = Array.from(whitelistUl.querySelectorAll('li'))
                                       .map(li => li.firstChild.textContent);

        if (!currentHandlesInUI.includes(decodedHandle)) {
            // Add to UI immediately (don't save to storage yet)
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.textContent = decodedHandle; // Add decoded handle to UI

            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn btn-danger btn-sm remove-whitelist-btn';
            removeBtn.textContent = 'Remove';
            removeBtn.dataset.channelHandle = decodedHandle;

            li.appendChild(removeBtn);
            whitelistUl.appendChild(li);

            whitelistInput.value = ''; // Clear input field
            setSettingsChanged(); // Mark settings as changed
            statusMessageEl.textContent = 'Handle added to list (Save to apply).';
            clearStatusMessage();
            // ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Whitelist Add Handle Pending', eventLabel: decodedHandle});
        } else {
            statusMessageEl.textContent = 'Channel handle is already in the list.';
            clearStatusMessage();
        }

    } else {
        statusMessageEl.textContent = 'Invalid YouTube Channel Handle format. It must start with "@" (e.g., @google).';
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
     statusMessageEl.textContent = 'Handle removed from list (Save to apply).';
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
            if (!chrome.runtime.lastError) {
                 populateDayLimits(data.dayLimits, data.timeLimit); // Populate with current defaults
            } else {
                console.error("Error getting limits for populating day limits:", chrome.runtime.lastError);
            }
        });
    } else {
        $("#customLimitsDiv").hide();
        $("#minutes").prop("disabled", false);
        // Optionally clear day-specific inputs visually when disabling
        $(".day-minute-input").val("");
        $(".no-limit-input").prop('checked', false);
		//$(".save-day-limit, .day-minute-input").prop("disabled", false); // Buttons removed
        $(".day-minute-input").prop("disabled", false);
    }
    setSettingsChanged();
}

function handleNoLimitChange() {
    var dayRow = $(this).closest(".day-row");
	var minuteInput = dayRow.find(".day-minute-input");

	if (this.checked) {
		minuteInput.prop("disabled", true).val(''); // Disable and clear input
	} else {
        // Re-enable and set default value (read from general input for immediate feedback)
        let defaultMinutes = $("#minutes").val() || 30;
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

    // 1. General Time Limit (always read, used if customizeLimits is false)
    let timeLimit = Number($("#minutes").val());
    timeLimit = Math.max(0, Math.min(1439, Math.round(timeLimit))); // Allow 0-1439 minutes (23h 59m)
    $("#minutes").val(timeLimit); // Update input to validated value

    // 2. Customize Limits Checkbox and Individual Day Limits
    const customizeLimits = $('#customizeLimits').is(':checked');
    let dayLimits = {};
    let activeDayLimits = {}; // Store limits actually being used today/for messaging
    const today = new Date();
    const todayDayName = days[today.getDay()];


    if (customizeLimits) {
        $(".day-row").each(function() {
            const day = $(this).data("day");
            const noLimit = $(this).find(".no-limit-input").is(':checked');
            const minuteInput = $(this).find(".day-minute-input");

            if (noLimit) {
                dayLimits[day] = false; // Store 'false' for no limit
                if(day === todayDayName) activeDayLimits[day] = false;
            } else {
                let dayMinutes = Number(minuteInput.val());
                dayMinutes = Math.max(0, Math.min(1439, Math.round(dayMinutes))); // Validate
                minuteInput.val(dayMinutes); // Update input to validated value
                dayLimits[day] = dayMinutes; // Store the number
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
    overrideLimit = Math.max(0, Math.min(1000, Math.round(overrideLimit))); // Validation
    $("#overrideLimit").val(overrideLimit); // Update input

    // 5. Pause Out of Focus
    const pauseOutOfFocus = $('#pauseOutOfFocus').is(':checked');

    // 6. YouTube Kids Enabled
    const youtubekidsEnabled = $('#youtubekidsEnabled').is(':checked');

    // 7. Whitelist Handles
    // Read handles directly from the current UI list elements
    const whitelistHandles = Array.from(whitelistUl.querySelectorAll('li'))
                                 .map(li => li.firstChild.textContent); // Should be decoded already


    // --- Prepare data for storage ---
    const settingsToSave = {
        timeLimit: timeLimit,
        customizeLimits: customizeLimits,
        dayLimits: dayLimits,
        resetTime: resetTime,
        limitOverrides: limitOverrides,
        overrideLimit: overrideLimit,
        // Reset currentOverrideCount when the limit is saved, if limiting is enabled
        currentOverrideCount: limitOverrides ? overrideLimit : undefined,
        pauseOutOfFocus: pauseOutOfFocus,
        youtubekidsEnabled: youtubekidsEnabled,
        whitelistedHandles: whitelistHandles // Save the handles (should be decoded)
    };

    // Remove undefined currentOverrideCount if not limiting overrides
    if (settingsToSave.currentOverrideCount === undefined) {
        delete settingsToSave.currentOverrideCount;
        // Also explicitly remove from storage if limiting was just turned off
        chrome.storage.local.remove("currentOverrideCount");
    }


    // --- Save to Chrome Storage ---
    chrome.storage.local.set(settingsToSave, function() {
        if (chrome.runtime.lastError) {
            statusMessageEl.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
            console.error("Error saving settings:", chrome.runtime.lastError);
        } else {
            settingsChanged = false; // Reset flag on successful save
            statusMessageEl.textContent = 'Settings Saved Successfully!';

            // --- Calculate and send the immediate timeLeft update to background ---
            let newTimeLeftForBackground;
            const savedDayLimits = settingsToSave.dayLimits; // Use the object we just saved
            const savedCustomizeLimits = settingsToSave.customizeLimits;
            const savedTimeLimit = settingsToSave.timeLimit;
            const todayDayName = days[new Date().getDay()]; // Get today's name again

            if (savedCustomizeLimits) {
                 if (todayDayName in savedDayLimits) {
                     if (savedDayLimits[todayDayName] === false) {
                         // No limit today
                         newTimeLeftForBackground = -1; // Signal no limit (background will handle noLimit flag)
                         chrome.runtime.sendMessage({ msg: "noLimitInputChange", day: todayDayName });
                     } else {
                         // Specific limit today
                         newTimeLeftForBackground = savedDayLimits[todayDayName] * 60;
                         chrome.runtime.sendMessage({ msg: "dayTimeLimitUpdated", day: todayDayName });
                     }
                 } else {
                     // Customizing, but today uses the general limit
                     newTimeLeftForBackground = savedTimeLimit * 60;
                      // Inform background customization is on but general limit applies today
                      // (Might need a specific message if background needs this distinction)
                 }
            } else {
                // Not customizing, use the general limit
                newTimeLeftForBackground = savedTimeLimit * 60;
                chrome.runtime.sendMessage({ msg: "customizeLimitsFalse" });
            }

            // Send the direct timeLeft update message (handle noLimit case in background)
            if (newTimeLeftForBackground !== -1) { // Don't send time if it's a noLimit day
                 chrome.runtime.sendMessage({
                     msg: "updateTimeLeftNow",
                     newTime: newTimeLeftForBackground
                 });
            }
            // --- End immediate timeLeft update ---


            // Send other setting updates to background
            chrome.runtime.sendMessage({ msg: "pauseOutOfFocus", val: pauseOutOfFocus });
            chrome.runtime.sendMessage({ msg: "youtubekidsEnabled", val: youtubekidsEnabled });
            chrome.runtime.sendMessage({ msg: "resetTimeUpdated" }); // Inform background reset time might have changed


            // GA Events (Optional)
            ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Save All Settings'});
        }
        clearStatusMessage(); // Clear message after a few seconds
    });
} // End of saveAllSettings function

// --- Add Event Listeners ---
function addChangeListeners() {
    // Remove existing listeners to prevent duplicates if loadSettings is called again
    $('.setting-input').off('change input'); // Use a class for all inputs needing change tracking
    $('#addWhitelistBtn').off('click');
    $(whitelistUl).off('click', '.remove-whitelist-btn');
    $('#saveAllSettingsBtn').off('click');
    $(window).off('beforeunload');


    // General input changes trigger the changed flag
    $('.setting-input').on('change input', setSettingsChanged);

    // Special handling for checkboxes that control visibility/disabling
    $('#customizeLimits').on('change', handleCustomizeLimitsChange);
    $('.no-limit-input').on('change', handleNoLimitChange);
    $('#limitOverrides').on('change', handleLimitOverridesChange);

    // Whitelist buttons
    addWhitelistBtn.addEventListener('click', addChannelToWhitelist);
    whitelistUl.addEventListener('click', function(event) {
        if (event.target.classList.contains('remove-whitelist-btn')) {
            const channelHandle = event.target.dataset.channelHandle;
             // Removes from UI and sets changed flag
             removeChannelFromWhitelist(channelHandle);
        }
    });

    // Save All button
    $('#saveAllSettingsBtn').on('click', saveAllSettings);

    // Warn before leaving page if changes are unsaved
    $(window).on('beforeunload', function(e) {
        if (settingsChanged) {
            const confirmationMessage = 'You have unsaved changes. Are you sure you want to leave without saving?';
            (e || window.event).returnValue = confirmationMessage; // Standard
            return confirmationMessage; // For older browsers
        }
        // If settingsChanged is false, return undefined (or nothing) to allow navigation
        return undefined;
    });
}


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', loadSettings);
