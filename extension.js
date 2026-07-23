import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

const SaveDeskDialog = GObject.registerClass(
class SaveDeskDialog extends ModalDialog.ModalDialog {
    _init(onSave) {
        super._init();
        this._onSave = onSave;

        const content = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 12px; padding: 12px; min-width: 300px;',
        });

        const title = new St.Label({
            text: 'Save Current Desk',
            style: 'font-weight: bold; font-size: 1.1em;',
        });
        content.add_child(title);

        const desc = new St.Label({
            text: 'Enter a name for the new desk:',
            style: 'margin-top: 4px; margin-bottom: 4px;',
        });
        content.add_child(desc);

        this._entry = new St.Entry({
            hint_text: 'e.g. Work, Project...',
            can_focus: true,
            style: 'padding: 6px;',
        });
        content.add_child(this._entry);

        this.contentLayout.add_child(content);

        this.addButton({
            label: 'Cancel',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });

        this.addButton({
            label: 'Save',
            action: () => {
                const name = this._entry.get_text().trim();
                if (name) {
                    this._onSave(name);
                    this.close();
                }
            },
            isDefault: true,
        });
    }
});

const ManageDesksDialog = GObject.registerClass(
class ManageDesksDialog extends ModalDialog.ModalDialog {
    _init(desks, onDelete) {
        super._init();

        const content = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 12px; padding: 12px; min-width: 320px;',
        });

        const title = new St.Label({
            text: 'Manage Desks',
            style: 'font-weight: bold; font-size: 1.1em;',
        });
        content.add_child(title);

        const names = Object.keys(desks);
        if (names.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No saved desks',
                style: 'font-style: italic;',
            });
            content.add_child(emptyLabel);
        } else {
            const scrollView = new St.ScrollView({
                style: 'max-height: 240px;',
            });
            const list = new St.BoxLayout({
                vertical: true,
                style: 'spacing: 6px;',
            });

            for (const name of names) {
                const row = new St.BoxLayout({
                    vertical: false,
                    style: 'spacing: 8px; padding: 4px;',
                });

                const label = new St.Label({
                    text: name,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const delBtn = new St.Button({
                    style_class: 'button',
                    child: new St.Icon({
                        icon_name: 'user-trash-symbolic',
                        icon_size: 16,
                    }),
                    style: 'padding: 4px 10px;',
                });

                delBtn.connect('clicked', () => {
                    onDelete(name);
                    row.destroy();
                    if (list.get_n_children() === 0) {
                        this.close();
                    }
                });

                row.add_child(label);
                row.add_child(delBtn);
                list.add_child(row);
            }

            scrollView.add_child(list);
            content.add_child(scrollView);
        }

        this.contentLayout.add_child(content);

        this.addButton({
            label: 'Close',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
            isDefault: true,
        });
    }
});

