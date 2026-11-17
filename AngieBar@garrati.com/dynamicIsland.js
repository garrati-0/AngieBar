import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

const TABS = [
    { id: 'notifications', label: 'Notifications', icon: 'angie-bell-symbolic.svg' },
    { id: 'music',         label: 'Music',         icon: 'angie-music-symbolic.svg' },
    { id: 'calendar',      label: 'Calendar',      icon: 'angie-calendar-symbolic.svg' },
    { id: 'todo',          label: 'To-Do',         icon: 'angie-todo-symbolic.svg' },
    { id: 'pomodoro',      label: 'Pomodoro',      icon: 'angie-timer-symbolic.svg' },
    { id: 'clipboard',     label: 'Clipboard',     icon: 'angie-clipboard-symbolic.svg' },
];

// Optional fallback map to stock GNOME symbolic icon names if a custom SVG is missing
const STOCK_ICONS = {
    'angie-music-symbolic.svg':         'audio-x-generic-symbolic',
    'angie-clipboard-symbolic.svg':     'edit-paste-symbolic',
    'angie-timer-symbolic.svg':         'alarm-symbolic',
    'angie-calendar-symbolic.svg':      'x-office-calendar-symbolic',
    'angie-todo-symbolic.svg':          'checkbox-checked-symbolic',
    'angie-pin-symbolic.svg':           'view-pin-symbolic',
    'angie-close-symbolic.svg':         'window-close-symbolic',
    'angie-backward-symbolic.svg':      'media-skip-backward-symbolic',
    'angie-forward-symbolic.svg':       'media-skip-forward-symbolic',
    'angie-play-symbolic.svg':          'media-playback-start-symbolic',
    'angie-pause-symbolic.svg':         'media-playback-pause-symbolic',
    'angie-speaker-symbolic.svg':       'audio-volume-high-symbolic',
    'angie-search-symbolic.svg':        'edit-find-symbolic',
    'angie-trash-symbolic.svg':         'user-trash-symbolic',
    'angie-reset-symbolic.svg':         'view-refresh-symbolic',
    'angie-minus-symbolic.svg':         'list-remove-symbolic',
    'angie-plus-symbolic.svg':          'list-add-symbolic',
    'angie-send-symbolic.svg':          'mail-send-symbolic',
    'angie-chevron-left-symbolic.svg':  'go-previous-symbolic',
    'angie-chevron-right-symbolic.svg': 'go-next-symbolic',
    'angie-check-symbolic.svg':         'object-select-symbolic',
    'angie-bell-symbolic.svg':          'preferences-system-notifications-symbolic',
};

