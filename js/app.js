// ==========================================
// EMPIRE BET - FULL APPLICATION LOGIC (PART 1)
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

navItems.forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.section));
});

document.body.addEventListener('click', (e) => {
  const gotoBtn = e.target.closest('[data-goto]');
  if (gotoBtn) { e.preventDefault(); navigateTo(gotoBtn.dataset.goto); }
});

document.getElementById('logoBtn').addEventListener('click', () => {
  clickCount++;
  if (clickCount === 3) {
    const pin = prompt("Enter Admin PIN:");
    if (pin === "2683") { 
      navigateTo('admin'); 
      loadAdminData('deposits'); 
    } 
    else if (pin !== null) { showToast("Invalid PIN", "error"); }
    clickCount = 0;
  }
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => { clickCount = 0; }, 600);
});

// --- AUTHENTICATION ---
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authError = document.getElementById('authError');

document.getElementById('showRegister')?.addEventListener('click', (e) => {
  e.preventDefault(); 
  authError.textContent = "";
  loginForm.classList.add('hidden'); 
  registerForm.classList.remove('hidden');
  document.getElementById('loginEmail').value = "";
  document.getElementById('loginPassword').value = "";
});

document.getElementById('showLogin')?.addEventListener('click', (e) => {
  e.preventDefault(); 
  authError.textContent = "";
  registerForm.classList.add('hidden'); 
  loginForm.classList.remove('hidden');
  document.getElementById('regName').value = "";
  document.getElementById('regEmail').value = "";
  document.getElementById('regPhone').value = "";
  document.getElementById('regPassword').value = "";
});

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = "";
  try {
    showLoading(true);
    await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
    showToast("Logged in successfully!");
    document.getElementById('loginEmail').value = "";
    document.getElementById('loginPassword').value = "";
  } catch (err) { authError.textContent = err.message; } 
  finally { showLoading(false); }
});

registerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = "";
  try {
    showLoading(true);
    const cred = await createUserWithEmailAndPassword(auth, document.getElementById('regEmail').value, document.getElementById('regPassword').value);
    await updateProfile(cred.user, { displayName: document.getElementById('regName').value });
    
    await setDoc(doc(db, "users", cred.user.uid), {
      name: document.getElementById('regName').value,
      email: document.getElementById('regEmail').value,
      phone: document.getElementById('regPhone').value,
      status: "active",
      hasClaimedBonus: false,
      createdAt: serverTimestamp()
    });
    
    await setDoc(doc(db, "wallets", cred.user.uid), {
      balance: 0.00, bonus: 0.00, currency: "USD", lastUpdated: serverTimestamp()
    });
    showToast("Account created successfully!");
    document.getElementById('regName').value = "";
    document.getElementById('regEmail').value = "";
    document.getElementById('regPhone').value = "";
    document.getElementById('regPassword').value = "";
  } catch (err) { authError.textContent = err.message; } 
  finally { showLoading(false); }
});

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  try {
    showLoading(true);
    await signOut(auth);
    window.location.reload(); 
  } catch (err) {
    showToast("Error logging out", "error");
    showLoading(false);
  }
});

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
      const userData = uDoc.data();
      document.getElementById('accName').textContent = userData.name;
      document.getElementById('accPhone').textContent = userData.phone;

      if (userData.hasClaimedBonus) {
        lockPromotionTab();
      }
    }
  } catch (err) { console.error("Error loading data:", err); }
}

