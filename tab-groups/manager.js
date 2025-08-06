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
      const [tabs, tabGroups] = await Promise.all([
        chrome.tabs.query({}),
        chrome.tabGroups.query({})
      ]);

      this.renderTabGroups(tabs, tabGroups);
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

  renderTabGroups(tabs, tabGroups) {
    if (tabs.length === 0) {
      this.groupsContainer.innerHTML = '<div class="empty-state">No tabs found</div>';
      return;
    }

    let html = '';

    // Render grouped tabs
    for (const group of tabGroups) {
      const groupTabs = tabs.filter(tab => tab.groupId === group.id);
      if (groupTabs.length === 0) continue;

      const isCollapsed = this.collapsedGroups.has(group.id);

      html += this.renderGroup({
        id: group.id,
        title: group.title || 'Unnamed Group',
        color: group.color,
        tabs: groupTabs,
        isCollapsed
      });
    }

    // Render ungrouped tabs
    const ungroupedTabs = tabs.filter(tab => tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE);
    if (ungroupedTabs.length > 0) {
      const isCollapsed = this.collapsedGroups.has('ungrouped');

      html += this.renderGroup({
        id: 'ungrouped',
        title: 'Ungrouped Tabs',
        color: 'grey',
        tabs: ungroupedTabs,
        isCollapsed,
        isUngrouped: true
      });
    }

    this.groupsContainer.innerHTML = html;
    this.attachEventListeners();
  }

  renderGroup({ id, title, color, tabs, isCollapsed, isUngrouped = false }) {
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

    return `
      <div class="${sectionClass}">
        <div class="group-header" style="background-color: ${colorHex}15;">
          <div class="group-color" style="background-color: ${colorHex};"></div>
          <div class="group-info">
            <span class="group-name">${this.escapeHtml(title)}</span>
            <span class="group-count">(${tabs.length} tab${tabs.length !== 1 ? 's' : ''})</span>
          </div>
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
    const favicon = tab.favIconUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23f1f3f4"/></svg>';

    return `
      <div class="tab-item">
        <img class="tab-favicon" src="${favicon}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; viewBox=&quot;0 0 16 16&quot;><rect width=&quot;16&quot; height=&quot;16&quot; fill=&quot;%23f1f3f4&quot;/></svg>'">
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
    // Collapse/expand functionality
    const collapseButtons = document.querySelectorAll('.collapse-btn');
    collapseButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const groupId = e.target.dataset.groupId;
        this.toggleGroupCollapse(groupId, e.target);
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
        <button onclick="location.reload()" style="margin-top: 10px; padding: 8px 16px; background: #1a73e8; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Retry
        </button>
      </div>
    `;
  }
}

// Initialize the manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new TabGroupsManager();
});
