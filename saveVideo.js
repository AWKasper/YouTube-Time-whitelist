// --- Overlay Elements (Global within this script) ---
let overlay = null;
let overrideButton = null;
let overridesLeftText = null;

// --- Function to Create Overlay ---
function createOverlay() {
    if (document.getElementById('youtube-time-overlay')) {
        return; // Already exists
    }

    overlay = document.createElement('div');
    overlay.id = 'youtube-time-overlay';
    // Classes are handled dynamically for visibility transition

    const contentDiv = document.createElement('div');
    contentDiv.id = 'youtube-time-overlay-content';

    const title = document.createElement('h1');
    title.textContent = 'Time is up';

    const overrideCommands = document.createElement('div');
    overrideCommands.style.marginTop = '20px'; // Add some spacing

    overrideButton = document.createElement('button');
    overrideButton.id = 'youtube-time-override-btn';
    overrideButton.textContent = 'Override';
    overrideButton.addEventListener('click', handleOverrideClick);

    overridesLeftText = document.createElement('div');
    overridesLeftText.id = 'youtube-time-overrides-left';
    overridesLeftText.textContent = ''; // Will be populated later

    overrideCommands.appendChild(overrideButton);
    overrideCommands.appendChild(overridesLeftText);

    contentDiv.appendChild(title);
    contentDiv.appendChild(overrideCommands);
    overlay.appendChild(contentDiv);

    document.body.appendChild(overlay);
    console.log("YouTube Time overlay created.");
}

// --- Function to Show Overlay ---
function showOverlay() {
    if (!overlay) {
        createOverlay();
    }
    if (!overlay) return; // Creation failed

    // Pause video
    const videoElement = document.querySelector('video.html5-main-video'); // Common selector
    if (videoElement && !videoElement.paused) {
        videoElement.pause();
        console.log("YouTube Time: Video paused.");
    } else if (!videoElement) {
         console.log("YouTube Time: Could not find video element to pause.");
    }

    // Update override button status
    chrome.storage.local.get({"overrideLimit":5, "currentOverrideCount":null, "limitOverrides":true}, function(data) {
        const currentCount = data.currentOverrideCount !== null ? data.currentOverrideCount : data.overrideLimit;
        const limitEnabled = data.limitOverrides;

        if(overrideButton && overridesLeftText) {
            if (limitEnabled) {
                 if (currentCount < 1) {
                    overrideButton.disabled = true;
                    overrideButton.style.display = 'none'; // Hide if no overrides left
                    overridesLeftText.textContent = "No overrides remaining today.";
                 } else {
                    overrideButton.disabled = false;
                    overrideButton.style.display = 'inline-block';
                    overridesLeftText.textContent = `${currentCount} Override${currentCount === 1 ? '' : 's'} Left`;
                 }
            } else {
                // Overrides not limited
                overrideButton.disabled = false;
                overrideButton.style.display = 'inline-block';
                overridesLeftText.textContent = "Overrides are not limited.";
            }
        }
    });

    // Make overlay visible and add body class
    overlay.classList.add('visible');
    document.body.classList.add('youtube-time-overlay-active');
    console.log("YouTube Time overlay shown.");
}

// --- Function to Hide Overlay ---
function hideOverlay() {
    if (overlay) {
        overlay.classList.remove('visible');
        document.body.classList.remove('youtube-time-overlay-active');
        console.log("YouTube Time overlay hidden.");
        // Note: We don't automatically resume the video here. User has to do it.
    }
}

// --- Override Button Click Handler ---
function handleOverrideClick() {
    const answer = confirm("Are you sure you need to use YouTube?");
    if (answer) {
        // Send message to background to handle override logic (decrement count, set state)
        chrome.runtime.sendMessage({ msg: "override", value: true }, (response) => {
             if (chrome.runtime.lastError) {
                 console.error("Error sending override message:", chrome.runtime.lastError.message);
                 // Optional: Show an error to the user on the overlay?
             } else {
                // Optimistically hide overlay immediately for better UX
                 hideOverlay();
                 ga('send', {hitType: 'event', eventCategory: 'Overlay', eventAction: 'Override'});
             }
        });
    }
}


// --- Message Listener from Background Script ---
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // console.log("Content script received message:", request.msg); // Debugging

    if (request.msg === "showOverlay") {
        showOverlay();
        sendResponse({status: "Overlay shown"});
        return true; // Indicate async response potentially needed later if we added more logic
    }

    if (request.msg === "hideOverlay") {
        hideOverlay();
        sendResponse({status: "Overlay hidden"});
         return true;
    }

    // --- Keep Existing Listeners ---
    if (request.msg === "getChannelHandleFromPage") {
        let channelHandle = null;
        let handleElement = null;

        // Try selectors (add more as needed)
        handleElement = document.querySelector("span[itemprop='author'] link[itemprop='url'][href*='/@']");
        if (!handleElement) {
            handleElement = document.querySelector("ytd-channel-name #text-container a.yt-simple-endpoint[href^='/@'], a.yt-simple-endpoint.ytd-video-owner-renderer[href^='/@']");
        }
        // Add more robust selectors if the above fail often
         if (!handleElement) {
             // Look for the canonical URL link which often has the handle
             handleElement = document.querySelector("link[rel='canonical'][href*='/@']");
         }


        if (handleElement && handleElement.href) {
             try {
                 const urlPath = new URL(handleElement.href).pathname;
                 const handleMatch = urlPath.match(/\/(@[\w.-]+)/);
                 if (handleMatch && handleMatch[1]) {
                     channelHandle = handleMatch[1];
                 }
             } catch(e) {
                 console.error("Error parsing handle link:", e);
             }
        } else {
            // console.log("Could not find handle element using known selectors.");
        }

        // console.log("Content script sending handle:", channelHandle);
        sendResponse({ channelHandle: channelHandle });
        return true;
    }

    if (request.msg == "saveVideoURL") {
		let video = document.getElementsByClassName('video-stream')[0];
        if (video) {
		    let totalSeconds = Math.floor(video.currentTime);
		    sendResponse(urlNoTime(location.href) + "&t=" + totalSeconds);
        } else {
            sendResponse(urlNoTime(location.href));
        }
        return true; // Indicate async response
	}
});

function urlNoTime(url) {
    if (!url) return null;
	return url.split("&t=")[0];
}

// --- Initial Check on Load ---
// Check if the overlay should be shown immediately when the page loads
// This covers cases where the timer ran out before navigating to this page.
chrome.storage.local.get(["timeLeft", "override"], function(data) {
    if (data.timeLeft <= 0 && !data.override) {
        // Check if current page is YouTube and not whitelisted before showing overlay
        chrome.runtime.sendMessage({ msg: "checkPageStatus", url: window.location.href }, response => {
            if (chrome.runtime.lastError) {
                 console.warn("Error checking page status on load:", chrome.runtime.lastError.message);
                 // Assume we should show overlay if error occurs? Or default to not showing?
                 // Let's default to not showing overlay on error during load check.
            } else if (response && response.shouldOverlay) {
                 showOverlay();
            }
        });
    }
});