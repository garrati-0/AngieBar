import Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import UPowerGlib from 'gi://UPowerGlib';


export default class TopbarIslandsExtension extends Extension {
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.waybar-clone');


        // --- 1. NASCONDIAMO GLI ELEMENTI ORIGINALI ---
        Main.panel._leftBox.get_children().forEach(c => c.hide());
        Main.panel.statusArea.dateMenu.hide(); // Rimossa la dipendenza da .container
        Main.panel.statusArea.quickSettings.hide();

        Main.panel.add_style_class_name('transparent-panel');

        // Variabili di stato per evitare aggiornamenti UI inutili
        this._isCheckingSysIcons = false;

        // --- 2. MODULO CENTRALE: ISOLA OROLOGIO ---
        this._centerIsland = new St.Button({
            style_class: 'custom-island',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true, track_hover: true, can_focus: true
        });

        this._centerBoxLayout = new St.BoxLayout({ style_class: 'center-island-box' });
        this._centerIsland.set_child(this._centerBoxLayout);

        this._mediaArt = new St.Icon({ style_class: 'media-art', visible: false });
        this._timeLabel = new St.Label({
            text: this._getFormattedTime(),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'time-label'
        });

        this._mediaWave = new St.BoxLayout({ style_class: 'media-wave', visible: false, y_align: Clutter.ActorAlign.CENTER });
        for (let i = 0; i < 4; i++) {
            let dot = new St.Widget({ style_class: 'wave-dot', y_align: Clutter.ActorAlign.CENTER });
            this._mediaWave.add_child(dot);
        }

        this._centerBoxLayout.add_child(this._mediaArt);
        this._centerBoxLayout.add_child(this._timeLabel);
        this._centerBoxLayout.add_child(this._mediaWave);

        this._centerIsland.connect('clicked', () => {
            let dateMenu = Main.panel.statusArea.dateMenu;
            dateMenu.menu.sourceActor = this._centerIsland;
            dateMenu.menu.toggle();
        });

        Main.panel._centerBox.add_child(this._centerIsland);

        // --- 3. MODULO DESTRO: ISOLA CONTROLLI RAPIDI ---
        this._rightIsland = new St.BoxLayout({
            style_class: 'custom-island right-island',
            y_align: Clutter.ActorAlign.CENTER
        });

        this._quickSettingsBtn = new St.Button({
            style_class: 'right-island-btn',
            reactive: true, track_hover: true, can_focus: true,
            y_align: Clutter.ActorAlign.CENTER
        });

        let qsBox = new St.BoxLayout({ style_class: 'qs-box' });
        this._wifiIcon = new St.Icon({ icon_name: 'network-wireless-signal-excellent-symbolic', style_class: 'system-icon', reactive: true });
        this._btIcon = new St.Icon({ icon_name: 'bluetooth-active-symbolic', style_class: 'system-icon' });
        this._volIcon = new St.Icon({ icon_name: 'audio-volume-high-symbolic', style_class: 'system-icon', reactive: true });

        this._wifiIcon.connect('enter-event', async () => {
            this._isWifiHovered = true;
            this._showTooltip(this._wifiIcon, 'WiFi: Loading...');
            let info = await this._getWifiInfoAsync();
            if (this._isWifiHovered) {
                this._showTooltip(this._wifiIcon, info);
            }
        });
        this._wifiIcon.connect('leave-event', () => {
            this._isWifiHovered = false;
            this._hideTooltip();
        });

