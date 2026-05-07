import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences } from 'resource:///org/gnome/shell/extensions/prefs.js';

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
    }
}


