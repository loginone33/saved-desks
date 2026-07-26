import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
const shellVersion = parseInt(Config.PACKAGE_VERSION.split('.')[0], 10);
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

function logError(msg, err = null) {
    if (err)
        console.error(err, `[SavedDesks] ${msg}`);
    else
        console.error(`[SavedDesks] ${msg}`);
}

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
            text: _('Save Current Desk'),
            style: 'font-weight: bold; font-size: 1.1em;',
        });
        content.add_child(title);

        const desc = new St.Label({
            text: _('Enter a name for the new desk:'),
            style: 'margin-top: 4px; margin-bottom: 4px;',
        });
        content.add_child(desc);

        const entry = new St.Entry({
            hint_text: _('e.g. Work, Project...'),
            can_focus: true,
            style: 'padding: 6px;',
        });
        content.add_child(entry);

        this.contentLayout.add_child(content);

        this.addButton({
            label: _('Cancel'),
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });

        this.addButton({
            label: _('Save'),
            action: () => {
                const name = entry.get_text().trim();
                if (name) {
                    this._onSave(name);
                    this.close();
                }
            },
            isDefault: true,
        });
    }

    destroy() {
        this._onSave = null;
        super.destroy();
    }
});

const ManageDesksDialog = GObject.registerClass(
class ManageDesksDialog extends ModalDialog.ModalDialog {
    _init(desks, onDelete) {
        super._init();
        this._onDelete = onDelete;

        const content = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 12px; padding: 12px; min-width: 320px;',
        });

        const title = new St.Label({
            text: _('Manage Desks'),
            style: 'font-weight: bold; font-size: 1.1em;',
        });
        content.add_child(title);

        const names = Object.keys(desks);
        if (names.length === 0) {
            const emptyLabel = new St.Label({
                text: _('No saved desks'),
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
                    this._onDelete(name);
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
            label: _('Close'),
            action: () => this.close(),
            key: Clutter.KEY_Escape,
            isDefault: true,
        });
    }

    destroy() {
        this._onDelete = null;
        super.destroy();
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

    async buildMenu() {
        this.menu.removeAll();

        const saveItem = new PopupMenu.PopupMenuItem(_('Save current desk'));
        saveItem.connect('activate', () => this._deskManager.saveCurrentWorkspace());
        this.menu.addMenuItem(saveItem);

        const manageItem = new PopupMenu.PopupMenuItem(_('Manage desks'));
        manageItem.connect('activate', () => this._deskManager.manageDesks());
        this.menu.addMenuItem(manageItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const desks = await this._deskManager.getDesks();
        const names = Object.keys(desks);

        if (names.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem(_('No saved desks'));
            emptyItem.setSensitive(false);
            this.menu.addMenuItem(emptyItem);
        } else {
            for (const name of names) {
                const labelText = _('Load: %s').replace('%s', name);
                const item = new PopupMenu.PopupMenuItem(labelText);
                item.connect('activate', () => this._deskManager.loadDesk(name));
                this.menu.addMenuItem(item);
            }
        }
    }

    destroy() {
        this._deskManager = null;
        super.destroy();
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

    _addTimeout(interval, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
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
        this._pendingRestorations = [];
        this._indicator = null;
    }

    _getFilePath() {
        return GLib.build_filenamev([GLib.get_user_config_dir(), 'gnome-saved-desks.json']);
    }

    _getTileMode(window) {
        if (!window)
            return 0;
        if (window.get_tile_mode)
            return window.get_tile_mode();
        return 0;
    }

    _getMaximizedState(window) {
        if (!window) return 0;

        // Use bracket notation to avoid static linter errors for GNOME 45-48
        if (window['get_maximized']) {
            return window['get_maximized']();
        }

        // GNOME 49+ fallback (get_maximized was removed)
        const rect = window.get_frame_rect();
        let workArea;
        const monitor = window.get_monitor();
        const ws = window.get_workspace();
        if (ws && monitor !== undefined) {
            workArea = ws.get_work_area_for_monitor(monitor);
        } else {
            workArea = window.get_work_area_all_monitors();
        }

        if (workArea && rect.x === workArea.x && rect.y === workArea.y &&
            rect.width === workArea.width && rect.height === workArea.height) {
            return 3; // 3 = BOTH
        }
        
        return 0;
    }

    _isMaximized(window) {
        const flags = this._getMaximizedState(window);
        return (flags & Meta.MaximizeFlags.BOTH) === Meta.MaximizeFlags.BOTH;
    }

    _maximizeWindow(window) {
        if (!window) return;
        if (shellVersion >= 49) {
            window.maximize();
        } else {
            window.maximize(3); // Meta.MaximizeFlags.BOTH
        }
    }

    _unmaximizeWindow(window) {
        if (!window) return;
        if (shellVersion >= 49) {
            window.unmaximize();
        } else {
            window.unmaximize(3); // Meta.MaximizeFlags.BOTH
        }
    }

    async getDesks() {
        const filePath = this._getFilePath();
        const file = Gio.File.new_for_path(filePath);
        return new Promise((resolve) => {
            file.load_contents_async(null, (_file, res) => {
                try {
                    const [ok, contents] = file.load_contents_finish(res);
                    if (ok && contents) {
                        const decoder = new TextDecoder();
                        const data = JSON.parse(decoder.decode(contents));
                        resolve(data.desks || {});
                        return;
                    }
                } catch (e) {
                    if (!e.matches || !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                        logError('Error reading desks file', e);
                }
                resolve({});
            });
        });
    }

    async saveDesks(desks) {
        const filePath = this._getFilePath();
        const file = Gio.File.new_for_path(filePath);
        const jsonStr = JSON.stringify({ desks }, null, 2);
        const bytes = new GLib.Bytes(jsonStr);

        return new Promise((resolve) => {
            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.NONE, null, (_file, res) => {
                try {
                    file.replace_contents_finish(res);
                } catch (e) {
                    logError('Error writing desks file', e);
                }
                if (this._indicator)
                    this._indicator.buildMenu();
                resolve();
            });
        });
    }

    saveCurrentWorkspace() {
        if (this._activeDialog) {
            this._activeDialog.close();
        }
        this._activeDialog = new SaveDeskDialog(async (name) => {
            await this._doSaveCurrentWorkspace(name);
        });
        this._activeDialog.open();
    }

    _calculateMatchScore(window, pending) {
        if (!window || !pending)
            return -9999;

        const app = Shell.WindowTracker.get_default().get_window_app(window);
        const winAppId = app ? (app.get_id() || '') : '';
        const winWmClass = window.get_wm_class() || '';
        const winWmInst = window.get_wm_class_instance() || '';
        const winGtkId = window.get_gtk_application_id() || '';
        const winSandboxId = window.get_sandboxed_app_id() || '';
        const winTitle = window.get_title() || '';

        const targetAppId = pending.appId || '';
        const targetWmClass = pending.wmClass || '';
        const targetWmInst = pending.wmClassInstance || '';
        const targetTitle = pending.title || '';

        let score = 0;

        const winAppIdClean = winAppId.toLowerCase();
        const targetAppIdClean = targetAppId.toLowerCase();
        const winWmClassClean = winWmClass.toLowerCase();
        const targetWmClassClean = targetWmClass.toLowerCase();
        const winWmInstClean = winWmInst.toLowerCase();
        const targetWmInstClean = targetWmInst.toLowerCase();

        // 1. Chrome PWA Hash matching (32-character hash)
        const extractPwaHash = (str) => {
            if (!str) return null;
            const m = str.match(/chrome-([a-z0-9]{32})/i) || str.match(/([a-z0-9]{32})/i);
            return m ? m[1].toLowerCase() : null;
        };

        const winPwaHash = extractPwaHash(`${winAppIdClean} ${winWmClassClean} ${winWmInstClean} ${winTitle}`);
        const targetPwaHash = extractPwaHash(`${targetAppIdClean} ${targetWmClassClean} ${targetWmInstClean} ${targetTitle}`);

        if (targetPwaHash) {
            if (winPwaHash && winPwaHash === targetPwaHash) {
                score += 3000;
            } else if (winPwaHash && winPwaHash !== targetPwaHash) {
                return -5000;
            }
        }

        if (winAppIdClean && targetAppIdClean && winAppIdClean === targetAppIdClean) {
            score += 1000;
        }

        if (winWmClassClean && targetWmClassClean && winWmClassClean === targetWmClassClean) {
            score += 800;
        }

        if (winWmInstClean && targetWmInstClean && winWmInstClean === targetWmInstClean) {
            score += 800;
        }

        if (winGtkId && (winGtkId.toLowerCase() === targetAppIdClean || winGtkId.toLowerCase() === targetWmClassClean)) {
            score += 600;
        }

        if (winSandboxId && (winSandboxId.toLowerCase() === targetAppIdClean || winSandboxId.toLowerCase() === targetWmClassClean)) {
            score += 600;
        }

        // 2. LibreOffice and Sub-App specific matching
        const subApps = ['calc', 'writer', 'impress', 'draw', 'math', 'base'];
        const winText = `${winAppIdClean} ${winWmClassClean} ${winWmInstClean} ${winTitle.toLowerCase()}`;
        const targetText = `${targetAppIdClean} ${targetWmClassClean} ${targetWmInstClean} ${targetTitle.toLowerCase()}`;

        const isLibreOffice = winText.includes('libreoffice') || winText.includes('soffice') || targetText.includes('libreoffice') || targetText.includes('soffice');

        if (isLibreOffice) {
            for (const sub of subApps) {
                const winHasSub = winText.includes(sub) || (sub === 'calc' && winText.includes('kalk'));
                const targetHasSub = targetText.includes(sub) || (sub === 'calc' && targetText.includes('kalk'));

                if (targetHasSub) {
                    if (winHasSub) {
                        score += 1500;
                    } else {
                        const winHasAnySub = subApps.some(s => winText.includes(s) || (s === 'calc' && winText.includes('kalk')));
                        if (winHasAnySub) {
                            return -4000;
                        } else {
                            score += 100;
                        }
                    }
                }
            }
        }

        if (score === 0) {
            const targetBase = targetAppIdClean.replace(/\.desktop$/, '').split('.').pop();
            const winBase = winAppIdClean.replace(/\.desktop$/, '').split('.').pop() || winWmClassClean;

            if (targetBase && winBase && targetBase.length > 3 && winBase.length > 3) {
                if (targetBase === winBase) {
                    score += 300;
                } else if (targetBase.includes(winBase) || winBase.includes(targetBase)) {
                    score += 150;
                }
            }
        }

        return score;
    }

    async _doSaveCurrentWorkspace(name) {
        try {
            const activeWs = global.workspace_manager.get_active_workspace();
            const windows = activeWs.list_windows();

            const TILE_LEFT = Meta.TileMode ? Meta.TileMode.LEFT : 1;
            const TILE_RIGHT = Meta.TileMode ? Meta.TileMode.RIGHT : 2;

            const savedApps = [];
            for (const window of windows) {
                if (window.window_type !== Meta.WindowType.NORMAL)
                    continue;

                if (Meta.prefs_get_workspaces_only_on_primary && Meta.prefs_get_workspaces_only_on_primary()) {
                    if (window.get_monitor() !== global.display.get_primary_monitor()) {
                        continue;
                    }
                }

                const app = Shell.WindowTracker.get_default().get_window_app(window);
                let appId = app ? (app.get_id() || '') : null;
                const wmClass = window.get_wm_class() || '';
                const wmClassInstance = window.get_wm_class_instance() || '';
                const title = window.get_title() || '';

                if (!appId && wmClass) {
                    appId = `${wmClass.toLowerCase()}.desktop`;
                }

                if (!appId)
                    continue;

                const rect = window.get_frame_rect();
            const ws = window.get_workspace();
            let workArea = ws.get_work_area_for_monitor(window.get_monitor());

                let tileState = 'normal';
                const maxFlags = this._getMaximizedState(window);

                if (maxFlags === Meta.MaximizeFlags.BOTH) {
                    tileState = 'maximized';
                } else {
                    const centerX = rect.x + rect.width / 2;
                    const workCenterX = workArea.x + workArea.width / 2;
                    const isVertMax = (maxFlags & Meta.MaximizeFlags.VERTICAL) !== 0;
                    const matchesLeftWidth = Math.abs(rect.width - workArea.width / 2) < 80;
                    const matchesFullHeight = Math.abs(rect.height - workArea.height) < 80;
                    const isLeftPos = rect.x < (workArea.x + 80);
                    const isRightPos = Math.abs((rect.x + rect.width) - (workArea.x + workArea.width)) < 80;

                    let tileMode = this._getTileMode(window);

                    if (tileMode === TILE_LEFT || (matchesLeftWidth && matchesFullHeight && isLeftPos)) {
                        tileState = 'left';
                    } else if (tileMode === TILE_RIGHT || (matchesLeftWidth && matchesFullHeight && isRightPos)) {
                        tileState = 'right';
                    } else if (isVertMax && centerX < workCenterX) {
                        tileState = 'left';
                    } else if (isVertMax && centerX >= workCenterX) {
                        tileState = 'right';
                    }
                }

                savedApps.push({
                    appId,
                    wmClass,
                    wmClassInstance,
                    title,
                    tileState,
                    monitorIndex: window.get_monitor(),
                    relX: (rect.x - workArea.x) / workArea.width,
                    relY: (rect.y - workArea.y) / workArea.height,
                    relW: rect.width / workArea.width,
                    relH: rect.height / workArea.height,
                });
            }

            const desks = await this.getDesks();
            desks[name] = savedApps;
            await this.saveDesks(desks);
        } catch (e) {
            logError('CRITICAL ERROR IN _doSaveCurrentWorkspace', e);
            throw e;
        }
    }

    async manageDesks() {
        if (this._activeDialog) {
            this._activeDialog.close();
        }
        const desks = await this.getDesks();
        this._activeDialog = new ManageDesksDialog(desks, async (nameToDelete) => {
            const currentDesks = await this.getDesks();
            if (currentDesks[nameToDelete]) {
                delete currentDesks[nameToDelete];
                await this.saveDesks(currentDesks);
            }
        });
        this._activeDialog.open();
    }

    _launchApp(appId) {
        if (!appId)
            return false;

        const appSys = Shell.AppSystem.get_default();
        let app = appSys.lookup_app(appId);

        if (!app && !appId.endsWith('.desktop')) {
            app = appSys.lookup_app(`${appId}.desktop`);
        }

        if (app) {
            app.open_new_window(-1);
            return true;
        }

        const idsToTry = [appId];
        if (!appId.endsWith('.desktop')) {
            idsToTry.push(`${appId}.desktop`);
        }
        if (appId.includes('flextop.')) {
            const shortId = appId.replace(/.*flextop\./, '');
            idsToTry.push(shortId);
            if (!shortId.endsWith('.desktop')) {
                idsToTry.push(`${shortId}.desktop`);
            }
        }

        for (const id of idsToTry) {
            let appInfo = Gio.DesktopAppInfo.new(id);
            if (appInfo) {
                appInfo.launch([], null);
                return true;
            }

            const userAppsDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications', id]);
            if (GLib.file_test(userAppsDir, GLib.FileTest.EXISTS)) {
                const userAppInfo = Gio.DesktopAppInfo.new_from_filename(userAppsDir);
                if (userAppInfo) {
                    userAppInfo.launch([], null);
                    return true;
                }
            }
        }

        logError(`Could not launch app with ID: ${appId}`);
        return false;
    }

    async loadDesk(name) {
        const desks = await this.getDesks();
        const savedApps = desks[name];
        if (!savedApps || savedApps.length === 0)
            return;

        const ws = global.workspace_manager.append_new_workspace(false, global.get_current_time());
        ws.activate(global.get_current_time());

        const now = GLib.get_monotonic_time();
        for (let i = 0; i < savedApps.length; i++) {
            const savedApp = savedApps[i];
            this._pendingRestorations.push({
                ...savedApp,
                workspace: ws,
                timestamp: now,
            });

            this._addTimeout(i * 200, () => {
                this._launchApp(savedApp.appId);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _onWindowCreated(window) {
        if (!window || window.window_type !== Meta.WindowType.NORMAL)
            return;

        this._tryMatchAndApply(window);
    }

    _tryMatchAndApply(window) {
        if (!window || window.get_workspace() === null)
            return false;

        const now = GLib.get_monotonic_time();
        this._pendingRestorations = this._pendingRestorations.filter(p => (now - p.timestamp) < 30000000);
        if (this._pendingRestorations.length === 0)
            return false;

        let bestIndex = -1;
        let bestScore = -9999;

        for (let i = 0; i < this._pendingRestorations.length; i++) {
            const score = this._calculateMatchScore(window, this._pendingRestorations[i]);
            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }

        let pending = null;
        if (bestIndex !== -1 && bestScore >= 500) {
            pending = this._pendingRestorations[bestIndex];
            this._pendingRestorations.splice(bestIndex, 1);
        } else if (this._pendingRestorations.length === 1 && bestScore >= 100) {
            pending = this._pendingRestorations.shift();
        }

        if (pending) {
            this._disconnectWindowSignals(window);
            this._moveAndApply(window, pending);
            return true;
        }

        if (!window._savedDesksSignalsAttached) {
            window._savedDesksSignalsAttached = true;

            const titleId = window.connect('notify::title', () => {
                if (this._tryMatchAndApply(window)) {
                    this._disconnectWindowSignals(window);
                }
            });
            const wmClassId = window.connect('notify::wm-class', () => {
                if (this._tryMatchAndApply(window)) {
                    this._disconnectWindowSignals(window);
                }
            });

            window._savedDesksTitleId = titleId;
            window._savedDesksWmClassId = wmClassId;

            const retries = [50, 150, 300, 600, 1200, 2000];
            for (const delay of retries) {
                this._addTimeout(delay, () => {
                    if (this._tryMatchAndApply(window)) {
                        this._disconnectWindowSignals(window);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        return false;
    }

    _disconnectWindowSignals(window) {
        if (!window || !window._savedDesksSignalsAttached)
            return;

        if (window._savedDesksTitleId) {
            window.disconnect(window._savedDesksTitleId);
            window._savedDesksTitleId = null;
        }
        if (window._savedDesksWmClassId) {
            window.disconnect(window._savedDesksWmClassId);
            window._savedDesksWmClassId = null;
        }
        window._savedDesksSignalsAttached = false;
    }

    _moveAndApply(window, pending) {
        window.change_workspace(pending.workspace);

        const scheduleGeometry = () => {
            this._applyGeometry(window, pending);
        };

        scheduleGeometry();
        this._addTimeout(50, () => {
            scheduleGeometry();
            return GLib.SOURCE_REMOVE;
        });
        this._addTimeout(200, () => {
            scheduleGeometry();
            return GLib.SOURCE_REMOVE;
        });
        this._addTimeout(500, () => {
            scheduleGeometry();
            return GLib.SOURCE_REMOVE;
        });
        this._addTimeout(1000, () => {
            scheduleGeometry();
            return GLib.SOURCE_REMOVE;
        });
        this._addTimeout(2000, () => {
            scheduleGeometry();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyGeometry(window, pending) {
        if (!window || window.get_workspace() === null)
            return;

        const TILE_NONE = Meta.TileMode ? Meta.TileMode.NONE : 0;
        const TILE_LEFT = Meta.TileMode ? Meta.TileMode.LEFT : 1;
        const TILE_RIGHT = Meta.TileMode ? Meta.TileMode.RIGHT : 2;

        const rect = window.get_frame_rect();
        const ws = window.get_workspace();

        let targetMonitor = global.display.get_primary_monitor();
        if (pending.monitorIndex !== undefined && pending.monitorIndex >= 0 && pending.monitorIndex < global.display.get_n_monitors()) {
            targetMonitor = pending.monitorIndex;
        }

        if (window.get_monitor() !== targetMonitor) {
            if (window.move_to_monitor) {
                window.move_to_monitor(targetMonitor);
            }
        }

        let workArea = ws.get_work_area_for_monitor(targetMonitor);
        const isMaximized = this._isMaximized(window);
        const currentTileMode = this._getTileMode(window);

        if (pending.tileState === 'maximized') {
            if (!isMaximized)
                this._maximizeWindow(window);
        } else if (pending.tileState === 'left') {
            if (isMaximized)
                this._unmaximizeWindow(window);

            if (currentTileMode !== TILE_LEFT) {
                let tileSuccess = false;
                if (window.tile) {
                    window.tile(TILE_LEFT);
                    tileSuccess = true;
                }
                if (!tileSuccess) {
                    const targetX = workArea.x;
                    const targetY = workArea.y;
                    const targetW = Math.round(workArea.width / 2);
                    const targetH = workArea.height;
                    window.move_resize_frame(true, targetX, targetY, targetW, targetH);
                }
            }
        } else if (pending.tileState === 'right') {
            if (isMaximized)
                this._unmaximizeWindow(window);

            if (currentTileMode !== TILE_RIGHT) {
                let tileSuccess = false;
                if (window.tile) {
                    window.tile(TILE_RIGHT);
                    tileSuccess = true;
                }
                if (!tileSuccess) {
                    const targetX = workArea.x + Math.round(workArea.width / 2);
                    const targetY = workArea.y;
                    const targetW = Math.round(workArea.width / 2);
                    const targetH = workArea.height;
                    window.move_resize_frame(true, targetX, targetY, targetW, targetH);
                }
            }
        } else {
            if (isMaximized)
                this._unmaximizeWindow(window);

            if (currentTileMode !== TILE_NONE && window.tile) {
                window.tile(TILE_NONE);
            }

            const targetX = Math.round(workArea.x + pending.relX * workArea.width);
            const targetY = Math.round(workArea.y + pending.relY * workArea.height);
            const targetW = Math.round(pending.relW * workArea.width);
            const targetH = Math.round(pending.relH * workArea.height);

            window.move_resize_frame(true, targetX, targetY, targetW, targetH);
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
