"use strict";

const byId = (id) => document.getElementById(id);
const message = byId("message");
const routeInfo = byId("routeInfo");
const gpsInfo = byId("gpsInfo");
const trackingButton = byId("trackingButton");
const navigationButton = byId("navigationButton");
const voiceButton = byId("voiceButton");
const voiceTestButton = byId("voiceTestButton");
const centerButton = byId("centerButton");
const waypointButton = byId("waypointButton");
const shareButton = byId("shareButton");
const saveButton = byId("saveButton");
const loadButton = byId("loadButton");
const resetButton = byId("resetButton");
const collapseButton = byId("collapseButton");
const panelContent = byId("panelContent");
const navStatus = byId("navStatus");
const waypointList = byId("waypointList");
const waypointCount = byId("waypointCount");

const STORAGE_KEY = "rideNavi.savedRoute.v1";
const ROUTE_PARAM = "r";
const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };

if (typeof L === "undefined") {
  message.textContent = "地図を読み込めませんでした。インターネット接続を確認してください";
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
let waypoints = [];
let nextWaypointId = 1;
let addWaypointMode = false;
let routeRequestSerial = 0;
let currentRoute = null;
let navigationSteps = [];

let watchId = null;
let currentLocationMarker = null;
let accuracyCircle = null;
let latestPosition = null;
let followCurrentLocation = true;
let navigationMode = false;
let panelCollapsed = false;
let voiceEnabled = true;
let lastSpokenAt = 0;
let arrivalSpoken = false;
let offRouteSpoken = false;
let lastOffRouteAt = 0;
let routeCoordinates = [];

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
    resetNavigationProgress();
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
    resetNavigationProgress();
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
    resetNavigationProgress();
    renderWaypoints();
    await calculateRoute();
  });
  waypoints.push(item);
  resetNavigationProgress();
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
  resetNavigationProgress();
  renderWaypoints();
  await calculateRoute();
}

async function removeWaypoint(index) {
  const [removed] = waypoints.splice(index, 1);
  if (removed?.marker) map.removeLayer(removed.marker);
  resetNavigationProgress();
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

    currentRoute = data.routes[0];
    routeCoordinates = (currentRoute.geometry?.coordinates || []).map((c) => L.latLng(c[1], c[0]));
    navigationSteps = buildNavigationSteps(currentRoute);
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.geoJSON(currentRoute.geometry, {
      style: { color: "#1769e0", weight: 7, opacity: 0.85 }
    }).addTo(map);

    if (!navigationMode) map.fitBounds(routeLine.getBounds(), { padding: [45, 45] });

    const distanceKm = currentRoute.distance / 1000;
    const totalMinutes = Math.max(1, Math.round(currentRoute.duration / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const timeText = hours > 0 ? `${hours}時間${minutes}分` : `${minutes}分`;
    const arrivalTime = new Date(Date.now() + currentRoute.duration * 1000);
    const arrivalText = arrivalTime.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    routeInfo.innerHTML = `距離：約${distanceKm.toFixed(1)}km<br>時間：約${timeText}<br>到着予想：約${arrivalText}<br>通過地点：${waypoints.length}か所`;
    message.textContent = waypoints.length
      ? `通過地点${waypoints.length}か所を含むルートを表示しました`
      : "ルートを表示しました";
  } catch (error) {
    console.error(error);
    message.textContent = "ルートを表示できませんでした";
    alert(error.message);
  }
}

function buildNavigationSteps(route) {
  const result = [];
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const location = step.maneuver?.location;
      if (!Array.isArray(location) || location.length < 2) continue;
      result.push({
        point: L.latLng(location[1], location[0]),
        instruction: maneuverText(step),
        announced300: false,
        announced100: false,
        passed: false
      });
    }
  }
  return result;
}

