const API_URL = location.hostname.endsWith(".onrender.com")
  ? location.origin
  : (location.hostname.endsWith(".vercel.app")
    ? ""
    : (localStorage.getItem("albionRouteApi") || "https://albion-route-api.onrender.com"));

const state = {
  maps: [],
  portals: [],
  permanent: [],
  gameServer: localStorage.getItem("albionGameServer") || "europe",
  ownerToken: localStorage.getItem("albionOwnerToken") || crypto.randomUUID()
};
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
const FEATURE_LABELS = {
  cotton: "Fibre",
  hide: "Peaux",
  logs: "Bois",
  ore: "Minerai",
  rock: "Pierre",
  largeBlueChest: "Grand coffre bleu",
  largeGoldChest: "Grand coffre doré",
  largeGreenChest: "Grand coffre vert"
};
const readableFeatures = (map) => (map?.knownFeatures || []).map((feature) => FEATURE_LABELS[feature] || feature);
const wrapFeatureLines = (features, maxLength = 38) => {
  if (!features.length) return ["Contenu non renseigné"];
  const lines = [];
  features.forEach((feature) => {
    const current = lines.at(-1);
    if (!current || current.length + feature.length + 3 > maxLength) lines.push(feature);
    else lines[lines.length - 1] += " • " + feature;
  });
  return lines;
};

function showTab(id) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === id));
}

const portalLifeClass = (closesAt) => {
  const minutes = (new Date(closesAt) - Date.now()) / 60000;
  return minutes < 15 ? "life-short" : minutes < 60 ? "life-medium" : "life-long";
};

