import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WaybarClonePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.waybar-clone');
        const page = new Adw.PreferencesPage();
        window.add(page);

        // --- Gruppo Moduli ---
        const moduleGroup = new Adw.PreferencesGroup({
            title: 'Moduli',
            description: 'Attiva o disattiva i componenti della barra'
        });
        page.add(moduleGroup);

        const modules = [
            { id: 'show-logo', title: 'Logo Framework' },
            { id: 'show-workspaces', title: 'Workspaces' },
            { id: 'show-net', title: 'Velocità Internet' },
            { id: 'show-clock', title: 'Orologio (Centro)' },
            { id: 'show-cpu', title: 'Monitor CPU' },
            { id: 'show-ram', title: 'Monitor RAM' },
            { id: 'show-quick-settings', title: 'Quick Settings (Wifi, BT, Vol)' },
            { id: 'show-battery', title: 'Batteria' },
            { id: 'show-power', title: 'Pulsante Power' },
        ];

        modules.forEach(m => {
            const row = new Adw.SwitchRow({
                title: m.title
            });
            moduleGroup.add(row);
            settings.bind(m.id, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        });

        // --- Gruppo Aspetto ---
        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Aspetto',
            description: 'Personalizza i colori delle isole'
        });
        page.add(appearanceGroup);

        // Dynamic Color Switch
        const dynamicRow = new Adw.SwitchRow({
            title: 'Colore Dinamico (Material You)',
            subtitle: 'Adatta automaticamente il colore allo sfondo attuale'
        });
        appearanceGroup.add(dynamicRow);
        settings.bind('dynamic-color', dynamicRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Custom Color Entry (Solo se dinamico è disattivo)
        const colorRow = new Adw.EntryRow({
            title: 'Colore Personalizzato (Hex) - es. #1e1e2e'
        });
        appearanceGroup.add(colorRow);
        settings.bind('custom-color', colorRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Mostra/nascondi colore personalizzato in base al dinamico
        dynamicRow.connect('notify::active', () => {
            colorRow.sensitive = !dynamicRow.active;
        });
        colorRow.sensitive = !dynamicRow.active;

        // --- Gruppo Personalizzazione Comandi e Logo ---
        const customGroup = new Adw.PreferencesGroup({
            title: 'Comandi e Logo',
            description: 'Personalizza i comandi del terminale e l\'icona del logo'
        });
        page.add(customGroup);

        // Comando Logo
        const logoCmdRow = new Adw.EntryRow({
            title: 'Comando Logo (Click Sinistro)'
        });
        customGroup.add(logoCmdRow);
        settings.bind('logo-command', logoCmdRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Comando Power
        const powerCmdRow = new Adw.EntryRow({
            title: 'Comando Power'
        });
        customGroup.add(powerCmdRow);
        settings.bind('power-command', powerCmdRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Percorso Logo Icona
        const logoPathRow = new Adw.ActionRow({
            title: 'Icona Logo Personalizzata',
            subtitle: settings.get_string('logo-icon-path') || 'Predefinito'
        });
        customGroup.add(logoPathRow);

        const selectIconBtn = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false
        });

        selectIconBtn.connect('clicked', () => {
            const fileChooser = new Gtk.FileDialog({
                title: 'Seleziona un\'immagine per il logo',
                filters: new Gio.ListStore({ item_type: Gtk.FileFilter })
            });

            const filter = new Gtk.FileFilter();
            filter.set_name('Immagini');
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
            logoPathRow.subtitle = 'Predefinito';
        });

        const btnBox = new Gtk.Box({ spacing: 6 });
        btnBox.append(selectIconBtn);
        btnBox.append(resetIconBtn);
        logoPathRow.add_suffix(btnBox);
    }
}


