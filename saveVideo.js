chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.msg === "getChannelHandleFromPage") {
        let channelHandle = null;
        let handleElement = null;

        // --- Try multiple selectors ---
        // 1. Try the itemprop selector first (based on user finding)
        handleElement = document.querySelector("span[itemprop='author'] link[itemprop='url'][href*='/@']");

        // 2. If not found, try the selectors for modern YouTube elements
        if (!handleElement) {
            handleElement = document.querySelector("ytd-channel-name #text-container a.yt-simple-endpoint[href^='/@'], a.yt-simple-endpoint.ytd-video-owner-renderer[href^='/@']");
        }

        // --- Extract handle if element was found ---
        if (handleElement && handleElement.href) {
             try {
                 const urlPath = new URL(handleElement.href).pathname;
                 // Extract handle starting with @, potentially after a /
                 const handleMatch = urlPath.match(/\/(@[\w.-]+)/);
                 if (handleMatch && handleMatch[1]) {
                     channelHandle = handleMatch[1]; // e.g., "@username"
                 }
             } catch(e) {
                 console.error("Error parsing handle link:", e);
             }
        } else {
            // console.log("Could not find handle element using known selectors.");
        }

        // console.log("Content script sending handle:", channelHandle);
        sendResponse({ channelHandle: channelHandle });
        return true; // Keep message channel open for async response
    }

    // Keep existing listener logic for saving video URL
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