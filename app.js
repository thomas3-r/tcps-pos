import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, sendEmailVerification, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, addDoc, onSnapshot, query, where, orderBy, limit, serverTimestamp, getDocs, writeBatch, deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig, OWNER_EMAIL_SHA256, RESET_EMAIL_SHA256, EVENT_NAME } from './config.js';
import { computeTotals, r2 } from './calc.js';
import { PRODUCTS, CATEGORY_ORDER } from './products.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayStr = (d = new Date()) => d.toLocaleDateString('en-CA');
const sha256 = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const timeStr = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3000);
}
function deviceId() {
  let id = ls.get('tcps_dev', null);
  if (!id) { id = Math.random().toString(36).slice(2, 5).toUpperCase(); ls.set('tcps_dev', id); }
  return id;
}
function nextSeq() { const n = ls.get('tcps_seq', 0) + 1; ls.set('tcps_seq', n); return n; }
function download(name, rows) {
  const csv = rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- state ----------
const S = {
  user: null, email: '', staff: null, role: null, authView: 'signin',
  locations: [], items: [], coupons: [], staffList: [], itemLog: [],
  mySales: [], allSales: [], pending: 0,
  locId: ls.get('tcps_loc', null), view: 'sell', category: 'All',
  cart: new Map(), discount: { mode: 'none', value: '', coupon: null }, csrRef: '', payment: null, cashGiven: '',
  lastSale: null, dashDay: dayStr(), editItem: null, editStaff: null, manageTab: 'items',
};
let unsubs = [];
let dashUnsub = null;
const isManager = () => S.role === 'manager';
const myLocations = () => isManager() ? S.locations : S.locations.filter((l) => (S.staff?.locations || []).includes(l.id));
const currentLoc = () => myLocations().find((l) => l.id === S.locId) || null;

// ---------- auth ----------
onAuthStateChanged(auth, async (user) => {
  unsubs.forEach((u) => u()); unsubs = [];
  if (dashUnsub) { dashUnsub(); dashUnsub = null; }
  S.user = user; S.staff = null; S.role = null;
  if (!user) { S.view = 'login'; return render(); }
  S.email = user.email.toLowerCase();
  // Only the main managers must verify their email; cashiers just sign in.
  const hash = await sha256(S.email);
  const owner = OWNER_EMAIL_SHA256.includes(hash);
  S.canReset = RESET_EMAIL_SHA256.includes(hash);
  S.isOwner = owner;
  if (owner && !user.emailVerified) { S.view = 'verify'; return render(); }
  S.view = 'loading'; render();
  unsubs.push(onSnapshot(doc(db, 'staff', S.email), (snap) => {
    S.staff = snap.exists() ? snap.data() : null;
    const active = S.staff && S.staff.active !== false;
    const role = owner ? 'manager' : active ? (S.staff.role || 'cashier') : null;
    const first = S.role === null;
    S.role = role;
    if (!role) { S.view = 'noaccess'; return render(); }
    if (first) { startData(); S.view = 'sell'; }
    render();
  }, (err) => { console.error(err); S.view = 'noaccess'; render(); }));
});

function startData() {
  unsubs.push(onSnapshot(collection(db, 'locations'), (s) => {
    S.locations = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const mine = myLocations();
    if (!currentLoc() && mine.length) { S.locId = mine[0].id; ls.set('tcps_loc', S.locId); }
    rerender();
  }));
  unsubs.push(onSnapshot(collection(db, 'items'), (s) => {
    const rank = (c) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? 99 : i; };
    S.items = s.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => rank(a.category) - rank(b.category) || (a.category || '').localeCompare(b.category || '') || (a.sort ?? 999) - (b.sort ?? 999) || (a.name || '').localeCompare(b.name || ''));
    rerender();
  }));
  unsubs.push(onSnapshot(collection(db, 'coupons'), (s) => {
    S.coupons = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Seed the police CSR coupon the first time a manager opens an empty project.
    if (isManager() && s.empty && !s.metadata.fromCache) {
      setDoc(doc(db, 'coupons', 'POLICE'), { code: 'POLICE', label: 'Police (CSR)', percent: 100, csr: true, active: true });
    }
    rerender();
  }));
  unsubs.push(onSnapshot(query(collection(db, 'sales'), where('cashierEmail', '==', S.email), where('day', '==', dayStr())),
    { includeMetadataChanges: true }, (s) => {
      S.mySales = s.docs.map((d) => ({ id: d.id, _pending: d.metadata.hasPendingWrites, ...d.data() })).filter((x) => x.status !== 'deleted').sort((a, b) => b.clientTs - a.clientTs);
      S.pending = S.mySales.filter((x) => x._pending).length;
      renderHeader();
      if (['today', 'receipt'].includes(S.view)) render();
    }));
  if (isManager()) {
    unsubs.push(onSnapshot(collection(db, 'staff'), (s) => { S.staffList = s.docs.map((d) => ({ id: d.id, ...d.data() })); rerender(); }));
    unsubs.push(onSnapshot(query(collection(db, 'itemLog'), orderBy('at', 'desc'), limit(300)), (s) => { S.itemLog = s.docs.map((d) => d.data()); rerender(); }));
    watchDashDay();
  }
}
function watchDashDay() {
  if (dashUnsub) dashUnsub();
  dashUnsub = onSnapshot(query(collection(db, 'sales'), where('day', '==', S.dashDay)), (s) => {
    S.allSales = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status !== 'deleted').sort((a, b) => b.clientTs - a.clientTs);
    rerender();
  });
}

// Data changes only redraw list-style views, so forms being typed into are left alone.
function rerender() {
  renderHeader();
  if (['sell', 'today', 'dash', 'log'].includes(S.view) || (S.view === 'manage' && !S.editItem && !S.editStaff)) render();
}

