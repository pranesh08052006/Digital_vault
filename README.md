# Digital Memory Vault — Phase 1 Backend

Digital Memory Vault is a unified memory access application that connects your Google Account and provides a **single universal search bar** to query information across **Gmail, Google Drive, Google Photos, and Google Calendar**.

---

## Architecture Overview

```text
ONE UNIVERSAL SEARCH BAR
         │
         ▼
[authMiddleware] (Validates session tokens)
         │
         ▼
[searchController] (Validates search query)
         │
         ▼
  [searchService] (Parallel Execution via Promise.allSettled)
         │
 ┌───────┼──────────┬──────────┐
 ▼       ▼          ▼          ▼
Gmail   Drive     Photos    Calendar
Service Service   Service   Service
 │       │          │          │
 └───────┴──────────┴──────────┘
         │
 Normalized Schema Payload
         │
         ▼
Frontend Render (Cards or Global Empty State)
```

- **Normalized Result Schema**:
  ```json
  {
    "id": "string",
    "source": "gmail | drive | photos | calendar",
    "title": "string",
    "description": "string",
    "url": "string",
    "thumbnail": "string | null",
    "timestamp": "ISO Date string",
    "relevance": 1.0
  }
  ```

---

## Step-by-Step Setup Guide

### 1. Google Cloud Console Setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project named **Digital Memory Vault**.
3. In **APIs & Services > Library**, search and enable:
   - **Gmail API**
   - **Google Drive API**
   - **Google Photos Library API**
   - **Google Calendar API**

4. Go to **APIs & Services > OAuth consent screen**:
   - Choose **External** user type and click **Create**.
   - Fill in App Name (*Digital Memory Vault*), Support Email, and Developer Contact Email.
   - Under **Scopes**, add:
     - `.../auth/userinfo.profile`
     - `.../auth/userinfo.email`
     - `.../auth/gmail.readonly`
     - `.../auth/drive.readonly`
     - `.../auth/photoslibrary.readonly`
     - `.../auth/calendar.readonly`
   - Under **Test Users**, click **+ Add Users** and enter your personal Gmail address.

5. Go to **APIs & Services > Credentials**:
   - Click **+ Create Credentials > OAuth client ID**.
   - Select **Web application**.
   - Name: `Digital Memory Vault Client`.
   - Add **Authorized redirect URIs**:
     ```text
     http://localhost:3000/api/auth/google/callback
     ```
   - Click **Create** and copy your **Client ID** and **Client Secret**.

---

### 2. Local Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Open `.env` and set your credentials:

```env
PORT=3000
SESSION_SECRET=digital_memory_vault_secure_session_secret_key_phase1

GOOGLE_CLIENT_ID=your_actual_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_actual_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

---

### 3. Install Dependencies & Start Application

```bash
# Install dependencies
npm install

# Start Express backend server
npm start
```

Open your browser to: **[http://localhost:3000](http://localhost:3000)**

---

### 4. Testing the Application

1. **Connect Account**: Click the **Connect Google Account** button in the header. Authenticate with your Google account.
2. **Search Term (e.g., `Amazon`)**: Type `Amazon` into the universal search bar. Relevant results will populate under Gmail, Drive, Photos, and Calendar cards.
3. **No Results Test**: Search a query with no matches (e.g. `driving licence`). The system displays the global empty state:
   > 🔍 **Nothing related was found**
   > We couldn't find anything related to **"driving licence"** in your connected Google services.
4. **Disconnect Account**: Click **Google Account Connected** to disconnect your account, revoke OAuth tokens, and reset the session.

---

## API Capabilities & Photo Scope Notes

- **Google Photos REST API**: Google Photos Library API restricts third-party application searching across arbitrary user photo libraries unless media items were created by the app or selected via Google Photos Picker API. To ensure continuous operation, `photosService.js` incorporates a fallback query mechanism checking user images in Google Drive.