function lockPromotionTab() {
  const claimBtn = document.getElementById('claimBonusBtn');
  if (claimBtn) {
    claimBtn.textContent = "Bonus Already Claimed";
    claimBtn.disabled = true;
    claimBtn.style.opacity = "0.5";
    claimBtn.style.background = "var(--border)";
    claimBtn.style.color = "var(--text-muted)";
    claimBtn.style.boxShadow = "none";
  }

  const task1Btn = document.getElementById('btnTask1');
  if(task1Btn) task1Btn.disabled = true;
  
  const task2Select = document.getElementById('task2Select');
  if(task2Select) task2Select.disabled = true;
  
  const photoInput = document.getElementById('photoInput');
  if(photoInput) photoInput.disabled = true;
  
  const task4Input = document.getElementById('task4Input');
  if(task4Input) task4Input.disabled = true;

  const promoCard = document.querySelector('.promo-card');
  if (promoCard && !document.getElementById('lockedMsg')) {
    const lockMessage = document.createElement('div');
    lockMessage.id = "lockedMsg";
    lockMessage.innerHTML = `<p class="text-center gold-text mt-16 font-bold" style="font-size: 0.9rem;">✓ Account Verified. Bonus Claimed.</p>`;
    promoCard.appendChild(lockMessage);
  }
}

// --- DEPOSITS ---
document.getElementById('submitDepositBtn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!currentUser) return showToast("Please log in first", "error");
  
  const amt = Number(document.getElementById('depAmount').value);
  const code = document.getElementById('depCode').value.trim().toUpperCase();
  
  if (isNaN(amt) || amt < 1) return showToast("Min deposit is $1", "error");
  if (code.length < 5) return showToast("Invalid M-Pesa code", "error");

  try {
    showLoading(true);
    const uDoc = await getDoc(doc(db, "users", currentUser.uid));
    let phone = uDoc.exists() ? uDoc.data().phone : "Unknown";

    await addDoc(collection(db, "depositRequests"), {
      userId: currentUser.uid, 
      phoneNumber: String(phone), 
      amount: amt, 
      transactionCode: code, 
      status: "pending", 
      createdAt: serverTimestamp()
    });
    
    showToast("Waiting for approval! Deposit submitted.", "success");
    document.getElementById('depCode').value = "";
  } catch (err) { showToast(err.message, "error"); } 
  finally { showLoading(false); }
});

// --- WITHDRAWALS ---
document.getElementById('submitWithdrawBtn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  
  const amt = Number(document.getElementById('withAmount').value);
  const phone = document.getElementById('withPhone').value.trim();
  const feeCode = document.getElementById('feeCode').value.trim().toUpperCase();
  
  if (isNaN(amt) || amt < 10) return showToast("Minimum withdrawal is $10", "error");
  if (amt > currentBalance) return showToast("Insufficient balance", "error");
  if (phone.length < 9) return showToast("Invalid phone number", "error");
  if (feeCode.length < 5) return showToast("Please enter the M-Pesa code for the 32 KES fee", "error");
  
  try {
    showLoading(true);
    await addDoc(collection(db, "withdrawalRequests"), {
      userId: currentUser.uid, 
      phoneNumber: String(phone), 
      amount: amt, 
      feeCode: feeCode,
      status: "pending", 
      createdAt: serverTimestamp()
    });
    showToast("Withdrawal request submitted. Waiting for approval.", "success");
    document.getElementById('withAmount').value = "";
    document.getElementById('withPhone').value = "";
    document.getElementById('feeCode').value = "";
  } catch (err) { showToast(err.message, "error"); } 
  finally { showLoading(false); }
});

// --- PROMOTIONS ---
window.completeTask = function(taskNumber) {
  const taskElement = document.getElementById(`task${taskNumber}`);
  
  if (taskNumber === 1) {
    document.getElementById('btnTask1').textContent = "Done";
    document.getElementById('btnTask1').disabled = true;
    taskElement.classList.add('completed');
  } 
  else if (taskNumber === 2) {
    if (document.getElementById('task2Select').value !== "") taskElement.classList.add('completed');
  } 
  else if (taskNumber === 3) {
    const file = document.getElementById('photoInput').files[0];
    if (file) {
      taskElement.classList.add('completed');
      const uploadBtn = taskElement.querySelector('button');
      uploadBtn.textContent = "Uploaded";
      uploadBtn.style.color = "var(--green)";
      uploadBtn.style.borderColor = "var(--green)";
    }
  }
  else if (taskNumber === 4) {
    if (document.getElementById('task4Input').value === "4829") {
      document.getElementById('task4Input').style.borderColor = "var(--green)";
      taskElement.classList.add('completed');
    } else {
      document.getElementById('task4Input').style.borderColor = "var(--danger)";
      taskElement.classList.remove('completed');
    }
  }
};