// ---------- rendering ----------
function renderHeader() {
  const h = $('#header');
  const brand = `<div class="brand"><img src="logo.webp" alt="Sidapur Coffee"><span>POS</span></div>`;
  if (!S.role) { h.innerHTML = brand; return; }
  const locs = myLocations();
  const online = navigator.onLine;
  h.innerHTML = `
    ${brand}
    <select id="locSel" ${locs.length < 2 ? 'disabled' : ''}>
      ${locs.length ? locs.map((l) => `<option value="${l.id}" ${l.id === S.locId ? 'selected' : ''}>${esc(l.name)}</option>`).join('') : '<option>No location</option>'}
    </select>
    <span class="sync ${online ? 'on' : 'off'}">${online ? 'Online' : 'Offline'}${S.pending ? ` · ${S.pending} to sync` : ''}</span>`;
  const sel = $('#locSel');
  if (sel) sel.onchange = () => { S.locId = sel.value; ls.set('tcps_loc', S.locId); render(); };
}

function renderNav() {
  const n = $('#nav');
  if (!S.role || ['checkout', 'receipt'].includes(S.view)) { n.innerHTML = ''; return; }
  const tabs = [['sell', 'Sell'], ['today', 'My sales']];
  if (isManager()) tabs.push(['dash', 'Dashboard'], ['manage', 'Manage']);
  tabs.push(['account', 'Account']);
  n.innerHTML = tabs.map(([v, l]) => `<button data-nav="${v}" class="${S.view === v ? 'active' : ''}">${l}</button>`).join('');
}

