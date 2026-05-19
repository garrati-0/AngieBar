import Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import UPowerGlib from 'gi://UPowerGlib';
import GdkPixbuf from 'gi://GdkPixbuf'; // IMPORTANTE: Manca questo import per l'estrazione dei colori
import Meta from 'gi://Meta';

export default class TopbarIslandsExtension extends Extension {
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.waybar-clone');

        // --- INIZIALIZZAZIONE SETTINGS DI SISTEMA MANCANTI ---
        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
        this._schemeSignalId = this._interfaceSettings.connect('changed::color-scheme', () => this._updateDynamicColors());


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

        // Corretto in Gio.Icon.new_for_string
        this._logoIcon = new St.Icon({
            style_class: 'logo-icon'
        });
        this._updateLogoIcon();
        this._logoIsland.set_child(this._logoIcon);

        this._logoIsland.connect('button-press-event', (actor, event) => {
            let button = event.get_button();
            if (button === 1) {
                // Tasto sinistro: comando personalizzato
                const cmd = this._settings.get_string('logo-command');
                GLib.spawn_command_line_async(cmd);
            } else if (button === 3) {
                // Tasto destro: apre l'overview/multitasking
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
        Main.panel._leftBox.add_child(this._logoIsland);
        Main.panel._leftBox.add_child(this._workspacesIsland);
        Main.panel._leftBox.add_child(this._netIsland);
        Main.panel._leftBox.add_child(this._privacyIsland);
        Main.panel._leftBox.show();

        Main.panel._rightBox.add_child(this._cpuIsland);
        Main.panel._rightBox.add_child(this._ramIsland);
        Main.panel._rightBox.add_child(this._rightIsland);
        Main.panel._rightBox.add_child(this._powerIsland);

        // --- 4. GESTIONE VISIBILITÀ E SETTINGS ---
        this._settingsSignals = [];
        const keys = [
            'show-logo', 'show-workspaces', 'show-net', 'show-clock',
            'show-cpu', 'show-ram', 'show-quick-settings', 'show-battery', 'show-power'
        ];
        keys.forEach(key => {
            this._settingsSignals.push(this._settings.connect(`changed::${key}`, () => this._updateVisibility()));
        });
        this._settingsSignals.push(this._settings.connect('changed::dynamic-color', () => this._updateDynamicColors()));
        this._settingsSignals.push(this._settings.connect('changed::custom-color', () => this._updateDynamicColors()));
        this._settingsSignals.push(this._settings.connect('changed::logo-icon-path', () => this._updateLogoIcon()));

        this._updateVisibility();
        this._updateDynamicColors();

        this._tickCount = 0;
        this._updateSystemIconsAsync();
        this._updateNet();
        this._updateCpu();
        this._updateRam();
        this._updatePrivacyAsync();

        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._tickCount++;
            this._timeLabel.set_text(this._getFormattedTime());

            if (this._tickCount % 3 === 0) {
                this._updateNet();
                this._updateCpu();
                this._updateRam();
                this._updatePrivacyAsync();
            }

            if (this._tickCount % 5 === 0) {
                this._updateSystemIconsAsync();
            }

            if (this._tickCount > 60) this._tickCount = 0;
            return GLib.SOURCE_CONTINUE;
        });

        this._initMedia();

        this._visualizerTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._animateWave();
            return GLib.SOURCE_CONTINUE;
        });
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

    _updateMediaUI() {
        if (this._mediaPlaying) {
            this._mediaWave.visible = true;
            this._centerIsland.add_style_class_name('media-active');
        } else {
            this._mediaArt.visible = false;
            this._mediaWave.visible = false;
            this._centerIsland.remove_style_class_name('media-active');
        }
    }

    _animateWave() {
        if (!this._mediaPlaying) {
            this._mediaWave.get_children().forEach(dot => { dot.translation_y = 0; });
            return;
        }
        this._mediaWave.get_children().forEach((dot, i) => {
            let t = Date.now() / 150;
            let offset = Math.sin(t + i * 1.5) * 5;
            dot.translation_y = offset;
            dot.opacity = 180 + Math.sin(t * 0.8 + i) * 75;
        });
    }

    disable() {
        if (this._schemeSignalId && this._interfaceSettings) {
            this._interfaceSettings.disconnect(this._schemeSignalId);
            this._schemeSignalId = null;
        }

        if (this._settingsSignals) {
            this._settingsSignals.forEach(id => this._settings.disconnect(id));
            this._settingsSignals = [];
        }

        this._settings = null;
        this._interfaceSettings = null;
        this._bgSettings = null;

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
        Main.panel.statusArea.dateMenu.show();
        Main.panel.statusArea.quickSettings.show();
        Main.panel.remove_style_class_name('transparent-panel');
    }

    _updateLogoIcon() {
        if (!this._logoIcon) return;
        const customPath = this._settings.get_string('logo-icon-path');
        if (customPath && GLib.file_test(customPath, GLib.FileTest.EXISTS)) {
            this._logoIcon.gicon = Gio.Icon.new_for_string(customPath);
        } else {
            this._logoIcon.gicon = Gio.Icon.new_for_string(`${this.path}/Framework Symbol SVG.svg`);
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
        let displayCount = Math.max(4, numWorkspaces);

        for (let i = 0; i < displayCount; i++) {
            let isActive = (i === activeIndex);
            let dotBtn = new St.Button({
                style_class: isActive ? 'workspace-dot active' : 'workspace-dot inactive',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                reactive: true, track_hover: true, can_focus: true
            });

            if (isActive) {
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

    _updateDynamicColors() {
        try {
            if (!this._settings || !this._interfaceSettings || !this._bgSettings) return;
            let useDynamic = this._settings.get_boolean('dynamic-color');

            if (!useDynamic) {
                let customColor = this._settings.get_string('custom-color');
                this._applyIslandStyle(customColor, '#cba6f7');
                return;
            }

            let isDark = this._interfaceSettings.get_string('color-scheme') !== 'prefer-light';
            let uri = isDark ? this._bgSettings.get_string('picture-uri-dark') : this._bgSettings.get_string('picture-uri');
            if (!uri || uri === '') uri = this._bgSettings.get_string('picture-uri');
            if (!uri || uri === '') {
                this._applyIslandStyle('rgba(24, 24, 37, 0.95)', '#cba6f7');
                return;
            }

            let [path] = GLib.filename_from_uri(uri);
            if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS)) {
                this._applyIslandStyle('rgba(24, 24, 37, 0.95)', '#cba6f7');
                return;
            }

            let pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 1, 1, false);
            let pixels = pixbuf.get_pixels();
            let r = pixels[0], g = pixels[1], b = pixels[2];

            let bgAlpha = 0.95;
            let bgColor = isDark
                ? `rgba(${Math.floor(r * 0.15 + 15)}, ${Math.floor(g * 0.15 + 15)}, ${Math.floor(b * 0.15 + 15)}, ${bgAlpha})`
                : `rgba(${Math.floor(r * 0.1 + 240)}, ${Math.floor(g * 0.1 + 240)}, ${Math.floor(b * 0.1 + 240)}, ${bgAlpha})`;

            let accentColor = `rgb(${r}, ${g}, ${b})`;
            this._applyIslandStyle(bgColor, accentColor);
        } catch (e) {
            console.error(`WaybarClone: Error updating colors: ${e}`);
        }
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
        this._tooltip.set_position(
            Math.floor(x + (w / 2) - (tw / 2)),
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

    _prefixToNetmask(prefix) {
        let mask = [];
        for (let i = 0; i < 4; i++) {
            let n = Math.min(prefix, 8);
            mask.push(256 - Math.pow(2, 8 - n));
            prefix -= n;
        }
        return mask.join('.');
    }

    _applyIslandStyle(bgColor, accentColor) {
        const islands = [
            this._centerIsland, this._rightIsland, this._powerIsland,
            this._logoIsland, this._cpuIsland, this._ramIsland,
            this._netIsland, this._workspacesIsland
        ];

        islands.forEach(island => {
            if (island) {
                island.set_style(`background-color: ${bgColor};`);
            }
        });
    }
}