document.getElementById('claimBonusBtn')?.addEventListener('click', async (e) => {
  e.preventDefault(); // STOPS REFRESH
  
  if (!currentUser) return;

  const country = document.getElementById('task2Select').value;
  const photo = document.getElementById('photoInput').files[0];
  const otp = document.getElementById('task4Input').value;

  if (country === "") return showToast("Please select your country.", "error");
  if (!photo) return showToast("Please upload a photo.", "error");
  if (otp !== "4829") return showToast("Incorrect OTP code. Please type 4829.", "error");

  try {
    // 1. INSTANTLY update the UI
    const btn = document.getElementById('claimBonusBtn');
    btn.textContent = "Claiming...";
    btn.disabled = true; 
    btn.style.opacity = "0.5";
    
    currentBalance += 9.00; 
    const fmt = `$${currentBalance.toFixed(2)}`;
    document.getElementById('headerBalance').textContent = fmt;
    document.getElementById('accBalance').textContent = fmt;
    document.getElementById('withdrawBal').textContent = fmt;

    // 2. Save to Firebase
    showLoading(true);
    
    await updateDoc(doc(db, "wallets", currentUser.uid), { 
      balance: currentBalance, 
      lastUpdated: serverTimestamp() 
    });

    await updateDoc(doc(db, "users", currentUser.uid), { 
      hasClaimedBonus: true 
    });

    // 3. Lock tab
    showToast("$9.00 Added to your Balance!", "success");
    lockPromotionTab(); 
    
  } catch (err) { 
    console.error(err);
    showToast("Failed to claim. Check internet.", "error"); 
    // Revert UI if failed
    currentBalance -= 9.00;
    const fmt = `$${currentBalance.toFixed(2)}`;
    document.getElementById('headerBalance').textContent = fmt;
    document.getElementById('accBalance').textContent = fmt;
    document.getElementById('withdrawBal').textContent = fmt;
    document.getElementById('claimBonusBtn').textContent = "Claim $9.00 Now";
    document.getElementById('claimBonusBtn').disabled = false;
    document.getElementById('claimBonusBtn').style.opacity = "1";
  } 
  finally { showLoading(false); }
});

// --- ADMIN PANEL ---
window.loadAdminData = async function(type) {
  const list = document.getElementById('adminList');
  list.innerHTML = '<p class="muted text-center">Loading...</p>';
  
  document.getElementById('tabDeposits').classList.remove('active');
  document.getElementById('tabWithdrawals').classList.remove('active');
  if (type === 'deposits') document.getElementById('tabDeposits').classList.add('active');
  else document.getElementById('tabWithdrawals').classList.add('active');

  const col = type === 'deposits' ? 'depositRequests' : 'withdrawalRequests';
  const q = query(collection(db, col), where("status", "==", "pending"));

  try {
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      list.innerHTML = '<p class="muted text-center mt-16">No pending requests.</p>';
      return;
    }
    list.innerHTML = '';
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg-card); padding:16px; border-radius:12px; border:1px solid var(--border);';
      
      let detailsHTML = '';
      if (type === 'deposits') {
        detailsHTML = `
          <p class="small muted">Phone: ${data.phoneNumber}</p>
          <p class="small muted">Deposit Code: <strong>${data.transactionCode || 'N/A'}</strong></p>
        `;
      } else {
        detailsHTML = `
          <p class="small muted">Payout Phone: ${data.phoneNumber}</p>
          <p class="small muted">Fee Code (32 KES): <strong style="color:var(--gold);">${data.feeCode || 'N/A'}</strong></p>
        `;
      }

      card.innerHTML = `
        <h4 style="margin-bottom: 8px; color: ${type === 'deposits' ? 'var(--gold)' : 'var(--green)'};">${type === 'deposits' ? 'Deposit' : 'Withdraw'}: $${data.amount}</h4>
        ${detailsHTML}
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button class="btn-small" style="flex:1; background:var(--green); color:black;" onclick="approveReq('${col}', '${docSnap.id}', '${data.userId}', ${data.amount})">Approve</button>
          <button class="btn-small" style="flex:1; background:var(--danger); color:white;" onclick="rejectReq('${col}', '${docSnap.id}')">Reject</button>
        </div>
      `;
      list.appendChild(card);
    });
  } catch (error) { 
    list.innerHTML = '<p class="muted text-center" style="color:var(--danger);">Error loading data. Check rules.</p>'; 
  }
};

