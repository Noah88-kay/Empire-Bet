// ==========================================
// EMPIRE BET - MAIN APPLICATION LOGIC (app.js)
// ==========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, signOut, updateProfile 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
  getFirestore, doc, getDoc, setDoc, collection, addDoc, 
  serverTimestamp, query, where, getDocs, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentBalance = 0.00;
let currentBonus = 0.00;
let clickCount = 0;
let clickTimer = null;

// --- DOM ELEMENTS ---
const sections = document.querySelectorAll('.section');
const navItems = document.querySelectorAll('.nav-item');
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');

// --- UTILITIES ---
function showToast(message, type = 'success') {
  if(!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function showLoading(show) {
  if(!loadingOverlay) return;
  if (show) loadingOverlay.classList.remove('hidden');
  else loadingOverlay.classList.add('hidden');
}

function navigateTo(sectionId) {
  sections.forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`section-${sectionId}`);
  if (target) target.classList.add('active');
  
  navItems.forEach(nav => {
    if (nav.dataset.section === sectionId) nav.classList.add('active');
    else nav.classList.remove('active');
  });
  window.scrollTo(0, 0);
}

// Navigation Clicks
navItems.forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.section));
});

// Custom Back/Forward Buttons (like Deposit/Withdraw)
document.body.addEventListener('click', (e) => {
  const gotoBtn = e.target.closest('[data-goto]');
  if (gotoBtn) { e.preventDefault(); navigateTo(gotoBtn.dataset.goto); }
});

// --- ADMIN SECRET TRIGGER ---
document.getElementById('logoBtn').addEventListener('click', () => {
  clickCount++;
  if (clickCount === 3) {
    const pin = prompt("Enter Admin PIN:");
    if (pin === "2683") { navigateTo('admin'); } 
    else if (pin !== null) { showToast("Invalid PIN", "error"); }
    clickCount = 0;
  }
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => { clickCount = 0; }, 600);
});

// --- AUTHENTICATION FORMS ---
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authError = document.getElementById('authError');

document.getElementById('showRegister')?.addEventListener('click', (e) => {
  e.preventDefault(); loginForm.classList.add('hidden'); registerForm.classList.remove('hidden');
});
document.getElementById('showLogin')?.addEventListener('click', (e) => {
  e.preventDefault(); registerForm.classList.add('hidden'); loginForm.classList.remove('hidden');
});

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    showLoading(true);
    await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
    showToast("Logged in successfully!");
  } catch (err) { authError.textContent = err.message; } 
  finally { showLoading(false); }
});

registerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    showLoading(true);
    const cred = await createUserWithEmailAndPassword(auth, document.getElementById('regEmail').value, document.getElementById('regPassword').value);
    await updateProfile(cred.user, { displayName: document.getElementById('regName').value });
    
    // Save user profile in Firestore
    await setDoc(doc(db, "users", cred.user.uid), {
      name: document.getElementById('regName').value,
      email: document.getElementById('regEmail').value,
      phone: document.getElementById('regPhone').value,
      status: "active",
      createdAt: serverTimestamp()
    });
    
    // Create empty wallet
    await setDoc(doc(db, "wallets", cred.user.uid), {
      balance: 0.00, bonus: 0.00, currency: "USD", lastUpdated: serverTimestamp()
    });
    showToast("Account created successfully!");
  } catch (err) { authError.textContent = err.message; } 
  finally { showLoading(false); }
});

document.getElementById('logoutBtn')?.addEventListener('click', () => signOut(auth));

// --- AUTH STATE LISTENER ---
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    document.getElementById('headerBalance').classList.remove('hidden');
    await loadUserData(user.uid);
    if (document.getElementById('section-auth').classList.contains('active')) navigateTo('home');
  } else {
    currentUser = null;
    document.getElementById('headerBalance').classList.add('hidden');
    navigateTo('auth');
  }
});

async function loadUserData(uid) {
  try {
    const wDoc = await getDoc(doc(db, "wallets", uid));
    if (wDoc.exists()) {
      currentBalance = wDoc.data().balance || 0;
      currentBonus = wDoc.data().bonus || 0;
      const fmt = `$${currentBalance.toFixed(2)}`;
      document.getElementById('headerBalance').textContent = fmt;
      document.getElementById('accBalance').textContent = fmt;
      document.getElementById('accBonus').textContent = `$${currentBonus.toFixed(2)}`;
      document.getElementById('withdrawBal').textContent = fmt;
    }
    const uDoc = await getDoc(doc(db, "users", uid));
    if (uDoc.exists()) {
      document.getElementById('accName').textContent = uDoc.data().name;
      document.getElementById('accPhone').textContent = uDoc.data().phone;
    }
  } catch (err) { console.error("Error loading data:", err); }
}