function maneuverText(step) {
  const maneuver = step.maneuver || {};
  const type = maneuver.type || "";
  const modifier = maneuver.modifier || "";
  const road = step.name ? `、${step.name}へ` : "";

  if (type === "arrive") return "目的地です";
  if (type === "depart") return "ルートに沿って進んでください";
  if (type === "roundabout" || type === "rotary") return `ロータリーに入り${road}進んでください`;
  if (type === "merge") return `${directionText(modifier)}へ合流してください`;
  if (type === "fork") return `${directionText(modifier)}方向へ進んでください`;
  if (type === "on ramp") return `${directionText(modifier)}の入口へ進んでください`;
  if (type === "off ramp") return `${directionText(modifier)}の出口へ進んでください`;
  if (type === "continue" || type === "new name") return `${directionText(modifier)}方向${road}進んでください`;
  if (type === "turn" || type === "end of road") return `${directionText(modifier)}${road}曲がってください`;
  return `${directionText(modifier)}方向へ進んでください`;
}

function directionText(modifier) {
  const table = {
    "uturn": "Uターンして",
    "sharp right": "大きく右",
    "right": "右",
    "slight right": "斜め右",
    "straight": "直進",
    "slight left": "斜め左",
    "left": "左",
    "sharp left": "大きく左"
  };
  return table[modifier] || "そのまま";
}

trackingButton.addEventListener("click", () => watchId === null ? startTracking() : stopTracking());

navigationButton.addEventListener("click", () => {
  navigationMode = !navigationMode;
  if (navigationMode) {
    if (!startPoint || !goalPoint || !currentRoute) {
      navigationMode = false;
      alert("先に出発地と目的地を設定してルートを表示してください");
      return;
    }
    if (watchId === null) startTracking();
    followCurrentLocation = true;
    document.body.classList.add("navigation-mode");
    navigationButton.textContent = "🧭 ナビ終了";
    navStatus.textContent = "ナビモード ON・音声案内準備中";
    if (latestPosition) map.setView(latestPosition, 16, { animate: true });
    message.textContent = "ナビを開始しました。通過地点で操作は不要です";
    speak("ナビを開始します。安全運転で出発してください", true);
  } else {
    document.body.classList.remove("navigation-mode");
    navigationButton.textContent = "🧭 ナビ開始";
    navStatus.textContent = "ナビモード OFF";
    message.textContent = "ナビモードを終了しました";
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }
});

voiceTestButton.addEventListener("click", () => {
  if (!("speechSynthesis" in window)) return alert("このブラウザは音声読み上げに対応していません");
  const wasEnabled = voiceEnabled;
  voiceEnabled = true;
  speak("音声案内のテストです。300メートル先、右方向です", true);
  voiceEnabled = wasEnabled;
  message.textContent = "音声テストを再生しました";
});

voiceButton.addEventListener("click", () => {
  voiceEnabled = !voiceEnabled;
  voiceButton.textContent = voiceEnabled ? "🔊 音声 ON" : "🔇 音声 OFF";
  voiceButton.classList.toggle("muted", !voiceEnabled);
  if (voiceEnabled) speak("音声案内をオンにしました", true);
  else if ("speechSynthesis" in window) window.speechSynthesis.cancel();
});

centerButton.addEventListener("click", async () => {
  followCurrentLocation = true;
  if (!latestPosition) {
    message.textContent = "現在地を取得して地図を移動します…";
    gpsInfo.innerHTML = "GPS：現在地を1回取得中…<br>権限：確認中<br>精度：未取得<br>緯度・経度：未取得";
    try {
      const position = await getCurrentPositionOnce();
      updateCurrentLocation(position);
      map.setView(latestPosition, 17, { animate: true });
      message.textContent = "現在地を取得して中央に表示しました";
    } catch (error) {
      handleLocationError(error, false);
    }
    return;
  }
  map.setView(latestPosition, Math.max(map.getZoom(), 16), { animate: true });
  message.textContent = "現在地を地図の中央に戻しました";
});

collapseButton.addEventListener("click", () => {
  panelCollapsed = !panelCollapsed;
  panelContent.style.display = panelCollapsed ? "none" : "block";
  collapseButton.textContent = panelCollapsed ? "＋" : "－";
});

