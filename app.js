const byId = (id) => document.getElementById(id);
const message = byId("message");
const routeInfo = byId("routeInfo");
const gpsInfo = byId("gpsInfo");
const trackingButton = byId("trackingButton");
const navigationButton = byId("navigationButton");
const centerButton = byId("centerButton");
const waypointButton = byId("waypointButton");
const resetButton = byId("resetButton");
const collapseButton = byId("collapseButton");
const panelContent = byId("panelContent");
const navStatus = byId("navStatus");
const waypointList = byId("waypointList");
const waypointCount = byId("waypointCount");

if (typeof L === "undefined") {
  message.textContent = "Leafletを読み込めませんでした。インターネット接続を確認してください";
  throw new Error("Leaflet load failed");
}

const map = L.map("map").setView([35.0116, 135.7681], 11);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const makeIcon = (className, text) => L.divIcon({
  className: "",
  html: `<div class="${className}">${text}</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});
const startIcon = makeIcon("start-icon", "出");
const goalIcon = makeIcon("goal-icon", "着");
const currentIcon = makeIcon("current-icon", "");
const waypointIcon = (number) => makeIcon("waypoint-icon", String(number));

let startPoint = null;
let goalPoint = null;
let startMarker = null;
let goalMarker = null;
let routeLine = null;
let waypoints = []; // { id, point, marker, passed }
let nextWaypointId = 1;
let addWaypointMode = false;
let routeRequestSerial = 0;

let watchId = null;
let currentLocationMarker = null;
let accuracyCircle = null;
let latestPosition = null;
let followCurrentLocation = true;
let navigationMode = false;
let panelCollapsed = false;

map.on("click", async (event) => {
  if (!startPoint) {
    setStart(event.latlng);
    return;
  }
  if (!goalPoint) {
    setGoal(event.latlng);
    await calculateRoute();
    return;
  }
  if (addWaypointMode) {
    addWaypoint(event.latlng);
    setAddWaypointMode(false);
    await calculateRoute();
    return;
  }
  message.textContent = "通過地点を増やす場合は「➕ 通過地点を追加」を押してください";
});

map.on("dragstart zoomstart", () => {
  if (!navigationMode) followCurrentLocation = false;
});

function setStart(point) {
  startPoint = L.latLng(point);
  if (startMarker) map.removeLayer(startMarker);
  startMarker = L.marker(startPoint, { icon: startIcon, draggable: true })
    .addTo(map).bindPopup("出発地");
  startMarker.on("dragend", async () => {
    startPoint = startMarker.getLatLng();
    await calculateRoute();
  });
  message.textContent = "次に目的地をクリックしてください";
}

function setGoal(point) {
  goalPoint = L.latLng(point);
  if (goalMarker) map.removeLayer(goalMarker);
  goalMarker = L.marker(goalPoint, { icon: goalIcon, draggable: true })
    .addTo(map).bindPopup("目的地");
  goalMarker.on("dragend", async () => {
    goalPoint = goalMarker.getLatLng();
    await calculateRoute();
  });
  message.textContent = "ルートを検索しています…";
}

function setAddWaypointMode(enabled) {
  addWaypointMode = enabled;
  document.body.classList.toggle("add-waypoint-mode", enabled);
  waypointButton.classList.toggle("active", enabled);
  waypointButton.textContent = enabled ? "✖ 追加をキャンセル" : "➕ 通過地点を追加";
  if (enabled) {
    if (!startPoint || !goalPoint) {
      setAddWaypointMode(false);
      alert("先に出発地と目的地を設定してください");
      return;
    }
    message.textContent = "通りたい道路付近を地図上でクリックしてください";
  }
}

waypointButton.addEventListener("click", () => setAddWaypointMode(!addWaypointMode));

function addWaypoint(point) {
  const item = { id: nextWaypointId++, point: L.latLng(point), marker: null, passed: false };
  item.marker = L.marker(item.point, { icon: waypointIcon(waypoints.length + 1), draggable: true })
    .addTo(map).bindPopup(`通過地点 ${waypoints.length + 1}`);
  item.marker.on("dragend", async () => {
    item.point = item.marker.getLatLng();
    item.passed = false;
    renderWaypoints();
    await calculateRoute();
  });
  waypoints.push(item);
  renderWaypoints();
  message.textContent = `通過地点${waypoints.length}を追加しました`;
}

function renderWaypoints() {
  waypointCount.textContent = `${waypoints.length}か所`;
  waypointList.innerHTML = "";

  if (!waypoints.length) {
    waypointList.innerHTML = '<div class="empty-waypoints">まだ通過地点はありません</div>';
    return;
  }

  waypoints.forEach((item, index) => {
    item.marker.setIcon(waypointIcon(index + 1));
    item.marker.setPopupContent(`通過地点 ${index + 1}`);

    const row = document.createElement("div");
    row.className = "waypoint-row";
    row.innerHTML = `
      <div class="waypoint-number">${index + 1}</div>
      <div class="waypoint-name">${item.passed ? "✅ 通過済み" : `通過地点 ${index + 1}`}</div>
      <div class="waypoint-actions">
        <button type="button" data-action="up" title="一つ上へ" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-action="down" title="一つ下へ" ${index === waypoints.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" data-action="delete" title="削除">×</button>
      </div>`;

    row.querySelector('[data-action="up"]').addEventListener("click", () => moveWaypoint(index, -1));
    row.querySelector('[data-action="down"]').addEventListener("click", () => moveWaypoint(index, 1));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => removeWaypoint(index));
    row.querySelector(".waypoint-name").addEventListener("click", () => map.setView(item.point, Math.max(map.getZoom(), 15)));
    waypointList.appendChild(row);
  });
}

async function moveWaypoint(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= waypoints.length) return;
  [waypoints[index], waypoints[newIndex]] = [waypoints[newIndex], waypoints[index]];
  waypoints.forEach((item) => { item.passed = false; });
  renderWaypoints();
  await calculateRoute();
}

async function removeWaypoint(index) {
  const [removed] = waypoints.splice(index, 1);
  if (removed?.marker) map.removeLayer(removed.marker);
  renderWaypoints();
  await calculateRoute();
  message.textContent = "通過地点を削除してルートを引き直しました";
}

async function calculateRoute() {
  if (!startPoint || !goalPoint) return;
  const requestNumber = ++routeRequestSerial;
  const allPoints = [startPoint, ...waypoints.map((w) => w.point), goalPoint];
  const coordinates = allPoints.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`;
  message.textContent = "ルートを検索しています…";

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("ルート検索サーバーに接続できません");
    const data = await response.json();
    if (requestNumber !== routeRequestSerial) return;
    if (data.code !== "Ok" || !data.routes?.length) throw new Error("ルートが見つかりませんでした");

    const route = data.routes[0];
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.geoJSON(route.geometry, {
      style: { color: "#1769e0", weight: 7, opacity: .85 }
    }).addTo(map);

    if (!navigationMode) map.fitBounds(routeLine.getBounds(), { padding: [45, 45] });

    const distanceKm = route.distance / 1000;
    const totalMinutes = Math.max(1, Math.round(route.duration / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const timeText = hours > 0 ? `${hours}時間${minutes}分` : `${minutes}分`;
    routeInfo.innerHTML = `距離：約${distanceKm.toFixed(1)}km<br>時間：約${timeText}<br>通過地点：${waypoints.length}か所`;
    message.textContent = waypoints.length
      ? `通過地点${waypoints.length}か所を含むルートを表示しました`
      : "ルートを表示しました";
  } catch (error) {
    console.error(error);
    message.textContent = "ルートを表示できませんでした";
    alert(error.message);
  }
}

trackingButton.addEventListener("click", () => watchId === null ? startTracking() : stopTracking());

navigationButton.addEventListener("click", () => {
  navigationMode = !navigationMode;
  if (navigationMode) {
    if (watchId === null) startTracking();
    followCurrentLocation = true;
    document.body.classList.add("navigation-mode");
    navigationButton.textContent = "🧭 ナビモード終了";
    navStatus.textContent = "ナビモード ON・通過地点は自動通過";
    if (latestPosition) map.setView(latestPosition, 16, { animate: true });
    message.textContent = "ナビモードを開始しました。通過地点で操作は不要です";
  } else {
    document.body.classList.remove("navigation-mode");
    navigationButton.textContent = "🧭 ナビモード";
    navStatus.textContent = "ナビモード OFF";
    message.textContent = "ナビモードを終了しました";
  }
});

centerButton.addEventListener("click", () => {
  if (!latestPosition) return alert("まだ現在地を取得できていません");
  followCurrentLocation = true;
  map.setView(latestPosition, Math.max(map.getZoom(), 16));
  message.textContent = "現在地を地図の中央に戻しました";
});

collapseButton.addEventListener("click", () => {
  panelCollapsed = !panelCollapsed;
  panelContent.style.display = panelCollapsed ? "none" : "block";
  collapseButton.textContent = panelCollapsed ? "＋" : "－";
});

function startTracking() {
  if (!navigator.geolocation) return alert("この端末は現在地取得に対応していません");
  message.textContent = "現在地を取得しています…";
  gpsInfo.innerHTML = "GPS：取得中…<br>精度：未取得<br>速度：未取得";
  followCurrentLocation = true;
  watchId = navigator.geolocation.watchPosition(updateCurrentLocation, handleLocationError, {
    enableHighAccuracy: true, timeout: 15000, maximumAge: 2000
  });
  trackingButton.textContent = "⏹ 現在地追跡を停止";
}

function stopTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  trackingButton.textContent = "📍 現在地追跡を開始";
  gpsInfo.innerHTML = "GPS：停止中<br>精度：未取得<br>速度：未取得";
  message.textContent = "現在地追跡を停止しました";
}

function updateCurrentLocation(position) {
  const point = L.latLng(position.coords.latitude, position.coords.longitude);
  latestPosition = point;

  if (!currentLocationMarker) {
    currentLocationMarker = L.marker(point, { icon: currentIcon, zIndexOffset: 1000 }).addTo(map).bindPopup("現在地");
  } else currentLocationMarker.setLatLng(point);

  const accuracy = position.coords.accuracy || 0;
  if (!accuracyCircle) {
    accuracyCircle = L.circle(point, { radius: accuracy, color: "#007aff", weight: 1, fillColor: "#007aff", fillOpacity: .12 }).addTo(map);
  } else {
    accuracyCircle.setLatLng(point);
    accuracyCircle.setRadius(accuracy);
  }

  if (navigationMode || followCurrentLocation) map.setView(point, Math.max(map.getZoom(), 16), { animate: true });
  if (!startPoint) setStart(point);

  const speedMps = position.coords.speed;
  const speedKmh = typeof speedMps === "number" && speedMps >= 0 ? speedMps * 3.6 : null;
  gpsInfo.innerHTML = `GPS：追跡中<br>精度：約${Math.round(accuracy)}m<br>速度：${speedKmh === null ? "取得できません" : "約" + Math.round(speedKmh) + "km/h"}`;

  checkPassedWaypoints(point, accuracy);
  message.textContent = navigationMode ? "現在地を中央追尾しています" : "現在地をリアルタイム追跡しています";
}

function checkPassedWaypoints(currentPoint, accuracy) {
  const thresholdMeters = Math.max(60, Math.min(150, (accuracy || 0) * 1.5));
  const next = waypoints.find((item) => !item.passed);
  if (!next) return;
  if (currentPoint.distanceTo(next.point) <= thresholdMeters) {
    next.passed = true;
    renderWaypoints();
    const remaining = waypoints.filter((item) => !item.passed).length;
    navStatus.textContent = remaining
      ? `通過地点を自動通過・残り${remaining}か所`
      : "全通過地点を通過・目的地へ";
  }
}

function handleLocationError(error) {
  console.error(error);
  let errorText = "現在地を取得できませんでした";
  if (error.code === error.PERMISSION_DENIED) errorText = "位置情報が許可されていません。ブラウザの位置情報を許可してください";
  else if (error.code === error.POSITION_UNAVAILABLE) errorText = "現在地を取得できません。GPSの受信状態を確認してください";
  else if (error.code === error.TIMEOUT) errorText = "現在地の取得がタイムアウトしました";
  message.textContent = errorText;
  alert(errorText);
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  trackingButton.textContent = "📍 現在地追跡を開始";
  gpsInfo.innerHTML = "GPS：エラー<br>精度：未取得<br>速度：未取得";
}

resetButton.addEventListener("click", () => {
  setAddWaypointMode(false);
  for (const layer of [startMarker, goalMarker, routeLine, ...waypoints.map((w) => w.marker)]) {
    if (layer) map.removeLayer(layer);
  }
  startPoint = goalPoint = null;
  startMarker = goalMarker = routeLine = null;
  waypoints = [];
  routeRequestSerial++;
  renderWaypoints();
  routeInfo.innerHTML = "距離：未設定<br>時間：未設定";
  message.textContent = "地図をクリックして出発地を選んでください";
  navStatus.textContent = navigationMode ? "ナビモード ON" : "ナビモード OFF";
});

renderWaypoints();
