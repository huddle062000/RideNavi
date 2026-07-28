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
  const clearRouteButton = $("clearRouteButton");
  const locationButton = $("locationButton");
  const floatingLocationButton = $("floatingLocationButton");
  const followToggle = $("followToggle");
  const trafficToggle = $("trafficToggle");
  const voiceTestButton = $("voiceTestButton");
  const routeInfo = $("routeInfo");
  const gpsInfo = $("gpsInfo");

  let map = null;
  let RouteClass = null;
  let trafficLayer = null;
  let currentPosition = null;
  let userMarker = null;
  let accuracyCircle = null;
  let routePolylines = [];
  let routeMarkers = [];
  let statusTimer = null;
  let routeSearching = false;

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
      }, 2500);
    }
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

  function addWaypoint() {
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

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "waypoint-remove";
    removeButton.textContent = "✕";
    removeButton.setAttribute("aria-label", "経由地を削除");

    removeButton.addEventListener("click", () => {
      row.remove();
      updateWaypointDisplay();
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
    input.focus();
    showStatus("経由地を追加しました", true);
  }

  function getWaypointValues() {
    return [...waypointList.querySelectorAll(".waypoint-input")]
      .map((input) => input.value.trim())
      .filter(Boolean);
  }

  function clearDisplayedRoute(showMessage = true) {
    routePolylines.forEach((polyline) => polyline.setMap(null));
    routeMarkers.forEach((marker) => marker.setMap(null));

    routePolylines = [];
    routeMarkers = [];

    routeInfo.innerHTML =
      `距離：未設定<br>` +
      `時間：未設定<br>` +
      `経由地：${getWaypointValues().length}か所`;

    if (showMessage) {
      showStatus("ルートを消去しました", true);
    }
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "未取得";
    return meters >= 1000
      ? `${(meters / 1000).toFixed(1)} km`
      : `${Math.round(meters)} m`;
  }

  function formatDuration(milliseconds) {
    if (!Number.isFinite(milliseconds)) return "未取得";

    const totalMinutes = Math.max(1, Math.round(milliseconds / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) return `${minutes}分`;
    if (minutes === 0) return `${hours}時間`;
    return `${hours}時間${minutes}分`;
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

  async function searchRoute() {
    if (!map || !RouteClass) {
      showStatus("ルート機能を読み込み中です");
      return;
    }

    if (routeSearching) return;

    const originText = originInput.value.trim();
    const destinationText = destinationInput.value.trim();
    const waypoints = getWaypointValues();

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

    routeSearching = true;
    routeButton.disabled = true;
    routeButton.textContent = "検索中…";

    clearDisplayedRoute(false);
    showStatus("ルートを検索しています…");

    try {
      const request = {
        origin,
        destination: destinationText,
        travelMode: "DRIVING",
        routingPreference: "TRAFFIC_AWARE",
        departureTime: new Date(),
        language: "ja",
        units: google.maps.UnitSystem.METRIC,
        fields: [
          "path",
          "viewport",
          "distanceMeters",
          "durationMillis",
          "localizedValues"
        ]
      };

      if (waypoints.length > 0) {
        request.intermediates = waypoints.map((location) => ({ location }));
      }

      const result = await RouteClass.computeRoutes(request);
      const route = result.routes?.[0];

      if (!route) {
        throw new Error("ZERO_RESULTS");
      }

      routePolylines = route.createPolylines({
        strokeColor: "#1a73e8",
        strokeOpacity: 0.95,
        strokeWeight: 7
      });

      routePolylines.forEach((polyline) => polyline.setMap(map));

      if (route.path?.length) {
        routeMarkers.push(
          new google.maps.Marker({
            map,
            position: route.path[0],
            label: "出",
            title: "出発地"
          })
        );

        routeMarkers.push(
          new google.maps.Marker({
            map,
            position: route.path[route.path.length - 1],
            label: "着",
            title: "目的地"
          })
        );
      }

      if (route.viewport) {
        map.fitBounds(route.viewport, 45);
      }

      const distance =
        route.localizedValues?.distance ||
        formatDistance(route.distanceMeters);

      const duration =
        route.localizedValues?.duration ||
        formatDuration(route.durationMillis);

      routeInfo.innerHTML =
        `距離：${distance}<br>` +
        `時間：${duration}<br>` +
        `経由地：${waypoints.length}か所`;

      closePanel();
      showStatus("ルートを表示しました", true);
    } catch (error) {
      console.error("Route error:", error);
      clearDisplayedRoute(false);

      const message = String(error?.message || error);

      if (message.includes("ZERO_RESULTS")) {
        showStatus("指定した場所を通るルートが見つかりませんでした");
      } else if (message.includes("NOT_FOUND")) {
        showStatus("入力した場所の一部が見つかりませんでした");
      } else {
        showStatus("ルート検索に失敗しました");
      }
    } finally {
      routeSearching = false;
      routeButton.disabled = false;
      routeButton.textContent = "🧭 ルートを表示";
    }
  }

  async function initMap() {
    try {
      map = new google.maps.Map($("map"), {
        center: DEFAULT_CENTER,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy"
      });

      trafficLayer = new google.maps.TrafficLayer();

      const routesLibrary = await google.maps.importLibrary("routes");
      RouteClass = routesLibrary.Route;

      showStatus("Ride Navi 2.2を読み込みました", true);
      startGps();
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

  updateWaypointDisplay();
  loadGoogleMaps();
})();
