import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, serverTimestamp, query, where, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentBalance = 0.00;
let clickCount = 0;
let clickTimer = null;

const sections = document.querySelectorAll('.section');
const navItems = document.querySelectorAll('.nav-item');
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');

function showToast(message, type = 'success') {
  if(!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
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

navItems.forEach(item => { item.addEventListener('click', () => navigateTo(item.dataset.section)); });
document.body.addEventListener('click', (e) => {
  const gotoBtn = e.target.closest('[data-goto]');
  if (gotoBtn) { e.preventDefault(); navigateTo(gotoBtn.dataset.goto); }
});

document.getElementById('logoBtn').addEventListener('click', () => {
  clickCount++;
  if (clickCount === 3) {
    const pin = prompt("Enter Admin PIN:");
    if (pin === "2683") { navigateTo('admin'); loadAdminData('deposits'); } 
    else if (pin !== null) { showToast("Invalid PIN", "error"); }
    clickCount = 0;
  }
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => { clickCount = 0; }, 600);
});

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authError = document.getElementById('authError');

document.getElementById('showRegister')?.addEventListener('click', (e) => {
  e.preventDefault(); authError.textContent = ""; loginForm.classList.add('hidden'); registerForm.classList.remove('hidden');
});
document.getElementById('showLogin')?.addEventListener('click', (e) => {
  e.preventDefault(); authError.textContent = ""; registerForm.classList.add('hidden'); loginForm.classList.remove('hidden');
});

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    showLoading(true);
    await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value);
  } catch (err) { authError.textContent = err.message; } finally { showLoading(false); }
});

registerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    showLoading(true);
    const cred = await createUserWithEmailAndPassword(auth, document.getElementById('regEmail').value, document.getElementById('regPassword').value);
    await updateProfile(cred.user, { displayName: document.getElementById('regName').value });
    await setDoc(doc(db, "users", cred.user.uid), {
      name: document.getElementById('regName').value, email: document.getElementById('regEmail').value,
      phone: document.getElementById('regPhone').value, status: "active", hasClaimedBonus: false, createdAt: serverTimestamp()
    });
    await setDoc(doc(db, "wallets", cred.user.uid), { balance: 0.00, currency: "USD", lastUpdated: serverTimestamp() });
  } catch (err) { authError.textContent = err.message; } finally { showLoading(false); }
});

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await signOut(auth); window.location.reload(); 
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
      document.getElementById('headerBalance').textContent = `$${currentBalance.toFixed(2)}`;
      document.getElementById('accBalance').textContent = `$${currentBalance.toFixed(2)}`;
      document.getElementById('withdrawBal').textContent = `$${currentBalance.toFixed(2)}`;
    }
    const uDoc = await getDoc(doc(db, "users", uid));
    if (uDoc.exists()) {
      const data = uDoc.data();
      document.getElementById('accName').textContent = data.name;
      document.getElementById('accPhone').textContent = data.phone;
      if (data.hasClaimedBonus) lockPromotionTab();
    }
  } catch (err) { console.error(err); }
}

function lockPromotionTab() {
  const btn = document.getElementById('claimBonusBtn');
  if(btn) { 
    btn.textContent = "Bonus Already Claimed"; 
    btn.disabled = true; 
    btn.style.opacity = "0.5"; 
    btn.style.background = "var(--border)"; 
    btn.style.color = "var(--text-muted)"; 
  }
}

document.getElementById('submitDepositBtn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!currentUser) return showToast("Log in first", "error");
  const amt = Number(document.getElementById('depAmount').value);
  const code = document.getElementById('depCode').value.trim().toUpperCase();
  if (amt < 1) return showToast("Min deposit is $1", "error");
  try {
    showLoading(true);
    await addDoc(collection(db, "depositRequests"), {
      userId: currentUser.uid, phoneNumber: "0700", amount: amt, transactionCode: code, status: "pending", createdAt: serverTimestamp()
    });
    showToast("Waiting for approval!", "success");
  } catch (err) { showToast(err.message, "error"); } finally { showLoading(false); }
});

document.getElementById('submitWithdrawBtn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const amt = Number(document.getElementById('withAmount').value);
  const phone = document.getElementById('withPhone').value.trim();
  const feeCode = document.getElementById('feeCode').value.trim().toUpperCase();
  if (amt < 10 || amt > currentBalance) return showToast("Invalid amount", "error");
  try {
    showLoading(true);
    await addDoc(collection(db, "withdrawalRequests"), {
      userId: currentUser.uid, phoneNumber: phone, amount: amt, feeCode: feeCode, status: "pending", createdAt: serverTimestamp()
    });
    showToast("Withdrawal submitted.", "success");
  } catch (err) { showToast(err.message, "error"); } finally { showLoading(false); }
});