async function startTracking() {
  if (!navigator.geolocation) {
    alert("この端末は現在地取得に対応していません");
    return;
  }
  if (watchId !== null) return;

  message.textContent = "現在地を取得しています…";
  gpsInfo.innerHTML = "GPS：初回位置を取得中…<br>権限：確認中<br>精度：未取得<br>緯度・経度：未取得";
  followCurrentLocation = true;
  trackingButton.disabled = true;
  trackingButton.textContent = "⏳ GPS取得中…";

  try {
    await updatePermissionDisplay();
    const firstPosition = await getCurrentPositionOnce();
    updateCurrentLocation(firstPosition);

    watchId = navigator.geolocation.watchPosition(
      updateCurrentLocation,
      (error) => handleLocationError(error, true),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 1000 }
    );
    trackingButton.textContent = "⏹ 現在地追跡を停止";
    message.textContent = "現在地の追跡を開始しました";
  } catch (error) {
    handleLocationError(error, false);
    trackingButton.textContent = "📍 現在地追跡を開始";
  } finally {
    trackingButton.disabled = false;
  }
}

function getCurrentPositionOnce() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
  });
}

async function updatePermissionDisplay() {
  if (!navigator.permissions?.query) return;
  try {
    const permission = await navigator.permissions.query({ name: "geolocation" });
    const labels = { granted: "許可", prompt: "確認待ち", denied: "拒否" };
    gpsInfo.innerHTML = `GPS：初回位置を取得中…<br>権限：${labels[permission.state] || permission.state}<br>精度：未取得<br>緯度・経度：未取得`;
  } catch (_) {
    // 一部ブラウザではPermissions APIが使えないため、そのまま続行します。
  }
}

function stopTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  trackingButton.textContent = "📍 現在地追跡を開始";
  gpsInfo.innerHTML = "GPS：停止中<br>権限：未確認<br>精度：未取得<br>緯度・経度：未取得";
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
    accuracyCircle = L.circle(point, {
      radius: accuracy,
      color: "#007aff",
      weight: 1,
      fillColor: "#007aff",
      fillOpacity: 0.12
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng(point);
    accuracyCircle.setRadius(accuracy);
  }

  if (navigationMode || followCurrentLocation) map.setView(point, Math.max(map.getZoom(), 16), { animate: true });
  if (!startPoint) setStart(point);

  const speedMps = position.coords.speed;
  const speedKmh = typeof speedMps === "number" && speedMps >= 0 ? speedMps * 3.6 : null;
  gpsInfo.innerHTML = `GPS：追跡中<br>精度：約${Math.round(accuracy)}m<br>速度：${speedKmh === null ? "取得できません" : "約" + Math.round(speedKmh) + "km/h"}<br>緯度：${point.lat.toFixed(6)}<br>経度：${point.lng.toFixed(6)}`;

  checkPassedWaypoints(point, accuracy);
  if (navigationMode) {
    updateVoiceNavigation(point, accuracy);
    updateRemainingDistance(point, speedKmh);
    checkOffRoute(point, accuracy);
    message.textContent = "現在地を中央追尾しています";
  } else {
    message.textContent = "現在地をリアルタイム追跡しています";
  }
}

function checkPassedWaypoints(currentPoint, accuracy) {
  const thresholdMeters = Math.max(60, Math.min(150, (accuracy || 0) * 1.5));
  const next = waypoints.find((item) => !item.passed);
  if (!next) return;
  if (currentPoint.distanceTo(next.point) <= thresholdMeters) {
    next.passed = true;
    renderWaypoints();
    speak(`通過地点${waypoints.indexOf(next) + 1}を通過しました`);
    const remaining = waypoints.filter((item) => !item.passed).length;
    navStatus.textContent = remaining
      ? `通過地点を自動通過・残り${remaining}か所`
      : "全通過地点を通過・目的地へ";
  }
}

function updateVoiceNavigation(currentPoint, accuracy) {
  if (!navigationSteps.length) return;
  const threshold = Math.max(35, Math.min(90, accuracy || 35));

  for (const step of navigationSteps) {
    if (step.passed) continue;
    const distance = currentPoint.distanceTo(step.point);

    if (!step.announced300 && distance <= 330 && distance > 130) {
      step.announced300 = true;
      speak(`およそ300メートル先、${step.instruction}`);
      navStatus.textContent = `約${Math.round(distance / 10) * 10}m先：${step.instruction}`;
      return;
    }
    if (!step.announced100 && distance <= 130 && distance > threshold) {
      step.announced100 = true;
      speak(`まもなく、${step.instruction}`);
      navStatus.textContent = `まもなく：${step.instruction}`;
      return;
    }
    if (distance <= threshold) {
      step.passed = true;
      return;
    }
  }

  if (goalPoint && !arrivalSpoken) {
    const distanceToGoal = currentPoint.distanceTo(goalPoint);
    if (distanceToGoal <= Math.max(50, accuracy || 50)) {
      arrivalSpoken = true;
      speak("目的地に到着しました。お疲れさまでした", true);
      navStatus.textContent = "目的地に到着しました";
    }
  }
}

