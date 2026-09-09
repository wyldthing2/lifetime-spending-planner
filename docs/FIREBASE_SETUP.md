# Firebase setup for Lifetime Spending Planner

1. Create a Firebase project at https://console.firebase.google.com/.
2. Add a Web app and copy its Firebase configuration.
3. In Authentication, enable Email/Password sign-in.
4. Create a Firestore database.
5. In Firestore Rules, paste the contents of `firestore.rules` and publish them.
6. In the GitHub repository, open Settings → Secrets and variables → Actions → Variables and add these repository variables:

   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`

7. Open Settings → Pages and choose GitHub Actions as the source.

After signing in, the Summary screen offers two starting paths: fill the model out directly, or choose **Import workbook**. The importer reads the workbook in your browser, prefers the Latest Full Data with Notes sheet, and saves only the mapped planning model to Firebase. The original workbook is never uploaded to GitHub.

The web configuration values are intended for browser use. Do not add a Firebase service-account key or private credential to the repository. Each collaborator creates their own account in the planner, and the app stores the shared snapshot at `workspaces/household`.
