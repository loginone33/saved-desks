#!/bin/bash

# Target directory
TARGET_DIR="$HOME/.local/share/gnome-shell/extensions/saved-desks@loginone"

echo "Instalacja rozszerzenia Saved Desks..."

# Disable and remove old version if present
OLD_DIR="$HOME/.local/share/gnome-shell/extensions/saved-desks@pablo.local"
if [ -d "$OLD_DIR" ]; then
    echo "Usuwanie starej wersji (saved-desks@pablo.local)..."
    gnome-extensions disable saved-desks@pablo.local 2>/dev/null || true
    rm -rf "$OLD_DIR"
fi

# Create target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Copy files
cp metadata.json "$TARGET_DIR/"
cp extension.js "$TARGET_DIR/"
cp LICENSE "$TARGET_DIR/"

# Update zip archive
zip -q saved-desks@loginone.shell-extension.zip metadata.json extension.js LICENSE

# Enable extension
gnome-extensions enable saved-desks@loginone 2>/dev/null || true

echo "Kopiowanie i aktywacja zakończone pomyślnie."
echo "Wyloguj się i zaloguj ponownie (lub na X11 naciśnij Alt+F2 -> r -> Enter), aby załadować nowe rozszerzenie."
