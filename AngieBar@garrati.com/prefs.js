import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AngieBarPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.AngieBar');

        // ============================================================
        // PAGE 1 – General (Modules)
        // ============================================================
        const pageGen = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic'
        });
        window.add(pageGen);

        const moduleGroup = new Adw.PreferencesGroup({
            title: 'Modules',
            description: 'Enable or disable top bar components'
        });
        pageGen.add(moduleGroup);

        const modules = [
            { id: 'show-logo',           title: 'Logo' },
            { id: 'show-workspaces',     title: 'Workspaces' },
            { id: 'show-net',            title: 'Internet Speed' },
            { id: 'show-todo',           title: 'Todo List' },
            { id: 'show-clock',          title: 'Clock (Center)' },
            { id: 'show-cpu',            title: 'CPU Monitor' },
            { id: 'show-ram',            title: 'RAM Monitor' },
            { id: 'show-quick-settings', title: 'Quick Settings (Wi-Fi, Bluetooth, Volume)' },
            { id: 'show-battery',        title: 'Battery' },
            { id: 'show-power',          title: 'Power Button' },
        ];

        modules.forEach(m => {
            const row = new Adw.SwitchRow({ title: m.title });
            moduleGroup.add(row);
            settings.bind(m.id, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        });

        // ============================================================
        // PAGE 2 – Appearance (Colors and Opacity)
        // ============================================================
        const pageAppearance = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic'
        });
        window.add(pageAppearance);

        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Main Style',
            description: 'Base color and island opacity'
        });
        pageAppearance.add(appearanceGroup);

        // Predefined Colors
        const predefinedColorsRow = new Adw.ActionRow({ title: 'Predefined Colors', subtitle: 'Choose a quick theme' });
        const colorsBox = new Gtk.Box({ spacing: 8, valign: Gtk.Align.CENTER });
        
        const predefined = [
            { name: 'Catppuccin Macchiato', color: '#24273a' },
            { name: 'Catppuccin Mocha', color: '#1e1e2e' },
            { name: 'Nord', color: '#2e3440' },
            { name: 'Dracula', color: '#282a36' },
            { name: 'Gruvbox', color: '#282828' },
            { name: 'Dark Red', color: '#311015' },
            { name: 'Dark Green', color: '#102e1c' },
            { name: 'Absolute Black', color: '#000000' }
        ];

        predefined.forEach(p => {
            let btn = new Gtk.Button({ tooltip_text: p.name });
            // Add custom CSS for circle
            let cssProvider = new Gtk.CssProvider();
            let cssData = `
                button {
                    min-width: 24px;
                    min-height: 24px;
                    border-radius: 12px;
                    background-color: ${p.color};
                    border: 1px solid rgba(255,255,255,0.2);
                    padding: 0;
                }
                button:hover {
                    opacity: 0.8;
                }
            `;
            if (cssProvider.load_from_string) {
                cssProvider.load_from_string(cssData);
            } else {
                cssProvider.load_from_data(cssData, -1);
            }
            btn.get_style_context().add_provider(cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            
            btn.connect('clicked', () => {
                settings.set_string('custom-color', p.color);
            });
            colorsBox.append(btn);
        });
        predefinedColorsRow.add_suffix(colorsBox);
        appearanceGroup.add(predefinedColorsRow);

        // Background color
        const colorRow = new Adw.EntryRow({ title: 'Custom Background Color (hex or rgb)' });
        appearanceGroup.add(colorRow);
        settings.bind('custom-color', colorRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Opacity slider
        const opacityRow = new Adw.SpinRow({
            title: 'Island Opacity',
            subtitle: '0.00 = transparent  ·  1.00 = opaque',
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

        const secondaryGroup = new Adw.PreferencesGroup({
            title: 'Secondary Elements',
            description: 'Colors for specific text and indicators'
        });
        pageAppearance.add(secondaryGroup);

        const cpuColorRow = new Adw.EntryRow({ title: 'CPU Text/Icon Color' });
        secondaryGroup.add(cpuColorRow);
        settings.bind('cpu-color', cpuColorRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        const ramColorRow = new Adw.EntryRow({ title: 'RAM Text/Icon Color' });
        secondaryGroup.add(ramColorRow);
        settings.bind('ram-color', ramColorRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        const wsColorRow = new Adw.EntryRow({ title: 'Active Workspace Color' });
        secondaryGroup.add(wsColorRow);
        settings.bind('workspace-active-color', wsColorRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // ============================================================
        // PAGE 3 – Commands & Logo
        // ============================================================
        const pageCommands = new Adw.PreferencesPage({
            title: 'Commands & Logo',
            icon_name: 'utilities-terminal-symbolic'
        });
        window.add(pageCommands);

        const commandGroup = new Adw.PreferencesGroup({
            title: 'Logo Settings',
            description: 'Customize logo icon and actions'
        });
        pageCommands.add(commandGroup);

        // Logo action type
        const logoActionRow = new Adw.ComboRow({
            title: 'Logo Left-Click Action',
            model: Gtk.StringList.new(['Custom Command', 'Dropdown Menu'])
        });
        commandGroup.add(logoActionRow);
        settings.bind('logo-action', logoActionRow, 'selected', Gio.SettingsBindFlags.DEFAULT);

        // Logo command (left-click)
        const logoCmdRow = new Adw.EntryRow({ title: 'Custom Command (Left Click)' });
        commandGroup.add(logoCmdRow);
        settings.bind('logo-command', logoCmdRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Logo menu folders
        const logoFoldersRow = new Adw.EntryRow({ title: 'Menu Folders (comma-separated)' });
        commandGroup.add(logoFoldersRow);
        settings.bind('logo-menu-folders', logoFoldersRow, 'text', Gio.SettingsBindFlags.DEFAULT);

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
                title: 'Select a logo image',
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
            title: 'Fill circle with image',
            subtitle: 'Enabled: image covers full circle. Disabled: centered icon.'
        });
        commandGroup.add(logoFillRow);
        settings.bind('logo-fill-circle', logoFillRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const otherCmdGroup = new Adw.PreferencesGroup({
            title: 'Other Commands'
        });
        pageCommands.add(otherCmdGroup);

        // Power command
        const powerCmdRow = new Adw.EntryRow({ title: 'Power Button Command' });
        otherCmdGroup.add(powerCmdRow);
        settings.bind('power-command', powerCmdRow, 'text', Gio.SettingsBindFlags.DEFAULT);
    }
}