window.approveReq = async function(col, id, userId, amount) {
  if (!confirm("Are you sure you want to approve this?")) return;
  showLoading(true);
  try {
    await updateDoc(doc(db, col, id), { status: "approved" });
    
    const wRef = doc(db, "wallets", userId);
    const wSnap = await getDoc(wRef);
    
    if (wSnap.exists()) {
      let currentBal = wSnap.data().balance || 0;
      
      if (col === 'depositRequests') {
        const newBal = currentBal + amount;
        await updateDoc(wRef, { balance: newBal });
        if (currentUser && currentUser.uid === userId) currentBalance = newBal;
      } else if (col === 'withdrawalRequests') {
        const newBal = currentBal - amount;
        await updateDoc(wRef, { balance: newBal });
        if (currentUser && currentUser.uid === userId) currentBalance = newBal;
      }
      
      if (currentUser && currentUser.uid === userId) {
        const fmt = `$${currentBalance.toFixed(2)}`;
        document.getElementById('headerBalance').textContent = fmt;
        document.getElementById('accBalance').textContent = fmt;
        document.getElementById('withdrawBal').textContent = fmt;
      }
    }
    
    showToast("Approved successfully!", "success");
    loadAdminData(col === 'depositRequests' ? 'deposits' : 'withdrawals');
  } catch (error) { 
    console.error(error);
    showToast("Error approving request", "error"); 
  } 
  finally { showLoading(false); }
};

window.rejectReq = async function(col, id) {
  showLoading(true);
  try {
    await updateDoc(doc(db, col, id), { status: "rejected" });
    showToast("Rejected", "success");
    loadAdminData(col === 'depositRequests' ? 'deposits' : 'withdrawals');
  } catch (error) { showToast("Error", "error"); } 
  finally { showLoading(false); }
};
// ==========================================
// EMPIRE BET - SPORTS & CASINO LOGIC (PART 2)
// ==========================================

// --- 100 SPORTS MATCHES ---
const teams = ["Arsenal", "Man City", "Chelsea", "Liverpool", "Real Madrid", "Barcelona", "Bayern", "PSG", "Juventus", "AC Milan", "Inter", "Man United", "Spurs", "Dortmund", "Ajax", "Porto", "Benfica", "Celtic", "Rangers", "Napoli"];
const matchList = document.getElementById('homeMatchList');

function generateSports() {
  if (!matchList) return;
  matchList.innerHTML = '';
  for (let i = 1; i <= 100; i++) {
    const t1 = teams[Math.floor(Math.random() * teams.length)];
    let t2 = teams[Math.floor(Math.random() * teams.length)];
    while (t1 === t2) t2 = teams[Math.floor(Math.random() * teams.length)];

    const card = document.createElement('div');
    card.className = 'match-card';
    card.innerHTML = `
      <div class="match-meta"><span>League</span> <span>Match #${i}</span></div>
      <div class="match-teams"><div class="team">${t1}</div><div class="team">${t2}</div></div>
      <div class="odds-row">
        <button class="odd-btn" onclick="placeBet()">1 <span>2.10</span></button>
        <button class="odd-btn" onclick="placeBet()">X <span>3.40</span></button>
        <button class="odd-btn" onclick="placeBet()">2 <span>2.80</span></button>
      </div>
    `;
    matchList.appendChild(card);
  }
}
generateSports();

window.placeBet = function() {
  if (currentBalance < 10) {
    showToast("Minimum balance to place bets is $10. Please deposit.", "error");
    return;
  }
  showToast('Added to Bet Slip', 'success');
};

