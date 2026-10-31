# StepWise website

## Run the website

1. Install Node.js 22 or newer.
2. Extract this ZIP and open the `StepWise` folder in a terminal.
3. Run `npm install` once to install the website's dependencies.
4. Run `npm start`.
5. Open http://localhost:3000 in your browser.

The app creates its local database and demo data automatically the first time it starts. No MySQL installation is needed. Keep the terminal window open while using the website; press Ctrl+C there to stop it.

To use a custom security key, copy `.env.example` to `.env` and replace `JWT_SECRET` with a long random value before starting. An Anthropic API key is optional; the rest of the website works without it.

## Demo access

Demo accounts are created with randomly generated passwords the first time the app starts. The passwords are printed in the terminal for local testing; keep them private. Do not use demo accounts in a real deployment.

The database and uploaded files are stored locally in the `data` and `uploads` folders. This package starts with a fresh demo database.
