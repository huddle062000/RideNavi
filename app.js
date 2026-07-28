(() => {
  "use strict";

  const DEFAULT_CENTER = { lat: 35.0116, lng: 135.7681 };
  const MAX_WAYPOINTS = 5;
  const config = window.RIDE_NAVI_CONFIG || {};
  const apiKey = String(config.GOOGLE_MAPS_API_KEY || "").trim();

  let map;
  let trafficLayer;
  let userMarker;
  let accuracyCircle;
  let lastPosition;
  let watchId = null;
  let RouteClass = null;
  let routePolylines = [];
  let routeMarkers = [];
  let routeRequestRunning = false;
  let waypointSerial = 0;

  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const panelEl = $("controlPanel");
  const menuButton = $("menuButton");
  const originInput = $("originInput");
  const destinationInput = $("destinationInput");
  const gpsInfoEl = $("gpsInfo");
  const routeInfoEl = $("routeInfo");
  const followToggle = $("followToggle");
  const trafficToggle = $("trafficToggle");
  const routeButton = $("routeButton");
  const waypointList = $("waypointList");
  const waypointCount = $("waypointCount");
  const addWaypointButton = $("addWaypointButton");

  let statusTimer = null;

  function setStatus(message, autoHide = false) {
    if (statusTimer !== null) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }

    statusEl.textContent = message;
    statusEl.hidden = false;

    if (autoHide) {
      statusTimer = setTimeout(() => {
        statusEl.hidden = true;
        statusTimer = null;
      }, 2800);
    }
  }

  function openPanel() {
    panelEl.classList.remove("is-hidden");
    menuButton.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    panelEl.classList.add("is-hidden");
    menuButton.setAttribute("aria-expanded", "false");
  }

  function loadGoogleMaps() {
    if (!apiKey || apiKey.includes("ここに")) {
      setStatus("config.jsのAPIキーを確認してください");
      return;
    }

    window.initRideNaviMap = initMap;

    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(apiKey)}` +
      "&callback=initRideNaviMap&v=weekly&loading=async&language=ja&region=JP";
    script.async = true;
    script.defer = true;
    script.onerror = () => setStatus("Googleマップを読み込めませんでした");
    document.head.appendChild(script);
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

      setStatus("地図と経由地機能を読み込みました", true);
      startLocationWatch();
    } catch (error) {
      console.error("Ride Navi initialization error:", error);
      setStatus("ルート機能の初期化に失敗しました");
    }
  }

  function updateWaypointUi() {
    const rows = [...waypointList.querySelectorAll(".waypoint-row")];

    rows.forEach((row, index) => {
      row.querySelector(".waypoint-number").textContent = index + 1;
      row.querySelector("input").placeholder = `経由地${index + 1}　例：道の駅`;
    });

    waypointCount.textContent = `${rows.length} / ${MAX_WAYPOINTS}`;
    addWaypointButton.disabled = rows.length >= MAX_WAYPOINTS;
  }

  function addWaypoint(value = "") {
    const currentCount = waypointList.querySelectorAll(".waypoint-row").length;

    if (currentCount >= MAX_WAYPOINTS) {
      setStatus(`経由地は${MAX_WAYPOINTS}か所までです`);
      return;
    }

    waypointSerial += 1;

    const row = document.createElement("div");
    row.className = "waypoint-row";
    row.dataset.waypointId = String(waypointSerial);

    const number = document.createElement("span");
    number.className = "waypoint-number";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "waypoint-input";
    input.value = value;
    input.autocomplete = "off";

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        computeRoute();
      }
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "waypoint-remove";
    removeButton.textContent = "✕";
    removeButton.setAttribute("aria-label", "この経由地を削除");
    removeButton.addEventListener("click", () => {
      row.remove();
      updateWaypointUi();
      setStatus("経由地を削除しました", true);
    });

    row.append(number, input, removeButton);
    waypointList.appendChild(row);
    updateWaypointUi();
    input.focus();
  }

  function getWaypointValues() {
    return [...waypointList.querySelectorAll(".waypoint-input")]
      .map((input) => input.value.trim())
      .filter(Boolean);
  }

  function updateLocation(position) {
    lastPosition = position;

    const point = {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    };

    const accuracy = Math.round(position.coords.accuracy || 0);

    if (!userMarker) {
      userMarker = new google.maps.Marker({
        position: point,
        map,
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

      map.setZoom(16);
    } else {
      userMarker.setPosition(point);
      accuracyCircle.setCenter(point);
      accuracyCircle.setRadius(accuracy);
    }

    if (followToggle.checked) {
      map.panTo(point);
    }

    gpsInfoEl.innerHTML =
      `GPS：取得中<br>精度：約 ${accuracy} m<br>` +
      `緯度：${point.lat.toFixed(6)}<br>経度：${point.lng.toFixed(6)}`;
  }

  function handleLocationError(error) {
    const messages = {
      1: "位置情報の利用が許可されていません",
      2: "現在地を取得できません",
      3: "現在地の取得がタイムアウトしました"
    };

    const message = messages[error.code] || "GPSでエラーが発生しました";
    gpsInfoEl.innerHTML = `GPS：エラー<br>${message}`;
    setStatus(message);
  }

  function startLocationWatch() {
    if (!navigator.geolocation) {
      setStatus("このブラウザはGPSに対応していません");
      return;
    }

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }

    watchId = navigator.geolocation.watchPosition(
      updateLocation,
      handleLocationError,
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
  }

  function currentLatLng() {
    if (!lastPosition) return null;

    return {
      lat: lastPosition.coords.latitude,
      lng: lastPosition.coords.longitude
    };
  }

  function useCurrentLocationAsOrigin() {
    if (!currentLatLng()) {
      setStatus("まだ現在地を取得できていません");
      startLocationWatch();
      return;
    }

    originInput.value = "現在地";
    setStatus("現在地を出発地にしました", true);
  }

  function removeDisplayedRoute(showMessage = true) {
    routePolylines.forEach((polyline) => polyline.setMap(null));
    routeMarkers.forEach((marker) => marker.setMap(null));
    routePolylines = [];
    routeMarkers = [];

    routeInfoEl.innerHTML =
      "距離：未設定<br>時間：未設定<br>" +
      `経由地：${getWaypointValues().length}か所`;

    if (showMessage) {
      setStatus("ルートを消去しました", true);
    }
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "未取得";
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
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

  function readableRouteError(error) {
    const text = String(error?.message || error || "");

    if (text.includes("REQUEST_DENIED") || text.includes("PERMISSION_DENIED")) {
      return "ルート検索が拒否されました。Routes API設定を確認してください";
    }

    if (text.includes("NOT_FOUND")) {
      return "入力した場所の一部が見つかりませんでした";
    }

    if (text.includes("ZERO_RESULTS")) {
      return "指定した場所を通る走行ルートが見つかりませんでした";
    }

    if (text.includes("INVALID_ARGUMENT")) {
      return "出発地・経由地・目的地の入力内容を確認してください";
    }

    return "ルート検索に失敗しました。入力内容を確認してください";
  }

  async function computeRoute() {
    if (!map || !RouteClass) {
      setStatus("ルート機能の読み込みを待ってください");
      return;
    }

    if (routeRequestRunning) return;

    const originText = originInput.value.trim();
    const destinationText = destinationInput.value.trim();
    const waypointValues = getWaypointValues();

    if (!originText || !destinationText) {
      setStatus("出発地と目的地を入力してください");
      return;
    }

    let origin = originText;

    if (originText === "現在地") {
      origin = currentLatLng();

      if (!origin) {
        setStatus("現在地をまだ取得できていません");
        return;
      }
    }

    routeRequestRunning = true;
    routeButton.disabled = true;
    routeButton.textContent = "検索中…";
    setStatus("経由地を含むルートを検索しています…");
    removeDisplayedRoute(false);

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

      if (waypointValues.length > 0) {
        request.intermediates = waypointValues.map((location) => ({ location }));
      }

      const response = await RouteClass.computeRoutes(request);
      const routes = response.routes || [];

      if (routes.length === 0) {
        throw new Error("ZERO_RESULTS");
      }

      const route = routes[0];

      routePolylines = route.createPolylines({
        strokeColor: "#1a73e8",
        strokeOpacity: 0.95,
        strokeWeight: 7
      });

      routePolylines.forEach((polyline) => polyline.setMap(map));

      if (route.path && route.path.length > 0) {
        routeMarkers.push(
          new google.maps.Marker({
            map,
            position: route.path[0],
            label: "出",
            title: "出発地",
            zIndex: 900
          })
        );

        routeMarkers.push(
          new google.maps.Marker({
            map,
            position: route.path[route.path.length - 1],
            label: "着",
            title: "目的地",
            zIndex: 900
          })
        );
      }

      if (route.viewport) {
        map.fitBounds(route.viewport, 45);
      }

      const localized = route.localizedValues || {};
      const distance = localized.distance || formatDistance(route.distanceMeters);
      const duration = localized.duration || formatDuration(route.durationMillis);

      routeInfoEl.innerHTML =
        `距離：${distance}<br>` +
        `時間：${duration}<br>` +
        `経由地：${waypointValues.length}か所`;

      setStatus("経由地を含むルートを表示しました", true);
      closePanel();
    } catch (error) {
      console.error("Ride Navi route error:", error);
      removeDisplayedRoute(false);
      setStatus(readableRouteError(error));
    } finally {
      routeRequestRunning = false;
      routeButton.disabled = false;
      routeButton.textContent = "🧭 ルートを表示";
    }
  }

  function centerOnCurrentLocation() {
    if (!map) {
      setStatus("地図の読み込みを待ってください");
      return;
    }

    const point = currentLatLng();

    if (!point) {
      setStatus("現在地を取得しています…");
      startLocationWatch();
      return;
    }

    map.panTo(point);
    map.setZoom(16);
  }

  function toggleTraffic() {
    if (!map || !trafficLayer) return;

    trafficLayer.setMap(trafficToggle.checked ? map : null);
    setStatus(
      trafficToggle.checked ? "渋滞情報を表示しました" : "渋滞情報を隠しました",
      true
    );
  }

  function testVoice() {
    if (!("speechSynthesis" in window)) {
      setStatus("このブラウザは音声読み上げに対応していません");
      return;
    }

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(
      "ライドナビ、音声案内テストです。安全運転で走行してください。"
    );

    utterance.lang = "ja-JP";
    speechSynthesis.speak(utterance);
    setStatus("音声テストを再生しました", true);
  }

  menuButton.addEventListener("click", () => {
    panelEl.classList.contains("is-hidden") ? openPanel() : closePanel();
  });

  $("closePanelButton").addEventListener("click", closePanel);
  $("useCurrentLocationButton").addEventListener("click", useCurrentLocationAsOrigin);
  addWaypointButton.addEventListener("click", () => addWaypoint());
  routeButton.addEventListener("click", computeRoute);
  $("clearRouteButton").addEventListener("click", () => removeDisplayedRoute(true));
  $("locationButton").addEventListener("click", centerOnCurrentLocation);
  $("floatingLocationButton").addEventListener("click", centerOnCurrentLocation);
  trafficToggle.addEventListener("change", toggleTraffic);
  $("voiceTestButton").addEventListener("click", testVoice);

  originInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") computeRoute();
  });

  destinationInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") computeRoute();
  });

  updateWaypointUi();
  loadGoogleMaps();
})();
