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
    document.body.appendChild(overlay);
    // console.log("CS: YouTube Time: Overlay created.");
}

function showOverlay() {
    if (!overlay) createOverlay();
    if (!overlay) return;

    const videoElement = document.querySelector('video.html5-main-video');
    if (videoElement && !videoElement.paused) videoElement.pause();

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
    // console.log("CS: YouTube Time: Overlay shown.");
}

function hideOverlay() {
    if (overlay) {
        overlay.classList.remove('visible');
        document.body.classList.remove('youtube-time-overlay-active');
        // console.log("CS: YouTube Time: Overlay hidden.");
    }
}

function handleOverrideClick() {
    if (confirm("Are you sure you need to use YouTube?")) {
        chrome.runtime.sendMessage({ msg: "override", value: true }, (response) => {
             if (chrome.runtime.lastError) console.error("CS: Error sending override message:", chrome.runtime.lastError.message);
             else hideOverlay();
        });
    }
}


function extractIdentifierFromUrlPath(path) {
    if (!path) return null;

    // Check for @handle pattern first: /@something
    // Modified regex to capture percent-encoded characters in handles.
    // It matches '@' followed by at least 3 characters that are not '/', '?', '#', or whitespace.
    // The captured string (e.g., "@%E3%83%88...") will be decoded later.
    let handleMatch = path.match(/^\/(@[^/?#\s]{3,})/); 
    if (handleMatch && handleMatch[1]) {
        return handleMatch[1];
    }

    // Then check for /channel/UC... pattern (this regex remains unchanged)
    let channelIdMatch = path.match(/^\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    if (channelIdMatch && channelIdMatch[1]) {
        return channelIdMatch[1];
    }
    
    return null;
}


chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // console.log("CS: Received message:", request.msg);

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
        let outHandle = null;
        let outUcId = null;
        // console.log("CS: --- Attempting to get channel identifiers (handle & UCID) ---");

        // STAGE 1: Prioritize @handle if the current window URL path clearly indicates it.
        // This is for when the user is directly on a page like youtube.com/@handle
        // Also try to get UCID if path is like /channel/UCID
        let idFromCurrentPath = extractIdentifierFromUrlPath(window.location.pathname);
        if (idFromCurrentPath) {
            if (idFromCurrentPath.startsWith('@')) {
                outHandle = idFromCurrentPath;
                // if (outHandle) console.log("CS: Stage 1 - Found @handle from window.location.pathname:", outHandle);
            } else if (idFromCurrentPath.startsWith('UC')) {
                outUcId = idFromCurrentPath;
                // if (outUcId) console.log("CS: Stage 1 - Found UCID from window.location.pathname:", outUcId);
            }
        }

        // STAGE 2: Check canonical URL. This can provide either @handle or UCID.
        const canonicalLinkElement = document.querySelector('link[rel="canonical"]');
        if (canonicalLinkElement && canonicalLinkElement.href) {
            try {
                const canonicalUrl = new URL(canonicalLinkElement.href);
                let idFromCanonical = extractIdentifierFromUrlPath(canonicalUrl.pathname);
                if (idFromCanonical) {
                    if (idFromCanonical.startsWith('@') && !outHandle) {
                        outHandle = idFromCanonical;
                        // if (outHandle) console.log("CS: Stage 2 - Found @handle from canonical URL:", outHandle);
                    } else if (idFromCanonical.startsWith('UC') && !outUcId) {
                        outUcId = idFromCanonical;
                        // if (outUcId) console.log("CS: Stage 2 - Found UCID from canonical URL:", outUcId);
                    }
                }
            } catch (e) { /* console.warn("CS: Could not parse canonical URL", e); */ }
        }
        
        // STAGE 3: Reliable methods for UC... ID (especially on video pages).
        // Method 3a: ytInitialPlayerResponse (good for UC... ID on video pages)
        if (!outUcId) { // Only if not already found
            try {
                const scripts = Array.from(document.querySelectorAll('script'));
                for (const script of scripts) {
                    const scriptContent = script.textContent;
                    if (scriptContent && scriptContent.includes('ytInitialPlayerResponse')) {
                        const channelIdMatch = scriptContent.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
                        if (channelIdMatch && channelIdMatch[1]) {
                            outUcId = channelIdMatch[1];
                            // if (outUcId) console.log("CS: Stage 3a - Found UC ID from ytInitialPlayerResponse:", outUcId);
                            break; 
                        }
                    }
                }
            } catch (e) { /* console.warn("CS: Error parsing ytInitialPlayerResponse", e); */ }
        }

        if (!outUcId) { // Only if not already found
            // Method 3b: Meta tag for Channel ID (good for UC... ID on video pages)
            const metaChannelIdTag = document.querySelector('meta[itemprop="channelId"]');
            if (metaChannelIdTag && metaChannelIdTag.content && metaChannelIdTag.content.startsWith("UC")) {
                outUcId = metaChannelIdTag.content;
                // if (outUcId) console.log("CS: Stage 3b - Found UC ID from meta[itemprop='channelId']:", outUcId);
            }
        }

        // STAGE 4: Broader fallbacks - These methods might find either @handles or UC... IDs
        // from various links or embedded data if nothing definitive was found yet for one or both.
        
        // Method 4a: JSON-LD (Structured Data)
        if (!outHandle || !outUcId) { // If still missing one or both
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of jsonLdScripts) {
                if (outHandle && outUcId) break; // Stop if both found
                try {
                    const jsonData = JSON.parse(script.textContent);
                    let sourceUrlStr = null;
                    if (jsonData.author && jsonData.author.url) sourceUrlStr = jsonData.author.url;
                    else if (jsonData.creator && jsonData.creator.url) sourceUrlStr = jsonData.creator.url;
                    else if (jsonData.creator && Array.isArray(jsonData.creator) && jsonData.creator[0] && jsonData.creator[0].url) sourceUrlStr = jsonData.creator[0].url;
                    else if (jsonData.channel && jsonData.channel.url) sourceUrlStr = jsonData.channel.url;
                    else if (jsonData.author && typeof jsonData.author === 'string' && jsonData.author.startsWith('http')) sourceUrlStr = jsonData.author;

                    if (sourceUrlStr) {
                        try {
                            const parsedSourceUrl = new URL(sourceUrlStr);
                            let idFromJson = extractIdentifierFromUrlPath(parsedSourceUrl.pathname);
                            if (idFromJson) {
                                if (idFromJson.startsWith('@') && !outHandle) {
                                    outHandle = idFromJson;
                                    // if (outHandle) console.log("CS: Stage 4a - Found @handle from JSON-LD:", sourceUrlStr, "->", outHandle);
                                } else if (idFromJson.startsWith('UC') && !outUcId) {
                                    outUcId = idFromJson;
                                    // if (outUcId) console.log("CS: Stage 4a - Found UCID from JSON-LD:", sourceUrlStr, "->", outUcId);
                                }
                            }
                        } catch (urlParseError) { /* console.warn("CS: Could not parse URL from JSON-LD:", sourceUrlStr, urlParseError); */ }
                    }
                } catch (e) { /* console.warn("CS: Error parsing JSON-LD:", e); */ }
            }
        }

        // Method 4b: Common link selectors for video owner/channel name
        if (!outHandle || !outUcId) { // If still missing one or both
            const linkSelectors = [
                'ytd-video-owner-renderer[watch-metadata] #channel-name .yt-simple-endpoint',
                'ytd-video-owner-renderer a.yt-simple-endpoint',
                'ytd-channel-name a.yt-simple-endpoint',
                '#meta-contents #channel-name .yt-simple-endpoint',
                'a.ytp-ce-channel-title.ytp-ce-link'
            ];
            for (const selector of linkSelectors) {
                if (outHandle && outUcId) break; // Stop if both found
                const linkElement = document.querySelector(selector);
                if (linkElement && linkElement.href) {
                     try {
                        const parsedLinkUrl = new URL(linkElement.href, window.location.origin);
                        let idFromLink = extractIdentifierFromUrlPath(parsedLinkUrl.pathname);
                        if (idFromLink) {
                            if (idFromLink.startsWith('@') && !outHandle) {
                                outHandle = idFromLink;
                                // if (outHandle) console.log(`CS: Stage 4b - Found @handle from link ('${selector}'):`, outHandle);
                            } else if (idFromLink.startsWith('UC') && !outUcId) {
                                outUcId = idFromLink;
                                // if (outUcId) console.log(`CS: Stage 4b - Found UCID from link ('${selector}'):`, outUcId);
                            }
                        }
                    } catch (urlParseError) { /* console.warn("CS: Could not parse link href for selector " + selector, urlParseError); */ }
                }
            }
        }
        
        // Method 4c: ytd-browse element (usually for UC... ID on actual channel pages)
        if (!outUcId) { // Only if UCID is still missing
            const browseElement = document.querySelector('ytd-browse[browse-id^="UC"]');
            if (browseElement) {
                const browseId = browseElement.getAttribute('browse-id');
                if (browseId && /^UC[a-zA-Z0-9_-]{22}$/.test(browseId)) {
                    outUcId = browseId;
                    // if (outUcId) console.log("CS: Stage 4c - Found UC ID from ytd-browse[browse-id]:", outUcId);
                }
            }
        }

        // STAGE 5: Final fallback to current window.location.pathname (if still one is missing)
        // This is a last-ditch effort.
        if (!outHandle && idFromCurrentPath && idFromCurrentPath.startsWith('@')) {
            outHandle = idFromCurrentPath;
            // if (outHandle) console.log("CS: Stage 5 - Found @handle from window.location.pathname (last resort):", outHandle);
        }
        if (!outUcId && idFromCurrentPath && idFromCurrentPath.startsWith('UC')) {
            outUcId = idFromCurrentPath;
            // if (outUcId) console.log("CS: Stage 5 - Found UCID from window.location.pathname (last resort):", outUcId);
        }
        
        // Final decoding for @handles if it was percent-encoded in a URL
        if (outHandle && outHandle.includes('%')) {
            try {
                outHandle = decodeURIComponent(outHandle);
                // console.log("CS: Decoded handle:", outHandle);
            } catch (e) {
                // console.warn("CS: Error decoding extracted handle:", outHandle, e);
            }
        }

        // console.log("CS: --- Final identifiers to send: Handle:", outHandle, " UCID:", outUcId, "---");
        sendResponse({ channelHandle: outHandle, channelUcId: outUcId });
        return true; // Indicate async response
    }

    if (request.msg == "saveVideoURL") {
        let video = document.getElementsByClassName('video-stream')[0];
        let currentUrl = window.location.href; // Get current URL for reliable base
        let baseUrl = currentUrl.split("&t=")[0]; 
        
        if (video) {
            let totalSeconds = Math.floor(video.currentTime);
            sendResponse(baseUrl + "&t=" + totalSeconds);
        } else {
            sendResponse(baseUrl);
        }
        return true;
    }

    return false; // Default for other messages
});

function urlNoTime(url) {
    if (!url) return null;
	return url.split("&t=")[0];
}

// Initial check for overlay if time might be up
chrome.storage.local.get(["timeLeft", "override", "tempOverrideTabs"], function(data) {
    if (chrome.runtime.lastError) {
      console.warn("CS: Error getting initial storage:", chrome.runtime.lastError.message);
      return;
    }
    if (data.timeLeft <= 0 && !data.override) {
        chrome.runtime.sendMessage({ msg: "checkPageStatus", url: window.location.href }, response => {
            if (chrome.runtime.lastError) {
                 if (!chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                     console.warn("CS: Error checking page status on load:", chrome.runtime.lastError.message);
                 }
            } else if (response && response.shouldOverlay) {
                 showOverlay();
            }
        });
    }
});
