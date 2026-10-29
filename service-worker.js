chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'wowsCnPortFetch') {
        return false;
    }
    fetch(message.url, {
        method: message.method || 'GET',
        headers: message.headers || {},
        body: message.body,
        credentials: 'include'
    }).then(async response => {
        sendResponse({ok: true, status: response.status, text: await response.text()});
    }).catch(error => {
        sendResponse({ok: false, error: String(error)});
    });
    return true;
});
