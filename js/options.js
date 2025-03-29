ga('send', 'pageview', '/options.html');

chrome.storage.local.get({"limitOverrides":true}, function(data) {
	if (data.limitOverrides == true) {
		$('#limitOverrides').prop('checked', true);
		$('#overrideLimitRow').css("visibility", "visible");
	}
});

chrome.storage.local.get({"timeLimit":30}, function(data) {
	$("#minutes").val(data.timeLimit);
});

function populateDayLimits() {
	chrome.storage.local.get({"dayLimits":{}, "timeLimit":30}, function(data) {
		var dayLimits = data.dayLimits;
		var dayDivs = $(".day-row").each(function(i) {
			var day = $(this).data("day");
			var minuteInput = $(this).find(".day-minute-input");
			if (day in dayLimits) {
				if (dayLimits[day] === false) {
					$(this).find(".save-day-limit, .day-minute-input").prop("disabled", true);
					$(this).find(".no-limit-input").prop('checked', true);
				} else {
					minuteInput.val(dayLimits[day]);
				}
			} else {
				minuteInput.val(data.timeLimit);
			}
		});

		$("#customLimitsDiv").show();
	});
}

chrome.storage.local.get({"customizeLimits":false}, function(data) {
	if (data.customizeLimits == true) {
		$('#customizeLimits').prop('checked', true);
		$("#minutes, #saveMinutes").prop("disabled", true);
		populateDayLimits();
	}
});

chrome.storage.local.get({"pauseOutOfFocus":true}, function(data) {
	if (data.pauseOutOfFocus == true)
		$('#pauseOutOfFocus').prop('checked', true);
});

chrome.storage.local.get({"youtubekidsEnabled":true}, function(data) {
	if (data.youtubekidsEnabled == true)
		$('#youtubekidsEnabled').prop('checked', true);
});

chrome.storage.local.get({"overrideLimit":5}, function(data) {
	$("#overrideLimit").val(data.overrideLimit);
});


chrome.storage.local.get({"resetTime":"00:00"}, function(data) {
	$("#time").val(data.resetTime);
});

$("#saveMinutes").click(function() {
	let minutes = Number($("#minutes").val());

	if (minutes % 0.5 != 0) {
		minutes = Math.round(minutes*2)/2; //rounds to nearest 0.5
	}

	if (minutes < 0) {
		minutes = 0; 
	} else if (minutes > 1439) {
		minutes = 1439;
	}
	$("#minutes").val(minutes);
	ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated time limit', eventValue: minutes});

	chrome.storage.local.set({"timeLimit": minutes, "timeLeft": minutes*60}, function() {
		chrome.runtime.sendMessage({
			msg: "timeLimitUpdated"
		});
		alert("Limit Saved");
	});
});

$("#saveOverrideLimit").click(function() {
	let overrideLimit = Number($("#overrideLimit").val());
	if (overrideLimit < 0) {
		overrideLimit = 0;
	} else if (overrideLimit > 1000) {
		overrideLimit = 1000;
	}
	$("#overrideLimit").val(overrideLimit);
	ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated override limit', eventValue: overrideLimit});

	chrome.storage.local.set({"overrideLimit": overrideLimit, "currentOverrideCount": overrideLimit}, function() {
		alert("Override Limit Saved");
	});
});

$("#saveTime").click(function() {
	var resetTime = $("#time").val();
	var resetHour = parseInt(resetTime.split(":")[0]);
	var resetMinute = parseInt(resetTime.split(":")[1]);
	ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated reset time', eventLabel: resetTime, eventValue: resetHour*60+resetMinute});
	chrome.storage.local.set({"resetTime": resetTime}, function() {
		chrome.runtime.sendMessage({
			msg: "resetTimeUpdated"
		});
		alert("Time Saved");
	});
});


