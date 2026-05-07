# 🚀 AngieBar - Premium GNOME Shell Extension

![AngieBar Banner](bar.png)

**AngieBar** is a custom, high-performance status bar for GNOME Shell, inspired by the minimalist aesthetics of Waybar and the interactive utility of modern "islands". It transforms your default GNOME panel into a modular, pill-based interface with pixel-perfect styling and real-time system monitoring.

## ✨ Features

- **Modular "Islands"**: Clean, pill-shaped containers for a modern look.
- **Real-time Monitoring**:
  - **CPU & RAM**: Dynamic usage statistics directly in the bar.
  - **Network Traffic**: Live upload and download speeds (expandable/compact view).
  - **Battery Utility**: Precise percentage and wattage monitoring (click to toggle).
- **Dynamic Media Controller**: Integrated "Dynamic Island" style media tracker with:
  - Album artwork extraction (from Firefox, Chrome, Spotify, etc.).
  - Minimalist "Nothing" style audio visualizer.
  - Smooth expansion animations.
- **Enhanced Workspaces**: Interactive dot-based workspace switcher.
- **Smart Quick Settings**: Custom access to volume (with scroll-to-change), Wi-Fi, and Bluetooth.
- **Material You Inspired**: Dynamic color adaptation based on your desktop theme.
- **Highly Customizable**: Toggle any module via the extension settings.

## 🛠️ Installation

### Quick Install (Recommended)

Run the included installation script to automatically set up the extension, compile schemas, and move files to the correct directory:

```bash
chmod +x install.sh
./install.sh
```

### Manual Installation

1. Create the extension directory:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions/AngieBar@garrati.com
   ```
2. Copy all files from the `AngieBar@garrati.com` folder to that directory.
3. Compile the GSettings schemas:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/AngieBar@garrati.com/schemas/
   ```
4. Restart GNOME Shell (Alt+F2, type `r`, and Enter, or log out and back in on Wayland).
5. Enable the extension via **GNOME Extensions** or **Extensions Manager**.

## 🎨 Styling

The extension uses `stylesheet.css` for all visual elements. It is optimized for the **Catppuccin Mocha** dark theme by default but adapts dynamically to your system's color scheme if enabled in settings.

## 📋 Requirements

- **GNOME Shell**: 45 to 50
- **Dependencies**: 
  - `libadwaita`
  - `network-manager` (for Wi-Fi info)
  - `upower` (for battery stats)
  - `wireplumber` (for volume control via `wpctl`)

---

*Made with ❤️ by garrati*