        this._volIcon.connect('scroll-event', (actor, event) => {
            const direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.UP) {
                GLib.spawn_command_line_async('wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+');
            } else if (direction === Clutter.ScrollDirection.DOWN) {
                GLib.spawn_command_line_async('wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-');
            }
            this._updateSystemIconsAsync();
            return Clutter.EVENT_STOP;
        });

        qsBox.add_child(this._wifiIcon);
        qsBox.add_child(this._btIcon);
        qsBox.add_child(this._volIcon);
        this._quickSettingsBtn.set_child(qsBox);

        this._quickSettingsBtn.connect('clicked', () => {
            let qsMenu = Main.panel.statusArea.quickSettings.menu;
            qsMenu.sourceActor = this._rightIsland;
            qsMenu.toggle();
        });

        this._separator = new St.Label({ text: '|', style_class: 'island-separator', y_align: Clutter.ActorAlign.CENTER });

        // --- 3.C Sezione Destra (Batteria) ---
        this._batteryBtn = new St.Button({
            style_class: 'right-island-btn',
            reactive: true, track_hover: true, can_focus: true,
            y_align: Clutter.ActorAlign.CENTER
        });

        let batBox = new St.BoxLayout({ style_class: 'bat-box' });
        this._batteryLabel = new St.Label({ text: '...', style_class: 'battery-label', y_align: Clutter.ActorAlign.CENTER });
        this._chargingIcon = new St.Icon({ icon_name: 'battery-flash-symbolic', style_class: 'charging-icon', visible: false });
        this._batteryIcon = new St.Icon({
            icon_name: 'battery-level-100-symbolic',
            style_class: 'battery-icon'
        });

        this._batteryIcon.set_pivot_point(0.5, 0.5);
        this._batteryIcon.rotation_angle_z = -90;

        batBox.add_child(this._chargingIcon);
        batBox.add_child(this._batteryIcon);
        batBox.add_child(this._batteryLabel);
        this._batteryBtn.set_child(batBox);

        this._upowerClient = UPowerGlib.Client.new_full(null);
        this._displayDevice = this._upowerClient.get_display_device();
        this._showWattage = false;

        this._batteryBtn.connect('clicked', () => {
            this._showWattage = !this._showWattage;
            this._updateBattery();
        });

        this._batterySignals = [];
        if (this._displayDevice) {
            this._batterySignals.push(this._displayDevice.connect('notify::percentage', () => this._updateBattery()));
            this._batterySignals.push(this._displayDevice.connect('notify::state', () => this._updateBattery()));
            this._batterySignals.push(this._displayDevice.connect('notify::energy-rate', () => this._updateBattery()));
            this._updateBattery();
        }

        this._batteryBtn.connect('enter-event', () => {
            this._showTooltip(this._batteryBtn, this._getBatteryTooltip());
        });
        this._batteryBtn.connect('leave-event', () => this._hideTooltip());

        // --- 3.D MODULO POWER ---
        this._powerIsland = new St.Button({
            style_class: 'custom-island power-island',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true, track_hover: true, can_focus: true
        });

        let powerIcon = new St.Icon({ icon_name: 'system-shutdown-symbolic', style_class: 'power-icon' });
        this._powerIsland.set_child(powerIcon);
        this._powerIsland.connect('clicked', () => {
            const cmd = this._settings.get_string('power-command');
            GLib.spawn_command_line_async(cmd);
        });

        this._quickSettingsBtn.visible = this._settings.get_boolean('show-quick-settings');
        this._batteryBtn.visible = this._settings.get_boolean('show-battery');
        this._powerIsland.visible = this._settings.get_boolean('show-power');

        this._separator.visible = (this._quickSettingsBtn.visible && this._batteryBtn.visible);
        this._rightIsland.visible = (this._quickSettingsBtn.visible || this._batteryBtn.visible);

        this._rightIsland.add_child(this._quickSettingsBtn);
        this._rightIsland.add_child(this._separator);
        this._rightIsland.add_child(this._batteryBtn);

        // --- 3.E MODULO LOGO ---
        this._logoIsland = new St.Bin({
            style_class: 'logo-island',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true, track_hover: true, can_focus: true
        });

        // Icona SVG (usata solo per file SVG)
        this._logoIcon = new St.Icon({
            style_class: 'logo-icon'
        });
        this._logoIsland.set_child(this._logoIcon);
        this._updateLogoIcon();

        this._logoMenuManager = new PopupMenu.PopupMenuManager(this);
        this._logoMenu = new PopupMenu.PopupMenu(this._logoIsland, 0.5, St.Side.TOP);
        this._logoMenuManager.addMenu(this._logoMenu);
        Main.uiGroup.add_child(this._logoMenu.actor);
        this._logoMenu.actor.hide();
        
        this._buildLogoMenu();

        this._logoIsland.connect('button-press-event', (actor, event) => {
            const button = event.get_button();
            if (button === 1) {
                // Left-click
                let actionType = this._settings.get_int('logo-action');
                if (actionType === 1) {
                    this._logoMenu.toggle();
                } else {
                    GLib.spawn_command_line_async(this._settings.get_string('logo-command'));
                }
            } else if (button === 3) {
                // Right-click: toggle overview
                Main.overview.toggle();
            }
            return Clutter.EVENT_STOP;
        });

        // --- 3.G MODULI CPU E RAM ---
        this._cpuIsland = new St.BoxLayout({ style_class: 'custom-island cpu-island', y_align: Clutter.ActorAlign.CENTER });
        this._cpuIcon = new St.Icon({ gicon: Gio.Icon.new_for_string(`${this.path}/cpu-custom-symbolic.svg`), style_class: 'stats-icon cpu-icon' });
        this._cpuLabel = new St.Label({ text: '0.0%', style_class: 'stats-label cpu-label', y_align: Clutter.ActorAlign.CENTER });
        this._cpuIsland.add_child(this._cpuIcon);
        this._cpuIsland.add_child(this._cpuLabel);
        this._cpuIsland.reactive = true;
        this._cpuIsland.connect('enter-event', async () => {
            this._isCpuHovered = true;
            this._showTooltip(this._cpuIsland, `CPU: Loading...`);
            let info = await this._getCpuInfoAsync();
            if (this._isCpuHovered) {
                this._showTooltip(this._cpuIsland, info);
            }
        });
        this._cpuIsland.connect('leave-event', () => {
            this._isCpuHovered = false;
            this._hideTooltip();
        });

        this._ramIsland = new St.BoxLayout({ style_class: 'custom-island ram-island', y_align: Clutter.ActorAlign.CENTER });
        this._ramIcon = new St.Icon({ gicon: Gio.Icon.new_for_string(`${this.path}/ram-custom-symbolic.svg`), style_class: 'stats-icon ram-icon' });
        this._ramLabel = new St.Label({ text: '0.0%', style_class: 'stats-label ram-label', y_align: Clutter.ActorAlign.CENTER });
        this._ramIsland.add_child(this._ramIcon);
        this._ramIsland.add_child(this._ramLabel);
        this._ramIsland.reactive = true;
        this._ramIsland.connect('enter-event', () => {
            let details = this._ramDetailsText || 'Loading...';
            this._showTooltip(this._ramIsland, `Memory Details\nUsage: ${this._ramLabel.text}\nAmount: ${details}`);
        });
        this._ramIsland.connect('leave-event', () => this._hideTooltip());

        this._prevCpuTotal = 0;
        this._prevCpuIdle = 0;

        // --- 3.H MODULO VELOCITÀ RETE ---
        this._netIsland = new St.Button({
            style_class: 'custom-island net-island',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true, track_hover: true, can_focus: true
        });

        this._netBoxLayout = new St.BoxLayout({ style_class: 'net-island-layout' });
        this._netIsland.set_child(this._netBoxLayout);

        this._downBox = new St.BoxLayout({ style_class: 'net-box' });
        let downIcon = new St.Icon({ gicon: Gio.Icon.new_for_string(`${this.path}/net-down-symbolic.svg`), style_class: 'net-icon' });
        this._downLabel = new St.Label({ text: '0.0 KB/s', style_class: 'net-label', y_align: Clutter.ActorAlign.CENTER });
        this._downBox.add_child(downIcon);
        this._downBox.add_child(this._downLabel);

        this._upBox = new St.BoxLayout({ style_class: 'net-box' });
        let upIcon = new St.Icon({ gicon: Gio.Icon.new_for_string(`${this.path}/net-up-symbolic.svg`), style_class: 'net-icon' });
        this._upLabel = new St.Label({ text: '0.0 KB/s', style_class: 'net-label', y_align: Clutter.ActorAlign.CENTER });
        this._upBox.add_child(upIcon);
        this._upBox.add_child(this._upLabel);

        this._avgBox = new St.BoxLayout({ style_class: 'net-box', visible: false });
        this._avgIcon = new St.Icon({ icon_name: 'network-transmit-receive-symbolic', style_class: 'net-icon' });
        this._avgLabel = new St.Label({ text: '0.0 KB/s', style_class: 'net-label', y_align: Clutter.ActorAlign.CENTER });
        this._avgBox.add_child(this._avgIcon);
        this._avgBox.add_child(this._avgLabel);

        this._netBoxLayout.add_child(this._downBox);
        this._netBoxLayout.add_child(this._upBox);
        this._netBoxLayout.add_child(this._avgBox);

        this._showNetCompact = false;
        this._netIsland.connect('clicked', () => {
            this._showNetCompact = !this._showNetCompact;
            this._updateNet();
        });

        this._prevNetRx = 0;
        this._prevNetTx = 0;

        // --- 3.I MODULO TODO ---
        this._todoIsland = new St.Button({
            style_class: 'custom-island todo-island',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true, track_hover: true, can_focus: true
        });

        this._todoBoxLayout = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
        this._todoIsland.set_child(this._todoBoxLayout);

        let todoIcon = new St.Icon({
            icon_name: 'view-list-symbolic',
            style_class: 'todo-icon'
        });

        this._todoLabel = new St.Label({
            text: '0/0',
            style_class: 'todo-label',
            y_align: Clutter.ActorAlign.CENTER
        });

        this._todoBoxLayout.add_child(todoIcon);
        this._todoBoxLayout.add_child(this._todoLabel);

        this._todoMenuManager = new PopupMenu.PopupMenuManager(this);
        this._todoMenu = new PopupMenu.PopupMenu(this._todoIsland, 0.5, St.Side.TOP);
        this._todoMenuManager.addMenu(this._todoMenu);
        Main.uiGroup.add_child(this._todoMenu.actor);
        this._todoMenu.actor.hide();

        this._todoIsland.connect('clicked', () => {
            this._todoMenu.toggle();
        });

        this._buildTodoMenu();
        this._loadTodos();

        // --- TOOLTIP SYSTEM ---
        this._tooltip = new St.BoxLayout({
            style_class: 'custom-tooltip',
            visible: false,
            vertical: true
        });
        this._tooltipLabel = new St.Label({ style_class: 'tooltip-text' });
        this._tooltip.add_child(this._tooltipLabel);
        Main.layoutManager.addTopChrome(this._tooltip);

        // --- 3.F MODULO WORKSPACES ---
        this._wsManager = global.workspace_manager;
        this._wsSignals = [];
        this._workspacesIsland = new St.BoxLayout({ style_class: 'custom-island workspaces-island', y_align: Clutter.ActorAlign.CENTER });

        this._wsSignals.push(this._wsManager.connect('notify::n-workspaces', this._updateWorkspaces.bind(this)));
        this._wsSignals.push(this._wsManager.connect('workspace-switched', this._updateWorkspaces.bind(this)));
        this._updateWorkspaces();

        // --- 3.P MODULO PRIVACY ---
        this._privacyIsland = new St.BoxLayout({
            style_class: 'custom-island privacy-island',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true, track_hover: true, can_focus: true,
            visible: false
        });

        this._micBox = new St.BoxLayout({ style_class: 'privacy-box mic-box', visible: false, y_align: Clutter.ActorAlign.CENTER });
        let micIcon = new St.Icon({ icon_name: 'audio-input-microphone-symbolic', style_class: 'privacy-icon mic-icon' });
        this._micBox.add_child(micIcon);

        this._camBox = new St.BoxLayout({ style_class: 'privacy-box cam-box', visible: false, y_align: Clutter.ActorAlign.CENTER });
        let camIcon = new St.Icon({ icon_name: 'camera-web-symbolic', style_class: 'privacy-icon cam-icon' });
        this._camBox.add_child(camIcon);

        this._privacyIsland.add_child(this._micBox);
        this._privacyIsland.add_child(this._camBox);

        this._activeMicApps = [];
        this._activeCamApps = [];

        this._privacyIsland.connect('enter-event', () => {
            let text = [];
            if (this._activeMicApps.length > 0) {
                text.push(`Microphone in use by:\n- ${this._activeMicApps.join('\n- ')}`);
            }
            if (this._activeCamApps.length > 0) {
                text.push(`Camera in use by:\n- ${this._activeCamApps.join('\n- ')}`);
            }
            if (text.length > 0) {
                this._showTooltip(this._privacyIsland, text.join('\n\n'));
            }
        });
        this._privacyIsland.connect('leave-event', () => this._hideTooltip());

        // ASSEMBLAGGIO PANNELLO
        Main.panel._leftBox.add_style_class_name('waybar-left-box');
        Main.panel._leftBox.add_child(this._logoIsland);
        Main.panel._leftBox.add_child(this._workspacesIsland);
        Main.panel._leftBox.add_child(this._netIsland);
        Main.panel._leftBox.add_child(this._todoIsland);
        Main.panel._leftBox.add_child(this._privacyIsland);
        Main.panel._leftBox.show();

        Main.panel._rightBox.add_style_class_name('waybar-right-box');
        Main.panel._rightBox.add_child(this._cpuIsland);
        Main.panel._rightBox.add_child(this._ramIsland);
        Main.panel._rightBox.add_child(this._rightIsland);
        Main.panel._rightBox.add_child(this._powerIsland);

        // --- 4. VISIBILITY & SETTINGS SIGNALS ---
        this._settingsSignals = [];
        const visibilityKeys = [
            'show-logo', 'show-workspaces', 'show-net', 'show-todo', 'show-clock',
            'show-cpu', 'show-ram', 'show-quick-settings', 'show-battery', 'show-power'
        ];
        visibilityKeys.forEach(key => {
            this._settingsSignals.push(this._settings.connect(`changed::${key}`, () => this._updateVisibility()));
        });
        this._settingsSignals.push(this._settings.connect('changed::custom-color', () => this._applyColor()));
        this._settingsSignals.push(this._settings.connect('changed::island-opacity', () => this._applyColor()));
        this._settingsSignals.push(this._settings.connect('changed::logo-icon-path', () => this._updateLogoIcon()));
        this._settingsSignals.push(this._settings.connect('changed::logo-fill-circle', () => this._updateLogoIcon()));
        this._settingsSignals.push(this._settings.connect('changed::logo-menu-folders', () => this._buildLogoMenu()));
        
        this._settingsSignals.push(this._settings.connect('changed::cpu-color', () => this._applySecondaryColors()));
        this._settingsSignals.push(this._settings.connect('changed::ram-color', () => this._applySecondaryColors()));
        this._settingsSignals.push(this._settings.connect('changed::workspace-active-color', () => this._updateWorkspaces()));

        this._updateVisibility();
        this._applyColor();
        this._applySecondaryColors();

        this._tickCount = 0;
        this._updateSystemIconsAsync();
        this._updateNet();
        this._updateCpu();
        this._updateRam();
        this._updatePrivacyAsync();

        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._tickCount++;
            
            if (this._centerIsland.visible) {
                this._timeLabel.set_text(this._getFormattedTime());
            }

            if (this._tickCount % 3 === 0) {
                if (this._netIsland.visible) this._updateNet();
                if (this._cpuIsland.visible) this._updateCpu();
                if (this._ramIsland.visible) this._updateRam();
            }

            if (this._tickCount % 5 === 0) {
                if (this._quickSettingsBtn.visible) this._updateSystemIconsAsync();
                this._updatePrivacyAsync();
            }

            if (this._tickCount > 60) this._tickCount = 0;
            return GLib.SOURCE_CONTINUE;
        });

        this._initMedia();
        this._visualizerTimerId = null;
    }



    _initMedia() {
        this._mediaPlaying = false;
        this._players = new Map();
        this._lastArtUrl = null;
        this._dbus = Gio.DBus.session;
        this._mprisWatchId = this._dbus.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus',
            null, Gio.DBusSignalFlags.NONE,
            (conn, sender, object, interfaceName, signalName, parameters) => {
                let [name, oldOwner, newOwner] = parameters.deep_unpack();
                if (typeof name === 'string' && name.startsWith('org.mpris.MediaPlayer2.')) {
                    if (newOwner === '') this._removePlayer(name);
                    else this._addPlayer(name);
                }
            }
        );
        this._scanPlayers();
    }

    async _scanPlayers() {
        try {
            let result = await new Promise((resolve, reject) => {
                this._dbus.call(
                    'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
                    null, null, Gio.DBusCallFlags.NONE, -1, null,
                    (conn, res) => {
                        try { resolve(conn.call_finish(res)); } catch (e) { reject(e); }
                    }
                );
            });
            let unpacked = result.deep_unpack();
            let names = unpacked[0];
            if (Array.isArray(names)) {
                names.forEach(name => {
                    if (typeof name === 'string' && name.startsWith('org.mpris.MediaPlayer2.')) {
                        this._addPlayer(name);
                    }
                });
            }
        } catch (e) { console.error(`WaybarClone: Error scanning players: ${e}`); }
    }

    _addPlayer(name) {
        if (this._players.has(name)) return;
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null, name,
            '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', null,
            (obj, res) => {
                try {
                    let proxy = Gio.DBusProxy.new_for_bus_finish(res);
                    this._players.set(name, proxy);
                    proxy.connect('g-properties-changed', () => this._updateMediaStatus());
                    this._updateMediaStatus();
                } catch (e) { console.log(`WaybarClone: Failed to init player ${name}: ${e}`); }
            }
        );
    }

    _removePlayer(name) {
        if (this._players.has(name)) {
            this._players.delete(name);
            this._updateMediaStatus();
        }
    }

    async _updateMediaStatus() {
        let anyPlaying = false;
        let bestArtUrl = null;

        for (let [name, proxy] of this._players) {
            try {
                let status = proxy.PlaybackStatus || (proxy.get_cached_property('PlaybackStatus')?.deep_unpack());
                if (status === 'Playing') {
                    anyPlaying = true;
                    let metadata = proxy.Metadata || (proxy.get_cached_property('Metadata')?.deep_unpack());
                    if (metadata) {
                        let artVal = metadata['mpris:artUrl'] || metadata['xesam:albumArtURL'] || metadata['mpris:artURL'];
                        if (artVal) {
                            bestArtUrl = typeof artVal === 'string' ? artVal : (artVal.unpack ? artVal.unpack() : null);
                        }
                    }
                    if (bestArtUrl) break;
                }
            } catch (e) { console.log(`WaybarClone: Error reading player ${name}: ${e}`); }
        }

        this._mediaPlaying = anyPlaying;

        if (anyPlaying) {
            if (bestArtUrl) {
                await this._loadArt(bestArtUrl);
            } else {
                this._mediaArt.gicon = Gio.ThemedIcon.new('audio-x-generic-symbolic');
                this._mediaArt.show();
            }
        } else {
            this._mediaArt.hide();
            this._lastArtUrl = null;
        }

        this._updateMediaUI();
    }

    async _loadArt(url) {
        if (url === this._lastArtUrl) {
            this._mediaArt.show();
            return;
        }
        this._lastArtUrl = url;

        try {
            let localPath = null;
            if (url.startsWith('file://')) {
                localPath = GLib.uri_unescape_string(url.substring(7), null);
            } else if (url.startsWith('http')) {
                let cacheDir = GLib.get_user_cache_dir() + '/waybar-clone-media';
                GLib.mkdir_with_parents(cacheDir, 0o755);
                let hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1);
                let tempFile = Gio.File.new_for_path(`${cacheDir}/${hash}`);

                if (!tempFile.query_exists(null)) {
                    let remoteFile = Gio.File.new_for_uri(url);
                    await new Promise((resolve, reject) => {
                        remoteFile.copy_async(tempFile, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (obj, res) => {
                            try { resolve(obj.copy_finish(res)); } catch (e) { reject(e); }
                        });
                    });
                }
                localPath = tempFile.get_path();
            }

            if (localPath) {
                try {
                    let file = Gio.File.new_for_path(localPath);
                    this._mediaArt.gicon = new Gio.FileIcon({ file: file });
                    this._mediaArt.show();
                } catch (err) { this._mediaArt.hide(); }
            } else {
                this._mediaArt.hide();
            }
        } catch (e) { this._mediaArt.hide(); }
    }

    _startVisualizer() {
        if (!this._visualizerTimerId) {
            this._visualizerTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                this._animateWave();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _stopVisualizer() {
        if (this._visualizerTimerId) {
            GLib.source_remove(this._visualizerTimerId);
            this._visualizerTimerId = null;
            this._mediaWave.get_children().forEach(dot => { dot.translation_y = 0; });
        }
    }

    _updateMediaUI() {
        if (this._mediaPlaying) {
            this._mediaWave.visible = true;
            this._centerIsland.add_style_class_name('media-active');
            this._startVisualizer();
        } else {
            this._mediaArt.visible = false;
            this._mediaWave.visible = false;
            this._centerIsland.remove_style_class_name('media-active');
            this._stopVisualizer();
        }
    }

    _animateWave() {
        if (!this._mediaPlaying || !this._centerIsland.visible) return;
        this._mediaWave.get_children().forEach((dot, i) => {
            let t = Date.now() / 150;
            let offset = Math.sin(t + i * 1.5) * 5;
            dot.translation_y = offset;
            dot.opacity = 180 + Math.sin(t * 0.8 + i) * 75;
        });
    }

    disable() {
        if (this._settingsSignals) {
            this._settingsSignals.forEach(id => this._settings.disconnect(id));
            this._settingsSignals = [];
        }
        this._settings = null;

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._visualizerTimerId) {
            GLib.source_remove(this._visualizerTimerId);
            this._visualizerTimerId = null;
        }

        if (this._mprisWatchId) {
            this._dbus.signal_unsubscribe(this._mprisWatchId);
            this._mprisWatchId = null;
        }

        if (this._displayDevice && this._batterySignals) {
            this._batterySignals.forEach(id => this._displayDevice.disconnect(id));
            this._batterySignals = [];
        }

        if (this._wsSignals) {
            this._wsSignals.forEach(id => this._wsManager.disconnect(id));
            this._wsSignals = [];
        }

        const destroyAndRemove = (actor, box) => {
            if (actor) {
                try {
                    if (actor.get_parent() === box)
                        box.remove_child(actor);
                    actor.destroy();
                } catch (e) { }
            }
        };

        destroyAndRemove(this._workspacesIsland, Main.panel._leftBox);
        destroyAndRemove(this._logoIsland, Main.panel._leftBox);
        destroyAndRemove(this._privacyIsland, Main.panel._leftBox);
        destroyAndRemove(this._netIsland, Main.panel._leftBox);
        destroyAndRemove(this._todoIsland, Main.panel._leftBox);
        if (this._todoMenu) {
            this._todoMenuManager.removeMenu(this._todoMenu);
            this._todoMenu.destroy();
            this._todoMenu = null;
        }
        if (this._logoMenu) {
            if (this._logoMenuOpenSignal) {
                this._logoMenu.disconnect(this._logoMenuOpenSignal);
                this._logoMenuOpenSignal = null;
            }
            this._logoMenuManager.removeMenu(this._logoMenu);
            this._logoMenu.destroy();
            this._logoMenu = null;
        }
        destroyAndRemove(this._centerIsland, Main.panel._centerBox);
        destroyAndRemove(this._cpuIsland, Main.panel._rightBox);
        destroyAndRemove(this._ramIsland, Main.panel._rightBox);
        destroyAndRemove(this._rightIsland, Main.panel._rightBox);
        destroyAndRemove(this._powerIsland, Main.panel._rightBox);

        if (this._tooltip) {
            Main.layoutManager.removeChrome(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }


        if (this._players) {
            this._players.clear();
            this._players = null;
        }

        // --- RIPRISTINO DEI MENU DI SISTEMA (FONDAMENTALE) ---
        let dateMenu = Main.panel.statusArea.dateMenu;
        if (dateMenu && dateMenu.menu.sourceActor === this._centerIsland) {
            dateMenu.menu.sourceActor = dateMenu;
        }

        let qsMenu = Main.panel.statusArea.quickSettings;
        if (qsMenu && qsMenu.menu.sourceActor === this._rightIsland) {
            qsMenu.menu.sourceActor = qsMenu;
        }

        Main.panel._leftBox.get_children().forEach(c => c.show());
        Main.panel._leftBox.show();
        Main.panel._leftBox.remove_style_class_name('waybar-left-box');
        Main.panel._rightBox.remove_style_class_name('waybar-right-box');
        Main.panel.statusArea.dateMenu.show();
        Main.panel.statusArea.quickSettings.show();
        Main.panel.remove_style_class_name('transparent-panel');
    }

    _updateLogoIcon() {
        if (!this._logoIsland || !this._logoIcon) return;
        const customPath = this._settings.get_string('logo-icon-path');
        let imgPath;
        if (customPath && GLib.file_test(customPath, GLib.FileTest.EXISTS)) {
            imgPath = customPath;
        } else {
            imgPath = `${this.path}/Framework Symbol SVG.svg`;
        }

        // Ottieni il colore di sfondo corrente (stesso usato da _applyColor)
        const color   = this._settings.get_string('custom-color');
        const opacity = this._settings.get_double('island-opacity');
        const bgColor = this._colorWithOpacity(color, opacity);

        const fillCircle = this._settings.get_boolean('logo-fill-circle');

        if (fillCircle) {
            // Modalità cover: l'immagine ritaglia e riempie tutto il cerchio
            this._logoIcon.hide();
            this._logoIsland.set_style(
                `background-color: ${bgColor}; background-image: url('${imgPath}'); background-size: cover; background-position: center;`
            );
        } else {
            // Modalità icona: St.Icon centrato, sfondo normale con trasparenza
            this._logoIcon.gicon = Gio.Icon.new_for_string(imgPath);
            this._logoIcon.show();
            this._logoIsland.set_style(`background-color: ${bgColor};`);
        }
    }

    _execCommandAsync(cmd) {
        return new Promise((resolve) => {
            try {
                let proc = Gio.Subprocess.new(['/bin/sh', '-c', cmd], Gio.SubprocessFlags.STDOUT_PIPE);
                proc.communicate_utf8_async(null, null, (obj, res) => {
                    try {
                        let [, stdout] = obj.communicate_utf8_finish(res);
                        resolve(stdout || '');
                    } catch (e) { resolve(''); }
                });
            } catch (e) { resolve(''); }
        });
    }

    _updateWorkspaces() {
        this._workspacesIsland.destroy_all_children();
        let numWorkspaces = this._wsManager.n_workspaces;
        let activeIndex = this._wsManager.get_active_workspace_index();

        for (let i = 0; i < numWorkspaces; i++) {
            let isActive = (i === activeIndex);
            let dotBtn = new St.Button({
                style_class: isActive ? 'workspace-dot active' : 'workspace-dot inactive',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                reactive: true, track_hover: true, can_focus: true
            });

            if (isActive) {
                let wsColor = this._settings.get_string('workspace-active-color');
                let shadowColor = this._colorWithOpacity(wsColor, 0.4);
                dotBtn.set_style(`background-color: ${wsColor} !important; box-shadow: 0px 0px 8px ${shadowColor};`);

                let innerDot = new St.Widget({ style_class: 'workspace-dot-inner', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
                dotBtn.set_child(innerDot);
            }

            dotBtn.connect('clicked', () => {
                if (i < numWorkspaces) {
                    this._wsManager.get_workspace_by_index(i).activate(global.get_current_time());
                }
            });

            this._workspacesIsland.add_child(dotBtn);
        }
    }

    _getFormattedTime() {
        let now = GLib.DateTime.new_now_local();
        return now.format('%a %b %d %H:%M');
    }

    _updateBattery() {
        if (!this._displayDevice) return;

        let percent = Math.floor(this._displayDevice.percentage);
        let state = this._displayDevice.state;
        let isDischarging = (state === UPowerGlib.DeviceState.DISCHARGING);
        let isCharging = (state === UPowerGlib.DeviceState.CHARGING);

        if (isCharging) {
            this._batteryIcon.gicon = Gio.Icon.new_for_string(`${this.path}/charging-battery-svgrepo-com.svg`);
            this._batteryIcon.rotation_angle_z = 0;
            this._batteryIcon.add_style_class_name('battery-charging');
            this._chargingIcon.visible = false;
        } else {
            let iconLevel = Math.floor(percent / 10) * 10;
            this._batteryIcon.gicon = null;
            this._batteryIcon.icon_name = `battery-level-${iconLevel}-symbolic`;
            this._batteryIcon.rotation_angle_z = -90;
            this._batteryIcon.remove_style_class_name('battery-charging');
            this._chargingIcon.visible = false;
        }

        this._batteryIcon.remove_style_class_name('battery-low');
        this._batteryIcon.remove_style_class_name('battery-critical');

        if (isDischarging) {
            if (percent <= 20) this._batteryIcon.add_style_class_name('battery-critical');
            else if (percent <= 40) this._batteryIcon.add_style_class_name('battery-low');
        }

        if (this._showWattage) {
            let watts = this._displayDevice.energy_rate.toFixed(1);
            this._batteryLabel.set_text(`${watts}W`);
        } else {
            this._batteryLabel.set_text(`${percent}%`);
        }
    }

    async _getCpuInfoAsync() {
        try {
            let tempCmd = "sensors 2>/dev/null | grep 'Tctl' | awk '{print $2}' | tr -d '+'";
            let tempStr = await this._execCommandAsync(tempCmd);
            let temp = tempStr.trim() || 'N/A';

            if (temp === 'N/A' || temp === '') {
                let tempCmd2 = "cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null";
                let tempStr2 = await this._execCommandAsync(tempCmd2);
                if (tempStr2.trim()) {
                    temp = (parseInt(tempStr2.trim()) / 1000).toFixed(1) + '°C';
                } else {
                    temp = 'N/A';
                }
            }

            let [res, contents] = GLib.file_get_contents('/proc/cpuinfo');
            let freqs = [];
            if (res) {
                let text = new TextDecoder().decode(contents);
                let lines = text.split('\n');
                for (let line of lines) {
                    if (line.startsWith('cpu MHz')) {
                        let freq = parseFloat(line.split(':')[1].trim());
                        freqs.push(freq.toFixed(0) + ' MHz');
                    }
                }
            }

            let tooltipText = `CPU Usage Details\nLoad: ${this._cpuLabel.text}\nTemp: ${temp}\n\nCores:\n`;
            for (let i = 0; i < freqs.length; i++) {
                tooltipText += `Core ${i}: ${freqs[i]}\n`;
            }
            return tooltipText.trim();
        } catch (e) {
            return `CPU Usage Details\nLoad: ${this._cpuLabel.text}`;
        }
    }

    _updateCpu() {
        try {
            let [res, contents] = GLib.file_get_contents('/proc/stat');
            if (res) {
                let decoder = new TextDecoder();
                let text = decoder.decode(contents);
                let line = text.split('\n')[0];
                let parts = line.split(/\s+/);
                let idle = parseInt(parts[4]);
                let total = parts.slice(1, 8).reduce((acc, val) => acc + parseInt(val), 0);

                let diffIdle = idle - this._prevCpuIdle;
                let diffTotal = total - this._prevCpuTotal;
                let usage = diffTotal > 0 ? 100 * (1 - diffIdle / diffTotal) : 0;

                this._cpuLabel.set_text(`${usage.toFixed(1)}%`);
                this._prevCpuTotal = total;
                this._prevCpuIdle = idle;
            }
        } catch (e) { this._cpuLabel.set_text('err%'); }
    }

    _updateRam() {
        try {
            let [res, contents] = GLib.file_get_contents('/proc/meminfo');
            if (res) {
                let decoder = new TextDecoder();
                let text = decoder.decode(contents);
                let lines = text.split('\n');
                let memTotal = 0, memAvailable = 0;
                for (let line of lines) {
                    if (line.startsWith('MemTotal:')) memTotal = parseInt(line.split(/\s+/)[1]);
                    if (line.startsWith('MemAvailable:')) memAvailable = parseInt(line.split(/\s+/)[1]);
                }
                if (memTotal > 0) {
                    let memUsed = memTotal - memAvailable;
                    let usedGB = (memUsed / 1024 / 1024).toFixed(1);
                    let availableGB = (memAvailable / 1024 / 1024).toFixed(1);
                    this._ramDetailsText = `${usedGB}GB / ${availableGB}GB`;

                    let usage = 100 * (1 - memAvailable / memTotal);
                    this._ramLabel.set_text(`${usage.toFixed(1)}%`);
                }
            }
        } catch (e) { this._ramLabel.set_text('err%'); }
    }

    _updateNet() {
        try {
            let [res, contents] = GLib.file_get_contents('/proc/net/dev');
            if (res) {
                let decoder = new TextDecoder();
                let text = decoder.decode(contents);
                let lines = text.split('\n');
                let totalRx = 0, totalTx = 0;

                for (let i = 2; i < lines.length; i++) {
                    let line = lines[i].trim();
                    if (!line || line.startsWith('lo:')) continue;
                    let parts = line.split(/\s+/);
                    if (parts.length > 9) {
                        totalRx += parseInt(parts[1]);
                        totalTx += parseInt(parts[9]);
                    }
                }

                if (this._prevNetRx > 0) {
                    let diffRx = ((totalRx - this._prevNetRx) / 1024) / 3;
                    let diffTx = ((totalTx - this._prevNetTx) / 1024) / 3;
                    let avg = (diffRx + diffTx) / 2;

                    this._downLabel.set_text(this._formatNetSpeed(diffRx));
                    this._upLabel.set_text(this._formatNetSpeed(diffTx));
                    this._avgLabel.set_text(this._formatNetSpeed(avg));

                    this._downBox.visible = !this._showNetCompact;
                    this._upBox.visible = !this._showNetCompact;
                    this._avgBox.visible = this._showNetCompact;
                }

                this._prevNetRx = totalRx;
                this._prevNetTx = totalTx;
            }
        } catch (e) { this._downLabel.set_text('err'); }
    }

    _formatNetSpeed(kb) {
        if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB/s`;
        return `${kb.toFixed(1)} KB/s`;
    }

    async _updatePrivacyAsync() {
        if (this._isCheckingPrivacy) return;
        this._isCheckingPrivacy = true;
        try {
            let out = await this._execCommandAsync('pw-dump');
            if (out) {
                let data = JSON.parse(out);
                let micApps = [];
                let camApps = [];

                data.forEach(n => {
                    if (n.info && n.info.props && (n.info.state === 'running' || n.info.props['stream.is-live'])) {
                        let props = n.info.props;
                        let mediaClass = props['media.class'];
                        if (mediaClass === 'Stream/Input/Audio' || mediaClass === 'Stream/Input/Video') {
                            let appName = props['application.name'] || props['node.name'] || 'Unknown';
                            if (appName === 'gnome-shell' || appName === 'mutter-devkit' || appName === 'WirePlumber' || appName.includes('xdg-desktop-portal') || appName === 'Mutter' || appName === 'pipewire') return;

                            if (mediaClass === 'Stream/Input/Audio') {
                                if (!micApps.includes(appName)) micApps.push(appName);
                            } else {
                                if (!camApps.includes(appName)) camApps.push(appName);
                            }
                        }
                    }
                });

                this._activeMicApps = micApps;
                this._activeCamApps = camApps;

                let micActive = micApps.length > 0;
                let camActive = camApps.length > 0;

                this._micBox.visible = micActive;
                this._camBox.visible = camActive;
                this._privacyIsland.visible = micActive || camActive;
            }
        } catch (e) { }
        this._isCheckingPrivacy = false;
    }

    async _updateSystemIconsAsync() {
        if (this._isCheckingSysIcons) return;
        this._isCheckingSysIcons = true;

        try {
            let [volOut, wifiOut, btOut] = await Promise.all([
                this._execCommandAsync('wpctl get-volume @DEFAULT_AUDIO_SINK@'),
                this._execCommandAsync('nmcli -t -f connectivity g'),
                this._execCommandAsync('rfkill list bluetooth')
            ]);

            if (volOut) {
                let isMuted = volOut.includes('[MUTED]');
                let volMatch = volOut.match(/Volume: (\d\.\d+)/);
                let volume = volMatch ? parseFloat(volMatch[1]) : 0;

                if (isMuted || volume === 0) {
                    this._volIcon.icon_name = 'audio-volume-muted-symbolic';
                    this._volIcon.add_style_class_name('icon-disabled');
                } else {
                    this._volIcon.remove_style_class_name('icon-disabled');
                    if (volume < 0.33) this._volIcon.icon_name = 'audio-volume-low-symbolic';
                    else if (volume < 0.66) this._volIcon.icon_name = 'audio-volume-medium-symbolic';
                    else this._volIcon.icon_name = 'audio-volume-high-symbolic';
                }
            }

            if (wifiOut) {
                let status = wifiOut.trim();
                if (status === 'full') {
                    this._wifiIcon.icon_name = 'network-wireless-signal-excellent-symbolic';
                    this._wifiIcon.remove_style_class_name('icon-disabled');
                } else if (status === 'none') {
                    this._wifiIcon.icon_name = 'network-wireless-offline-symbolic';
                    this._wifiIcon.add_style_class_name('icon-disabled');
                } else {
                    this._wifiIcon.icon_name = 'network-wireless-acquiring-symbolic';
                }
            }

            if (btOut) {
                if (btOut.includes('Soft blocked: yes') || !btOut.includes('bluetooth')) {
                    this._btIcon.icon_name = 'bluetooth-disabled-symbolic';
                    this._btIcon.add_style_class_name('icon-disabled');
                } else {
                    this._btIcon.icon_name = 'bluetooth-active-symbolic';
                    this._btIcon.remove_style_class_name('icon-disabled');
                }
            }
        } finally {
            this._isCheckingSysIcons = false;
        }
    }

    _updateVisibility() {
        if (!this._settings) return;
        this._logoIsland.visible = this._settings.get_boolean('show-logo');
        this._workspacesIsland.visible = this._settings.get_boolean('show-workspaces');
        this._netIsland.visible = this._settings.get_boolean('show-net');
        this._todoIsland.visible = this._settings.get_boolean('show-todo');
        this._centerIsland.visible = this._settings.get_boolean('show-clock');
        this._cpuIsland.visible = this._settings.get_boolean('show-cpu');
        this._ramIsland.visible = this._settings.get_boolean('show-ram');
        this._quickSettingsBtn.visible = this._settings.get_boolean('show-quick-settings');
        this._batteryBtn.visible = this._settings.get_boolean('show-battery');
        this._powerIsland.visible = this._settings.get_boolean('show-power');

        if (this._separator)
            this._separator.visible = (this._quickSettingsBtn.visible && this._batteryBtn.visible);

        if (this._rightIsland)
            this._rightIsland.visible = (this._quickSettingsBtn.visible || this._batteryBtn.visible);
    }

    // ── Color helpers ─────────────────────────────────────────────────────────

    /**
     * Convert any CSS color string (hex #rgb/#rrggbb, rgb(), rgba()) to an
     * rgba() string using the given alpha value.
     */
    _colorWithOpacity(color, alpha) {
        color = (color || '').trim();

        const rgbaMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/i);
        if (rgbaMatch)
            return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${alpha})`;

        let hex = color.replace('#', '');
        if (hex.length === 3)
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (hex.length === 6) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }

        return color; // Fallback
    }

    /** Apply the current custom-color + island-opacity to every island. */
    _applyColor() {
        if (!this._settings) return;
        const color   = this._settings.get_string('custom-color');
        const opacity = this._settings.get_double('island-opacity');
        const final   = this._colorWithOpacity(color, opacity);

        const islands = [
            this._centerIsland, this._rightIsland, this._powerIsland,
            this._cpuIsland,   this._ramIsland,
            this._netIsland,    this._todoIsland,  this._workspacesIsland
        ];
        islands.forEach(island => island?.set_style(`background-color: ${final};`));

        // Il logo ha uno stile composto (può avere background-image), lo aggiorna separatamente
        this._updateLogoIcon();
    }

    _applySecondaryColors() {
        if (!this._settings) return;
        const cpuColor = this._settings.get_string('cpu-color');
        const ramColor = this._settings.get_string('ram-color');

        if (this._cpuIcon) this._cpuIcon.set_style(`color: ${cpuColor} !important;`);
        if (this._cpuLabel) this._cpuLabel.set_style(`color: ${cpuColor} !important;`);
        
        if (this._ramIcon) this._ramIcon.set_style(`color: ${ramColor} !important;`);
        if (this._ramLabel) this._ramLabel.set_style(`color: ${ramColor} !important;`);
    }

    _showTooltip(actor, text) {
        if (!text || text === '') return;
        this._tooltipLabel.set_text(text);
        this._tooltip.visible = true;
        this._tooltip.opacity = 255;

        let [x, y] = actor.get_transformed_position();
        let [w, h] = actor.get_transformed_size();

        // Posizionamento centrato sotto l'elemento
        let tw = this._tooltip.get_preferred_width(-1)[1];
        let tooltipX = Math.floor(x + (w / 2) - (tw / 2));

        let monitor = Main.layoutManager.primaryMonitor;
        if (monitor) {
            let maxX = monitor.x + monitor.width;
            if (tooltipX + tw > maxX - 10) {
                tooltipX = maxX - tw - 10;
            }
            if (tooltipX < monitor.x + 10) {
                tooltipX = monitor.x + 10;
            }
        }

        this._tooltip.set_position(
            tooltipX,
            Math.floor(y + h + 10)
        );
    }

    _hideTooltip() {
        if (this._tooltip) this._tooltip.visible = false;
    }

    _getBatteryTooltip() {
        if (!this._displayDevice) return 'Info not available';
        let state = this._displayDevice.state;
        let time = 0;
        let label = '';

        if (state === UPowerGlib.DeviceState.CHARGING) {
            time = this._displayDevice.time_to_full;
            label = 'Time to full: ';
        } else if (state === UPowerGlib.DeviceState.DISCHARGING) {
            time = this._displayDevice.time_to_empty;
            label = 'Time to empty: ';
        } else {
            return 'Battery Charged';
        }

        if (time <= 0) return 'Calculating remaining time...';

        let hours = Math.floor(time / 3600);
        let mins = Math.floor((time % 3600) / 60);
        return `${label}${hours}h ${mins}m`;
    }

    async _getWifiInfoAsync() {
        try {
            // Metodo più diretto per l'SSID attivo
            let ssid = await this._execCommandAsync("nmcli -t -f active,ssid device wifi list | grep '^yes' | cut -d: -f2 | head -n 1");
            ssid = ssid.trim();

            if (!ssid) {
                // Fallback: prova a vedere se c'è una connessione attiva generica di tipo wireless
                ssid = await this._execCommandAsync("nmcli -t -f name,type connection show --active | grep '802-11-wireless' | cut -d: -f1 | head -n 1");
                ssid = ssid.trim();
            }

            if (!ssid) return 'WiFi: Disconnected';

            let signalOut = await this._execCommandAsync("nmcli -t -f active,signal device wifi list | grep '^yes' | cut -d: -f2 | head -n 1");
            let signal = signalOut.trim() || 'N/A';

            let ipOut = await this._execCommandAsync("hostname -I | awk '{print $1}'");
            let ipAddr = ipOut.trim() || 'N/A';

            return `  ${ssid}\n󰠠  ${signal}%\n  ${ipAddr}`;
        } catch (e) { return 'WiFi: Error'; }
    }




    _loadTodos() {
        this._todos = [];
        this._todoFilePath = GLib.get_user_config_dir() + '/waybar-clone-todos.json';
        try {
            let [res, contents] = GLib.file_get_contents(this._todoFilePath);
            if (res) {
                this._todos = JSON.parse(new TextDecoder().decode(contents));
            }
        } catch (e) {
            this._todos = [
                { text: 'Finish bar setup', done: true },
                { text: 'Drink water', done: false },
                { text: 'Write code for the widget', done: false }
            ];
            this._saveTodos();
        }
        this._updateTodoUI();
    }

    _saveTodos() {
        try {
            let data = JSON.stringify(this._todos);
            GLib.file_set_contents(this._todoFilePath, data);
        } catch (e) { }
    }

    _buildTodoMenu() {
        this._todoMenu.box.add_style_class_name('todo-popup-box');

        // Header
        let headerBox = new St.BoxLayout({ style_class: 'todo-header', x_expand: true });
        let headerTitleBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, style_class: 'todo-header-title-box' });
        let headerIcon = new St.Icon({ icon_name: 'view-list-symbolic', style_class: 'todo-header-icon' });
        let headerTitle = new St.Label({ text: 'To-Do List', style_class: 'todo-header-title', y_align: Clutter.ActorAlign.CENTER });
        headerTitleBox.add_child(headerIcon);
        headerTitleBox.add_child(headerTitle);

        let clearBtn = new St.Button({ style_class: 'todo-clear-btn', label: 'Clear completed', y_align: Clutter.ActorAlign.CENTER, x_expand: true, x_align: Clutter.ActorAlign.END });
        clearBtn.connect('clicked', () => {
            this._todos = this._todos.filter(t => !t.done);
            this._saveTodos();
            this._updateTodoUI();
        });

        headerBox.add_child(headerTitleBox);
        headerBox.add_child(clearBtn);

        let headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        headerItem.add_child(headerBox);
        headerItem.set_style_class_name('todo-menu-item-header');
        this._todoMenu.addMenuItem(headerItem);

        // Input
        let inputBox = new St.BoxLayout({ style_class: 'todo-input-box', x_expand: true });
        this._todoEntry = new St.Entry({ hint_text: 'Add a task...', style_class: 'todo-entry', x_expand: true });
        let addBtn = new St.Button({ style_class: 'todo-add-btn' });
        let addIcon = new St.Icon({ icon_name: 'list-add-symbolic', style_class: 'todo-add-icon' });
        addBtn.set_child(addIcon);

        inputBox.add_child(this._todoEntry);
        inputBox.add_child(addBtn);

        let addAction = () => {
            let text = this._todoEntry.get_text().trim();
            if (text) {
                this._todos.push({ text: text, done: false });
                this._todoEntry.set_text('');
                this._saveTodos();
                this._updateTodoUI();
            }
        };
        addBtn.connect('clicked', addAction);
        this._todoEntry.clutter_text.connect('activate', addAction);

        let inputItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        inputItem.add_child(inputBox);
        inputItem.set_style_class_name('todo-menu-item-input');
        this._todoMenu.addMenuItem(inputItem);

        // List container
        this._todoListContainer = new St.BoxLayout({ vertical: true, style_class: 'todo-list-container' });
        let listItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        listItem.add_child(this._todoListContainer);
        listItem.set_style_class_name('todo-menu-item-list');
        this._todoMenu.addMenuItem(listItem);
    }

    _updateTodoUI() {
        this._todoListContainer.destroy_all_children();
        let doneCount = 0;

        this._todos.forEach((task) => {
            if (task.done) doneCount++;

            let taskBox = new St.BoxLayout({ style_class: 'todo-task-box', reactive: true, track_hover: true });
            let checkBtn = new St.Button({ style_class: task.done ? 'todo-check-btn checked' : 'todo-check-btn', y_align: Clutter.ActorAlign.CENTER });
            let checkIcon = new St.Icon({ icon_name: 'object-select-symbolic', style_class: 'todo-check-icon' });
            if (task.done) checkBtn.set_child(checkIcon);

            let taskLabel = new St.Label({ text: task.text, style_class: task.done ? 'todo-task-label done' : 'todo-task-label', y_align: Clutter.ActorAlign.CENTER, x_expand: true });

            taskBox.add_child(checkBtn);
            taskBox.add_child(taskLabel);

            taskBox.connect('button-press-event', () => {
                task.done = !task.done;
                this._saveTodos();
                this._updateTodoUI();
                return Clutter.EVENT_STOP;
            });

            this._todoListContainer.add_child(taskBox);
        });

        this._todoLabel.set_text(`${this._todos.length - doneCount}/${this._todos.length}`);
    }

    _buildLogoMenu() {
        if (!this._logoMenu) return;
        this._logoMenu.removeAll();

        // 1. Impostazioni
        let settingsItem = new PopupMenu.PopupMenuItem('Impostazioni');
        settingsItem.connect('activate', () => {
            GLib.spawn_command_line_async('gnome-control-center');
        });
        this._logoMenu.addMenuItem(settingsItem);

        // 2. File (Submenu with folders)
        let fileSubMenu = new PopupMenu.PopupSubMenuMenuItem('File');
        let foldersStr = this._settings.get_string('logo-menu-folders');
        let folders = foldersStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
        
        folders.forEach(folder => {
            let label = folder.split('/').pop() || folder;
            let folderItem = new PopupMenu.PopupMenuItem(label);
            folderItem.connect('activate', () => {
                let expandedPath = folder.startsWith('~/') ? folder.replace('~', GLib.get_home_dir()) : folder;
                GLib.spawn_command_line_async(`xdg-open "${expandedPath}"`);
            });
            fileSubMenu.menu.addMenuItem(folderItem);
        });
        
        if (folders.length === 0) {
            let emptyItem = new PopupMenu.PopupMenuItem('Nessuna cartella configurata');
            emptyItem.reactive = false;
            fileSubMenu.menu.addMenuItem(emptyItem);
        }
        
        this._logoMenu.addMenuItem(fileSubMenu);

        // 3. Terminale
        let termItem = new PopupMenu.PopupMenuItem('Terminale');
        termItem.connect('activate', () => {
            GLib.spawn_command_line_async('ptyxis');
        });
        this._logoMenu.addMenuItem(termItem);

        // Separator
        this._logoMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 4. Uptime
        this._uptimeItem = new PopupMenu.PopupMenuItem('Uptime: ...');
        this._uptimeItem.reactive = false;
        this._logoMenu.addMenuItem(this._uptimeItem);

        if (!this._logoMenuOpenSignal) {
            this._logoMenuOpenSignal = this._logoMenu.connect('open-state-changed', (menu, open) => {
                if (open && this._uptimeItem) {
                    this._execCommandAsync('uptime -p').then(out => {
                        let uptime = out.trim().replace('up ', '');
                        if (uptime) {
                            this._uptimeItem.label.set_text(`Uptime: ${uptime}`);
                        }
                    });
                }
            });
        }
    }
}