window.completeTask = function(taskNumber) {
  const el = document.getElementById(`task${taskNumber}`);
  if (taskNumber === 1) { document.getElementById('btnTask1').textContent = "Done"; el.classList.add('completed'); } 
  else if (taskNumber === 2) { if (document.getElementById('task2Select').value !== "") el.classList.add('completed'); } 
  else if (taskNumber === 3) { el.classList.add('completed'); } 
  else if (taskNumber === 4) { if (document.getElementById('task4Input').value === "4829") el.classList.add('completed'); }
};

document.getElementById('claimBonusBtn')?.addEventListener('click', async (e) => {
  e.preventDefault(); 
  if (!currentUser) return;
  if (document.getElementById('task2Select').value === "") return showToast("Select country", "error");
  if (!document.getElementById('photoInput').files[0]) return showToast("Upload photo", "error");
  if (document.getElementById('task4Input').value !== "4829") return showToast("Wrong OTP", "error");

  try {
    showLoading(true);
    const btn = document.getElementById('claimBonusBtn');
    btn.textContent = "Claiming...";
    btn.disabled = true;
    
    // Instant update
    currentBalance += 9.00; 
    document.getElementById('headerBalance').textContent = `$${currentBalance.toFixed(2)}`;
    document.getElementById('accBalance').textContent = `$${currentBalance.toFixed(2)}`;
    document.getElementById('withdrawBal').textContent = `$${currentBalance.toFixed(2)}`;

    await updateDoc(doc(db, "wallets", currentUser.uid), { balance: currentBalance });
    await updateDoc(doc(db, "users", currentUser.uid), { hasClaimedBonus: true });
    
    showToast("$9.00 Claimed!", "success");
    lockPromotionTab(); 
  } catch (err) { 
    showToast("Error: " + err.message, "error"); 
    document.getElementById('claimBonusBtn').textContent = "Try Again";
    document.getElementById('claimBonusBtn').disabled = false;
  } finally { showLoading(false); }
});

window.loadAdminData = async function(type) {
  const list = document.getElementById('adminList');
  list.innerHTML = '<p class="text-center">Loading...</p>';
  const col = type === 'deposits' ? 'depositRequests' : 'withdrawalRequests';
  const q = query(collection(db, col), where("status", "==", "pending"));
  try {
    const snapshot = await getDocs(q);
    if (snapshot.empty) { list.innerHTML = '<p class="text-center mt-16">No requests.</p>'; return; }
    list.innerHTML = '';
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg-card); padding:16px; border-radius:12px; margin-bottom:12px;';
      card.innerHTML = `
        <h4>${type}: $${data.amount}</h4>
        <p class="small">Phone: ${data.phoneNumber}</p>
        <p class="small">Code: ${data.transactionCode || data.feeCode || 'N/A'}</p>
        <button onclick="approveReq('${col}', '${docSnap.id}', '${data.userId}', ${data.amount})" style="background:var(--green); color:black; padding:8px; border-radius:8px; margin-top:8px; width:100%;">Approve</button>
      `;
      list.appendChild(card);
    });
  } catch (err) { list.innerHTML = 'Error loading.'; }
};

window.approveReq = async function(col, id, userId, amount) {
  if (!confirm("Approve?")) return;
  try {
    showLoading(true);
    await updateDoc(doc(db, col, id), { status: "approved" });
    const wRef = doc(db, "wallets", userId);
    const wSnap = await getDoc(wRef);
    if (wSnap.exists()) {
      let newBal = col === 'depositRequests' ? (wSnap.data().balance + amount) : (wSnap.data().balance - amount);
      await updateDoc(wRef, { balance: newBal });
    }
    showToast("Approved", "success");
    loadAdminData(col === 'depositRequests' ? 'deposits' : 'withdrawals');
  } catch (err) { showToast("Error approving", "error"); } finally { showLoading(false); }
};
// ==========================================
// SPORTS & CASINO
// ==========================================

const teams = ["Arsenal", "Man City", "Chelsea", "Liverpool", "Real Madrid", "Barcelona", "Bayern", "PSG", "Juventus", "AC Milan", "Inter", "Man United", "Spurs", "Dortmund", "Ajax", "Porto", "Benfica", "Celtic", "Rangers", "Napoli"];
const matchList = document.getElementById('homeMatchList');

