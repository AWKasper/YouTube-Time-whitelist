chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.msg === "getChannelHandleFromPage") {
        let channelHandle = null;
        // Try finding the handle in common locations on video pages
        // Selector might need adjustment based on YouTube's current structure
        let handleElement = document.querySelector("ytd-channel-name #text-container a.yt-simple-endpoint[href^='/@'], a.yt-simple-endpoint.ytd-video-owner-renderer[href^='/@']");

        if (handleElement && handleElement.href) {
             try {
                 const urlPath = new URL(handleElement.href).pathname;
                 const handleMatch = urlPath.match(/^\/(@[\w.-]+)/); // Match pattern starting with /@
                 if (handleMatch && handleMatch[1]) {
                     channelHandle = handleMatch[1]; // e.g., "@username"
                 }
             } catch(e) {
                 console.error("Error parsing handle link:", e);
             }
        }
        // console.log("Content script found handle:", channelHandle);
        sendResponse({ channelHandle: channelHandle });
        return true; // Keep message channel open for async response
    }

    // Keep existing listener logic for saving video URL
    if (request.msg == "saveVideoURL") {
		let video = document.getElementsByClassName('video-stream')[0];
        // Ensure video element exists before accessing properties
        if (video) {
		    let totalSeconds = Math.floor(video.currentTime);
		    sendResponse(urlNoTime(location.href) + "&t=" + totalSeconds);
        } else {
            // Handle case where video element is not found
            sendResponse(urlNoTime(location.href)); // Send URL without time
        }
        return true; // Indicate async response
	}
});

function urlNoTime(url) {
    if (!url) return null;
	return url.split("&t=")[0];
}