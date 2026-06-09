#!/bin/bash
cd /opt/saas
git pull
npm install --silent
pkill -f "node server/index.js" 2>/dev/null
set -a
[ -f env.freepbx.test ] && source env.freepbx.test
set +a
node server/index.js &
echo "Updated and restarted"
