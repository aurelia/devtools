chrome.runtime.onMessage.addListener((req, sender) => {
  if (sender.tab && req.aureliaDetected) {
    chrome.action.setIcon({
      tabId: sender.tab.id,
      path: {
        16: `../images/16.png`,
        48: `../images/48.png`,
        128: `../images/128.png`,
      },
    });

    chrome.action.setTitle({
      title: `Aurelia ${req.version} Devtools`,
      tabId: sender.tab.id,
    });

    chrome.action.setPopup({
      tabId: sender.tab.id,
      popup: `popups/enabled-v${req.version}.html`,
    });
  }
});