// --- CASINO LOGOS & GENERATION ---
const casinoGrid = document.getElementById('casinoGrid');
const homeCarousel = document.getElementById('homeCasinoCarousel');

const topGames = [
  { name: "Aviator", color: "#dc2626", icon: "✈️" }, 
  { name: "JetX", color: "#1e3a8a", icon: "🚀" }, 
  { name: "Bazooka", color: "#eab308", icon: "💥" }, 
  { name: "Sweet Bonanza", color: "#db2777", icon: "🍬" },
  { name: "Mines", color: "#059669", icon: "💣" },
  { name: "Coin Flip", color: "#d97706", icon: "🪙" },
  { name: "Dice", color: "#4f46e5", icon: "🎲" }
];

const gamesList = ["Aviator", "JetX", "Mines", "Coin Flip", "Dice"];
for (let i = 6; i <= 200; i++) gamesList.push(`Slot #${i}`);
const colors = ['bg-purple', 'bg-red', 'bg-blue', 'bg-green', 'bg-gold', 'bg-dark'];

function renderCasino() {
  if (!casinoGrid) return;
  casinoGrid.innerHTML = '';
  
  gamesList.forEach((game, i) => {
    const card = document.createElement('div');
    card.className = `casino-card ${colors[i % colors.length]}`;
    card.innerHTML = `
      <div class="casino-overlay" style="align-items:center; justify-content:center; text-align:center; height:100%; display:flex; flex-direction: column;">
        <span style="font-size:1.5rem; margin-bottom:4px;">🎰</span>
        <span style="font-size:0.9rem; text-transform:uppercase; letter-spacing:1px; font-style: italic; font-weight: 800; text-shadow: 0 2px 4px #000;">${game}</span>
      </div>
    `;
    card.addEventListener('click', () => launchGame(game));
    casinoGrid.appendChild(card);
  });

  if (homeCarousel) {
    homeCarousel.innerHTML = '';
    topGames.forEach(game => {
      const box = document.createElement('div');
      box.style.cssText = `
        min-width: 110px; height: 110px; border-radius: 20px;
        background: linear-gradient(135deg, ${game.color}, #000);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        box-shadow: 0 8px 16px rgba(0,0,0,0.4);
        border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer;
      `;
      box.innerHTML = `
        <span style="font-size: 2rem; margin-bottom: 8px;">${game.icon}</span>
        <span style="font-weight: 800; font-size: 0.85rem; font-style: italic; text-transform: uppercase; text-shadow: 0 2px 4px #000; text-align: center; padding: 0 10px; line-height: 1.1;">${game.name}</span>
      `;
      
      box.addEventListener('click', () => {
        if (currentBalance < 10) {
          showToast("Minimum balance to play Casino is $10.", "error");
          return;
        }
        launchGame(game.name);
      });
      homeCarousel.appendChild(box);
    });
  }
}
renderCasino();

window.launchGame = function(gameName) {
  if (currentBalance < 10) {
    showToast("Minimum balance to play Casino is $10. Please deposit.", "error");
    return; 
  }

  const modal = document.getElementById('gameModal');
  const title = document.getElementById('gameTitle');
  const area = document.getElementById('gameArea');
  
  modal.classList.remove('hidden');
  title.textContent = gameName;
  area.innerHTML = '';

  if (gameName === "Aviator") renderAviator(area, "Aviator");
  else if (gameName === "JetX") renderAviator(area, "JetX");
  else if (gameName === "Mines") renderMines(area);
  else if (gameName === "Coin Flip") renderCoinFlip(area);
  else if (gameName === "Dice") renderDice(area);
  else {
    area.innerHTML = `
      <div style="width: 100%; height: 300px; background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); border-radius: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid var(--border);">
        <div style="font-size: 4rem; margin-bottom: 20px; animation: spin 2s linear infinite;">⚙️</div>
        <h2 style="color: var(--gold); font-size: 1.5rem; margin-bottom: 10px;">${gameName}</h2>
        <p class="muted" style="margin-bottom: 20px;">Connecting to provider...</p>
        <div style="width: 80%; height: 6px; background: var(--bg-card); border-radius: 10px; overflow: hidden;">
          <div style="width: 50%; height: 100%; background: var(--green); border-radius: 10px; animation: load 2s infinite;"></div>
        </div>
      </div>
    `;
  }
};

