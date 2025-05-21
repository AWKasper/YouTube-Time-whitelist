let overlay = null;
let overrideButton = null;
let overridesLeftText = null;
let overlayTitle = null; 

function createOverlay() {
    if (document.getElementById('youtube-time-overlay')) {
        overlay = document.getElementById('youtube-time-overlay');
        overlayTitle = overlay.querySelector('h1');
        overrideButton = document.getElementById('youtube-time-override-btn');
        overridesLeftText = document.getElementById('youtube-time-overrides-left');
        return;
    }
    overlay = document.createElement('div');
    overlay.id = 'youtube-time-overlay';
    
    const contentDiv = document.createElement('div');
    contentDiv.id = 'youtube-time-overlay-content';
    
    overlayTitle = document.createElement('h1'); 
    overlayTitle.textContent = 'Time is up'; 
    
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
    
    contentDiv.appendChild(overlayTitle);
    contentDiv.appendChild(overrideCommands);
    
    overlay.appendChild(contentDiv); 
    document.body.appendChild(overlay);
}

function showOverlay() {
    if (!overlay) createOverlay(); 
    if (!overlay || !overlayTitle || !overrideButton || !overridesLeftText) { 
        console.error("CS: Overlay elements not properly initialized.");
        return;
    }

    const videoElement = document.querySelector('video.html5-main-video');
    if (videoElement && !videoElement.paused) videoElement.pause();

    overlayTitle.textContent = 'Time is up'; 

    chrome.storage.local.get({
        "overrideLimit": 5, 
        "currentOverrideCount": null, 
        "limitOverrides": true,
        "resetTime": "00:00"
    }, function(data) {
        if (chrome.runtime.lastError) {
            console.error("CS: Error getting storage data for overlay:", chrome.runtime.lastError.message);
            overridesLeftText.textContent = "Error loading override info.";
            return;
        }
        // Ensure currentOverrideCount is a number before using it.
        // If limitOverrides is true and currentOverrideCount is null (e.g., first time or after disabling/re-enabling limits),
        // it should default to the overrideLimit.
        let currentCount;
        if (data.limitOverrides) {
            currentCount = data.currentOverrideCount !== null ? parseInt(data.currentOverrideCount, 10) : parseInt(data.overrideLimit, 10);
        } else {
            currentCount = parseInt(data.overrideLimit, 10); // Fallback, though limitEnabled logic handles display
        }
        
        // Ensure overrideLimit is also treated as a number
        const overrideLimitNum = parseInt(data.overrideLimit, 10);
        currentCount = isNaN(currentCount) ? overrideLimitNum : currentCount; // If currentCount became NaN, use overrideLimitNum

        const limitEnabled = data.limitOverrides;

        if (limitEnabled) {
             if (currentCount < 1) { 
                overrideButton.disabled = true;
                overrideButton.style.display = 'none'; 
                
                let now = new Date();
                let [resetH, resetM] = data.resetTime.split(':').map(Number);
                let nextResetDate = new Date(now);
                nextResetDate.setHours(resetH, resetM, 0, 0);

                if (now.getTime() >= nextResetDate.getTime()) { 
                    nextResetDate.setDate(nextResetDate.getDate() + 1); 
                }
                
                const diffMs = nextResetDate.getTime() - now.getTime();
                let timeToResetMsg = "";

                if (diffMs > 0) {
                    const diffHrs = Math.floor(diffMs / 3600000); 
                    const diffMins = Math.round(((diffMs % 3600000) / 60000));
                    
                    if (diffHrs > 0) timeToResetMsg += `${diffHrs}h `;
                    timeToResetMsg += `${diffMins}m`;
                    overridesLeftText.textContent = `No overrides left. Timer resets at ${data.resetTime} (in ${timeToResetMsg}).`;
                } else {
                    overridesLeftText.textContent = `No overrides left. Timer resets at ${data.resetTime}.`;
                }

             } else { 
                overrideButton.disabled = false;
                overrideButton.style.display = 'inline-block';
                overridesLeftText.textContent = `${currentCount} Override${currentCount === 1 ? '' : 's'} Left`;
             }
        } else { 
            overrideButton.disabled = false;
            overrideButton.style.display = 'inline-block';
            overridesLeftText.textContent = "Time is up. Overrides are not limited.";
        }
    });

    overlay.classList.add('visible');
    document.body.classList.add('youtube-time-overlay-active');
}

function hideOverlay() {
    if (overlay) {
        overlay.classList.remove('visible');
        document.body.classList.remove('youtube-time-overlay-active');
    }
}

function handleOverrideClick() {
    if (confirm("Are you sure you want to use an override for this video?")) {
        chrome.runtime.sendMessage({ msg: "override" }, (response) => { 
             if (chrome.runtime.lastError) {
                 console.error("CS: Error sending override message:", chrome.runtime.lastError.message);
             } else {
                 hideOverlay(); 
             }
        });
    }
}


