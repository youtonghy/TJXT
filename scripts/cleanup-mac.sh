#!/bin/bash

echo "=== TJXT Cleanup Tool ==="
echo "This script will remove all TJXT related files and services."
read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# Stop and unload services
echo "Stopping services..."
sudo launchctl unload /Library/LaunchDaemons/net.tokisantike.tjxt.helper.plist 2>/dev/null || true

# Remove files
echo "Removing files..."
sudo rm -f /Library/LaunchDaemons/net.tokisantike.tjxt.helper.plist
sudo rm -f /Library/PrivilegedHelperTools/net.tokisantike.tjxt.helper
sudo rm -rf "/Applications/TJXT.app"
sudo rm -rf ~/Library/Application\ Support/TJXT
sudo rm -rf ~/Library/Caches/TJXT
sudo rm -f ~/Library/Preferences/net.tokisantike.tjxt.helper.plist
sudo rm -f ~/Library/Preferences/net.tokisantike.tjxt.plist

echo "Cleanup complete. Please restart your computer to complete the process."
