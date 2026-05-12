#!/bin/sh
lsof -ti:3006 | xargs kill -9 2>/dev/null
sleep 1
rm -f /Users/8s/Documents/code/web/job_finder/jobs.json
cd /Users/8s/Documents/code/web/job_finder
exec node server.js