function extractIdentifierFromUrlPath(path) {
    if (!path) return null;
    let handleMatch = path.match(/^\/(@[^/?#\s]{3,})/); 
    if (handleMatch && handleMatch[1]) {
        return handleMatch[1];
    }
    let channelIdMatch = path.match(/^\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    if (channelIdMatch && channelIdMatch[1]) {
        return channelIdMatch[1];
    }
    return null;
}


chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
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
   
    if (request.msg === "overrideFailed") { // Listen for override failed message
        // Re-show overlay with updated "no overrides left" message
        // This ensures the UI is accurate if the background denies an override
        // because currentOverrideCount reached zero just before the click was processed.
        showOverlay(); 
        sendResponse({status: "Overlay updated for failed override"});
        return true;
    }

    if (request.msg === "getChannelHandleFromPage") {
        let outHandle = null;
        let outUcId = null;
        let idFromCurrentPath = extractIdentifierFromUrlPath(window.location.pathname);
        if (idFromCurrentPath) {
            if (idFromCurrentPath.startsWith('@')) outHandle = idFromCurrentPath;
            else if (idFromCurrentPath.startsWith('UC')) outUcId = idFromCurrentPath;
        }

        const canonicalLinkElement = document.querySelector('link[rel="canonical"]');
        if (canonicalLinkElement && canonicalLinkElement.href) {
            try {
                const canonicalUrl = new URL(canonicalLinkElement.href);
                let idFromCanonical = extractIdentifierFromUrlPath(canonicalUrl.pathname);
                if (idFromCanonical) {
                    if (idFromCanonical.startsWith('@') && !outHandle) outHandle = idFromCanonical;
                    else if (idFromCanonical.startsWith('UC') && !outUcId) outUcId = idFromCanonical;
                }
            } catch (e) { /* console.warn("CS: Could not parse canonical URL", e); */ }
        }
        
        if (!outUcId) { 
            try {
                const scripts = Array.from(document.querySelectorAll('script'));
                for (const script of scripts) {
                    const scriptContent = script.textContent;
                    if (scriptContent && scriptContent.includes('ytInitialPlayerResponse')) {
                        const channelIdMatch = scriptContent.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
                        if (channelIdMatch && channelIdMatch[1]) {
                            outUcId = channelIdMatch[1];
                            break; 
                        }
                    }
                }
            } catch (e) { /* console.warn("CS: Error parsing ytInitialPlayerResponse", e); */ }
        }

        if (!outUcId) { 
            const metaChannelIdTag = document.querySelector('meta[itemprop="channelId"]');
            if (metaChannelIdTag && metaChannelIdTag.content && metaChannelIdTag.content.startsWith("UC")) {
                outUcId = metaChannelIdTag.content;
            }
        }

        if (!outHandle || !outUcId) { 
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of jsonLdScripts) {
                if (outHandle && outUcId) break; 
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
                                if (idFromJson.startsWith('@') && !outHandle) outHandle = idFromJson;
                                else if (idFromJson.startsWith('UC') && !outUcId) outUcId = idFromJson;
                            }
                        } catch (urlParseError) { /* ... */ }
                    }
                } catch (e) { /* ... */ }
            }
        }

        if (!outHandle || !outUcId) { 
            const linkSelectors = [
                'ytd-video-owner-renderer[watch-metadata] #channel-name .yt-simple-endpoint',
                'ytd-video-owner-renderer a.yt-simple-endpoint',
                'ytd-channel-name a.yt-simple-endpoint',
                '#meta-contents #channel-name .yt-simple-endpoint',
                'a.ytp-ce-channel-title.ytp-ce-link'
            ];
            for (const selector of linkSelectors) {
                if (outHandle && outUcId) break; 
                const linkElement = document.querySelector(selector);
                if (linkElement && linkElement.href) {
                     try {
                        const parsedLinkUrl = new URL(linkElement.href, window.location.origin);
                        let idFromLink = extractIdentifierFromUrlPath(parsedLinkUrl.pathname);
                        if (idFromLink) {
                            if (idFromLink.startsWith('@') && !outHandle) outHandle = idFromLink;
                            else if (idFromLink.startsWith('UC') && !outUcId) outUcId = idFromLink;
                        }
                    } catch (urlParseError) { /* ... */ }
                }
            }
        }
        
        if (!outUcId) { 
            const browseElement = document.querySelector('ytd-browse[browse-id^="UC"]');
            if (browseElement) {
                const browseId = browseElement.getAttribute('browse-id');
                if (browseId && /^UC[a-zA-Z0-9_-]{22}$/.test(browseId)) {
                    outUcId = browseId;
                }
            }
        }
        
        if (outHandle && outHandle.includes('%')) {
            try { outHandle = decodeURIComponent(outHandle); } catch (e) { /* ... */ }
        }

        sendResponse({ channelHandle: outHandle, channelUcId: outUcId });
        return true; 
    }

    if (request.msg == "saveVideoURL") {
        let video = document.getElementsByClassName('video-stream')[0];
        let currentUrl = window.location.href; 
        let baseUrl = currentUrl.split("&t=")[0]; 
        
        if (video) {
            let totalSeconds = Math.floor(video.currentTime);
            sendResponse(baseUrl + "&t=" + totalSeconds);
        } else {
            sendResponse(baseUrl);
        }
        return true;
    }

    return false; 
});

chrome.runtime.sendMessage({ msg: "checkPageStatus" }, response => { 
    if (chrome.runtime.lastError) {
         if (!chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
             /* console.warn("CS: Error checking page status on load:", chrome.runtime.lastError.message); */
         }
    } else if (response && response.shouldOverlay) {
         showOverlay();
    }
});