window.closeGame = function() {
  document.getElementById('gameModal').classList.add('hidden');
  if (window.gameInterval) clearInterval(window.gameInterval);
};

async function gameUpdateBalance(amount) {
  if (!currentUser) return;
  currentBalance += amount;
  await updateDoc(doc(db, "wallets", currentUser.uid), { balance: currentBalance });
  document.getElementById('headerBalance').textContent = `$${currentBalance.toFixed(2)}`;
  document.getElementById('accBalance').textContent = `$${currentBalance.toFixed(2)}`;
  document.getElementById('withdrawBal').textContent = `$${currentBalance.toFixed(2)}`;
}

// --- 1. AVIATOR & JETX ---
function renderAviator(area, gameName) {
  const isAviator = gameName === "Aviator";
  const planeEmoji = isAviator ? "✈️" : "🚀";
  const bgGradient = isAviator ? "radial-gradient(circle, #450a0a 0%, #0b1120 100%)" : "radial-gradient(circle, #1e3a8a 0%, #0b1120 100%)";

  area.innerHTML = `
    <div style="width: 100%; height: 250px; background: ${bgGradient}; border-radius: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; overflow: hidden; border: 1px solid var(--border); margin-bottom: 20px;">
      <div id="planeAnim" style="font-size: 4rem; position: absolute; transition: 0.2s; transform: translate(-50%, -50%); bottom: 20px; left: 20px;">${planeEmoji}</div>
      <h4 style="color: #94a3b8; font-size: 1rem; margin-bottom: 10px; z-index: 2; text-transform: uppercase;">Round Result</h4>
      <div id="avMulti" style="font-size: 5rem; font-weight: 900; color: var(--green); z-index: 2; letter-spacing: -2px;">1.00x</div>
    </div>
    <div style="display: flex; gap: 10px; width: 100%;">
      <div style="flex: 1; background: var(--bg-card); border-radius: 12px; padding: 15px; display: flex; align-items: center; justify-content: space-between;">
        <button style="background:transparent; border:none; color:white; font-size:1.5rem;" onclick="document.getElementById('avBet').value = Math.max(1, parseInt(document.getElementById('avBet').value) - 1)">-</button>
        <input type="number" id="avBet" value="1" min="1" style="width: 50px; text-align: center; background: transparent; border: none; color: white; font-size: 1.2rem; font-weight: bold;" />
        <button style="background:transparent; border:none; color:white; font-size:1.5rem;" onclick="document.getElementById('avBet').value = parseInt(document.getElementById('avBet').value) + 1">+</button>
      </div>
      <button class="btn-primary" id="avBtn" style="flex: 1; border-radius: 12px; padding: 0; font-size: 1.2rem;">BET $1.00</button>
    </div>
  `;

  let multi = 1.00, playing = false;
  const btn = document.getElementById('avBtn');
  const display = document.getElementById('avMulti');
  const plane = document.getElementById('planeAnim');
  const betInput = document.getElementById('avBet');

  btn.onclick = async () => {
    if (!playing) {
      const betAmt = Number(betInput.value);
      if (betAmt < 1 || betAmt > currentBalance) return showToast("Invalid bet amount", "error");
      
      await gameUpdateBalance(-betAmt);
      playing = true; multi = 1.00; 
      btn.textContent = "CASH OUT"; 
      btn.style.background = "var(--gold)";
      btn.style.color = "#000";
      display.textContent = "1.00x";
      display.style.color = "var(--green)";
      plane.style.transform = "translate(0, 0)";
      
      let progress = 0;
      window.gameInterval = setInterval(() => {
        if (Math.random() < 0.06 + (multi * 0.01)) {
          clearInterval(window.gameInterval); 
          display.textContent = "FLEW AWAY!"; 
          display.style.color = "var(--danger)";
          display.style.fontSize = "3rem";
          btn.textContent = "BET AGAIN"; 
          btn.style.background = "var(--green)";
          btn.style.color = "#000";
          playing = false;
          showToast(`Flew away at ${multi.toFixed(2)}x!`, "error");
        } else {
          multi += 0.05;
          progress += 1;
          display.textContent = multi.toFixed(2) + "x";
          plane.style.bottom = `${Math.min(progress * 2, 80)}%`;
          plane.style.left = `${Math.min(progress * 2, 80)}%`;
        }
      }, 200);
    } else {
      clearInterval(window.gameInterval); 
      playing = false;
      const betAmt = Number(betInput.value);
      const payout = multi * betAmt;
      
      await gameUpdateBalance(payout); 
      showToast(`Cashed out $${payout.toFixed(2)}!`, "success");
      
      display.textContent = `Won ${multi.toFixed(2)}x!`; 
      display.style.fontSize = "3rem";
      btn.textContent = "START FLIGHT"; 
      btn.style.background = "var(--green)";
      btn.style.color = "#000";
      plane.style.bottom = "20px";
      plane.style.left = "20px";
    }
  };
}

