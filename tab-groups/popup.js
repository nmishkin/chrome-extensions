document.getElementById('openManager').addEventListener('click', () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('manager.html')
  });
  window.close();
});