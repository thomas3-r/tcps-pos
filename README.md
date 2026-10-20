# TCPS POS: setup for the event

A phone-only point of sale for the TCPS CSR event. It runs in the phone's browser, works offline, and syncs to Firebase when the phone gets internet.

Address: **https://tcps-pos.ramapuramone.com**

## What Thomas needs to do (about 20 minutes)

### 1. Create the Firebase project (free plan is enough)
1. Go to https://console.firebase.google.com and click **Create a project**. Name it `tcps-pos`. You can turn Google Analytics off.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
3. **Build → Firestore Database → Create database.** Pick location **asia-south1 (Mumbai)** and **production mode**.
4. **Project settings (gear icon) → General → Your apps → Web (`</>`)**. Name it `tcps-pos` (no hosting needed). Copy the `firebaseConfig` block and send it to Claude. These values are not secret.
5. Tell Claude which email will be the main manager login.

### 2. Create the GitHub repository
1. On GitHub create a new **public** repository named `tcps-pos` (empty, no README). The free plan only publishes websites from public repos; the code holds no passwords or sales data.
2. Tell Claude it's created so the code can be pushed and the website turned on.

### 3. Point the subdomain at it (GoDaddy)
GoDaddy → **My Products → ramapuramone.com → DNS → Add New Record**:
- Type: **CNAME**
- Name: **tcps-pos**
- Value: **thomas3-r.github.io**
- TTL: 1 hour

### 4. Finish in Firebase (after Claude confirms the site is live)
1. **Firestore Database → Rules**: paste the contents of `firestore.rules` (Claude fills in your email) and click **Publish**.
2. **Authentication → Settings → Authorized domains → Add domain**: `tcps-pos.ramapuramone.com`.

## Getting ready tonight
1. Open the site, tap **First time? Set your password**, use the manager email, then click the link in the verification email.
2. **Manage → Locations**: add the 4–5 counters, each with a short code (e.g. `MG`, `CN`). The code starts every invoice number.
3. **Manage → Items**: add products. Use **Bulk add** with one line per item: `Name, Price incl GST, Category`.
4. **Manage → Coupons**: the `POLICE` coupon (100% off, CSR) is created automatically. Add more if needed.
5. **Manage → Staff**: add each cashier's email, name and location. Each cashier then opens the site on **their own phone**, sets a password, verifies the email, and signs in once.
6. On every phone: open the site in Chrome, tap **⋮ → Add to Home screen**. Open it once from the icon while online.

**Important:** every phone must sign in once while online before the event. After that it works with no internet. Don't sign out at the event.

## On the day
- **Sell**: tap items, then **Checkout**. Choose a discount (percentage, amount, or **Police (CSR)**), then **Cash** or **UPI**, then **Complete sale**.
- Prices include GST 5%. A discount is taken off the total, and GST is recalculated on what's left.
- The green/orange badge at the top shows Online/Offline and how many sales are waiting to sync.
- Managers see all locations and the **Dashboard** with live sales, cash, UPI, CSR count and items sold. Bills can be voided from there (they stay in the records marked VOID).
- Every phone also keeps its own backup copy of its sales (**My sales → Download phone backup**).

## After the event
**Dashboard → Export**: *Invoices CSV* (one row per bill) and *Invoice lines CSV* (one row per item, with discount and GST split per line). These have everything needed to build the NetSuite sales invoice import later.

## Files
| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `calc.js` | Discount and GST maths |
| `config.js` | Firebase settings and the main manager email |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Offline support and home-screen icon |
| `firestore.rules` | Who can read and write what |