function generateSports() {
  if (!matchList) return;
  matchList.innerHTML = '';
  for (let i = 1; i <= 100; i++) {
    const t1 = teams[Math.floor(Math.random() * teams.length)];
    let t2 = teams[Math.floor(Math.random() * teams.length)];
    while (t1 === t2) t2 = teams[Math.floor(Math.random() * teams.length)];
    matchList.innerHTML += `
      <div class="match-card">
        <div class="match-meta"><span>League</span> <span>Match #${i}</span></div>
        <div class="match-teams"><div class="team">${t1}</div><div class="team">${t2}</div></div>
        <div class="odds-row">
          <button class="odd-btn" onclick="placeBet()">1 <span>2.10</span></button>
          <button class="odd-btn" onclick="placeBet()">X <span>3.40</span></button>
          <button class="odd-btn" onclick="placeBet()">2 <span>2.80</span></button>
        </div>
      </div>`;
  }
}
generateSports();

window.placeBet = function() {
  if (currentBalance < 10) return showToast("Minimum balance to place bets is $10.", "error");
  showToast('Added to Bet Slip', 'success');
};

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
    card.innerHTML = `<div class="casino-overlay" style="align-items:center; justify-content:center; text-align:center; height:100%; display:flex; flex-direction: column;"><span style="font-size:1.5rem; margin-bottom:4px;">🎰</span><span style="font-size:0.9rem; text-transform:uppercase; font-style: italic; font-weight: 800;">${game}</span></div>`;
    card.addEventListener('click', () => launchGame(game));
    casinoGrid.appendChild(card);
  });

  if (homeCarousel) {
    homeCarousel.innerHTML = '';
    topGames.forEach(game => {
      const box = document.createElement('div');
      box.style.cssText = `min-width: 110px; height: 110px; border-radius: 20px; background: linear-gradient(135deg, ${game.color}, #000); display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 8px 16px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); cursor: pointer;`;
      box.innerHTML = `<span style="font-size: 2rem; margin-bottom: 8px;">${game.icon}</span><span style="font-weight: 800; font-size: 0.85rem; font-style: italic; text-transform: uppercase; text-align: center;">${game.name}</span>`;
      box.addEventListener('click', () => {
        if (currentBalance < 10) return showToast("Minimum balance to play Casino is $10.", "error");
        launchGame(game.name);
      });
      homeCarousel.appendChild(box);
    });
  }
}
renderCasino();

