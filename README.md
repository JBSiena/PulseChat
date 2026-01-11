# PulseChat

PulseChat is a modern real‑time chat application built with **Next.js**, **React**, **TypeScript**, **Express**, **Socket.IO**, and **PostgreSQL**.

It is designed to showcase full‑stack skills, including authentication, real‑time messaging, notifications, admin tools, and a small product‑ready UX. This project is suitable as a portfolio piece and can be extended into a production‑ready chat or support tool.

---

## Key Features

- **Email + password authentication**
  - Login and registration with basic password rules.
  - JWT‑based auth on the backend.

- **Channel‑based real‑time chat**
  - Built‑in channels like `#general` and `#support`.
  - Messages stream live using Socket.IO.
  - Unread counts and mention highlighting per room.

- **Direct messages (DMs)**
  - One‑to‑one conversations between users.
  - Rooms are derived from user IDs (e.g. `dm:<userId1>:<userId2>`).

- **Reactions & read receipts**
  - Emoji reactions on messages.
  - Read receipts and unread message counts per room.

- **Notification controls**
  - Per‑room notification level: `All`, `Mentions only`, or `Muted`.
  - Web audio notifications when new messages arrive.

- **Feedback & Q&A system**
  - Any authenticated user can submit feedback or questions.
  - Feedback is stored in PostgreSQL for later review.
  - An **admin‑only inbox** lets admins browse recent feedback.

- **Admin‑only feedback inbox**
  - Admins are identified by a configured email address.
  - Admins can toggle between the chat UI and a feedback inbox view.

- **Forgot password flow**
  - "Forgot password" mode on the login screen.
  - Users can request a reset token by email.
  - Backend generates a time‑limited token and logs it to the server (no email delivery required for local development).
  - Users can submit the token with a new password to reset their account.

---

## Tech Stack

- **Frontend**
  - Next.js / React
  - TypeScript
  - Axios for HTTP requests
  - Tailwind‑style utility classes for styling (via global CSS)

- **Backend**
  - Node.js + Express
  - Socket.IO for real‑time messaging
  - JWT authentication
  - `bcryptjs` for password hashing

- **Database**
  - PostgreSQL
  - Tables for users, conversations, messages, reactions, read receipts, friends, feedback, and password reset tokens.

---

## Project Structure (high level)

```text
my-chat-app/
  apps/
    api/      # Express + Socket.IO backend (TypeScript)
    web/      # Next.js frontend (TypeScript + React)
  .env        # Backend configuration (DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ...)
  ...         # Standard Node/TypeScript tooling files
```

---

## Environment Configuration

### Backend (`.env` at repository root)

Create a `.env` file in the project root with values similar to:

```env
DATABASE_URL=postgres://postgres:password@localhost:5432/chat_app
JWT_SECRET=your_long_random_secret
ADMIN_EMAIL=admin@example.com
```

- `DATABASE_URL` must point to a PostgreSQL instance.
- `JWT_SECRET` should be a long random string.
- `ADMIN_EMAIL` is the email address that will be treated as the **admin** account on the backend.

### Frontend (`apps/web/.env`)

Create `apps/web/.env` with:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_ADMIN_EMAIL=admin@example.com
```

- `NEXT_PUBLIC_API_URL` must point to the Express API server.
- `NEXT_PUBLIC_ADMIN_EMAIL` should match `ADMIN_EMAIL` so that the frontend can show admin‑only UI, such as the Feedback inbox button.

---

## Running PulseChat Locally

> The exact commands may vary depending on how you manage packages and scripts in `package.json`. The steps below describe the typical flow.

1. **Install dependencies**

   From the repository root:

   ```bash
   # Using your preferred package manager
   npm install
   # or: pnpm install
   # or: yarn install
   ```

2. **Set up PostgreSQL**

   - Ensure a PostgreSQL server is running.
   - Create a database (e.g. `chat_app`).
   - Update `DATABASE_URL` in `.env` to point to it.

3. **Run database migrations / init**

   The backend includes an `initDb` function that creates the required tables on startup. When you start the API server for the first time, it will create or update the schema.

4. **Start the backend (API + Socket.IO)**

   From the repository root, run the script that starts `apps/api` as defined in your `package.json`. Common patterns look like:

   ```bash
   npm run dev:api
   ```

   Make sure it listens on the same port configured in `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`).

5. **Start the frontend (Next.js)**

   In a separate terminal, run the script that starts `apps/web` in dev mode, for example:

   ```bash
   npm run dev:web
   ```

   Then open the URL printed by Next.js (commonly `http://localhost:3000`).

---

## Using the App

1. **Register an account**
   - Open the app in your browser.
   - Use the **Register** tab to create a new user.

2. **Login & chat**
   - Log in with your credentials.
   - Choose a channel (e.g. `#general`) or start a direct message.
   - Send messages, react with emoji, and watch messages sync in real time in multiple browser windows.

3. **Forgot password**
   - On the login screen, click **"Forgot password?"**.
   - Enter the email of an existing account.
   - Check the **API server logs** for the generated reset token.
   - Paste the token into the reset form along with a new password.

4. **Feedback & admin inbox**
   - Any logged‑in user can open **Feedback / Q&A** from the sidebar and submit feedback.
   - Log in as the admin user (matching `ADMIN_EMAIL` / `NEXT_PUBLIC_ADMIN_EMAIL`).
   - Use the **"Admin: Feedback inbox"** button in the header to switch from chat to the feedback inbox.

---

## Ideas for Future Improvements

- Real email delivery for password reset tokens.
- File uploads and image messages.
- Typing indicators per room.
- More granular admin roles and permissions.
- Deployments to platforms like Vercel (frontend) and Render/Fly.io/Heroku (backend and database).

---

## License

This project is for personal and portfolio use. You are free to explore, learn from it, and adapt it for your own experiments.

