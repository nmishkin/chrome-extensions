const FALLBACK_FAVICON = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23f1f3f4"/></svg>';

class TabGroupsManager {
  constructor() {
    this.groupsContainer = document.getElementById('groupsContainer');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.collapseAllBtn = document.getElementById('collapseAllBtn');
    this.expandAllBtn = document.getElementById('expandAllBtn');
    this.collapsedGroups = new Set();

    this.init();
  }

  init() {
    this.refreshBtn.addEventListener('click', () => this.loadTabGroups());
    this.collapseAllBtn.addEventListener('click', () => this.collapseAllGroups());
    this.expandAllBtn.addEventListener('click', () => this.expandAllGroups());
    this.loadTabGroups();
  }

  async loadTabGroups() {
    try {
      const [tabs, tabGroups, windows] = await Promise.all([
        chrome.tabs.query({}),
        chrome.tabGroups.query({}),
        chrome.windows.getAll()
      ]);

      // Load stored window origins
      const result = await chrome.storage.local.get('groupWindowOrigins');
      this.groupWindowOrigins = result.groupWindowOrigins || {};

      this.renderTabGroups(tabs, tabGroups, windows);
      this.updateStats(tabs, tabGroups);
    } catch (error) {
      console.error('Error loading tab groups:', error);
      this.showError('Failed to load tab groups');
    }
  }

  updateStats(tabs, tabGroups) {
    const ungroupedTabs = tabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);

