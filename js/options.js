const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

let settingsChanged = false;
const statusMessageEl = document.getElementById('statusMessage');

const STANDALONE_HANDLE_REGEX = /^(@[^/?#\s]{3,})$/;
const STANDALONE_CHANNEL_ID_REGEX = /^(UC[a-zA-Z0-9_-]{22})$/;

// Password related elements
const passwordSectionEl = document.getElementById('passwordSection');
const optionsContentEl = document.getElementById('optionsContent');
const passwordInputEl = document.getElementById('passwordInput');
const submitPasswordBtnEl = document.getElementById('submitPasswordBtn');
const generatePasswordSuggestionBtnEl = document.getElementById('generatePasswordSuggestionBtn');
const passwordSuggestionEl = document.getElementById('passwordSuggestion');
const passwordErrorEl = document.getElementById('passwordError');
const passwordInstructionsEl = document.getElementById('passwordInstructions');
const setChangePasswordBtnEl = document.getElementById('setChangePasswordBtn');
const removePasswordBtnEl = document.getElementById('removePasswordBtn');
const passwordTitleEl = document.getElementById('passwordTitle');


function setSettingsChanged() {
	settingsChanged = true;
    statusMessageEl.textContent = '';
}

function clearStatusMessage() {
    setTimeout(() => {
        statusMessageEl.textContent = '';
    }, 3000);
}

// --- Password Functions ---
async function hashPassword(password) {
    if (!password) return null;
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function showOptions() {
    if (passwordSectionEl) passwordSectionEl.style.display = 'none';
    if (optionsContentEl) optionsContentEl.style.display = 'block';
    loadSettings(); // Load actual settings only after unlocking
}

function showPasswordScreen(isPasswordSet) {
    if (passwordSectionEl) passwordSectionEl.style.display = 'block';
    if (optionsContentEl) optionsContentEl.style.display = 'none';
    if (passwordInputEl) passwordInputEl.value = '';
    if (passwordErrorEl) passwordErrorEl.textContent = '';
    if (passwordSuggestionEl) passwordSuggestionEl.textContent = '';

    if (isPasswordSet) {
        if (passwordTitleEl) passwordTitleEl.textContent = 'Enter Password';
        if (passwordInstructionsEl) passwordInstructionsEl.textContent = 'Enter your password to unlock options.';
    } else {
        if (passwordTitleEl) passwordTitleEl.textContent = 'Secure Your Settings';
        if (passwordInstructionsEl) passwordInstructionsEl.textContent = 'No password set. Leave blank and click "Unlock Options" to access settings and set a password (recommended).';
    }
}

function generateStrongPassword() {
    const length = 16;
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
        retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        const originalText = passwordSuggestionEl.textContent;
        passwordSuggestionEl.textContent += ' (Copied!)';
        setTimeout(() => {
            passwordSuggestionEl.textContent = originalText; // Restore original text or clear specific part
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy password: ', err);
        passwordSuggestionEl.textContent += ' (Copy manually)';
    });
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

        addChangeListeners(); // Ensure event listeners for settings are (re-)added
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
    if (!whitelistUl) return;
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
    if (!whitelistInput || !whitelistUl) return;
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
     if (!whitelistUl) return;
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

    const whitelistedIdentifiers = whitelistUl ? Array.from(whitelistUl.querySelectorAll('li'))
                                 .map(li => li.firstChild.textContent) : [];

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

    // Fetch current timer state from background to make intelligent updates
    chrome.runtime.sendMessage({ msg: "getCurrentTimeLeft" }, (response) => {
        let currentActualTimeLeft = -1; // Default to indicate not fetched or error
        let currentNoLimitState = false;

        if (chrome.runtime.lastError || !response) {
            console.warn("Options: Error getting current timer state from background:", chrome.runtime.lastError?.message);
            // Proceed with save but background might not adjust timer optimally immediately
        } else {
            currentActualTimeLeft = response.currentTimeLeft;
            currentNoLimitState = response.noLimitActive;
        }

        // Save all settings to storage
        chrome.storage.local.set(settingsToSave, function() {
            if (chrome.runtime.lastError) {
                statusMessageEl.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
                console.error("Error saving settings:", chrome.runtime.lastError);
                clearStatusMessage();
            } else {
                settingsChanged = false;
                statusMessageEl.textContent = 'Settings Saved Successfully!';

                // Inform background about general rule changes (like whitelist, etc.)
                chrome.runtime.sendMessage({ msg: "settingsRulesChanged" });

                // Determine today's new limit rules from saved settings
                let newNoLimitForToday = false;
                let newCalculatedTimeLimitForTodayInSeconds;
                const todayDayName = days[new Date().getDay()];

                if (settingsToSave.customizeLimits) {
                    if (todayDayName in settingsToSave.dayLimits) {
                        if (settingsToSave.dayLimits[todayDayName] === false) {
                            newNoLimitForToday = true;
                        } else {
                            newCalculatedTimeLimitForTodayInSeconds = settingsToSave.dayLimits[todayDayName] * 60;
                        }
                    } else { // Defaults to global if day not specified under custom limits
                        newCalculatedTimeLimitForTodayInSeconds = settingsToSave.timeLimit * 60;
                    }
                } else { // Not using custom limits, use global
                    newCalculatedTimeLimitForTodayInSeconds = settingsToSave.timeLimit * 60;
                }

                // Send specific message to background to adjust today's timer state
                chrome.runtime.sendMessage({
                    msg: "setNoLimitToday",
                    noLimitStateFromOptions: newNoLimitForToday, // boolean: is today now no-limit?
                    newTimeForTodayFromOptions: newNoLimitForToday ? 0 : newCalculatedTimeLimitForTodayInSeconds, // if limited, this is the new limit in seconds
                    currentActualTimeLeftFromBG: currentActualTimeLeft, // timeLeft in background *before* this save
                    wasPreviouslyNoLimitInBG: currentNoLimitState      // noLimit in background *before* this save
                }, resp => {
                     if (chrome.runtime.lastError) console.warn("Options: BG response error (setNoLimitToday):", chrome.runtime.lastError.message);
                });


                // Send other specific updates
                chrome.runtime.sendMessage({ msg: "pauseOutOfFocus", val: settingsToSave.pauseOutOfFocus });
                chrome.runtime.sendMessage({ msg: "youtubekidsEnabled", val: settingsToSave.youtubekidsEnabled });
                chrome.runtime.sendMessage({ msg: "resetTimeUpdated" }); // Triggers checkReset in background

                ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Save All Settings'});
                clearStatusMessage();
            }
        });
    });
}


function addChangeListeners() {
    // Unbind previous to prevent multiple attachments if loadSettings is called multiple times
    $('.setting-input').off('change input', setSettingsChanged);
    $('#customizeLimits').off('change', handleCustomizeLimitsChange);
    $('.no-limit-input').off('change', handleNoLimitChange);
    $('#limitOverrides').off('change', handleLimitOverridesChange);
    if (addWhitelistBtn) $(addWhitelistBtn).off('click', addChannelToWhitelist);
    if (whitelistUl) $(whitelistUl).off('click', '.remove-whitelist-btn');
    $('#saveAllSettingsBtn').off('click', saveAllSettings);
    $(window).off('beforeunload');


    // Bind new listeners
    $('.setting-input').on('change input', setSettingsChanged);
    $('#customizeLimits').on('change', handleCustomizeLimitsChange);
    $('.no-limit-input').on('change', handleNoLimitChange);
    $('#limitOverrides').on('change', handleLimitOverridesChange);

    if (addWhitelistBtn) addWhitelistBtn.addEventListener('click', addChannelToWhitelist);
    if (whitelistUl) {
        whitelistUl.addEventListener('click', function(event) {
            if (event.target.classList.contains('remove-whitelist-btn')) {
                const identifier = event.target.dataset.identifier;
                removeChannelFromWhitelist(identifier);
            }
        });
    }
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

    // Password check and screen display
    chrome.storage.local.get("optionsPasswordHash", function(data) {
        const storedPasswordHash = data.optionsPasswordHash;
        showPasswordScreen(!!storedPasswordHash); // Pass boolean indicating if password is set
    });

    // Password section event listeners
    if (generatePasswordSuggestionBtnEl) {
        generatePasswordSuggestionBtnEl.addEventListener('click', () => {
            const suggestedPassword = generateStrongPassword();
            if (passwordSuggestionEl) passwordSuggestionEl.textContent = `Suggestion: ${suggestedPassword}`;
            copyToClipboard(suggestedPassword);
        });
    }

    if (submitPasswordBtnEl) {
        submitPasswordBtnEl.addEventListener('click', async () => {
            const enteredPassword = passwordInputEl.value;
            chrome.storage.local.get("optionsPasswordHash", async function(data) {
                const storedPasswordHash = data.optionsPasswordHash;
                if (storedPasswordHash) {
                    if (!enteredPassword && passwordErrorEl) {
                        passwordErrorEl.textContent = 'Password is required.';
                        return;
                    }
                    const enteredHashedPassword = await hashPassword(enteredPassword);
                    if (enteredHashedPassword === storedPasswordHash) {
                        showOptions();
                    } else if (passwordErrorEl) {
                        passwordErrorEl.textContent = 'Incorrect password.';
                    }
                } else { // No password set in storage
                    showOptions();
                }
            });
        });
    }

    // Password management buttons (inside unlocked options)
    if (setChangePasswordBtnEl) {
        setChangePasswordBtnEl.addEventListener('click', async () => {
            chrome.storage.local.get("optionsPasswordHash", async function(data) {
                const currentPasswordHash = data.optionsPasswordHash;
                if (currentPasswordHash) {
                    const oldPasswordAttempt = prompt("Enter your current password:");
                    if (oldPasswordAttempt === null) return;
                    if (!oldPasswordAttempt) { alert("Current password cannot be empty."); return; }
                    const oldPasswordAttemptHash = await hashPassword(oldPasswordAttempt);
                    if (oldPasswordAttemptHash !== currentPasswordHash) {
                        alert("Incorrect current password."); return;
                    }
                }

                const newPassword = prompt("Enter new password (cannot be empty):");
                if (newPassword === null) return;
                if (!newPassword) { alert("New password cannot be empty."); return; }

                const confirmNewPassword = prompt("Confirm new password:");
                if (confirmNewPassword === null) return;

                if (newPassword === confirmNewPassword) {
                    const newHashedPassword = await hashPassword(newPassword);
                    chrome.storage.local.set({ "optionsPasswordHash": newHashedPassword }, function() {
                        if (chrome.runtime.lastError) { alert('Error setting password: ' + chrome.runtime.lastError.message); }
                        else { alert("Password updated successfully."); }
                    });
                } else { alert("New passwords do not match."); }
            });
        });
    }

    if (removePasswordBtnEl) {
        removePasswordBtnEl.addEventListener('click', async () => {
            chrome.storage.local.get("optionsPasswordHash", async function(data) {
                const currentPasswordHash = data.optionsPasswordHash;
                if (!currentPasswordHash) { alert("No password is set."); return; }

                const passwordAttempt = prompt("Enter your current password to remove it:");
                if (passwordAttempt === null) return;
                if (!passwordAttempt) { alert("Password cannot be empty."); return; }

                const passwordAttemptHash = await hashPassword(passwordAttempt);
                if (passwordAttemptHash === currentPasswordHash) {
                    chrome.storage.local.remove("optionsPasswordHash", function() {
                        if (chrome.runtime.lastError) { alert('Error removing password: ' + chrome.runtime.lastError.message); }
                        else {
                            alert("Password removed successfully. Options are now unprotected.");
                            showPasswordScreen(false); // Refresh to show "Set a Password" state
                        }
                    });
                } else { alert("Incorrect password."); }
            });
        });
    }
    // Note: addChangeListeners() for general settings is called within loadSettings(),
    // which is called by showOptions() after successful password entry.
});