function renderPortalMap() {
  const host = $("portalNetwork");
  if (!host) return;
  const query = $("networkSearch").value.trim().toLowerCase();
  const capacity = Number($("networkCapacity").value || 0);
  const edges = state.portals.filter((p) =>
    (!capacity || p.capacity === capacity) &&
    (!query || p.fromMap.toLowerCase().includes(query) || p.toMap.toLowerCase().includes(query))
  );
  const names = [...new Set(edges.flatMap((p) => [p.fromMap, p.toMap]))].sort();
  $("networkCount").textContent = `${edges.length} passage${edges.length > 1 ? "s" : ""} actif${edges.length > 1 ? "s" : ""}`;
  if (!edges.length) {
    host.innerHTML = '<div class="network-empty">Aucun portail actif ne correspond aux filtres sur ce serveur.</div>';
    return;
  }

  const width = 1200;
  const height = Math.max(620, Math.ceil(names.length / 8) * 160);
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = Math.min(470, width * .4);
  const radiusY = Math.min(Math.max(220, names.length * 16), height * .4);
  const positions = new Map(names.map((name, index) => {
    const angle = (Math.PI * 2 * index / names.length) - Math.PI / 2;
    return [name, { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY }];
  }));

  for (let iteration = 0; iteration < 70; iteration++) {
    const forces = new Map(names.map((name) => [name, { x: 0, y: 0 }]));
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = positions.get(names[i]), b = positions.get(names[j]);
        const dx = a.x - b.x || .1, dy = a.y - b.y || .1;
        const distanceSq = Math.max(9000, dx * dx + dy * dy);
        const strength = 150000 / distanceSq;
        const distance = Math.sqrt(distanceSq);
        forces.get(names[i]).x += dx / distance * strength;
        forces.get(names[i]).y += dy / distance * strength;
        forces.get(names[j]).x -= dx / distance * strength;
        forces.get(names[j]).y -= dy / distance * strength;
      }
    }
    edges.forEach((edge) => {
      const a = positions.get(edge.fromMap), b = positions.get(edge.toMap);
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const spring = (distance - 310) * .008;
      forces.get(edge.fromMap).x += dx / distance * spring;
      forces.get(edge.fromMap).y += dy / distance * spring;
      forces.get(edge.toMap).x -= dx / distance * spring;
      forces.get(edge.toMap).y -= dy / distance * spring;
    });
    names.forEach((name) => {
      const p = positions.get(name), f = forces.get(name);
      p.x = Math.max(150, Math.min(width - 150, p.x + f.x + (centerX - p.x) * .002));
      p.y = Math.max(80, Math.min(height - 80, p.y + f.y + (centerY - p.y) * .002));
    });
  }

  const edgeSvg = edges.map((edge) => {
    const a = positions.get(edge.fromMap), b = positions.get(edge.toMap);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const life = portalLifeClass(edge.closesAt);
    return `<g class="network-edge ${life}">
      <line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"></line>
      <text x="${mx}" y="${my - 7}" data-map-closes="${edge.closesAt}" data-capacity="${edge.capacity}">${edge.capacity}p • ${remaining(edge.closesAt)}</text>
      <title>${escapeHtml(edge.fromMap)} → ${escapeHtml(edge.toMap)} — ${edge.capacity} personnes</title>
    </g>`;
  }).join("");

  const nodeSvg = names.map((name) => {
    const p = positions.get(name);
    const map = state.maps.find((item) => item.mapName === name);
    const isAvalon = map?.mapType === "roads";
    const featureLines = isAvalon ? wrapFeatureLines(readableFeatures(map)) : [];
    const labelWidth = isAvalon ? 268 : Math.min(240, Math.max(150, name.length * 7.4 + 30));
    const nodeHeight = isAvalon ? 68 + featureLines.length * 14 : 58;
    const top = -nodeHeight / 2;
    const meta = isAvalon
      ? `T${map.tier || "?"} • Forme ${String(map.mapShape || "?").toUpperCase()} • ${map.socketCount || "?"} sorties`
      : "Zone continentale";
    const features = featureLines.map((line, index) =>
      `<text class="node-feature" text-anchor="middle" y="${top + 58 + index * 14}">${escapeHtml(line)}</text>`
    ).join("");
    const title = isAvalon
      ? `${name} — ${meta} — ${readableFeatures(map).join(", ") || "contenu non renseigné"}`
      : `${name} — Zone continentale`;
    return `<g class="network-node ${isAvalon ? "avalon-zone" : "continent-zone"}" transform="translate(${p.x} ${p.y})" data-network-map="${escapeHtml(name)}" tabindex="0" role="button">
      <rect x="${-labelWidth / 2}" y="${top}" width="${labelWidth}" height="${nodeHeight}" rx="15"></rect>
      <text class="node-name" text-anchor="middle" y="${top + 23}">${escapeHtml(name)}</text>
      <text class="node-meta" text-anchor="middle" y="${top + 42}">${escapeHtml(meta)}</text>
      ${features}
      <title>${escapeHtml(title)}</title>
    </g>`;
  }).join("");

  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Réseau des portails Avalon actifs">
    <g class="edges">${edgeSvg}</g><g class="nodes">${nodeSvg}</g>
  </svg>`;
}

function renderPortals() {
  const now = Date.now();
  state.portals = state.portals.filter((p) => new Date(p.closesAt).getTime() > now);
  $("portalCount").textContent = state.portals.length;
  renderPortalMap();
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
    const data = await api("/api/portals?server=" + encodeURIComponent(state.gameServer));
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
      <div class="features">${readableFeatures(m).map(escapeHtml).join(" • ") || "Caractéristiques non renseignées"}</div>
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
    $("gameServer").value = state.gameServer;
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
  const hours = Number($("durationHours").value);
  const minutes = Number($("durationMinutes").value);
  const totalMinutes = (hours * 60) + minutes;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || totalMinutes < 2) {
    toast("Indique un temps entre 2 min et 23 h 59 min");
    return;
  }
  const ms = totalMinutes * 60_000;
  try {
    await api("/api/portals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromMap: $("portalFrom").value.trim(), toMap: $("portalTo").value.trim(),
        capacity: Number($("capacity").value), closesAt: new Date(Date.now() + ms).toISOString(),
        gameServer: state.gameServer, ownerToken: state.ownerToken
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
["networkSearch", "networkCapacity"].forEach((id) => $(id).addEventListener("input", renderPortalMap));
$("refreshNetwork").addEventListener("click", () => loadPortals());
$("gameServer").addEventListener("change", async (event) => {
  state.gameServer = event.target.value;
  localStorage.setItem("albionGameServer", state.gameServer);
  state.portals = [];
  renderPortals();
  await loadPortals(true);
  toast("Serveur communautaire changé");
});
$("portalNetwork").addEventListener("click", (event) => {
  const node = event.target.closest("[data-network-map]");
  if (!node) return;
  if (!$("routeFrom").value) $("routeFrom").value = node.dataset.networkMap;
  else $("routeTo").value = node.dataset.networkMap;
  showTab("route");
  toast("Carte ajoutée au calculateur");
});
$("catalogGrid").addEventListener("click", (event) => {
  const card = event.target.closest("[data-map]"); if (!card) return;
  $("routeFrom").value = card.dataset.map; showTab("route"); toast("Carte définie comme départ");
});
setInterval(() => {
  document.querySelectorAll("[data-closes]").forEach((el) => el.textContent = remaining(el.dataset.closes));
  document.querySelectorAll("[data-map-closes]").forEach((el) => {
    el.textContent = `${el.dataset.capacity}p • ${remaining(el.dataset.mapCloses)}`;
  });
  if (state.portals.some((p) => new Date(p.closesAt) <= Date.now())) renderPortals();
}, 1000);
setInterval(() => loadPortals(true), 15_000);
boot();
