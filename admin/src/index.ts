import {
  adminLogin,
  clearAdminSession,
  getAccount,
  loadAdminSession,
  saveAdminSession,
  searchAccounts,
  updateAccount,
  type AdminAccountDetail,
  type AdminAccountView,
} from './adminApi.js';

const loginOverlay = document.getElementById('loginOverlay') as HTMLDivElement;
const loginPasswordInput = document.getElementById('loginPasswordInput') as HTMLInputElement;
const loginButton = document.getElementById('loginButton') as HTMLButtonElement;
const loginError = document.getElementById('loginError') as HTMLParagraphElement;

const adminPanel = document.getElementById('adminPanel') as HTMLDivElement;
const logoutButton = document.getElementById('logoutButton') as HTMLButtonElement;

const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchButton = document.getElementById('searchButton') as HTMLButtonElement;
const resultsList = document.getElementById('resultsList') as HTMLUListElement;

const detailPanel = document.getElementById('detailPanel') as HTMLDivElement;
const detailPseudo = document.getElementById('detailPseudo') as HTMLHeadingElement;
const detailLevelInput = document.getElementById('detailLevelInput') as HTMLInputElement;
const detailXpInput = document.getElementById('detailXpInput') as HTMLInputElement;
const detailPremiumCheckbox = document.getElementById('detailPremiumCheckbox') as HTMLInputElement;
const detailBannedCheckbox = document.getElementById('detailBannedCheckbox') as HTMLInputElement;
const detailCosmeticsInput = document.getElementById('detailCosmeticsInput') as HTMLInputElement;
const detailBestScores = document.getElementById('detailBestScores') as HTMLUListElement;
const saveButton = document.getElementById('saveButton') as HTMLButtonElement;
const detailError = document.getElementById('detailError') as HTMLParagraphElement;
const detailStatus = document.getElementById('detailStatus') as HTMLParagraphElement;

let adminToken: string | undefined = loadAdminSession();
let selectedAccountId: number | undefined;

function showApp(): void {
  loginOverlay.style.display = 'none';
  adminPanel.style.display = 'flex';
}

function showLogin(): void {
  loginOverlay.style.display = 'flex';
  adminPanel.style.display = 'none';
}

if (adminToken) showApp();
else showLogin();

loginButton.addEventListener('click', () => {
  void (async () => {
    loginError.textContent = '';
    try {
      adminToken = await adminLogin(loginPasswordInput.value);
      saveAdminSession(adminToken);
      loginPasswordInput.value = '';
      showApp();
      void runSearch();
    } catch (error) {
      loginError.textContent = (error as Error).message;
    }
  })();
});

loginPasswordInput.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Enter') loginButton.click();
});

logoutButton.addEventListener('click', () => {
  adminToken = undefined;
  clearAdminSession();
  resultsList.innerHTML = '';
  detailPanel.style.display = 'none';
  showLogin();
});

// --- Recherche de comptes (Lot 5.2) ---------------------------------------------------------

function renderResults(accounts: AdminAccountView[]): void {
  resultsList.innerHTML = '';
  if (accounts.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Aucun compte trouvé.';
    resultsList.appendChild(empty);
    return;
  }
  for (const account of accounts) {
    const item = document.createElement('li');
    item.className = 'result-item';
    const badges = [account.premium ? 'Premium' : '', account.banned ? 'Banni' : '']
      .filter(Boolean)
      .join(' · ');
    item.innerHTML = `<span>${account.pseudo}</span><span class="badge">${badges}</span>`;
    item.addEventListener('click', () => void loadDetail(account.id));
    resultsList.appendChild(item);
  }
}

async function runSearch(): Promise<void> {
  if (!adminToken) return;
  try {
    renderResults(await searchAccounts(adminToken, searchInput.value.trim()));
  } catch (error) {
    // Un token expiré/révoqué (ex. redémarrage serveur, sessions en mémoire) ramène simplement
    // à l'écran de connexion plutôt que d'afficher une liste vide silencieuse.
    if ((error as Error).message.includes('authentifié')) {
      clearAdminSession();
      adminToken = undefined;
      showLogin();
      return;
    }
    loginError.textContent = (error as Error).message;
  }
}

searchButton.addEventListener('click', () => void runSearch());
searchInput.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Enter') void runSearch();
});

// --- Détail / édition d'un compte (Lot 5.2-5.4) ---------------------------------------------

function fillDetail(account: AdminAccountDetail): void {
  detailPseudo.textContent = `${account.pseudo} (#${account.id})`;
  detailLevelInput.value = String(account.level);
  detailXpInput.value = String(account.xp);
  detailPremiumCheckbox.checked = account.premium;
  detailBannedCheckbox.checked = account.banned;
  detailCosmeticsInput.value = account.cosmetics.join(', ');
  detailBestScores.innerHTML = '';
  if (account.bestScores.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Aucune partie jouée.';
    detailBestScores.appendChild(empty);
  } else {
    for (const score of account.bestScores) {
      const item = document.createElement('li');
      item.innerHTML = `<span>${score.modeId}</span><span>${score.bestScore}</span>`;
      detailBestScores.appendChild(item);
    }
  }
}

async function loadDetail(id: number): Promise<void> {
  if (!adminToken) return;
  detailError.textContent = '';
  detailStatus.textContent = '';
  try {
    const account = await getAccount(adminToken, id);
    selectedAccountId = account.id;
    fillDetail(account);
    detailPanel.style.display = 'block';
  } catch (error) {
    detailError.textContent = (error as Error).message;
  }
}

function parseCosmetics(raw: string): string[] {
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

saveButton.addEventListener('click', () => {
  void (async () => {
    if (!adminToken || selectedAccountId === undefined) return;
    detailError.textContent = '';
    detailStatus.textContent = '';
    try {
      const updated = await updateAccount(adminToken, selectedAccountId, {
        level: Number(detailLevelInput.value),
        xp: Number(detailXpInput.value),
        premium: detailPremiumCheckbox.checked,
        banned: detailBannedCheckbox.checked,
        cosmetics: parseCosmetics(detailCosmeticsInput.value),
      });
      detailPseudo.textContent = `${updated.pseudo} (#${updated.id})`;
      detailStatus.textContent = 'Enregistré.';
      void runSearch();
    } catch (error) {
      detailError.textContent = (error as Error).message;
    }
  })();
});

if (adminToken) void runSearch();
