#!/bin/bash

cd /app
echo "Initializing..."
rm -rf {.,}*
mv /root/app/{.,}* ./
git init
git add .
git commit -m "Initial commit"

while true; do
    echo "Running npm run dev..."
    npm run dev
    EXIT_CODE=$?

    if [ $EXIT_CODE -ne 0 ]; then
        echo "npm run dev failed. Reverting to previous state."
        if ! git reset --hard HEAD^; then
            echo "Failed to revert changes. Exiting."
            # exit 1
        fi
    else
        echo "npm run dev succeeded. Saving current state."
        git add .
        git commit -m "Automated commit: $(date)"
    fi

    sleep 1
done