$('#pauseOutOfFocus').change(function() {
	if (this.checked) {
		ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated pause out of focus', eventLabel: "true", eventValue: 1});
		chrome.storage.local.set({"pauseOutOfFocus": true});
		chrome.runtime.sendMessage({msg: "pauseOutOfFocus", val: true});
	} else {
		ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated pause out of focus', eventLabel: "false", eventValue: 0});
		chrome.storage.local.set({"pauseOutOfFocus": false});
		chrome.runtime.sendMessage({msg: "pauseOutOfFocus", val: false});
	}
});

$('#youtubekidsEnabled').change(function() {
	if (this.checked) {
		ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated YouTube Kids enabled', eventLabel: "true", eventValue: 1});
		chrome.storage.local.set({"youtubekidsEnabled": true});
		chrome.runtime.sendMessage({msg: "youtubekidsEnabled", val: true});
	} else {
		ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated YouTube Kids enabled', eventLabel: "false", eventValue: 0});
		chrome.storage.local.set({"youtubekidsEnabled": false});
		chrome.runtime.sendMessage({msg: "youtubekidsEnabled", val: false});
	}
});

$('#limitOverrides').change(function() {
	if (this.checked) {
		$('#overrideLimitRow').css("visibility", "visible");
		ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated limit overrides toggle', eventLabel: "true", eventValue: 1});
		chrome.storage.local.set({"limitOverrides": true});
	} else {
		$('#overrideLimitRow').css("visibility", "hidden");
		ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated limit overrides toggle', eventLabel: "false", eventValue: 0});
		chrome.storage.local.set({"limitOverrides": false});
	}
});

$("#customizeLimits").change(function() {
	if (this.checked) {
		chrome.storage.local.set({"customizeLimits": true});
		$("#customLimitsDiv").show();
		$("#minutes, #saveMinutes").prop("disabled", true);

		chrome.storage.local.get({"timeLimit":30}, function(data) {
			$("#minutes").val(data.timeLimit);
		});
		populateDayLimits();
		ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated customize limits', eventLabel: "true", eventValue: 1});
	} else {
		chrome.storage.local.set({"customizeLimits": false});
		$("#customLimitsDiv").hide();
		$("#minutes, #saveMinutes").prop("disabled", false);

		chrome.storage.local.set({"dayLimits":{}});
		$(".day-minute-input").val("");
		$(".no-limit-input").prop('checked', false);
		$(".save-day-limit, .day-minute-input").prop("disabled", false);
		chrome.runtime.sendMessage({
			msg: "customizeLimitsFalse"
		});
		ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated customize limits', eventLabel: "false", eventValue: 0});
	}
});

$(".no-limit-input").change(function() {
	var day = $(this).closest(".day-row").data("day");
	if (this.checked) {
		$(this).closest(".day-row").find(".save-day-limit, .day-minute-input").prop("disabled", true);
		$(this).closest(".day-row").find(".day-minute-input").val("");
		chrome.storage.local.get({"dayLimits":{}}, function(data) {
			data.dayLimits[day] = false;
			chrome.storage.local.set({"dayLimits": data.dayLimits}, function() {
				chrome.runtime.sendMessage({
					msg: "noLimitInputChange",
					day: day
				});	
			});
		});
		ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated ' + day + ' no limit', eventLabel: "true", eventValue: 1});
	} else {
		var noLimitInput = $(this);
		chrome.storage.local.get({"dayLimits":{}, "timeLimit":30}, function(data) {
			delete data.dayLimits[day];
			chrome.storage.local.set({"dayLimits": data.dayLimits}, function() {
				chrome.runtime.sendMessage({
					msg: "noLimitInputChange",
					day: day
				});	
			});
			noLimitInput.closest(".day-row").find(".day-minute-input").val(data.timeLimit);
			noLimitInput.closest(".day-row").find(".save-day-limit, .day-minute-input").prop("disabled", false);
		});
		ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated ' + day + ' no limit', eventLabel: "false", eventValue: 0});
	}
});

