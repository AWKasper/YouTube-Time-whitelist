chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.msg === "getChannelIdFromPage") {
        let channelLink = document.querySelector("ytd-video-owner-renderer #channel-name a, yt-formatted-string.ytd-channel-name a"); // Find channel link
        let channelId = null;
        if (channelLink && channelLink.href) {
             try {
                 const urlParts = new URL(channelLink.href).pathname.split('/');
                 const channelIndex = urlParts.findIndex(part => part === 'channel');
                 if (channelIndex !== -1 && urlParts.length > channelIndex + 1 && urlParts[channelIndex + 1].startsWith('UC')) {
                     channelId = urlParts[channelIndex + 1];
                 }
                 // Add checks for /c/ or /user/ if needed
             } catch(e) {}
        }
        sendResponse({ channelId: channelId });
        return true; // Keep message channel open for async response
    }
    // Keep existing listener logic here...
    if (request.msg == "saveVideoURL") {
		let video = document.getElementsByClassName('video-stream')[0];
		let totalSeconds = Math.floor(video.currentTime);
		sendResponse(urlNoTime(location.href) + "&t=" + totalSeconds)
	}
});

function urlNoTime(url) { // Ensure this function exists
	return url.split("&t=")[0];
}