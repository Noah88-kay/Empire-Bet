// ==========================================
// EMPIRE BET - MAIN APPLICATION LOGIC
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
let tasksCompleted = { 1: false, 2: false, 3: false, 4: false };

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

// --- AUTH ---
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
    
    await setDoc(doc(db, "users", cred.user.uid), {
      name: document.getElementById('regName').value,
      email: document.getElementById('regEmail').value,
      phone: document.getElementById('regPhone').value,
      status: "active",
      createdAt: serverTimestamp()
    });
    
    await setDoc(doc(db, "wallets", cred.user.uid), {
      balance: 0.00, bonus: 0.00, currency: "USD", lastUpdated: serverTimestamp()
    });
    showToast("Account created successfully!");
  } catch (err) { authError.textContent = err.message; } 
  finally { showLoading(false); }
});

document.getElementById('logoutBtn')?.addEventListener('click', () => signOut(auth));

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
  
  if (isNaN(amt) || amt < 10) return showToast("Minimum withdrawal is $10", "error");
  if (amt > currentBalance) return showToast("Insufficient balance", "error");
  if (phone.length < 9) return showToast("Invalid phone number", "error");
  
  try {
    showLoading(true);
    await addDoc(collection(db, "withdrawalRequests"), {
      userId: currentUser.uid, 
      phoneNumber: String(phone), 
      amount: amt, 
      status: "pending", 
      createdAt: serverTimestamp()
    });
    showToast("Withdrawal request submitted.", "success");
    document.getElementById('withAmount').value = "";
    document.getElementById('withPhone').value = "";
  } catch (err) { showToast(err.message, "error"); } 
  finally { showLoading(false); }
});

// --- PROMOTIONS ---
window.completeTask = function(taskNumber) {
  const taskElement = document.getElementById(`task${taskNumber}`);
  const claimBtn = document.getElementById('claimBonusBtn');

  if (taskNumber === 1) {
    document.getElementById('btnTask1').textContent = "Done";
    tasksCompleted[1] = true;
  } 
  else if (taskNumber === 2) {
    if (document.getElementById('task2Select').value !== "") tasksCompleted[2] = true;
  } 
  else if (taskNumber === 3) tasksCompleted[3] = true;
  else if (taskNumber === 4) {
    if (document.getElementById('task4Input').value === "4829") tasksCompleted[4] = true;
    else tasksCompleted[4] = false;
  }

  if (tasksCompleted[1] && tasksCompleted[2] && tasksCompleted[3] && tasksCompleted[4]) {
    taskElement.classList.add('completed');
    claimBtn.disabled = false;
    claimBtn.textContent = "Claim $9.00 Now";
    claimBtn.style.opacity = "1";
    showToast("All tasks verified!", "success");
  }
};

document.getElementById('claimBonusBtn')?.addEventListener('click', async () => {
  if (!currentUser) return;
  try {
    showLoading(true);
    currentBonus += 9.00;
    await updateDoc(doc(db, "wallets", currentUser.uid), { bonus: currentBonus, lastUpdated: serverTimestamp() });
    document.getElementById('accBonus').textContent = `$${currentBonus.toFixed(2)}`;
    document.getElementById('claimBonusBtn').textContent = "Claimed!";
    document.getElementById('claimBonusBtn').disabled = true;
    showToast("$9.00 Claimed!", "success");
  } catch (err) { showToast("Failed", "error"); } 
  finally { showLoading(false); }
});

// --- ADMIN PANEL LOGIC ---
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
      card.innerHTML = `
        <h4 style="margin-bottom: 8px; color: ${type === 'deposits' ? 'var(--gold)' : 'var(--green)'};">${type === 'deposits' ? 'Deposit' : 'Withdraw'}: $${data.amount}</h4>
        <p class="small muted">Phone: ${data.phoneNumber}</p>
        <p class="small muted">Code: ${data.transactionCode || 'N/A'}</p>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button class="btn-small" style="flex:1; background:var(--green); color:black;" onclick="approveReq('${col}', '${docSnap.id}', '${data.userId}', ${data.amount})">Approve</button>
          <button class="btn-small" style="flex:1; background:var(--danger); color:white;" onclick="rejectReq('${col}', '${docSnap.id}')">Reject</button>
        </div>
      `;
      list.appendChild(card);
    });
  } catch (error) { list.innerHTML = '<p class="muted text-center" style="color:var(--danger);">Error.</p>'; }
};