const SavedDesksIndicator = GObject.registerClass(
class SavedDesksIndicator extends PanelMenu.Button {
    _init(deskManager) {
        super._init(0.0, 'SavedDesks');
        this._deskManager = deskManager;

        const icon = new St.Icon({
            icon_name: 'computer-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        this.buildMenu();
    }

    buildMenu() {
        this.menu.removeAll();

        const saveItem = new PopupMenu.PopupMenuItem('Save current desk');
        saveItem.connect('activate', () => this._deskManager.saveCurrentWorkspace());
        this.menu.addMenuItem(saveItem);

        const manageItem = new PopupMenu.PopupMenuItem('Manage desks');
        manageItem.connect('activate', () => this._deskManager.manageDesks());
        this.menu.addMenuItem(manageItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const desks = this._deskManager.getDesks();
        const names = Object.keys(desks);

        if (names.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No saved desks');
            emptyItem.setSensitive(false);
            this.menu.addMenuItem(emptyItem);
        } else {
            for (const name of names) {
                const item = new PopupMenu.PopupMenuItem(`Load: ${name}`);
                item.connect('activate', () => this._deskManager.loadDesk(name));
                this.menu.addMenuItem(item);
            }
        }
    }
});

class DeskManager {
    constructor() {
        this._sources = [];
        this._pendingRestorations = [];
        this._activeDialog = null;
        this._indicator = null;

        this._windowCreatedId = global.display.connect('window-created', (_display, window) => {
            this._onWindowCreated(window);
        });
    }

    setIndicator(indicator) {
        this._indicator = indicator;
    }

    _addIdle(callback) {
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._removeSource(id);
            return callback();
        });
        this._sources.push(id);
        return id;
    }

    _removeSource(id) {
        const idx = this._sources.indexOf(id);
        if (idx !== -1)
            this._sources.splice(idx, 1);
    }

    _clearSources() {
        for (const id of this._sources)
            GLib.Source.remove(id);
        this._sources = [];
    }

    destroy() {
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }

        if (this._activeDialog) {
            this._activeDialog.close();
            this._activeDialog = null;
        }

        this._clearSources();
        this._pendingRestorations = null;
        this._indicator = null;
    }

    _getFilePath() {
        return GLib.build_filenamev([GLib.get_user_config_dir(), 'gnome-saved-desks.json']);
    }

    getDesks() {
        try {
            const filePath = this._getFilePath();
            if (GLib.file_test(filePath, GLib.FileTest.EXISTS)) {
                const [ok, contents] = GLib.file_get_contents(filePath);
                if (ok) {
                    const decoder = new TextDecoder();
                    const data = JSON.parse(decoder.decode(contents));
                    return data.desks || {};
                }
            }
        } catch (e) {
            console.error(`SavedDesks: Error loading desks - ${e}`);
        }
        return {};
    }

    saveDesks(desks) {
        try {
            const filePath = this._getFilePath();
            const jsonStr = JSON.stringify({ desks }, null, 2);
            GLib.file_set_contents(filePath, jsonStr);
            if (this._indicator)
                this._indicator.buildMenu();
        } catch (e) {
            console.error(`SavedDesks: Error saving desks - ${e}`);
        }
    }

    saveCurrentWorkspace() {
        if (this._activeDialog) {
            this._activeDialog.close();
        }
        this._activeDialog = new SaveDeskDialog((name) => {
            this._doSaveCurrentWorkspace(name);
        });
        this._activeDialog.open();
    }

    _doSaveCurrentWorkspace(name) {
        const activeWs = global.workspace_manager.get_active_workspace();
        const windows = activeWs.list_windows();

        let onlyPrimary = false;
        try {
            const settings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
            onlyPrimary = settings.get_boolean('workspaces-only-on-primary');
        } catch (e) {
            // Mutter settings fallback
        }
        const primaryMonitor = global.display.get_primary_monitor();

        const savedApps = [];
        for (const window of windows) {
            if (window.window_type !== Meta.WindowType.NORMAL)
                continue;

            if (onlyPrimary && window.get_monitor() !== primaryMonitor)
                continue;

            const app = Shell.WindowTracker.get_default().get_window_app(window);
            let appId = app ? app.get_id() : null;

            if (!appId) {
                const wmClass = window.get_wm_class();
                if (wmClass)
                    appId = `${wmClass.toLowerCase()}.desktop`;
                else
                    continue;
            }

            let tileState = 'normal';
            if (window.is_maximized()) {
                tileState = 'maximized';
            } else if (window.maximized_vertically) {
                const rect = window.get_frame_rect();
                const workArea = window.get_work_area_current_monitor();
                tileState = (rect.x + rect.width / 2) < (workArea.x + workArea.width / 2) ? 'left' : 'right';
            }

            const rect = window.get_frame_rect();
            const workArea = window.get_work_area_current_monitor();

            savedApps.push({
                appId,
                tileState,
                relX: (rect.x - workArea.x) / workArea.width,
                relY: (rect.y - workArea.y) / workArea.height,
                relW: rect.width / workArea.width,
                relH: rect.height / workArea.height,
            });
        }

        const desks = this.getDesks();
        desks[name] = savedApps;
        this.saveDesks(desks);
    }

    manageDesks() {
        if (this._activeDialog) {
            this._activeDialog.close();
        }
        const desks = this.getDesks();
        this._activeDialog = new ManageDesksDialog(desks, (nameToDelete) => {
            const currentDesks = this.getDesks();
            if (currentDesks[nameToDelete]) {
                delete currentDesks[nameToDelete];
                this.saveDesks(currentDesks);
            }
        });
        this._activeDialog.open();
    }

    loadDesk(name) {
        const desks = this.getDesks();
        const savedApps = desks[name];
        if (!savedApps || savedApps.length === 0)
            return;

        const ws = global.workspace_manager.append_new_workspace(false, global.get_current_time());
        ws.activate(global.get_current_time());

        const now = GLib.get_monotonic_time();
        for (const savedApp of savedApps) {
            this._pendingRestorations.push({
                ...savedApp,
                workspace: ws,
                timestamp: now,
            });

            const app = Shell.AppSystem.get_default().lookup_app(savedApp.appId);
            if (app) {
                app.open_new_window(-1);
            } else {
                try {
                    const appInfo = Gio.DesktopAppInfo.new(savedApp.appId);
                    if (appInfo)
                        appInfo.launch([], null);
                } catch (e) {
                    console.error(`SavedDesks: Failed to launch ${savedApp.appId} - ${e}`);
                }
            }
        }
    }

    _onWindowCreated(window) {
        if (window.window_type !== Meta.WindowType.NORMAL)
            return;

        const now = GLib.get_monotonic_time();
        this._pendingRestorations = this._pendingRestorations.filter(p => (now - p.timestamp) < 15000000);
        if (this._pendingRestorations.length === 0)
            return;

        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const appId = app ? app.get_id() : null;
        const wmClass = window.get_wm_class();
        const wmClassDesktop = wmClass ? `${wmClass.toLowerCase()}.desktop` : null;

        const index = this._pendingRestorations.findIndex(p => {
            return (appId && p.appId === appId) || (wmClassDesktop && p.appId === wmClassDesktop);
        });

        if (index === -1)
            return;

        const pending = this._pendingRestorations[index];
        this._pendingRestorations.splice(index, 1);

        try {
            window.change_workspace(pending.workspace);
        } catch (e) {
            console.error(`SavedDesks: Failed to change workspace - ${e}`);
        }

        this._addIdle(() => {
            this._applyGeometry(window, pending);
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyGeometry(window, pending) {
        if (!window || window.get_workspace() === null)
            return;

        const workArea = window.get_work_area_current_monitor();

        if (pending.tileState === 'maximized') {
            window.maximize();
        } else {
            if (window.is_maximized())
                window.unmaximize();

            let targetX, targetY, targetW, targetH;

            if (pending.tileState === 'left') {
                targetX = workArea.x;
                targetY = workArea.y;
                targetW = Math.round(workArea.width / 2);
                targetH = workArea.height;
            } else if (pending.tileState === 'right') {
                targetX = workArea.x + Math.round(workArea.width / 2);
                targetY = workArea.y;
                targetW = Math.round(workArea.width / 2);
                targetH = workArea.height;
            } else {
                targetX = Math.round(workArea.x + pending.relX * workArea.width);
                targetY = Math.round(workArea.y + pending.relY * workArea.height);
                targetW = Math.round(pending.relW * workArea.width);
                targetH = Math.round(pending.relH * workArea.height);
            }

            window.move_resize_frame(true, targetX, targetY, targetW, targetH);
        }

        try {
            pending.workspace.activate_with_focus(window, global.get_current_time());
        } catch (e) {
            // ignore focus errors
        }
    }
}

export default class SavedDesksExtension extends Extension {
    enable() {
        this._deskManager = new DeskManager();
        this._indicator = new SavedDesksIndicator(this._deskManager);
        this._deskManager.setIndicator(this._indicator);
        Main.panel.addToStatusArea('saved-desks-indicator', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._deskManager) {
            this._deskManager.destroy();
            this._deskManager = null;
        }
    }
}