// --- DEPOSIT SUBMISSION ---
document.getElementById('submitDepositBtn')?.addEventListener('click', async () => {
  if (!currentUser) return showToast("Please log in first", "error");
  
  const amt = parseFloat(document.getElementById('depAmount').value);
  const code = document.getElementById('depCode').value.trim().toUpperCase();
  
  if (amt < 1) return showToast("Min deposit is $1", "error");
  if (code.length < 5) return showToast("Invalid M-Pesa code", "error");

  try {
    showLoading(true);

    // 1. Fetch phone number from user profile
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    let userPhone = "Unknown";
    if (userDoc.exists()) {
      userPhone = userDoc.data().phone;
    }

    // 2. Check for duplicate transaction code
    const q = query(collection(db, "depositRequests"), where("transactionCode", "==", code));
    const existing = await getDocs(q);
    if (!existing.empty) {
      showToast("Code already used!", "error");
      showLoading(false);
      return;
    }

    // 3. Submit to database (MATCHING FIELD NAMES)
    await addDoc(collection(db, "depositRequests"), {
      userId: currentUser.uid, 
      phoneNumber: String(userPhone), // Matches rules
      amount: Number(amt), 
      transactionCode: String(code),  // Matches rules
      status: "pending", 
      createdAt: serverTimestamp()
    });
    
    showToast("Waiting for approval! Deposit submitted.", "success");
    document.getElementById('depCode').value = "";
    
  } catch (err) { 
    console.error("Firebase Error:", err); 
    showToast(err.message, "error"); 
  } finally { 
    showLoading(false); 
  }
});

// --- WITHDRAWAL SUBMISSION ---
document.getElementById('submitWithdrawBtn')?.addEventListener('click', async () => {
  if (!currentUser) return;
  const amt = parseFloat(document.getElementById('withAmount').value);
  const phone = document.getElementById('withPhone').value.trim();
  
  if (amt < 10) return showToast("Min withdrawal is $10", "error");
  if (amt > currentBalance) return showToast("Insufficient balance", "error");
  if (phone.length < 9) return showToast("Invalid phone number", "error");
  
  try {
    showLoading(true);
    
    await addDoc(collection(db, "withdrawalRequests"), {
      userId: currentUser.uid, 
      phoneNumber: String(phone), // Matches rules
      amount: Number(amt), 
      status: "pending", 
      createdAt: serverTimestamp()
    });
    
    showToast("Withdrawal request submitted for review.", "success");
    document.getElementById('withAmount').value = "";
    document.getElementById('withPhone').value = "";
  } catch (err) { 
    console.error(err);
    showToast(err.message, "error"); 
  } finally { 
    showLoading(false); 
  }
});

// --- CLAIM BONUS ---
document.getElementById('claimBonusBtn')?.addEventListener('click', async () => {
  if (!currentUser) return;
  try {
    showLoading(true);
    currentBonus += 9.00;
    await updateDoc(doc(db, "wallets", currentUser.uid), { bonus: currentBonus, lastUpdated: serverTimestamp() });
    document.getElementById('accBonus').textContent = `$${currentBonus.toFixed(2)}`;
    showToast("$9.00 Claimed Successfully!", "success");
  } catch (err) { showToast("Failed to claim bonus", "error"); } 
  finally { showLoading(false); }
});

// --- GENERATE 200 CASINO GAMES ---
const casinoGrid = document.getElementById('casinoGrid');
const games = ["Aviator", "Sweet Bonanza", "Gates of Olympus", "Mines", "Coin Flip", "Roulette", "Blackjack", "Dice", "Plinko", "Crash"];
for (let i = 11; i <= 200; i++) games.push(`Slot #${i}`);
const colors = ['bg-purple', 'bg-red', 'bg-blue', 'bg-green', 'bg-gold', 'bg-dark'];

function renderCasino() {
  if (!casinoGrid) return;
  casinoGrid.innerHTML = '';
  games.forEach((game, i) => {
    const card = document.createElement('div');
    card.className = `casino-card ${colors[i % colors.length]}`;
    card.innerHTML = `<div class="casino-overlay"><span>${game}</span></div>`;
    card.addEventListener('click', () => showToast(`Loading ${game}...`, "success"));
    casinoGrid.appendChild(card);
  });
}
renderCasino();