function updateRemainingDistance(currentPoint, speedKmh) {
  if (!goalPoint) return;
  const nearest = nearestRouteIndex(currentPoint);
  let remainingMeters = currentPoint.distanceTo(goalPoint);
  if (nearest >= 0 && routeCoordinates.length > 1) {
    remainingMeters = currentPoint.distanceTo(routeCoordinates[nearest]);
    for (let i = nearest; i < routeCoordinates.length - 1; i += 1) {
      remainingMeters += routeCoordinates[i].distanceTo(routeCoordinates[i + 1]);
    }
  }

  const remainingText = remainingMeters < 1000
    ? `残り約${Math.max(0, Math.round(remainingMeters / 10) * 10)}m`
    : `残り約${(remainingMeters / 1000).toFixed(1)}km`;

  let etaText = "";
  const usableSpeed = typeof speedKmh === "number" && speedKmh >= 5 ? speedKmh : null;
  if (usableSpeed) {
    const minutes = Math.max(1, Math.round((remainingMeters / 1000) / usableSpeed * 60));
    const eta = new Date(Date.now() + minutes * 60000);
    etaText = `・到着予想 ${eta.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`;
  }

  const activeStep = navigationSteps.find((step) => !step.passed);
  const instructionText = activeStep ? `・${activeStep.instruction}` : "";
  navStatus.textContent = `${remainingText}${etaText}${instructionText}`;
}