// --- 2. MINES ---
function renderMines(area) {
  let multi = 1.0, step = 0, active = false, mines = [];
  area.innerHTML = `
    <p class="muted mb-16">Find the gems. Avoid the 3 mines!</p>
    <div style="background: var(--bg-card); padding: 16px; border-radius: 12px; width: 100%; margin-bottom: 20px;">
      <h4 style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 8px;">Current Multiplier</h4>
      <div id="minesMulti" style="font-size: 2.5rem; font-weight: 800; color: var(--green);">1.00x</div>
    </div>
    <div id="minesGrid" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; width:100%; max-width:300px; margin-bottom:20px;"></div>
    <button class="btn-primary" id="minesBtn" onclick="startMines()" style="width: 100%; max-width: 300px;">Start Game ($1)</button>
  `;
  const grid = document.getElementById('minesGrid');
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.style.cssText = "background:var(--bg-card); height:80px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:2rem; cursor:pointer; border:1px solid var(--border); transition: 0.2s;";
    cell.onclick = () => clickMine(i, cell);
    grid.appendChild(cell);
  }
  
  window.startMines = async () => {
    if (active || currentBalance < 1) return showToast("Cannot start", "error");
    await gameUpdateBalance(-1);
    active = true; step = 0; multi = 1.0;
    document.getElementById('minesMulti').textContent = "1.00x";
    document.getElementById('minesBtn').textContent = "Cashout $0.00";
    document.getElementById('minesBtn').disabled = true;
    document.getElementById('minesBtn').style.opacity = "0.5";
    mines = [];
    while (mines.length < 3) {
      const r = Math.floor(Math.random() * 9);
      if (!mines.includes(r)) mines.push(r);
    }
    Array.from(grid.children).forEach(c => { c.textContent = ""; c.style.background = "var(--bg-card)"; c.style.cursor = "pointer"; });
  };
  
  window.clickMine = async (idx, cell) => {
    if (!active || cell.textContent !== "") return;
    if (mines.includes(idx)) {
      active = false; cell.textContent = "💣"; cell.style.background = "rgba(239, 68, 68, 0.2)"; cell.style.borderColor = "var(--danger)";
      showToast("Boom! You hit a mine.", "error");
      document.getElementById('minesBtn').textContent = "Play Again";
      document.getElementById('minesBtn').disabled = false;
      document.getElementById('minesBtn').style.opacity = "1";
      mines.forEach(p => { grid.children[p].textContent = "💣"; grid.children[p].style.background = "rgba(239, 68, 68, 0.2)"; });
    } else {
      cell.textContent = "💎"; cell.style.background = "rgba(0, 230, 118, 0.1)"; cell.style.borderColor = "var(--green)";
      step++; multi = 1.0 + (step * 0.5);
      document.getElementById('minesMulti').textContent = `${multi.toFixed(2)}x`;
      document.getElementById('minesBtn').textContent = `Cashout $${multi.toFixed(2)}`;
      document.getElementById('minesBtn').disabled = false;
      document.getElementById('minesBtn').style.opacity = "1";
      if (step === 6) cashoutMines();
    }
  };
  
  const cashoutMines = async () => {
    if (!active || step === 0) return;
    active = false;
    await gameUpdateBalance(multi);
    showToast(`Cashed out $${multi.toFixed(2)}!`, "success");
    document.getElementById('minesBtn').textContent = "Play Again";
    document.getElementById('minesBtn').disabled = false;
    document.getElementById('minesBtn').style.opacity = "1";
  };
  document.getElementById('minesBtn').onclick = cashoutMines;
}

