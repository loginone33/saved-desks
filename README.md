# Saved Desks for GNOME Shell

**Saved Desks** is a GNOME Shell extension inspired by the ChromeOS Saved Desks feature. It allows you to save the window layout of your current workspace and restore it anytime on a new workspace.

---

## Features

- **Save Current Desk**: Saves all open normal windows on the active workspace, preserving:
  - **GNOME Window Tiling States**: Left half-screen tile (`left`), Right half-screen tile (`right`), and Maximized mode (`maximized`).
  - **Proportional Geometry**: Preserves custom window sizes and relative screen positions.
- **Restore Desk**: Select a saved desk from the top panel menu to automatically create a new workspace, launch the associated applications, and restore their exact window layout and tiling states.
- **Manage Desks**: Simple modal dialog to delete saved desk templates.
- **Clean & Lightweight**: Native GNOME Shell implementation with zero external script dependencies, built according to official GNOME Shell extension guidelines.

---

## Language & Interface

- **User Interface**: Clean English UI (built natively following GNOME Extension Review Guidelines).

---

## Compatibility

- **GNOME Shell**: 45, 46, 47, 48, 49, 50
- **Session**: Wayland & X11

---

## Installation & Deployment

### Local Installation

1. Clone or download this repository.
2. Run the included installation script:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```
3. Restart GNOME Shell (log out and log back in on Wayland, or press `Alt+F2`, type `r`, and press `Enter` on X11).
4. Enable the extension:
   ```bash
   gnome-extensions enable saved-desks@loginone
   ```

---

## How It Works

1. **Saving**: Click the **Saved Desks** monitor icon in the top status panel and select **Save current desk**. Enter a descriptive name for your layout (e.g., *Work*, *Project*).
2. **Restoring**: Open the panel menu and click **Load: [Desk Name]**. The extension creates a fresh workspace, launches the required applications, and positions them as saved.
3. **Managing**: Select **Manage desks** from the panel menu to remove desks you no longer need.

Configuration data is saved locally at `~/.config/gnome-saved-desks.json`.

---

## Support & Donations

If you like this extension and want to support its ongoing development, feel free to buy me a coffee!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Donate-yellow.svg)](https://buymeacoffee.com/loginone)

- **Buy Me A Coffee**: [buymeacoffee.com/loginone](https://buymeacoffee.com/loginone)

---

## License

This project is licensed under the GPL-3.0 License. See the [LICENSE](LICENSE) file for details.