window.approveReq = async function(col, id, userId, amount) {
  if (!confirm("Approve?")) return;
  showLoading(true);
  try {
    await updateDoc(doc(db, col, id), { status: "approved" });
    if (col === 'depositRequests') {
      const wRef = doc(db, "wallets", userId);
      const wSnap = await getDoc(wRef);
      if (wSnap.exists()) await updateDoc(wRef, { balance: (wSnap.data().balance || 0) + amount });
    }
    showToast("Approved!", "success");
    loadAdminData(col === 'depositRequests' ? 'deposits' : 'withdrawals');
  } catch (error) { showToast("Error", "error"); } 
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
        <button class="odd-btn" onclick="showToast('Added to Bet Slip', 'success')">1 <span>2.10</span></button>
        <button class="odd-btn" onclick="showToast('Added to Bet Slip', 'success')">X <span>3.40</span></button>
        <button class="odd-btn" onclick="showToast('Added to Bet Slip', 'success')">2 <span>2.80</span></button>
      </div>
    `;
    matchList.appendChild(card);
  }
}
generateSports();

// --- 200 CASINO GAMES ---
const casinoGrid = document.getElementById('casinoGrid');
const gamesList = ["Aviator", "Coin Flip", "Dice", "Mines", "Plinko"];
for (let i = 6; i <= 200; i++) gamesList.push(`Slot #${i}`);
const colors = ['bg-purple', 'bg-red', 'bg-blue', 'bg-green', 'bg-gold', 'bg-dark'];

function renderCasino() {
  if (!casinoGrid) return;
  casinoGrid.innerHTML = '';
  gamesList.forEach((game, i) => {
    const card = document.createElement('div');
    card.className = `casino-card ${colors[i % colors.length]}`;
    card.innerHTML = `<div class="casino-overlay"><span>${game}</span></div>`;
    card.addEventListener('click', () => launchGame(game));
    casinoGrid.appendChild(card);
  });
}
renderCasino();

// --- CASINO GAME LOGIC ---
window.launchGame = function(gameName) {
  const modal = document.getElementById('gameModal');
  const title = document.getElementById('gameTitle');
  const area = document.getElementById('gameArea');
  
  modal.classList.remove('hidden');
  title.textContent = gameName;
  area.innerHTML = '';

  if (gameName === "Aviator") renderAviator(area);
  else if (gameName === "Coin Flip") renderCoinFlip(area);
  else if (gameName === "Dice") renderDice(area);
  else if (gameName === "Mines") renderMines(area);
  else if (gameName === "Plinko") renderPlinko(area);
  else area.innerHTML = `<p class="muted">This game (${gameName}) is coming soon!</p>`;
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

// 1. Aviator
function renderAviator(area) {
  area.innerHTML = `
    <p class="muted mb-16">Bet $1. Cash out before crash!</p>
    <div id="avMulti" style="font-size:4rem; font-weight:800; color:var(--green); margin-bottom:20px;">1.00x</div>
    <button class="btn-primary" id="avBtn">Start Flight</button>
  `;
  let multi = 1.00, playing = false;
  document.getElementById('avBtn').onclick = async () => {
    const btn = document.getElementById('avBtn'), display = document.getElementById('avMulti');
    if (!playing) {
      if (currentBalance < 1) return showToast("No funds", "error");
      await gameUpdateBalance(-1);
      playing = true; multi = 1.00; btn.textContent = "CASH OUT"; display.textContent = "1.00x";
      display.style.color = "var(--green)";
      window.gameInterval = setInterval(() => {
        if (Math.random() < 0.06) {
          clearInterval(window.gameInterval); display.textContent = "CRASHED!"; display.style.color = "var(--danger)";
          btn.textContent = "Start Flight"; playing = false;
          showToast("Crashed! Lost $1.", "error");
        } else {
          multi += 0.05; display.textContent = multi.toFixed(2) + "x";
        }
      }, 200);
    } else {
      clearInterval(window.gameInterval); playing = false;
      await gameUpdateBalance(multi); showToast(`Won $${multi.toFixed(2)}!`, "success");
      display.textContent = `Won ${multi.toFixed(2)}x!`; btn.textContent = "Start Flight";
    }
  };
}

// 2. Coin Flip
function renderCoinFlip(area) {
  area.innerHTML = `
    <div id="coinAnim" style="font-size:5rem; margin-bottom:20px; transition:0.5s;">🪙</div>
    <div style="display:flex; gap:10px; width:100%;">
      <button class="btn-small btn-outline" style="flex:1; padding:15px;" onclick="playCoin('Heads')">Heads</button>
      <button class="btn-small btn-outline" style="flex:1; padding:15px;" onclick="playCoin('Tails')">Tails</button>
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
      if (choice === result) {
        await gameUpdateBalance(1.95); showToast(`Won! ${result}`, "success");
      } else {
        showToast(`Lost! It was ${result}`, "error");
      }
      anim.style.transform = "rotateY(0deg)";
    }, 1000);
  };
}

// 3. Dice
function renderDice(area) {
  area.innerHTML = `
    <div id="diceRes" style="font-size:5rem; margin-bottom:20px;">🎲</div>
    <p class="muted mb-16">Over or under 50?</p>
    <div style="display:flex; gap:10px; width:100%;">
      <button class="btn-small btn-outline" style="flex:1; padding:15px;" onclick="rollDice('over')">Over 50</button>
      <button class="btn-small btn-outline" style="flex:1; padding:15px;" onclick="rollDice('under')">Under 50</button>
    </div>
  `;
  window.rollDice = async (choice) => {
    if (currentBalance < 1) return showToast("No funds", "error");
    await gameUpdateBalance(-1);
    const res = Math.floor(Math.random() * 100) + 1;
    document.getElementById('diceRes').textContent = res;
    const win = (choice === 'over' && res > 50) || (choice === 'under' && res < 50);
    if (win) { await gameUpdateBalance(1.95); showToast(`Won! Rolled ${res}`, "success"); }
    else { showToast(`Lost! Rolled ${res}`, "error"); }
  };
}

// 4. Mines
function renderMines(area) {
  let multi = 1.0, step = 0, active = false, mines = [];
  area.innerHTML = `
    <p class="muted mb-16">Find gems. Avoid mines!</p>
    <div id="minesMulti" style="font-size:2rem; font-weight:800; color:var(--green); margin-bottom:20px;">1.00x</div>
    <div id="minesGrid" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; width:100%; max-width:250px; margin-bottom:20px;"></div>
    <button class="btn-primary" id="minesBtn" onclick="startMines()">Start Game ($1)</button>
  `;
  const grid = document.getElementById('minesGrid');
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.style.cssText = "background:var(--bg-card); height:70px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.5rem; cursor:pointer; border:1px solid var(--border);";
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
      active = false; cell.textContent = "💣"; cell.style.background = "var(--danger)";
      showToast("Boom! Lost.", "error");
      document.getElementById('minesBtn').textContent = "Start Game ($1)";
      document.getElementById('minesBtn').disabled = false;
      document.getElementById('minesBtn').style.opacity = "1";
      mines.forEach(p => { grid.children[p].textContent = "💣"; grid.children[p].style.background = "rgba(239, 68, 68, 0.2)"; });
    } else {
      cell.textContent = "💎"; cell.style.background = "rgba(0, 230, 118, 0.2)";
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
    document.getElementById('minesBtn').textContent = "Start Game ($1)";
    document.getElementById('minesBtn').disabled = false;
    document.getElementById('minesBtn').style.opacity = "1";
  };
  document.getElementById('minesBtn').onclick = cashoutMines;
}

// 5. Plinko
function renderPlinko(area) {
  area.innerHTML = `
    <div id="plinkoRes" style="font-size:5rem; margin-bottom:20px;">🔴</div>
    <p class="muted mb-16">Drop the ball!</p>
    <button class="btn-primary" onclick="dropPlinko()" style="width:100%;">Drop Ball ($1)</button>
  `;
  window.dropPlinko = async () => {
    if (currentBalance < 1) return showToast("No funds", "error");
    await gameUpdateBalance(-1);
    const display = document.getElementById('plinkoRes');
    display.textContent = "⬇️";
    setTimeout(async () => {
      const mults = [0, 0.5, 1.5, 3.0, 1.5, 0.5, 0];
      const res = mults[Math.floor(Math.random() * mults.length)];
      display.textContent = `${res}x`;
      display.style.color = res > 1 ? "var(--green)" : "var(--danger)";
      if (res > 0) { await gameUpdateBalance(res); showToast(`Won $${res.toFixed(2)}!`, "success"); }
      else showToast("Lost", "error");
    }, 1000);
  };
               }
