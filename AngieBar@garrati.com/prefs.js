import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
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

        // ============================================================
        // PAGE 4 – Dynamic Island & Google Tasks
        // ============================================================
        const pageDI = new Adw.PreferencesPage({
            title: 'Dynamic Island',
            icon_name: 'view-Reveal-symbolic',
        });
        window.add(pageDI);

        // 1. Behavior & Clipboard
        const diBehaviorGroup = new Adw.PreferencesGroup({
            title: 'Comportamento Dynamic Island',
            description: 'Apertura, scheda predefinita e scadenza della Clipboard',
        });
        pageDI.add(diBehaviorGroup);

        const hoverOpenRow = new Adw.SwitchRow({
            title: 'Apri al passaggio del mouse (Hover)',
            subtitle: 'Espande la Dynamic Island quando passi il cursore sulla pillola centrale',
        });
        diBehaviorGroup.add(hoverOpenRow);
        settings.bind('di-open-on-hover', hoverOpenRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const pillNotifRow = new Adw.SwitchRow({
            title: 'Notifiche nella pillola',
            subtitle: 'La pillola si espande per mostrare le notifiche. Se disattivato, usa i banner standard di GNOME',
        });
        diBehaviorGroup.add(pillNotifRow);
        settings.bind('di-pill-notifications', pillNotifRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const tabOptions = [
            { id: 'notifications', label: 'Notifiche' },
            { id: 'music',         label: 'Musica' },
            { id: 'clipboard',     label: 'Clipboard & Scaffale File' },
            { id: 'pomodoro',      label: 'Timer Pomodoro' },
            { id: 'calendar',      label: 'Calendario' },
            { id: 'todo',          label: 'To-Do List' },
        ];
        const defaultTabRow = new Adw.ComboRow({
            title: 'Scheda predefinita all\'apertura',
            model: Gtk.StringList.new(tabOptions.map(t => t.label)),
        });
        const curDefault = settings.get_string('di-default-tab') || 'notifications';
        const initIdx = Math.max(0, tabOptions.findIndex(t => t.id === curDefault));
        defaultTabRow.set_selected(initIdx);
        defaultTabRow.connect('notify::selected', () => {
            const picked = tabOptions[defaultTabRow.get_selected()];
            if (picked) settings.set_string('di-default-tab', picked.id);
        });
        diBehaviorGroup.add(defaultTabRow);

        const clipTtlRow = new Adw.SpinRow({
            title: 'Scadenza automatica Clipboard (minuti)',
            subtitle: 'Elimina automaticamente screenshot, file e appunti non fissati (0 = mai)',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 1440,
                step_increment: 15,
                page_increment: 60,
                value: settings.get_int('di-clipboard-ttl-mins'),
            }),
            digits: 0,
        });
        diBehaviorGroup.add(clipTtlRow);
        settings.bind('di-clipboard-ttl-mins', clipTtlRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        // 2. Visible Tabs
        const diTabsGroup = new Adw.PreferencesGroup({
            title: 'Schede della Dynamic Island',
            description: 'Scegli quali schede mostrare nella barra superiore della Dynamic Island',
        });
        pageDI.add(diTabsGroup);

        tabOptions.forEach(t => {
            const key = `di-show-tab-${t.id}`;
            const row = new Adw.SwitchRow({ title: t.label });
            diTabsGroup.add(row);
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        });

        // ============================================================
        // PAGE 5 – Assistente AI
        // ============================================================
        const pageAI = new Adw.PreferencesPage({
            title: 'Assistente AI',
            icon_name: 'starred-symbolic',
        });
        window.add(pageAI);

        const aiEngineGroup = new Adw.PreferencesGroup({
            title: 'Motore AI',
            description: 'Scegli quale AI usare nella pillola (clic destro sulla pallina per cambiarla al volo)',
        });
        pageAI.add(aiEngineGroup);

        const providers = [
            { id: 'agy',      label: 'AGY (Antigravity CLI)' },
            { id: 'codex',    label: 'Codex (OpenAI CLI)' },
            { id: 'claude',   label: 'Claude Code' },
            { id: 'local',    label: 'Modello Locale (Ollama / vLLM / LM Studio)' },
            { id: 'internal', label: 'AI interna (comandi rapidi di sistema)' },
        ];
        const providerRow = new Adw.ComboRow({
            title: 'Usa',
            model: Gtk.StringList.new(providers.map(p => p.label)),
        });
        const syncProviderRow = () => {
            const cur = settings.get_string('ai-provider') || 'agy';
            const idx = Math.max(0, providers.findIndex(p => p.id === cur));
            if (providerRow.get_selected() !== idx) providerRow.set_selected(idx);
        };
        syncProviderRow();
        providerRow.connect('notify::selected', () => {
            const picked = providers[providerRow.get_selected()];
            if (picked && settings.get_string('ai-provider') !== picked.id) settings.set_string('ai-provider', picked.id);
        });
        settings.connect('changed::ai-provider', syncProviderRow);
        aiEngineGroup.add(providerRow);

        const permRow = new Adw.SwitchRow({
            title: 'Chiedi il permesso prima di agire',
            subtitle: 'L\'AI propone i comandi e li esegue solo dopo che premi "Consenti"',
        });
        settings.bind('ai-ask-permission', permRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        aiEngineGroup.add(permRow);

        const localAiGroup = new Adw.PreferencesGroup({
            title: 'Inferenza Locale (Ollama / vLLM / LM Studio)',
            description: 'Configura il motore locale, il modello e la gestione della memoria',
        });
        pageAI.add(localAiGroup);

        const engineTypes = [
            { id: 'ollama',            label: 'Ollama (supporta caricamento e scaricamento dinamico)' },
            { id: 'openai-compatible', label: 'Compatibile OpenAI (vLLM, LM Studio, llama.cpp, LocalAI)' },
        ];
        const engineRow = new Adw.ComboRow({
            title: 'Tipo Motore',
            model: Gtk.StringList.new(engineTypes.map(e => e.label)),
        });
        const curEngine = settings.get_string('local-ai-engine') || 'ollama';
        engineRow.set_selected(Math.max(0, engineTypes.findIndex(e => e.id === curEngine)));
        engineRow.connect('notify::selected', () => {
            const picked = engineTypes[engineRow.get_selected()];
            if (picked) settings.set_string('local-ai-engine', picked.id);
        });
        localAiGroup.add(engineRow);

        const endpointRow = new Adw.EntryRow({
            title: 'Endpoint API',
        });
        localAiGroup.add(endpointRow);
        settings.bind('local-ai-endpoint', endpointRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        const modelRow = new Adw.EntryRow({
            title: 'Nome Modello',
        });
        localAiGroup.add(modelRow);
        settings.bind('local-ai-model', modelRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        const unloadRow = new Adw.SwitchRow({
            title: 'Carica alla richiesta e scarica subito dopo',
            subtitle: 'Libera la memoria RAM e VRAM (keep_alive: 0) appena la risposta è completata',
        });
        localAiGroup.add(unloadRow);
        settings.bind('local-ai-unload-after-use', unloadRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const testRow = new Adw.ActionRow({
            title: 'Stato Connessione',
            subtitle: 'Verifica la connessione e trova i modelli scaricati',
        });
        const detectBtn = new Gtk.Button({
            label: 'Rileva Modelli',
            valign: Gtk.Align.CENTER,
        });
        detectBtn.connect('clicked', () => {
            testRow.subtitle = 'Interrogo endpoint in corso...';
            const ep = (settings.get_string('local-ai-endpoint') || 'http://127.0.0.1:11434').replace(/\/+$/, '');
            try {
                const session = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE });
                const proc = session.spawnv(['curl', '-s', '-m', '4', `${ep}/api/tags`]);
                proc.communicate_utf8_async(null, null, (_obj, res) => {
                    try {
                        const [, stdout] = proc.communicate_utf8_finish(res);
                        let models = [];
                        if (stdout) {
                            try {
                                const parsed = JSON.parse(stdout);
                                if (Array.isArray(parsed.models)) {
                                    models = parsed.models.map(m => m.name);
                                }
                            } catch (e) {}
                        }
                        if (models.length > 0) {
                            testRow.subtitle = `Connesso · ${models.length} modelli: ${models.slice(0, 4).join(', ')}`;
                            const curM = settings.get_string('local-ai-model');
                            if (!curM || !models.includes(curM)) {
                                settings.set_string('local-ai-model', models[0]);
                            }
                        } else {
                            // Try OpenAI format /v1/models
                            const procV1 = session.spawnv(['curl', '-s', '-m', '4', `${ep}/v1/models`]);
                            procV1.communicate_utf8_async(null, null, (_obj2, res2) => {
                                try {
                                    const [, stdout2] = procV1.communicate_utf8_finish(res2);
                                    let v1Models = [];
                                    if (stdout2) {
                                        try {
                                            const p2 = JSON.parse(stdout2);
                                            if (Array.isArray(p2.data)) v1Models = p2.data.map(d => d.id);
                                        } catch (e) {}
                                    }
                                    if (v1Models.length > 0) {
                                        testRow.subtitle = `Connesso · ${v1Models.length} modelli: ${v1Models.slice(0, 4).join(', ')}`;
                                    } else {
                                        testRow.subtitle = 'Motore online ma nessun modello scaricato (es. `ollama pull llama3.2`)';
                                    }
                                } catch (e2) {
                                    testRow.subtitle = 'Nessun modello trovato sull\'endpoint specificato';
                                }
                            });
                        }
                    } catch (e) {
                        testRow.subtitle = 'Impossibile connettersi all\'endpoint specificato';
                    }
                });
            } catch (e) {
                testRow.subtitle = `Errore di rete: ${e.message}`;
            }
        });
        testRow.add_suffix(detectBtn);
        localAiGroup.add(testRow);

        const aiShortcutGroup = new Adw.PreferencesGroup({
            title: 'Scorciatoia da tastiera',
            description: 'Richiama la pillola AI da qualsiasi punto',
        });
        pageAI.add(aiShortcutGroup);

        const prettyAccel = (accel) => {
            if (!accel) return 'Disattivata';
            try {
                const [ok, key, mods] = Gtk.accelerator_parse(accel);
                if (ok !== false && key) return Gtk.accelerator_get_label(key, mods);
            } catch (e) {}
            return accel;
        };
        const shortcutRow = new Adw.ActionRow({ title: 'Apri / chiudi pillola AI' });
        const shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: (settings.get_strv('ai-shortcut')[0] || ''),
            disabled_text: 'Disattivata',
            valign: Gtk.Align.CENTER,
        });
        const changeBtn = new Gtk.Button({ label: 'Cambia', valign: Gtk.Align.CENTER });
        const clearBtn = new Gtk.Button({ icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER, has_frame: false, tooltip_text: 'Disattiva' });
        shortcutRow.add_suffix(shortcutLabel);
        shortcutRow.add_suffix(changeBtn);
        shortcutRow.add_suffix(clearBtn);
        aiShortcutGroup.add(shortcutRow);
        settings.connect('changed::ai-shortcut', () => {
            shortcutLabel.accelerator = settings.get_strv('ai-shortcut')[0] || '';
        });
        clearBtn.connect('clicked', () => settings.set_strv('ai-shortcut', []));

        changeBtn.connect('clicked', () => {
            const dlg = new Adw.Window({
                transient_for: window,
                modal: true,
                default_width: 380,
                default_height: 180,
                title: 'Nuova scorciatoia',
            });
            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 12,
                margin_top: 32, margin_bottom: 32, margin_start: 24, margin_end: 24,
                valign: Gtk.Align.CENTER,
            });
            box.append(new Gtk.Label({ label: '<b>Premi la combinazione di tasti</b>', use_markup: true }));
            box.append(new Gtk.Label({ label: 'Esc per annullare · Backspace per disattivare', css_classes: ['dim-label'] }));
            dlg.set_content(box);
            const ctrl = new Gtk.EventControllerKey();
            ctrl.connect('key-pressed', (_c, keyval, keycode, state) => {
                let mods = state & Gtk.accelerator_get_default_mod_mask();
                if (keyval === Gdk.KEY_Escape && !mods) { dlg.close(); return Gdk.EVENT_STOP; }
                if (keyval === Gdk.KEY_BackSpace && !mods) {
                    settings.set_strv('ai-shortcut', []);
                    dlg.close();
                    return Gdk.EVENT_STOP;
                }
                const isModifierOnly = [Gdk.KEY_Shift_L, Gdk.KEY_Shift_R, Gdk.KEY_Control_L, Gdk.KEY_Control_R,
                    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R, Gdk.KEY_Super_L, Gdk.KEY_Super_R, Gdk.KEY_Meta_L, Gdk.KEY_Meta_R].includes(keyval);
                if (isModifierOnly) return Gdk.EVENT_STOP;
                const lower = Gdk.keyval_to_lower(keyval);
                if (!Gtk.accelerator_valid(lower, mods)) return Gdk.EVENT_STOP;
                const accel = Gtk.accelerator_name(lower, mods);
                settings.set_strv('ai-shortcut', [accel]);
                dlg.close();
                return Gdk.EVENT_STOP;
            });
            dlg.add_controller(ctrl);
            dlg.present();
        });

        // 3. Google Tasks Integration
        const googleGroup = new Adw.PreferencesGroup({
            title: 'Google Tasks & Sincronizzazione',
            description: 'Collega i To-Do e gli elenchi al tuo account Google tramite GNOME Online Accounts',
        });
        pageDI.add(googleGroup);

        const googleSyncSwitch = new Adw.SwitchRow({
            title: 'Sincronizza con Google Tasks',
            subtitle: 'Sincronizza automaticamente elenchi (cartelle) e attività con Google Tasks',
        });
        googleGroup.add(googleSyncSwitch);
        settings.bind('di-google-tasks-enabled', googleSyncSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        const accountStatusRow = new Adw.ActionRow({
            title: 'Stato Account Google',
            subtitle: 'Verifica in corso...',
        });
        const openGoaBtn = new Gtk.Button({
            label: 'Account Online',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Apri Impostazioni → Account online di GNOME',
        });
        openGoaBtn.connect('clicked', () => {
            try {
                GLib.spawn_command_line_async('gnome-control-center online-accounts');
            } catch (e) {}
        });
        const syncNowBtn = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Sincronizza ora con Google Tasks e aggiorna gli elenchi',
        });
        const accBtnBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
        accBtnBox.append(syncNowBtn);
        accBtnBox.append(openGoaBtn);
        accountStatusRow.add_suffix(accBtnBox);
        googleGroup.add(accountStatusRow);

        // 4. Visibility of Todo Lists / Topics (Hide or Show lists in Dynamic Island)
        const topicsGroup = new Adw.PreferencesGroup({
            title: 'Elenchi / Argomenti To-Do visibili',
            description: 'Attiva o disattiva gli elenchi per mostrarli o nasconderli nella Dynamic Island',
        });
        pageDI.add(topicsGroup);

        let topicRows = [];
        const todoFilePath = `${GLib.get_user_config_dir()}/angiebar-todos.json`;

        const readLocalTodosData = () => {
            try {
                if (GLib.file_test(todoFilePath, GLib.FileTest.EXISTS)) {
                    const [ok, bytes] = GLib.file_get_contents(todoFilePath);
                    if (ok) {
                        const raw = new TextDecoder().decode(bytes);
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) {
                            return { topics: [], topicColors: {}, googleLists: {}, todos: parsed };
                        }
                        return {
                            topics: Array.isArray(parsed.topics) ? parsed.topics : [],
                            topicColors: parsed.topicColors || {},
                            googleLists: parsed.googleLists || {},
                            todos: Array.isArray(parsed.todos) ? parsed.todos : [],
                        };
                    }
                }
            } catch (e) {}
            return { topics: [], topicColors: {}, googleLists: {}, todos: [] };
        };

        const rebuildTopicsRows = () => {
            topicRows.forEach(r => {
                try { topicsGroup.remove(r); } catch (e) {}
            });
            topicRows = [];

            const data = readLocalTodosData();
            const allTopics = [...data.topics];
            data.todos.forEach(t => {
                const tp = t.topic || 'Generale';
                if (!allTopics.includes(tp)) allTopics.push(tp);
            });

            const hiddenList = settings.get_strv('di-hidden-todo-topics') || [];
            const hiddenSet = new Set(hiddenList);

            if (allTopics.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: 'Nessun elenco presente',
                    subtitle: 'Crea un argomento nella Dynamic Island o sincronizza con Google Tasks',
                });
                topicsGroup.add(emptyRow);
                topicRows.push(emptyRow);
                return;
            }

            allTopics.forEach(topic => {
                const count = data.todos.filter(t => (t.topic || 'Generale') === topic).length;
                const isGoogle = Boolean(data.googleLists && data.googleLists[topic]);
                const row = new Adw.SwitchRow({
                    title: topic,
                    subtitle: `${isGoogle ? 'Google Tasks · ' : 'Locale · '}${count} attività`,
                    active: !hiddenSet.has(topic),
                });
                row.connect('notify::active', () => {
                    const currentHidden = new Set(settings.get_strv('di-hidden-todo-topics') || []);
                    if (row.active) {
                        currentHidden.delete(topic);
                    } else {
                        currentHidden.add(topic);
                    }
                    settings.set_strv('di-hidden-todo-topics', [...currentHidden]);
                });
                topicsGroup.add(row);
                topicRows.push(row);
            });
        };

        const checkAndSyncGoogleFromPrefs = (fetchLists = false) => {
            try {
                const res = Gio.DBus.session.call_sync(
                    'org.gnome.OnlineAccounts',
                    '/org/gnome/OnlineAccounts',
                    'org.freedesktop.DBus.ObjectManager',
                    'GetManagedObjects',
                    null,
                    null,
                    Gio.DBusCallFlags.NONE,
                    4000,
                    null
                );
                const [objects] = res.deep_unpack();
                let googlePath = null;
                let email = '';
                let attention = false;
                for (const [objPath, ifaces] of Object.entries(objects)) {
                    const acc = ifaces['org.gnome.OnlineAccounts.Account'];
                    const oauth = ifaces['org.gnome.OnlineAccounts.OAuth2Based'];
                    if (acc && oauth && acc.ProviderType?.deep_unpack?.() === 'google') {
                        googlePath = objPath;
                        email = acc.PresentationIdentity?.deep_unpack?.() || acc.Identity?.deep_unpack?.() || 'Google';
                        attention = Boolean(acc.AttentionNeeded?.deep_unpack?.());
                        break;
                    }
                }
                if (!googlePath) {
                    accountStatusRow.subtitle = 'Nessun account Google trovato in GNOME Online Accounts';
                    rebuildTopicsRows();
                    return;
                }
                if (attention) {
                    accountStatusRow.subtitle = `${email} — Riautenticazione richiesta (clicca "Account Online")`;
                    rebuildTopicsRows();
                    return;
                }
                accountStatusRow.subtitle = `Collegato come ${email}`;

                if (fetchLists) {
                    const tokRes = Gio.DBus.session.call_sync(
                        'org.gnome.OnlineAccounts',
                        googlePath,
                        'org.gnome.OnlineAccounts.OAuth2Based',
                        'GetAccessToken',
                        null,
                        null,
                        Gio.DBusCallFlags.NONE,
                        5000,
                        null
                    );
                    const [token] = tokRes.deep_unpack();
                    if (token) {
                        const proc = Gio.Subprocess.new(
                            [
                                'curl', '-s', '-m', '10',
                                'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100',
                                '-H', `Authorization: Bearer ${token}`,
                            ],
                            Gio.SubprocessFlags.STDOUT_PIPE
                        );
                        proc.communicate_utf8_async(null, null, (obj, asyncRes) => {
                            try {
                                const [, stdout] = obj.communicate_utf8_finish(asyncRes);
                                const parsed = JSON.parse(stdout || '{}');
                                if (Array.isArray(parsed.items)) {
                                    const data = readLocalTodosData();
                                    parsed.items.forEach(item => {
                                        const title = (item.title || '').trim();
                                        if (title && !data.topics.includes(title)) {
                                            data.topics.push(title);
                                        }
                                        if (title && item.id) {
                                            data.googleLists[title] = item.id;
                                        }
                                    });
                                    GLib.file_set_contents(todoFilePath, JSON.stringify(data));
                                    accountStatusRow.subtitle = `Sincronizzato con ${email} (${parsed.items.length} elenchi)`;
                                }
                            } catch (e) {}
                            rebuildTopicsRows();
                        });
                        return;
                    }
                }
            } catch (e) {
                accountStatusRow.subtitle = 'Impossibile interrogare GNOME Online Accounts';
            }
            rebuildTopicsRows();
        };

        syncNowBtn.connect('clicked', () => {
            accountStatusRow.subtitle = 'Sincronizzazione in corso...';
            checkAndSyncGoogleFromPrefs(true);
            // Trigger sync in running extension by toggling or touching setting
            const curHidden = settings.get_strv('di-hidden-todo-topics') || [];
            settings.set_strv('di-hidden-todo-topics', [...curHidden]);
        });

        checkAndSyncGoogleFromPrefs(true);

        // ============================================================
        // PAGE 6 – Pomodoro (Studio & Pausa)
        // ============================================================
        const pagePomo = new Adw.PreferencesPage({
            title: 'Pomodoro',
            icon_name: 'alarm-symbolic',
        });
        window.add(pagePomo);

        const pomoDurGroup = new Adw.PreferencesGroup({
            title: 'Durata Studio e Pause',
            description: 'Scegli un preset rapido o imposta i minuti esatti (sincronizzati con la Dynamic Island)',
        });
        pagePomo.add(pomoDurGroup);

        const presetRow = new Adw.ActionRow({
            title: 'Preset rapidi',
            subtitle: 'Imposta al volo durata studio, pausa breve e pausa lunga',
        });
        const presetBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
        [
            { label: '25 / 5',  work: 25, brk: 5,  longBrk: 15 },
            { label: '45 / 10', work: 45, brk: 10, longBrk: 20 },
            { label: '50 / 10', work: 50, brk: 10, longBrk: 25 },
            { label: '60 / 15', work: 60, brk: 15, longBrk: 30 },
        ].forEach(p => {
            const btn = new Gtk.Button({
                label: p.label,
                valign: Gtk.Align.CENTER,
                tooltip_text: `${p.work} min studio · ${p.brk} min pausa · ${p.longBrk} min pausa lunga`,
            });
            btn.connect('clicked', () => {
                settings.set_int('pomodoro-work-mins', p.work);
                settings.set_int('pomodoro-break-mins', p.brk);
                settings.set_int('pomodoro-long-break-mins', p.longBrk);
            });
            presetBox.append(btn);
        });
        presetRow.add_suffix(presetBox);
        pomoDurGroup.add(presetRow);

        const pomoWorkRow = new Adw.SpinRow({
            title: 'Durata Studio / Focus (minuti)',
            subtitle: 'Intervallo di concentrazione (es. 25, 45, 50 min)',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 180,
                step_increment: 5,
                page_increment: 15,
                value: settings.get_int('pomodoro-work-mins'),
            }),
            digits: 0,
        });
        pomoDurGroup.add(pomoWorkRow);
        settings.bind('pomodoro-work-mins', pomoWorkRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const pomoBreakRow = new Adw.SpinRow({
            title: 'Durata Pausa Breve (minuti)',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('pomodoro-break-mins'),
            }),
            digits: 0,
        });
        pomoDurGroup.add(pomoBreakRow);
        settings.bind('pomodoro-break-mins', pomoBreakRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const pomoLongBreakRow = new Adw.SpinRow({
            title: 'Durata Pausa Lunga (minuti)',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 90,
                step_increment: 5,
                page_increment: 10,
                value: settings.get_int('pomodoro-long-break-mins'),
            }),
            digits: 0,
        });
        pomoDurGroup.add(pomoLongBreakRow);
        settings.bind('pomodoro-long-break-mins', pomoLongBreakRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const pomoCyclesRow = new Adw.SpinRow({
            title: 'Sessioni di studio prima della Pausa Lunga',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 10,
                step_increment: 1,
                page_increment: 1,
                value: settings.get_int('pomodoro-cycles-before-long'),
            }),
            digits: 0,
        });
        pomoDurGroup.add(pomoCyclesRow);
        settings.bind('pomodoro-cycles-before-long', pomoCyclesRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const pomoAutoGroup = new Adw.PreferencesGroup({
            title: 'Automazione e Colore nella Island',
            description: 'Comportamento automatico al termine del timer e colore durante la pausa',
        });
        pagePomo.add(pomoAutoGroup);

        const autoBreakSwitch = new Adw.SwitchRow({
            title: 'Entra e avvia la pausa automaticamente',
            subtitle: 'Quando finisce il tempo di studio, passa subito in pausa e avvia il timer',
        });
        pomoAutoGroup.add(autoBreakSwitch);
        settings.bind('pomodoro-auto-start-break', autoBreakSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        const autoFocusSwitch = new Adw.SwitchRow({
            title: 'Avvia studio automaticamente dopo la pausa',
            subtitle: 'Quando termina la pausa, riparte subito una nuova sessione Focus',
        });
        pomoAutoGroup.add(autoFocusSwitch);
        settings.bind('pomodoro-auto-start-focus', autoFocusSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        const breakColorSwatchesRow = new Adw.ActionRow({
            title: 'Colore Pausa nella Island',
            subtitle: 'Colore mostrato nella pillola e nei controlli quando sei in pausa (al posto del blu)',
        });
        const breakColorsBox = new Gtk.Box({ spacing: 8, valign: Gtk.Align.CENTER });
        [
            { name: 'Verde Smeraldo', color: '#2ec27e' },
            { name: 'Ambra',          color: '#f5a623' },
            { name: 'Arancione',      color: '#ff7800' },
            { name: 'Corallo',        color: '#f38ba8' },
            { name: 'Viola',          color: '#cba6f7' },
            { name: 'Turchese',       color: '#2190a4' },
        ].forEach(c => {
            const btn = new Gtk.Button({ tooltip_text: c.name, valign: Gtk.Align.CENTER });
            const cssProvider = new Gtk.CssProvider();
            const cssData = `
                button {
                    min-width: 22px;
                    min-height: 22px;
                    border-radius: 11px;
                    background-color: ${c.color};
                    border: 1px solid rgba(255,255,255,0.28);
                    padding: 0;
                }
                button:hover { opacity: 0.82; }
            `;
            if (cssProvider.load_from_string) cssProvider.load_from_string(cssData);
            else cssProvider.load_from_data(cssData, -1);
            btn.get_style_context().add_provider(cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            btn.connect('clicked', () => settings.set_string('pomodoro-break-color', c.color));
            breakColorsBox.append(btn);
        });
        breakColorSwatchesRow.add_suffix(breakColorsBox);
        pomoAutoGroup.add(breakColorSwatchesRow);

        const breakColorEntry = new Adw.EntryRow({ title: 'Colore Pausa personalizzato (Hex)' });
        pomoAutoGroup.add(breakColorEntry);
        settings.bind('pomodoro-break-color', breakColorEntry, 'text', Gio.SettingsBindFlags.DEFAULT);
    }
}
