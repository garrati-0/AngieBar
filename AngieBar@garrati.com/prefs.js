import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WaybarClonePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.waybar-clone');
        const page = new Adw.PreferencesPage();
        window.add(page);

        // --- Modules Group ---
        const moduleGroup = new Adw.PreferencesGroup({
            title: 'Modules',
            description: 'Enable or disable bar components'
        });
        page.add(moduleGroup);

        const modules = [
            { id: 'show-logo', title: 'Framework Logo' },
            { id: 'show-workspaces', title: 'Workspaces' },
            { id: 'show-net', title: 'Internet Speed' },
            { id: 'show-clock', title: 'Clock (Center)' },
            { id: 'show-cpu', title: 'CPU Monitor' },
            { id: 'show-ram', title: 'RAM Monitor' },
            { id: 'show-quick-settings', title: 'Quick Settings (Wifi, BT, Vol)' },
            { id: 'show-battery', title: 'Battery' },
            { id: 'show-power', title: 'Power Button' },
        ];

        modules.forEach(m => {
            const row = new Adw.SwitchRow({
                title: m.title
            });
            moduleGroup.add(row);
            settings.bind(m.id, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        });

        // --- Appearance Group ---
        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'Customize island colors'
        });
        page.add(appearanceGroup);

        // Dynamic Color Switch
        const dynamicRow = new Adw.SwitchRow({
            title: 'Dynamic Color (Material You)',
            subtitle: 'Automatically adapt color to the current wallpaper'
        });
        appearanceGroup.add(dynamicRow);
        settings.bind('dynamic-color', dynamicRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Custom Color Entry (Only if dynamic is disabled)
        const colorRow = new Adw.EntryRow({
            title: 'Custom Color (Hex) - e.g., #1e1e2e'
        });
        appearanceGroup.add(colorRow);
        settings.bind('custom-color', colorRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Show/hide custom color based on dynamic setting
        dynamicRow.connect('notify::active', () => {
            colorRow.sensitive = !dynamicRow.active;
        });
        colorRow.sensitive = !dynamicRow.active;

        // --- Commands and Logo Customization Group ---
        const customGroup = new Adw.PreferencesGroup({
            title: 'Commands and Logo',
            description: 'Customize terminal commands and the logo icon'
        });
        page.add(customGroup);

        // Logo Command
        const logoCmdRow = new Adw.EntryRow({
            title: 'Logo Command (Left Click)'
        });
        customGroup.add(logoCmdRow);
        settings.bind('logo-command', logoCmdRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Power Command
        const powerCmdRow = new Adw.EntryRow({
            title: 'Power Command'
        });
        customGroup.add(powerCmdRow);
        settings.bind('power-command', powerCmdRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Custom Logo Icon Path
        const logoPathRow = new Adw.ActionRow({
            title: 'Custom Logo Icon',
            subtitle: settings.get_string('logo-icon-path') || 'Default'
        });
        customGroup.add(logoPathRow);

        const selectIconBtn = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false
        });

        selectIconBtn.connect('clicked', () => {
            const fileChooser = new Gtk.FileDialog({
                title: 'Select an image for the logo',
                filters: new Gio.ListStore({ item_type: Gtk.FileFilter })
            });

            const filter = new Gtk.FileFilter();
            filter.set_name('Images');
            filter.add_mime_type('image/png');
            filter.add_mime_type('image/jpeg');
            filter.add_mime_type('image/svg+xml');
            fileChooser.filters.append(filter);

            fileChooser.open(window, null, (obj, res) => {
                try {
                    const file = fileChooser.open_finish(res);
                    if (file) {
                        settings.set_string('logo-icon-path', file.get_path());
                        logoPathRow.subtitle = file.get_path();
                    }
                } catch (e) {
                    console.error(e);
                }
            });
        });

        const resetIconBtn = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false
        });

        resetIconBtn.connect('clicked', () => {
            settings.set_string('logo-icon-path', '');
            logoPathRow.subtitle = 'Default';
        });

        const btnBox = new Gtk.Box({ spacing: 6 });
        btnBox.append(selectIconBtn);
        btnBox.append(resetIconBtn);
        logoPathRow.add_suffix(btnBox);
    }
}