window.launchGame = function(gameName) {
  if (currentBalance < 10) return showToast("Minimum balance to play Casino is $10.", "error");
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
      </div>`;
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
  const btn = document.getElementById('avBtn'), display = document.getElementById('avMulti'), plane = document.getElementById('planeAnim'), betInput = document.getElementById('avBet');
  btn.onclick = async () => {
    if (!playing) {
      const betAmt = Number(betInput.value);
      if (betAmt < 1 || betAmt > currentBalance) return showToast("Invalid bet amount", "error");
      await gameUpdateBalance(-betAmt);
      playing = true; multi = 1.00; btn.textContent = "CASH OUT"; btn.style.background = "var(--gold)"; btn.style.color = "#000";
      display.textContent = "1.00x"; display.style.color = "var(--green)"; plane.style.transform = "translate(0, 0)";
      let progress = 0;
      window.gameInterval = setInterval(() => {
        if (Math.random() < 0.06 + (multi * 0.01)) {
          clearInterval(window.gameInterval); display.textContent = "FLEW AWAY!"; display.style.color = "var(--danger)"; display.style.fontSize = "3rem";
          btn.textContent = "BET AGAIN"; btn.style.background = "var(--green)"; btn.style.color = "#000"; playing = false;
        } else {
          multi += 0.05; progress += 1; display.textContent = multi.toFixed(2) + "x";
          plane.style.bottom = `${Math.min(progress * 2, 80)}%`; plane.style.left = `${Math.min(progress * 2, 80)}%`;
        }
      }, 200);
    } else {
      clearInterval(window.gameInterval); playing = false;
      const betAmt = Number(betInput.value);
      const payout = multi * betAmt;
      await gameUpdateBalance(payout); showToast(`Cashed out $${payout.toFixed(2)}!`, "success");
      display.textContent = `Won ${multi.toFixed(2)}x!`; display.style.fontSize = "3rem";
      btn.textContent = "START FLIGHT"; btn.style.background = "var(--green)"; btn.style.color = "#000";
      plane.style.bottom = "20px"; plane.style.left = "20px";
    }
  };
}

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
    cell.style.cssText = "background:var(--bg-card); height:80px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:2rem; cursor:pointer; border:1px solid var(--border);";
    cell.onclick = () => clickMine(i, cell); grid.appendChild(cell);
  }
  window.startMines = async () => {
    if (active || currentBalance < 1) return showToast("Cannot start", "error");
    await gameUpdateBalance(-1); active = true; step = 0; multi = 1.0;
    document.getElementById('minesMulti').textContent = "1.00x";
    document.getElementById('minesBtn').textContent = "Cashout $0.00";
    document.getElementById('minesBtn').disabled = true; document.getElementById('minesBtn').style.opacity = "0.5";
    mines = [];
    while (mines.length < 3) { const r = Math.floor(Math.random() * 9); if (!mines.includes(r)) mines.push(r); }
    Array.from(grid.children).forEach(c => { c.textContent = ""; c.style.background = "var(--bg-card)"; c.style.cursor = "pointer"; });
  };
  window.clickMine = async (idx, cell) => {
    if (!active || cell.textContent !== "") return;
    if (mines.includes(idx)) {
      active = false; cell.textContent = "💣"; cell.style.background = "rgba(239, 68, 68, 0.2)"; cell.style.borderColor = "var(--danger)";
      document.getElementById('minesBtn').textContent = "Play Again"; document.getElementById('minesBtn').disabled = false; document.getElementById('minesBtn').style.opacity = "1";
      mines.forEach(p => { grid.children[p].textContent = "💣"; grid.children[p].style.background = "rgba(239, 68, 68, 0.2)"; });
    } else {
      cell.textContent = "💎"; cell.style.background = "rgba(0, 230, 118, 0.1)"; cell.style.borderColor = "var(--green)";
      step++; multi = 1.0 + (step * 0.5);
      document.getElementById('minesMulti').textContent = `${multi.toFixed(2)}x`;
      document.getElementById('minesBtn').textContent = `Cashout $${multi.toFixed(2)}`;
      document.getElementById('minesBtn').disabled = false; document.getElementById('minesBtn').style.opacity = "1";
      if (step === 6) cashoutMines();
    }
  };
  const cashoutMines = async () => {
    if (!active || step === 0) return; active = false;
    await gameUpdateBalance(multi);
    document.getElementById('minesBtn').textContent = "Play Again"; document.getElementById('minesBtn').disabled = false; document.getElementById('minesBtn').style.opacity = "1";
  };
  document.getElementById('minesBtn').onclick = cashoutMines;
}

function renderCoinFlip(area) {
  area.innerHTML = `
    <div style="background: var(--bg-card); padding: 30px; border-radius: 20px; border: 1px solid var(--border); width: 100%; max-width: 300px;">
      <div id="coinAnim" style="font-size:6rem; margin-bottom:30px; transition: transform 0.6s ease-out;">🪙</div>
      <p class="muted mb-16">Choose Heads or Tails to win $1.95</p>
      <div style="display:flex; gap:15px; width:100%;">
        <button class="btn-small btn-outline" style="flex:1; padding:15px;" onclick="playCoin('Heads')">Heads</button>
        <button class="btn-small btn-outline" style="flex:1; padding:15px;" onclick="playCoin('Tails')">Tails</button>
      </div>
    </div>
  `;
  window.playCoin = async (choice) => {
    if (currentBalance < 1) return showToast("No funds", "error");
    const anim = document.getElementById('coinAnim'); anim.style.transform = "rotateY(1800deg)"; await gameUpdateBalance(-1);
    setTimeout(async () => {
      const result = Math.random() < 0.5 ? 'Heads' : 'Tails'; anim.textContent = result === 'Heads' ? '👑' : '🦅'; anim.style.transform = "rotateY(0deg)";
      if (choice === result) { await gameUpdateBalance(1.95); showToast(`Won! It was ${result}`, "success"); }
      else { showToast(`Lost! It was ${result}`, "error"); }
    }, 600);
  };
}

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
    if (currentBalance < 1) return showToast("No funds", "error"); await gameUpdateBalance(-1);
    const anim = document.getElementById('diceAnim'); anim.style.transform = "rotate(720deg)";
    setTimeout(async () => {
      const res = Math.floor(Math.random() * 100) + 1;
      document.getElementById('diceResult').textContent = res;
      document.getElementById('diceResult').style.color = res > 50 ? "var(--green)" : "var(--danger)"; anim.style.transform = "rotate(0deg)";
      const win = (choice === 'over' && res > 50) || (choice === 'under' && res < 50);
      if (win) { await gameUpdateBalance(1.95); showToast(`Won! Rolled ${res}`, "success"); }
      else { showToast(`Lost! Rolled ${res}`, "error"); }
    }, 600);
  };
                  }
