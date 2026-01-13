# Deployment Instructions

## Firebase Setup

1. Create a Firebase project at https://console.firebase.google.com/
2. Enable **Realtime Database** (not Firestore)
3. Enable **Anonymous Authentication** in Authentication > Sign-in method
4. Set Realtime Database rules:
   ```json
   {
     "rules": {
       "rooms": {
         ".read": true,
         ".write": true
       }
     }
   }
   ```
5. Get your Firebase configuration from Project Settings > General > Your apps

## Local Development

1. Update Firebase config in these files:
   - `lobby.html`
   - `index.html`
   - `admin.html`

   Replace the `window.FIREBASE_CONFIG` object with your actual Firebase config:
   ```javascript
   window.FIREBASE_CONFIG = {
     apiKey: "your-api-key",
     authDomain: "your-project.firebaseapp.com",
     databaseURL: "https://your-project-default-rtdb.firebaseio.com",
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```

2. Serve the files using a local server (Firebase requires HTTPS or localhost):
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node.js
   npx http-server
   ```

3. Open `http://localhost:8000/lobby.html`

## Vercel Deployment

### Option 1: Environment Variables (Recommended)

1. Push your code to GitHub
2. Import project to Vercel
3. In Vercel project settings, add these environment variables:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_DATABASE_URL`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`

4. Create a build script that injects these into HTML files, or use Vercel's build-time environment variable injection

### Option 2: Direct Config (Less Secure)

Update the `window.FIREBASE_CONFIG` in `lobby.html`, `index.html`, and `admin.html` directly with your Firebase config before deploying.

**Note:** This exposes your Firebase config publicly, but it's acceptable for Realtime Database with proper security rules.

## Vercel Configuration

- **Framework Preset:** Other
- **Build Command:** (leave empty)
- **Output Directory:** (leave empty - root)
- **Install Command:** (leave empty)

The `vercel.json` file is already configured for static site deployment.

## Testing

1. Open `lobby.html`
2. Create or join a room
3. Open `admin.html` in another tab
4. Load the same room ID
5. Start the race from admin dashboard
6. Players should see each other racing in real-time

## Features

- ✅ Room-based multiplayer racing
- ✅ Player names rendered above cars
- ✅ Admin dashboard with minimap
- ✅ Quiz system (Kahoot-style) that grants Nitro boost
- ✅ Win condition detection
- ✅ Real-time position synchronization

## Troubleshooting

- **Firebase not loading:** Check browser console for errors. Ensure Firebase scripts are loaded before your modules.
- **Cannot connect:** Verify Firebase config is correct and Realtime Database is enabled.
- **Players not syncing:** Check Firebase Realtime Database rules allow read/write.
- **Quiz not working:** Ensure admin starts the quiz and answers are submitted within 5 seconds.
