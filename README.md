# Ataraxia

A personal budgeting and financial tracking web application designed to make managing everyday finances simple, visual, and accessible across devices.

Ataraxia uses Firebase for authentication and cloud data storage, allowing users to keep their budgeting data synchronized between devices.

## Features

- Personal budget and expense tracking
- Firebase-powered cloud data synchronization
- Anonymous authentication for immediate use
- Google sign-in with account linking
- Cross-device access to synchronized data
- User-specific Firestore data
- Responsive web interface
- Deployed with Vercel

## How Authentication Works

Ataraxia allows users to start using the application immediately without creating an account manually.

### Anonymous Authentication

On first use, Ataraxia creates an anonymous Firebase account for the user.

This allows the application to:

- Start working immediately
- Associate data with a unique Firebase user ID
- Store the user's data securely in Firestore

### Google Sign-In

When the user chooses **Continue with Google**, Ataraxia links the Google account to the existing anonymous Firebase account rather than simply creating a completely separate session.

This means data already entered while using the application anonymously can remain associated with the user's account after Google sign-in.

Once linked, signing into the same Google account on another device allows the application to access the same Firebase user and synchronized Firestore data.

### Signing Out

Signing out ends the authenticated Google session.

Ataraxia intentionally does not immediately create a new anonymous account after sign-out. Instead, the user is shown a sign-in screen so their existing data does not appear to have disappeared simply because they signed out.

## Tech Stack

- React
- TypeScript
- Vite
- Firebase Authentication
- Cloud Firestore
- Vercel
- Tailwind CSS

## Project Structure

The project follows a standard Vite/React structure.

```text
Ataraxia/
├── public/
├── src/
│   ├── ...
│   └── vite-env.d.ts
├── .env.local
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Existing saved budgets

The app reads data beneath `artifacts/{namespace}/users/{Firebase UID}`. An
earlier release used `default-app-id`; a later release changed it to `ataraxia`
without moving the records. On sign-in, the app now checks both locations for
the same user, opens the original budget if present, and offers a budget
selector if both locations contain data. All writes use the selected location;
records are not copied, merged, or deleted during discovery.

For an older deployment that supplied a custom `__app_id`, set
`VITE_FIRESTORE_NAMESPACE` to that exact historical value and rebuild. This is
the Firestore path segment, not `VITE_FIREBASE_APP_ID`. Keep the original
Firebase project configuration and sign in with the original Google account.
Access rules must allow the signed-in user to read their budget subcollections.
Failed reads show an error and block editing instead of showing an empty budget.
Automatic discovery requires a connection to Firestore.

Run the namespace regression tests with Node 24 or later:

```sh
node --test tests/budgetStorage.test.mjs
npm run build
```
