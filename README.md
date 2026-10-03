# MyDubaiPartsLink — Backend API

Full Node.js/Express + PostgreSQL backend with user auth, orders, and transaction history.

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create new account |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/auth/refresh` | Refresh access token |
| GET  | `/api/auth/me` | Get my profile + stats |
| PUT  | `/api/auth/profile` | Update profile |
| PUT  | `/api/auth/change-password` | Change password |
| POST | `/api/auth/forgot-password` | Send reset code |
| POST | `/api/auth/reset-password` | Reset with code |

### Orders
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST  | `/api/orders` | Place new order (guest or logged in) |
| GET   | `/api/orders` | My order history |
| GET   | `/api/orders/:ref` | Single order detail |
| PATCH | `/api/orders/:ref/status` | *(Admin)* Update status |
| GET   | `/api/orders/admin/all` | *(Admin)* All orders |

### Transactions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/transactions` | My transaction history |
| POST | `/api/transactions` | *(Admin)* Record payment |
| GET  | `/api/transactions/admin/all` | *(Admin)* All transactions |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | My notifications |
| PUT | `/api/notifications/read-all` | Mark all read |
| PUT | `/api/notifications/:id/read` | Mark one read |

### Users *(Admin only)*
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET   | `/api/users` | All users |
| GET   | `/api/users/:id` | Single user |
| PATCH | `/api/users/:id/status` | Activate/deactivate |
| GET   | `/api/users/me/vehicles` | My saved vehicles |
| POST  | `/api/users/me/vehicles` | Save a vehicle |
| DELETE| `/api/users/me/vehicles/:id` | Remove vehicle |

---

## Deploy to Railway (Step by Step)

### Step 1 — Create Railway account
Go to `railway.app` and sign up with GitHub.

### Step 2 — Create a new project
Click **New Project** → **Deploy from GitHub repo**
(Upload this folder to a GitHub repo first — see Step 2b)

### Step 2b — Push to GitHub
```bash
cd mdpl-backend
git init
git add .
git commit -m "Initial backend"
# Create a repo on github.com then:
git remote add origin https://github.com/YOUR_USERNAME/mdpl-backend.git
git push -u origin main
```

### Step 3 — Add PostgreSQL database
In your Railway project click **+ New** → **Database** → **PostgreSQL**
Railway will create the database automatically.

### Step 4 — Set environment variables
In Railway go to your service → **Variables** tab and add:

```
DATABASE_URL        = (Railway auto-fills this — copy from Postgres service)
JWT_SECRET          = pick_any_long_random_string_here
JWT_EXPIRES_IN      = 30d
NODE_ENV            = production
EMAIL_HOST          = smtp.gmail.com
EMAIL_PORT          = 587
EMAIL_USER          = your@gmail.com
EMAIL_PASS          = your_gmail_app_password
EMAIL_FROM          = MyDubaiPartsLink <your@gmail.com>
FORMSPREE_ID        = xkjnbenl
ADMIN_SECRET        = your_admin_secret
```

### Step 5 — Run migrations
In Railway terminal (or locally with DATABASE_URL set):
```bash
npm run migrate
```

### Step 6 — Create first admin user
After registering through the app, update your user role in Railway's database:
```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

### Step 7 — Get your API URL
Railway gives you a URL like `https://mdpl-backend-production.up.railway.app`
Copy this — you'll add it to your HTML apps.

---

## Connect the HTML App

In `MyDubaiPartsLink.html` find the CONFIG section and add:

```javascript
const CONFIG = {
  API_URL: 'https://your-railway-url.up.railway.app',
  FORMSPREE_ID: 'xkjnbenl',
  // ...
};
```

---

## Gmail App Password Setup
1. Go to `myaccount.google.com`
2. Security → 2-Step Verification (enable it)
3. Security → App Passwords
4. Select app: Mail, device: Other → type "MyDubaiPartsLink"
5. Copy the 16-character password → use as `EMAIL_PASS`

---

## Monthly Cost
| Service | Cost |
|---------|------|
| Railway Hobby plan | $5/month |
| PostgreSQL on Railway | Included |
| **Total** | **$5/month** |