$(".save-day-limit").click(function() {
	var day = $(this).closest(".day-row").data("day");
	var dayUpperCase = $(this).closest(".day-row").find(".day-label").text();
	var minuteInput = $(this).closest(".day-row").find(".day-minute-input");
	var minutes = Number(minuteInput.val());

	if (minutes % 0.5 != 0) {
		minutes = Math.round(minutes*2)/2; //rounds to nearest 0.5
	}

	if (minutes < 0) {
		minutes = 0; 
	} else if (minutes > 1439) {
		minutes = 1439;
	}
	minuteInput.val(minutes);

	chrome.storage.local.get({"dayLimits":{}}, function(data) {
		data.dayLimits[day] = minutes;
		chrome.storage.local.set({"dayLimits": data.dayLimits}, function() {
			chrome.runtime.sendMessage({
				msg: "dayTimeLimitUpdated",
				day: day
			});
			alert(dayUpperCase + " Limit Saved");
		});
	});
	ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Updated ' + day + ' time limit', eventValue: minutes});
});

const whitelistInput = document.getElementById('whitelistChannelId');
const addWhitelistBtn = document.getElementById('addWhitelistBtn');
const whitelistUl = document.getElementById('whitelist');

// Function to render the whitelist from storage
function renderWhitelist() {
    chrome.storage.local.get({ "whitelistedChannels": [] }, function(data) {
        whitelistUl.innerHTML = ''; // Clear current list
        data.whitelistedChannels.forEach(channelId => {
            const li = document.createElement('li');
            li.className = 'list-group-item d-flex justify-content-between align-items-center';
            li.textContent = channelId;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn btn-danger btn-sm remove-whitelist-btn';
            removeBtn.textContent = 'Remove';
            removeBtn.dataset.channelId = channelId; // Store channelId for removal

            li.appendChild(removeBtn);
            whitelistUl.appendChild(li);
        });
    });
}

// Function to add a channel to the whitelist
function addChannelToWhitelist() {
    const channelId = whitelistInput.value.trim();
    // Basic validation for YouTube channel ID format (UC followed by 22 chars)
    if (/^UC[A-Za-z0-9_\-]{22}$/.test(channelId)) {
        chrome.storage.local.get({ "whitelistedChannels": [] }, function(data) {
            const currentWhitelist = data.whitelistedChannels;
            if (!currentWhitelist.includes(channelId)) {
                currentWhitelist.push(channelId);
                chrome.storage.local.set({ "whitelistedChannels": currentWhitelist }, function() {
                    whitelistInput.value = ''; // Clear input
                    renderWhitelist(); // Re-render the list
                    alert('Channel added to whitelist.');
                     ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Whitelist Add', eventLabel: channelId});
                });
            } else {
                alert('Channel is already whitelisted.');
            }
        });
    } else {
        alert('Invalid YouTube Channel ID format. It should start with "UC" followed by 22 characters.');
    }
}

// Function to remove a channel from the whitelist
function removeChannelFromWhitelist(channelIdToRemove) {
    chrome.storage.local.get({ "whitelistedChannels": [] }, function(data) {
        const currentWhitelist = data.whitelistedChannels;
        const updatedWhitelist = currentWhitelist.filter(id => id !== channelIdToRemove);
        chrome.storage.local.set({ "whitelistedChannels": updatedWhitelist }, function() {
            renderWhitelist(); // Re-render the list
            alert('Channel removed from whitelist.');
            ga('send', {hitType: 'event', eventCategory: 'Settings', eventAction: 'Whitelist Remove', eventLabel: channelIdToRemove});
        });
    });
}

// --- Event Listeners ---

// Add button click
addWhitelistBtn.addEventListener('click', addChannelToWhitelist);

// Listener for remove buttons (using event delegation)
whitelistUl.addEventListener('click', function(event) {
    if (event.target.classList.contains('remove-whitelist-btn')) {
        const channelId = event.target.dataset.channelId;
        if (confirm(`Are you sure you want to remove channel ${channelId} from the whitelist?`)) {
            removeChannelFromWhitelist(channelId);
        }
    }
});


// Initial rendering of the whitelist when the options page loads
document.addEventListener('DOMContentLoaded', renderWhitelist);