// --- 3. COIN FLIP ---
function renderCoinFlip(area) {
  area.innerHTML = `
    <div style="background: var(--bg-card); padding: 30px; border-radius: 20px; border: 1px solid var(--border); width: 100%; max-width: 300px;">
      <div id="coinAnim" style="font-size:6rem; margin-bottom:30px; transition: transform 0.6s ease-out;">🪙</div>
      <p class="muted mb-16">Choose Heads or Tails to win $1.95</p>
      <div style="display:flex; gap:15px; width:100%;">
        <button class="btn-small btn-outline" style="flex:1; padding:15px; font-size:1.1rem;" onclick="playCoin('Heads')">Heads</button>
        <button class="btn-small btn-outline" style="flex:1; padding:15px; font-size:1.1rem;" onclick="playCoin('Tails')">Tails</button>
      </div>
    </div>
  `;
  window.playCoin = async (choice) => {
    if (currentBalance < 1) return showToast("No funds", "error");
    const anim = document.getElementById('coinAnim');
    anim.style.transform = "rotateY(1800deg)";
    await gameUpdateBalance(-1);
    
    setTimeout(async () => {
      const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
      anim.textContent = result === 'Heads' ? '👑' : '🦅';
      anim.style.transform = "rotateY(0deg)";
      
      if (choice === result) {
        await gameUpdateBalance(1.95); showToast(`Won! It was ${result}`, "success");
      } else {
        showToast(`Lost! It was ${result}`, "error");
      }
    }, 600);
  };
}

// --- 4. DICE ---
function renderDice(area) {
  area.innerHTML = `
    <div style="background: var(--bg-card); padding: 30px; border-radius: 20px; border: 1px solid var(--border); width: 100%; max-width: 300px;">
      <div id="diceAnim" style="font-size:6rem; margin-bottom:20px;">🎲</div>
      <div id="diceResult" style="font-size:2rem; font-weight:800; color:var(--gold); margin-bottom:20px;">Roll to win</div>
      <p class="muted mb-16">Guess if the roll is Over or Under 50.</p>
      <div style="display:flex; gap:10px; width:100%;">
        <button class="btn-small btn-outline" style="flex:1; padding:15px;" onclick="rollDice('over')">Over 50</button>
        <button class="btn-small btn-outline" style="flex:1; padding:15px;" onclick="rollDice('under')">Under 50</button>
      </div>
    </div>
  `;
  
  window.rollDice = async (choice) => {
    if (currentBalance < 1) return showToast("No funds", "error");
    await gameUpdateBalance(-1);
    
    const anim = document.getElementById('diceAnim');
    anim.style.transform = "rotate(720deg)";
    
    setTimeout(async () => {
      const res = Math.floor(Math.random() * 100) + 1;
      document.getElementById('diceResult').textContent = res;
      document.getElementById('diceResult').style.color = "var(--green)";
      anim.style.transform = "rotate(0deg)";
      
      const win = (choice === 'over' && res > 50) || (choice === 'under' && res < 50);
      if (win) { 
        await gameUpdateBalance(1.95); 
        showToast(`Won! Rolled ${res}`, "success"); 
      }
      else { 
        document.getElementById('diceResult').style.color = "var(--danger)";
        showToast(`Lost! Rolled ${res}`, "error"); 
      }
    }, 600);
  };
}
