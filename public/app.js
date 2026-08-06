const API_URL = location.hostname.endsWith(".onrender.com")
  ? location.origin
  : (localStorage.getItem("albionRouteApi") || "https://albion-route-api.onrender.com");

const state = { maps: [], portals: [], permanent: [], ownerToken: localStorage.getItem("albionOwnerToken") || crypto.randomUUID() };
localStorage.setItem("albionOwnerToken", state.ownerToken);

const $ = (id) => document.getElementById(id);
const toast = (message) => {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
};
const api = async (path, options = {}) => {
  const response = await fetch(API_URL + path, options);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const remaining = (date) => {
  const seconds = Math.max(0, Math.floor((new Date(date) - Date.now()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
};
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function showTab(id) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === id));
}

function renderPortals() {
  const now = Date.now();
  state.portals = state.portals.filter((p) => new Date(p.closesAt).getTime() > now);
  $("portalCount").textContent = state.portals.length;
  if (!state.portals.length) {
    $("portalList").innerHTML = '<div class="route-result empty">Aucun portail actif pour le moment.</div>';
    return;
  }
  $("portalList").innerHTML = state.portals.map((p) => `
    <article class="portal-card">
      <div><strong>${escapeHtml(p.fromMap)} → ${escapeHtml(p.toMap)}</strong><small>Portail Avalon • ${p.capacity} personnes</small></div>
      <span class="countdown" data-closes="${p.closesAt}">${remaining(p.closesAt)}</span>
      <button class="delete" data-delete="${p.id}">Supprimer</button>
    </article>`).join("");
}

async function loadPortals(silent = false) {
  try {
    const data = await api("/api/portals");
    state.portals = data.portals || [];
    renderPortals();
    if (!silent) toast("Portails actualisés");
  } catch {
    renderPortals();
    if (!silent) toast("API temporairement indisponible");
  }
}

function renderCatalog() {
  const query = $("catalogSearch").value.trim().toLowerCase();
  const tier = $("tierFilter").value;
  const shape = $("shapeFilter").value;
  const roads = state.maps.filter((m) => m.mapType === "roads");
  const filtered = roads.filter((m) =>
    (!query || m.mapName.toLowerCase().includes(query)) &&
    (!tier || String(m.tier) === tier) &&
    (!shape || m.mapShape === shape)
  );
  $("catalogCount").textContent = `${filtered.length} / ${roads.length} cartes`;
  $("catalogGrid").innerHTML = filtered.slice(0, 404).map((m) => `
    <article class="map-card" data-map="${escapeHtml(m.mapName)}">
      <h3>${escapeHtml(m.mapName)}</h3>
      <div class="map-meta"><span>T${m.tier}</span><span>Forme ${String(m.mapShape || "?").toUpperCase()}</span><span>${m.socketCount || "?"} sorties</span></div>
      <div class="features">${(m.knownFeatures || []).map(escapeHtml).join(" • ") || "Caractéristiques non renseignées"}</div>
    </article>`).join("");
}

function findRoute(from, to, capacity) {
  const adjacency = new Map();
  const add = (a, b, edge) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push({ node: b, edge });
    adjacency.get(b).push({ node: a, edge });
  };
  state.permanent.forEach((e) => add(e.from, e.to, { ...e, type: "permanent" }));
  state.portals
    .filter((p) => p.capacity >= capacity && new Date(p.closesAt) > Date.now())
    .forEach((p) => add(p.fromMap, p.toMap, { ...p, type: "avalon" }));

  const queue = [from];
  const visited = new Set([from]);
  const previous = new Map();
  while (queue.length) {
    const current = queue.shift();
    if (current === to) break;
    for (const next of adjacency.get(current) || []) {
      if (visited.has(next.node)) continue;
      visited.add(next.node);
      previous.set(next.node, { node: current, edge: next.edge });
      queue.push(next.node);
    }
  }
  if (!visited.has(to)) return null;
  const steps = [];
  let cursor = to;
  while (cursor !== from) {
    const prev = previous.get(cursor);
    steps.unshift({ from: prev.node, to: cursor, edge: prev.edge });
    cursor = prev.node;
  }
  return steps;
}

