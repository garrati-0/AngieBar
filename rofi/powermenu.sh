#!/bin/bash

# Icone Nerd Font
lock=""
logout="󰍃"
suspend=""
reboot="󰑐"
poweroff=""

# Passa le opzioni a Rofi, dicendogli di usare un tema specifico
options="$lock\n$logout\n$suspend\n$reboot\n$poweroff"
chosen=$(echo -e "$options" | env -u WAYLAND_DISPLAY rofi -dmenu -theme ~/.config/rofi/power_theme.rasi -normal-window)

# Esegui l'azione in base all'icona scelta
case $chosen in
    $lock)
        # Comando per bloccare lo schermo su GNOME
        dbus-send --type=method_call --dest=org.gnome.ScreenSaver /org/gnome/ScreenSaver org.gnome.ScreenSaver.Lock
        ;;
    $logout)
        gnome-session-quit --logout --no-prompt
        ;;
    $suspend)
        systemctl suspend
        ;;
    $reboot)
        systemctl reboot
        ;;
    $poweroff)
        systemctl poweroff
        ;;
esac