// GNOME (libadwaita) accent palette -> [hex, foreground on accent]
const GNOME_ACCENTS = {
    blue:   ['#3584e4', '#ffffff'],
    teal:   ['#2190a4', '#ffffff'],
    green:  ['#3a944a', '#ffffff'],
    yellow: ['#c88800', '#ffffff'],
    orange: ['#ed5b00', '#ffffff'],
    red:    ['#e62d42', '#ffffff'],
    pink:   ['#d56199', '#ffffff'],
    purple: ['#9141ac', '#ffffff'],
    slate:  ['#6f8396', '#ffffff'],
};

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lighten(hex, f) {
    const [r, g, b] = hexToRgb(hex).map(c => Math.round(c + (255 - c) * f));
    return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export class DynamicIslandManager {
    constructor(ext) {
        this._ext = ext;
        this._path = ext.path;
        this._settings = ext._settings;

        this._isOpen = false;
        this._isPinned = false;
        this._activeTab = 'notifications';
        this._createdAt = Date.now();
        this._closedAt = 0;
        this._openedByClick = false;
        this._hoverOpenTimer = 0;
        this._hoverCloseTimer = 0;
        this._uiTickTimer = 0;
        this._botAnimTimer = 0;
        this._clipExpiryTimer = 0;
        this._stageCaptureId = 0;

        // Media state
        this._selectedPlayerName = null;
        this._currentTrack = {
            playing: false,
            title: 'Nothing playing',
            artist: 'Start Spotify or a media player',
            artUrl: null,
            artPath: null,
            lengthUs: 0,
            positionUs: 0,
            playerName: '',
        };

        // Clipboard state
        this._clips = [];
        this._clipFilter = 'all'; // 'all' | 'pinned' | 'links'
        this._clipQuery = '';
        this._ownClipCopy = false;
        this._clipFilePath = `${GLib.get_user_config_dir()}/angiebar-clipboard.json`;

        // Pomodoro state
        this._pomo = {
            phase: 'focus', // 'focus' | 'short_break' | 'long_break'
            running: false,
            workMins: 25,
            breakMins: 5,
            longBreakMins: 15,
            cyclesBeforeLong: 4,
            autoStartBreak: true,
            autoStartFocus: false,
            breakColor: '#2ec27e',
            remainingSec: 25 * 60,
            totalSec: 25 * 60,
            sessions: 0,
        };
        this._pomoTimerId = 0;
        this._pomoSettingSignals = [];
        this._syncingPomoSetting = false;

        // AI state
        this._aiMessages = [];
        this._aiState = 'idle'; // 'idle' | 'thinking' | 'answering' | 'error'
        this._aiBotTime = 0;
        this._aiGen = 0;
        this._aiGlowAlpha = 0;
        this._aiProc = null;
        this._aiProvider = 'agy'; // 'agy' | 'codex' | 'claude' | 'internal' (synced with settings)
        this._aiProviderBtns = new Map();
        this._currentAgyConvId = this._loadAgySessionId();

        // Calendar state
        const now = new Date();
        this._calToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        this._calSelected = new Date(this._calToday);
        this._calMonth = new Date(this._calToday.getFullYear(), this._calToday.getMonth(), 1);
        this._calEvents = [];
        this._calFilePath = `${GLib.get_user_config_dir()}/angiebar-events.json`;

        this._initGnomeColors();
        this._buildCompactPillAdditions();
        this._buildPopup();
        this._initClipboardMonitor();
        this._loadClips();
        this._loadCalendarEvents();
    }

    // =========================================================================
    // GNOME COLOR INTEGRATION (stock GNOME accent-color + Adwaita dark palette)
    // =========================================================================

    _initGnomeColors() {
        this._accentHex = '#3584e4';
        this._accentFg = '#ffffff';
        this._accentRgb = [53, 132, 228];
        this._accentCssFile = null;
        this._accentIdleId = 0;
        try {
            this._ifaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            if (this._ifaceSettings.settings_schema.has_key('accent-color')) {
                this._accentSignal = this._ifaceSettings.connect('changed::accent-color', () => {
                    this._applyGnomeColors();
                    this.applyTheme();
                    if (this._botCanvas) this._botCanvas.queue_repaint();
                    if (this._pomoRingArea) this._pomoRingArea.queue_repaint();
                    if (this._musicProgressArea) this._musicProgressArea.queue_repaint();
                });
            }
        } catch (e) {
            this._ifaceSettings = null;
        }
        this._applyGnomeColors();
        // Re-apply on idle so the accent stylesheet is loaded AFTER GNOME Shell loads stylesheet.css
        this._accentIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._accentIdleId = 0;
            this._applyGnomeColors();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyGnomeColors() {
        let name = 'blue';
        try {
            if (this._ifaceSettings?.settings_schema.has_key('accent-color'))
                name = this._ifaceSettings.get_string('accent-color') || 'blue';
        } catch (e) {}
        let [hex, fg] = GNOME_ACCENTS[name] || GNOME_ACCENTS.blue;
        this._accentHex = hex;
        this._accentFg = fg;
        this._accentRgb = hexToRgb(this._accentHex);

        // Recolor ONLY the Dynamic Island section of stylesheet.css
        // so panel modules (CPU, RAM, Workspaces, Todo, Net) keep their own colors
        try {
            const [ok, bytes] = GLib.file_get_contents(`${this._path}/stylesheet.css`);
            if (!ok) return;
            const fullCss = new TextDecoder().decode(bytes);
            const marker = '10. EXPANDED DYNAMIC ISLAND';
            const splitIdx = fullCss.indexOf(marker);
            const commentStart = splitIdx !== -1 ? fullCss.lastIndexOf('/*', splitIdx) : -1;
            const diSection = commentStart !== -1 ? fullCss.slice(commentStart) : fullCss;
            const rgb = this._accentRgb.join(', ');
            const lightHex = lighten(this._accentHex, 0.2);
            const css = '/* Dynamic Island GNOME Accent Override */\n' + diSection
                .replace(/#3584e4/gi, this._accentHex)
                .replace(/#5a9cf8/gi, lightHex)
                .replace(/53,\s*132,\s*228/g, rgb)
                .replace(/#cba6f7/gi, this._accentHex)
                .replace(/#d8bdfb/gi, lightHex)
                .replace(/#89b4fa/gi, this._accentHex)
                .replace(/203,\s*166,\s*247/g, rgb)
                .replace(/137,\s*180,\s*250/g, rgb)
                .replace(/#11111b/gi, this._accentFg)
                .replace(/#cdd6f4/gi, '#ffffff')
                .replace(/205,\s*214,\s*244/g, '255, 255, 255')
                .replace(/166,\s*173,\s*200/g, '222, 221, 218')
                .replace(/24,\s*24,\s*37/g, '54, 54, 58');
            const dir = `${GLib.get_user_cache_dir()}/angiebar`;
            GLib.mkdir_with_parents(dir, 0o755);
            const path = `${dir}/accent-${name}.css`;
            GLib.file_set_contents(path, css);

            const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            if (this._accentCssFile) {
                try { theme.unload_stylesheet(this._accentCssFile); } catch (e) {}
            }
            this._accentCssFile = Gio.File.new_for_path(path);
            theme.load_stylesheet(this._accentCssFile);
        } catch (e) {
            console.error(`AngieBar: accent stylesheet failed: ${e}`);
        }
    }

    _clearTimer(propName) {
        if (this[propName]) {
            GLib.source_remove(this[propName]);
            this[propName] = 0;
        }
    }

    async _loadJsonFile(path, defaultVal = []) {
        try {
            if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                const raw = await this._ext._readFileAsync(path);
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {}
        return defaultVal;
    }

    async _saveJsonFile(path, data) {
        try {
            await this._ext._writeFileAsync(path, JSON.stringify(data));
        } catch (e) {}
    }

    _gicon(filename) {
        // Load custom AngieBar SVG icons from ./icons/ first, fallback to system symbolic icon
        const file = Gio.File.new_for_path(`${this._path}/icons/${filename}`);
        if (file.query_exists(null))
            return Gio.FileIcon.new(file);
        const stock = STOCK_ICONS[filename];
        if (stock)
            return new Gio.ThemedIcon({ names: [stock, 'image-missing-symbolic'] });
        return new Gio.ThemedIcon({ name: 'image-missing-symbolic' });
    }

    // =========================================================================
    // 1. COMPACT CENTER PILL INTEGRATION & HOVER/CLICK MORPH
    // =========================================================================

    _buildCompactPillAdditions() {
        const island = this._ext._centerIsland;
        const box = this._ext._centerBoxLayout;
        if (!island || !box) return;

        // Add compact Pomodoro indicator inside closed center island
        this._compactPomoBox = new St.BoxLayout({
            style_class: 'di-compact-pomo',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._compactPomoDot = new St.Widget({
            style_class: 'di-compact-pomo-dot',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._compactPomoLabel = new St.Label({
            text: '25:00',
            style_class: 'di-compact-pomo-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._compactPomoBox.add_child(this._compactPomoDot);
        this._compactPomoBox.add_child(this._compactPomoLabel);
        box.insert_child_at_index(this._compactPomoBox, 1);

        // Hover to open with slight delay, click to toggle
        this._ext._connect(island, 'enter-event', () => {
            if (this._settings && !this._settings.get_boolean('di-open-on-hover')) return Clutter.EVENT_PROPAGATE;
            if (Date.now() - (this._closedAt || 0) < 350) return Clutter.EVENT_PROPAGATE;
            this._cancelCloseTimer();
            if (!this._isOpen && !this._hoverOpenTimer) {
                this._hoverOpenTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 140, () => {
                    this._hoverOpenTimer = 0;
                    if (Date.now() - (this._closedAt || 0) < 350) return GLib.SOURCE_REMOVE;
                    this._openedByClick = false;
                    this.open(false);
                    return GLib.SOURCE_REMOVE;
                });
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._ext._connect(island, 'leave-event', () => {
            this._cancelOpenTimer();
            this._scheduleHoverClose();
            return Clutter.EVENT_PROPAGATE;
        });
    }

    toggleFromClick() {
        this._cancelOpenTimer();
        this._cancelCloseTimer();
        // Ignore the click that immediately follows a hover-open
        if (this._isOpen && !this._openedByClick && Date.now() - (this._openedAt || 0) < 320) {
            this._openedByClick = true;
            return;
        }
        if (this._isOpen) {
            this.close();
        } else {
            this._openedByClick = true;
            this.open(false);
        }
    }

    _cancelOpenTimer() {
        this._clearTimer('_hoverOpenTimer');
    }

    _cancelCloseTimer() {
        this._clearTimer('_hoverCloseTimer');
    }

    _scheduleHoverClose() {
        this._cancelCloseTimer();
        if (!this._isOpen || this._isPinned) return;
        this._hoverCloseTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 260, () => {
            this._hoverCloseTimer = 0;
            if (!this._isOpen || this._isPinned) return GLib.SOURCE_REMOVE;
            if (this._isPointerInside()) {
                return GLib.SOURCE_REMOVE;
            }
            if (this._activeTab === 'ai') {
                // Keep AI pill open only if working, has messages, or user typed text in the entry
                const hasTyped = Boolean(this._aiEntry?.get_text()?.trim());
                if (this._aiState === 'thinking' || this._aiMessages.length > 0 || hasTyped) {
                    return GLib.SOURCE_REMOVE;
                }
                this.close();
                return GLib.SOURCE_REMOVE;
            }
            if (this._isEntryFocused()) {
                return GLib.SOURCE_REMOVE;
            }
            this.close();
            return GLib.SOURCE_REMOVE;
        });
    }

    _isEntryFocused() {
        const focus = global.stage.get_key_focus();
        if (!focus || !this._popup) return false;
        return this._popup.contains(focus);
    }

    _isPointerInside() {
        const [px, py] = global.get_pointer();
        const checkActor = (actor) => {
            if (!actor || !actor.visible) return false;
            const [ax, ay] = actor.get_transformed_position();
            const [aw, ah] = actor.get_transformed_size();
            return px >= ax - 8 && px <= ax + aw + 8 && py >= ay - 8 && py <= ay + ah + 12;
        };
        return checkActor(this._popup) || checkActor(this._ext._centerIsland);
    }

    // =========================================================================
    // 2. FLOATING ROUNDED EXPANDED DYNAMIC ISLAND
    // =========================================================================

    _buildPopup() {
        this._popup = new St.BoxLayout({
            style_class: 'di-expanded-island',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: false,
            track_hover: true,
            can_focus: true,
            visible: false,
            opacity: 0,
        });
        this._popup.set_pivot_point(0.5, 0.0);

        this._ext._connect(this._popup, 'enter-event', () => {
            if (this._isOpen) this._cancelCloseTimer();
            return Clutter.EVENT_PROPAGATE;
        });
        this._ext._connect(this._popup, 'leave-event', () => {
            this._scheduleHoverClose();
            return Clutter.EVENT_PROPAGATE;
        });

        // Header Row (Tabs on Left, Date/Time at Center like the closed pill, Pin/Close on Right)
        this._header = this._buildHeader();
        this._popup.add_child(this._header);

        // Content stack container
        this._contentBin = new St.Widget({
            style_class: 'di-content-area',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        this._pages = {
            music:     this._buildMusicPage(),
            clipboard: this._buildClipboardPage(),
            pomodoro:  this._buildPomodoroPage(),
            ai:        this._buildAiPage(),
            calendar:  this._buildCalendarPage(),
            todo:      this._buildTodoPage(),
            notifications: this._buildNotificationsPage(),
        };

        Object.values(this._pages).forEach(page => {
            this._contentBin.add_child(page);
        });

        this._popup.add_child(this._contentBin);
        Main.layoutManager.addTopChrome(this._popup);
        this._popup.visible = false;

        this._updateVisibleTabs();
        this._switchTab(this._defaultTab(), false);
        this._updateMusicTabVisibility();
        this.applyTheme();
        this._popup.visible = false;
        this._initAiSettings();
        this._initPomoSettings();
        this._buildNotifIsland();
    }

    _initAiSettings() {
        if (!this._settings) return;
        const syncProvider = () => {
            try { this._aiProvider = this._settings.get_string('ai-provider') || 'agy'; } catch (e) {}
            if (this._aiEntry) this._aiEntry.hint_text = this._aiHintText();
        };
        syncProvider();
        try {
            this._aiProviderSig = this._settings.connect('changed::ai-provider', syncProvider);
            this._aiLocalModelSig = this._settings.connect('changed::local-ai-model', syncProvider);
        } catch (e) {}
        try {
            Main.wm.addKeybinding(
                'ai-shortcut',
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this.toggleAi()
            );
            this._aiKeybindingAdded = true;
        } catch (e) {
            console.error(`AngieBar: AI shortcut failed: ${e}`);
        }
    }

    toggleAi() {
        if (this._isOpen && this._activeTab === 'ai') {
            this.close();
            return;
        }
        if (!this._isOpen) {
            if (this._activeTab && this._activeTab !== 'ai') this._aiPrevTab = this._activeTab;
            this._activeTab = 'ai';
            this._openingAi = true;
            this.open(false);
            this._openingAi = false;
            return;
        }
        this._switchTab('ai', true);
    }

    _aiAskPermission() {
        try { return this._settings ? this._settings.get_boolean('ai-ask-permission') : true; } catch (e) { return true; }
    }

    _buildHeader() {
        const header = new St.BoxLayout({
            style_class: 'di-header',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Rounded Pill Tabs Bar
        const tabsBar = new St.BoxLayout({
            style_class: 'di-tabs-bar',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._tabButtons = new Map();
        TABS.forEach(tabInfo => {
            const btnBox = new St.BoxLayout({
                style_class: 'di-tab-box',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const icon = new St.Icon({
                gicon: this._gicon(tabInfo.icon),
                icon_size: 15,
                style_class: 'di-tab-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const lbl = new St.Label({
                text: tabInfo.label,
                style_class: 'di-tab-label',
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
            });
            btnBox.add_child(icon);
            btnBox.add_child(lbl);

            const btn = new St.Button({
                style_class: 'di-tab-btn',
                child: btnBox,
                reactive: true,
                track_hover: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._ext._connect(btn, 'clicked', () => {
                this._switchTab(tabInfo.id, true);
            });

            tabsBar.add_child(btn);
            this._tabButtons.set(tabInfo.id, { btn, icon, lbl, info: tabInfo });
        });

        // Row 1: date/time alone, centered (exactly like the closed pill)
        // Row 2: tabs on the left, pin/close on the right
        header.orientation = Clutter.Orientation.VERTICAL;
        const clockRow = new St.BoxLayout({ style_class: 'di-header-clock-row', x_expand: true });
        const toolsRow = new St.BoxLayout({ style_class: 'di-header-tools-row', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        this._headerToolsRow = toolsRow;

        const leftSide = new St.BoxLayout({ x_expand: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER });
        leftSide.add_child(tabsBar);
        toolsRow.add_child(leftSide);

        this._headerCenterClock = new St.Label({
            text: this._ext._getFormattedTime ? this._ext._getFormattedTime() : this._getShortTime(),
            style_class: 'time-label di-header-center-clock',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        clockRow.add_child(this._headerCenterClock);
        header.add_child(clockRow);
        header.add_child(toolsRow);

        // Right status group: mini pomo timer + pin/close button
        const rightStatus = new St.BoxLayout({
            style_class: 'di-header-status',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._headerPomoPill = new St.Button({
            style_class: 'di-header-pomo-pill',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._headerPomoLabel = new St.Label({
            text: '25:00',
            style_class: 'di-header-pomo-text',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._headerPomoPill.set_child(this._headerPomoLabel);
        this._ext._connect(this._headerPomoPill, 'clicked', () => this._switchTab('pomodoro', true));
        rightStatus.add_child(this._headerPomoPill);

        this._aiHeaderBtn = new St.Button({
            style_class: 'di-header-icon-btn di-header-ai-btn',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                gicon: this._gicon('angie-ai-symbolic.svg'),
                icon_size: 13,
                style_class: 'di-header-btn-icon',
            }),
        });
        this._ext._connect(this._aiHeaderBtn, 'clicked', () => this._switchTab('ai', true));
        rightStatus.add_child(this._aiHeaderBtn);

        const prefsBtn = new St.Button({
            style_class: 'di-header-icon-btn',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'preferences-system-symbolic',
                icon_size: 13,
                style_class: 'di-header-btn-icon',
            }),
        });
        this._ext._connect(prefsBtn, 'clicked', () => {
            this.close();
            try { this._ext.openPreferences(); } catch (e) {}
        });
        rightStatus.add_child(prefsBtn);

        this._pinBtn = new St.Button({
            style_class: 'di-header-icon-btn',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pinIcon = new St.Icon({
            gicon: this._gicon('angie-pin-symbolic.svg'),
            icon_size: 13,
            style_class: 'di-header-btn-icon',
        });
        this._pinBtn.set_child(this._pinIcon);
        this._ext._connect(this._pinBtn, 'clicked', () => {
            this._isPinned = !this._isPinned;
            this._updatePinIndicator();
        });
        rightStatus.add_child(this._pinBtn);

        const closeBtn = new St.Button({
            style_class: 'di-header-icon-btn',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        closeBtn.set_child(new St.Icon({
            gicon: this._gicon('angie-close-symbolic.svg'),
            icon_size: 13,
            style_class: 'di-header-btn-icon',
        }));
        this._ext._connect(closeBtn, 'clicked', () => this.close());
        rightStatus.add_child(closeBtn);

        toolsRow.add_child(rightStatus);
        return header;
    }

    _updatePinIndicator() {
        if (!this._pinBtn || !this._pinIcon) return;
        this._pinIcon.gicon = this._gicon('angie-pin-symbolic.svg');
        if (this._isPinned) {
            this._pinBtn.add_style_class_name('pinned');
        } else {
            this._pinBtn.remove_style_class_name('pinned');
        }
    }

    _switchTab(tabId, animate = true) {
        if (tabId === 'ai' && this._activeTab && this._activeTab !== 'ai') this._aiPrevTab = this._activeTab;
        this._activeTab = tabId;
        this._applyAiMode(tabId === 'ai');
        this._tabButtons.forEach((entry, id) => {
            const active = (id === tabId);
            entry.icon.gicon = this._gicon(entry.info.icon);
            if (active) {
                entry.btn.add_style_class_name('active');
                entry.lbl.visible = true;
            } else {
                entry.btn.remove_style_class_name('active');
                entry.lbl.visible = false;
            }
        });

        Object.entries(this._pages).forEach(([id, pageActor]) => {
            const isTarget = (id === tabId);
            pageActor.remove_all_transitions();
            if (isTarget) {
                pageActor.visible = true;
                if (animate) {
                    pageActor.opacity = 0;
                    pageActor.translation_y = 6;
                    pageActor.ease({
                        opacity: 255,
                        translation_y: 0,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                } else {
                    pageActor.opacity = 255;
                    pageActor.translation_y = 0;
                }
            } else {
                pageActor.visible = false;
            }
        });

        if (tabId === 'music') {
            this._refreshMusicUI();
            this._updateScrubberWaveState();
        } else {
            this._stopScrubberWave();
        }
        if (tabId === 'clipboard') this._refreshClipboardUI();
        if (tabId === 'pomodoro') {
            this._refreshPomodoroUI();
            this._updatePomoWaveState();
        } else {
            this._updatePomoTabStyle();
            this._stopPomoWave();
        }
        if (tabId === 'ai') this._startBotAnimation();
        else this._stopBotAnimation();
        if (tabId === 'calendar') this._refreshCalendarUI();
        if (tabId === 'todo') this._refreshTodoUI();
        if (tabId === 'notifications') this._refreshNotificationsUI();

        this._repositionPopup();
    }

    open(pin = false) {
        if (!this._popup) return;
        if (pin) this._isPinned = true;
        this._updatePinIndicator();

        // Restore active tab on open without auto-switching to music; never reopen into idle AI pill on hover/click
        if (!this._isOpen) {
            this._forcedTab = false;
            if (!this._openingAi && this._activeTab === 'ai' && this._aiState !== 'thinking') {
                this._activeTab = (this._aiPrevTab && this._aiPrevTab !== 'ai') ? this._aiPrevTab : this._defaultTab();
            }
            this._switchTab(this._activeTab, false);
        }

        this._isOpen = true;
        this._openedAt = Date.now();
        this._popup.reactive = true;
        if (this._ext._centerIsland) {
            this._ext._centerIsland.add_style_class_name('island-expanded-open');
        }

        this.applyTheme();
        this._updateCenterClock();
        this._popup.visible = true;
        this._repositionPopup();

        this._clearTimer('_closeFinishTimer');

        // Smooth Pixel-style expansion from top center
        this._popup.remove_all_transitions();
        this._popup.set_pivot_point(0.5, 0.0);
        this._popup.opacity = 0;
        this._popup.scale_x = 0.86;
        this._popup.scale_y = 0.78;
        this._popup.translation_y = -6;
        this._popup.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            translation_y: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        const reveal = [this._contentBin, ...this._headerSideActors()];
        reveal.forEach((a, i) => {
            a.remove_all_transitions();
            a.opacity = 0;
            a.translation_y = -4;
            a.ease({
                opacity: 255,
                translation_y: 0,
                delay: 40 + i * 20,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
        this._header.opacity = 255;

        const pill = this._ext._centerIsland;
        if (pill) {
            pill.remove_all_transitions();
            pill.ease({
                opacity: 0,
                duration: 90,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        if (!this._uiTickTimer) {
            this._uiTickTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                if (!this._isOpen) {
                    this._uiTickTimer = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._updateCenterClock();
                if (this._activeTab === 'music' && this._currentTrack.playing) {
                    this._pollMprisPosition();
                }
                return GLib.SOURCE_CONTINUE;
            });
        }

        if (!this._stageCaptureId) {
            this._stageCaptureId = global.stage.connect('captured-event', (_stage, event) => {
                if (!this._isOpen) return Clutter.EVENT_PROPAGATE;
                const type = event.type();
                if (type === Clutter.EventType.BUTTON_PRESS) {
                    if (!this._isPointerInside()) {
                        this.close();
                    }
                } else if (type === Clutter.EventType.KEY_PRESS) {
                    if (event.get_key_symbol() === Clutter.KEY_Escape) {
                        this.close();
                        return Clutter.EVENT_STOP;
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }
    }

    close() {
        this._cancelOpenTimer();
        this._cancelCloseTimer();
        this._clearTimer('_closeFinishTimer');
        this._stopBotAnimation();
        this._stopScrubberWave();
        this._stopPomoWave();
        this._setOutputPickerOpen(false);
        if (!this._isOpen || !this._popup) return;
        this._isOpen = false;
        this._closedAt = Date.now();
        this._openedByClick = false;
        if (this._activeTab === 'ai' && this._aiState !== 'thinking') {
            this._activeTab = (this._aiPrevTab && this._aiPrevTab !== 'ai') ? this._aiPrevTab : this._defaultTab();
        }
        // Let events reach the pill again while the close animation runs
        this._popup.reactive = false;
        this._isPinned = false;
        this._updatePinIndicator();

        if (this._ext._centerIsland) {
            this._ext._centerIsland.remove_style_class_name('island-expanded-open');
        }

        if (this._stageCaptureId) {
            global.stage.disconnect(this._stageCaptureId);
            this._stageCaptureId = 0;
        }

        global.stage.set_key_focus(null);

        // Smooth shrink back into the center pill
        [this._contentBin, ...this._headerSideActors()].forEach(a => {
            a.remove_all_transitions();
            a.ease({ opacity: 0, translation_y: -4, duration: 90, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        });
        this._popup.remove_all_transitions();
        this._popup.ease({
            scale_x: 0.86,
            scale_y: 0.78,
            translation_y: -6,
            opacity: 0,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this._isOpen) return;
                this._finishCloseCleanup();
            },
        });

        // Restore the bar pill smoothly as the popup shrinks
        const pill = this._ext._centerIsland;
        if (pill) {
            pill.remove_all_transitions();
            pill.set_pivot_point(0.5, 0.5);
            pill.ease({
                opacity: 255,
                scale_x: 1.0,
                scale_y: 1.0,
                delay: 20,
                duration: 130,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        // Fail-safe timer: guarantee the popup is hidden and pill restored even if a Clutter transition is dropped
        this._clearTimer('_closeFinishTimer');
        this._closeFinishTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 180, () => {
            this._closeFinishTimer = 0;
            if (!this._isOpen) {
                this._finishCloseCleanup();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _finishCloseCleanup() {
        const p = this._ext._centerIsland;
        if (p) {
            p.remove_all_transitions();
            p.opacity = 255;
            p.scale_x = 1.0;
            p.scale_y = 1.0;
        }
        if (this._popup) {
            this._popup.remove_all_transitions();
            this._popup.visible = false;
            this._popup.scale_x = 1.0;
            this._popup.scale_y = 1.0;
        }
        if (this._headerCenterClock) {
            this._headerCenterClock.scale_x = 1.0;
            this._headerCenterClock.scale_y = 1.0;
            this._headerCenterClock.translation_x = 0;
            this._headerCenterClock.translation_y = 0;
        }
    }

    _headerSideActors() {
        if (!this._header) return [];
        return this._headerToolsRow ? [this._headerToolsRow] : [];
    }

    _updateCenterClock() {
        if (!this._headerCenterClock) return;
        const txt = this._ext._getFormattedTime ? this._ext._getFormattedTime() : this._getShortTime();
        this._headerCenterClock.set_text(txt);
    }

    _repositionPopup() {
        if (!this._popup) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        const [, natW] = this._popup.get_preferred_width(-1);
        const width = natW || 540;

        let centerX = monitor.x + Math.floor(monitor.width / 2);
        let topY = monitor.y + 44;

        if (this._ext._centerIsland && this._ext._centerIsland.visible) {
            const [ix, iy] = this._ext._centerIsland.get_transformed_position();
            const [iw, ih] = this._ext._centerIsland.get_transformed_size();
            if (iw > 0) {
                centerX = Math.floor(ix + iw / 2);
                topY = Math.floor(iy); // take the place of the center pill
            }
        }

        const x = Math.max(monitor.x + 12, Math.min(monitor.x + monitor.width - width - 12, Math.floor(centerX - width / 2)));
        this._popup.set_position(x, topY);
    }

    applyTheme() {
        if (!this._popup || !this._settings) return;
        // Same color as the bar pills (custom-color + island-opacity)
        const color = this._settings.get_string('custom-color');
        const opacity = this._settings.get_double('island-opacity');
        const bg = this._ext._colorWithOpacity
            ? this._ext._colorWithOpacity(color, Math.max(0.94, opacity))
            : `rgba(30, 32, 36, ${Math.max(0.94, opacity)})`;
        if (this._activeTab === 'ai') {
            this._popup.set_style('background-color: transparent; border-width: 0px; box-shadow: none;');
            return;
        }
        this._popup.set_style(
            `background-color: ${bg}; ` +
            'border-width: 0px; border-color: transparent; ' +
            'box-shadow: 0px 10px 28px rgba(0, 0, 0, 0.45);'
        );
    }

    _getShortTime() {
        const now = GLib.DateTime.new_now_local();
        return now.format('%H:%M');
    }

    // =========================================================================
    // 3. PAGE 1: MUSICA (MPRIS MEDIA PLAYER)
    // =========================================================================

    _buildMusicPage() {
        const page = new St.BoxLayout({
            style_class: 'di-page di-music-page',
            x_expand: true,
            y_expand: true,
        });

        // Android 17 / Pixel full-bleed media card with album cover background
        this._musicCard = new St.BoxLayout({
            style_class: 'di-music-card',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        this._musicScrim = new St.BoxLayout({
            style_class: 'di-music-scrim',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        // 1. Top Row: Circular App Badge (left) + Audio Output Device Pill (right)
        const topRow = new St.BoxLayout({
            style_class: 'di-music-top-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
        });

        this._musicArtBtn = new St.Button({
            style_class: 'di-music-app-badge',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            track_hover: true,
        });
        this._musicArtIcon = new St.Icon({
            gicon: this._gicon('angie-music-symbolic.svg'),
            icon_size: 14,
            style_class: 'di-music-app-badge-icon',
        });
        this._musicArtBtn.set_child(this._musicArtIcon);
        this._ext._connect(this._musicArtBtn, 'clicked', () => {
            if (this._outputPickerOpen) {
                this._setOutputPickerOpen(false);
            } else if ((this._currentTrack?.totalPlayers || 0) > 1) {
                this._cyclePlayer();
            } else {
                this._raiseActivePlayer();
            }
        });
        topRow.add_child(this._musicArtBtn);

        topRow.add_child(new St.Widget({ x_expand: true }));

        this._playerBadgeBtn = new St.Button({
            style_class: 'di-music-player-pill',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            track_hover: true,
        });
        const pillBox = new St.BoxLayout({
            style_class: 'di-music-player-pill-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._outputBadgeIcon = new St.Icon({
            icon_name: 'audio-speakers-symbolic',
            icon_size: 13,
            style_class: 'di-music-player-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._playerBadgeLabel = new St.Label({
            text: 'Speakers',
            style_class: 'di-music-player-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        pillBox.add_child(this._outputBadgeIcon);
        pillBox.add_child(this._playerBadgeLabel);
        this._playerBadgeBtn.set_child(pillBox);
        this._ext._connect(this._playerBadgeBtn, 'clicked', () => this._toggleOutputPicker());
        topRow.add_child(this._playerBadgeBtn);

        this._musicScrim.add_child(topRow);

        // Main Player Controls Container (Middle + Bottom rows)
        this._musicMainContent = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        // 2. Middle Row: Track Title & Artist (left) + Pixel Squircle Play/Pause Button (right)
        const midRow = new St.BoxLayout({
            style_class: 'di-music-mid-row',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const textCol = new St.BoxLayout({
            style_class: 'di-music-text-col',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._musicTitle = new St.Label({
            text: 'Nothing playing',
            style_class: 'di-music-title',
        });
        this._musicTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._musicArtist = new St.Label({
            text: 'Start a media player',
            style_class: 'di-music-artist',
        });
        this._musicArtist.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        textCol.add_child(this._musicTitle);
        textCol.add_child(this._musicArtist);
        midRow.add_child(textCol);

        this._playPauseBtn = this._makeRoundIconBtn(
            'angie-play-symbolic.svg',
            'di-play-btn',
            () => this._callMpris('PlayPause'),
            20
        );
        midRow.add_child(this._playPauseBtn);

        this._musicMainContent.add_child(midRow);

        // 3. Bottom Row: Prev | Serpentine Scrubber with Vertical Pill Thumb | Next | Shuffle | Volume
        const botRow = new St.BoxLayout({
            style_class: 'di-music-bottom-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const prevBtn = this._makeRoundIconBtn('angie-backward-symbolic.svg', 'di-transport-btn', () => this._callMpris('Previous'), 16);

        this._musicProgressArea = new St.DrawingArea({
            style_class: 'di-music-scrubber',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        this._ext._connect(this._musicProgressArea, 'repaint', (area) => this._paintMusicScrubber(area));

        const getScrubberFraction = (actor, event) => {
            const [stageX, stageY] = event.get_coords();
            const padX = 6;
            const [ok, rx] = actor.transform_stage_point(stageX, stageY);
            const w = actor.get_width();
            if (ok && w > padX * 2) {
                return Math.max(0, Math.min(1, (rx - padX) / (w - padX * 2)));
            }
            const [ax] = actor.get_transformed_position();
            const [aw] = actor.get_transformed_size();
            if (aw > padX * 2) {
                return Math.max(0, Math.min(1, (stageX - ax - padX) / (aw - padX * 2)));
            }
            return null;
        };

        this._ext._connect(this._musicProgressArea, 'button-press-event', (actor, event) => {
            const frac = getScrubberFraction(actor, event);
            if (frac !== null && this._currentTrack.lengthUs > 0) {
                this._isDraggingScrubber = true;
                this._seekToFraction(frac);
            }
            return Clutter.EVENT_STOP;
        });

        this._ext._connect(this._musicProgressArea, 'motion-event', (actor, event) => {
            const state = event.get_state();
            const btnDown = (state & Clutter.ModifierType.BUTTON1_MASK) !== 0;
            if (!this._isDraggingScrubber && !btnDown) return Clutter.EVENT_PROPAGATE;
            const frac = getScrubberFraction(actor, event);
            if (frac !== null && this._currentTrack.lengthUs > 0) {
                this._currentTrack.positionUs = Math.round(frac * this._currentTrack.lengthUs);
                this._lastSeekTime = Date.now();
                this._updateProgressLabels();
                if (!this._dragSeekThrottle) {
                    this._dragSeekThrottle = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 90, () => {
                        this._dragSeekThrottle = 0;
                        if (this._currentTrack.lengthUs > 0) {
                            this._seekToFraction(this._currentTrack.positionUs / this._currentTrack.lengthUs);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
            return Clutter.EVENT_STOP;
        });

        this._ext._connect(this._musicProgressArea, 'button-release-event', (actor, event) => {
            if (this._isDraggingScrubber) {
                this._isDraggingScrubber = false;
                const frac = getScrubberFraction(actor, event);
                if (frac !== null && this._currentTrack.lengthUs > 0) {
                    this._seekToFraction(frac);
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._ext._connect(this._musicProgressArea, 'scroll-event', (_actor, event) => {
            if (this._currentTrack.lengthUs <= 0) return Clutter.EVENT_PROPAGATE;
            const dir = event.get_scroll_direction();
            let deltaUs = 0;
            if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.RIGHT) {
                deltaUs = 5000000;
            } else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.LEFT) {
                deltaUs = -5000000;
            } else if (dir === Clutter.ScrollDirection.SMOOTH) {
                const [dx, dy] = event.get_scroll_delta();
                deltaUs = Math.round((-dy + dx) * 5000000);
            }
            if (deltaUs !== 0) {
                const targetUs = Math.max(0, Math.min(this._currentTrack.lengthUs, (this._currentTrack.positionUs || 0) + deltaUs));
                this._seekToFraction(targetUs / this._currentTrack.lengthUs);
            }
            return Clutter.EVENT_STOP;
        });

        const nextBtn = this._makeRoundIconBtn('angie-forward-symbolic.svg', 'di-transport-btn', () => this._callMpris('Next'), 16);

        const shuffleIcon = new St.Icon({
            icon_name: 'media-playlist-shuffle-symbolic',
            icon_size: 15,
        });
        const shuffleBtn = new St.Button({
            style_class: 'di-transport-btn',
            child: shuffleIcon,
            reactive: true,
            track_hover: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._ext._connect(shuffleBtn, 'clicked', () => this._toggleShuffle());

        const volBtn = this._makeRoundIconBtn('angie-speaker-symbolic.svg', 'di-transport-btn di-vol-btn', () => {
            GLib.spawn_command_line_async('wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle');
            this._ext._updateSystemIconsAsync();
        }, 15);

        botRow.add_child(prevBtn);
        botRow.add_child(this._musicProgressArea);
        botRow.add_child(nextBtn);
        botRow.add_child(shuffleBtn);
        botRow.add_child(volBtn);

        this._musicMainContent.add_child(botRow);
        this._musicScrim.add_child(this._musicMainContent);

        // Inline Audio Output Device Picker (Speakers, HDMI, Headphones/Bluetooth)
        this._outputPickerOpen = false;
        this._outputPickerScroll = new St.ScrollView({
            style_class: 'di-output-scroll',
            x_expand: true,
            y_expand: true,
            visible: false,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this._outputListContainer = new St.BoxLayout({
            style_class: 'di-output-list',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._outputPickerScroll.set_child(this._outputListContainer);
        this._musicScrim.add_child(this._outputPickerScroll);

        this._musicCard.add_child(this._musicScrim);
        page.add_child(this._musicCard);

        // Android 17 / Pixel Experience Stacked Vertical Media Slices (right side when multiple streams active)
        this._musicSlicesBox = new St.BoxLayout({
            style_class: 'di-music-slices-box',
            y_expand: true,
            visible: false,
        });
        page.add_child(this._musicSlicesBox);

        return page;
    }

    _toggleShuffle() {
        const players = this._ext._players;
        if (!players || players.size === 0) return;
        const name = this._selectedPlayerName || players.keys().next().value;
        if (!name) return;
        const item = players.get(name);
        const proxy = item?.proxy || item;
        const cur = proxy?.get_cached_property?.('Shuffle')?.deep_unpack?.() ?? false;
        Gio.DBus.session.call(
            name,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Set',
            new GLib.Variant('(ssv)', ['org.mpris.MediaPlayer2.Player', 'Shuffle', new GLib.Variant('b', !cur)]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            null
        );
    }

    _makeRoundIconBtn(iconFile, styleClass, onClick, iconSize = 15) {
        const icon = new St.Icon({
            gicon: this._gicon(iconFile),
            icon_size: iconSize,
        });
        const btn = new St.Button({
            style_class: styleClass,
            child: icon,
            reactive: true,
            track_hover: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn._iconActor = icon;
        this._ext._connect(btn, 'clicked', onClick);
        return btn;
    }

    _paintWaveScrubber(area, fraction, phase, rgbColor = [1, 1, 1]) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const padX = 6;
        const usableW = Math.max(10, w - padX * 2);
        const cy = h / 2;

        const frac = Math.max(0, Math.min(1, fraction || 0));
        const thumbX = padX + usableW * frac;

        // Unplayed right track
        const rightStart = Math.min(padX + usableW, thumbX + 3);
        const rightW = Math.max(0, (padX + usableW) - rightStart);
        if (rightW > 0) {
            const rightH = 2.5;
            this._roundedRect(cr, rightStart, cy - rightH / 2, rightW, rightH, 1.25);
            cr.setSourceRGBA(1, 1, 1, 0.3);
            cr.fill();
        }

        // Played left track: Relaxed Android 17 / Pixel serpentine sine wave
        const waveEnd = Math.max(padX, thumbX - 3);
        if (waveEnd > padX + 1) {
            const wavelength = 28;
            const amp = 1.8;
            const curPhase = phase || 0;

            cr.newPath();
            for (let x = padX; x <= waveEnd; x += 1) {
                const y = cy + Math.sin(((x - padX) * 2 * Math.PI) / wavelength - curPhase) * amp;
                if (x === padX) cr.moveTo(x, y);
                else cr.lineTo(x, y);
            }
            const lastY = cy + Math.sin(((waveEnd - padX) * 2 * Math.PI) / wavelength - curPhase) * amp;
            cr.lineTo(waveEnd, lastY);

            cr.setLineWidth(2.3);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            const [r, g, b] = rgbColor;
            cr.setSourceRGBA(r, g, b, 0.98);
            cr.stroke();
        }

        // Android 17 / Pixel vertical pill thumb indicator
        const thumbW = 4.5;
        const thumbH = 16;
        this._roundedRect(cr, thumbX - thumbW / 2, cy - thumbH / 2, thumbW, thumbH, thumbW / 2);
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.fill();

        cr.$dispose();
    }

    _paintMusicScrubber(area) {
        const frac = (this._currentTrack.lengthUs > 0)
            ? this._currentTrack.positionUs / this._currentTrack.lengthUs
            : 0;
        this._paintWaveScrubber(area, frac, this._scrubberPhase, [1, 1, 1]);
    }

    _startWaveTimer(timerProp, phaseProp, canRunFn, onTick) {
        if (this[timerProp]) return;
        this[timerProp] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 75, () => {
            if (!canRunFn()) {
                this[timerProp] = 0;
                return GLib.SOURCE_REMOVE;
            }
            this[phaseProp] = ((this[phaseProp] || 0) + 0.10) % (Math.PI * 2);
            onTick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopWaveTimer(timerProp) {
        this._clearTimer(timerProp);
    }

    _updateScrubberWaveState() {
        if (this._isOpen && this._activeTab === 'music' && this._currentTrack?.playing) {
            this._startWaveTimer(
                '_scrubberWaveTimer',
                '_scrubberPhase',
                () => this._isOpen && this._activeTab === 'music' && this._currentTrack?.playing,
                () => {
                    if (this._currentTrack.lengthUs > 0) {
                        this._currentTrack.positionUs = Math.min(
                            this._currentTrack.lengthUs,
                            (this._currentTrack.positionUs || 0) + 75000
                        );
                    }
                    if (this._musicProgressArea) this._musicProgressArea.queue_repaint();
                }
            );
        } else {
            this._stopWaveTimer('_scrubberWaveTimer');
        }
    }

    _stopScrubberWave() {
        this._stopWaveTimer('_scrubberWaveTimer');
    }

    _roundedRect(cr, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        cr.newSubPath();
        cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
        cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
        cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
        cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
        cr.closePath();
    }

    updateFromPlayers(data) {
        this._otherTracks = [];
        const chosen = data?.chosen;
        if (!chosen) {
            this._selectedPlayerName = null;
            this._currentTrack = {
                playing: false,
                hasMedia: false,
                title: 'Nothing playing',
                artist: 'Start a media player',
                artUrl: null,
                artPath: null,
                lengthUs: 0,
                positionUs: 0,
                playerName: '',
                totalPlayers: 0,
            };
            this._refreshMusicUI();
            return;
        }

        this._selectedPlayerName = chosen.name;
        const all = data?.allPlayers || [];

        // Collect all other active streams for the Android 17 Pixel stacked vertical slices
        for (const p of all) {
            if (p.name === chosen.name) continue;
            if (p.status === 'Playing' || p.status === 'Paused' || p.title) {
                this._otherTracks.push({
                    busName: p.name,
                    title: p.title || p.playerName,
                    playing: p.status === 'Playing',
                    artPath: p.artPath || null,
                    playerName: p.playerName,
                });
            }
        }

        const hasMedia = chosen.status === 'Playing' || chosen.status === 'Paused' || Boolean(chosen.rawTitle);
        const posUs = chosen.positionUs !== null ? chosen.positionUs : (this._currentTrack.positionUs || 0);

        this._currentTrack = {
            playing: chosen.status === 'Playing',
            hasMedia,
            title: chosen.title || 'Nothing playing',
            artist: chosen.artist || (chosen.rawTitle ? 'Unknown artist' : 'Waiting for playback'),
            artPath: chosen.artPath || null,
            lengthUs: chosen.lengthUs || 0,
            positionUs: Math.max(0, posUs),
            playerName: chosen.playerName,
            totalPlayers: data?.totalPlayers || all.length,
        };

        this._refreshMusicUI();
    }

    _pollMprisPosition() {
        if (this._isDraggingScrubber || Date.now() - (this._lastSeekTime || 0) < 600) return;
        const players = this._ext._players;
        if (!players || !this._selectedPlayerName) return;
        const item = players.get(this._selectedPlayerName);
        if (!item?.proxy) return;

        Gio.DBus.session.call(
            this._selectedPlayerName,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null,
            Gio.DBusCallFlags.NONE,
            1000,
            null,
            (conn, res) => {
                try {
                    const reply = conn.call_finish(res);
                    if (this._isDraggingScrubber || Date.now() - (this._lastSeekTime || 0) < 600) return;
                    const [val] = reply.deep_unpack();
                    const pos = typeof val?.deep_unpack === 'function' ? val.deep_unpack() : Number(val);
                    if (!Number.isNaN(pos)) {
                        this._currentTrack.positionUs = Math.max(0, pos);
                        this._updateProgressLabels();
                    }
                } catch (e) {}
            }
        );
    }

    _seekToFraction(frac) {
        const players = this._ext._players;
        if (!players || !this._selectedPlayerName || this._currentTrack.lengthUs <= 0) return;
        const item = players.get(this._selectedPlayerName);
        if (!item?.proxy) return;

        const clampedFrac = Math.max(0, Math.min(1, frac));
        const targetUs = Math.round(clampedFrac * this._currentTrack.lengthUs);
        const prevPosUs = this._currentTrack.positionUs || 0;
        const offsetUs = targetUs - prevPosUs;

        this._lastSeekTime = Date.now();
        this._currentTrack.positionUs = targetUs;
        this._updateProgressLabels();

        const metadata = item.proxy.Metadata || item.proxy.get_cached_property('Metadata')?.deep_unpack() || {};
        const trackIdVariant = metadata['mpris:trackid'];
        const trackId = typeof trackIdVariant === 'string'
            ? trackIdVariant
            : (trackIdVariant?.deep_unpack ? trackIdVariant.deep_unpack() : null);

        const sendRelativeSeek = () => {
            Gio.DBus.session.call(
                this._selectedPlayerName,
                '/org/mpris/MediaPlayer2',
                'org.mpris.MediaPlayer2.Player',
                'Seek',
                new GLib.Variant('(x)', [offsetUs]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                null
            );
        };

        if (trackId && String(trackId).startsWith('/') && !String(trackId).endsWith('/NoTrack')) {
            Gio.DBus.session.call(
                this._selectedPlayerName,
                '/org/mpris/MediaPlayer2',
                'org.mpris.MediaPlayer2.Player',
                'SetPosition',
                new GLib.Variant('(ox)', [String(trackId), targetUs]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (conn, res) => {
                    try {
                        conn.call_finish(res);
                    } catch (e) {
                        sendRelativeSeek();
                    }
                }
            );
        } else {
            sendRelativeSeek();
        }
    }

    _callMpris(method) {
        const players = this._ext._players;
        if (!players || players.size === 0) return;
        const name = this._selectedPlayerName || players.keys().next().value;
        if (!name) return;
        Gio.DBus.session.call(
            name,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player',
            method,
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            () => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._ext._updateMediaStatus();
                    return GLib.SOURCE_REMOVE;
                });
            }
        );
    }

    _raiseActivePlayer() {
        if (!this._selectedPlayerName) return;
        Gio.DBus.session.call(
            this._selectedPlayerName,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2',
            'Raise',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            null
        );
    }

    _cyclePlayer() {
        const players = this._ext._players;
        if (!players || players.size <= 1) return;
        const keys = Array.from(players.keys());
        const idx = keys.indexOf(this._selectedPlayerName);
        this._selectedPlayerName = keys[(idx + 1) % keys.length];
        this._userSelectedPlayer = true;
        this._ext._updateMediaStatus();
    }

    _selectPlayer(busName) {
        if (!busName) return;
        this._selectedPlayerName = busName;
        this._userSelectedPlayer = true;
        this._ext._updateMediaStatus();
    }

    _refreshMusicUI() {
        if (!this._musicTitle) return;
        this._musicTitle.set_text(this._currentTrack.title);
        this._musicArtist.set_text(this._currentTrack.artist);

        if (this._musicCard) {
            if (this._currentTrack.artPath && GLib.file_test(this._currentTrack.artPath, GLib.FileTest.EXISTS)) {
                this._musicCard.set_style(
                    `background-image: url('file://${this._currentTrack.artPath}'); background-size: cover; background-position: center;`
                );
                if (this._musicScrim) this._musicScrim.add_style_class_name('has-art');
            } else {
                this._musicCard.set_style('');
                if (this._musicScrim) this._musicScrim.remove_style_class_name('has-art');
            }
        }

        if (this._playPauseBtn?._iconActor) {
            this._playPauseBtn._iconActor.gicon = this._gicon(
                this._currentTrack.playing ? 'angie-pause-symbolic.svg' : 'angie-play-symbolic.svg'
            );
        }

        if (this._playerBadgeBtn) {
            this._playerBadgeBtn.visible = true;
            this._refreshAudioOutputs();
        }

        // Render Android 17 / Pixel Experience vertical slices on the right when multiple streams exist
        if (this._musicSlicesBox) {
            this._musicSlicesBox.destroy_all_children();
            const others = (this._otherTracks || []).slice(0, 3);
            if (others.length > 0) {
                this._musicSlicesBox.visible = true;
                others.forEach(slice => {
                    const sliceBtn = new St.Button({
                        style_class: 'di-music-slice',
                        y_expand: true,
                        reactive: true,
                        track_hover: true,
                        can_focus: true,
                    });
                    if (slice.artPath && GLib.file_test(slice.artPath, GLib.FileTest.EXISTS)) {
                        sliceBtn.set_style(
                            `background-image: url('file://${slice.artPath}'); background-size: cover; background-position: center;`
                        );
                    } else {
                        sliceBtn.set_style('');
                    }

                    const sliceScrim = new St.Bin({
                        style_class: 'di-music-slice-scrim',
                        x_expand: true,
                        y_expand: true,
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    if (!slice.artPath) {
                        sliceScrim.set_child(new St.Icon({
                            gicon: this._gicon('angie-music-symbolic.svg'),
                            icon_size: 16,
                            style_class: 'di-music-slice-icon',
                        }));
                    }
                    sliceBtn.set_child(sliceScrim);
                    this._ext._connect(sliceBtn, 'clicked', () => this._selectPlayer(slice.busName));
                    this._musicSlicesBox.add_child(sliceBtn);
                });
            } else {
                this._musicSlicesBox.visible = false;
            }
        }

        this._updateProgressLabels();
        this._updateMusicTabVisibility();
        this._updateScrubberWaveState();
    }

    _toggleOutputPicker() {
        this._setOutputPickerOpen(!this._outputPickerOpen);
    }

    _setOutputPickerOpen(open) {
        this._outputPickerOpen = Boolean(open);
        if (this._musicMainContent) this._musicMainContent.visible = !this._outputPickerOpen;
        if (this._outputPickerScroll) this._outputPickerScroll.visible = this._outputPickerOpen;
        if (this._musicArtIcon) {
            this._musicArtIcon.gicon = this._gicon(
                this._outputPickerOpen ? 'angie-chevron-left-symbolic.svg' : 'angie-music-symbolic.svg'
            );
        }
        if (this._outputPickerOpen) {
            this._refreshAudioOutputs();
        }
    }

    _formatAudioDevice(rawName) {
        const clean = (rawName || '').trim();
        const lower = clean.toLowerCase();

        if (lower.includes('hdmi') || lower.includes('displayport')) {
            const numMatch = clean.match(/(?:HDMI|DisplayPort)[^0-9]*(\d+)/i);
            const num = numMatch ? ` ${numMatch[1]}` : '';
            return {
                shortLabel: `HDMI${num}`,
                fullLabel: `HDMI / DisplayPort${num}`,
                iconName: 'video-display-symbolic',
            };
        }
        if (lower.includes('speaker') || lower.includes('altoparlant')) {
            return {
                shortLabel: 'Speakers',
                fullLabel: 'System Speakers',
                iconName: 'audio-speakers-symbolic',
            };
        }
        if (lower.includes('headphone') || lower.includes('headset') || lower.includes('cuffie') || lower.includes('earbud') || lower.includes('airpods')) {
            return {
                shortLabel: 'Headphones',
                fullLabel: clean,
                iconName: 'audio-headphones-symbolic',
            };
        }
        // External / Bluetooth / USB named devices (e.g. "MAJOR IV")
        const short = clean.length > 16 ? `${clean.slice(0, 15)}…` : (clean || 'Audio');
        return {
            shortLabel: short,
            fullLabel: `${clean} (Headphones / Audio)`,
            iconName: 'audio-headphones-symbolic',
        };
    }

    async _refreshAudioOutputs() {
        if (this._isLoadingOutputs) return;
        this._isLoadingOutputs = true;
        try {
            const outputs = [];
            const out = await this._ext._execCommandAsync('wpctl status 2>/dev/null');
            if (out) {
                const lines = out.split('\n');
                let inAudio = false;
                let inSinks = false;
                for (const line of lines) {
                    if (/^Audio\b/.test(line.trim())) {
                        inAudio = true;
                        continue;
                    }
                    if (inAudio && /^(Video|Settings)\b/.test(line.trim())) {
                        break;
                    }
                    if (!inAudio) continue;

                    if (line.includes('Sinks:')) {
                        inSinks = true;
                        continue;
                    }
                    if (inSinks && (line.includes('Sources:') || line.includes('Sink endpoints:') || line.includes('Filters:') || line.includes('Streams:'))) {
                        inSinks = false;
                        break;
                    }
                    if (inSinks) {
                        const m = line.match(/^[\s│├└─]*(\*)?\s*(\d+)\.\s+(.+?)(?:\s+\[vol:.*)?$/);
                        if (m) {
                            const isDefault = Boolean(m[1]);
                            const id = m[2];
                            const rawName = m[3].trim();
                            const fmt = this._formatAudioDevice(rawName);
                            outputs.push({
                                id,
                                rawName,
                                isDefault,
                                shortLabel: fmt.shortLabel,
                                fullLabel: fmt.fullLabel,
                                iconName: fmt.iconName,
                            });
                        }
                    }
                }
            }

            // Fallback to Gvc.MixerControl if wpctl returned nothing
            if (outputs.length === 0) {
                try {
                    const qsOut = Main.panel.statusArea.quickSettings?._volumeOutput?._output;
                    const control = qsOut?._control || Volume.getMixerControl();
                    const activeStream = control?.get_default_sink?.();
                    const activeUiDev = (activeStream && control?.lookup_device_from_stream)
                        ? control.lookup_device_from_stream(activeStream)
                        : null;
                    const activeId = activeUiDev ? activeUiDev.get_id() : -1;

                    if (qsOut?._deviceItems) {
                        for (const [id] of qsOut._deviceItems) {
                            const dev = control.lookup_output_id(id);
                            if (!dev) continue;
                            const raw = dev.origin ? `${dev.description} (${dev.origin})` : dev.description;
                            const fmt = this._formatAudioDevice(raw);
                            outputs.push({
                                gvcId: id,
                                rawName: raw,
                                isDefault: id === activeId,
                                shortLabel: fmt.shortLabel,
                                fullLabel: raw,
                                iconName: fmt.iconName,
                            });
                        }
                    }
                } catch (e) {}
            }

            const active = outputs.find(o => o.isDefault) || outputs[0];
            if (active && this._playerBadgeLabel && this._outputBadgeIcon) {
                this._playerBadgeLabel.set_text(active.shortLabel);
                this._outputBadgeIcon.icon_name = active.iconName;
            }

            if (this._outputListContainer) {
                this._outputListContainer.destroy_all_children();
                outputs.forEach(dev => {
                    const rowBtn = new St.Button({
                        style_class: dev.isDefault ? 'di-output-item active' : 'di-output-item',
                        x_expand: true,
                        reactive: true,
                        track_hover: true,
                        can_focus: true,
                    });
                    const rowBox = new St.BoxLayout({
                        style_class: 'di-output-item-box',
                        x_expand: true,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    const icon = new St.Icon({
                        icon_name: dev.iconName,
                        icon_size: 14,
                        style_class: 'di-output-item-icon',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    const lbl = new St.Label({
                        text: dev.fullLabel,
                        style_class: 'di-output-item-label',
                        x_expand: true,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    lbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                    rowBox.add_child(icon);
                    rowBox.add_child(lbl);

                    if (dev.isDefault) {
                        const check = new St.Icon({
                            gicon: this._gicon('angie-check-symbolic.svg'),
                            icon_size: 13,
                            style_class: 'di-output-item-check',
                            y_align: Clutter.ActorAlign.CENTER,
                        });
                        rowBox.add_child(check);
                    }

                    rowBtn.set_child(rowBox);
                    this._ext._connect(rowBtn, 'clicked', () => this._selectAudioOutput(dev));
                    this._outputListContainer.add_child(rowBtn);
                });
            }
        } finally {
            this._isLoadingOutputs = false;
        }
    }

    async _selectAudioOutput(dev) {
        if (!dev) return;
        if (this._playerBadgeLabel && this._outputBadgeIcon) {
            this._playerBadgeLabel.set_text(dev.shortLabel);
            this._outputBadgeIcon.icon_name = dev.iconName;
        }
        this._setOutputPickerOpen(false);

        if (dev.id) {
            await this._ext._execCommandAsync(`wpctl set-default ${dev.id}`);
        }
        try {
            const qsOut = Main.panel.statusArea.quickSettings?._volumeOutput?._output;
            const control = qsOut?._control || Volume.getMixerControl();
            if (dev.gvcId && control) {
                const uiDev = control.lookup_output_id(dev.gvcId);
                if (uiDev) control.change_output(uiDev);
            } else if (qsOut?._deviceItems && control) {
                for (const [id] of qsOut._deviceItems) {
                    const uiDev = control.lookup_output_id(id);
                    if (!uiDev) continue;
                    const desc = `${uiDev.description || ''} ${uiDev.origin || ''}`.toLowerCase();
                    if (dev.rawName && desc.includes(dev.rawName.toLowerCase().slice(0, 10))) {
                        control.change_output(uiDev);
                        break;
                    }
                }
            }
        } catch (e) {}

        this._ext._updateSystemIconsAsync();
        this._refreshAudioOutputs();
    }

    _hasMedia() {
        return !!(this._currentTrack && (this._currentTrack.playing || this._currentTrack.hasMedia));
    }

    _updateVisibleTabs() {
        if (!this._tabButtons) return;
        this._tabButtons.forEach((entry, id) => {
            const key = `di-show-tab-${id}`;
            let show = true;
            try {
                if (this._settings) show = this._settings.get_boolean(key);
            } catch (e) {}
            entry.btn.visible = show;
        });
        const curEntry = this._tabButtons.get(this._activeTab);
        if (curEntry && !curEntry.btn.visible) {
            this._switchTab(this._defaultTab(), false);
        }
    }

    _updateMusicTabVisibility() {
        this._updateVisibleTabs();
    }

    _defaultTab() {
        let pref = 'notifications';
        try {
            if (this._settings) pref = this._settings.get_string('di-default-tab') || 'notifications';
        } catch (e) {}
        if (this._tabButtons?.get(pref)?.btn?.visible === false) {
            for (const [id, entry] of this._tabButtons.entries()) {
                if (entry.btn.visible) return id;
            }
        }
        return pref;
    }

    _updateProgressLabels() {
        if (this._musicProgressArea) {
            this._musicProgressArea.queue_repaint();
        }
    }

    _formatSec(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    // =========================================================================
    // 4. PAGE 2: CLIPBOARD (TESTO, LINK, ULTIMI 3 SCREENSHOT & FILE DROP SHELF)
    // =========================================================================

    _initClipboardMonitor() {
        this._screenshotMonitors = [];
        try {
            const selection = global.display.get_selection();
            this._ext._connect(selection, 'owner-changed', (_sel, type) => {
                if (type === Meta.SelectionType.SELECTION_DND) {
                    this._onDndSelectionChanged(selection);
                    return;
                }
                if (type !== Meta.SelectionType.SELECTION_CLIPBOARD) return;
                if (this._ownClipCopy) {
                    this._ownClipCopy = false;
                    return;
                }

                const clip = St.Clipboard.get_default();
                let mimes = [];
                try {
                    mimes = clip.get_mimetypes(St.ClipboardType.CLIPBOARD) || [];
                } catch (e) {}

                // 1. Check if files were copied (e.g. from Nautilus / Files)
                if (mimes.includes('x-special/gnome-copied-files') || mimes.includes('text/uri-list')) {
                    const targetMime = mimes.includes('text/uri-list') ? 'text/uri-list' : 'x-special/gnome-copied-files';
                    clip.get_content(St.ClipboardType.CLIPBOARD, targetMime, (_c, bytes) => {
                        try {
                            if (!bytes || bytes.get_size() === 0) return;
                            const raw = new TextDecoder().decode(bytes.get_data());
                            const paths = this._parseUriListToPaths(raw);
                            if (paths.length > 0) {
                                paths.forEach(p => this._addFileClipboardItem(p));
                            }
                        } catch (e) {}
                    });
                    return;
                }

                // 2. Check if a screenshot / image was copied
                if (mimes.includes('image/png')) {
                    clip.get_content(St.ClipboardType.CLIPBOARD, 'image/png', (_c, bytes) => {
                        try {
                            if (!bytes || bytes.get_size() === 0) return;
                            const byteSize = bytes.get_size();

                            // Avoid duplicate: check if this screenshot is already tracked in clips
                            const alreadyInClips = this._clips.some(c => {
                                if (c.kind !== 'screenshot' || !c.path) return false;
                                const age = Math.abs(Date.now() - (c.timestamp || 0));
                                if (age > 10000) return false;
                                try {
                                    const sz = Gio.File.new_for_path(c.path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null)?.get_size();
                                    return sz === byteSize;
                                } catch (e) { return false; }
                            });
                            if (alreadyInClips) return;

                            // Check if GNOME Shell just saved this screenshot into the Screenshots folder
                            const savedShotPath = this._findRecentSavedScreenshot(byteSize);
                            if (savedShotPath) {
                                this._addScreenshotClipboardItem(savedShotPath);
                                return;
                            }

                            // Otherwise, it's an image copied from another app (browser, image viewer, etc.)
                            const cacheDir = `${GLib.get_user_cache_dir()}/angiebar-clipboard`;
                            GLib.mkdir_with_parents(cacheDir, 0o755);
                            const shotPath = `${cacheDir}/shot-${Date.now()}.png`;
                            const file = Gio.File.new_for_path(shotPath);
                            file.replace_contents_bytes_async(
                                bytes,
                                null,
                                false,
                                Gio.FileCreateFlags.REPLACE_DESTINATION,
                                null,
                                (obj, res) => {
                                    try {
                                        obj.replace_contents_finish(res);
                                        this._addScreenshotClipboardItem(shotPath);
                                    } catch (e) {}
                                }
                            );
                        } catch (e) {}
                    });
                    return;
                }

                // 3. Standard text / link / code clipboard
                clip.get_text(St.ClipboardType.CLIPBOARD, (_clip, text) => {
                    if (!text || !text.trim()) return;
                    const trimmed = text.trim();
                    const filePaths = this._parseUriListToPaths(trimmed);
                    if (filePaths.length > 0) {
                        filePaths.forEach(p => this._addFileClipboardItem(p));
                    } else {
                        this._addClipboardItem(trimmed);
                    }
                });
            });
        } catch (e) {}

        // Watch GNOME Screenshots directories so recent screenshots are synced
        this._initScreenshotDirWatch();

        // Periodic 60s clipboard auto-prune timer: expires unpinned items (especially screenshots & files) after 1 hour
        this._clearTimer('_clipExpiryTimer');
        this._clipExpiryTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            if (this._pruneClipboardItems()) {
                this._saveClips();
                if (this._isOpen && this._activeTab === 'clipboard') {
                    this._refreshClipboardUI();
                }
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _parseUriListToPaths(raw) {
        if (!raw) return [];
        const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('file://'));
        const out = [];
        for (const uri of lines) {
            try {
                const f = Gio.File.new_for_uri(uri);
                const p = f.get_path();
                if (p && GLib.file_test(p, GLib.FileTest.EXISTS)) {
                    out.push(p);
                }
            } catch (e) {}
        }
        return out;
    }

    _findRecentSavedScreenshot(byteSize) {
        if (!byteSize) return null;
        const picsDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || `${GLib.get_home_dir()}/Immagini`;
        const homeDir = GLib.get_home_dir();
        const candidateDirs = [
            `${picsDir}/Screenshots`,
            `${picsDir}/Schermate`,
            `${homeDir}/Immagini/Screenshots`,
            `${homeDir}/Immagini/Schermate`,
            `${homeDir}/Pictures/Screenshots`,
            `${homeDir}/Pictures/Schermate`,
        ];
        const seen = new Set();
        const dirs = candidateDirs.filter(d => {
            if (seen.has(d)) return false;
            seen.add(d);
            return GLib.file_test(d, GLib.FileTest.IS_DIR);
        });

        const now = Date.now();
        for (const dirPath of dirs) {
            try {
                const dir = Gio.File.new_for_path(dirPath);
                const enumerator = dir.enumerate_children(
                    'standard::name,standard::size,time::modified',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const name = info.get_name();
                    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
                    const mtime = (info.get_modification_date_time()?.to_unix?.() || 0) * 1000;
                    if (Math.abs(now - mtime) <= 10000 && info.get_size() === byteSize) {
                        enumerator.close(null);
                        return `${dirPath}/${name}`;
                    }
                }
                enumerator.close(null);
            } catch (e) {}
        }
        return null;
    }

    _initScreenshotDirWatch() {
        const picsDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || `${GLib.get_home_dir()}/Immagini`;
        const homeDir = GLib.get_home_dir();
        const candidateDirs = [
            `${picsDir}/Screenshots`,
            `${picsDir}/Schermate`,
            `${homeDir}/Immagini/Screenshots`,
            `${homeDir}/Immagini/Schermate`,
            `${homeDir}/Pictures/Screenshots`,
            `${homeDir}/Pictures/Schermate`,
        ];
        const seen = new Set();
        candidateDirs.forEach(dirPath => {
            if (seen.has(dirPath)) return;
            seen.add(dirPath);
            if (!GLib.file_test(dirPath, GLib.FileTest.IS_DIR)) return;
            try {
                const dirFile = Gio.File.new_for_path(dirPath);
                const monitor = dirFile.monitor_directory(Gio.FileMonitorFlags.NONE, null);
                monitor.connect('changed', (_mon, file, _other, eventType) => {
                    if (
                        eventType === Gio.FileMonitorEvent.CREATED ||
                        eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT
                    ) {
                        const p = file?.get_path?.();
                        if (p && /\.(png|jpe?g|webp)$/i.test(p) && GLib.file_test(p, GLib.FileTest.EXISTS)) {
                            this._addScreenshotClipboardItem(p);
                        }
                    }
                });
                this._screenshotMonitors.push(monitor);
            } catch (e) {}
        });
    }

    _getClipboardTtlMs() {
        let mins = 60;
        try {
            if (this._settings) mins = this._settings.get_int('di-clipboard-ttl-mins');
        } catch (e) {}
        return mins > 0 ? mins * 60 * 1000 : 0;
    }

    _syncRecentScreenshots() {
        const picsDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || `${GLib.get_home_dir()}/Immagini`;
        const homeDir = GLib.get_home_dir();
        const candidateDirs = [
            `${picsDir}/Screenshots`,
            `${picsDir}/Schermate`,
            `${homeDir}/Immagini/Screenshots`,
            `${homeDir}/Immagini/Schermate`,
            `${homeDir}/Pictures/Screenshots`,
            `${homeDir}/Pictures/Schermate`,
        ];
        const seen = new Set();
        const dirs = candidateDirs.filter(d => {
            if (seen.has(d)) return false;
            seen.add(d);
            return GLib.file_test(d, GLib.FileTest.IS_DIR);
        });

        const found = [];
        const now = Date.now();
        const ttlMs = this._getClipboardTtlMs();
        const minMtime = ttlMs > 0 ? (now - ttlMs) : 0;
        const cacheDir = `${GLib.get_user_cache_dir()}/angiebar-clipboard`;

        dirs.forEach(dirPath => {
            try {
                const dir = Gio.File.new_for_path(dirPath);
                const enumerator = dir.enumerate_children(
                    'standard::name,standard::size,time::modified',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const name = info.get_name();
                    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
                    const mtime = (info.get_modification_date_time()?.to_unix?.() || 0) * 1000;
                    if (mtime >= minMtime) {
                        found.push({ path: `${dirPath}/${name}`, name, mtime, size: info.get_size() });
                    }
                }
                enumerator.close(null);
            } catch (e) {}
        });

        found.sort((a, b) => b.mtime - a.mtime);
        const top3 = found.slice(0, 3).reverse();
        top3.forEach(s => {
            if (this._clips.some(c => c.kind === 'screenshot' && c.path === s.path)) return;

            // Remove any temporary cached screenshot matching this file size
            const cacheIdx = this._clips.findIndex(c => {
                if (c.kind !== 'screenshot' || !c.path || !c.path.startsWith(cacheDir)) return false;
                if (s.size > 0) {
                    try {
                        const sz = Gio.File.new_for_path(c.path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null)?.get_size();
                        return sz === s.size;
                    } catch (e) { return false; }
                }
                return false;
            });
            if (cacheIdx !== -1) {
                const cached = this._clips[cacheIdx];
                this._clips.splice(cacheIdx, 1);
                try { Gio.File.new_for_path(cached.path).delete_async(GLib.PRIORITY_LOW, null, null); } catch (e) {}
            }

            this._clips.unshift({
                id: s.mtime + Math.floor(Math.random() * 1000),
                text: s.name,
                path: s.path,
                kind: 'screenshot',
                pinned: false,
                timestamp: s.mtime || now,
            });
        });
        if (this._pruneClipboardItems()) {
            this._saveClips();
        }
    }

    _onDndSelectionChanged(selection) {
        try {
            const mimes = selection.get_mimetypes(Meta.SelectionType.SELECTION_DND) || [];
            const uriMime = mimes.find(m => m === 'text/uri-list' || m === 'x-special/gnome-copied-files');
            if (!uriMime) return;

            const memStream = Gio.MemoryOutputStream.new_resizable();
            selection.transfer_async(
                Meta.SelectionType.SELECTION_DND,
                uriMime,
                -1,
                memStream,
                null,
                (sel, res) => {
                    try {
                        sel.transfer_finish(res);
                        memStream.close(null);
                        const bytes = memStream.steal_as_bytes();
                        const raw = new TextDecoder().decode(bytes.get_data());
                        const paths = this._parseUriListToPaths(raw);
                        if (paths.length > 0) {
                            this._pendingDndPaths = paths;
                            this._startDndWatch();
                        }
                    } catch (e) {}
                }
            );
        } catch (e) {}
    }

    _isPointNearActor(px, py, actor, pad = 10) {
        if (!actor || !actor.visible) return false;
        const [ax, ay] = actor.get_transformed_position();
        const [aw, ah] = actor.get_transformed_size();
        return px >= ax - pad && px <= ax + aw + pad && py >= ay - pad && py <= ay + ah + pad;
    }

    _startDndWatch() {
        this._stopDndWatch();
        this._dndHoveringIsland = false;
        this._dndStartedWithButton = false;

        this._dndWatchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 45, () => {
            const [px, py, mask] = global.get_pointer();
            const btnDown = (mask & Clutter.ModifierType.BUTTON1_MASK) !== 0;
            if (btnDown) this._dndStartedWithButton = true;

            const overPill = this._isPointNearActor(px, py, this._ext._centerIsland, 18);
            const overPopup = this._isPointNearActor(px, py, this._popup, 14);

            if (btnDown && overPill && !this._isOpen) {
                this.openTab('clipboard');
            }

            if (btnDown && (overPopup || overPill)) {
                this._dndHoveringIsland = true;
                if (this._isOpen && this._activeTab !== 'clipboard') {
                    this._switchTab('clipboard', true);
                }
                if (this._clipDropBanner) this._clipDropBanner.visible = true;
            } else if (btnDown) {
                this._dndHoveringIsland = false;
                if (this._clipDropBanner) this._clipDropBanner.visible = false;
            }

            // Mouse button released: finish drag
            if (!btnDown && this._dndStartedWithButton) {
                if (this._dndHoveringIsland && this._pendingDndPaths?.length > 0) {
                    this._pendingDndPaths.forEach(p => this._addFileClipboardItem(p));
                }
                this._pendingDndPaths = null;
                this._dndHoveringIsland = false;
                if (this._clipDropBanner) this._clipDropBanner.visible = false;
                this._dndWatchTimer = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopDndWatch() {
        this._clearTimer('_dndWatchTimer');
        if (this._clipDropBanner) this._clipDropBanner.visible = false;
    }

    _upsertClipItem(newItem, matchFn) {
        const existingIdx = this._clips.findIndex(matchFn);
        let pinned = false;
        if (existingIdx !== -1) {
            pinned = this._clips[existingIdx].pinned;
            this._clips.splice(existingIdx, 1);
        }

        newItem.id = Date.now() + Math.floor(Math.random() * 1000);
        newItem.pinned = pinned;
        newItem.timestamp = newItem.timestamp || Date.now();
        this._clips.unshift(newItem);

        this._pruneClipboardItems();
        this._saveClips();
        if (this._isOpen && this._activeTab === 'clipboard') {
            this._refreshClipboardUI();
        }
    }

    _addScreenshotClipboardItem(path) {
        if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS)) return;
        const name = GLib.path_get_basename(path);
        const cacheDir = `${GLib.get_user_cache_dir()}/angiebar-clipboard`;
        const isFromScreenshotsDir = !path.startsWith(cacheDir);

        if (isFromScreenshotsDir) {
            let targetSize = 0;
            try {
                targetSize = Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null)?.get_size() || 0;
            } catch (e) {}

            const now = Date.now();
            const dupCacheIdx = this._clips.findIndex(c => {
                if (c.kind !== 'screenshot' || !c.path || !c.path.startsWith(cacheDir)) return false;
                const age = Math.abs(now - (c.timestamp || 0));
                if (age > 15000) return false;
                if (targetSize > 0) {
                    try {
                        const sz = Gio.File.new_for_path(c.path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null)?.get_size();
                        if (sz === targetSize) return true;
                    } catch (e) {}
                }
                return false;
            });

            if (dupCacheIdx !== -1) {
                const cachedItem = this._clips[dupCacheIdx];
                this._clips.splice(dupCacheIdx, 1);
                try {
                    Gio.File.new_for_path(cachedItem.path).delete_async(GLib.PRIORITY_LOW, null, null);
                } catch (e) {}
            }
        }

        this._upsertClipItem(
            { text: name, path, kind: 'screenshot' },
            c => c.kind === 'screenshot' && c.path === path
        );
    }

    _addFileClipboardItem(path) {
        if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS)) return;
        const name = GLib.path_get_basename(path);
        const isDir = GLib.file_test(path, GLib.FileTest.IS_DIR);
        let sizeStr = isDir ? 'Folder' : 'File';
        try {
            if (!isDir) {
                const info = Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
                const bytes = info.get_size();
                if (bytes < 1024) sizeStr = `${bytes} B`;
                else if (bytes < 1048576) sizeStr = `${(bytes / 1024).toFixed(1)} KB`;
                else sizeStr = `${(bytes / 1048576).toFixed(1)} MB`;
            }
        } catch (e) {}

        this._upsertClipItem(
            { text: name, path, sizeStr, isDir, kind: 'file' },
            c => c.kind === 'file' && c.path === path
        );
    }

    _addClipboardItem(text) {
        if (text.length > 50000) return;
        const isLink = /^https?:\/\/\S+$/i.test(text);
        const isCode = /[{};]\s*$|=>|\b(function|const|let|import|class|def|return)\b/m.test(text);
        const kind = isLink ? 'link' : (isCode ? 'code' : 'text');

        this._upsertClipItem(
            { text, kind },
            c => c.text === text && c.kind === kind
        );
    }

    _pruneClipboardItems() {
        const initialLen = this._clips.length;
        const cacheDir = `${GLib.get_user_cache_dir()}/angiebar-clipboard`;
        const now = Date.now();
        const ttlMs = this._getClipboardTtlMs();

        let shotCount = 0;
        this._clips = this._clips.filter(item => {
            // Verify path existence for screenshots and files
            if (item.kind === 'screenshot' || item.kind === 'file') {
                if (item.path && !GLib.file_test(item.path, GLib.FileTest.IS_DIR) && !GLib.file_test(item.path, GLib.FileTest.EXISTS)) {
                    return false;
                }
            }

            // Expiration after configured TTL: delete unpinned items (in particular screenshots and shelf files)
            if (!item.pinned && ttlMs > 0) {
                const itemTime = Number(item.timestamp) || Number(item.id) || now;
                if (now - itemTime > ttlMs) {
                    if (item.path && item.path.startsWith(cacheDir)) {
                        try { Gio.File.new_for_path(item.path).delete(null); } catch (e) {}
                    }
                    return false;
                }
            }

            // Keep at most 3 unpinned screenshots
            if (item.kind === 'screenshot' && !item.pinned) {
                shotCount++;
                if (shotCount > 3) {
                    if (item.path && item.path.startsWith(cacheDir)) {
                        try { Gio.File.new_for_path(item.path).delete(null); } catch (e) {}
                    }
                    return false;
                }
            }
            return true;
        });

        const pinnedItems = this._clips.filter(c => c.pinned);
        const unpinnedItems = this._clips.filter(c => !c.pinned).slice(0, 26);
        this._clips = [...pinnedItems, ...unpinnedItems];

        return this._clips.length !== initialLen;
    }

    async _loadClips() {
        this._clips = await this._loadJsonFile(this._clipFilePath, []);
        this._syncRecentScreenshots();
        this._refreshClipboardUI();
    }

    async _saveClips() {
        await this._saveJsonFile(this._clipFilePath, this._clips);
    }

    async _promptAddFileToShelf() {
        try {
            const out = await this._ext._execCommandAsync(
                'zenity --file-selection --multiple --separator="\\n" --title="Park file in the Dynamic Island" 2>/dev/null'
            );
            if (!out || !out.trim()) return;
            const paths = out.split('\n').map(s => s.trim()).filter(Boolean);
            paths.forEach(p => this._addFileClipboardItem(p));
        } catch (e) {}
    }

    _copyItemToSystemClipboard(item, badge, defaultTypeText) {
        this._ownClipCopy = true;
        const clip = St.Clipboard.get_default();

        if (item.kind === 'file' && item.path) {
            try {
                const uri = Gio.File.new_for_path(item.path).get_uri();
                const gnomePayload = `copy\n${uri}`;
                const bytes = new GLib.Bytes(new TextEncoder().encode(gnomePayload));
                clip.set_content(St.ClipboardType.CLIPBOARD, 'x-special/gnome-copied-files', bytes);
                badge.set_text('Ready (Ctrl+V) ✓');
                badge.add_style_class_name('copied');
            } catch (e) {}
        } else if (item.kind === 'screenshot' && item.path) {
            try {
                const file = Gio.File.new_for_path(item.path);
                file.load_bytes_async(null, (obj, res) => {
                    try {
                        const [bytes] = obj.load_bytes_finish(res);
                        this._ownClipCopy = true;
                        clip.set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);
                    } catch (e) {}
                });
                badge.set_text('Copied ✓');
                badge.add_style_class_name('copied');
            } catch (e) {}
        } else {
            clip.set_text(St.ClipboardType.CLIPBOARD, item.text);
            badge.set_text('Copied ✓');
            badge.add_style_class_name('copied');
        }

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1100, () => {
            try {
                badge.set_text(defaultTypeText);
                badge.remove_style_class_name('copied');
            } catch (e) {}
            return GLib.SOURCE_REMOVE;
        });
    }

    _buildClipboardPage() {
        const page = new St.BoxLayout({
            style_class: 'di-page di-clipboard-page',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        // Top Search, Filter & "+ File" Bar
        const topBar = new St.BoxLayout({
            style_class: 'di-clip-topbar',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const searchPill = new St.BoxLayout({
            style_class: 'di-search-pill',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        searchPill.add_child(new St.Icon({
            gicon: this._gicon('angie-search-symbolic.svg'),
            icon_size: 13,
            style_class: 'di-search-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._clipSearchEntry = new St.Entry({
            hint_text: 'Search or drop a file here...',
            style_class: 'di-search-entry',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._ext._connect(this._clipSearchEntry.clutter_text, 'text-changed', () => {
            this._clipQuery = this._clipSearchEntry.get_text().trim().toLowerCase();
            this._refreshClipboardUI();
        });
        searchPill.add_child(this._clipSearchEntry);
        topBar.add_child(searchPill);

        // Filter pills: All | Files | Screenshots | Pinned
        this._clipFilterBtns = new Map();
        [
            { id: 'all',         label: 'All' },
            { id: 'files',       label: 'Files' },
            { id: 'screenshots', label: 'Screenshots' },
            { id: 'pinned',      label: 'Pinned' },
        ].forEach(f => {
            const btn = new St.Button({
                label: f.label,
                style_class: f.id === 'all' ? 'di-filter-pill active' : 'di-filter-pill',
                reactive: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._ext._connect(btn, 'clicked', () => {
                this._clipFilter = f.id;
                this._clipFilterBtns.forEach((b, k) => {
                    if (k === f.id) b.add_style_class_name('active');
                    else b.remove_style_class_name('active');
                });
                this._refreshClipboardUI();
            });
            this._clipFilterBtns.set(f.id, btn);
            topBar.add_child(btn);
        });

        // "+ File" button to place files onto the Island shelf
        const addFileBtn = new St.Button({
            label: '+ File',
            style_class: 'di-filter-pill di-add-file-pill',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._ext._connect(addFileBtn, 'clicked', () => this._promptAddFileToShelf());
        topBar.add_child(addFileBtn);

        const clearBtn = this._makeRoundIconBtn('angie-trash-symbolic.svg', 'di-header-icon-btn', () => {
            const cacheDir = `${GLib.get_user_cache_dir()}/angiebar-clipboard`;
            this._clips.forEach(c => {
                if (!c.pinned && c.path && c.path.startsWith(cacheDir)) {
                    try { Gio.File.new_for_path(c.path).delete(null); } catch (e) {}
                }
            });
            this._clips = this._clips.filter(c => c.pinned);
            this._saveClips();
            this._refreshClipboardUI();
        }, 13);
        topBar.add_child(clearBtn);
        page.add_child(topBar);

        // Visual Drop Banner shown while dragging a file over the Island
        this._clipDropBanner = new St.BoxLayout({
            style_class: 'di-clip-drop-banner',
            visible: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clipDropBanner.add_child(new St.Label({
            text: 'Drop here to park the file in the Dynamic Island',
            style_class: 'di-clip-drop-label',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        page.add_child(this._clipDropBanner);

        // Horizontal Scrollable Cards Strip
        this._clipStrip = new St.BoxLayout({
            style_class: 'di-clip-strip',
            x_expand: true,
            y_expand: true,
        });
        this._clipScroll = new St.ScrollView({
            style_class: 'di-clip-scroll',
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
        });
        this._clipScroll.set_child(this._clipStrip);
        this._ext._connect(this._clipScroll, 'scroll-event', (_actor, event) => {
            const dir = event.get_scroll_direction();
            const adj = this._clipScroll.hadjustment || this._clipScroll.hscroll?.adjustment;
            if (!adj) return Clutter.EVENT_PROPAGATE;
            if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT) {
                adj.value = Math.max(adj.lower, adj.value - 90);
                return Clutter.EVENT_STOP;
            } else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT) {
                adj.value = Math.min(adj.upper - adj.page_size, adj.value + 90);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        page.add_child(this._clipScroll);
        return page;
    }

    _refreshClipboardUI() {
        if (!this._clipStrip) return;
        if (this._pruneClipboardItems()) {
            this._saveClips();
        }
        this._clipStrip.destroy_all_children();

        const filtered = this._clips.filter(item => {
            if (this._clipFilter === 'pinned' && !item.pinned) return false;
            if (this._clipFilter === 'files' && item.kind !== 'file') return false;
            if (this._clipFilter === 'screenshots' && item.kind !== 'screenshot') return false;
            if (this._clipFilter === 'links' && item.kind !== 'link') return false;
            if (this._clipQuery && !(item.text || '').toLowerCase().includes(this._clipQuery)) return false;
            return true;
        });

        if (filtered.length === 0) {
            const emptyBox = new St.BoxLayout({
                style_class: 'di-empty-box',
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            emptyBox.add_child(new St.Label({
                text: this._clipQuery ? 'No items found' : 'Clipboard and file shelf are empty',
                style_class: 'di-empty-title',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            emptyBox.add_child(new St.Label({
                text: 'Drop a file on the Island, take a screenshot, or press Ctrl+C',
                style_class: 'di-empty-sub',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            this._clipStrip.add_child(emptyBox);
            return;
        }

        filtered.slice(0, 24).forEach(item => {
            const card = new St.BoxLayout({
                style_class: item.pinned ? 'di-clip-card pinned' : 'di-clip-card',
                orientation: Clutter.Orientation.VERTICAL,
                reactive: true,
                track_hover: true,
            });

            // Card Header: Type badge + Action buttons
            const cardHead = new St.BoxLayout({
                style_class: 'di-clip-card-head',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const typeMap = {
                screenshot: 'Screenshot',
                file: item.isDir ? 'Folder' : 'File',
                link: 'Link',
                code: 'Code',
                text: 'Text',
            };
            const typeText = typeMap[item.kind] || 'Text';
            const badge = new St.Label({
                text: typeText,
                style_class: `di-clip-badge ${item.kind}`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            cardHead.add_child(badge);
            cardHead.add_child(new St.Widget({ x_expand: true }));

            const pinBtn = this._makeRoundIconBtn(
                'angie-pin-symbolic.svg',
                'di-clip-mini-btn',
                () => {
                    item.pinned = !item.pinned;
                    this._clips.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
                    this._saveClips();
                    this._refreshClipboardUI();
                },
                11
            );
            const delBtn = this._makeRoundIconBtn(
                'angie-close-symbolic.svg',
                'di-clip-mini-btn',
                () => {
                    this._clips = this._clips.filter(c => c.id !== item.id);
                    this._saveClips();
                    this._refreshClipboardUI();
                },
                11
            );
            cardHead.add_child(pinBtn);
            cardHead.add_child(delBtn);
            card.add_child(cardHead);

            // Card Body depending on item kind (Screenshot thumbnail, File shelf card, or Text/Link/Code)
            let bodyChild;
            if (item.kind === 'screenshot' && item.path) {
                const thumbBin = new St.Bin({
                    style_class: 'di-clip-shot-thumb',
                    x_expand: true,
                    y_expand: true,
                    style: `background-image: url('file://${item.path}'); background-size: cover; background-position: center;`,
                });
                bodyChild = thumbBin;
            } else if (item.kind === 'file' && item.path) {
                const fileBox = new St.BoxLayout({
                    style_class: 'di-clip-file-box',
                    x_expand: true,
                    y_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                const isImg = /\.(png|jpe?g|webp|gif|svg)$/i.test(item.path);
                if (isImg) {
                    const miniThumb = new St.Bin({
                        style_class: 'di-clip-file-thumb',
                        y_align: Clutter.ActorAlign.CENTER,
                        style: `background-image: url('file://${item.path}'); background-size: cover; background-position: center;`,
                    });
                    fileBox.add_child(miniThumb);
                } else {
                    const fIcon = new St.Icon({
                        icon_name: item.isDir ? 'folder-symbolic' : 'text-x-generic-symbolic',
                        icon_size: 22,
                        style_class: 'di-clip-file-icon',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    fileBox.add_child(fIcon);
                }

                const metaCol = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                const nameLbl = new St.Label({
                    text: item.text,
                    style_class: 'di-clip-file-name',
                });
                nameLbl.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
                const subLbl = new St.Label({
                    text: `${item.sizeStr || 'File'} · Clicca per incollare`,
                    style_class: 'di-clip-file-sub',
                });
                subLbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                metaCol.add_child(nameLbl);
                metaCol.add_child(subLbl);
                fileBox.add_child(metaCol);
                bodyChild = fileBox;
            } else {
                const previewText = (item.text || '').replace(/\s+/g, ' ').slice(0, 90);
                const bodyLabel = new St.Label({
                    text: previewText,
                    style_class: item.kind === 'code' ? 'di-clip-text code' : 'di-clip-text',
                    x_expand: true,
                    y_expand: true,
                });
                bodyLabel.clutter_text.line_wrap = true;
                bodyLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                bodyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                bodyChild = bodyLabel;
            }

            const copyTargetBtn = new St.Button({
                style_class: 'di-clip-body-btn',
                child: bodyChild,
                x_expand: true,
                y_expand: true,
                reactive: true,
            });
            this._ext._connect(copyTargetBtn, 'clicked', () => {
                this._copyItemToSystemClipboard(item, badge, typeText);
            });

            card.add_child(copyTargetBtn);
            this._clipStrip.add_child(card);
        });
    }

    // =========================================================================
    // 5. PAGE: TO-DO LIST (shares data with the panel todo module)
    // =========================================================================

    openTab(tabId) {
        this._cancelOpenTimer();
        this._cancelCloseTimer();
        this._activeTab = tabId;
        this._forcedTab = true;
        if (this._isOpen) this._switchTab(tabId, true);
        else this.open(false);
    }

    // =========================================================================
    // PAGE: NOTIFICHE (GNOME message tray)
    // =========================================================================

    _getAllNotifications() {
        const out = [];
        try {
            Main.messageTray.getSources().forEach(source => {
                (source.notifications || []).forEach(n => out.push({ source, n }));
            });
        } catch (e) {}
        out.sort((a, b) => (b.n.datetime?.to_unix?.() ?? 0) - (a.n.datetime?.to_unix?.() ?? 0));
        return out;
    }

    _initNotificationWatch() {
        this._notifSourceSignals = new Map();
        const tray = Main.messageTray;
        const watchSource = (source) => {
            if (this._notifSourceSignals.has(source)) return;
            const ids = [];
            ['notification-added', 'notification-removed', 'notify::count'].forEach(sig => {
                try {
                    ids.push(source.connect(sig, (_s, n) => {
                        this._onNotificationsChanged();
                        if (sig === 'notification-added' && n) this._showNotifIsland(source, n);
                    }));
                } catch (e) {}
            });
            this._notifSourceSignals.set(source, ids);
        };
        try {
            tray.getSources().forEach(watchSource);
            this._traySignals = [
                tray.connect('source-added', (_t, source) => { watchSource(source); this._onNotificationsChanged(); }),
                tray.connect('source-removed', (_t, source) => {
                    const ids = this._notifSourceSignals.get(source);
                    if (ids) ids.forEach(id => { try { source.disconnect(id); } catch (e) {} });
                    this._notifSourceSignals.delete(source);
                    this._onNotificationsChanged();
                }),
            ];
        } catch (e) {
            this._traySignals = [];
        }
        try {
            this._notifSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
            this._notifSettingsId = this._notifSettings.connect('changed::show-banners', () => this._refreshNotificationsUI());
        } catch (e) { this._notifSettings = null; }
    }

    _disconnectNotificationWatch() {
        if (this._traySignals) this._traySignals.forEach(id => { try { Main.messageTray.disconnect(id); } catch (e) {} });
        this._traySignals = [];
        if (this._notifSourceSignals) {
            this._notifSourceSignals.forEach((ids, source) => ids.forEach(id => { try { source.disconnect(id); } catch (e) {} }));
            this._notifSourceSignals.clear();
        }
        if (this._notifSettings && this._notifSettingsId) this._notifSettings.disconnect(this._notifSettingsId);
        this._notifSettingsId = 0;
    }

    // -------------------------------------------------------------------------
    // Notification "peek": the clock pill grows into a notification card, then
    // shrinks back. Replaces the default GNOME banner.
    // -------------------------------------------------------------------------

    _buildNotifIsland() {
        this._notifIsland = new St.Button({
            style_class: 'di-notif-island',
            reactive: true,
            track_hover: true,
            can_focus: false,
            visible: false,
            opacity: 0,
        });
        this._notifIsland.set_pivot_point(0.5, 0.0);

        this._notifIslandContent = new St.BoxLayout({
            style_class: 'di-notif-island-content',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._notifIslandIconBox = new St.Bin({
            style_class: 'di-notif-island-icon-box',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._notifIslandIcon = new St.Icon({
            icon_size: 20,
            style_class: 'di-notif-island-icon',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._notifIslandIconBox.set_child(this._notifIslandIcon);

        const col = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'di-notif-island-col',
        });
        this._notifIslandApp = new St.Label({ style_class: 'di-notif-island-app' });
        this._notifIslandTitle = new St.Label({ style_class: 'di-notif-island-title' });
        this._notifIslandBody = new St.Label({ style_class: 'di-notif-island-body' });
        [this._notifIslandApp, this._notifIslandTitle, this._notifIslandBody].forEach(l => {
            l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            col.add_child(l);
        });

        this._notifIslandCloseBtn = new St.Button({
            style_class: 'di-notif-island-close-btn',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 11,
            }),
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            track_hover: true,
        });
        this._ext._connect(this._notifIslandCloseBtn, 'clicked', () => {
            this._hideNotifIsland();
        });

        this._notifIslandContent.add_child(this._notifIslandIconBox);
        this._notifIslandContent.add_child(col);
        this._notifIslandContent.add_child(this._notifIslandCloseBtn);

        this._notifIsland.set_child(this._notifIslandContent);

        this._ext._connect(this._notifIsland, 'clicked', () => {
            const n = this._notifIslandCurrent;
            this._hideNotifIsland();
            if (n) { try { n.activate(); } catch (e) {} }
        });
        this._ext._connect(this._notifIsland, 'enter-event', () => {
            this._clearTimer('_notifHideTimer');
            return Clutter.EVENT_PROPAGATE;
        });
        this._ext._connect(this._notifIsland, 'leave-event', () => {
            if (this._notifIslandShown) this._scheduleNotifHide(800);
            return Clutter.EVENT_PROPAGATE;
        });

        Main.layoutManager.addTopChrome(this._notifIsland);

        // Hide/restore the stock GNOME banner depending on the setting
        this._applyStockBannerMode();
        if (this._settings) {
            try { this._pillNotifSig = this._settings.connect('changed::di-pill-notifications', () => this._applyStockBannerMode()); } catch (e) {}
        }
    }

    _pillNotifEnabled() {
        try { return this._settings ? this._settings.get_boolean('di-pill-notifications') : true; } catch (e) { return true; }
    }

    _applyStockBannerMode() {
        try {
            const tray = Main.messageTray;
            if (!tray) return;
            const pillNotif = this._pillNotifEnabled();

            // 1. Tell GNOME Shell message tray to block all banners
            tray.bannerBlocked = pillNotif;

            // 2. Intercept _showNotification on MessageTray as fail-safe
            if (pillNotif) {
                if (!this._origShowNotification && typeof tray._showNotification === 'function') {
                    this._origShowNotification = tray._showNotification;
                    tray._showNotification = () => {
                        if (this._pillNotifEnabled()) {
                            // Acknowledge notification in tray queue so it doesn't pile up
                            const n = tray._notificationQueue?.shift?.();
                            if (n) n.acknowledged = true;
                            tray.emit('queue-changed');
                            return;
                        }
                        this._origShowNotification.call(tray);
                    };
                }
            } else {
                if (this._origShowNotification) {
                    tray._showNotification = this._origShowNotification;
                    this._origShowNotification = null;
                }
            }

            // 3. Hide bannerBin actor completely
            if (tray._bannerBin) {
                tray._bannerBin.visible = !pillNotif;
                tray._bannerBin.opacity = pillNotif ? 0 : 255;
            }
            if (pillNotif) {
                tray.visible = false;
                tray.opacity = 0;
            } else {
                tray.visible = true;
                tray.opacity = 255;
            }

            this._bannerHidden = pillNotif;
        } catch (e) {
            console.error('[AngieBar] Error in _applyStockBannerMode:', e.message);
        }
    }

    _notifBannersEnabled() {
        try {
            return this._notifSettings ? this._notifSettings.get_boolean('show-banners') : true;
        } catch (e) { return true; }
    }

    _showNotifIsland(source, n) {
        if (!this._notifIsland || !this._popup) return;
        if (!this._pillNotifEnabled() || !this._notifBannersEnabled()) return;
        if (Main.sessionMode.isLocked) return;
        // Popup open: the notification is already visible in the list
        if (this._isOpen) return;

        const pill = this._ext._centerIsland;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        // Fill content
        let gicon = null;
        try { gicon = n.gicon || source.icon; } catch (e) {}
        this._notifIslandIcon.gicon = gicon || new Gio.ThemedIcon({ name: 'preferences-system-notifications-symbolic' });

        const appName = (source.title || '').trim();
        const titleText = (n.title || '').trim();
        const bodyText = (n.body || '')
            .replace(/<[^>]*>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ').trim();

        this._notifIslandApp.text = (appName || 'NOTIFICATION').toUpperCase();
        this._notifIslandTitle.text = titleText || appName || '';
        this._notifIslandBody.text = bodyText;
        this._notifIslandBody.visible = bodyText.length > 0;
        this._notifIslandCurrent = n;

        // Same background as the bar pills
        const color = this._settings?.get_string('custom-color');
        const opacity = this._settings ? Math.max(0.94, this._settings.get_double('island-opacity')) : 0.94;
        const bg = this._ext._colorWithOpacity ? this._ext._colorWithOpacity(color, opacity) : `rgba(30, 32, 36, ${opacity})`;
        this._notifIsland.set_style(`background-color: ${bg};`);

        const WIDTH = 380;
        this._notifIsland.set_width(WIDTH);

        let centerX = monitor.x + Math.floor(monitor.width / 2);
        let topY = monitor.y + 4;
        if (pill && pill.visible) {
            const [ix, iy] = pill.get_transformed_position();
            const [iw] = pill.get_transformed_size();
            if (iw > 0) {
                centerX = Math.floor(ix + iw / 2);
                topY = Math.floor(iy); // Align with center island top
            }
        }
        const targetX = Math.max(monitor.x + 12, Math.min(monitor.x + monitor.width - WIDTH - 12, Math.floor(centerX - WIDTH / 2)));
        this._notifIsland.set_position(targetX, topY);

        const wasShown = this._notifIslandShown;
        this._clearTimer('_notifHideTimer');
        this._clearTimer('_notifFinishTimer');
        this._notifIslandShown = true;
        const isl = this._notifIsland;
        const content = this._notifIslandContent;

        isl.visible = true;
        isl.remove_all_transitions();
        content.remove_all_transitions();

        if (this._ext._centerIsland) {
            this._ext._centerIsland.add_style_class_name('island-expanded-open');
        }

        if (wasShown) {
            // Already visible: quick smooth content bump
            content.opacity = 0;
            content.translation_y = -3;
            content.ease({
                opacity: 255,
                translation_y: 0,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            // Smooth natural expansion (matching AngieBar's popup island open animation)
            isl.set_pivot_point(0.5, 0.0);
            isl.opacity = 0;
            isl.scale_x = 0.86;
            isl.scale_y = 0.78;
            isl.translation_y = -6;

            content.opacity = 0;
            content.translation_y = -4;

            isl.ease({
                opacity: 255,
                scale_x: 1.0,
                scale_y: 1.0,
                translation_y: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });

            content.ease({
                opacity: 255,
                translation_y: 0,
                delay: 30,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            if (pill) {
                pill.remove_all_transitions();
                pill.ease({
                    opacity: 0,
                    duration: 90,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }

        // Auto-hide after 2.2 seconds
        this._scheduleNotifHide(2200);
    }

    _scheduleNotifHide(ms) {
        this._clearTimer('_notifHideTimer');
        this._notifHideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._notifHideTimer = 0;
            this._hideNotifIsland();
            return GLib.SOURCE_REMOVE;
        });
    }

    _hideNotifIsland() {
        this._clearTimer('_notifHideTimer');
        if (!this._notifIsland || !this._notifIslandShown) return;
        this._notifIslandShown = false;
        this._notifIslandCurrent = null;

        const pill = this._ext._centerIsland;
        const isl = this._notifIsland;
        const content = this._notifIslandContent;

        // 1. Content fades out quickly
        content.remove_all_transitions();
        content.ease({
            opacity: 0,
            translation_y: -4,
            duration: 90,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // 2. Island smoothly shrinks back up into top center (matching AngieBar's popup island close animation)
        isl.remove_all_transitions();
        isl.set_pivot_point(0.5, 0.0);
        isl.ease({
            scale_x: 0.86,
            scale_y: 0.78,
            translation_y: -6,
            opacity: 0,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => this._finishNotifIsland(),
        });

        // 3. Clock pill restores smoothly
        if (pill && !this._isOpen) {
            pill.remove_all_transitions();
            pill.set_pivot_point(0.5, 0.5);
            pill.ease({
                opacity: 255,
                scale_x: 1.0,
                scale_y: 1.0,
                delay: 20,
                duration: 130,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        this._clearTimer('_notifFinishTimer');
        this._notifFinishTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 220, () => {
            this._notifFinishTimer = 0;
            if (!this._notifIslandShown) this._finishNotifIsland();
            return GLib.SOURCE_REMOVE;
        });
    }

    _finishNotifIsland() {
        if (this._notifIslandShown || !this._notifIsland) return;
        this._notifIsland.remove_all_transitions();
        this._notifIslandContent.remove_all_transitions();
        this._notifIsland.visible = false;
        this._notifIsland.opacity = 0;
        this._notifIsland.scale_x = 1.0;
        this._notifIsland.scale_y = 1.0;
        this._notifIsland.translation_y = 0;
        if (this._ext._centerIsland) {
            this._ext._centerIsland.remove_style_class_name('island-expanded-open');
            if (!this._isOpen) {
                this._ext._centerIsland.remove_all_transitions();
                this._ext._centerIsland.opacity = 255;
                this._ext._centerIsland.scale_x = 1.0;
                this._ext._centerIsland.scale_y = 1.0;
            }
        }
    }

    _destroyNotifIsland() {
        this._clearTimer('_notifHideTimer');
        this._clearTimer('_notifFinishTimer');
        this._notifIslandShown = false;
        if (this._pillNotifSig && this._settings) {
            try { this._settings.disconnect(this._pillNotifSig); } catch (e) {}
            this._pillNotifSig = 0;
        }
        try {
            const tray = Main.messageTray;
            if (tray) {
                if (this._origShowNotification) {
                    tray._showNotification = this._origShowNotification;
                    this._origShowNotification = null;
                }
                tray.bannerBlocked = false;
                if (tray._bannerBin) {
                    tray._bannerBin.visible = true;
                    tray._bannerBin.opacity = 255;
                }
                tray.visible = true;
                tray.opacity = 255;
            }
        } catch (e) {}
        this._bannerHidden = false;
        if (this._notifIsland) {
            try { Main.layoutManager.removeChrome(this._notifIsland); } catch (e) {}
            try { this._notifIsland.destroy(); } catch (e) {}
            this._notifIsland = null;
        }
    }

    _onNotificationsChanged() {
        if (this._notifRefreshId) return;
        // Coalesce bursts of signals
        this._notifRefreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._notifRefreshId = 0;
            this._refreshNotificationsUI();
            return GLib.SOURCE_REMOVE;
        });
    }

    _buildNotificationsPage() {
        const page = new St.BoxLayout({
            style_class: 'di-page di-notif-page',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        const topBar = new St.BoxLayout({ style_class: 'di-clip-topbar', x_expand: true });
        this._notifTitle = new St.Label({
            text: 'Notifications',
            style_class: 'di-notif-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        topBar.add_child(this._notifTitle);

        this._dndBtn = new St.Button({
            style_class: 'di-filter-pill',
            label: 'Do not disturb',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            track_hover: true,
        });
        this._ext._connect(this._dndBtn, 'clicked', () => {
            if (!this._notifSettings) return;
            this._notifSettings.set_boolean('show-banners', !this._notifSettings.get_boolean('show-banners'));
        });
        topBar.add_child(this._dndBtn);

        const clearBtn = new St.Button({
            style_class: 'di-filter-pill',
            label: 'Clear all',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            track_hover: true,
        });
        this._ext._connect(clearBtn, 'clicked', () => {
            this._getAllNotifications().forEach(({ n }) => { try { n.destroy(); } catch (e) {} });
            this._refreshNotificationsUI();
        });
        topBar.add_child(clearBtn);
        page.add_child(topBar);

        this._notifList = new St.BoxLayout({ style_class: 'di-notif-list', orientation: Clutter.Orientation.VERTICAL, x_expand: true });
        const scroll = new St.ScrollView({
            style_class: 'di-todo-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });
        scroll.set_child(this._notifList);
        page.add_child(scroll);

        this._initNotificationWatch();
        return page;
    }

    _refreshNotificationsUI() {
        if (!this._notifList) return;
        const items = this._getAllNotifications();
        this._notifTitle.set_text(items.length ? `Notifications · ${items.length}` : 'Notifications');

        const dnd = this._notifSettings ? !this._notifSettings.get_boolean('show-banners') : false;
        if (dnd) this._dndBtn.add_style_class_name('active');
        else this._dndBtn.remove_style_class_name('active');

        if (this._activeTab !== 'notifications' && this._notifList.get_n_children() > 0 && this._lastNotifCount === items.length)
            return;
        this._lastNotifCount = items.length;
        this._notifList.destroy_all_children();

        if (items.length === 0) {
            const emptyBox = new St.BoxLayout({ style_class: 'di-empty-box', orientation: Clutter.Orientation.VERTICAL, x_expand: true, x_align: Clutter.ActorAlign.CENTER });
            emptyBox.add_child(new St.Label({ text: 'No notifications', style_class: 'di-empty-title', x_align: Clutter.ActorAlign.CENTER }));
            emptyBox.add_child(new St.Label({ text: dnd ? 'Do not disturb is active' : '', visible: dnd, style_class: 'di-empty-sub', x_align: Clutter.ActorAlign.CENTER }));
            this._notifList.add_child(emptyBox);
            return;
        }

        items.slice(0, 30).forEach(({ source, n }) => {
            const row = new St.BoxLayout({ style_class: 'di-notif-row', x_expand: true, reactive: true, track_hover: true });

            const gicon = n.gicon || source.icon || new Gio.ThemedIcon({ name: 'preferences-system-notifications-symbolic' });
            row.add_child(new St.Icon({ gicon, icon_size: 24, style_class: 'di-notif-icon', y_align: Clutter.ActorAlign.CENTER }));

            const textCol = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
            const head = new St.BoxLayout({ x_expand: true });
            const app = new St.Label({ text: source.title || 'App', style_class: 'di-notif-app', x_expand: true });
            head.add_child(app);
            const dt = n.datetime;
            if (dt) head.add_child(new St.Label({ text: dt.format('%H:%M'), style_class: 'di-notif-time' }));
            textCol.add_child(head);

            const title = new St.Label({ text: n.title || '', style_class: 'di-notif-summary' });
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            textCol.add_child(title);
            const bodyText = (n.body || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            if (bodyText) {
                const body = new St.Label({ text: bodyText, style_class: 'di-notif-body' });
                body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                textCol.add_child(body);
            }

            const openBtn = new St.Button({ child: textCol, x_expand: true, reactive: true, style_class: 'di-todo-toggle' });
            this._ext._connect(openBtn, 'clicked', () => {
                try { n.activate(); } catch (e) {}
                this.close();
            });
            row.add_child(openBtn);

            row.add_child(this._makeRoundIconBtn('angie-close-symbolic.svg', 'di-clip-mini-btn', () => {
                try { n.destroy(); } catch (e) {}
                this._refreshNotificationsUI();
            }, 11));
            this._notifList.add_child(row);
        });
    }

    _buildTodoPage() {
        const page = new St.BoxLayout({
            style_class: 'di-page di-todo-page',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        // null = topics (folders) view, string = tasks of that topic
        this._todoTopic = null;

        const topBar = new St.BoxLayout({
            style_class: 'di-clip-topbar',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._todoBackBtn = new St.Button({
            style_class: 'di-header-icon-btn',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 13, style_class: 'di-header-btn-icon' }),
        });
        this._ext._connect(this._todoBackBtn, 'clicked', () => {
            this._todoTopic = null;
            this._refreshTodoUI();
        });
        topBar.add_child(this._todoBackBtn);

        this._todoTitleLabel = new St.Label({
            text: 'Topics',
            style_class: 'di-todo-topic-title',
            y_align: Clutter.ActorAlign.CENTER,
        });
        topBar.add_child(this._todoTitleLabel);

        const inputPill = new St.BoxLayout({
            style_class: 'di-search-pill',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._todoEntryIcon = new St.Icon({
            gicon: this._gicon('angie-todo-symbolic.svg'),
            icon_size: 13,
            style_class: 'di-search-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        inputPill.add_child(this._todoEntryIcon);
        this._todoEntry = new St.Entry({
            hint_text: 'New topic...',
            style_class: 'di-search-entry',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        inputPill.add_child(this._todoEntry);
        topBar.add_child(inputPill);

        const addAction = () => {
            const text = this._todoEntry.get_text().trim();
            if (!text) return;
            this._todoEntry.set_text('');
            if (this._todoTopic === null) {
                const topics = this._todoTopicsList();
                if (!topics.includes(text)) topics.push(text);
                // If this topic was previously hidden, unhide it when explicitly created/opened
                this._unhideTopic(text);
                this._todoTopic = text;
                this._commitTodos();
                if (typeof this._ext.createGoogleTopicAsync === 'function') {
                    this._ext.createGoogleTopicAsync(text);
                }
            } else {
                this._ext._todos = this._ext._todos || [];
                const newTask = { text, done: false, topic: this._todoTopic };
                this._ext._todos.push(newTask);
                this._commitTodos();
                if (typeof this._ext.createGoogleTaskAsync === 'function') {
                    this._ext.createGoogleTaskAsync(newTask);
                }
            }
        };
        this._ext._connect(this._todoEntry.clutter_text, 'activate', addAction);
        topBar.add_child(this._makeRoundIconBtn('angie-plus-symbolic.svg', 'di-cal-add-btn', addAction, 12));

        this._todoCountLabel = new St.Label({
            text: '0/0',
            style_class: 'di-filter-pill',
            y_align: Clutter.ActorAlign.CENTER,
        });
        topBar.add_child(this._todoCountLabel);

        this._todoSyncBtn = new St.Button({
            style_class: 'di-header-icon-btn',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'view-refresh-symbolic',
                icon_size: 13,
                style_class: 'di-header-btn-icon',
            }),
        });
        this._ext._connect(this._todoSyncBtn, 'clicked', () => {
            if (typeof this._ext.syncGoogleTasks === 'function') {
                this._ext.syncGoogleTasks();
            }
        });
        topBar.add_child(this._todoSyncBtn);

        this._todoClearBtn = this._makeRoundIconBtn('angie-trash-symbolic.svg', 'di-header-icon-btn', () => {
            if (this._todoTopic === null) return;
            const curTopic = this._todoTopic;
            this._ext._todos = (this._ext._todos || []).filter(t => !(t.done && this._todoTopicOf(t) === curTopic));
            this._commitTodos();
            if (typeof this._ext.clearCompletedGoogleTasksAsync === 'function') {
                this._ext.clearCompletedGoogleTasksAsync(curTopic);
            }
        }, 13);
        topBar.add_child(this._todoClearBtn);
        page.add_child(topBar);

        this._todoGoogleBanner = new St.Button({
            style_class: 'di-todo-google-banner',
            visible: false,
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        this._todoGoogleBannerLabel = new St.Label({
            text: '',
            style_class: 'di-todo-google-banner-label',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._todoGoogleBanner.set_child(this._todoGoogleBannerLabel);
        this._ext._connect(this._todoGoogleBanner, 'clicked', () => {
            this.close();
            GLib.spawn_command_line_async('gnome-control-center online-accounts');
        });
        page.add_child(this._todoGoogleBanner);

        this._todoList = new St.BoxLayout({
            style_class: 'di-todo-list',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const scroll = new St.ScrollView({
            style_class: 'di-todo-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });
        scroll.set_child(this._todoList);
        page.add_child(scroll);
        return page;
    }

    _todoTopicOf(task) {
        return task.topic || 'General';
    }

    _todoTopicsList() {
        if (!Array.isArray(this._ext._todoTopics)) this._ext._todoTopics = [];
        const topics = this._ext._todoTopics;
        // Make sure every topic referenced by a task exists as a folder
        (this._ext._todos || []).forEach(t => {
            const tp = this._todoTopicOf(t);
            if (!topics.includes(tp)) topics.push(tp);
        });
        return topics;
    }

    _getHiddenTopicsSet() {
        if (typeof this._ext._getHiddenTodoTopicsSet === 'function') {
            return this._ext._getHiddenTodoTopicsSet();
        }
        try {
            return new Set(this._settings ? (this._settings.get_strv('di-hidden-todo-topics') || []) : []);
        } catch (e) {
            return new Set();
        }
    }

    _unhideTopic(topic) {
        try {
            if (!this._settings) return;
            const cur = this._settings.get_strv('di-hidden-todo-topics') || [];
            if (cur.includes(topic)) {
                this._settings.set_strv('di-hidden-todo-topics', cur.filter(t => t !== topic));
            }
        } catch (e) {}
    }

    _getTopicColor(topic) {
        const map = this._ext._todoTopicColors;
        return (map && typeof map === 'object' && map[topic]) ? map[topic] : null;
    }

    _setTopicColor(topic, color) {
        if (!this._ext._todoTopicColors || typeof this._ext._todoTopicColors !== 'object') {
            this._ext._todoTopicColors = {};
        }
        if (color) {
            this._ext._todoTopicColors[topic] = color;
        } else {
            delete this._ext._todoTopicColors[topic];
        }
    }

    _hexToRgbStr(hex) {
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
        if (!m) return null;
        return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
    }

    _commitTodos() {
        // Persist and refresh both the panel counter and the island page
        if (typeof this._ext._saveTodos === 'function') this._ext._saveTodos();
        if (typeof this._ext._updateTodoUI === 'function') this._ext._updateTodoUI();
        else this._refreshTodoUI();
    }

    _todoEmpty(title, sub) {
        const emptyBox = new St.BoxLayout({
            style_class: 'di-empty-box',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        emptyBox.add_child(new St.Label({ text: title, style_class: 'di-empty-title', x_align: Clutter.ActorAlign.CENTER }));
        emptyBox.add_child(new St.Label({ text: sub, style_class: 'di-empty-sub', x_align: Clutter.ActorAlign.CENTER }));
        this._todoList.add_child(emptyBox);
    }

    _refreshTodoUI() {
        if (!this._todoList) return;
        this._todoList.destroy_all_children();
        const allTodos = this._ext._todos || [];
        const hiddenSet = this._getHiddenTopicsSet();
        const allTopics = this._todoTopicsList();
        const topics = allTopics.filter(t => !hiddenSet.has(t));
        if (this._todoTopic !== null && !topics.includes(this._todoTopic)) this._todoTopic = null;
        const inTopic = this._todoTopic !== null;

        const googleEnabled = Boolean(this._settings?.get_boolean('di-google-tasks-enabled'));
        this._todoBackBtn.visible = inTopic;
        this._todoClearBtn.visible = inTopic;
        if (this._todoSyncBtn) {
            this._todoSyncBtn.visible = !inTopic && googleEnabled;
        }
        if (this._todoGoogleBanner) {
            const showWarn = !inTopic && googleEnabled && Boolean(this._ext._googleNeedsReauth);
            this._todoGoogleBanner.visible = showWarn;
            if (showWarn && this._todoGoogleBannerLabel) {
                this._todoGoogleBannerLabel.set_text(
                    this._ext._googleSyncStatus || 'Click here to re-authenticate Google Tasks in Online Accounts'
                );
            }
        }
        this._todoTitleLabel.set_text(inTopic ? this._todoTopic : 'Topics');
        this._todoEntry.hint_text = inTopic ? 'Add a task...' : 'New topic...';
        this._todoEntryIcon.gicon = this._gicon(inTopic ? 'angie-todo-symbolic.svg' : 'angie-plus-symbolic.svg');

        if (!inTopic) {
            const visibleTodos = allTodos.filter(t => !hiddenSet.has(this._todoTopicOf(t)));
            const totDone = visibleTodos.filter(t => t.done).length;
            this._todoCountLabel.set_text(`${totDone}/${visibleTodos.length}`);
            if (topics.length === 0) {
                this._todoEmpty(
                    allTopics.length > 0 ? 'All lists are hidden' : 'No topics',
                    allTopics.length > 0
                        ? 'You can re-enable them from the Dynamic Island settings'
                        : 'Type a name above and press Enter to create a topic'
                );
                return;
            }
            const palette = [
                '#3584e4', // Blue
                '#2ec27e', // Green
                '#f5c211', // Yellow
                '#ff7800', // Orange
                '#e01b24', // Red
                '#9141ac', // Purple
                '#d56199', // Pink
                '#00b4d8', // Cyan
                '#9a9996', // Gray
            ];
            topics.forEach(topic => {
                const items = allTodos.filter(t => this._todoTopicOf(t) === topic);
                const pending = items.filter(t => !t.done).length;
                const topicColor = this._getTopicColor(topic);
                const rgb = this._hexToRgbStr(topicColor);

                const row = new St.BoxLayout({
                    style_class: 'di-todo-row di-todo-topic-row',
                    x_expand: true,
                    reactive: true,
                    track_hover: true,
                });
                if (rgb) {
                    row.set_style(`background-color: rgba(${rgb}, 0.14); border: 1px solid rgba(${rgb}, 0.38);`);
                }

                const folderIcon = new St.Icon({
                    icon_name: 'folder-symbolic',
                    icon_size: 14,
                    style_class: 'di-todo-topic-icon',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                if (topicColor) {
                    folderIcon.set_style(`color: ${topicColor};`);
                }

                const body = new St.BoxLayout({ x_expand: true, style_class: 'di-todo-body' });
                body.add_child(folderIcon);
                const name = new St.Label({
                    text: topic,
                    style_class: 'di-todo-label',
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                body.add_child(name);
                body.add_child(new St.Label({
                    text: items.length ? `${pending} to do · ${items.length}` : 'empty',
                    style_class: 'di-todo-topic-count',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
                const openBtn = new St.Button({ child: body, x_expand: true, reactive: true, style_class: 'di-todo-toggle' });
                this._ext._connect(openBtn, 'clicked', () => {
                    this._todoColorPickerTopic = null;
                    this._todoTopic = topic;
                    this._refreshTodoUI();
                });

                const onRightClick = (_actor, event) => {
                    if (event.get_button() === 3) {
                        this._todoColorPickerTopic = (this._todoColorPickerTopic === topic) ? null : topic;
                        this._refreshTodoUI();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                };
                this._ext._connect(openBtn, 'button-press-event', onRightClick);
                this._ext._connect(row, 'button-press-event', onRightClick);

                const delBtn = this._makeRoundIconBtn('angie-close-symbolic.svg', 'di-clip-mini-btn', () => {
                    const gListId = this._ext._todoGoogleLists?.[topic];
                    this._ext._todoTopics = this._ext._todoTopics.filter(t => t !== topic);
                    if (this._ext._todoTopicColors) delete this._ext._todoTopicColors[topic];
                    if (this._ext._todoGoogleLists) delete this._ext._todoGoogleLists[topic];
                    if (this._todoColorPickerTopic === topic) this._todoColorPickerTopic = null;
                    this._ext._todos = allTodos.filter(t => this._todoTopicOf(t) !== topic);
                    this._commitTodos();
                    if (typeof this._ext.deleteGoogleTopicAsync === 'function' && gListId) {
                        this._ext.deleteGoogleTopicAsync(topic, gListId);
                    }
                }, 11);

                row.add_child(openBtn);
                row.add_child(delBtn);
                this._todoList.add_child(row);

                if (this._todoColorPickerTopic === topic) {
                    const pickerRow = new St.BoxLayout({
                        style_class: 'di-todo-color-picker',
                        x_expand: true,
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    palette.forEach(hex => {
                        const isSelected = (topicColor === hex);
                        const swatch = new St.Button({
                            style_class: isSelected ? 'di-todo-color-swatch selected' : 'di-todo-color-swatch',
                            style: `background-color: ${hex};`,
                            reactive: true,
                            track_hover: true,
                            y_align: Clutter.ActorAlign.CENTER,
                        });
                        this._ext._connect(swatch, 'clicked', () => {
                            this._setTopicColor(topic, hex);
                            this._todoColorPickerTopic = null;
                            this._commitTodos();
                        });
                        pickerRow.add_child(swatch);
                    });
                    this._todoList.add_child(pickerRow);
                }
            });
            return;
        }

        const todos = allTodos.filter(t => this._todoTopicOf(t) === this._todoTopic);
        const done = todos.filter(t => t.done).length;
        this._todoCountLabel.set_text(`${done}/${todos.length}`);

        if (todos.length === 0) {
            this._todoEmpty('No tasks', 'Type above and press Enter to add one');
            return;
        }

        todos.forEach(task => {
            const row = new St.BoxLayout({
                style_class: task.done ? 'di-todo-row done' : 'di-todo-row',
                x_expand: true,
                reactive: true,
                track_hover: true,
            });

            const check = new St.Button({
                style_class: task.done ? 'di-todo-check checked' : 'di-todo-check',
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
            });
            if (task.done)
                check.set_child(new St.Icon({ gicon: this._gicon('angie-check-symbolic.svg'), icon_size: 10 }));

            const label = new St.Label({
                text: task.text,
                style_class: task.done ? 'di-todo-label done' : 'di-todo-label',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const body = new St.BoxLayout({ x_expand: true, style_class: 'di-todo-body' });
            body.add_child(check);
            body.add_child(label);
            const toggleBtn = new St.Button({ child: body, x_expand: true, reactive: true, style_class: 'di-todo-toggle' });
            const toggle = () => {
                task.done = !task.done;
                this._commitTodos();
                if (typeof this._ext.updateGoogleTaskAsync === 'function') {
                    this._ext.updateGoogleTaskAsync(task);
                }
            };
            this._ext._connect(toggleBtn, 'clicked', toggle);
            this._ext._connect(check, 'clicked', toggle);

            const delBtn = this._makeRoundIconBtn('angie-close-symbolic.svg', 'di-clip-mini-btn', () => {
                const gId = task.googleId;
                const tp = this._todoTopicOf(task);
                const i = this._ext._todos.indexOf(task);
                if (i !== -1) this._ext._todos.splice(i, 1);
                this._commitTodos();
                if (typeof this._ext.deleteGoogleTaskAsync === 'function' && gId) {
                    this._ext.deleteGoogleTaskAsync(tp, gId);
                }
            }, 11);

            row.add_child(toggleBtn);
            row.add_child(delBtn);
            this._todoList.add_child(row);
        });
    }

    // =========================================================================
    // 5. PAGE 3: TIMER POMODORO (ANDROID 17 / PIXEL M3 EXPRESSIVE CARD)
    // =========================================================================

    _buildPomodoroPage() {
        const page = new St.BoxLayout({
            style_class: 'di-page di-pomo-page',
            x_expand: true,
            y_expand: true,
        });

        this._pomoCard = new St.BoxLayout({
            style_class: 'di-pomo-card',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        const card = this._pomoCard;

        // 1. Top Row: Segmented Phase Selector Pills (left) + Duration Steppers (right)
        const topRow = new St.BoxLayout({
            style_class: 'di-pomo-top-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const phaseRow = new St.BoxLayout({
            style_class: 'di-pomo-phase-pills',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pomoPhaseBtns = new Map();
        [
            { id: 'focus',       label: 'Focus' },
            { id: 'short_break', label: 'Break' },
            { id: 'long_break',  label: 'Long' },
        ].forEach(p => {
            const btn = new St.Button({
                label: p.label,
                style_class: p.id === 'focus' ? 'di-pomo-phase-btn active' : 'di-pomo-phase-btn',
                reactive: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._ext._connect(btn, 'clicked', () => this._setPomoPhase(p.id));
            this._pomoPhaseBtns.set(p.id, btn);
            phaseRow.add_child(btn);
        });
        topRow.add_child(phaseRow);
        topRow.add_child(new St.Widget({ x_expand: true }));

        const steppersRow = new St.BoxLayout({
            style_class: 'di-pomo-steppers-row',
            y_align: Clutter.ActorAlign.CENTER,
        });
        steppersRow.add_child(this._buildPomoStepper('Focus', 'workMins', 5, 180, 5));
        steppersRow.add_child(this._buildPomoStepper('Break', 'breakMins', 1, 60, 1));
        topRow.add_child(steppersRow);

        card.add_child(topRow);

        // 2. Middle Row: Giant Expressive Pixel Time Display (left) + "+1:00" & Reset & Squircle Play/Pause (right)
        const midRow = new St.BoxLayout({
            style_class: 'di-pomo-mid-row',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const timeCol = new St.BoxLayout({
            style_class: 'di-pomo-time-col',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._pomoTimeLabel = new St.Label({
            text: '25:00',
            style_class: 'di-pomo-time',
            x_align: Clutter.ActorAlign.START,
        });

        const metaRow = new St.BoxLayout({
            style_class: 'di-pomo-meta-row',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pomoPhaseLabel = new St.Label({
            text: 'Focus Session',
            style_class: 'di-pomo-phase',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pomoSessionLabel = new St.Label({
            text: '· 0 cycles',
            style_class: 'di-pomo-sessions',
            y_align: Clutter.ActorAlign.CENTER,
        });
        metaRow.add_child(this._pomoPhaseLabel);
        metaRow.add_child(this._pomoSessionLabel);

        timeCol.add_child(this._pomoTimeLabel);
        timeCol.add_child(metaRow);
        midRow.add_child(timeCol);

        // Right Action Group: "+1:00" pill + Reset round button + Pixel Squircle Play/Pause button
        const actionRow = new St.BoxLayout({
            style_class: 'di-pomo-actions-row',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const addMinBtn = new St.Button({
            label: '+1:00',
            style_class: 'di-pomo-addmin-pill',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._ext._connect(addMinBtn, 'clicked', () => {
            this._pomo.remainingSec += 60;
            this._pomo.totalSec = Math.max(this._pomo.totalSec, this._pomo.remainingSec);
            this._refreshPomodoroUI();
        });
        actionRow.add_child(addMinBtn);

        const resetBtn = this._makeRoundIconBtn(
            'angie-reset-symbolic.svg',
            'di-pomo-reset-btn',
            () => this._resetPomodoro(),
            15
        );
        actionRow.add_child(resetBtn);

        this._pomoStartBtn = new St.Button({
            style_class: 'di-pomo-start-pill',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pomoStartIcon = new St.Icon({
            gicon: this._gicon('angie-play-symbolic.svg'),
            icon_size: 20,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pomoStartBtn.set_child(this._pomoStartIcon);
        this._ext._connect(this._pomoStartBtn, 'clicked', () => this._togglePomodoro());
        actionRow.add_child(this._pomoStartBtn);

        midRow.add_child(actionRow);
        card.add_child(midRow);

        // 3. Bottom Row: Pixel Serpentine Wave Progress Bar with Vertical Pill Thumb
        const botRow = new St.BoxLayout({
            style_class: 'di-pomo-bot-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pomoRingArea = new St.DrawingArea({
            style_class: 'di-pomo-scrubber',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._ext._connect(this._pomoRingArea, 'repaint', (area) => this._paintPomoRing(area));
        botRow.add_child(this._pomoRingArea);
        card.add_child(botRow);

        page.add_child(card);
        return page;
    }

    _initPomoSettings() {
        if (!this._settings) return;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const schema = this._settings.settings_schema;
        const hasKey = (k) => schema && schema.has_key(k);

        const syncFromSettings = (changedKey = null) => {
            if (this._syncingPomoSetting) return;
            try {
                if (hasKey('pomodoro-work-mins'))
                    this._pomo.workMins = clamp(this._settings.get_int('pomodoro-work-mins'), 5, 180);
                if (hasKey('pomodoro-break-mins'))
                    this._pomo.breakMins = clamp(this._settings.get_int('pomodoro-break-mins'), 1, 60);
                if (hasKey('pomodoro-long-break-mins'))
                    this._pomo.longBreakMins = clamp(this._settings.get_int('pomodoro-long-break-mins'), 5, 90);
                if (hasKey('pomodoro-cycles-before-long'))
                    this._pomo.cyclesBeforeLong = clamp(this._settings.get_int('pomodoro-cycles-before-long'), 1, 10);
                if (hasKey('pomodoro-auto-start-break'))
                    this._pomo.autoStartBreak = this._settings.get_boolean('pomodoro-auto-start-break');
                if (hasKey('pomodoro-auto-start-focus'))
                    this._pomo.autoStartFocus = this._settings.get_boolean('pomodoro-auto-start-focus');
                if (hasKey('pomodoro-break-color')) {
                    const col = (this._settings.get_string('pomodoro-break-color') || '#2ec27e').trim();
                    this._pomo.breakColor = /^#[0-9a-f]{6}$/i.test(col) ? col : '#2ec27e';
                }
            } catch (e) {}

            if (this._stepperValueLabels) {
                if (this._stepperValueLabels.workMins)
                    this._stepperValueLabels.workMins.set_text(`${this._pomo.workMins}m`);
                if (this._stepperValueLabels.breakMins)
                    this._stepperValueLabels.breakMins.set_text(`${this._pomo.breakMins}m`);
            }

            if (!this._pomo.running && (!changedKey || changedKey.startsWith('pomodoro-') && changedKey.endsWith('-mins'))) {
                const mins = this._pomo.phase === 'focus'
                    ? this._pomo.workMins
                    : (this._pomo.phase === 'short_break' ? this._pomo.breakMins : this._pomo.longBreakMins);
                this._pomo.totalSec = mins * 60;
                this._pomo.remainingSec = mins * 60;
            }
            this._refreshPomodoroUI();
        };

        syncFromSettings(null);

        const keys = [
            'pomodoro-work-mins',
            'pomodoro-break-mins',
            'pomodoro-long-break-mins',
            'pomodoro-cycles-before-long',
            'pomodoro-auto-start-break',
            'pomodoro-auto-start-focus',
            'pomodoro-break-color',
        ];
        keys.forEach(k => {
            if (hasKey(k)) {
                this._pomoSettingSignals.push(
                    this._settings.connect(`changed::${k}`, () => syncFromSettings(k))
                );
            }
        });
    }

    _savePomoDurationSetting(key, val) {
        if (!this._settings) return;
        const map = {
            workMins: 'pomodoro-work-mins',
            breakMins: 'pomodoro-break-mins',
            longBreakMins: 'pomodoro-long-break-mins',
        };
        const gkey = map[key];
        if (!gkey || !this._settings.settings_schema?.has_key(gkey)) return;
        this._syncingPomoSetting = true;
        try {
            this._settings.set_int(gkey, val);
        } catch (e) {}
        this._syncingPomoSetting = false;
    }

    _buildPomoStepper(title, key, min, max, step) {
        const pill = new St.BoxLayout({
            style_class: 'di-stepper-pill',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const nameLbl = new St.Label({
            text: title,
            style_class: 'di-stepper-title',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const valLbl = new St.Label({
            text: `${this._pomo[key]}m`,
            style_class: 'di-stepper-val',
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (!this._stepperValueLabels) this._stepperValueLabels = {};
        this._stepperValueLabels[key] = valLbl;

        const update = (newVal) => {
            this._pomo[key] = newVal;
            valLbl.set_text(`${this._pomo[key]}m`);
            this._savePomoDurationSetting(key, newVal);
            if (!this._pomo.running) {
                this._setPomoPhase(this._pomo.phase);
            }
        };

        const minusBtn = this._makeRoundIconBtn('angie-minus-symbolic.svg', 'di-stepper-btn', () => {
            update(Math.max(min, this._pomo[key] - step));
        }, 10);
        const plusBtn = this._makeRoundIconBtn('angie-plus-symbolic.svg', 'di-stepper-btn', () => {
            update(Math.min(max, this._pomo[key] + step));
        }, 10);

        pill.add_child(nameLbl);
        pill.add_child(minusBtn);
        pill.add_child(valLbl);
        pill.add_child(plusBtn);
        return pill;
    }

    _pomoAccentColors() {
        const isBreak = this._pomo.phase !== 'focus';
        if (!isBreak) {
            const hex = this._accentHex || '#3584e4';
            const rgb = this._accentRgb || [53, 132, 228];
            return { isBreak: false, hex, rgb };
        }
        let hex = (this._pomo.breakColor || '#2ec27e').trim();
        if (!/^#[0-9a-f]{6}$/i.test(hex)) hex = '#2ec27e';
        return { isBreak: true, hex, rgb: hexToRgb(hex) };
    }

    _paintPomoRing(area) {
        const frac = this._pomo.totalSec > 0
            ? Math.max(0, Math.min(1, 1 - this._pomo.remainingSec / this._pomo.totalSec))
            : 0;
        const { rgb } = this._pomoAccentColors();
        this._paintWaveScrubber(area, frac, this._pomoWavePhase || 0, rgb.map(c => c / 255));
    }

    _updatePomoWaveState() {
        if (this._isOpen && this._activeTab === 'pomodoro' && this._pomo.running) {
            this._startWaveTimer(
                '_pomoWaveTimer',
                '_pomoWavePhase',
                '_pomoRingArea',
                () => this._isOpen && this._activeTab === 'pomodoro' && this._pomo.running
            );
        } else {
            this._stopPomoWave();
        }
    }

    _stopPomoWave() {
        this._stopWaveTimer('_pomoWaveTimer');
    }

    _startPomoInterval() {
        this._clearTimer('_pomoTimerId');
        this._pomoTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (!this._pomo.running) {
                this._pomoTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._pomo.remainingSec = Math.max(0, this._pomo.remainingSec - 1);
            this._refreshPomodoroUI();
            if (this._pomo.remainingSec <= 0) {
                this._pomoTimerId = 0;
                this._onPomodoroFinished();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _setPomoPhase(phase, autoStart = false) {
        this._pomo.phase = phase;
        this._pomo.running = Boolean(autoStart);
        this._clearTimer('_pomoTimerId');
        const mins = phase === 'focus'
            ? this._pomo.workMins
            : (phase === 'short_break' ? this._pomo.breakMins : this._pomo.longBreakMins);
        this._pomo.totalSec = mins * 60;
        this._pomo.remainingSec = mins * 60;
        if (this._pomo.running) {
            this._startPomoInterval();
        }
        this._refreshPomodoroUI();
    }

    _togglePomodoro() {
        this._pomo.running = !this._pomo.running;
        if (this._pomo.running) {
            if (!this._pomoTimerId) this._startPomoInterval();
        } else {
            this._clearTimer('_pomoTimerId');
        }
        this._refreshPomodoroUI();
    }

    _resetPomodoro() {
        this._setPomoPhase(this._pomo.phase, false);
    }

    _onPomodoroFinished() {
        this._pomo.running = false;
        this._clearTimer('_pomoTimerId');
        if (this._pomo.phase === 'focus') {
            this._pomo.sessions++;
            const cycles = Math.max(1, this._pomo.cyclesBeforeLong || 4);
            const nextBreak = (this._pomo.sessions % cycles === 0) ? 'long_break' : 'short_break';
            const autoBreak = this._pomo.autoStartBreak !== false;
            const label = nextBreak === 'long_break' ? 'Long Break' : 'Break';
            Main.notify(
                'AngieBar Pomodoro',
                autoBreak
                    ? `Focus time completed! ${label} started automatically.`
                    : `Focus time completed! Time for a ${label.toLowerCase()}.`
            );
            this._setPomoPhase(nextBreak, autoBreak);
        } else {
            const autoFocus = Boolean(this._pomo.autoStartFocus);
            Main.notify(
                'AngieBar Pomodoro',
                autoFocus
                    ? 'Break finished! A new Focus session has started.'
                    : 'Break finished! Ready for a new Focus session?'
            );
            this._setPomoPhase('focus', autoFocus);
        }
    }

    _updatePomoTabStyle() {
        if (!this._tabButtons) return;
        const entry = this._tabButtons.get('pomodoro');
        if (!entry) return;
        const { isBreak, hex, rgb } = this._pomoAccentColors();
        const [r, g, b] = rgb;
        if (this._activeTab === 'pomodoro' && isBreak) {
            entry.btn.set_style(`background-color: rgba(${r}, ${g}, ${b}, 0.24);`);
            entry.icon.set_style(`color: ${hex};`);
        } else {
            entry.btn.set_style(null);
            entry.icon.set_style(null);
        }
    }

    _refreshPomodoroUI() {
        const timeStr = this._formatSec(this._pomo.remainingSec);
        const { isBreak, hex, rgb } = this._pomoAccentColors();
        const [r, g, b] = rgb;

        if (this._pomoTimeLabel) this._pomoTimeLabel.set_text(timeStr);
        if (this._pomoPhaseLabel) {
            const phaseTxt = this._pomo.phase === 'focus'
                ? 'Focus Session'
                : (this._pomo.phase === 'short_break' ? 'Short Break' : 'Long Break');
            this._pomoPhaseLabel.set_text(
                this._pomo.running ? `${phaseTxt} · Running` : phaseTxt
            );
            this._pomoPhaseLabel.set_style(isBreak ? `color: ${hex};` : null);
        }
        if (this._pomoStartIcon) {
            this._pomoStartIcon.gicon = this._gicon(
                this._pomo.running ? 'angie-pause-symbolic.svg' : 'angie-play-symbolic.svg'
            );
        }
        if (this._pomoStartBtn) {
            this._pomoStartBtn.set_style(isBreak ? `background-color: ${hex}; color: #ffffff;` : null);
        }
        if (this._pomoCard) {
            this._pomoCard.set_style(isBreak ? `border: 1px solid rgba(${r}, ${g}, ${b}, 0.32);` : null);
        }
        if (this._pomoSessionLabel) {
            this._pomoSessionLabel.set_text(`· ${this._pomo.sessions} cycles`);
        }
        if (this._pomoPhaseBtns) {
            this._pomoPhaseBtns.forEach((btn, id) => {
                if (id === this._pomo.phase) {
                    btn.add_style_class_name('active');
                    btn.set_style(isBreak ? `background-color: ${hex}; color: #ffffff;` : null);
                } else {
                    btn.remove_style_class_name('active');
                    btn.set_style(null);
                }
            });
        }
        this._updatePomoTabStyle();
        if (this._pomoRingArea) this._pomoRingArea.queue_repaint();
        this._updatePomoWaveState();

        // Sync compact island & header pill (always switch away from blue when in break)
        const isActive = this._pomo.running || this._pomo.remainingSec < this._pomo.totalSec || isBreak;
        if (this._compactPomoBox && this._compactPomoDot && this._compactPomoLabel) {
            this._compactPomoBox.visible = isActive;
            this._compactPomoLabel.set_text(timeStr);
            if (isBreak) {
                this._compactPomoBox.set_style(`background-color: rgba(${r}, ${g}, ${b}, 0.22); border: 1px solid rgba(${r}, ${g}, ${b}, 0.45);`);
                this._compactPomoDot.set_style(`background-color: ${hex};`);
                this._compactPomoLabel.set_style(`color: ${hex};`);
            } else {
                this._compactPomoBox.set_style(null);
                this._compactPomoDot.set_style(null);
                this._compactPomoLabel.set_style(null);
            }
        }
        if (this._headerPomoPill && this._headerPomoLabel) {
            this._headerPomoPill.visible = isActive;
            this._headerPomoLabel.set_text(timeStr);
            if (isBreak) {
                this._headerPomoPill.set_style(`background-color: rgba(${r}, ${g}, ${b}, 0.22); border: 1px solid rgba(${r}, ${g}, ${b}, 0.45);`);
                this._headerPomoLabel.set_style(`color: ${hex};`);
            } else {
                this._headerPomoPill.set_style(null);
                this._headerPomoLabel.set_style(null);
            }
        }
    }

    // =========================================================================
    // 6. PAGE 4: AI ASSISTANT (ANIMATED ROUND BOT ORB + CHAT)
    // =========================================================================

    _buildAiPage() {
        // AI mode: the whole island collapses into a single Gemini-style pill.
        const page = new St.BoxLayout({
            style_class: 'di-page di-ai-page',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: false,
        });

        this._aiComposer = new St.Widget({
            style_class: 'di-ai-composer',
            layout_manager: new Clutter.BinLayout(),
            width: 500,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        this._aiComposer.set_pivot_point(0.5, 0.0);

        this._aiGlow = new St.DrawingArea({ x_expand: true, y_expand: true });
        this._ext._connect(this._aiGlow, 'repaint', (area) => this._paintAiGlow(area));
        this._aiComposer.add_child(this._aiGlow);

        const inner = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        // Answer area (inside the pill, shown only when there is a conversation)
        this._aiChatList = new St.BoxLayout({
            style_class: 'di-ai-chat-list',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._aiScroll = new St.ScrollView({
            style_class: 'di-ai-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            visible: false,
        });
        this._aiScroll.set_child(this._aiChatList);
        inner.add_child(this._aiScroll);

        const row = new St.BoxLayout({
            style_class: 'di-ai-composer-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Animated orb (in place of the "+"): click = back to full island, right-click = change AI
        this._botCanvas = new St.DrawingArea({
            width: 30,
            height: 30,
            style_class: 'di-ai-orb',
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._ext._connect(this._botCanvas, 'repaint', (area) => this._paintBotCharacter(area));
        this._ext._connect(this._botCanvas, 'button-press-event', (_a, event) => {
            if (event.get_button() === 3) {
                const order = ['agy', 'codex', 'claude', 'local', 'internal'];
                const idx = order.indexOf(this._aiProvider);
                this._setAiProvider(order[(idx + 1) % order.length]);
            } else if (this._aiState !== 'thinking') {
                this._switchTab(this._aiPrevTab && this._aiPrevTab !== 'ai' ? this._aiPrevTab : 'notifications', true);
            }
            return Clutter.EVENT_STOP;
        });
        // Back to the full island
        this._aiBackBtn = this._makeRoundIconBtn('angie-chevron-left-symbolic.svg', 'di-ai-back-btn', () => {
            this._switchTab(this._aiPrevTab && this._aiPrevTab !== 'ai' ? this._aiPrevTab : 'notifications', true);
        }, 14);
        row.add_child(this._aiBackBtn);
        row.add_child(this._botCanvas);

        this._aiEntry = new St.Entry({
            hint_text: this._aiHintText(),
            style_class: 'di-ai-entry',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const sendAction = () => {
            if (this._aiState === 'thinking') return;
            const prompt = this._aiEntry.get_text().trim();
            if (!prompt) return;
            this._aiEntry.set_text('');
            this._sendAiPrompt(prompt);
        };
        this._ext._connect(this._aiEntry.clutter_text, 'activate', sendAction);
        row.add_child(this._aiEntry);

        this._aiThinkLabel = new St.Label({
            text: 'Just a second…',
            style_class: 'di-ai-think-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._aiThinkLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        row.add_child(this._aiThinkLabel);

        // New chat (visible only when there is a conversation)
        this._aiNewBtn = this._makeRoundIconBtn('angie-plus-symbolic.svg', 'di-ai-new-btn', () => {
            this._aiMessages = [];
            this._currentAgyConvId = null;
            this._saveAgySessionId(null);
            this._aiState = 'idle';
            this._refreshAiChatUI();
        }, 14);
        this._aiNewBtn.visible = false;
        row.add_child(this._aiNewBtn);

        this._aiSendBtn = this._makeRoundIconBtn('angie-send-symbolic.svg', 'di-ai-send-btn', sendAction, 13);
        row.add_child(this._aiSendBtn);

        this._aiStopBtn = new St.Button({
            style_class: 'di-ai-stop-btn',
            child: new St.Widget({ style_class: 'di-ai-stop-square' }),
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._ext._connect(this._aiStopBtn, 'clicked', () => this._stopAiPrompt());
        row.add_child(this._aiStopBtn);

        // Permission request panel
        this._aiPermBox = new St.BoxLayout({
            style_class: 'di-ai-perm-box',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            visible: false,
        });
        this._aiPermTitle = new St.Label({ text: 'May I proceed?', style_class: 'di-ai-perm-title' });
        this._aiPermTitle.clutter_text.line_wrap = true;
        this._aiPermBox.add_child(this._aiPermTitle);
        this._aiPermCmd = new St.Label({ text: '', style_class: 'di-ai-perm-cmd', reactive: true });
        this._aiPermCmd.clutter_text.line_wrap = true;
        this._aiPermCmd.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._ext._connect(this._aiPermCmd, 'button-press-event', () => {
            if (this._aiPermCmd.text) {
                this._ownClipCopy = true;
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._aiPermCmd.text);
                this._updateAiStatusUI('Command copied ✓');
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                    this._updateAiStatusUI('Ready');
                    return GLib.SOURCE_REMOVE;
                });
            }
            return Clutter.EVENT_STOP;
        });
        this._aiPermBox.add_child(this._aiPermCmd);
        const permBtns = new St.BoxLayout({ style_class: 'di-ai-perm-btns', x_align: Clutter.ActorAlign.END });
        const denyBtn = new St.Button({ label: 'Deny', style_class: 'di-ai-perm-btn deny', reactive: true, track_hover: true });
        const allowBtn = new St.Button({ label: 'Allow', style_class: 'di-ai-perm-btn allow', reactive: true, track_hover: true });
        this._ext._connect(denyBtn, 'clicked', () => this._resolveAiPermission(false));
        this._ext._connect(allowBtn, 'clicked', () => this._resolveAiPermission(true));
        permBtns.add_child(denyBtn);
        permBtns.add_child(allowBtn);
        this._aiPermBox.add_child(permBtns);
        inner.add_child(this._aiPermBox);

        inner.add_child(row);
        this._aiComposer.add_child(inner);
        page.add_child(this._aiComposer);

        this._refreshAiChatUI();
        return page;
    }

    _aiHintText() {
        const localModel = this._settings?.get_string('local-ai-model') || 'Locale';
        const names = {
            agy: 'Ask AGY',
            codex: 'Ask Codex',
            claude: 'Ask Claude Code',
            local: `Ask ${localModel}`,
            internal: 'Ask AngieBar',
        };
        return names[this._aiProvider] || 'Ask AngieBar';
    }

    _applyAiMode(on) {
        if (!this._popup) return;
        if (on) {
            this._popup.add_style_class_name('di-ai-mode');
            this._contentBin?.add_style_class_name('di-ai-mode');
        } else {
            this._popup.remove_style_class_name('di-ai-mode');
            this._contentBin?.remove_style_class_name('di-ai-mode');
        }
        if (this._header) this._header.visible = !on;
        if (this._contentBin) this._contentBin.set_height(on ? -1 : 170);
        this.applyTheme();
        if (on && this._aiEntry) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                try { this._aiEntry?.grab_key_focus(); } catch (e) {}
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _paintBotCharacter(area) {
        // Animated accent orb living inside the composer pill
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const t = this._aiBotTime;
        const thinking = this._aiState === 'thinking' || this._aiState === 'answering';
        const [ar, ag, ab] = (this._accentRgb || [53, 132, 228]).map(c => c / 255);
        const vr = 0.62, vg = 0.58, vb = 1.0; // soft violet (Gemini-like)
        const base = Math.min(w, h) / 2;
        const pulse = thinking ? 1 + Math.sin(t * 6) * 0.07 : 1 + Math.sin(t * 2.2) * 0.03;
        const r = base * 0.55 * pulse;
        const cx = w / 2;
        const cy = h / 2 + (thinking ? 0 : Math.sin(t * 2.4) * 0.8);

        // Glow
        const glow = new Cairo.RadialGradient(cx, cy, r * 0.5, cx, cy, base);
        glow.addColorStopRGBA(0, ar, ag, ab, thinking ? 0.55 : 0.28);
        glow.addColorStopRGBA(1, ar, ag, ab, 0.0);
        cr.setSource(glow);
        cr.arc(cx, cy, base, 0, 2 * Math.PI);
        cr.fill();

        // Spinning gradient ring while thinking
        if (thinking) {
            const rot = t * 5.2;
            cr.setLineWidth(1.8);
            cr.setLineCap(Cairo.LineCap.ROUND);
            const segs = 18;
            const span = Math.PI * 1.25;
            for (let i = 0; i < segs; i++) {
                const k = i / segs;
                const a0 = rot + k * span;
                const a1 = rot + (k + 1 / segs) * span;
                cr.setSourceRGBA(ar + (vr - ar) * k, ag + (vg - ag) * k, ab + (vb - ab) * k, 0.15 + 0.85 * k);
                cr.arc(cx, cy, base - 1.6, a0, a1);
                cr.stroke();
            }
        }

        // Orb body (accent -> violet)
        const body = new Cairo.RadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
        body.addColorStopRGBA(0, Math.min(1, ar + 0.35), Math.min(1, ag + 0.35), Math.min(1, ab + 0.35), 1);
        body.addColorStopRGBA(1, (ar + vr) / 2 * 0.85, (ag + vg) / 2 * 0.85, (ab + vb) / 2 * 0.85, 1);
        cr.setSource(body);
        cr.arc(cx, cy, r, 0, 2 * Math.PI);
        cr.fill();

        // Eyes
        const k = r / 20;
        let lookX = 0, lookY = 0;
        if (thinking) {
            lookX = Math.cos(t * 4.5) * 3.5 * k;
            lookY = Math.sin(t * 4.5) * 1.6 * k - k;
        } else {
            try {
                const [px, py] = global.get_pointer();
                const [bx, by] = area.get_transformed_position();
                lookX = Math.max(-3.5, Math.min(3.5, (px - (bx + w / 2)) / 45)) * k;
                lookY = Math.max(-2.5, Math.min(2.5, (py - (by + h / 2)) / 45)) * k;
            } catch (e) {}
        }
        const blinking = (t % 3.8) > 3.65;
        const eyeW = Math.max(1.6, 3.2 * k);
        const eyeH = blinking ? 0.8 : Math.max(2, (thinking ? 3.2 : 5.2) * k);
        cr.setSourceRGBA(1, 1, 1, 0.95);
        [-6, 6].forEach(dx => {
            this._roundedRect(cr, cx + dx * k + lookX - eyeW / 2, cy + lookY - eyeH / 2, eyeW, eyeH, eyeW / 2);
            cr.fill();
        });

        cr.$dispose();
    }

    _paintAiGlow(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        cr.save();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();
        const a = this._aiGlowAlpha || 0;
        if (a > 0.01 && w > 4 && h > 4) {
            const t = this._aiBotTime;
            const rad = Math.min(24, w / 2, h / 2);
            this._roundedRect(cr, 1, 1, w - 2, h - 2, rad);
            cr.clip();
            const [ar, ag, ab] = (this._accentRgb || [53, 132, 228]).map(c => c / 255);
            // Two drifting light blobs at the bottom edge (accent + violet)
            const blobs = [
                { x: w * (0.5 + Math.sin(t * 1.3) * 0.18), c: [0.64, 0.6, 1.0], s: 0.55 },
                { x: w * (0.5 + Math.cos(t * 0.9) * 0.28), c: [ar, ag, ab], s: 0.38 },
            ];
            blobs.forEach(b => {
                cr.save();
                cr.translate(b.x, h + h * 0.15);
                cr.scale(w * b.s, h * 0.95);
                const g = new Cairo.RadialGradient(0, 0, 0, 0, 0, 1);
                g.addColorStopRGBA(0, b.c[0], b.c[1], b.c[2], 0.75 * a);
                g.addColorStopRGBA(0.55, b.c[0], b.c[1], b.c[2], 0.22 * a);
                g.addColorStopRGBA(1, b.c[0], b.c[1], b.c[2], 0);
                cr.setSource(g);
                cr.arc(0, 0, 1, 0, 2 * Math.PI);
                cr.fill();
                cr.restore();
            });
        }
        cr.$dispose();
    }

    _startBotAnimation() {
        if (this._botAnimTimer) return;
        this._botAnimTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
            if (!this._isOpen || this._activeTab !== 'ai') {
                this._botAnimTimer = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._aiBotTime += 0.033;
            const target = this._aiState === 'thinking' ? 1 : 0;
            const prev = this._aiGlowAlpha;
            this._aiGlowAlpha += (target - this._aiGlowAlpha) * 0.12;
            if (Math.abs(target - this._aiGlowAlpha) < 0.005) this._aiGlowAlpha = target;
            if (this._botCanvas) this._botCanvas.queue_repaint();
            if (this._aiGlow && (this._aiGlowAlpha > 0 || prev > 0)) this._aiGlow.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopBotAnimation() {
        this._clearTimer('_botAnimTimer');
    }

    _friendlyAiStatus(text) {
        const map = {
            'Thinking...': 'Just a second…',
            'AGY...': 'Asking AGY…',
            'Claude...': 'Asking Claude…',
            'ChatGPT...': 'Asking ChatGPT…',
            'Codex...': 'Asking Codex…',
        };
        return map[text] || text;
    }

    _updateAiStatusUI(text) {
        if (this._aiState === 'thinking' && this._aiThinkLabel) {
            const next = this._friendlyAiStatus(text);
            if (this._aiThinkLabel.text === next) return;
            const lbl = this._aiThinkLabel;
            lbl.remove_all_transitions();
            lbl.ease({
                opacity: 0,
                translation_y: -4,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    lbl.text = next;
                    lbl.translation_y = 4;
                    lbl.ease({ opacity: 255, translation_y: 0, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
                },
            });
            return;
        }
        if (this._aiEntry) {
            const def = this._aiHintText();
            const showTemp = text && !['Ready', 'Thinking...', 'Auto'].includes(text);
            this._aiEntry.hint_text = showTemp ? this._friendlyAiStatus(text) : def;
            if (showTemp) {
                this._clearTimer('_aiHintTimer');
                this._aiHintTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1400, () => {
                    if (this._aiEntry) this._aiEntry.hint_text = def;
                    this._aiHintTimer = 0;
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    _setAiComposerMode(mode) {
        const c = this._aiComposer;
        if (!c) return;
        const thinking = mode === 'thinking';
        const fullW = 500;
        const thinkW = 310;
        c.remove_all_transitions();

        this._aiEntry.visible = !thinking;
        this._aiSendBtn.visible = !thinking;
        this._aiThinkLabel.visible = thinking;
        this._aiStopBtn.visible = thinking;
        if (this._aiScroll) this._aiScroll.visible = !thinking && this._aiMessages.length > 0;
        if (this._aiNewBtn) this._aiNewBtn.visible = !thinking && this._aiMessages.length > 0;

        if (thinking) {
            this._aiThinkLabel.text = 'Just a second…';
            this._aiThinkLabel.opacity = 0;
            this._aiThinkLabel.translation_x = -6;
            this._aiThinkLabel.ease({ opacity: 255, translation_x: 0, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
            c.add_style_class_name('thinking');
            c.scale_x = 1;
            c.scale_y = 1;
            c.ease({
                width: thinkW,
                duration: 240,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        } else {
            c.remove_style_class_name('thinking');
            c.width = fullW;
            c.scale_x = 0.86;
            c.scale_y = 0.92;
            c.ease({
                scale_x: 1,
                scale_y: 1,
                duration: 240,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
            this._aiEntry.opacity = 0;
            this._aiEntry.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
            try { this._aiEntry.grab_key_focus(); } catch (e) {}
        }
    }

    _stopAiPrompt(silent = false) {
        if (this._aiPermResolve) this._resolveAiPermission(false);
        this._aiGen++;
        try { this._aiProc?.force_exit(); } catch (e) {}
        this._aiProc = null;
        if (this._aiProvider === 'local' && this._settings?.get_boolean('local-ai-unload-after-use')) {
            const ep = (this._settings?.get_string('local-ai-endpoint') || 'http://127.0.0.1:11434').replace(/\/+$/, '');
            const model = this._settings?.get_string('local-ai-model') || 'llama3.2';
            this._ext._execCommandAsync(`curl -s -m 2 ${ep}/api/generate -d '{"model":"${model}","keep_alive":0}' 2>/dev/null`);
        }
        if (this._aiState !== 'thinking') return;
        this._aiState = 'idle';
        if (!silent) this._appendAiMessage('ai', 'Stopped.');
        this._setAiComposerMode('input');
    }

    _finishAi(gen, text) {
        if (gen !== this._aiGen) return;
        this._aiProc = null;
        this._aiState = 'idle';
        this._appendAiMessage('ai', text);
        this._setAiComposerMode('input');
    }

    _cleanAiText(text) {
        if (!text) return '';
        let s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        // Strip OSC hyperlinks and ANSI escape codes
        s = s.replace(/\x1b\]8;;[^\x1b\x07]*(\x1b\\|\x07)/g, '');
        s = s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

        // Filter out CLI internal banners and warning lines
        s = s.split('\n').filter(line => {
            const trim = line.trim();
            if (trim.startsWith('warning: --mode plan has no effect')) return false;
            if (trim.startsWith('[agy] print timeout')) return false;
            if (trim.startsWith('AGY_ERROR:')) return false;
            if (trim.startsWith('error: print timeout')) return false;
            if (trim.startsWith('warning: conversation "') && trim.includes('not found')) return false;
            return true;
        }).join('\n');

        // Clean up markdown file links: [label](file:///path) -> `path` or label (`path`)
        s = s.replace(/\[([^\]]+)\]\((?:file:\/\/)?([^)]+)\)/g, (_m, label, target) => {
            let cleanTarget = target.replace(/^file:\/\//, '');
            try { cleanTarget = decodeURIComponent(cleanTarget); } catch (e) {}
            if (label === target || label.includes(cleanTarget) || cleanTarget.includes(label) || label.startsWith('%file')) {
                return `\`${cleanTarget}\``;
            }
            return `${label} (\`${cleanTarget}\`)`;
        });

        // Clean up bare file:/// URIs
        s = s.replace(/file:\/\/([^\s\)\],]+)/g, (_m, path) => {
            try { return `\`${decodeURIComponent(path)}\``; } catch (e) { return `\`${path}\``; }
        });

        // Strip stray %file artifacts
        s = s.replace(/%file\/?/g, '');

        // Clean up horizontal rules and excessive blank lines
        s = s.replace(/^[-*_]{3,}\s*$/gm, '');
        s = s.replace(/\n{3,}/g, '\n\n');

        return s.trim();
    }

    _markdownToPango(text) {
        if (!text) return '';
        // 1. Escape XML characters first so raw HTML/XML tags don't break Pango markup
        let s = GLib.markup_escape_text(text, -1);

        // 2. Headers (# Header -> <b><big>Header</big></b>)
        s = s.replace(/^#{1,4}\s+(.+)$/gm, '<b><big>$1</big></b>');

        // 3. Horizontal rules
        s = s.replace(/^[-*_]{3,}\s*$/gm, '<span alpha="40%">───────────────────</span>');

        // 4. Bold: **text** or __text__
        s = s.replace(/\*\*([^\*\n]+)\*\*/g, '<b>$1</b>');
        s = s.replace(/__([^_\n]+)__/g, '<b>$1</b>');

        // 5. Italic: *text* or _text_
        s = s.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1<i>$2</i>$3');
        s = s.replace(/(^|[^_])_([^_\n]+)_([^_]|$)/g, '$1<i>$2</i>$3');

        // 6. Inline code: `code`
        s = s.replace(/`([^`\n]+)`/g, '<tt><span foreground="#9cdcfe">$1</span></tt>');

        // 7. Bullet lists: - item or * item
        s = s.replace(/^[ \t]*[-*•]\s+(.+)$/gm, '  • $1');

        return s;
    }

    _parseMessageSegments(text) {
        const segments = [];
        const blockRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
        let lastIndex = 0;
        let match;

        const pushTextWithCmds = (txt) => {
            if (!txt) return;
            const lines = txt.split('\n');
            let currentText = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const cmdMatch = line.match(/^\s*(?:CMD:|\$)\s+(.+)$/i);
                if (cmdMatch) {
                    if (currentText.length > 0) {
                        const t = currentText.join('\n').trim();
                        if (t) segments.push({ type: 'text', content: t });
                        currentText = [];
                    }
                    segments.push({ type: 'code', lang: 'bash', content: cmdMatch[1].trim() });
                } else {
                    currentText.push(line);
                }
            }
            if (currentText.length > 0) {
                const t = currentText.join('\n').trim();
                if (t) segments.push({ type: 'text', content: t });
            }
        };

        while ((match = blockRegex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                pushTextWithCmds(text.substring(lastIndex, match.index));
            }
            const lang = (match[1] || 'bash').trim();
            const code = match[2].trim();
            if (code) segments.push({ type: 'code', lang, content: code });
            lastIndex = blockRegex.lastIndex;
        }
        if (lastIndex < text.length) {
            pushTextWithCmds(text.substring(lastIndex));
        }
        if (segments.length === 0 && text && text.trim()) {
            segments.push({ type: 'text', content: text.trim() });
        }
        return segments;
    }

    _refreshAiChatUI() {
        if (!this._aiChatList) return;
        this._clearTimer('_aiTypeTimer');
        this._aiChatList.destroy_all_children();

        const hasMsgs = this._aiMessages.length > 0;
        if (this._aiNewBtn) this._aiNewBtn.visible = hasMsgs && this._aiState !== 'thinking';
        if (this._aiScroll) {
            this._aiScroll.visible = hasMsgs && this._aiState !== 'thinking';
            if (hasMsgs) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    try {
                        if (this._aiChatList && this._aiScroll) {
                            const [, natH] = this._aiChatList.get_preferred_height(500);
                            const targetH = Math.min(Math.max(natH, 30), 280);
                            this._aiScroll.set_height(targetH);
                        }
                    } catch (e) {}
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                try {
                    this._aiScroll.set_height(-1);
                } catch (e) {}
            }
        }
        if (!hasMsgs) return;

        this._aiMessages.forEach(msg => {
            const isUser = msg.role === 'user';
            const row = new St.BoxLayout({
                style_class: `di-ai-msg-row ${isUser ? 'user' : 'ai'}`,
                x_expand: true,
                x_align: isUser ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
            });

            const bubble = new St.BoxLayout({
                style_class: `di-ai-bubble ${isUser ? 'user' : 'ai'}`,
                orientation: Clutter.Orientation.VERTICAL,
                reactive: true,
                track_hover: true,
            });

            if (isUser) {
                const lbl = new St.Label({
                    text: msg.text,
                    style_class: 'di-ai-bubble-text user',
                    x_expand: true,
                });
                lbl.clutter_text.line_wrap = true;
                lbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                lbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                lbl.clutter_text.single_line_mode = false;
                bubble.add_child(lbl);

                this._ext._connect(bubble, 'button-press-event', () => {
                    this._ownClipCopy = true;
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, msg.text);
                    this._updateAiStatusUI('Copied ✓');
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                        this._updateAiStatusUI('Ready');
                        return GLib.SOURCE_REMOVE;
                    });
                    return Clutter.EVENT_STOP;
                });
            } else {
                const cleanedText = this._cleanAiText(msg.text);
                const segments = this._parseMessageSegments(cleanedText);

                segments.forEach(seg => {
                    if (seg.type === 'code') {
                        const codeBox = new St.BoxLayout({
                            style_class: 'di-ai-code-box',
                            orientation: Clutter.Orientation.VERTICAL,
                            x_expand: true,
                            reactive: true,
                            track_hover: true,
                        });

                        const header = new St.BoxLayout({
                            style_class: 'di-ai-code-header',
                            x_expand: true,
                            y_align: Clutter.ActorAlign.CENTER,
                        });

                        const langLbl = new St.Label({
                            text: (seg.lang || 'bash').toUpperCase(),
                            style_class: 'di-ai-code-lang',
                            x_expand: true,
                            y_align: Clutter.ActorAlign.CENTER,
                        });
                        header.add_child(langLbl);

                        const copyBtn = new St.Button({
                            label: 'Copy',
                            style_class: 'di-ai-code-copy-btn',
                            reactive: true,
                            track_hover: true,
                            y_align: Clutter.ActorAlign.CENTER,
                        });

                        const doCopy = () => {
                            this._ownClipCopy = true;
                            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, seg.content);
                            copyBtn.label = 'Copied ✓';
                            copyBtn.add_style_class_name('copied');
                            this._updateAiStatusUI('Command copied ✓');
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                                copyBtn.label = 'Copy';
                                copyBtn.remove_style_class_name('copied');
                                this._updateAiStatusUI('Ready');
                                return GLib.SOURCE_REMOVE;
                            });
                            return Clutter.EVENT_STOP;
                        };

                        this._ext._connect(copyBtn, 'clicked', doCopy);
                        this._ext._connect(codeBox, 'button-press-event', doCopy);

                        header.add_child(copyBtn);
                        codeBox.add_child(header);

                        const codeLbl = new St.Label({
                            text: seg.content,
                            style_class: 'di-ai-code-text',
                            x_expand: true,
                        });
                        codeLbl.clutter_text.line_wrap = true;
                        codeLbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                        codeLbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                        codeBox.add_child(codeLbl);

                        bubble.add_child(codeBox);
                    } else {
                        const lbl = new St.Label({
                            style_class: 'di-ai-bubble-text ai',
                            x_expand: true,
                        });
                        lbl.clutter_text.line_wrap = true;
                        lbl.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                        lbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                        lbl.clutter_text.single_line_mode = false;
                        lbl.clutter_text.use_markup = true;

                        const markup = this._markdownToPango(seg.content);
                        try {
                            lbl.clutter_text.set_markup(markup);
                        } catch (e) {
                            lbl.clutter_text.set_text(seg.content);
                        }
                        bubble.add_child(lbl);
                    }
                });

                // Clicking the bubble outside code boxes copies the full response
                this._ext._connect(bubble, 'button-press-event', () => {
                    this._ownClipCopy = true;
                    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, cleanedText);
                    this._updateAiStatusUI('Response copied ✓');
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                        this._updateAiStatusUI('Ready');
                        return GLib.SOURCE_REMOVE;
                    });
                    return Clutter.EVENT_STOP;
                });
            }

            row.add_child(bubble);
            this._aiChatList.add_child(row);

            if (msg.animate) {
                msg.animate = false;
                bubble.opacity = 0;
                bubble.translation_y = 6;
                bubble.ease({
                    opacity: 255,
                    translation_y: 0,
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
        });

        this._scrollAiToBottom();
    }

    _scrollAiToBottom() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
                const adj = this._aiScroll?.vadjustment || this._aiScroll?.vscroll?.adjustment;
                if (adj) adj.value = adj.upper;
            } catch (e) {}
            return GLib.SOURCE_REMOVE;
        });
    }

    _appendAiMessage(role, text) {
        this._aiMessages.push({ role, text: text.trim(), animate: true });
        this._updateAiStatusUI(role === 'ai' ? 'Ready' : 'Thinking...');
        this._refreshAiChatUI();
    }

    _sendAiPrompt(prompt) {
        if (this._aiState === 'thinking') return;
        this._lastAiPrompt = prompt;
        this._aiState = 'thinking';
        this._appendAiMessage('user', prompt);
        this._setAiComposerMode('thinking');
        this._askStockAi(prompt);
    }

    _setAiProvider(id) {
        this._aiProvider = id;
        try { if (this._settings && this._settings.get_string('ai-provider') !== id) this._settings.set_string('ai-provider', id); } catch (e) {}
        for (const [k, btn] of this._aiProviderBtns.entries()) {
            if (k === id) btn.add_style_class_name('active');
            else btn.remove_style_class_name('active');
        }
        if (this._aiEntry) this._aiEntry.hint_text = this._aiHintText();
    }

    _findCliBin(names, extraPaths = []) {
        const home = GLib.get_home_dir();
        const searchDirs = [
            ...extraPaths,
            `${home}/.gemini/bin`,
            `${home}/.local/bin`,
            `${home}/.npm-global/bin`,
            `${home}/bin`,
            '/usr/local/bin',
            '/usr/bin',
        ];
        for (const name of names) {
            for (const dir of searchDirs) {
                const candidate = `${dir}/${name}`;
                if (GLib.file_test(candidate, GLib.FileTest.IS_EXECUTABLE))
                    return candidate;
            }
            const inPath = GLib.find_program_in_path(name);
            if (inPath) return inPath;
        }
        return null;
    }

    _runAiSubprocess(argv, timeoutSec = 90, stdinStr = null) {
        return new Promise((resolve) => {
            try {
                const home = GLib.get_home_dir();
                const launcher = new Gio.SubprocessLauncher({
                    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE | (stdinStr !== null ? Gio.SubprocessFlags.STDIN_PIPE : 0),
                });
                launcher.set_cwd(home);
                const curPath = GLib.getenv('PATH') || '/usr/local/bin:/usr/bin:/bin';
                launcher.setenv('PATH', `${home}/.gemini/bin:${home}/.local/bin:${home}/.npm-global/bin:${curPath}`, true);
                const proc = launcher.spawnv(argv);
                this._aiProc = proc;
                let finished = false;
                const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSec, () => {
                    if (!finished) {
                        finished = true;
                        try { proc.force_exit(); } catch (e) {}
                        resolve({ stdout: '', stderr: 'timeout' });
                    }
                    return GLib.SOURCE_REMOVE;
                });
                proc.communicate_utf8_async(stdinStr, null, (obj, res) => {
                    if (finished) return;
                    finished = true;
                    GLib.source_remove(timerId);
                    try {
                        const [, stdout, stderr] = obj.communicate_utf8_finish(res);
                        resolve({ stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
                    } catch (e) {
                        resolve({ stdout: '', stderr: String(e) });
                    }
                });
            } catch (e) {
                resolve({ stdout: '', stderr: String(e) });
            }
        });
    }

    _agentSystemPrompt(prompt) {
        const home = GLib.get_home_dir();
        return `You are the compact AI assistant built into the GNOME Shell Dynamic Island on the user's Linux PC (home folder: ${home}).\n` +
            `STRICT BREVITY RULE (HIGHEST PRIORITY):\n` +
            `- Answer in English in an EXTREMELY concise and DIRECT way: MAXIMUM 2-3 SENTENCES IN TOTAL.\n` +
            `- FORBIDDEN: walls of text, essays, multiple headings (###) or step-by-step guides.\n` +
            `- If you show or suggest bash commands, put them in a markdown block: \`\`\`bash\n<command>\n\`\`\`.\n` +
            `- For file or folder paths, use only plain text between backticks (e.g. \`/home/user/folder\`). Never markdown links with file://.\n` +
            `- When the user asks you to do something on the PC, run it directly with your tools and confirm the outcome in 1 concise sentence.\n` +
            `User request: ${prompt}\n` +
            `(NOTE: Maximum 2-3 sentences. Very short answer).`;
    }

    async _tryAgyBackend(prompt) {
        const bin = this._findCliBin(['agy']);
        if (!bin) return null;
        this._updateAiStatusUI('AGY...');
        const fullPrompt = this._agentSystemPrompt(prompt);
        const { stdout } = await this._runAiSubprocess([
            bin,
            '--dangerously-skip-permissions',
            '--mode', 'auto',
            '--add-dir', GLib.get_home_dir(),
            '--disable-slash-commands',
            '--print-timeout', '85s',
            '-p', fullPrompt,
        ], 90);
        if (stdout && !stdout.startsWith('ERROR:') && !stdout.includes('Failed to start') && !stdout.includes('Error types:'))
            return stdout;
        return null;
    }

    async _tryClaudeBackend(prompt) {
        const bin = this._findCliBin(['claude', 'claude-code']);
        if (!bin) return null;
        this._updateAiStatusUI('Claude...');
        const fullPrompt = this._agentSystemPrompt(prompt);
        const { stdout } = await this._runAiSubprocess([
            bin,
            '--dangerously-skip-permissions',
            '-p', fullPrompt,
        ], 90);
        if (stdout && !stdout.startsWith('Error:') && !stdout.startsWith('ERROR:'))
            return stdout;
        return null;
    }

    async _tryChatGptBackend(prompt) {
        const fullPrompt = this._agentSystemPrompt(prompt);

        // 1. OpenAI Codex CLI in full-auto agentic mode if installed
        const codexBin = this._findCliBin(['codex']);
        if (codexBin) {
            this._updateAiStatusUI('ChatGPT...');
            const { stdout } = await this._runAiSubprocess([codexBin, '--full-auto', 'exec', fullPrompt], 90);
            if (stdout) return stdout;
        }

        // 2. OpenAI API with bash tool execution if OPENAI_API_KEY is available
        const apiKey = GLib.getenv('OPENAI_API_KEY');
        if (apiKey) {
            this._updateAiStatusUI('ChatGPT...');
            const sysMsg = 'You are the compact AngieBar assistant on the user\'s PC. Answer in English in MAXIMUM 2-3 SENTENCES (no walls of text). If you need to run a command on the PC, reply ONLY with: CMD: <bash command>.';
            const payload = JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: sysMsg },
                    { role: 'user', content: prompt },
                ],
                max_tokens: 300,
            });
            const { stdout } = await this._runAiSubprocess([
                'curl', '-s', '-m', '20', 'https://api.openai.com/v1/chat/completions',
                '-H', 'Content-Type: application/json',
                '-H', `Authorization: Bearer ${apiKey}`,
                '-d', payload,
            ]);
            if (stdout) {
                try {
                    const parsed = JSON.parse(stdout);
                    const content = parsed?.choices?.[0]?.message?.content?.trim();
                    if (content) {
                        if (content.startsWith('CMD:')) {
                            const cmd = content.slice(4).trim();
                            const cmdOut = await this._ext._execCommandAsync(`${cmd} 2>&1 | head -c 600`);
                            return (cmdOut && cmdOut.trim()) ? `Executed (\`${cmd}\`):\n${cmdOut.trim()}` : `Command executed: \`${cmd}\``;
                        }
                        return content;
                    }
                } catch (e) {}
            }
        }

        // 3. Other CLI tools (tgpt, sgpt, aichat, llm)
        const tgptBin = this._findCliBin(['tgpt']);
        if (tgptBin) {
            this._updateAiStatusUI('ChatGPT...');
            const { stdout } = await this._runAiSubprocess([tgptBin, '-q', fullPrompt]);
            if (stdout) return stdout;
        }

        const sgptBin = this._findCliBin(['sgpt', 'aichat', 'llm']);
        if (sgptBin) {
            this._updateAiStatusUI('ChatGPT...');
            const { stdout } = await this._runAiSubprocess([sgptBin, fullPrompt]);
            if (stdout) return stdout;
        }

        return null;
    }

    _aiConfirm(title, detail) {
        return new Promise(resolve => {
            if (this._aiPermResolve) this._aiPermResolve(false);
            this._aiPermResolve = resolve;
            this._aiPermTitle.text = title || 'May I proceed?';
            this._aiPermCmd.text = detail || '';
            this._aiPermCmd.visible = Boolean(detail);
            if (this._aiThinkLabel) this._aiThinkLabel.text = 'Your permission is required';
            const c = this._aiComposer;
            this._aiPermBox.visible = true;
            this._aiPermBox.opacity = 0;
            this._aiPermBox.ease({ opacity: 255, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
            if (c) {
                c.remove_all_transitions();
                c.ease({ width: 500, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
            }
        });
    }

    _resolveAiPermission(ok) {
        const resolve = this._aiPermResolve;
        this._aiPermResolve = null;
        if (this._aiPermBox) this._aiPermBox.visible = false;
        if (this._aiThinkLabel) this._aiThinkLabel.text = ok ? 'Running…' : 'Cancelled';
        const c = this._aiComposer;
        if (c && this._aiState === 'thinking') {
            c.remove_all_transitions();
            c.ease({ width: 310, duration: 240, mode: Clutter.AnimationMode.EASE_OUT_CUBIC });
        }
        if (resolve) resolve(ok);
    }

    _proposalPrompt(prompt) {
        const home = GLib.get_home_dir();
        return `You are the compact AI assistant built into the GNOME Shell Dynamic Island on the user's Linux PC (home folder: ${home}).\n\n` +
            `STRICT BREVITY RULE (HIGHEST PRIORITY):\n` +
            `- Answer in English in an EXTREMELY concise, DIRECT and to-the-point way: MAXIMUM 2-3 SENTENCES IN TOTAL.\n` +
            `- The user reads you inside a small desktop widget. WALLS OF TEXT, ESSAYS, LONG GUIDES AND THEORETICAL LISTS ARE STRICTLY FORBIDDEN.\n` +
            `- Do NOT write preambles or greetings, do NOT list all hypothetical causes, do NOT use section headings (###), do NOT write tutorials or step-by-step guides.\n` +
            `- Get straight to the point: if there is a problem or a technical question, give the answer or the most likely cause in 1 sentence and immediately state the exact action or command.\n\n` +
            `PERMISSIONS AND COMMANDS RULE:\n` +
            `- You can access any file, folder or command on the PC (no folder excluded), but you must NEVER run anything by yourself without authorization.\n` +
            `- EVERY TIME something needs to be done or verified on the system (checking processes, reading files, installing or launching apps, testing errors):\n` +
            `  Write the command on a separate line in the exact format: CMD: <bash command>\n` +
            `  (The interface will ask the user for Allow/Deny authorization before running it).\n` +
            `- If the answer is purely informative, use at most 2 sentences and put the command in: \`\`\`bash\n<command>\n\`\`\`.\n` +
            `- For paths or files, use only single backticks (e.g. \`/home/user/file\`). NEVER markdown links [link](file://...) or file:// schemes.\n\n` +
            `User request: ${prompt}\n\n` +
            `(NOTE: Strictly obey the maximum of 2-3 sentences. No long answers!).`;
    }

    _getAgySessionFile() {
        return `${GLib.get_user_runtime_dir()}/angiebar-agy-session.id`;
    }

    _loadAgySessionId() {
        try {
            const f = Gio.File.new_for_path(this._getAgySessionFile());
            if (f.query_exists(null)) {
                const [ok, contents] = f.load_contents(null);
                if (ok) {
                    const id = new TextDecoder('utf-8').decode(contents).trim();
                    if (id && /^[a-z0-9-]+$/i.test(id)) {
                        return id;
                    }
                }
            }
        } catch (e) {
            // ignore
        }
        return null;
    }

    _saveAgySessionId(id) {
        try {
            const path = this._getAgySessionFile();
            const f = Gio.File.new_for_path(path);
            if (!id) {
                if (f.query_exists(null)) f.delete(null);
                return;
            }
            GLib.file_set_contents(path, id);
        } catch (e) {
            // ignore
        }
    }

    _getLatestAgyConvId() {
        const cliDir = `${GLib.get_home_dir()}/.gemini/antigravity-cli/conversations`;
        const ideDir = `${GLib.get_home_dir()}/.gemini/antigravity/conversations`;
        const dirs = [cliDir];
        const dir1 = Gio.File.new_for_path(cliDir);
        if (!dir1.query_exists(null)) dirs.push(ideDir);

        let latestId = null;
        let latestTime = 0;

        for (const dirPath of dirs) {
            const dir = Gio.File.new_for_path(dirPath);
            if (!dir.query_exists(null)) continue;
            try {
                const enumerator = dir.enumerate_children(
                    'standard::name,time::modified,time::modified-usec',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const name = info.get_name();
                    const m = name.match(/^([a-f0-9-]+)\.(?:db|pb)$/i);
                    if (m) {
                        const sec = info.get_attribute_uint64('time::modified');
                        const usec = info.get_attribute_uint32('time::modified-usec');
                        const time = Number(sec) * 1000000 + Number(usec);
                        if (time > latestTime) {
                            latestTime = time;
                            latestId = m[1];
                        }
                    }
                }
            } catch (e) {
                console.error(`[AngieBar] Error reading agy conversations: ${e.message}`);
            }
        }
        return latestId;
    }

    _agentArgv(provider, prompt, ask) {
        const full = this._proposalPrompt(prompt);
        if (provider === 'agy') {
            const bin = this._findCliBin(['agy']);
            if (!bin) return null;
            const args = [bin, '--dangerously-skip-permissions', '--effort', 'low'];
            if (this._currentAgyConvId) {
                args.push('--conversation', this._currentAgyConvId);
            }
            args.push('-p', full);
            return args;
        }
        if (provider === 'claude') {
            const bin = this._findCliBin(['claude', 'claude-code']);
            if (!bin) return null;
            return [bin, '--dangerously-skip-permissions', '-p', full];
        }
        if (provider === 'codex') {
            const bin = this._findCliBin(['codex']);
            if (!bin) return null;
            return [bin, 'exec', '--full-auto', full];
        }
        return null;
    }

    async _runAgentWithPermission(provider, prompt, gen) {
        const labels = { agy: 'AGY', claude: 'Claude', codex: 'Codex' };
        const ask = this._aiAskPermission();
        const argv = this._agentArgv(provider, prompt, ask);
        if (!argv) {
            const bins = { agy: '`agy` (~/.gemini/bin/agy)', claude: '`claude` (Claude Code)', codex: '`codex` (OpenAI Codex CLI)' };
            return `CLI ${bins[provider] || provider} not found. Install it or choose a different engine in the settings.`;
        }
        this._updateAiStatusUI(`${labels[provider] === 'AGY' ? 'AGY' : labels[provider]}...`);
        const { stdout, stderr } = await this._runAiSubprocess(argv, 90);
        if (gen !== this._aiGen) return null;

        if (provider === 'agy') {
            const notFound = (stdout && stdout.includes('warning: conversation') && stdout.includes('not found')) ||
                             (stderr && stderr.includes('warning: conversation') && stderr.includes('not found'));
            if (!this._currentAgyConvId || notFound) {
                const latest = this._getLatestAgyConvId();
                if (latest) {
                    this._currentAgyConvId = latest;
                    this._saveAgySessionId(latest);
                }
            }
        }

        let out = this._cleanAiText(stdout || '');
        if (!out) {
            if (stderr === 'timeout' || (stderr && stderr.includes('timeout')))
                return 'Timeout: the AI took too long to respond.';
            return `No response from ${labels[provider]}. Try again shortly.`;
        }

        const cmds = [];
        const text = out.split('\n').filter(line => {
            const m = line.match(/^\s*`?CMD:\s*(.+?)`?\s*$/i);
            if (m) { cmds.push(m[1].trim()); return false; }
            return true;
        }).join('\n').trim();
        if (cmds.length === 0) return out;

        // Ask permission every time for each command
        const results = [];
        for (const cmd of cmds) {
            if (gen !== this._aiGen) return null;
            const ok = await this._aiConfirm(text || `${labels[provider]} wants to run a command on your PC:`, cmd);
            if (gen !== this._aiGen) return null;
            if (!ok) { results.push(`✕ Denied: \`${cmd}\``); continue; }
            this._updateAiStatusUI('Running…');
            const r = await this._runAiSubprocess(['bash', '-lc', cmd], 120);
            const o = ((r.stdout || '') + (r.stderr && r.stderr !== 'timeout' ? `\n${r.stderr}` : '')).trim();
            results.push(`✓ \`${cmd}\`${o ? `\n${o.slice(0, 500)}` : ''}`);
        }
        return `${text ? `${text}\n\n` : ''}${results.join('\n')}`;
    }

    async _runLocalAiWithPermission(prompt, gen) {
        const ep = (this._settings?.get_string('local-ai-endpoint') || 'http://127.0.0.1:11434').replace(/\/+$/, '');
        const model = this._settings?.get_string('local-ai-model') || 'llama3.2';
        const engine = this._settings?.get_string('local-ai-engine') || 'ollama';
        const unloadAfterUse = this._settings ? this._settings.get_boolean('local-ai-unload-after-use') : true;

        this._updateAiStatusUI(`Loading ${model}…`);

        const home = GLib.get_home_dir();
        const sysMsg =
            `You are the compact AI assistant built into the GNOME Shell Dynamic Island on the user's Linux PC (home folder: ${home}).\n` +
            `STRICT BREVITY RULE: Answer in English in an EXTREMELY CONCISE way: MAXIMUM 2-3 SENTENCES in total. Absolutely forbidden: walls of text, endless lists or long guides.\n` +
            `If fulfilling the request requires doing or verifying something on the PC, do not run anything directly: describe in 1 sentence what you want to do and write EVERY bash command on a separate line in the exact format: CMD: <bash command>\n` +
            `If you show commands for information purposes, use a \`\`\`bash ... \`\`\` block.\n` +
            `For paths use text between backticks (e.g. \`/home/user/folder\`), without file:// links.\n` +
            `If no commands are needed, answer with 1-2 essential sentences.`;

        let rawResponse = '';
        try {
            if (engine === 'ollama') {
                const payload = JSON.stringify({
                    model,
                    prompt,
                    system: sysMsg,
                    stream: false,
                    keep_alive: unloadAfterUse ? 0 : '5m',
                });
                this._updateAiStatusUI(`${model} is thinking…`);
                const { stdout, stderr } = await this._runAiSubprocess([
                    'curl', '-s', '-m', '120',
                    `${ep}/api/generate`,
                    '-H', 'Content-Type: application/json',
                    '-d', '@-',
                ], 125, payload);
                if (gen !== this._aiGen) return null;
                if (!stdout) {
                    return `Unable to contact Ollama at ${ep}. Make sure the service is running (${stderr || 'timeout'}).`;
                }
                const parsed = JSON.parse(stdout);
                if (parsed.error) return `Ollama error: ${parsed.error}`;
                rawResponse = (parsed.response || '').trim();

                if (unloadAfterUse) {
                    this._ext._execCommandAsync(
                        `curl -s -m 2 ${ep}/api/generate -d '{"model":"${model}","keep_alive":0}' 2>/dev/null`
                    );
                }
            } else {
                const payload = JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: sysMsg },
                        { role: 'user', content: prompt },
                    ],
                    temperature: 0.5,
                });
                const chatUrl = ep.endsWith('/v1') ? `${ep}/chat/completions` : `${ep}/v1/chat/completions`;
                this._updateAiStatusUI(`${model} is thinking…`);
                const { stdout, stderr } = await this._runAiSubprocess([
                    'curl', '-s', '-m', '120',
                    chatUrl,
                    '-H', 'Content-Type: application/json',
                    '-d', '@-',
                ], 125, payload);
                if (gen !== this._aiGen) return null;
                if (!stdout) {
                    return `Unable to contact the engine at ${chatUrl} (${stderr || 'timeout'}).`;
                }
                const parsed = JSON.parse(stdout);
                if (parsed.error) return `Local engine error: ${parsed.error?.message || JSON.stringify(parsed.error)}`;
                rawResponse = (parsed.choices?.[0]?.message?.content || '').trim();
            }
        } catch (e) {
            return `Error while querying the local model: ${e.message}`;
        }

        if (!rawResponse) return 'No response from the local model.';

        // Parse any commands
        const cmds = [];
        const textLines = [];
        rawResponse.split('\n').forEach(line => {
            const m = line.match(/^\s*`?CMD:\s*(.+?)`?\s*$/i);
            if (m) {
                cmds.push(m[1].trim());
            } else {
                textLines.push(line);
            }
        });
        const explanation = textLines.join('\n').trim();

        if (cmds.length === 0) return rawResponse;

        // Ask permission every time for each command
        const results = [];
        for (const cmd of cmds) {
            if (gen !== this._aiGen) return null;
            const ok = await this._aiConfirm(
                explanation || `${model} wants to run a command on your PC:`,
                cmd
            );
            if (gen !== this._aiGen) return null;
            if (!ok) {
                results.push(`✕ Denied: \`${cmd}\``);
                continue;
            }
            this._updateAiStatusUI('Running…');
            const r = await this._runAiSubprocess(['bash', '-lc', cmd], 120);
            const o = ((r.stdout || '') + (r.stderr && r.stderr !== 'timeout' ? `\n${r.stderr}` : '')).trim();
            results.push(`✓ \`${cmd}\`${o ? `\n${o.slice(0, 500)}` : ''}`);
        }

        return `${explanation ? `${explanation}\n\n` : ''}${results.join('\n')}`;
    }

    async _askStockAi(prompt) {
        const gen = ++this._aiGen;
        this._aiState = 'thinking';
        this._updateAiStatusUI('Thinking...');

        try {
            const provider = this._aiProvider || 'agy';
            if (provider === 'local') {
                const reply = await this._runLocalAiWithPermission(prompt, gen);
                if (reply !== null) this._finishAi(gen, reply);
                return;
            }
            if (provider !== 'internal') {
                const reply = await this._runAgentWithPermission(provider, prompt, gen);
                if (reply !== null) this._finishAi(gen, reply);
                return;
            }

            // Internal AI: built-in actions (permission asked per action)
            const directCmd = await this._tryBuiltInAiAction(prompt);
            if (directCmd) {
                this._finishAi(gen, directCmd);
                return;
            }

            // 3. Try local Ollama HTTP API if running
            const modelsOut = await this._ext._execCommandAsync('curl -s -m 2 http://127.0.0.1:11434/api/tags');
            let modelName = '';
            if (modelsOut) {
                try {
                    const parsed = JSON.parse(modelsOut);
                    if (parsed.models && parsed.models.length > 0) {
                        modelName = parsed.models[0].name;
                    }
                } catch (e) {}
            }

            if (modelName) {
                const payload = JSON.stringify({
                    model: modelName,
                    prompt: `Rispondi in modo ESTREMAMENTE CONCISO e DIRETTO in italiano (MASSIMO 2-3 FRASI, vietati assolutamente muri di testo o guide lunghe): ${prompt}`,
                    stream: false,
                }).replace(/'/g, "'\\''");
                const out = await this._ext._execCommandAsync(
                    `curl -s -m 20 http://127.0.0.1:11434/api/generate -d '${payload}'`
                );
                if (out) {
                    const resp = JSON.parse(out);
                    if (resp.response) {
                        this._finishAi(gen, resp.response);
                        return;
                    }
                }
            }

            // 4. Stock built-in conversational fallback
            this._finishAi(gen, this._builtInConversationalFallback(prompt));
        } catch (e) {
            this._finishAi(gen, 'Unable to complete the request.');
        }
    }

    _resolveUserDir(keyword) {
        const home = GLib.get_home_dir();
        const k = (keyword || '').toLowerCase().trim();
        const map = {
            'documenti': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS), `${home}/Documenti`, `${home}/Documents`],
            'documents': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS), `${home}/Documenti`, `${home}/Documents`],
            'scaricati': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD), `${home}/Scaricati`, `${home}/Downloads`],
            'download': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD), `${home}/Scaricati`, `${home}/Downloads`],
            'downloads': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD), `${home}/Scaricati`, `${home}/Downloads`],
            'scrivania': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP), `${home}/Scrivania`, `${home}/Desktop`],
            'desktop': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP), `${home}/Scrivania`, `${home}/Desktop`],
            'immagini': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES), `${home}/Immagini`, `${home}/Pictures`],
            'pictures': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES), `${home}/Immagini`, `${home}/Pictures`],
            'musica': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_MUSIC), `${home}/Musica`, `${home}/Music`],
            'music': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_MUSIC), `${home}/Musica`, `${home}/Music`],
            'video': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS), `${home}/Video`, `${home}/Videos`],
            'videos': [GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS), `${home}/Video`, `${home}/Videos`],
            'home': [home],
        };
        const candidates = map[k] || [];
        for (const c of candidates) {
            if (c && GLib.file_test(c, GLib.FileTest.IS_DIR))
                return c;
        }
        const raw = (keyword || '').trim();
        if (raw.startsWith('~/')) return `${home}/${raw.slice(2)}`;
        if (raw.startsWith('/')) return raw;
        return home;
    }

    async _tryBuiltInAiAction(prompt) {
        const home = GLib.get_home_dir();
        const lower = prompt.toLowerCase().trim();

        // 1. Direct bash execution: "run ...", "execute ...", "terminal ...", "$ ..."
        const cmdMatch = prompt.match(/^(?:run|execute|do|terminal|bash|\$)\s+(.+)$/i);
        if (cmdMatch) {
            const rawCmd = cmdMatch[1].trim();
            if (!(await this._aiConfirm('Do you want me to run this command?', rawCmd))) return 'Ok, I did not run anything.';
            const out = await this._ext._execCommandAsync(`cd "${home}" && ${rawCmd} 2>&1 | head -c 700`);
            return (out && out.trim()) ? `Output of \`${rawCmd}\`:\n${out.trim()}` : `Command \`${rawCmd}\` executed successfully.`;
        }

        // 2. Create folder: "create folder X [in/on Documents|Desktop|Downloads|Home]"
        const mkdirMatch = prompt.match(/create\s+(?:a\s+)?(?:new\s+)?folder\s+(?:called\s+)?["']?([^"']+?)["']?(?:\s+(?:in|on|inside)\s+(documents|download|downloads|desktop|home|pictures|music|videos|~\/\S+|\/\S+))?$/i);
        if (mkdirMatch) {
            const folderName = mkdirMatch[1].trim();
            const whereRaw = mkdirMatch[2] ? mkdirMatch[2].trim() : 'home';
            const baseDir = this._resolveUserDir(whereRaw);
            const targetPath = folderName.startsWith('/') ? folderName
                : folderName.startsWith('~/') ? `${home}/${folderName.slice(2)}`
                : `${baseDir}/${folderName}`;
            if (!(await this._aiConfirm('Create a new folder?', targetPath))) return 'Ok, folder not created.';
            const res = GLib.mkdir_with_parents(targetPath, 0o755);
            if (res === 0)
                return `Folder created: ${targetPath}`;
            return `Unable to create the folder ${targetPath}.`;
        }

        // 3. Create file: "create file X [with content Y]"
        const touchMatch = prompt.match(/create\s+(?:a\s+)?(?:new\s+)?file\s+["']?([^\s"']+)["']?(?:\s+(?:in|on)\s+(documents|download|downloads|desktop|home))?(?:\s+with\s+(?:text|content)\s+(.+))?$/i);
        if (touchMatch) {
            const fileName = touchMatch[1].trim();
            const baseDir = this._resolveUserDir(touchMatch[2] || 'home');
            const content = touchMatch[3] ? touchMatch[3].trim() : '';
            const filePath = fileName.startsWith('/') ? fileName
                : fileName.startsWith('~/') ? `${home}/${fileName.slice(2)}`
                : `${baseDir}/${fileName}`;
            if (!(await this._aiConfirm('Create this file?', filePath))) return 'Ok, file not created.';
            try {
                GLib.file_set_contents(filePath, content);
                return `File created: ${filePath}`;
            } catch (e) {
                return `Error creating ${filePath}.`;
            }
        }

        // 4. List / view documents or folders: "show documents", "list folder downloads", "what's in desktop"
        const listDirMatch = prompt.match(/(?:show|list|view|see|open|what['’]?s?\s+(?:in|on|inside\s+(?:the\s+)?(?:folder\s+)?)| files?\s+(?:in|on))\s+(?:the\s+|folder\s+)?(documents|download|downloads|desktop|pictures|music|videos|home|~\/\S+|\/\S+)/i);
        if (listDirMatch || lower === 'documents' || lower === 'downloads' || lower === 'desktop' || lower === 'download') {
            const dirKey = listDirMatch ? listDirMatch[1] : lower;
            const dirPath = this._resolveUserDir(dirKey);
            if (lower.startsWith('open ')) {
                try {
                    const gfile = Gio.File.new_for_path(dirPath);
                    Gio.AppInfo.launch_default_for_uri_async(gfile.get_uri(), null, null, null);
                    return `I opened the folder ${dirPath}.`;
                } catch (e) {}
            }
            const safeDir = dirPath.replace(/'/g, "'\\''");
            const lsOut = await this._ext._execCommandAsync(`ls -1t '${safeDir}' 2>/dev/null | head -n 12`);
            if (!lsOut || !lsOut.trim())
                return `The folder ${dirPath} is empty.`;
            const items = lsOut.trim().split('\n').join(', ');
            return `Files in ${dirPath}:\n${items}`;
        }

        // 5. Read / view a specific file or document: "read file X", "view document X"
        const readMatch = prompt.match(/^(?:read|show\s+content|view\s+(?:the\s+)?(?:file|document))\s+["']?(.+?)["']?$/i);
        if (readMatch) {
            const target = readMatch[1].trim();
            const safeTarget = target.replace(/'/g, "'\\''");
            const found = await this._ext._execCommandAsync(
                `if [ -f '${safeTarget}' ]; then echo '${safeTarget}'; elif [ -f "${home}/${safeTarget}" ]; then echo "${home}/${safeTarget}"; else find "${home}" -maxdepth 3 -iname '*${safeTarget}*' -type f 2>/dev/null | head -n 1; fi`
            );
            const filePath = (found || '').trim();
            if (!filePath) return `I could not find the file "${target}".`;
            const headOut = await this._ext._execCommandAsync(`head -c 500 '${filePath.replace(/'/g, "'\\''")}' 2>/dev/null`);
            return headOut && headOut.trim()
                ? `${filePath}:\n${headOut.trim()}`
                : `The file ${filePath} is empty or binary.`;
        }

        // 6. Search files on PC: "search file X", "find document X"
        const findMatch = prompt.match(/^(?:search|find)\s+(?:the\s+)?(?:file|document|folder)?\s*["']?(.+?)["']?$/i);
        if (findMatch) {
            const query = findMatch[1].trim().replace(/'/g, '');
            const findOut = await this._ext._execCommandAsync(
                `find "${home}" -maxdepth 3 -not -path '*/.*' -iname '*${query}*' 2>/dev/null | head -n 8`
            );
            if (!findOut || !findOut.trim())
                return `No file or folder found for "${query}".`;
            const results = findOut.trim().split('\n').map(p => p.replace(home, '~')).join('\n');
            return `Results found:\n${results}`;
        }

        // 7. Install application: "install X", "install app X"
        const installMatch = prompt.match(/^(?:install(?: an?| the)?\s+(?:app|application|package)?|download\s+app)\s+([a-zA-Z0-9._+-]+)$/i);
        if (installMatch) {
            const pkg = installMatch[1].trim();
            if (!(await this._aiConfirm('Install this application?', pkg))) return 'Ok, installation cancelled.';
            this._updateAiStatusUI(`Installing ${pkg}...`);
            // Try user-level Flatpak first (no root password needed), otherwise pkexec dnf/apt/pacman
            const script = `
                if command -v flatpak >/dev/null 2>&1; then
                    FLAT_ID=$(flatpak search --columns=application '${pkg}' 2>/dev/null | head -n 1 | awk '{print $1}')
                    if [ -n "$FLAT_ID" ] && [ "$FLAT_ID" != "No" ]; then
                        flatpak install --user -y flathub "$FLAT_ID" >/dev/null 2>&1 || flatpak install -y --noninteractive "$FLAT_ID" >/dev/null 2>&1
                        if [ $? -eq 0 ]; then echo "Installed $FLAT_ID via Flatpak!"; exit 0; fi
                    fi
                fi
                if command -v dnf >/dev/null 2>&1; then
                    pkexec dnf install -y '${pkg}' >/dev/null 2>&1 && echo "Installed ${pkg} via DNF!" && exit 0
                elif command -v apt-get >/dev/null 2>&1; then
                    pkexec apt-get install -y '${pkg}' >/dev/null 2>&1 && echo "Installed ${pkg} via APT!" && exit 0
                elif command -v pacman >/dev/null 2>&1; then
                    pkexec pacman -S --noconfirm '${pkg}' >/dev/null 2>&1 && echo "Installed ${pkg} via Pacman!" && exit 0
                fi
                echo "Unable to install ${pkg} automatically. Check the package name."
            `;
            const instOut = await this._ext._execCommandAsync(script);
            return (instOut || '').trim() || `Installation of ${pkg} started.`;
        }

        // 8. Launch / open application: "open firefox", "start terminal", "launch vlc"
        const openAppMatch = prompt.match(/^(?:open|start|launch)\s+(?:the\s+app\s+)?([a-zA-Z0-9._+-]+)$/i);
        if (openAppMatch) {
            const appQuery = openAppMatch[1].toLowerCase().trim();
            const apps = Gio.AppInfo.get_all();
            const matched = apps.find(a => {
                if (!a.should_show()) return false;
                const name = (a.get_name() || '').toLowerCase();
                const id = (a.get_id() || '').toLowerCase();
                const exec = (a.get_executable() || '').toLowerCase();
                return name.includes(appQuery) || id.includes(appQuery) || exec.includes(appQuery);
            });
            if (matched && !(await this._aiConfirm('Open this application?', matched.get_name()))) return 'Ok, I will not open it.';
            if (matched) {
                matched.launch([], null);
                return `I started ${matched.get_name()}.`;
            }
            const binPath = GLib.find_program_in_path(appQuery);
            if (binPath) {
                GLib.spawn_command_line_async(binPath);
                return `I started ${appQuery}.`;
            }
        }

        // Add todo command: "add todo ...", "remind me to ..."
        const todoMatch = prompt.match(/^(?:add\s+(?:a\s+)?(?:todo|task)|remind\s+me\s+to)\s+(.+)$/i);
        if (todoMatch) {
            const text = todoMatch[1].trim();
            if (!(await this._aiConfirm('Add this to the To-Do list?', text))) return 'Ok, not added.';
            this._ext._todos = this._ext._todos || [];
            const newTask = { text, done: false, topic: this._todoTopic || 'General' };
            this._ext._todos.push(newTask);
            this._commitTodos();
            if (typeof this._ext.createGoogleTaskAsync === 'function') {
                this._ext.createGoogleTaskAsync(newTask);
            }
            return `Done! Added "${text}" to your To-Do list.`;
        }

        // Quick info shortcuts only for short questions; longer/agentic
        // requests go to the AI agent instead of being hijacked by keywords.
        const words = lower.split(/\s+/).filter(Boolean);
        if (words.length > 8) return null;
        const has = (k) => new RegExp(`(^|[^a-z])${k}`, 'i').test(lower);

        // Disk / storage space query ("how much space do I have left", "disk space", etc.)
        if (has('gigabyte') || has('space') || has('storage') || has('disk') || has('gb')) {
            const dfOut = await this._ext._execCommandAsync("df -hP / | awk 'NR==2 {print $4 \" free of \" $2 \" (\" $5 \" used)\"}'");
            if (dfOut && dfOut.trim()) {
                return `You have ${dfOut.trim()} free on the main disk.`;
            }
        }

        // RAM / CPU / System query
        if (has('ram') || has('memory')) {
            const memOut = await this._ext._execCommandAsync("free -h | awk '/^Mem:/ {print $3 \" used of \" $2 \" (\" $7 \" available)\"}'");
            if (memOut && memOut.trim()) {
                return `RAM: ${memOut.trim()}.`;
            }
        }
        if (has('operating system') || has('os') || has('distro') || has('kernel')) {
            const osOut = await this._ext._execCommandAsync(". /etc/os-release 2>/dev/null && echo \"$PRETTY_NAME ($(uname -sr))\"");
            if (osOut && osOut.trim()) {
                return `You are running ${osOut.trim()} with GNOME Shell.`;
            }
        }

        // Todo status query
        if (has('todo') || has('task')) {
            const todos = this._ext._todos || [];
            const pending = todos.filter(t => !t.done);
            if (todos.length === 0) return 'Your To-Do list is empty.';
            if (pending.length === 0) return `You completed all ${todos.length} tasks!`;
            return `You have ${pending.length} tasks to complete: ${pending.map(t => t.text).join(', ')}.`;
        }

        // Calendar / today's plan query
        if (has('today') || has('agenda') || has('calendar') || has('event')) {
            const todayKey = this._dayKey(new Date());
            const evs = this._getEventsForDate(new Date());
            const todos = (this._ext._todos || []).filter(t => !t.done);
            const parts = [];
            if (evs.length > 0) {
                parts.push(`Today's events (${todayKey}): ${evs.map(e => `${e.time ? e.time + ' ' : ''}${e.title}`).join(', ')}.`);
            } else {
                parts.push(`You have no events in the calendar for today (${todayKey}).`);
            }
            if (todos.length > 0) {
                parts.push(`Open To-Do items (${todos.length}): ${todos.slice(0, 4).map(t => t.text).join(', ')}.`);
            }
            return parts.join(' ');
        }

        // Clipboard query
        if (has('clipboard') || has('notes') || has('summar')) {
            if (this._clips.length === 0) return 'Your clipboard is empty.';
            const latest = this._clips[0].text.replace(/\s+/g, ' ').trim();
            const short = latest.length > 160 ? `${latest.slice(0, 160)}…` : latest;
            return `Latest clipboard item (${this._clips.length} total): "${short}"`;
        }

        // Pomodoro control / tip
        if (has('pomodoro') || has('timer')) {
            if (has('start') || has('begin')) {
                if (!this._pomo.running) this._togglePomodoro();
                return `Pomodoro timer started (${this._pomo.workMins} min). Good luck!`;
            }
            if (has('stop') || has('pause')) {
                if (this._pomo.running) this._togglePomodoro();
                return 'Pomodoro timer paused.';
            }
            const mins = Math.ceil(this._pomo.remainingSec / 60);
            return `The Pomodoro is ${this._pomo.running ? 'running' : 'paused'} (${mins} min left, ${this._pomo.sessions} completed sessions).`;
        }

        if (has('focus') || has('concentrat')) {
            return 'Pick a single goal, close unnecessary notifications, and start a 25-minute Pomodoro session.';
        }

        if (has('what time') || has('time') || has('date')) {
            const now = GLib.DateTime.new_now_local();
            return `It is ${now.format('%H:%M')} on ${now.format('%d/%m/%Y')}.`;
        }

        return null;
    }

    _builtInConversationalFallback(prompt) {
        const lower = prompt.toLowerCase();
        if (lower.startsWith('hello') || lower.startsWith('hi') || lower.startsWith('hey') || lower.startsWith('ciao')) {
            return 'Hello! I am your agent: I can create folders/files, show or search documents, install or open apps, run commands, and manage your To-Do list and Pomodoro timer.';
        }
        return 'I can act on your PC: try "show documents", "create folder X on Desktop", "search file Y", "install app Z", "open firefox" or "run <command>".';
    }

    // =========================================================================
    // 7. PAGE 5: CALENDARIO (MONTH GRID + AGENDA & QUICK ADD)
    // =========================================================================

    _buildCalendarPage() {
        const page = new St.BoxLayout({
            style_class: 'di-page di-calendar-page',
            x_expand: true,
            y_expand: true,
        });

        // Left: Minimal Rounded Month Calendar Grid
        const monthCol = new St.BoxLayout({
            style_class: 'di-cal-month-col',
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Month Header (< Mese Anno >)
        const monthHead = new St.BoxLayout({
            style_class: 'di-cal-month-head',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._calMonthLabel = new St.Button({
            style_class: 'di-cal-month-title-btn',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            reactive: true,
        });
        this._calMonthText = new St.Label({
            text: 'November 2026',
            style_class: 'di-cal-month-title',
        });
        this._calMonthLabel.set_child(this._calMonthText);
        this._ext._connect(this._calMonthLabel, 'clicked', () => {
            this._calToday = new Date();
            this._calSelected = new Date(this._calToday.getFullYear(), this._calToday.getMonth(), this._calToday.getDate());
            this._calMonth = new Date(this._calToday.getFullYear(), this._calToday.getMonth(), 1);
            this._refreshCalendarUI();
        });

        const prevMonthBtn = this._makeRoundIconBtn('angie-chevron-left-symbolic.svg', 'di-cal-nav-btn', () => {
            this._calMonth = new Date(this._calMonth.getFullYear(), this._calMonth.getMonth() - 1, 1);
            this._refreshCalendarUI();
        }, 12);
        const nextMonthBtn = this._makeRoundIconBtn('angie-chevron-right-symbolic.svg', 'di-cal-nav-btn', () => {
            this._calMonth = new Date(this._calMonth.getFullYear(), this._calMonth.getMonth() + 1, 1);
            this._refreshCalendarUI();
        }, 12);

        monthHead.add_child(this._calMonthLabel);
        monthHead.add_child(prevMonthBtn);
        monthHead.add_child(nextMonthBtn);
        monthCol.add_child(monthHead);

        // Weekdays Header Row
        const wkRow = new St.BoxLayout({ style_class: 'di-cal-weekdays' });
        WEEKDAYS.forEach(w => {
            wkRow.add_child(new St.Label({
                text: w,
                style_class: 'di-cal-weekday',
                x_align: Clutter.ActorAlign.CENTER,
            }));
        });
        monthCol.add_child(wkRow);

        // Days Grid Container (6 rows x 7 cols)
        this._calGridBox = new St.BoxLayout({
            style_class: 'di-cal-grid',
            orientation: Clutter.Orientation.VERTICAL,
        });
        monthCol.add_child(this._calGridBox);
        page.add_child(monthCol);

        // Right: Selected Day Agenda + Quick Add Event Pill
        const agendaCol = new St.BoxLayout({
            style_class: 'di-cal-agenda-col',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        const agendaHead = new St.BoxLayout({
            style_class: 'di-cal-agenda-head',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._calSelectedTitle = new St.Label({
            text: 'Today',
            style_class: 'di-cal-agenda-title',
            x_expand: true,
        });
        const todayJumpBtn = new St.Button({
            label: 'Today',
            style_class: 'di-filter-pill',
            reactive: true,
            track_hover: true,
        });
        this._ext._connect(todayJumpBtn, 'clicked', () => {
            const now = new Date();
            this._calSelected = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            this._calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            this._refreshCalendarUI();
        });
        agendaHead.add_child(this._calSelectedTitle);
        agendaHead.add_child(todayJumpBtn);
        agendaCol.add_child(agendaHead);

        this._calEventsList = new St.BoxLayout({
            style_class: 'di-cal-events-list',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const agendaScroll = new St.ScrollView({
            style_class: 'di-cal-events-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            x_expand: true,
            y_expand: true,
        });
        agendaScroll.set_child(this._calEventsList);
        agendaCol.add_child(agendaScroll);

        // Quick Add Event Input Pill
        const addRow = new St.BoxLayout({
            style_class: 'di-cal-add-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._calEntry = new St.Entry({
            hint_text: 'New event (e.g. 15:30 Call)...',
            style_class: 'di-search-entry',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const addEventAction = () => {
            const raw = this._calEntry.get_text().trim();
            if (!raw) return;
            this._calEntry.set_text('');
            this._addCustomCalendarEvent(raw);
        };
        this._ext._connect(this._calEntry.clutter_text, 'activate', addEventAction);
        const addBtn = this._makeRoundIconBtn('angie-plus-symbolic.svg', 'di-cal-add-btn', addEventAction, 12);
        addRow.add_child(this._calEntry);
        addRow.add_child(addBtn);
        agendaCol.add_child(addRow);

        page.add_child(agendaCol);
        return page;
    }

    _dayKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    async _loadCalendarEvents() {
        const parsed = await this._loadJsonFile(this._calFilePath, []);
        this._calEvents = Array.isArray(parsed) ? parsed : [];
        this._refreshCalendarUI();
    }

    async _saveCalendarEvents() {
        await this._saveJsonFile(this._calFilePath, this._calEvents);
    }

    _getMonthEventsMap(year, month) {
        const set = new Set();
        const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
        for (const ev of this._calEvents) {
            if (ev.date && ev.date.startsWith(monthPrefix)) {
                set.add(ev.date);
            }
        }
        try {
            const eventSource = Main.panel.statusArea.dateMenu?._eventSource;
            if (eventSource && typeof eventSource.getEvents === 'function') {
                const begin = new Date(year, month, 1, 0, 0, 0);
                const end = new Date(year, month + 1, 0, 23, 59, 59);
                const rawEvs = eventSource.getEvents(begin, end) || [];
                for (const ev of rawEvs) {
                    const evDate = ev.date || ev.start;
                    if (evDate) {
                        set.add(this._dayKey(evDate));
                    }
                }
            }
        } catch (e) {}
        return set;
    }

    _addCustomCalendarEvent(rawText) {
        let time = '';
        let title = rawText;
        const match = rawText.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
        if (match) {
            time = match[1].padStart(5, '0');
            title = match[2].trim();
        }
        this._calEvents.push({
            id: Date.now(),
            date: this._dayKey(this._calSelected),
            time,
            title,
        });
        this._saveCalendarEvents();
        this._refreshCalendarUI();
    }

    _getEventsForDate(date) {
        const key = this._dayKey(date);
        const custom = this._calEvents.filter(e => e.date === key);

        // Also query GNOME Shell's built-in calendar eventSource if available
        const systemEvents = [];
        try {
            const eventSource = Main.panel.statusArea.dateMenu?._eventSource;
            if (eventSource && typeof eventSource.getEvents === 'function') {
                const begin = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
                const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
                const rawEvs = eventSource.getEvents(begin, end) || [];
                rawEvs.forEach(ev => {
                    const evDate = ev.date || ev.start;
                    const tStr = (evDate && !ev.allDay)
                        ? `${String(evDate.getHours()).padStart(2, '0')}:${String(evDate.getMinutes()).padStart(2, '0')}`
                        : '';
                    systemEvents.push({
                        id: null,
                        date: key,
                        time: tStr,
                        title: ev.summary || ev.title || 'Evento',
                        system: true,
                    });
                });
            }
        } catch (e) {}

        return [...systemEvents, ...custom].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    }

    _refreshCalendarUI() {
        if (!this._calGridBox || !this._calMonthText) return;
        const now = new Date();
        this._calToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const year = this._calMonth.getFullYear();
        const month = this._calMonth.getMonth();
        this._calMonthText.set_text(`${MONTHS[month]} ${year}`);

        this._calGridBox.destroy_all_children();

        const monthEventsSet = this._getMonthEventsMap(year, month);
        const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let dayNum = 1 - firstWeekday;
        for (let rowIdx = 0; rowIdx < 6; rowIdx++) {
            if (dayNum > daysInMonth && rowIdx > 0) break;
            const row = new St.BoxLayout({ style_class: 'di-cal-week-row' });

            for (let colIdx = 0; colIdx < 7; colIdx++) {
                if (dayNum < 1 || dayNum > daysInMonth) {
                    row.add_child(new St.Widget({ style_class: 'di-cal-day-empty' }));
                } else {
                    const cellDate = new Date(year, month, dayNum);
                    const cellKey = this._dayKey(cellDate);
                    const isToday = cellKey === this._dayKey(this._calToday);
                    const isSelected = cellKey === this._dayKey(this._calSelected);
                    const hasEvs = monthEventsSet.has(cellKey);

                    let cls = 'di-cal-day-btn';
                    if (isToday) cls += ' today';
                    else if (isSelected) cls += ' selected';
                    if (hasEvs) cls += ' has-events';

                    const dayBtn = new St.Button({
                        label: String(dayNum),
                        style_class: cls,
                        reactive: true,
                        track_hover: true,
                    });
                    this._ext._connect(dayBtn, 'clicked', () => {
                        this._calSelected = cellDate;
                        this._refreshCalendarUI();
                    });
                    row.add_child(dayBtn);
                }
                dayNum++;
            }
            this._calGridBox.add_child(row);
        }

        // Update Agenda List
        if (!this._calEventsList || !this._calSelectedTitle) return;
        const isSelToday = this._dayKey(this._calSelected) === this._dayKey(this._calToday);
        this._calSelectedTitle.set_text(
            isSelToday
                ? `Today, ${this._calSelected.getDate()} ${MONTHS[this._calSelected.getMonth()]}`
                : `${this._calSelected.getDate()} ${MONTHS[this._calSelected.getMonth()]} ${this._calSelected.getFullYear()}`
        );

        this._calEventsList.destroy_all_children();
        const dayEvents = this._getEventsForDate(this._calSelected);

        if (dayEvents.length === 0) {
            this._calEventsList.add_child(new St.Label({
                text: 'No events for this day',
                style_class: 'di-cal-empty-label',
            }));
            return;
        }

        dayEvents.forEach(ev => {
            const pill = new St.BoxLayout({
                style_class: 'di-cal-event-pill',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            pill.add_child(new St.Widget({
                style_class: ev.system ? 'di-cal-event-dot system' : 'di-cal-event-dot',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            if (ev.time) {
                pill.add_child(new St.Label({
                    text: ev.time,
                    style_class: 'di-cal-event-time',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            const titleLbl = new St.Label({
                text: ev.title,
                style_class: 'di-cal-event-title',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            titleLbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            pill.add_child(titleLbl);

            if (!ev.system && ev.id) {
                const delBtn = this._makeRoundIconBtn('angie-close-symbolic.svg', 'di-clip-mini-btn', () => {
                    this._calEvents = this._calEvents.filter(item => item.id !== ev.id);
                    this._saveCalendarEvents();
                    this._refreshCalendarUI();
                }, 11);
                pill.add_child(delBtn);
            }
            this._calEventsList.add_child(pill);
        });
    }

    // =========================================================================
    // 8. CLEANUP
    // =========================================================================

    destroy() {
        if (this._aiKeybindingAdded) {
            try { Main.wm.removeKeybinding('ai-shortcut'); } catch (e) {}
            this._aiKeybindingAdded = false;
        }
        if (this._aiProviderSig && this._settings) {
            try { this._settings.disconnect(this._aiProviderSig); } catch (e) {}
            this._aiProviderSig = 0;
        }
        if (this._aiLocalModelSig && this._settings) {
            try { this._settings.disconnect(this._aiLocalModelSig); } catch (e) {}
            this._aiLocalModelSig = 0;
        }
        if (this._aiPermResolve) { try { this._aiPermResolve(false); } catch (e) {} this._aiPermResolve = null; }
        if (this._ext._centerIsland) {
            this._ext._centerIsland.remove_all_transitions();
            this._ext._centerIsland.opacity = 255;
            this._ext._centerIsland.set_scale(1, 1);
        }
        this._disconnectNotificationWatch();
        this._destroyNotifIsland();
        [
            '_notifRefreshId',
            '_aiTypeTimer',
            '_aiHintTimer',
            '_accentIdleId',
            '_openTimer',
            '_closeTimer',
            '_closeFinishTimer',
            '_dragSeekThrottle',
            '_uiTickTimer',
            '_pomoTimerId',
            '_pomoWaveTimer',
            '_scrubberWaveTimer',
            '_dndWatchTimer',
            '_botAnimTimer',
            '_clipExpiryTimer',
        ].forEach(timer => this._clearTimer(timer));

        if (this._clipDropBanner) this._clipDropBanner.visible = false;

        if (this._accentSignal && this._ifaceSettings) {
            this._ifaceSettings.disconnect(this._accentSignal);
            this._accentSignal = 0;
        }
        if (this._pomoSettingSignals && this._settings) {
            this._pomoSettingSignals.forEach(id => {
                try { this._settings.disconnect(id); } catch (e) {}
            });
            this._pomoSettingSignals = [];
        }
        if (this._accentCssFile) {
            try { St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._accentCssFile); } catch (e) {}
            this._accentCssFile = null;
        }
        if (this._screenshotMonitors) {
            this._screenshotMonitors.forEach(m => { try { m.cancel(); } catch (e) {} });
            this._screenshotMonitors = [];
        }
        if (this._stageCaptureId) {
            try { global.stage.disconnect(this._stageCaptureId); } catch (e) {}
            this._stageCaptureId = 0;
        }

        if (this._compactPomoBox) {
            try { this._compactPomoBox.destroy(); } catch (e) {}
            this._compactPomoBox = null;
        }
        if (this._popup) {
            try { Main.layoutManager.removeChrome(this._popup); } catch (e) {}
            try { this._popup.destroy(); } catch (e) {}
            this._popup = null;
        }
    }
}

