let overlay = null;
let overrideButton = null;
let overridesLeftText = null;

function createOverlay() {
    if (document.getElementById('youtube-time-overlay')) {
        return;
    }
    overlay = document.createElement('div');
    overlay.id = 'youtube-time-overlay';
    const contentDiv = document.createElement('div');
    contentDiv.id = 'youtube-time-overlay-content';
    const title = document.createElement('h1');
    title.textContent = 'Time is up';
    const overrideCommands = document.createElement('div');
    overrideCommands.style.marginTop = '20px';
    overrideButton = document.createElement('button');
    overrideButton.id = 'youtube-time-override-btn';
    overrideButton.textContent = 'Override';
    overrideButton.addEventListener('click', handleOverrideClick);
    overridesLeftText = document.createElement('div');
    overridesLeftText.id = 'youtube-time-overrides-left';
    overridesLeftText.textContent = '';
    overrideCommands.appendChild(overrideButton);
    overrideCommands.appendChild(overridesLeftText);
    contentDiv.appendChild(title);
    contentDiv.appendChild(overrideCommands);
    overlay.appendChild(contentDiv);
    document.body.appendChild(overlay);
    // console.log("YouTube Time: Overlay created.");
}

function showOverlay() {
    if (!overlay) {
        createOverlay();
    }
    if (!overlay) return;

    const videoElement = document.querySelector('video.html5-main-video');
    if (videoElement && !videoElement.paused) {
        videoElement.pause();
        // console.log("YouTube Time: Video paused.");
    } else if (!videoElement) {
         // console.log("YouTube Time: Could not find video element to pause.");
    }

    chrome.storage.local.get({"overrideLimit":5, "currentOverrideCount":null, "limitOverrides":true}, function(data) {
        const currentCount = data.currentOverrideCount !== null ? data.currentOverrideCount : data.overrideLimit;
        const limitEnabled = data.limitOverrides;
        if(overrideButton && overridesLeftText) {
            if (limitEnabled) {
                 if (currentCount < 1) {
                    overrideButton.disabled = true;
                    overrideButton.style.display = 'none';
                    overridesLeftText.textContent = "No overrides remaining today.";
                 } else {
                    overrideButton.disabled = false;
                    overrideButton.style.display = 'inline-block';
                    overridesLeftText.textContent = `${currentCount} Override${currentCount === 1 ? '' : 's'} Left`;
                 }
            } else {
                overrideButton.disabled = false;
                overrideButton.style.display = 'inline-block';
                overridesLeftText.textContent = "Overrides are not limited.";
            }
        }
    });

    overlay.classList.add('visible');
    document.body.classList.add('youtube-time-overlay-active');
    // console.log("YouTube Time: Overlay shown.");
}

function hideOverlay() {
    if (overlay) {
        overlay.classList.remove('visible');
        document.body.classList.remove('youtube-time-overlay-active');
        // console.log("YouTube Time: Overlay hidden.");
    }
}

function handleOverrideClick() {
    const answer = confirm("Are you sure you need to use YouTube?");
    if (answer) {
        chrome.runtime.sendMessage({ msg: "override", value: true }, (response) => {
             if (chrome.runtime.lastError) {
                 console.error("Error sending override message:", chrome.runtime.lastError.message);
             } else {
                 hideOverlay();
             }
        });
    }
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // console.log("Content script received message:", request.msg); // Uncomment for debugging

    if (request.msg === "showOverlay") {
        showOverlay();
        sendResponse({status: "Overlay shown"});
        return true;
    }

    if (request.msg === "hideOverlay") {
        hideOverlay();
        sendResponse({status: "Overlay hidden"});
         return true;
    }

    if (request.msg === "getChannelHandleFromPage") {
        let channelHandle = null;
        let handleElement = null;
        let foundUsing = "none";

        // Try different selectors to find the channel link
        handleElement = document.querySelector("ytd-video-owner-renderer ytd-channel-name a.yt-simple-endpoint[href^='/@']");
        if (handleElement) {
           foundUsing = "ytd-video-owner-renderer ytd-channel-name a";
        }

        if (!handleElement) {
           handleElement = document.querySelector("ytd-channel-name a.yt-simple-endpoint[href^='/@']");
           if (handleElement) {
             foundUsing = "ytd-channel-name a";
           }
        }

        if (!handleElement) {
            handleElement = document.querySelector("span[itemprop='author'] link[itemprop='url'][href*='/@']");
             if (handleElement) {
               foundUsing = "itemprop";
             }
        }

        if (!handleElement) {
             // Check canonical link, often contains the handle URL for video pages
             handleElement = document.querySelector("link[rel='canonical'][href*='/@']");
             if (handleElement) {
                foundUsing = "canonical";
             }
         }

        if (handleElement && handleElement.href) {
             // console.log("Found handle element using:", foundUsing, handleElement); // Uncomment for debugging
             try {
                 const urlObj = new URL(handleElement.href, document.baseURI);
                 const urlPath = urlObj.pathname;

                 let decodedPath = urlPath;
                 try {
                    decodedPath = decodeURIComponent(urlPath);
                    // console.log("Original path:", urlPath); // Debugging
                    // console.log("Explicitly decoded path:", decodedPath); // Debugging
                 } catch(decodeError) {
                    console.warn("Error decoding path:", urlPath, decodeError);
                 }

                 // --- Use the decodedPath for matching ---
                 // *** UPDATED REGEX *** Matches '@' followed by one or more non-slash, non-whitespace characters
                 const handleMatch = decodedPath.match(/\/(@[^\/\s]+)/);
                 if (handleMatch && handleMatch[1]) {
                     channelHandle = handleMatch[1];
                     // console.log("Regex matched:", handleMatch[1]); // Debugging
                 } else {
                    // console.log("Regex did not match decoded path:", decodedPath); // Debugging
                 }
                 // --- End use decodedPath ---

             } catch(e) {
                 console.error("Error parsing handle link:", handleElement.href, e);
             }
        } else {
            // console.log("Could not find handle element using known selectors."); // Debugging
        }

        // console.log("Content script sending handle:", channelHandle); // Debugging
        sendResponse({ channelHandle: channelHandle }); // Send the DECODED handle (or null)
        return true; // Indicate async response
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

    return false;
});

function urlNoTime(url) {
    if (!url) return null;
	return url.split("&t=")[0];
}

chrome.storage.local.get(["timeLeft", "override", "tempOverrideTabs"], function(data) {
    if (chrome.runtime.lastError) {
      console.warn("Error getting initial storage:", chrome.runtime.lastError.message);
      return;
    }
    if (data.timeLeft <= 0 && !data.override) {
        chrome.runtime.sendMessage({ msg: "checkPageStatus", url: window.location.href }, response => {
            if (chrome.runtime.lastError) {
                 if (!chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                     console.warn("Error checking page status on load:", chrome.runtime.lastError.message);
                 }
            } else if (response && response.shouldOverlay) {
                 showOverlay();
            }
        });
    }
});