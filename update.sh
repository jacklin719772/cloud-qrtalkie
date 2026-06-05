#!/bin/bash
cd /opt/saas
git pull
npm install --silent
pkill -f "node server/index.js" 2>/dev/null
node server/index.js &
echo "Updated and restarted"