function render() {
  renderHeader(); renderNav();
  const m = $('#main');
  const views = { login: vLogin, verify: vVerify, loading: () => '<p class="muted center">Loading…</p>', noaccess: vNoAccess,
    sell: vSell, checkout: vCheckout, receipt: vReceipt, today: vToday, dash: vDash, manage: vManage, account: vAccount };
  // Keep the category ribbon where it was scrolled to; redrawing would otherwise jump it back to "All".
  const chipsX = render.lastView === S.view ? m.querySelector('.chips')?.scrollLeft || 0 : 0;
  render.lastView = S.view;
  m.innerHTML = (views[S.view] || vSell)();
  const chips = m.querySelector('.chips');
  if (chips) {
    chips.scrollLeft = chipsX;
    const active = chips.querySelector('.active');
    if (active && (active.offsetLeft < chips.scrollLeft || active.offsetLeft + active.offsetWidth > chips.scrollLeft + chips.clientWidth)) active.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
  $('#cartbar').innerHTML = S.view === 'sell' ? cartBar() : '';
  if (S.view === 'checkout') updateTotals();
}

// ----- auth views -----
function vLogin() {
  const mode = S.authView;
  return `<div class="card narrow">
    <h2>${mode === 'signup' ? 'Set your password' : mode === 'reset' ? 'Reset password' : 'Sign in'}</h2>
    <form id="authForm">
      <label>Email<input type="email" name="email" required autocomplete="email"></label>
      ${mode !== 'reset' ? `<label>Password<input type="password" name="password" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>` : ''}
      <button class="primary big" type="submit">${mode === 'signup' ? 'Create login' : mode === 'reset' ? 'Send reset email' : 'Sign in'}</button>
    </form>
    <div class="links">
      ${mode !== 'signin' ? '<a data-auth="signin">Back to sign in</a>' : '<a data-auth="signup">First time? Set your password</a><a data-auth="reset">Forgot password</a>'}
    </div>
    <p class="muted small">Sign in once while online before the event. After that the app works without internet.</p>
  </div>`;
}
function vVerify() {
  return `<div class="card narrow"><h2>Verify your email</h2>
    <p>We sent a link to <b>${esc(S.user?.email)}</b>. Open it, then tap Continue.</p>
    <button class="primary big" data-act="verified">Continue</button>
    <button class="ghost" data-act="resendVerify">Resend email</button>
    <button class="ghost" data-act="signout">Sign out</button></div>`;
}
function vNoAccess() {
  return `<div class="card narrow"><h2>No access yet</h2>
    <p><b>${esc(S.email)}</b> isn't set up for this POS. Ask the manager to add you, then reopen the app.</p>
    <button class="ghost" data-act="signout">Sign out</button></div>`;
}
function vAccount() {
  return `<div class="card"><h2>Account</h2>
    <p>${esc(S.staff?.name || '')} <span class="muted">${esc(S.email)}</span></p>
    <p>Role: <b>${isManager() ? 'Manager' : 'Cashier'}</b> · Device ${deviceId()}</p>
    <button class="ghost" data-act="signout">Sign out</button>
    <p class="muted small">Don't sign out during the event if you are offline: you need internet to sign back in.</p></div>
    ${S.canReset ? `<div class="card"><h3>Clear test sales</h3>
      <p class="small">Removes every sale from the dashboard, My sales and exports, on all phones, so you can start fresh. Items, prices, staff, locations and coupons stay. Needs internet.</p>
      <button class="ghost danger" data-act="resetSales">Clear all sales</button></div>` : ''}`;
}

// ----- selling -----
function vSell() {
  if (!currentLoc()) return `<div class="card"><p>${isManager() ? 'Add a location under Manage → Locations to start selling.' : 'You have no location assigned. Ask the manager.'}</p></div>`;
  const items = S.items.filter((i) => i.active !== false);
  if (!items.length) return `<div class="card"><p>No items yet.${isManager() ? ' Add them under Manage → Items.' : ''}</p></div>`;
  const cats = ['All', ...new Set(items.map((i) => i.category || 'Other'))];
  const shown = S.category === 'All' ? items : items.filter((i) => (i.category || 'Other') === S.category);
  return `<input id="itemSearch" type="search" placeholder="Search items" autocomplete="off" class="search">
    <div class="chips">${cats.map((c) => `<button data-cat="${esc(c)}" class="${c === S.category ? 'active' : ''}">${esc(c)}</button>`).join('')}</div>
    <div class="grid">${shown.map((i) => {
      const q = S.cart.get(i.id) || 0;
      return `<button class="tile ${q ? 'in' : ''}" data-add="${i.id}">
        <span class="name" data-name="${esc(i.name.toLowerCase())}">${esc(i.name)}</span><span class="price">${inr(i.price)}</span>${q ? `<span class="qty">${q}</span>` : ''}</button>`;
    }).join('')}</div>`;
}
function cartLines() {
  const out = [];
  for (const [id, qty] of S.cart) {
    const it = S.items.find((i) => i.id === id);
    if (it && qty > 0) out.push({ itemId: id, name: it.name, category: it.category || '', price: Number(it.price), qty });
  }
  return out;
}
function cartBar() {
  const lines = cartLines();
  if (!lines.length) return '';
  const count = lines.reduce((s, l) => s + l.qty, 0);
  return `<div class="bar"><button class="ghost" data-act="clearCart">Clear</button>
    <button class="primary" data-act="checkout">${count} item${count > 1 ? 's' : ''} · ${inr(computeTotals(lines).gross)} → Checkout</button></div>`;
}
const activeCoupons = () => S.coupons.filter((c) => c.active !== false);
function discountSpec() {
  const d = S.discount;
  if (d.mode === 'percent') return { type: 'percent', value: d.value };
  if (d.mode === 'amount') return { type: 'amount', value: d.value };
  if (d.mode === 'coupon' && d.coupon) return Number(d.coupon.percent) >= 100 ? { type: 'csr' } : { type: 'percent', value: d.coupon.percent };
  return { type: 'none', value: 0 };
}
const isCsr = () => S.discount.mode === 'coupon' && !!S.discount.coupon?.csr;

function vCheckout() {
  const lines = cartLines();
  const d = S.discount;
  const sel = d.mode === 'coupon' ? 'c:' + d.coupon.code : d.mode;
  return `<div class="card">
    <div class="row"><h2>Checkout</h2><button class="ghost" data-act="backToSell">← Add more</button></div>
    ${lines.map((l) => `<div class="line"><span class="ln">${esc(l.name)}<br><small class="muted">${inr(l.price)} each</small></span>
      <span class="stepper"><button data-dec="${l.itemId}">−</button><b>${l.qty}</b><button data-inc="${l.itemId}">+</button></span>
      <span class="amt">${inr(l.price * l.qty)}</span></div>`).join('')}
  </div>
  <div class="card">
    <label>Discount on total
      <select id="discMode">
        <option value="none" ${sel === 'none' ? 'selected' : ''}>No discount</option>
        ${activeCoupons().map((c) => `<option value="c:${esc(c.code)}" ${sel === 'c:' + c.code ? 'selected' : ''}>${esc(c.label || c.code)} (${c.percent}%)</option>`).join('')}
      </select></label>
    ${d.mode === 'percent' || d.mode === 'amount' ? `<label>${d.mode === 'percent' ? 'Percent off' : 'Amount off (₹)'}<input id="discVal" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(d.value)}"></label>` : ''}
    ${d.mode === 'none' ? `<div class="inline"><input id="codeIn" placeholder="Coupon code" autocapitalize="characters"><button class="ghost" data-act="applyCode">Apply</button></div>` : ''}
    ${isCsr() ? `<label>Officer name / ID (optional)<input id="csrRef" value="${esc(S.csrRef)}"></label>` : ''}
  </div>
  <div class="card" id="totals"></div>
  <div class="card" id="payBox"></div>
  <button class="primary big" id="completeBtn" data-act="complete">Complete sale</button>`;
}
function updateTotals() {
  const t = computeTotals(cartLines(), discountSpec());
  $('#totals').innerHTML = `
    <div class="tl"><span>Total (incl. GST)</span><span>${inr(t.gross)}</span></div>
    ${t.discountAmount ? `<div class="tl"><span>Discount${isCsr() ? ' · CSR' : ''}</span><span>− ${inr(t.discountAmount)}</span></div>` : ''}
    <div class="tl muted small"><span>Taxable value</span><span>${inr(t.taxable)}</span></div>
    <div class="tl muted small"><span>GST 5% (CGST ${inr(t.cgst)} + SGST ${inr(t.sgst)})</span><span>${inr(t.gst)}</span></div>
    <div class="tl grand"><span>To pay</span><span>${inr(t.net)}</span></div>`;
  const pay = $('#payBox');
  if (t.net === 0) { pay.innerHTML = '<p class="center"><b>No payment needed</b> (free)</p>'; return; }
  if (!$('#cashIn') || S.payment !== 'cash') {
    pay.innerHTML = `<div class="pay">
        <button data-pay="cash" class="${S.payment === 'cash' ? 'sel' : ''}">Cash</button>
        <button data-pay="upi" class="${S.payment === 'upi' ? 'sel' : ''}">UPI</button></div>
      ${S.payment === 'cash' ? `<label>Cash received (optional)<input id="cashIn" type="number" inputmode="decimal" value="${esc(S.cashGiven)}"></label><p class="tl" id="change"></p>` : ''}`;
  }
  if (S.payment === 'cash') updateChange(t.net);
}
function updateChange(net) {
  const c = $('#change'); if (!c) return;
  const change = Number(S.cashGiven) > 0 ? r2(Number(S.cashGiven) - net) : null;
  c.innerHTML = change === null ? '' : `<span>Change to give</span><b>${change >= 0 ? inr(change) : 'Short ' + inr(-change)}</b>`;
}
function resetSale() {
  S.cart = new Map(); S.discount = { mode: 'none', value: '', coupon: null }; S.csrRef = ''; S.payment = null; S.cashGiven = '';
}
function completeSale() {
  const lines = cartLines();
  if (!lines.length) return toast('Cart is empty');
  const loc = currentLoc();
  if (!loc) return toast('Choose a location first');
  const t = computeTotals(lines, discountSpec());
  const payment = t.net === 0 ? 'free' : S.payment;
  if (!payment) return toast('Choose Cash or UPI');
  const now = new Date();
  const invoiceNo = `${loc.code || 'L'}-${deviceId()}-${String(nextSeq()).padStart(4, '0')}`;
  const d = S.discount;
  const sale = {
    invoiceNo, day: dayStr(now), createdAt: now.toISOString(), clientTs: now.getTime(),
    locationId: loc.id, locationName: loc.name, locationCode: loc.code || '',
    cashierEmail: S.email, cashierName: S.staff?.name || '', deviceId: deviceId(),
    lines: lines.map((l) => ({ itemId: l.itemId, name: l.name, category: l.category, qty: l.qty, unitPrice: l.price, amount: r2(l.price * l.qty) })),
    itemCount: lines.reduce((s, l) => s + l.qty, 0),
    discountType: d.mode, discountValue: d.mode === 'percent' || d.mode === 'amount' ? Number(d.value) || 0 : d.mode === 'coupon' ? Number(d.coupon.percent) : 0,
    couponCode: d.mode === 'coupon' ? d.coupon.code : '', csr: isCsr(), csrRef: isCsr() ? S.csrRef.trim() : '',
    ...t, payment, cashReceived: payment === 'cash' ? Number(S.cashGiven) || 0 : 0, status: 'completed',
  };
  // Keep a copy on the phone in case the server ever rejects the write.
  const backup = ls.get('tcps_backup', []); backup.push(sale); ls.set('tcps_backup', backup);
  setDoc(doc(db, 'sales', invoiceNo), { ...sale, serverAt: serverTimestamp() })
    .catch((e) => { console.error(e); toast(`Sale ${invoiceNo} was not accepted by the server (${e.code}). It is kept on this phone.`); });
  S.lastSale = sale; resetSale(); S.view = 'receipt'; render();
}
function vReceipt() {
  const s = S.lastSale;
  const synced = S.mySales.find((x) => x.id === s.invoiceNo && !x._pending);
  return `<div class="card receipt">
    <h2 class="center">✓ Sale saved</h2>
    <p class="center big-num">${inr(s.net)}</p>
    <p class="center">${s.payment === 'free' ? (s.csr ? 'Free · Police CSR' : 'Free') : s.payment.toUpperCase()}</p>
    <p class="center muted">${esc(s.invoiceNo)} · ${esc(s.locationName)} · ${timeStr(s.createdAt)}</p>
    <p class="center small ${synced ? 'ok' : 'warn'}">${synced ? 'Synced to server' : 'Saved on phone, will sync when online'}</p>
    ${s.lines.map((l) => `<div class="tl small"><span>${l.qty} × ${esc(l.name)}</span><span>${inr(l.amount)}</span></div>`).join('')}
    ${s.discountAmount ? `<div class="tl small"><span>Discount</span><span>− ${inr(s.discountAmount)}</span></div>` : ''}
    <div class="tl small muted"><span>incl. GST 5%</span><span>${inr(s.gst)}</span></div>
  </div>
  <button class="primary big" data-act="newSale">New sale</button>`;
}

// ----- my sales -----
function summarize(sales) {
  const ok = sales.filter((s) => s.status !== 'void');
  const sum = (arr, k) => r2(arr.reduce((a, s) => a + (Number(s[k]) || 0), 0));
  const by = (p) => ok.filter((s) => s.payment === p);
  return {
    count: ok.length, gross: sum(ok, 'gross'), discount: sum(ok, 'discountAmount'), net: sum(ok, 'net'), gst: sum(ok, 'gst'),
    cash: sum(by('cash'), 'net'), cashN: by('cash').length, upi: sum(by('upi'), 'net'), upiN: by('upi').length,
    freeN: by('free').length, csrN: ok.filter((s) => s.csr).length, csrValue: sum(ok.filter((s) => s.csr), 'discountAmount'),
    voidN: sales.length - ok.length,
  };
}
function statTiles(t) {
  return `<div class="stats">
    <div><small>Sales</small><b>${inr(t.net)}</b><small>${t.count} bills</small></div>
    <div><small>Cash</small><b>${inr(t.cash)}</b><small>${t.cashN} bills</small></div>
    <div><small>UPI</small><b>${inr(t.upi)}</b><small>${t.upiN} bills</small></div>
    <div><small>Police CSR</small><b>${t.csrN}</b><small>${inr(t.csrValue)} given</small></div>
    <div><small>Discounts</small><b>${inr(t.discount)}</b><small>incl. CSR</small></div>
    <div><small>GST in sales</small><b>${inr(t.gst)}</b><small>${t.voidN ? t.voidN + ' void' : '&nbsp;'}</small></div>
  </div>`;
}
function saleRow(s, canVoid) {
  return `<div class="sale ${s.status === 'void' ? 'void' : ''}">
    <div><b>${esc(s.invoiceNo)}</b> <span class="muted small">${timeStr(s.createdAt)} · ${esc(s.locationName)}${canVoid ? ' · ' + esc(s.cashierName || s.cashierEmail) : ''}</span><br>
    <span class="small">${s.lines.map((l) => `${l.qty}× ${esc(l.name)}`).join(', ')}</span></div>
    <div class="right"><b>${inr(s.net)}</b><br><span class="small">${s.status === 'void' ? 'VOID' : s.csr ? 'CSR' : s.payment.toUpperCase()}</span>
    ${s._pending ? '<br><span class="small warn">to sync</span>' : ''}
    ${canVoid && s.status !== 'void' ? `<br><button class="tiny" data-void="${esc(s.id)}">Void</button>` : ''}</div></div>`;
}
function vToday() {
  const backup = ls.get('tcps_backup', []);
  return `<div class="card"><h2>My sales today</h2>${statTiles(summarize(S.mySales))}</div>
    <div class="card">${S.mySales.length ? S.mySales.map((s) => saleRow(s, false)).join('') : '<p class="muted">No sales yet today.</p>'}</div>
    <div class="card small"><p>This phone holds a backup of ${backup.length} sale${backup.length === 1 ? '' : 's'}.</p>
    <button class="ghost" data-act="dlBackup">Download phone backup (CSV)</button></div>`;
}

// ----- manager dashboard -----
function vDash() {
  const all = S.allSales;
  const ok = all.filter((s) => s.status !== 'void');
  const groups = (keyFn) => { const m = new Map(); ok.forEach((s) => { const k = keyFn(s); m.set(k, [...(m.get(k) || []), s]); }); return [...m.entries()]; };
  const byLoc = groups((s) => s.locationName || s.locationId).sort((a, b) => a[0].localeCompare(b[0]));
  const items = new Map();
  ok.forEach((s) => s.lines.forEach((l) => { const e = items.get(l.name) || { qty: 0, amt: 0, free: 0 }; e.qty += l.qty; e.amt += l.amount; if (s.csr) e.free += l.qty; items.set(l.name, e); }));
  const coupons = groups((s) => s.couponCode || '').filter(([k]) => k);
  return `<div class="card"><div class="row"><h2>Live dashboard</h2><input type="date" id="dashDay" value="${S.dashDay}"></div>
    ${statTiles(summarize(all))}
    <p class="muted small">Phones that are offline appear here once they reconnect.</p></div>
    <div class="card"><h3>By location</h3><table><tr><th>Location</th><th>Bills</th><th>Cash</th><th>UPI</th><th>CSR</th><th>Total</th></tr>
      ${byLoc.map(([k, ss]) => { const t = summarize(ss); return `<tr><td>${esc(k)}</td><td>${t.count}</td><td>${inr(t.cash)}</td><td>${inr(t.upi)}</td><td>${t.csrN}</td><td><b>${inr(t.net)}</b></td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No sales yet</td></tr>'}
    </table></div>
    <div class="card"><h3>Coupons</h3><table><tr><th>Code</th><th>Uses</th><th>Value given</th></tr>
      ${coupons.map(([k, ss]) => `<tr><td>${esc(k)}</td><td>${ss.length}</td><td>${inr(summarize(ss).discount)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">None used</td></tr>'}
    </table></div>
    <div class="card"><h3>Items sold</h3><table><tr><th>Item</th><th>Qty</th><th>Free (CSR)</th><th>Value</th></tr>
      ${[...items.entries()].sort((a, b) => b[1].qty - a[1].qty).map(([k, e]) => `<tr><td>${esc(k)}</td><td>${e.qty}</td><td>${e.free}</td><td>${inr(e.amt)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">—</td></tr>'}
    </table></div>
    <div class="card"><h3>Export</h3>
      <button class="ghost" data-act="exportInvoices">Invoices CSV</button>
      <button class="ghost" data-act="exportLines">Invoice lines CSV</button></div>
    <div class="card"><h3>All bills (${all.length})</h3>${all.map((s) => saleRow(s, true)).join('') || '<p class="muted">No bills.</p>'}</div>`;
}
const INV_HEAD = ['Invoice No', 'Date', 'Time', 'Location', 'Location Code', 'Cashier', 'Cashier Email', 'Items', 'Gross (incl GST)', 'Discount Type', 'Discount Value', 'Coupon', 'Discount Amount', 'Net (incl GST)', 'Taxable Value', 'CGST 2.5%', 'SGST 2.5%', 'GST Total', 'Payment', 'Cash Received', 'CSR', 'Officer Ref', 'Status', 'Device'];
const invRow = (s) => [s.invoiceNo, s.day, timeStr(s.createdAt), s.locationName, s.locationCode, s.cashierName, s.cashierEmail, s.itemCount, s.gross, s.discountType, s.discountValue, s.couponCode, s.discountAmount, s.net, s.taxable, s.cgst, s.sgst, s.gst, s.payment, s.cashReceived, s.csr ? 'Yes' : 'No', s.csrRef, s.status, s.deviceId];
function exportInvoices(sales, name) { download(name, [INV_HEAD, ...sales.map(invRow)]); }
function exportLines(sales, name) {
  // Discount is spread across lines in proportion to their value, so line totals add up to the invoice.
  const rows = [['Invoice No', 'Date', 'Location', 'Cashier Email', 'Payment', 'CSR', 'Coupon', 'Status', 'Item', 'Category', 'Qty', 'Unit Price (incl GST)', 'Line Gross (incl GST)', 'Line Discount', 'Line Net (incl GST)', 'Line Taxable', 'Line GST 5%']];
  sales.forEach((s) => {
    let left = s.discountAmount;
    s.lines.forEach((l, i) => {
      const disc = i === s.lines.length - 1 ? r2(left) : r2(s.gross ? s.discountAmount * l.amount / s.gross : 0);
      left = r2(left - disc);
      const net = r2(l.amount - disc); const taxable = r2(net / 1.05);
      rows.push([s.invoiceNo, s.day, s.locationName, s.cashierEmail, s.payment, s.csr ? 'Yes' : 'No', s.couponCode, s.status, l.name, l.category, l.qty, l.unitPrice, l.amount, disc, net, taxable, r2(net - taxable)]);
    });
  });
  download(name, rows);
}

// ----- manage -----
function vManage() {
  const tabs = [['items', 'Items'], ['staff', 'Staff'], ['locations', 'Locations'], ['coupons', 'Coupons'], ['log', 'Price log']];
  const body = { items: mItems, staff: mStaff, locations: mLocations, coupons: mCoupons, log: mLog }[S.manageTab]();
  return `<div class="chips">${tabs.map(([k, l]) => `<button data-mtab="${k}" class="${S.manageTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>${body}`;
}
function mItems() {
  if (S.editItem) {
    const it = S.editItem;
    return `<div class="card"><h2>${it.id ? 'Edit item' : 'New item'}</h2><form id="itemForm">
      <label>Name<input name="name" required value="${esc(it.name)}"></label>
      <label>Price incl. GST (₹)<input name="price" type="number" step="0.01" min="0" inputmode="decimal" required value="${esc(it.price)}"></label>
      <label>Category<input name="category" list="cats" value="${esc(it.category)}"></label>
      <datalist id="cats">${[...new Set(S.items.map((i) => i.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <label class="check"><input type="checkbox" name="active" ${it.active !== false ? 'checked' : ''}> Available for sale</label>
      <button class="primary big">Save</button><button type="button" class="ghost" data-act="cancelEdit">Cancel</button></form></div>`;
  }
  return `<div class="card"><div class="row"><h2>Items</h2><button class="primary" data-act="newItem">+ Add</button></div>
    ${S.items.map((i) => `<div class="sale" data-edititem="${i.id}"><div><b>${esc(i.name)}</b><br><span class="small muted">${esc(i.category || 'Other')}${i.active === false ? ' · hidden' : ''}</span></div><div class="right"><b>${inr(i.price)}</b><br><span class="small">Edit</span></div></div>`).join('') || '<p class="muted">No items yet.</p>'}</div>
    ${PRODUCTS.some((p) => !S.items.find((i) => i.name === p.name)) ? `<div class="card"><h3>Event product list</h3>
      <p class="small">Load the ${PRODUCTS.length} Coffee Santhe products and hot drinks. Items you already have are skipped.</p>
      <button class="primary" data-act="importProducts">Load product list</button></div>` : ''}
    <div class="card"><h3>Bulk add</h3><p class="small muted">One item per line: <code>Name, Price incl GST, Category</code></p>
      <textarea id="bulk" rows="6" placeholder="Filter Coffee, 30, Beverages&#10;Masala Tea, 20, Beverages"></textarea>
      <button class="ghost" data-act="bulkAdd">Add these items</button></div>`;
}
function mStaff() {
  if (S.editStaff) {
    const s = S.editStaff;
    return `<div class="card"><h2>${s.id ? 'Edit user' : 'Add user'}</h2><form id="staffForm">
      <label>Email<input name="email" type="email" required value="${esc(s.id || '')}" ${s.id ? 'readonly' : ''}></label>
      <label>Name<input name="name" value="${esc(s.name)}"></label>
      <label>Role<select name="role"><option value="cashier" ${s.role !== 'manager' ? 'selected' : ''}>Cashier (POS only)</option><option value="manager" ${s.role === 'manager' ? 'selected' : ''}>Manager</option></select></label>
      <fieldset><legend>Locations (cashiers)</legend>${S.locations.map((l) => `<label class="check"><input type="checkbox" name="loc" value="${l.id}" ${(s.locations || []).includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('') || '<p class="muted small">Add locations first.</p>'}</fieldset>
      <label class="check"><input type="checkbox" name="active" ${s.active !== false ? 'checked' : ''}> Access enabled</label>
      <button class="primary big">Save</button><button type="button" class="ghost" data-act="cancelEdit">Cancel</button>
      ${s.id && S.isOwner && s.id !== S.email ? '<button type="button" class="ghost danger" data-act="deleteStaff">Delete user</button>' : ''}</form>
      <p class="small muted">After saving, the person opens the app, taps "First time? Set your password" and uses this email.</p></div>`;
  }
  const locName = (id) => S.locations.find((l) => l.id === id)?.name || '?';
  return `<div class="card"><div class="row"><h2>Staff</h2><button class="primary" data-act="newStaff">+ Add</button></div>
    ${S.staffList.map((s) => `<div class="sale" data-editstaff="${esc(s.id)}"><div><b>${esc(s.name || s.id)}</b><br><span class="small muted">${esc(s.id)}</span><br><span class="small">${s.role === 'manager' ? 'Manager · all locations' : (s.locations || []).map(locName).join(', ') || 'No location'}</span></div><div class="right small">${s.active === false ? 'Disabled' : 'Active'}<br>Edit</div></div>`).join('') || '<p class="muted">No staff yet.</p>'}</div>`;
}
function mLocations() {
  return `<div class="card"><h2>Locations</h2>
    ${S.locations.map((l) => `<div class="sale"><div><b>${esc(l.name)}</b> <span class="muted small">code ${esc(l.code)}</span></div><div class="right"><button class="tiny" data-renameloc="${l.id}">Rename</button></div></div>`).join('') || '<p class="muted">No locations yet.</p>'}
    <form id="locForm" class="inline"><input name="name" placeholder="Location name" required><input name="code" placeholder="Code e.g. L1" maxlength="6" required style="max-width:7em"><button class="primary">Add</button></form>
    <p class="small muted">The code starts every invoice number from that location.</p></div>`;
}
function mCoupons() {
  return `<div class="card"><h2>Coupons</h2>
    ${S.coupons.map((c) => `<div class="sale"><div><b>${esc(c.code)}</b> · ${esc(c.label)}<br><span class="small">${c.percent}% off${c.csr ? ' · CSR' : ''}</span></div><div class="right"><button class="tiny" data-togglecoupon="${esc(c.id)}">${c.active === false ? 'Enable' : 'Disable'}</button></div></div>`).join('') || '<p class="muted">No coupons.</p>'}
    <form id="couponForm"><div class="inline"><input name="code" placeholder="CODE" required autocapitalize="characters" style="max-width:8em"><input name="label" placeholder="Label shown in dropdown" required></div>
    <div class="inline"><input name="percent" type="number" min="1" max="100" placeholder="% off" required style="max-width:7em"><label class="check"><input type="checkbox" name="csr"> CSR (free)</label><button class="primary">Add</button></div></form></div>`;
}
function mLog() {
  return `<div class="card"><h2>Item and price change log</h2>
    ${S.itemLog.map((e) => `<div class="sale"><div><b>${esc(e.itemName)}</b> <span class="small muted">${e.action}</span><br>
      <span class="small">${Object.entries(e.changes || {}).map(([k, v]) => `${esc(k)}: ${esc(v.from ?? '—')} → ${esc(v.to)}`).join('<br>')}</span></div>
      <div class="right small muted">${new Date(e.at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}<br>${esc(e.by)}</div></div>`).join('') || '<p class="muted">No changes yet.</p>'}</div>`;
}

async function saveItem(id, data) {
  const before = id ? S.items.find((i) => i.id === id) || {} : {};
  const changes = {};
  for (const k of ['name', 'price', 'category', 'active']) if (before[k] !== data[k]) changes[k] = { from: before[k] ?? null, to: data[k] };
  if (id && !Object.keys(changes).length) return;
  const ref = id ? doc(db, 'items', id) : doc(collection(db, 'items'));
  const meta = { updatedAt: new Date().toISOString(), updatedBy: S.email };
  (id ? updateDoc(ref, { ...data, ...meta }) : setDoc(ref, { ...data, ...meta })).catch((e) => toast('Save failed: ' + e.code));
  addDoc(collection(db, 'itemLog'), { itemId: ref.id, itemName: data.name, action: id ? 'update' : 'create', changes, by: S.email, at: meta.updatedAt });
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a, [data-edititem], [data-editstaff]');
  if (!t) return;
  const d = t.dataset;
  if (d.nav) { S.view = d.nav; S.editItem = S.editStaff = null; return render(); }
  if (d.auth) { S.authView = d.auth; return render(); }
  if (d.cat) { S.category = d.cat; return render(); }
  if (d.add) { S.cart.set(d.add, (S.cart.get(d.add) || 0) + 1); return render(); }
  if (d.inc || d.dec) {
    const id = d.inc || d.dec; const q = (S.cart.get(id) || 0) + (d.inc ? 1 : -1);
    if (q > 0) S.cart.set(id, q); else S.cart.delete(id);
    if (!S.cart.size) S.view = 'sell';
    return render();
  }
  if (d.pay) { S.payment = d.pay; return updateTotals(); }
  if (d.mtab) { S.manageTab = d.mtab; S.editItem = S.editStaff = null; return render(); }
  if (d.edititem) { S.editItem = { ...S.items.find((i) => i.id === d.edititem) }; return render(); }
  if (d.editstaff) { S.editStaff = { ...S.staffList.find((s) => s.id === d.editstaff) }; return render(); }
  if (d.void) {
    if (!confirm(`Void bill ${d.void}? It stays in the records marked VOID.`)) return;
    updateDoc(doc(db, 'sales', d.void), { status: 'void', voidBy: S.email, voidAt: new Date().toISOString() }).catch((er) => toast('Void failed: ' + er.code));
    return;
  }
  if (d.renameloc) {
    const l = S.locations.find((x) => x.id === d.renameloc); const name = prompt('New name', l.name);
    if (name) updateDoc(doc(db, 'locations', l.id), { name: name.trim() });
    return;
  }
  if (d.togglecoupon) { const c = S.coupons.find((x) => x.id === d.togglecoupon); updateDoc(doc(db, 'coupons', c.id), { active: c.active === false }); return; }
  switch (d.act) {
    case 'signout': S.cart = new Map(); return signOut(auth);
    case 'resetSales': {
      if (!S.canReset) return;
      if (!navigator.onLine) return toast('Connect to the internet first');
      if ((prompt('This clears ALL sales on every phone. Type CLEAR to confirm.') || '').trim().toUpperCase() !== 'CLEAR') return toast('Nothing cleared');
      t.disabled = true;
      try {
        // Sales are marked deleted rather than removed, so invoice numbers are never reused.
        const snap = await getDocs(collection(db, 'sales'));
        const live = snap.docs.filter((d) => d.data().status !== 'deleted');
        for (let i = 0; i < live.length; i += 400) {
          const b = writeBatch(db);
          live.slice(i, i + 400).forEach((d) => b.update(d.ref, { status: 'deleted', deletedBy: S.email, deletedAt: new Date().toISOString() }));
          await b.commit();
        }
        ls.set('tcps_backup', []);
        toast(`${live.length} sales cleared`);
      } catch (er) { toast('Could not clear: ' + er.code); }
      t.disabled = false;
      return;
    }
    case 'verified':
      await auth.currentUser.reload(); await auth.currentUser.getIdToken(true);
      if (!auth.currentUser.emailVerified) return toast('Not verified yet. Check your inbox.');
      location.reload(); return;
    case 'resendVerify': await sendEmailVerification(auth.currentUser); return toast('Email sent');
    case 'clearCart': S.cart = new Map(); return render();
    case 'checkout': S.view = 'checkout'; return render();
    case 'backToSell': S.view = 'sell'; return render();
    case 'applyCode': {
      const code = ($('#codeIn').value || '').trim().toUpperCase();
      const c = activeCoupons().find((x) => x.code.toUpperCase() === code);
      if (!c) return toast('Unknown coupon code');
      S.discount = { mode: 'coupon', value: '', coupon: c }; return render();
    }
    case 'complete': t.disabled = true; return completeSale();
    case 'newSale': S.view = 'sell'; return render();
    case 'dlBackup': return exportInvoices(ls.get('tcps_backup', []), `phone-backup-${deviceId()}-${dayStr()}.csv`);
    case 'exportInvoices': return exportInvoices(S.allSales, `invoices-${S.dashDay}.csv`);
    case 'exportLines': return exportLines(S.allSales, `invoice-lines-${S.dashDay}.csv`);
    case 'newItem': S.editItem = { name: '', price: '', category: '', active: true }; return render();
    case 'newStaff': S.editStaff = { role: 'cashier', locations: [], active: true }; return render();
    case 'deleteStaff': {
      const id = S.editStaff?.id;
      if (!id || !S.isOwner) return;
      if (!confirm(`Delete ${S.editStaff.name || id}? They lose access straight away. Their past sales stay in the records.`)) return;
      deleteDoc(doc(db, 'staff', id)).catch((er) => toast('Delete failed: ' + er.code));
      S.editStaff = null; render(); return toast('User deleted');
    }
    case 'cancelEdit': S.editItem = S.editStaff = null; return render();
    case 'importProducts': {
      const have = new Set(S.items.map((i) => i.name));
      const add = PRODUCTS.map((p, n) => ({ ...p, sort: n })).filter((p) => !have.has(p.name));
      add.forEach((p) => saveItem(null, { name: p.name, price: p.price, category: p.category, active: true, sort: p.sort }));
      return toast(`${add.length} items added`);
    }
    case 'bulkAdd': {
      const rows = $('#bulk').value.split('\n').map((r) => r.split(',').map((x) => x.trim())).filter((r) => r[0]);
      const bad = rows.filter((r) => !(Number(r[1]) >= 0) || r[1] === undefined || r[1] === '');
      if (bad.length) return toast(`Check price on: ${bad.map((r) => r[0]).join(', ')}`);
      rows.forEach((r) => saveItem(null, { name: r[0], price: Number(r[1]), category: r[2] || '', active: true }));
      return toast(`${rows.length} items added`);
    }
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'discMode') {
    const v = t.value;
    S.discount = v.startsWith('c:') ? { mode: 'coupon', value: '', coupon: activeCoupons().find((c) => c.code === v.slice(2)) } : { mode: v, value: '', coupon: null };
    return render();
  }
  if (t.id === 'dashDay') { S.dashDay = t.value || dayStr(); watchDashDay(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'itemSearch') {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.tile').forEach((t) => { t.style.display = !q || t.querySelector('.name').dataset.name.includes(q) ? '' : 'none'; });
  }
  if (e.target.id === 'discVal') { S.discount.value = e.target.value; updateTotals(); }
  if (e.target.id === 'csrRef') S.csrRef = e.target.value;
  if (e.target.id === 'cashIn') { S.cashGiven = e.target.value; updateChange(computeTotals(cartLines(), discountSpec()).net); }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const fd = new FormData(f);
  try {
    if (f.id === 'authForm') {
      const email = fd.get('email').trim(); const pw = fd.get('password');
      if (S.authView === 'reset') { await sendPasswordResetEmail(auth, email); toast('Reset email sent'); S.authView = 'signin'; return render(); }
      if (S.authView === 'signup') { const c = await createUserWithEmailAndPassword(auth, email, pw); if (OWNER_EMAIL_SHA256.includes(await sha256(email.toLowerCase()))) await sendEmailVerification(c.user); return; }
      await signInWithEmailAndPassword(auth, email, pw);
    }
    if (f.id === 'itemForm') {
      const data = { name: fd.get('name').trim(), price: r2(Number(fd.get('price'))), category: fd.get('category').trim(), active: fd.get('active') === 'on' };
      saveItem(S.editItem.id, data); S.editItem = null; render();
    }
    if (f.id === 'staffForm') {
      const email = (S.editStaff.id || fd.get('email')).trim().toLowerCase();
      setDoc(doc(db, 'staff', email), { name: fd.get('name').trim(), role: fd.get('role'), locations: fd.getAll('loc'), active: fd.get('active') === 'on', updatedBy: S.email, updatedAt: new Date().toISOString() })
        .catch((er) => toast('Save failed: ' + er.code));
      S.editStaff = null; render();
    }
    if (f.id === 'locForm') {
      setDoc(doc(collection(db, 'locations')), { name: fd.get('name').trim(), code: fd.get('code').trim().toUpperCase() }); f.reset();
    }
    if (f.id === 'couponForm') {
      const code = fd.get('code').trim().toUpperCase();
      setDoc(doc(db, 'coupons', code), { code, label: fd.get('label').trim(), percent: Number(fd.get('percent')), csr: fd.get('csr') === 'on', active: true }); f.reset();
    }
  } catch (er) {
    const msg = { 'auth/invalid-credential': 'Wrong email or password', 'auth/email-already-in-use': 'This email already has a login. Sign in instead.', 'auth/network-request-failed': 'No internet. Connect once to sign in.', 'auth/weak-password': 'Use at least 6 characters' }[er.code];
    toast(msg || er.message);
  }
});

window.addEventListener('online', renderHeader);
window.addEventListener('offline', renderHeader);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
if (navigator.storage?.persist) navigator.storage.persist();
