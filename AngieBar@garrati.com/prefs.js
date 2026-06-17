import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WaybarClonePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.waybar-clone');

        // ============================================================
        // PAGE – General Settings
        // ============================================================
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic'
        });
        window.add(page);

        // ── Modules ──────────────────────────────────────────────────
        const moduleGroup = new Adw.PreferencesGroup({
            title: 'Modules',
            description: 'Enable or disable bar components'
        });
        page.add(moduleGroup);

        const modules = [
            { id: 'show-logo',           title: 'Framework Logo' },
            { id: 'show-workspaces',     title: 'Workspaces' },
            { id: 'show-net',            title: 'Internet Speed' },
            { id: 'show-todo',           title: 'Todo List' },
            { id: 'show-clock',          title: 'Clock (Center)' },
            { id: 'show-cpu',            title: 'CPU Monitor' },
            { id: 'show-ram',            title: 'RAM Monitor' },
            { id: 'show-quick-settings', title: 'Quick Settings (Wifi, Bluetooth, Volume)' },
            { id: 'show-battery',        title: 'Battery' },
            { id: 'show-power',          title: 'Power Button' },
        ];

        modules.forEach(m => {
            const row = new Adw.SwitchRow({ title: m.title });
            moduleGroup.add(row);
            settings.bind(m.id, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        });

        // ── Appearance ───────────────────────────────────────────────
        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'Island color and transparency'
        });
        page.add(appearanceGroup);

        // Background color
        const colorRow = new Adw.EntryRow({ title: 'Background Color (hex or rgb/rgba)' });
        appearanceGroup.add(colorRow);
        settings.bind('custom-color', colorRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Opacity slider
        const opacityRow = new Adw.SpinRow({
            title: 'Island Opacity',
            subtitle: '0.00 = fully transparent  ·  1.00 = fully opaque',
            adjustment: new Gtk.Adjustment({
                lower: 0.0,
                upper: 1.0,
                step_increment: 0.05,
                page_increment: 0.1,
                value: settings.get_double('island-opacity')
            }),
            digits: 2
        });
        appearanceGroup.add(opacityRow);
        settings.bind('island-opacity', opacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        // ── Commands & Logo ──────────────────────────────────────────
        const commandGroup = new Adw.PreferencesGroup({
            title: 'Commands and Logo',
            description: 'Customize commands and the logo icon'
        });
        page.add(commandGroup);

        // Logo command (left-click)
        const logoCmdRow = new Adw.EntryRow({ title: 'Logo Command (Left Click)' });
        commandGroup.add(logoCmdRow);
        settings.bind('logo-command', logoCmdRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Power command
        const powerCmdRow = new Adw.EntryRow({ title: 'Power Button Command' });
        commandGroup.add(powerCmdRow);
        settings.bind('power-command', powerCmdRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Custom logo icon chooser
        const logoPathRow = new Adw.ActionRow({
            title: 'Custom Logo Icon',
            subtitle: settings.get_string('logo-icon-path') || 'Default'
        });
        commandGroup.add(logoPathRow);

        const selectIconBtn = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false,
            tooltip_text: 'Choose image…'
        });
        selectIconBtn.connect('clicked', () => {
            const fc = new Gtk.FileDialog({
                title: 'Select an image for the logo',
                filters: new Gio.ListStore({ item_type: Gtk.FileFilter })
            });
            const filter = new Gtk.FileFilter();
            filter.set_name('Images');
            filter.add_mime_type('image/png');
            filter.add_mime_type('image/jpeg');
            filter.add_mime_type('image/svg+xml');
            fc.filters.append(filter);
            fc.open(window, null, (obj, res) => {
                try {
                    const file = fc.open_finish(res);
                    if (file) {
                        settings.set_string('logo-icon-path', file.get_path());
                        logoPathRow.subtitle = file.get_path();
                    }
                } catch (e) { console.error(e); }
            });
        });

        const resetIconBtn = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false,
            tooltip_text: 'Reset to default'
        });
        resetIconBtn.connect('clicked', () => {
            settings.set_string('logo-icon-path', '');
            logoPathRow.subtitle = 'Default';
        });

        const iconBtnBox = new Gtk.Box({ spacing: 6 });
        iconBtnBox.append(selectIconBtn);
        iconBtnBox.append(resetIconBtn);
        logoPathRow.add_suffix(iconBtnBox);

        // Logo fill mode (cover/crop)
        const logoFillRow = new Adw.SwitchRow({
            title: 'Riempi il cerchio con l\'immagine',
            subtitle: 'Attivato: l\'immagine viene ritagliata per coprire tutto il cerchio (cover). Disattivato: icona normale centrata.'
        });
        commandGroup.add(logoFillRow);
        settings.bind('logo-fill-circle', logoFillRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
}
