(() => {
  "use strict";

  const DEFAULT_CENTER = { lat: 35.0116, lng: 135.7681 };
  const MAX_WAYPOINTS = 5;

  const config = window.RIDE_NAVI_CONFIG || {};
  const apiKey = String(config.GOOGLE_MAPS_API_KEY || "").trim();

  const $ = (id) => document.getElementById(id);

  const statusEl = $("status");
  const controlPanel = $("controlPanel");
  const menuButton = $("menuButton");
  const closePanelButton = $("closePanelButton");
  const originInput = $("originInput");
  const destinationInput = $("destinationInput");
  const useCurrentLocationButton = $("useCurrentLocationButton");
  const addWaypointButton = $("addWaypointButton");
  const waypointList = $("waypointList");
  const waypointCount = $("waypointCount");
  const routeButton = $("routeButton");
  let shareRouteButton = null;
  let navigationButton = null;
  let navigationActive = false;
  let lastRouteResult = null;
  let navigationSteps = [];
  let currentNavigationStepIndex = 0;
  let announced300m = false;
  let announced80m = false;
  let routePathPoints = [];
  let offRouteCount = 0;
  let rerouteInProgress = false;
  let lastRerouteTime = 0;
  let headingUpEnabled = false;
  let headingButton = null;
  let lastKnownHeading = null;
  let navigationInfoPanel = null;
  let navigationDistanceValue = null;
  let navigationEtaValue = null;
  let navigationDurationValue = null;

  const OFF_ROUTE_DISTANCE_METERS = 80;
  const OFF_ROUTE_REQUIRED_COUNT = 2;
  const REROUTE_COOLDOWN_MS = 20000;
  const clearRouteButton = $("clearRouteButton");
  const locationButton = $("locationButton");
  const floatingLocationButton = $("floatingLocationButton");
  const followToggle = $("followToggle");
  const trafficToggle = $("trafficToggle");
  const voiceTestButton = $("voiceTestButton");
  const routeInfo = $("routeInfo");
  const gpsInfo = $("gpsInfo");

  let map = null;
  let directionsService = null;
  let directionsRenderer = null;
  let trafficLayer = null;
  let currentPosition = null;
  let userMarker = null;
  let destinationMarker = null;
  let accuracyCircle = null;
  let statusTimer = null;
  let routeSearching = false;
  let routeChoicePanel = null;
  let selectedRouteIndex = 0;
  let routeCandidates = [];
  let selectedRouteMode = "highway";
  let routePolylines = [];
  let routeLabelMarkers = [];

  function showStatus(message, autoHide = false) {
    if (!statusEl) return;

    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }

    statusEl.hidden = false;
    statusEl.textContent = message;

    if (autoHide) {
      statusTimer = setTimeout(() => {
        statusEl.hidden = true;
      }, 2600);
    }
  }

  function hideRouteChoices() {
    if (routeChoicePanel) {
      routeChoicePanel.remove();
      routeChoicePanel = null;
    }
  }


  function clearRouteOverlays() {
    routePolylines.forEach((polyline) => polyline.setMap(null));
    routePolylines = [];

    routeLabelMarkers.forEach((marker) => marker.setMap(null));
    routeLabelMarkers = [];
  }

  function routeMidpoint(route) {
    const path = route?.overview_path || [];
    if (!path.length) return null;
    return path[Math.floor(path.length / 2)];
  }

  function drawRouteOverlays() {
    clearRouteOverlays();

    routeCandidates.forEach((candidate, index) => {
      const route = candidate.result.routes[candidate.routeIndex];
      const isSelected = index === selectedRouteIndex;

      const polyline = new google.maps.Polyline({
        map,
        path: route.overview_path,
        strokeColor: isSelected ? "#1a73e8" : "#6f8fcf",
        strokeOpacity: isSelected ? 1 : 0.7,
        strokeWeight: isSelected ? 8 : 5,
        zIndex: isSelected ? 50 : 20 + index,
        clickable: true
      });

      polyline.addListener("click", () => {
        applyRouteCandidate(index);
      });

      routePolylines.push(polyline);

      const midpoint = routeMidpoint(route);
      if (!midpoint) return;

      const totals = sumRouteTotals(route);
      const marker = new google.maps.Marker({
        map,
        position: midpoint,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0
        },
        label: {
          text: `${formatDuration(totals.totalDuration)}・${formatDistance(totals.totalDistance)}`,
          color: isSelected ? "#174ea6" : "#4d5156",
          fontSize: isSelected ? "14px" : "12px",
          fontWeight: "700"
        },
        zIndex: isSelected ? 70 : 40 + index,
        clickable: true
      });

      marker.addListener("click", () => {
        applyRouteCandidate(index);
      });

      routeLabelMarkers.push(marker);
    });
  }

  function routeModeLabel(mode) {
    const labels = {
      highway: "🚀 高速優先",
      partial: "🛣️ 一部高速候補",
      local: "🌿 一般道"
    };
    return labels[mode] || "ルート";
  }

  function routeModeDescription(mode) {
    const descriptions = {
      highway: "高速・有料道路を利用できる最短時間寄り",
      partial: "有料道路を避けつつ、高規格道路を使う候補",
      local: "高速道路と有料道路を避ける"
    };
    return descriptions[mode] || "";
  }

  function routeSignature(route) {
    const totals = sumRouteTotals(route);
    return [
      route.summary || "",
      Math.round(totals.totalDistance / 500),
      Math.round(totals.totalDuration / 300)
    ].join("|");
  }

  function makeSingleRouteResult(result, routeIndex) {
    return {
      ...result,
      routes: [result.routes[routeIndex]]
    };
  }

  function applyRouteCandidate(candidateIndex, announce = true) {
    const candidate = routeCandidates[candidateIndex];
    if (!candidate) return;

    selectedRouteIndex = candidateIndex;
    selectedRouteMode = candidate.mode;

    directionsRenderer.setOptions({
      polylineOptions: {
        strokeOpacity: 0,
        strokeWeight: 0
      }
    });
    directionsRenderer.setDirections(candidate.result);
    directionsRenderer.setRouteIndex(candidate.routeIndex);

    const singleResult = makeSingleRouteResult(
      candidate.result,
      candidate.routeIndex
    );

    lastRouteResult = singleResult;
    buildNavigationSteps(singleResult);
    updateRoutePath(singleResult);

    const route = singleResult.routes[0];
    const totals = sumRouteTotals(route);
    updateNavigationInfoPanel(route);

    if (navigationButton) {
      navigationButton.disabled = navigationSteps.length === 0;
    }

    routeInfo.innerHTML =
      `種類：${routeModeLabel(candidate.mode)}<br>` +
      `距離：${formatDistance(totals.totalDistance)}<br>` +
      `時間：${formatDuration(totals.totalDuration)}<br>` +
      `経由地：${getWaypointValues().length}か所`;

    if (routeChoicePanel) {
      routeChoicePanel
        .querySelectorAll(".route-choice-card")
        .forEach((card, index) => {
          card.classList.toggle("is-selected", index === candidateIndex);
          card.setAttribute(
            "aria-pressed",
            index === candidateIndex ? "true" : "false"
          );
        });
    }

    drawRouteOverlays();

    if (announce) {
      showStatus(`${routeModeLabel(candidate.mode)}を選びました`, true);
    }
  }