function calculateRoute() {
  const from = $("routeFrom").value.trim();
  const to = $("routeTo").value.trim();
  const capacity = Number($("groupSize").value);
  if (!state.maps.some((m) => m.mapName === from) || !state.maps.some((m) => m.mapName === to)) {
    toast("Sélectionne deux cartes valides"); return;
  }
  if (from === to) { $("routeResult").innerHTML = "<strong>Vous êtes déjà sur cette carte.</strong>"; return; }
  const route = findRoute(from, to, capacity);
  if (!route) {
    $("routeResult").innerHTML = '<div class="empty">Aucun chemin connu. Ajoute les portails d’Avalon découverts en jeu ou réessaie après le chargement du réseau permanent.</div>';
    return;
  }
  const avalonCount = route.filter((s) => s.edge.type === "avalon").length;
  $("routeResult").innerHTML = `
    <div class="route-summary"><strong>${route.length} passage${route.length > 1 ? "s" : ""}</strong><span>${avalonCount} portail${avalonCount > 1 ? "s" : ""} Avalon</span></div>
    ${route.map((s, i) => `<div class="route-step"><span class="number">${i + 1}</span><div><strong>${escapeHtml(s.to)}</strong><small>Depuis ${escapeHtml(s.from)}</small></div><span class="tag ${s.edge.type}">${s.edge.type === "avalon" ? `Avalon ${s.edge.capacity} • ${remaining(s.edge.closesAt)}` : "Permanent"}</span></div>`).join("")}`;
}

async function boot() {
  try {
    const [health, mapData, network] = await Promise.all([
      api("/health"), api("/api/maps"), api("/api/permanent-connections").catch(() => ({ edges: [], source: "unavailable" }))
    ]);
    state.maps = mapData.maps;
    state.permanent = network.edges || [];
    $("statusDot").parentElement.classList.add("online");
    $("apiStatus").textContent = health.database ? "Synchronisation active" : "Mode local";
    $("mapCount").textContent = state.maps.length;
    $("avalonCount").textContent = state.maps.filter((m) => m.mapType === "roads").length;
    $("networkStatus").textContent = state.permanent.length ? `${state.permanent.length} passages permanents` : "Avalon communautaire actif";
    $("allMaps").innerHTML = state.maps.map((m) => `<option value="${escapeHtml(m.mapName)}"></option>`).join("");
    renderCatalog();
    await loadPortals(true);
  } catch (error) {
    $("apiStatus").textContent = "API en réveil…";
    toast("Le serveur gratuit se réveille, nouvelle tentative dans 20 secondes");
    setTimeout(boot, 20_000);
  }
}

document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));
$("swapRoute").addEventListener("click", () => { [$("routeFrom").value, $("routeTo").value] = [$("routeTo").value, $("routeFrom").value]; });
$("calculate").addEventListener("click", calculateRoute);
$("refreshPortals").addEventListener("click", () => loadPortals());
$("portalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = Number($("duration").value);
  const ms = amount * ($("durationUnit").value === "hours" ? 3_600_000 : 60_000);
  try {
    await api("/api/portals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromMap: $("portalFrom").value.trim(), toMap: $("portalTo").value.trim(),
        capacity: Number($("capacity").value), closesAt: new Date(Date.now() + ms).toISOString(),
        ownerToken: state.ownerToken
      })
    });
    toast("Portail enregistré et partagé");
    $("portalForm").reset();
    await loadPortals(true);
  } catch (error) { toast(error.message === "invalid_maps" ? "Cartes invalides" : "Impossible d’enregistrer ce portail"); }
});
$("portalList").addEventListener("click", async (event) => {
  const id = event.target.dataset.delete;
  if (!id) return;
  try {
    await api("/api/portals/" + id, { method: "DELETE", headers: { "X-Owner-Token": state.ownerToken } });
    await loadPortals(true); toast("Portail supprimé");
  } catch { toast("Seul l’auteur peut supprimer ce portail"); }
});
["catalogSearch", "tierFilter", "shapeFilter"].forEach((id) => $(id).addEventListener("input", renderCatalog));
$("catalogGrid").addEventListener("click", (event) => {
  const card = event.target.closest("[data-map]"); if (!card) return;
  $("routeFrom").value = card.dataset.map; showTab("route"); toast("Carte définie comme départ");
});
setInterval(() => {
  document.querySelectorAll("[data-closes]").forEach((el) => el.textContent = remaining(el.dataset.closes));
  if (state.portals.some((p) => new Date(p.closesAt) <= Date.now())) renderPortals();
}, 1000);
setInterval(() => loadPortals(true), 30_000);
boot();
