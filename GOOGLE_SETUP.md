# Google Cloud OAuth 2.0 & API Setup Guide

This guide explains step-by-step how to configure your Google Cloud Console project to connect your Google Account with **Digital Memory Vault Phase 1**.

---

## 1. Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Log in with your Google account.
3. Click on the project dropdown at the top of the page and select **New Project**.
4. Enter **Digital Memory Vault** as the Project Name.
5. Click **Create** and select your newly created project.

---

## 2. Enable Required Google APIs

In the Cloud Console sidebar, navigate to **APIs & Services > Library** and search for each of the following APIs, then click **Enable**:

1. **Gmail API**
2. **Google Drive API**
3. **Google Photos Library API**
4. **Google Calendar API**

---

## 3. Configure OAuth Consent Screen

1. In the left sidebar, navigate to **APIs & Services > OAuth consent screen**.
2. Select **External** (or **Internal** if using a Google Workspace account) and click **Create**.
3. Fill in the required App Information:
   - **App name**: Digital Memory Vault
   - **User support email**: Your email address
   - **Developer contact information**: Your email address
4. Click **Save and Continue**.
5. Under **Scopes**, click **Add or Remove Scopes** and select/add:
   - `.../auth/userinfo.profile`
   - `.../auth/userinfo.email`
   - `.../auth/gmail.readonly`
   - `.../auth/drive.readonly`
   - `.../auth/photoslibrary.readonly`
   - `.../auth/calendar.readonly`
6. Click **Save and Continue**.
7. Under **Test Users**, click **+ Add Users** and enter your Google account email address (this permits your account to log in while in Testing mode).
8. Click **Save and Continue**.

---

## 4. Create OAuth 2.0 Client Credentials

1. Navigate to **APIs & Services > Credentials**.
2. Click **+ Create Credentials** at the top and select **OAuth client ID**.
3. Set **Application type** to **Web application**.
4. Set **Name** to `Digital Memory Vault Client`.
5. Under **Authorized redirect URIs**, click **+ Add URI** and enter:
   ```text
   http://localhost:3000/api/auth/google/callback
   ```
6. Click **Create**.
7. Copy your **Client ID** and **Client Secret**.

---

## 5. Configure Local Environment Variables

In your project root folder `d:\Monesh\Digital Vault\`, open or create the `.env` file:

```env
PORT=3000
SESSION_SECRET=digital_memory_vault_secure_session_secret_key_phase1

GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

Replace `your_client_id_here` and `your_client_secret_here` with your actual Google credentials.

---

## 6. Run & Test the Application

1. Start the server:
   ```bash
   npm start
   ```
2. Open your browser to `http://localhost:3000`.
3. Click the **Connect Account** button in the header.
4. Authenticate with your Google Account and accept the read-only permissions.
5. Search for any term in the universal search bar (e.g. `Amazon`, `Invoice`, `Meeting`).
6. Results will load in real time under their corresponding cards (Gmail, Drive, Photos, Calendar).
7. If nothing matches across all services, the global **"Nothing related was found"** empty state will be displayed.
