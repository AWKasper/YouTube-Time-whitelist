ga('send', 'pageview', '/options.html');

const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

let settingsChanged = false; 
const statusMessageEl = document.getElementById('statusMessage'); 

const STANDALONE_HANDLE_REGEX = /^(@[^/?#\s]{3,})$/;
const STANDALONE_CHANNEL_ID_REGEX = /^(UC[a-zA-Z0-9_-]{22})$/;


function setSettingsChanged() {
	settingsChanged = true;
    statusMessageEl.textContent = ''; 
}

function clearStatusMessage() {
    setTimeout(() => {
        statusMessageEl.textContent = '';
    }, 3000); 
}

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
        "whitelistedHandles": [] 
    }, function(data) {
        if (chrome.runtime.lastError) {
             console.error("Error loading settings:", chrome.runtime.lastError);
             statusMessageEl.textContent = 'Error loading settings.';
             return;
        }
        $("#minutes").val(data.timeLimit);

        $('#customizeLimits').prop('checked', data.customizeLimits);
        if (data.customizeLimits) {
            $("#customLimitsDiv").show();
            $("#minutes").prop("disabled", true);
            populateDayLimits(data.dayLimits, data.timeLimit);
        } else {
            $("#customLimitsDiv").hide();
            $("#minutes").prop("disabled", false);
        }

        $("#time").val(data.resetTime);

        $('#limitOverrides').prop('checked', data.limitOverrides);
        if (data.limitOverrides) {
            $('#overrideLimitRow').css("visibility", "visible");
            $("#overrideLimit").val(data.overrideLimit);
        } else {
            $('#overrideLimitRow').css("visibility", "hidden");
        }

        $('#pauseOutOfFocus').prop('checked', data.pauseOutOfFocus);
        $('#youtubekidsEnabled').prop('checked', data.youtubekidsEnabled);
        renderWhitelist(data.whitelistedHandles); 

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
        li.textContent = identifier; 

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

    if (identifierToAdd.startsWith('/channel/')) {
        identifierToAdd = identifierToAdd.substring('/channel/'.length);
    } else if (identifierToAdd.startsWith('/@')) {
        identifierToAdd = identifierToAdd.substring(1); 
    } else if (identifierToAdd.startsWith('/')) { 
        identifierToAdd = identifierToAdd.substring(1);
    }

    const isValidHandle = STANDALONE_HANDLE_REGEX.test(identifierToAdd);
    const isValidChannelID = STANDALONE_CHANNEL_ID_REGEX.test(identifierToAdd);

    if (isValidHandle || isValidChannelID) {
        if (isValidHandle && identifierToAdd.includes('%')) {
            try {
                identifierToAdd = decodeURIComponent(identifierToAdd);
            } catch(e) {
                 console.warn("Could not decode identifier input, using original:", identifierToAdd, e);
                 statusMessageEl.textContent = 'Warning: Could not decode handle. Added as is, may not work as expected.';
                 clearStatusMessage();
            }
        }

        const currentIdentifiersInUI = Array.from(whitelistUl.querySelectorAll('li'))
                                       .map(li => li.firstChild.textContent);

        if (!currentIdentifiersInUI.includes(identifierToAdd)) {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.textContent = identifierToAdd; 

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

function saveAllSettings() {
    statusMessageEl.textContent = 'Saving...';

    let timeLimit = Number($("#minutes").val());
    timeLimit = Math.max(0, Math.min(1439, Math.round(timeLimit))); 
    $("#minutes").val(timeLimit);

    const customizeLimits = $('#customizeLimits').is(':checked');
    let dayLimits = {};
    if (customizeLimits) {
        $(".day-row").each(function() {
            const day = $(this).data("day");
            const noLimit = $(this).find(".no-limit-input").is(':checked');
            const minuteInput = $(this).find(".day-minute-input");

            if (noLimit) {
                dayLimits[day] = false; 
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
    overrideLimit = Math.max(0, Math.min(1000, Math.round(overrideLimit))); 
    $("#overrideLimit").val(overrideLimit);

    const pauseOutOfFocus = $('#pauseOutOfFocus').is(':checked');
    const youtubekidsEnabled = $('#youtubekidsEnabled').is(':checked');

    const whitelistedIdentifiers = Array.from(whitelistUl.querySelectorAll('li'))
                                 .map(li => li.firstChild.textContent);

    const settingsToSave = {
        timeLimit: timeLimit,
        customizeLimits: customizeLimits,
        dayLimits: dayLimits,
        resetTime: resetTime,
        limitOverrides: limitOverrides,
        overrideLimit: overrideLimit, 
        pauseOutOfFocus: pauseOutOfFocus,
        youtubekidsEnabled: youtubekidsEnabled,
        whitelistedHandles: whitelistedIdentifiers 
    };
    
    if (settingsToSave.limitOverrides) {
        settingsToSave.currentOverrideCount = settingsToSave.overrideLimit; 
    } else {
        chrome.storage.local.remove("currentOverrideCount", function() {
            if (chrome.runtime.lastError) {
                console.error("Options: Error removing currentOverrideCount:", chrome.runtime.lastError.message);
            }
        });
    }

    chrome.storage.local.set(settingsToSave, function() {
        if (chrome.runtime.lastError) {
            statusMessageEl.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
            console.error("Error saving settings:", chrome.runtime.lastError);
        } else {
            settingsChanged = false;
            statusMessageEl.textContent = 'Settings Saved Successfully!';

            let newTimeLeftForBackground;
            const savedDayLimits = settingsToSave.dayLimits;
            const savedCustomizeLimits = settingsToSave.customizeLimits;
            const savedTimeLimit = settingsToSave.timeLimit; 
            const todayDayName = days[new Date().getDay()];

            if (savedCustomizeLimits) { 
                 if (todayDayName in savedDayLimits) { 
                     if (savedDayLimits[todayDayName] === false) { 
                         newTimeLeftForBackground = -1; 
                         chrome.runtime.sendMessage({ msg: "noLimitInputChange", day: todayDayName });
                     } else { 
                         newTimeLeftForBackground = savedDayLimits[todayDayName] * 60;
                         chrome.runtime.sendMessage({ msg: "dayTimeLimitUpdated", day: todayDayName, newLimit: savedDayLimits[todayDayName] });
                     }
                 } else { 
                     newTimeLeftForBackground = savedTimeLimit * 60; 
                 }
            } else { 
                newTimeLeftForBackground = savedTimeLimit * 60;
                chrome.runtime.sendMessage({ msg: "customizeLimitsFalse" }); 
            }
            
            if (newTimeLeftForBackground !== -1) { 
                 chrome.runtime.sendMessage({
                     msg: "updateTimeLeftNow", 
                     newTime: newTimeLeftForBackground
                 }, response => {
                    if (chrome.runtime.lastError) console.warn("BG response error (updateTimeLeftNow):", chrome.runtime.lastError.message);
                 });
            }


            chrome.runtime.sendMessage({ msg: "pauseOutOfFocus", val: pauseOutOfFocus });
            chrome.runtime.sendMessage({ msg: "youtubekidsEnabled", val: youtubekidsEnabled });
            chrome.runtime.sendMessage({ msg: "resetTimeUpdated" }); 

            ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Save All Settings'});
        }
        clearStatusMessage();
    });
}


function addChangeListeners() {
    $('.setting-input').off('change input');
    $('#customizeLimits').off('change');
    $('.no-limit-input').off('change');
    $('#limitOverrides').off('change');
    $('#addWhitelistBtn').off('click');
    $(whitelistUl).off('click', '.remove-whitelist-btn');
    $('#saveAllSettingsBtn').off('click');
    $(window).off('beforeunload');

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
            (e || window.event).returnValue = confirmationMessage; 
            return confirmationMessage; 
        }
        return undefined; 
    });
}

document.addEventListener('DOMContentLoaded', function() {
    if (whitelistInput) {
        whitelistInput.placeholder = "Enter @handle, Channel ID, or channel path";
    }
    loadSettings();
});