function nearestRouteIndex(currentPoint) {
  if (!routeCoordinates.length) return -1;
  let bestIndex = -1;
  let bestDistance = Infinity;
  routeCoordinates.forEach((point, index) => {
    const distance = currentPoint.distanceTo(point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function distanceFromRoute(currentPoint) {
  const index = nearestRouteIndex(currentPoint);
  return index < 0 ? Infinity : currentPoint.distanceTo(routeCoordinates[index]);
}

function checkOffRoute(currentPoint, accuracy) {
  if (!routeCoordinates.length) return;
  const distance = distanceFromRoute(currentPoint);
  const threshold = Math.max(120, Math.min(220, (accuracy || 40) * 2.5));
  const now = Date.now();

  if (distance > threshold) {
    navStatus.classList.add("off-route");
    if (!offRouteSpoken || now - lastOffRouteAt > 60000) {
      offRouteSpoken = true;
      lastOffRouteAt = now;
      speak("ルートから外れています。安全な場所で地図を確認してください", true);
    }
  } else {
    navStatus.classList.remove("off-route");
    if (distance < threshold * 0.65) offRouteSpoken = false;
  }
}

function speak(text, force = false) {
  if (!voiceEnabled || !("speechSynthesis" in window)) return;
  const now = Date.now();
  if (!force && now - lastSpokenAt < 3500) return;
  lastSpokenAt = now;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 1.05;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

function handleLocationError(error, stopWatcher = true) {
  console.error(error);
  let errorText = "現在地を取得できませんでした";
  let detail = `コード：${error?.code ?? "不明"}`;
  if (error?.code === 1) {
    errorText = "位置情報が許可されていません";
    detail = "Chromeのサイト設定で位置情報を「許可」にしてください";
  } else if (error?.code === 2) {
    errorText = "現在地を取得できません";
    detail = "屋外へ移動し、スマホの位置情報をオンにして再試行してください";
  } else if (error?.code === 3) {
    errorText = "現在地の取得がタイムアウトしました";
    detail = "もう一度押すか、屋外で試してください";
  }
  message.textContent = `${errorText}。${detail}`;
  gpsInfo.innerHTML = `GPS：エラー<br>${errorText}<br>${detail}<br>HTTPS：${window.isSecureContext ? "有効" : "無効"}`;
  alert(`${errorText}
${detail}`);
  if (stopWatcher && watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (stopWatcher) watchId = null;
  trackingButton.disabled = false;
  trackingButton.textContent = "📍 現在地追跡を開始";
}

function routePayload() {
  if (!startPoint || !goalPoint) return null;
  const compact = (point) => [Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6))];
  return {
    v: 1,
    s: compact(startPoint),
    g: compact(goalPoint),
    w: waypoints.map((item) => compact(item.point))
  };
}

function encodePayload(payload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePayload(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function buildShareUrl() {
  const payload = routePayload();
  if (!payload) throw new Error("先にルートを作成してください");
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = `${ROUTE_PARAM}=${encodePayload(payload)}`;
  return url.toString();
}

shareButton.addEventListener("click", async () => {
  try {
    const url = buildShareUrl();
    const shareData = {
      title: "Ride Navi 共有ルート",
      text: "ツーリングルートを共有します",
      url
    };
    if (navigator.share) {
      await navigator.share(shareData);
      message.textContent = "共有画面を開きました";
    } else {
      await copyText(url);
      alert("共有URLをコピーしました。LINEなどへ貼り付けてください");
      message.textContent = "共有URLをコピーしました";
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    alert(error.message || "共有できませんでした");
  }
});

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("URLをコピーできませんでした");
}

saveButton.addEventListener("click", () => {
  const payload = routePayload();
  if (!payload) return alert("先にルートを作成してください");
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    message.textContent = "この端末にルートを保存しました";
    alert("ルートをこの端末に保存しました");
  } catch (error) {
    console.error(error);
    alert("ルートを保存できませんでした");
  }
});

loadButton.addEventListener("click", async () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return alert("この端末に保存されたルートはありません");
    await applyPayload(JSON.parse(raw));
    message.textContent = "保存ルートを開きました";
  } catch (error) {
    console.error(error);
    alert("保存ルートを読み込めませんでした");
  }
});

async function applyPayload(payload) {
  if (!payload || !Array.isArray(payload.s) || !Array.isArray(payload.g)) {
    throw new Error("共有ルートの形式が正しくありません");
  }
  clearRoute(false);
  setStart(L.latLng(payload.s[0], payload.s[1]));
  setGoal(L.latLng(payload.g[0], payload.g[1]));
  for (const point of payload.w || []) addWaypoint(L.latLng(point[0], point[1]));
  await calculateRoute();
  if (routeLine) map.fitBounds(routeLine.getBounds(), { padding: [45, 45] });
}

async function loadRouteFromHash() {
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith(`${ROUTE_PARAM}=`)) return;
  try {
    const encoded = hash.slice(ROUTE_PARAM.length + 1);
    await applyPayload(decodePayload(encoded));
    message.textContent = "共有されたルートを開きました";
  } catch (error) {
    console.error(error);
    alert("共有ルートを開けませんでした。URLが途中で切れていないか確認してください");
  }
}

function resetNavigationProgress() {
  waypoints.forEach((item) => { item.passed = false; });
  navigationSteps.forEach((step) => {
    step.announced300 = false;
    step.announced100 = false;
    step.passed = false;
  });
  arrivalSpoken = false;
  offRouteSpoken = false;
  lastOffRouteAt = 0;
  navStatus.classList.remove("off-route");
}

function clearRoute(clearHash = true) {
  setAddWaypointMode(false);
  for (const layer of [startMarker, goalMarker, routeLine, ...waypoints.map((w) => w.marker)]) {
    if (layer) map.removeLayer(layer);
  }
  startPoint = null;
  goalPoint = null;
  startMarker = null;
  goalMarker = null;
  routeLine = null;
  currentRoute = null;
  navigationSteps = [];
  routeCoordinates = [];
  waypoints = [];
  routeRequestSerial++;
  arrivalSpoken = false;
  renderWaypoints();
  routeInfo.innerHTML = "距離：未設定<br>時間：未設定<br>到着予想：未設定";
  if (clearHash && window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
}

resetButton.addEventListener("click", () => {
  clearRoute(true);
  message.textContent = "地図をクリックして出発地を選んでください";
  navStatus.textContent = navigationMode ? "ナビモード ON" : "ナビモード OFF";
});

renderWaypoints();
loadRouteFromHash();