function showRouteChoices(candidates) {
  hideRouteChoices();

  routeCandidates = candidates;
  selectedRouteIndex = 0;

  applyRouteCandidate(0, false);
}


  function openPanel() {
    controlPanel?.classList.remove("is-hidden");
  }

  function closePanel() {
    controlPanel?.classList.add("is-hidden");
  }

  function updateWaypointDisplay() {
    const rows = [...waypointList.querySelectorAll(".waypoint-row")];

    rows.forEach((row, index) => {
      const number = row.querySelector(".waypoint-number");
      const input = row.querySelector(".waypoint-input");

      if (number) number.textContent = String(index + 1);
      if (input) input.placeholder = `経由地${index + 1}　例：道の駅`;
    });

    waypointCount.textContent = `${rows.length} / ${MAX_WAYPOINTS}`;
    addWaypointButton.disabled = rows.length >= MAX_WAYPOINTS;
  }

  function addWaypoint(value = "") {
    const count = waypointList.querySelectorAll(".waypoint-row").length;

    if (count >= MAX_WAYPOINTS) {
      showStatus(`経由地は${MAX_WAYPOINTS}か所までです`);
      return;
    }

    const row = document.createElement("div");
    row.className = "waypoint-row";

    const number = document.createElement("span");
    number.className = "waypoint-number";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "waypoint-input";
    input.autocomplete = "off";
    input.value = value;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "waypoint-remove";
    removeButton.textContent = "✕";
    removeButton.setAttribute("aria-label", "経由地を削除");

    removeButton.addEventListener("click", () => {
      row.remove();
      updateWaypointDisplay();
      updateRouteInfoEmpty();
      showStatus("経由地を削除しました", true);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        searchRoute();
      }
    });

    row.append(number, input, removeButton);
    waypointList.appendChild(row);

    updateWaypointDisplay();
    updateRouteInfoEmpty();
    input.focus();
    showStatus("経由地を追加しました", true);
  }

  function getWaypointValues() {
    return [...waypointList.querySelectorAll(".waypoint-input")]
      .map((input) => input.value.trim())
      .filter(Boolean);
  }

  function updateRouteInfoEmpty() {
    routeInfo.innerHTML =
      `距離：未設定<br>` +
      `時間：未設定<br>` +
      `経由地：${getWaypointValues().length}か所`;
  }

  function clearDisplayedRoute(showMessage = true) {
    if (navigationActive) stopNavigation();
    lastRouteResult = null;
    navigationSteps = [];
    currentNavigationStepIndex = 0;
    announced300m = false;
    announced80m = false;
    routePathPoints = [];
    offRouteCount = 0;
    rerouteInProgress = false;
    hideRouteChoices();
    clearRouteOverlays();
    routeCandidates = [];
    selectedRouteIndex = 0;
    hideNavigationInfoPanel();
    if (navigationButton) navigationButton.disabled = true;
    if (directionsRenderer) {
      directionsRenderer.setDirections({ routes: [] });
    }

    updateRouteInfoEmpty();

    if (showMessage) {
      showStatus("ルートを消去しました", true);
    }
  
 }
  function getCurrentLatLng() {
    if (!currentPosition) return null;

    return {
      lat: currentPosition.coords.latitude,
      lng: currentPosition.coords.longitude
    };
  }

  function updateGps(position) {
    currentPosition = position;

    const point = getCurrentLatLng();
    const accuracy = Math.round(position.coords.accuracy || 0);

    if (
      Number.isFinite(position.coords.heading) &&
      position.coords.heading >= 0
    ) {
      lastKnownHeading = position.coords.heading;
    }

    if (!userMarker) {
      userMarker = new google.maps.Marker({
        map,
        position: point,
        title: "現在地",
        zIndex: 1000
      });

      accuracyCircle = new google.maps.Circle({
        map,
        center: point,
        radius: accuracy,
        fillColor: "#1a73e8",
        fillOpacity: 0.12,
        strokeColor: "#1a73e8",
        strokeOpacity: 0.35,
        strokeWeight: 1
      });
    } else {
      userMarker.setPosition(point);
      accuracyCircle.setCenter(point);
      accuracyCircle.setRadius(accuracy);
    }

    if (followToggle.checked) {
      map.panTo(point);
    }

    if (headingUpEnabled && Number.isFinite(lastKnownHeading)) {
      map.setHeading(lastKnownHeading);
    }

    if (navigationActive) {
      updateVoiceNavigation(point);
      checkAutomaticReroute(point, accuracy);
    }

    gpsInfo.innerHTML =
      `GPS：取得中<br>` +
      `精度：約 ${accuracy} m<br>` +
      `緯度：${point.lat.toFixed(6)}<br>` +
      `経度：${point.lng.toFixed(6)}`;
  }

  function gpsError(error) {
    const messages = {
      1: "位置情報の利用が許可されていません",
      2: "現在地を取得できません",
      3: "現在地の取得がタイムアウトしました"
    };

    const message = messages[error.code] || "GPSエラーが発生しました";
    gpsInfo.innerHTML = `GPS：エラー<br>${message}`;
    showStatus(message);
  }

  function startGps() {
    if (!navigator.geolocation) {
      showStatus("このブラウザはGPSに対応していません");
      return;
    }

    navigator.geolocation.watchPosition(
      updateGps,
      gpsError,
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000
      }
    );
  }

  function useCurrentLocationAsOrigin() {
    if (!getCurrentLatLng()) {
      showStatus("現在地をまだ取得できていません");
      return;
    }

    originInput.value = "現在地";
    showStatus("現在地を出発地にしました", true);
  }

  function centerOnCurrentLocation() {
    const point = getCurrentLatLng();

    if (!map || !point) {
      showStatus("現在地を取得しています");
      return;
    }

    map.panTo(point);
    map.setZoom(16);
  }

  function toggleTrafficLayer() {
    if (!trafficLayer || !map) return;

    trafficLayer.setMap(trafficToggle.checked ? map : null);

    showStatus(
      trafficToggle.checked
        ? "渋滞情報を表示しました"
        : "渋滞情報を隠しました",
      true
    );
  }

  function voiceTest() {
    if (!("speechSynthesis" in window)) {
      showStatus("このブラウザは音声読み上げに対応していません");
      return;
    }

    speechSynthesis.cancel();

    const speech = new SpeechSynthesisUtterance(
      "ライドナビ、音声案内テストです。安全運転で走行してください。"
    );

    speech.lang = "ja-JP";
    speechSynthesis.speak(speech);
    showStatus("音声テストを再生しました", true);
  }

  function sumRouteTotals(route) {
    let totalDistance = 0;
    let totalDuration = 0;

    route.legs.forEach((leg) => {
      totalDistance += leg.distance?.value || 0;
      totalDuration += leg.duration_in_traffic?.value || leg.duration?.value || 0;
    });

    return { totalDistance, totalDuration };
  }

  function formatDistance(meters) {
    return meters >= 1000
      ? `${(meters / 1000).toFixed(1)} km`
      : `${Math.round(meters)} m`;
  }

  function formatDuration(seconds) {
    const totalMinutes = Math.max(1, Math.round(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) return `${minutes}分`;
    if (minutes === 0) return `${hours}時間`;
    return `${hours}時間${minutes}分`;
  }

  function routeErrorMessage(status) {
    const messages = {
      ZERO_RESULTS: "指定した場所を通るルートが見つかりませんでした",
      NOT_FOUND: "入力した場所の一部が見つかりませんでした",
      MAX_WAYPOINTS_EXCEEDED: "経由地が多すぎます",
      OVER_QUERY_LIMIT: "Googleマップの利用上限に達しました",
      REQUEST_DENIED: "ルート検索が拒否されました。Directions API設定を確認してください",
      INVALID_REQUEST: "出発地・経由地・目的地を確認してください",
      UNKNOWN_ERROR: "一時的なエラーです。もう一度お試しください"
    };

    return messages[status] || `ルート検索に失敗しました（${status}）`;
  }

  function stripHtmlInstruction(html) {
    const temporary = document.createElement("div");
    temporary.innerHTML = html || "";
    return temporary.textContent
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeInstruction(instruction) {
    return instruction
      .replace(/右方向へ進む/g, "右方向です")
      .replace(/左方向へ進む/g, "左方向です")
      .replace(/右折する/g, "右折です")
      .replace(/左折する/g, "左折です")
      .replace(/直進する/g, "直進です")
      .replace(/目的地は/g, "目的地は")
      .trim();
  }

  function buildNavigationSteps(result) {
    const steps = [];

    result.routes[0].legs.forEach((leg, legIndex) => {
      leg.steps.forEach((step) => {
        const instruction = normalizeInstruction(
          stripHtmlInstruction(step.instructions)
        );

        if (!instruction || !step.end_location) return;

        steps.push({
          instruction,
          endLocation: {
            lat: step.end_location.lat(),
            lng: step.end_location.lng()
          },
          distanceMeters: step.distance?.value || 0,
          legIndex
        });
      });
    });

    navigationSteps = steps;
    currentNavigationStepIndex = 0;
    announced300m = false;
    announced80m = false;
  }

  function distanceBetweenMeters(a, b) {
    const earthRadius = 6371000;
    const toRadians = (degrees) => degrees * Math.PI / 180;

    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const deltaLat = toRadians(b.lat - a.lat);
    const deltaLng = toRadians(b.lng - a.lng);

    const value =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(deltaLng / 2) ** 2;

    return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function navigationDistanceText(distance) {
    if (distance >= 1000) {
      return `${(distance / 1000).toFixed(1)}キロメートル先`;
    }

    const rounded = Math.max(10, Math.round(distance / 10) * 10);
    return `${rounded}メートル先`;
  }

  function updateVoiceNavigation(point) {
    if (!navigationActive || !navigationSteps.length) return;

    const step = navigationSteps[currentNavigationStepIndex];
    if (!step) {
      speakNavigation("目的地周辺です。お疲れさまでした。");
      stopNavigation(false);
      return;
    }

    const distance = distanceBetweenMeters(point, step.endLocation);

    if (distance <= 35) {
      currentNavigationStepIndex += 1;
      announced300m = false;
      announced80m = false;

      const nextStep = navigationSteps[currentNavigationStepIndex];
      if (!nextStep) {
        speakNavigation("目的地周辺です。お疲れさまでした。");
        stopNavigation(false);
        return;
      }

      showStatus(`次の案内：${nextStep.instruction}`, true);
      return;
    }

    if (distance <= 80 && !announced80m) {
      announced80m = true;
      speakNavigation(`まもなく、${step.instruction}`);
      showStatus(`まもなく：${step.instruction}`, true);
      return;
    }

    if (distance <= 300 && !announced300m) {
      announced300m = true;
      speakNavigation(`${navigationDistanceText(distance)}、${step.instruction}`);
      showStatus(`${navigationDistanceText(distance)}：${step.instruction}`, true);
    }
  }

  function updateRoutePath(result) {
    const overviewPath = result?.routes?.[0]?.overview_path || [];

    routePathPoints = overviewPath.map((point) => ({
      lat: point.lat(),
      lng: point.lng()
    }));

    offRouteCount = 0;
  }

  function distancePointToSegmentMeters(point, segmentStart, segmentEnd) {
    const earthRadius = 6371000;
    const meanLatitude =
      ((point.lat + segmentStart.lat + segmentEnd.lat) / 3) * Math.PI / 180;

    const toXY = (coordinate) => ({
      x: coordinate.lng * Math.PI / 180 * earthRadius * Math.cos(meanLatitude),
      y: coordinate.lat * Math.PI / 180 * earthRadius
    });

    const p = toXY(point);
    const a = toXY(segmentStart);
    const b = toXY(segmentEnd);
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lengthSquared = abX * abX + abY * abY;

    if (lengthSquared === 0) {
      return Math.hypot(p.x - a.x, p.y - a.y);
    }

    const projection = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * abX + (p.y - a.y) * abY) / lengthSquared
      )
    );

    const nearestX = a.x + projection * abX;
    const nearestY = a.y + projection * abY;

    return Math.hypot(p.x - nearestX, p.y - nearestY);
  }

  function distanceFromRouteMeters(point) {
    if (routePathPoints.length < 2) return Infinity;

    let minimumDistance = Infinity;

    for (let index = 0; index < routePathPoints.length - 1; index += 1) {
      const distance = distancePointToSegmentMeters(
        point,
        routePathPoints[index],
        routePathPoints[index + 1]
      );

      if (distance < minimumDistance) {
        minimumDistance = distance;
      }
    }

    return minimumDistance;
  }

  function currentLegIndex() {
    return navigationSteps[currentNavigationStepIndex]?.legIndex || 0;
  }

  function remainingWaypointValues() {
    const allWaypoints = getWaypointValues();
    return allWaypoints.slice(currentLegIndex());
  }

  function checkAutomaticReroute(point, accuracy) {
    if (
      !navigationActive ||
      rerouteInProgress ||
      routeSearching ||
      routePathPoints.length < 2
    ) {
      return;
    }

    if (accuracy > 50) {
      offRouteCount = 0;
      return;
    }

    const distance = distanceFromRouteMeters(point);

    if (distance <= OFF_ROUTE_DISTANCE_METERS) {
      offRouteCount = 0;
      return;
    }

    offRouteCount += 1;

    if (offRouteCount < OFF_ROUTE_REQUIRED_COUNT) {
      return;
    }

    const now = Date.now();

    if (now - lastRerouteTime < REROUTE_COOLDOWN_MS) {
      return;
    }

    offRouteCount = 0;
    rerouteFromCurrentLocation(point);
  }

  function rerouteFromCurrentLocation(point) {
    if (!directionsService || rerouteInProgress) return;

    const destination = destinationInput.value.trim();

    if (!destination) {
      showStatus("目的地がないため再検索できません");
      return;
    }

    const remainingWaypoints = remainingWaypointValues().map((location) => ({
      location,
      stopover: true
    }));

    const request = {
      origin: point,
      destination,
      waypoints: remainingWaypoints,
      optimizeWaypoints: false,
      travelMode: google.maps.TravelMode.DRIVING,
      drivingOptions: {
        departureTime: new Date(),
        trafficModel: google.maps.TrafficModel.BEST_GUESS
      },
      unitSystem: google.maps.UnitSystem.METRIC,
      avoidHighways: selectedRouteMode === "local",
      avoidTolls: selectedRouteMode !== "highway",
      region: "JP"
    };

    rerouteInProgress = true;
    lastRerouteTime = Date.now();
    showStatus("🔄 新しいルートを探しています…");
    speakNavigation("新しいルートを検索します。");

    directionsService.route(request, (result, status) => {
      rerouteInProgress = false;

      if (status !== "OK" || !result?.routes?.length) {
        console.error("Automatic reroute error:", status, result);
        showStatus("自動リルートに失敗しました");
        return;
      }

      clearRouteOverlays();
      directionsRenderer.setOptions({
        polylineOptions: {
          strokeColor: "#1a73e8",
          strokeOpacity: 0.95,
          strokeWeight: 7
        }
      });
      directionsRenderer.setDirections(result);
      lastRouteResult = result;
      buildNavigationSteps(result);
      updateRoutePath(result);

      const route = result.routes[0];
      const totals = sumRouteTotals(route);
      updateNavigationInfoPanel(route);

      routeInfo.innerHTML =
        `距離：${formatDistance(totals.totalDistance)}<br>` +
        `時間：${formatDuration(totals.totalDuration)}<br>` +
        `残り経由地：${remainingWaypoints.length}か所`;

      showStatus("新しいルートに切り替えました", true);
      speakNavigation("新しいルートに切り替えました。");
    });
  }

  function createNavigationButton() {
    if (!routeButton || navigationButton) return;

    navigationButton = document.createElement("button");
    navigationButton.id = "navigationButton";
    navigationButton.type = "button";
    navigationButton.className = "primary";
    navigationButton.textContent = "▶ ナビ開始";
    hideNavigationInfoPanel();
    navigationButton.disabled = true;

    routeButton.insertAdjacentElement("afterend", navigationButton);
    navigationButton.addEventListener("click", toggleNavigation);
  }

  function speakNavigation(message) {
    if (!("speechSynthesis" in window)) return;

    speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(message);
    speech.lang = "ja-JP";
    speech.rate = 1;
    speechSynthesis.speak(speech);
  }

  function startNavigation() {
    if (!lastRouteResult?.routes?.length) {
      showStatus("先にルートを表示してください");
      return;
    }

    const point = getCurrentLatLng();
    if (!point) {
      showStatus("現在地を取得してからナビを開始してください");
      return;
    }

    if (!navigationSteps.length) {
      showStatus("音声案内データを準備できませんでした");
      return;
    }

    currentNavigationStepIndex = 0;
    announced300m = false;
    announced80m = false;
    offRouteCount = 0;
    rerouteInProgress = false;
    navigationActive = true;
    navigationButton.textContent = "■ ナビ終了";
    if (lastRouteResult?.routes?.[0]) {
      updateNavigationInfoPanel(lastRouteResult.routes[0]);
    }
    showNavigationInfoPanel();
    followToggle.checked = true;
    map.panTo(point);
    closePanel();

    const firstInstruction = navigationSteps[0]?.instruction;
    showStatus(
      firstInstruction ? `ナビ開始：${firstInstruction}` : "ナビを開始しました",
      true
    );
    speakNavigation(
      firstInstruction
        ? `ナビを開始します。最初の案内は、${firstInstruction}`
        : "ナビを開始します。安全運転で走行してください。"
    );
  }

  function stopNavigation(speak = true) {
    navigationActive = false;
    offRouteCount = 0;
    rerouteInProgress = false;
    navigationButton.textContent = "▶ ナビ開始";

    showStatus("ナビを終了しました", true);
    if (speak) speakNavigation("ナビを終了しました。");
  }

  function toggleNavigation() {
    navigationActive ? stopNavigation() : startNavigation();
  }

  function createShareButton() {
    if (!routeButton || shareRouteButton) return;

    shareRouteButton = document.createElement("button");
    shareRouteButton.id = "shareRouteButton";
    shareRouteButton.type = "button";
    shareRouteButton.className = "secondary";
    shareRouteButton.textContent = "🔗 ルートURLを共有";

    routeButton.insertAdjacentElement("afterend", shareRouteButton);
    shareRouteButton.addEventListener("click", shareRouteUrl);
  }

  function buildShareUrl() {
    const originText = originInput.value.trim();
    const destinationText = destinationInput.value.trim();
    const waypoints = getWaypointValues();

    if (!originText || !destinationText) {
      throw new Error("出発地と目的地を入力してください");
    }

    let sharedOrigin = originText;

    if (originText === "現在地") {
      const point = getCurrentLatLng();

      if (!point) {
        throw new Error("現在地を取得してから共有してください");
      }

      sharedOrigin = `${point.lat},${point.lng}`;
    }

    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";

    url.searchParams.set("o", sharedOrigin);
    url.searchParams.set("d", destinationText);
    url.searchParams.set("mode", selectedRouteMode);

    waypoints.forEach((waypoint) => {
      url.searchParams.append("w", waypoint);
    });

    url.searchParams.set("shared", "1");
    return url.toString();
  }

  async function shareRouteUrl() {
    try {
      const shareUrl = buildShareUrl();

      if (navigator.share) {
        await navigator.share({
          title: "Ride Navi ルート",
          text: "Ride Naviで作成したツーリングルートです。",
          url: shareUrl
        });
        showStatus("共有画面を開きました", true);
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        showStatus("ルートURLをコピーしました", true);
        return;
      }

      window.prompt("このURLをコピーしてください", shareUrl);
    } catch (error) {
      if (error?.name === "AbortError") return;
      showStatus(error?.message || "URLを共有できませんでした");
    }
  }

  function loadRouteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const origin = params.get("o");
    const destination = params.get("d");
    const waypoints = params.getAll("w").slice(0, MAX_WAYPOINTS);
    const mode = params.get("mode");

    if (!origin || !destination) return false;

    originInput.value = origin;
    destinationInput.value = destination;
    if (mode && ["highway", "partial", "local"].includes(mode)) {
      selectedRouteMode = mode;
    }
    waypointList.innerHTML = "";

    waypoints.forEach((waypoint) => addWaypoint(waypoint));

    updateWaypointDisplay();
    updateRouteInfoEmpty();
    openPanel();
    showStatus("共有されたルートを読み込みました", true);
    return true;
  }

  function routeRequest(origin, destination, waypoints, mode) {
    const hasWaypoints = waypoints.length > 0;

    return {
      origin,
      destination,
      waypoints,
      optimizeWaypoints: false,
      travelMode: google.maps.TravelMode.DRIVING,
      drivingOptions: {
        departureTime: new Date(),
        trafficModel: google.maps.TrafficModel.BEST_GUESS
      },
      unitSystem: google.maps.UnitSystem.METRIC,
      avoidHighways: mode === "local",
      avoidTolls: mode !== "highway",
      provideRouteAlternatives: !hasWaypoints,
      region: "JP"
    };
  }

  function directionsPromise(request) {
    return new Promise((resolve) => {
      directionsService.route(request, (result, status) => {
        resolve({ result, status });
      });
    });
  }

  async function searchRoute() {
    if (!map || !directionsService || !directionsRenderer) {
      showStatus("ルート機能を読み込み中です");
      return;
    }

    if (routeSearching) return;

    const originText = originInput.value.trim();
    const destinationText = destinationInput.value.trim();
    const waypointValues = getWaypointValues();

    if (!originText || !destinationText) {
      showStatus("出発地と目的地を入力してください");
      return;
    }

    let origin = originText;

    if (originText === "現在地") {
      origin = getCurrentLatLng();

      if (!origin) {
        showStatus("現在地をまだ取得できていません");
        return;
      }
    }

    const waypoints = waypointValues.map((location) => ({
      location,
      stopover: true
    }));

    routeSearching = true;
    routeButton.disabled = true;
    routeButton.textContent = "3種類を検索中…";
    showStatus("高速・一部高速・一般道を比較しています…");
    hideRouteChoices();

    try {
      const modes = ["highway", "partial", "local"];
      const responses = await Promise.all(
        modes.map(async (mode) => ({
          mode,
          response: await directionsPromise(
            routeRequest(origin, destinationText, waypoints, mode)
          )
        }))
      );

      const candidates = [];
      const seen = new Set();

      responses.forEach(({ mode, response }) => {
        const { result, status } = response;
        if (status !== "OK" || !result?.routes?.length) return;

        const routeLimit = waypoints.length ? 1 : Math.min(2, result.routes.length);

        for (let routeIndex = 0; routeIndex < routeLimit; routeIndex += 1) {
          const route = result.routes[routeIndex];
          const signature = routeSignature(route);
          if (seen.has(signature)) continue;

          seen.add(signature);
          candidates.push({ mode, result, routeIndex });
        }
      });

      if (!candidates.length) {
        const firstError = responses.find(
          ({ response }) => response.status !== "OK"
        )?.response.status;
        showStatus(routeErrorMessage(firstError || "ZERO_RESULTS"));
        return;
      }

      const preferredMode =
        document.getElementById("routeMode")?.value || "highway";
      const baseOrder = ["highway", "partial", "local"];
      const orderedModes = [
        preferredMode,
        ...baseOrder.filter((mode) => mode !== preferredMode)
      ];
      const modeOrder = Object.fromEntries(
        orderedModes.map((mode, index) => [mode, index])
      );
      candidates.sort((a, b) => {
        const modeDifference = modeOrder[a.mode] - modeOrder[b.mode];
        if (modeDifference !== 0) return modeDifference;

        const aTotals = sumRouteTotals(a.result.routes[a.routeIndex]);
        const bTotals = sumRouteTotals(b.result.routes[b.routeIndex]);
        return aTotals.totalDuration - bTotals.totalDuration;
      });

      showRouteChoices(candidates);
      closePanel();
      showStatus(`${candidates.length}件のルート候補が見つかりました`, true);
    } catch (error) {
      console.error("Directions route error:", error);
      showStatus("ルート候補の検索に失敗しました");
    } finally {
      routeSearching = false;
      routeButton.disabled = false;
      routeButton.textContent = "🧭 3種類のルートを比較";
    }
  }

  function createNavigationInfoPanel() {
    if (document.getElementById("rideNaviInfoPanel")) return;

    const style = document.createElement("style");
    style.textContent = `
      #rideNaviInfoPanel {
        position: fixed;
        left: max(12px, env(safe-area-inset-left));
        bottom: calc(18px + env(safe-area-inset-bottom));
        z-index: 1000;
        display: none;
        width: 190px;
        padding: 0;
        background: transparent;
        border: 0;
        box-shadow: none;
        color: #000000;
        pointer-events: none;
      }

      #rideNaviInfoPanel.visible {
        display: block;
      }

      .rideNaviInfoItem {
        display: flex;
        align-items: center;
        min-height: 46px;
        padding: 0;
        background: transparent;
      }

      .rideNaviInfoLabel {
        display: none;
      }

      .rideNaviInfoValue {
        display: block;
        font-size: 27px;
        font-weight: 800;
        line-height: 1.05;
        white-space: nowrap;
        color: #000000;
        text-shadow:
          -2px -2px 0 rgba(255, 255, 255, 0.96),
           2px -2px 0 rgba(255, 255, 255, 0.96),
          -2px  2px 0 rgba(255, 255, 255, 0.96),
           2px  2px 0 rgba(255, 255, 255, 0.96),
           0    2px 4px rgba(255, 255, 255, 0.90);
      }

      .rideNaviInfoItem:nth-child(1) .rideNaviInfoValue::before {
        content: "📍";
        margin-right: 7px;
      }

      .rideNaviInfoItem:nth-child(2) .rideNaviInfoValue::before {
        content: "⏱";
        margin-right: 7px;
      }

      .rideNaviInfoItem:nth-child(3) .rideNaviInfoValue::before {
        content: "🕒";
        margin-right: 7px;
      }

      @media (max-width: 380px) {
        #rideNaviInfoPanel {
          left: max(8px, env(safe-area-inset-left));
          bottom: calc(14px + env(safe-area-inset-bottom));
          width: 170px;
        }

        .rideNaviInfoItem {
          min-height: 42px;
        }

        .rideNaviInfoValue {
          font-size: 24px;
        }
      }
    `;
    document.head.appendChild(style);

    navigationInfoPanel = document.createElement("div");
    navigationInfoPanel.id = "rideNaviInfoPanel";
    navigationInfoPanel.setAttribute("aria-label", "ナビ情報");

    const createItem = (label) => {
      const item = document.createElement("div");
      item.className = "rideNaviInfoItem";

      const labelElement = document.createElement("span");
      labelElement.className = "rideNaviInfoLabel";
      labelElement.textContent = label;

      const valueElement = document.createElement("strong");
      valueElement.className = "rideNaviInfoValue";
      valueElement.textContent = "―";

      item.append(labelElement, valueElement);
      navigationInfoPanel.appendChild(item);
      return valueElement;
    };

    navigationDistanceValue = createItem("残り距離");
    navigationEtaValue = createItem("到着予定");
    navigationDurationValue = createItem("残り時間");

    document.body.appendChild(navigationInfoPanel);
  }

  function formatEta(durationSeconds) {
    const arrival = new Date(Date.now() + durationSeconds * 1000);
    return arrival.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function updateNavigationInfoPanel(route) {
    if (!navigationInfoPanel || !route?.legs?.length) return;

    let totalDistance = 0;
    let totalDuration = 0;

    route.legs.forEach((leg) => {
      totalDistance += leg.distance?.value || 0;
      totalDuration +=
        leg.duration_in_traffic?.value ||
        leg.duration?.value ||
        0;
    });

    navigationDistanceValue.textContent = formatDistance(totalDistance);
    navigationEtaValue.textContent = formatEta(totalDuration);
    navigationDurationValue.textContent = formatDuration(totalDuration);
  }

  function showNavigationInfoPanel() {
    if (navigationInfoPanel) {
      navigationInfoPanel.classList.add("visible");
    }
  }

  function hideNavigationInfoPanel() {
    if (navigationInfoPanel) {
      navigationInfoPanel.classList.remove("visible");
    }
  }

  function createZoomButtons() {
    if (document.getElementById("rideNaviZoomControls")) return;

    const style = document.createElement("style");
    style.textContent = `
      #rideNaviZoomControls {
        position: fixed;
        right: 74px;
        bottom: calc(18px + env(safe-area-inset-bottom));
        z-index: 1000;
        display: flex;
        gap: 8px;
        align-items: center;
      }

      #rideNaviZoomControls button {
        width: 46px;
        height: 46px;
        border: 1px solid rgba(0, 0, 0, 0.18);
        border-radius: 50%;
        background: #ffffff;
        color: #202124;
        box-shadow: 0 2px 7px rgba(0, 0, 0, 0.28);
        font-size: 28px;
        font-weight: 500;
        line-height: 1;
        cursor: pointer;
        touch-action: manipulation;
        user-select: none;
      }

      #rideNaviZoomControls button:active {
        transform: scale(0.94);
      }

      #rideNaviZoomControls button.active {
        background: #1a73e8;
        color: #ffffff;
      }

      @media (max-width: 480px) {
        #rideNaviZoomControls {
          right: 70px;
          gap: 6px;
        }

        #rideNaviZoomControls button {
          width: 44px;
          height: 44px;
        }
      }
    `;
    document.head.appendChild(style);

    const controls = document.createElement("div");
    controls.id = "rideNaviZoomControls";
    controls.setAttribute("aria-label", "地図の拡大縮小");

    const zoomOutButton = document.createElement("button");
    zoomOutButton.type = "button";
    zoomOutButton.textContent = "−";
    zoomOutButton.title = "地図を縮小";
    zoomOutButton.setAttribute("aria-label", "地図を縮小");

    const zoomInButton = document.createElement("button");
    zoomInButton.type = "button";
    zoomInButton.textContent = "＋";
    zoomInButton.title = "地図を拡大";
    zoomInButton.setAttribute("aria-label", "地図を拡大");

    headingButton = document.createElement("button");
    headingButton.type = "button";
    headingButton.textContent = "🧭";
    headingButton.title = "進行方向を上に表示";
    headingButton.setAttribute("aria-label", "進行方向を上に表示");
    headingButton.setAttribute("aria-pressed", "false");

    zoomOutButton.addEventListener("click", () => {
      if (!map) return;
      map.setZoom(Math.max(2, (map.getZoom() || 12) - 1));
      showStatus("地図を縮小しました", true);
    });

    zoomInButton.addEventListener("click", () => {
      if (!map) return;
      map.setZoom(Math.min(21, (map.getZoom() || 12) + 1));
      showStatus("地図を拡大しました", true);
    });

    headingButton.addEventListener("click", () => {
      if (!map) return;

      headingUpEnabled = !headingUpEnabled;
      headingButton.setAttribute(
        "aria-pressed",
        headingUpEnabled ? "true" : "false"
      );

      if (headingUpEnabled) {
        headingButton.classList.add("active");
        headingButton.title = "北を上に固定";
        headingButton.setAttribute("aria-label", "北を上に固定");

        if (Number.isFinite(lastKnownHeading)) {
          map.setHeading(lastKnownHeading);
          showStatus("進行方向を上に表示します", true);
        } else {
          showStatus("移動すると進行方向を上に表示します", true);
        }
      } else {
        headingButton.classList.remove("active");
        headingButton.title = "進行方向を上に表示";
        headingButton.setAttribute("aria-label", "進行方向を上に表示");
        map.setHeading(0);
        showStatus("北を上に固定しました", true);
      }
    });

    controls.append(zoomOutButton, zoomInButton, headingButton);
    document.body.appendChild(controls);
  }

  function initMap() {
    try {
      map = new google.maps.Map($("map"), {
        center: DEFAULT_CENTER,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
        renderingType: google.maps.RenderingType.VECTOR,
        tilt: 0,
        heading: 0,
        headingInteractionEnabled: false,
        tiltInteractionEnabled: false
      });

    map.addListener("dragstart", () => {
      if (!followToggle) return;

      followToggle.checked = false;
      showStatus("地図の自動追従を解除しました", true);
    });

  

      directionsService = new google.maps.DirectionsService();

      directionsRenderer = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: false,
        preserveViewport: false,
        polylineOptions: {
          strokeColor: "#1a73e8",
          strokeOpacity: 0.95,
          strokeWeight: 7
        }
      });

      map.addListener("click", (event) => {
        if (!event.latLng) return;

        const lat = event.latLng.lat().toFixed(6);
        const lng = event.latLng.lng().toFixed(6);

        const useAsDestination = window.confirm(
          "📍 ここを目的地にして、3種類のルートを比較しますか？"
        );

        if (!useAsDestination) return;

        if (!destinationMarker) {
          destinationMarker = new google.maps.Marker({
            map,
            position: event.latLng,
            title: "目的地",
            animation: google.maps.Animation.DROP
          });
        } else {
          destinationMarker.setPosition(event.latLng);
        }

        destinationInput.value = `${lat},${lng}`;
        showStatus("📍 目的地を設定しました。ルートを比較します…");
        searchRoute();
      });

      trafficLayer = new google.maps.TrafficLayer();
      createNavigationInfoPanel();
      createZoomButtons();

      showStatus("Ride Navi 2.3.1 β を読み込みました", true);
      startGps();

      if (new URLSearchParams(window.location.search).get("shared") === "1") {
        setTimeout(searchRoute, 500);
      }
    } catch (error) {
      console.error("Map initialization error:", error);
      showStatus("地図の初期化に失敗しました");
    }
  }

  function loadGoogleMaps() {
    if (!apiKey || apiKey.includes("ここに")) {
      showStatus("config.jsのAPIキーを確認してください");
      return;
    }

    window.initRideNaviMap = initMap;

    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(apiKey)}` +
      "&callback=initRideNaviMap" +
      "&v=weekly" +
      "&loading=async" +
      "&language=ja" +
      "&region=JP";

    script.async = true;
    script.defer = true;
    script.onerror = () => showStatus("Googleマップを読み込めませんでした");

    document.head.appendChild(script);
  }

  menuButton?.addEventListener("click", () => {
    controlPanel.classList.contains("is-hidden")
      ? openPanel()
      : closePanel();
  });

  closePanelButton?.addEventListener("click", closePanel);
  useCurrentLocationButton?.addEventListener("click", useCurrentLocationAsOrigin);
  addWaypointButton?.addEventListener("click", addWaypoint);
  routeButton?.addEventListener("click", searchRoute);
  clearRouteButton?.addEventListener("click", () => clearDisplayedRoute(true));
  locationButton?.addEventListener("click", centerOnCurrentLocation);
  floatingLocationButton?.addEventListener("click", centerOnCurrentLocation);
  trafficToggle?.addEventListener("change", toggleTrafficLayer);
  voiceTestButton?.addEventListener("click", voiceTest);

  originInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchRoute();
  });

  destinationInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchRoute();
  });

  createNavigationButton();
  createShareButton();
  updateWaypointDisplay();
  updateRouteInfoEmpty();
  loadRouteFromUrl();
  loadGoogleMaps();
})();