    document.getElementById('totalTabs').textContent = tabs.length;
    document.getElementById('totalGroups').textContent = tabGroups.length;
    document.getElementById('ungroupedCount').textContent = ungroupedTabs.length;
  }

  renderTabGroups(tabs, tabGroups, windows) {
    if (tabs.length === 0) {
      this.groupsContainer.innerHTML = '<div class="empty-state">No tabs found</div>';
      return;
    }

    this.windows = windows;
    let html = '';

    // Render grouped tabs
    for (const group of tabGroups) {
      const groupTabs = tabs.filter(tab => tab.groupId === group.id);
      if (groupTabs.length === 0) continue;

      const groupWindow = windows.find(w => w.id === group.windowId);
      const isCollapsed = this.collapsedGroups.has(group.id);

      html += this.renderGroup({
        id: group.id,
        title: group.title || 'Unnamed Group',
        color: group.color,
        windowId: group.windowId,
        windowTitle: this.getWindowTitle(groupWindow),
        tabs: groupTabs,
        isCollapsed
      });
    }

    // Render ungrouped tabs by window
    const ungroupedTabs = tabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
    const ungroupedByWindow = {};

    ungroupedTabs.forEach(tab => {
      if (!ungroupedByWindow[tab.windowId]) {
        ungroupedByWindow[tab.windowId] = [];
      }
      ungroupedByWindow[tab.windowId].push(tab);
    });

    Object.entries(ungroupedByWindow).forEach(([windowId, tabs]) => {
      const groupWindow = windows.find(w => w.id === parseInt(windowId));
      const isCollapsed = this.collapsedGroups.has(`ungrouped-${windowId}`);

      html += this.renderGroup({
        id: `ungrouped-${windowId}`,
        title: 'Ungrouped Tabs',
        color: 'grey',
        windowId: parseInt(windowId),
        windowTitle: this.getWindowTitle(groupWindow),
        tabs: tabs,
        isCollapsed,
        isUngrouped: true
      });
    });

    this.groupsContainer.innerHTML = html;
    this.attachEventListeners();
  }

  renderGroup({ id, title, color, windowId, windowTitle, tabs, isCollapsed, isUngrouped = false }) {
    const colorMap = {
      'grey': '#9aa0a6',
      'blue': '#1a73e8',
      'red': '#d93025',
      'yellow': '#fbbc04',
      'green': '#34a853',
      'pink': '#ff1744',
      'purple': '#9c27b0',
      'cyan': '#00bcd4'
    };

    const colorHex = colorMap[color] || '#9aa0a6';
    const sectionClass = isUngrouped ? 'group-section ungrouped-tabs' : 'group-section';

    // Determine if group can be moved to own window or back
    const hasOwnWindow = this.isGroupInOwnWindow(windowId, tabs);
    const hasOriginWindow = !isUngrouped && this.groupWindowOrigins[id] && this.groupWindowOrigins[id] !== windowId;

    let groupActions = '';
    if (!isUngrouped) {
      if (hasOwnWindow && hasOriginWindow) {
        groupActions = `
          <div class="group-actions">
            <button class="group-btn" data-action="move-back" data-group-id="${id}">Move Back</button>
          </div>
        `;
      } else if (!hasOwnWindow) {
        groupActions = `
          <div class="group-actions">
            <button class="group-btn" data-action="move-to-window" data-group-id="${id}">New Window</button>
          </div>
        `;
      }
    }

    return `
      <div class="${sectionClass}">
        <div class="group-header" style="background-color: ${colorHex}15;">
          <div class="group-color" style="background-color: ${colorHex};"></div>
          <div class="group-info">
            <span class="group-name">${this.escapeHtml(title)}</span>
            <span class="group-count">(${tabs.length} tab${tabs.length !== 1 ? 's' : ''})</span>
            <span class="window-indicator">${windowTitle}</span>
          </div>
          ${groupActions}
          <button class="collapse-btn" data-group-id="${id}">
            ${isCollapsed ? '▶' : '▼'}
          </button>
        </div>
        <div class="tabs-list ${isCollapsed ? 'hidden' : ''}">
          ${tabs.map(tab => this.renderTab(tab)).join('')}
        </div>
      </div>
    `;
  }

  renderTab(tab) {
    const favicon = tab.favIconUrl || ''

    return `
      <div class="tab-item">
        <img class="tab-favicon" src="${favicon}" alt="">
        <div class="tab-info">
          <div class="tab-title">${this.escapeHtml(tab.title)}</div>
          <div class="tab-url">${this.escapeHtml(tab.url)}</div>
        </div>
        <div class="tab-actions">
          <button class="tab-btn" data-action="focus" data-tab-id="${tab.id}">Focus</button>
          <button class="tab-btn" data-action="close" data-tab-id="${tab.id}">Close</button>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    // Missing or broken favicons get a plain placeholder
    document.querySelectorAll('.tab-favicon').forEach(img => {
      img.addEventListener('error', () => {
        img.src = FALLBACK_FAVICON;
      }, { once: true });
    });

    // Collapse/expand functionality
    const collapseButtons = document.querySelectorAll('.collapse-btn');
    collapseButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const groupId = e.target.dataset.groupId;
        this.toggleGroupCollapse(groupId, e.target);
      });
    });

    // Group actions
    const groupActionButtons = document.querySelectorAll('.group-btn');
    groupActionButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const groupId = parseInt(e.target.dataset.groupId);
        this.handleGroupAction(action, groupId, e.target);
      });
    });

    // Tab actions
    const actionButtons = document.querySelectorAll('.tab-btn');
    actionButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const tabId = parseInt(e.target.dataset.tabId);
        this.handleTabAction(action, tabId, e.target);
      });
    });
  }

  collapseAllGroups() {
    const collapseButtons = document.querySelectorAll('.collapse-btn');
    collapseButtons.forEach(btn => {
      const groupId = btn.dataset.groupId;
      if (!this.collapsedGroups.has(groupId)) {
        this.toggleGroupCollapse(groupId, btn);
      }
    });
  }

  expandAllGroups() {
    const collapseButtons = document.querySelectorAll('.collapse-btn');
    collapseButtons.forEach(btn => {
      const groupId = btn.dataset.groupId;
      if (this.collapsedGroups.has(groupId)) {
        this.toggleGroupCollapse(groupId, btn);
      }
    });
  }

  toggleGroupCollapse(groupId, button) {
    const tabsList = button.closest('.group-section').querySelector('.tabs-list');

    if (this.collapsedGroups.has(groupId)) {
      this.collapsedGroups.delete(groupId);
      tabsList.classList.remove('hidden');
      button.textContent = '▼';
    } else {
      this.collapsedGroups.add(groupId);
      tabsList.classList.add('hidden');
      button.textContent = '▶';
    }
  }

  async handleGroupAction(action, groupId, button) {
    try {
      button.disabled = true;
      button.textContent = 'Working...';

      if (action === 'move-to-window') {
        await this.moveGroupToNewWindow(groupId);
      } else if (action === 'move-back') {
        await this.moveGroupBack(groupId);
      }

      setTimeout(() => this.loadTabGroups(), 500);
    } catch (error) {
      console.error(`Error performing ${action} on group ${groupId}:`, error);
      button.disabled = false;
      button.textContent = action === 'move-to-window' ? 'New Window' : 'Move Back';
    }
  }

  async moveGroupToNewWindow(groupId) {
    // Get all tabs in the group and store original group properties
    const tabs = await chrome.tabs.query({ groupId });
    if (tabs.length === 0) return;

    const originalGroup = await chrome.tabGroups.get(groupId);
    const originalWindowId = tabs[0].windowId;

    // Store the original window ID
    if (!this.groupWindowOrigins[groupId]) {
      this.groupWindowOrigins[groupId] = originalWindowId;
      await chrome.storage.local.set({ groupWindowOrigins: this.groupWindowOrigins });
    }

    // Create new window with the first tab
    const newWindow = await chrome.windows.create({
      tabId: tabs[0].id,
      focused: true
    });

    // Move remaining tabs to the new window one by one to avoid grouping issues
    if (tabs.length > 1) {
      for (let i = 1; i < tabs.length; i++) {
        await chrome.tabs.move(tabs[i].id, {
          windowId: newWindow.id,
          index: -1
        });
      }
    }

    // Wait for all operations to settle
    await new Promise(resolve => setTimeout(resolve, 200));

    // Query ALL tabs in the new window (should only be our moved tabs)
    const newWindowTabs = await chrome.tabs.query({ windowId: newWindow.id });

    // Group all tabs in the new window
    if (newWindowTabs.length > 0) {
      const newTabIds = newWindowTabs.map(tab => tab.id);
      const newGroupId = await chrome.tabs.group({
        tabIds: newTabIds,
        createProperties: { windowId: newWindow.id }
      });

      // Apply the original group properties
      await chrome.tabGroups.update(newGroupId, {
        title: originalGroup.title,
        color: originalGroup.color,
        collapsed: originalGroup.collapsed
      });

      // Update our stored origin to point to the new group ID
      this.groupWindowOrigins[newGroupId] = originalWindowId;
      delete this.groupWindowOrigins[groupId];
      await chrome.storage.local.set({ groupWindowOrigins: this.groupWindowOrigins });
    }
  }

  async moveGroupBack(groupId) {
    const originalWindowId = this.groupWindowOrigins[groupId];
    if (!originalWindowId) return;

    // Check if original window still exists
    try {
      await chrome.windows.get(originalWindowId);
    } catch (error) {
      // Original window doesn't exist, remove from origins
      delete this.groupWindowOrigins[groupId];
      await chrome.storage.local.set({ groupWindowOrigins: this.groupWindowOrigins });
      return;
    }

    // Get all tabs in the group
    const tabs = await chrome.tabs.query({ groupId });
    if (tabs.length === 0) return;

    const currentWindowId = tabs[0].windowId;

    // Move all tabs back to original window
    const tabIds = tabs.map(tab => tab.id);
    await chrome.tabs.move(tabIds, {
      windowId: originalWindowId,
      index: -1
    });

    // Re-create the group in the original window
    const newGroupId = await chrome.tabs.group({ tabIds });

    // Apply original group properties
    const originalGroup = await chrome.tabGroups.get(groupId);
    await chrome.tabGroups.update(newGroupId, {
      title: originalGroup.title,
      color: originalGroup.color,
      collapsed: originalGroup.collapsed
    });

    // Close the window if it only had this group and no other tabs
    const remainingTabs = await chrome.tabs.query({ windowId: currentWindowId });
    if (remainingTabs.length === 0) {
      await chrome.windows.remove(currentWindowId);
    }

    // Remove from origins since it's back home
    delete this.groupWindowOrigins[groupId];
    await chrome.storage.local.set({ groupWindowOrigins: this.groupWindowOrigins });
  }

  getWindowTitle(window) {
    if (!window) return 'Unknown Window';

    const windowTypes = {
      'normal': 'Main Window',
      'popup': 'Popup Window',
      'panel': 'Panel Window',
      'app': 'App Window'
    };

    const baseTitle = windowTypes[window.type] || 'Window';
    return `${baseTitle} ${window.id}`;
  }

  isGroupInOwnWindow(windowId, tabs) {
    // Check if this group is the only thing in its window
    const window = this.windows.find(w => w.id === windowId);
    if (!window) return false;

    // A group is in its own window if the window has exactly the same number of tabs as the group
    const windowTabCount = window.tabs ? window.tabs.length : 0;
    return windowTabCount === tabs.length && tabs.length > 0;
  }

  async handleTabAction(action, tabId, button) {
    try {
      if (action === 'focus') {
        await chrome.tabs.update(tabId, { active: true });
        const tab = await chrome.tabs.get(tabId);
        await chrome.windows.update(tab.windowId, { focused: true });
      } else if (action === 'close') {
        await chrome.tabs.remove(tabId);
        button.closest('.tab-item').style.opacity = '0.5';
        setTimeout(() => this.loadTabGroups(), 300);
      }
    } catch (error) {
      console.error(`Error performing ${action} on tab ${tabId}:`, error);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showError(message) {
    this.groupsContainer.innerHTML = `
      <div class="empty-state">
        <div style="color: #d93025;">${message}</div>
        <button class="retry-btn" style="margin-top: 10px; padding: 8px 16px; background: #1a73e8; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Retry
        </button>
      </div>
    `;
    this.groupsContainer.querySelector('.retry-btn')
      .addEventListener('click', () => location.reload());
  }
}

// Initialize the manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new TabGroupsManager();
});
