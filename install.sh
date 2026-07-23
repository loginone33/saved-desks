#!/bin/bash

# Target directory
TARGET_DIR="$HOME/.local/share/gnome-shell/extensions/saved-desks@loginone"

echo "Instalacja rozszerzenia Saved Desks..."

# Compile translations if msgfmt is available
if command -v msgfmt >/dev/null 2>&1; then
    mkdir -p locale/pl/LC_MESSAGES
    msgfmt -o locale/pl/LC_MESSAGES/saved-desks@loginone.mo po/pl.po 2>/dev/null || true
fi

# Create target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Copy files
cp metadata.json "$TARGET_DIR/"
cp extension.js "$TARGET_DIR/"
cp LICENSE "$TARGET_DIR/"
if [ -d "locale" ]; then
    cp -r locale "$TARGET_DIR/"
fi

# Enable extension
gnome-extensions enable saved-desks@loginone 2>/dev/null || true

echo "Kopiowanie i aktywacja zakończone pomyślnie."
echo "Zrestartuj GNOME Shell (na X11: Alt+F2 -> r -> Enter; na Wayland: wyloguj się i zaloguj ponownie), aby załadować nową wersję."
