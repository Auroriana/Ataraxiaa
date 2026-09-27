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
