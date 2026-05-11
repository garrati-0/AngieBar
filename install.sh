#!/bin/bash

# AngieBar Installation Script

UUID="AngieBar@garrati.com"
DEST_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SRC_DIR="AngieBar@garrati.com"

echo "🚀 Installing AngieBar Extension..."

# Check if source directory exists
if [ ! -d "$SRC_DIR" ]; then
    echo "❌ Error: Source directory '$SRC_DIR' not found."
    echo "Make sure you are running this script from the root of the repository."
    exit 1
fi

# Create destination directory
mkdir -p "$DEST_DIR"

# Copy files
echo "📂 Copying files to $DEST_DIR..."
cp -r "$SRC_DIR/"* "$DEST_DIR/"

# Compile schemas
if [ -d "$DEST_DIR/schemas" ]; then
    echo "⚙️ Compiling GSettings schemas..."
    glib-compile-schemas "$DEST_DIR/schemas/"
fi

# Optional: Install Rofi Power Menu
echo ""
read -p "❓ Do you want to install the Rofi Power Menu configuration? (y/N) " install_rofi
if [[ "$install_rofi" =~ ^[Yy]$ ]]; then
    echo "🎨 Installing Rofi Power Menu..."
    mkdir -p "$HOME/.config/rofi"
    cp -r rofi/* "$HOME/.config/rofi/"
    chmod +x "$HOME/.config/rofi/powermenu.sh"
    echo "✅ Rofi Power Menu installed to ~/.config/rofi/"
fi

echo ""
echo "✅ Installation complete!"
echo "-------------------------------------------------------"
echo "To activate AngieBar:"
echo "1. Restart GNOME Shell:"
echo "   - On X11: Alt+F2, type 'r', and press Enter."
echo "   - On Wayland: Log out and log back in."
echo "2. Enable 'AngieBar' in the Extensions app or Extensions Manager."
echo "-------------------------------------------------------"
