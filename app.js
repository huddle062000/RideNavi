(() => {
  "use strict";

  const DEFAULT_CENTER = { lat: 35.0116, lng: 135.7681 };
  const MAP_MIN_ZOOM = 7;
  const MAX_WAYPOINTS = 5;
  const AUTO_ROUTE_FRACTIONS = [0.35, 0.5, 0.65];
  const AUTO_ROUTE_MIN_OFFSET_METERS = 1500;
  const AUTO_ROUTE_MAX_OFFSET_METERS = 12000;
  const AUTO_ROUTE_OFFSET_RATIO = 0.08;
  const AUTO_ROUTE_MAX_DURATION_RATIO = 1.3;
  const ROUTE_SEARCH_CACHE_LIMIT = 12;
  const LONG_PRESS_DELAY_MS = 550;
  const AUTOCOMPLETE_DEBOUNCE_MS = 250;
  const AUTOCOMPLETE_LOCATION_BIAS_METERS = 25000;
  const AUTOCOMPLETE_LOCAL_MIN_RADIUS_METERS = 8000;
  const AUTOCOMPLETE_DISPLAY_RESULTS = 8;
  const TEXT_SEARCH_MAX_RESULTS = 10;
  const SEARCH_MAP_MAX_RESULTS = 8;
  const SEARCH_MAP_MAX_ZOOM = 15;
  const DESTINATION_SELECTION_ZOOM = 16;
  const TOUCH_LONG_PRESS_MOVE_TOLERANCE_PX = 24;
  const MOUSE_LONG_PRESS_MOVE_TOLERANCE_PX = 10;
  const PEN_LONG_PRESS_MOVE_TOLERANCE_PX = 18;
  const HIGHWAY_GUIDANCE_PATTERNS = {
    entry: [
      /(?:高速|自動車道|有料道路|都市高速).*(?:入る|進入|合流)/,
      /(?:入る|進入|合流).*(?:高速|自動車道|有料道路|都市高速)/,
      /(?:IC|ＩＣ|インターチェンジ).*(?:入る|進入|合流)/,
      /(?:入口|料金所).*(?:入る|進入|合流|通過)/
    ],
    exit: [
      /(?:高速|自動車道|有料道路|都市高速).*(?:降りる|退出|出る)/,
      /(?:降りる|退出|出る).*(?:高速|自動車道|有料道路|都市高速)/,
      /(?:出口|IC|ＩＣ|インターチェンジ).*(?:降りる|退出|出る)/
    ],
    exitIndicator: [
      /出口/,
      /降りる/,
      /退出/
    ],
    approachOnly: [
      /(?:高速|自動車道|有料道路|都市高速)(?:入口)?\s*(?:方面|方向)/,
      /(?:入口|IC|ＩＣ|インターチェンジ)\s*(?:方面|方向)/,
      /(?:高速|自動車道|有料道路|都市高速)(?:入口)?\s*(?:へ|に)\s*(?:向かう|進む)/,
      /(?:入口|IC|ＩＣ|インターチェンジ)\s*(?:へ|に)\s*(?:向かう|進む)/,
      /(?:高速|自動車道|有料道路|都市高速|入口|IC|ＩＣ|インターチェンジ).*(?:手前|付近)/
    ]
  };
  const ROAD_NAME_TYPE_PATTERNS = {
    highway: [
      /高速/,
      /自動車道/,
      /有料道路/,
      /都市高速/
    ],
    ordinary: [
      /(?:国道|県道|府道|都道|道道|市道|町道|村道)/,
      /(?:道路|街道|バイパス|ロード|通り)$/
    ]
  };
  const TOLL_EVIDENCE_PATTERNS = [
    /有料/,
    /料金所/,
    /通行料金/,
    /ETC/i,
    /toll/i
  ];
  const EXPRESSWAY_EVIDENCE_PATTERNS = [
    /高速/,
    /自動車道/,
    /都市高速/,
    /expressway/i
  ];
  const PARTIAL_TOLL_MAX_DISTANCE_RATIO = 0.5;
  const MAX_UNNAMED_ACTIVE_ROAD_STEPS = 1;
  const CURRENT_LOCATION_CACHE_PRECISION = 3;
  const BIWAKO_BRIDGE_VIA_POINT = {
    lat: 35.120902,
    lng: 135.935418
  };
  const BIWAKO_BRIDGE_SEARCH_DISTANCE_METERS = 30000;
  const MOTORCYCLE_TOLL_BASE_YEN = 150;
  const MOTORCYCLE_TOLL_PER_KM_YEN = 22;
  const MOTORCYCLE_TOLL_ROUNDING_YEN = 50;

  const config = window.RIDE_NAVI_CONFIG || {};
  const apiKey = String(config.GOOGLE_MAPS_API_KEY || "").trim();

  const $ = (id) => document.getElementById(id);

  const statusEl = $("status");
  const controlPanel = $("controlPanel");
  const menuButton = $("menuButton");
  const closePanelButton = $("closePanelButton");
  const originInput = $("originInput");
  const destinationInput = $("destinationInput");
  const searchClearButton = $("searchClearButton");
  const destinationSuggestions = $("destinationSuggestions");
  const routeEndpointsSummary = $("routeEndpointsSummary");
  const useCurrentLocationButton = $("useCurrentLocationButton");
  const addWaypointButton = $("addWaypointButton");
  const topCurrentLocationButton = $("topCurrentLocationButton");
  const topDestinationButton = $("topDestinationButton");
  const topAddWaypointButton = $("topAddWaypointButton");
  const destinationMapButton = $("destinationMapButton");
  const waypointList = $("waypointList");
  const waypointCount = $("waypointCount");
  const routeButton = $("routeButton");
  const routeButtonIdleText =
    routeButton?.textContent || "🧭 3種類のルートを比較";
  let shareRouteButton = $("shareRouteButton");
  const navigationButton = $("navigationButton");
  const routeSummaryPanel = $("routeSummaryPanel");
  const routeSummarySelection = $("routeSummarySelection");
  const routeSummaryRoadType = $("routeSummaryRoadType");
  const routeSummaryToll = $("routeSummaryToll");
  const routeSummaryMetrics = $("routeSummaryMetrics");
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
  let previousGpsPoint = null;
  let previousGpsTimestamp = null;
  let displayedNavigationPoint = null;
  let displayedNavigationHeading = null;
  let navigationVisualFrame = null;
  const navigationArrowIconCache = new Map();
  let navigationInfoPanel = $("rideNaviInfoPanel");
  let navigationDistanceValue = $("navigationDistanceValue");
  let navigationEtaValue = $("navigationEtaValue");
  let navigationDurationValue = $("navigationDurationValue");
  const destinationPanel = $("destinationPanel");
  const destinationName = $("destinationName");
  const destinationAddress = $("destinationAddress");
  const destinationCategory = $("destinationCategory");
  const destinationBusinessInfo = $("destinationBusinessInfo");
  const destinationAttribution = $("destinationAttribution");
  const destinationNavigationButton = $("destinationNavigationButton");
  const destinationShareButton = $("destinationShareButton");
  const clearDestinationButton = $("clearDestinationButton");
  const clearRouteDestinationButton = $("clearRouteDestinationButton");
  const navigationGuidance = $("navigationGuidance");
  const navigationManeuverIcon = $("navigationManeuverIcon");
  const navigationManeuverPath = $("navigationManeuverPath");
  const navigationDistanceInstruction = $("navigationDistanceInstruction");
  const navigationGuidanceSecondary = $("navigationGuidanceSecondary");
  const navigationIntersectionName = $("navigationIntersectionName");
  const navigationInstruction = $("navigationInstruction");
  const navigationNextInstruction = $("navigationNextInstruction");
  const navigationDestination = $("navigationDestination");
  const overviewButton = $("overviewButton");
  const returnToLocationButton = $("returnToLocationButton");
  const endNavigationButton = $("endNavigationButton");

  const OFF_ROUTE_DISTANCE_METERS = 80;
  const OFF_ROUTE_REQUIRED_COUNT = 2;
  const REROUTE_COOLDOWN_MS = 20000;
  const NAVIGATION_START_ZOOM_MOBILE = 17.5;
  const NAVIGATION_START_ZOOM_DESKTOP = 17;
  const NAVIGATION_START_PAN_DURATION_MS = 700;
  const NAVIGATION_START_ZOOM_DELAY_MS = 250;
  const NAVIGATION_START_ZOOM_DURATION_MS = 1150;
  const NAVIGATION_START_HEADING_DELAY_MS = 1500;
  const NAVIGATION_START_FOLLOW_DELAY_MS = 1750;
  const NAVIGATION_VEHICLE_SCREEN_Y_RATIO = 0.76;
  const NAVIGATION_POSITION_ANIMATION_MS = 550;
  const NAVIGATION_LARGE_JUMP_ANIMATION_MS = 280;
  const NAVIGATION_LARGE_JUMP_METERS = 80;
  const NAVIGATION_STOPPED_SPEED_MPS = 0.8;
  const NAVIGATION_LOW_SPEED_MPS = 2.2;
  const NAVIGATION_HEADING_JITTER_DEGREES = 2.5;
  const NAVIGATION_LOW_SPEED_HEADING_JITTER_DEGREES = 12;
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
  let geocoder = null;
  let currentPosition = null;
  let userMarker = null;
  let destinationMarker = null;
  let destinationSelectionId = 0;
  let autocompleteRequestId = 0;
  let autocompleteTimer = null;
  let autocompleteSessionToken = null;
  let autocompletePredictions = [];
  let autocompleteActiveIndex = -1;
  let placesLibraryPromise = null;
  let searchResultMarkers = [];
  let searchResultLabelsOverlay = null;
  let mapSelectionTarget = null;
  let accuracyCircle = null;
  let statusTimer = null;
  let routeSearching = false;
  let latestRouteSearchId = 0;
  let displayedRouteSearchId = 0;
  let activeRouteSearchKey = "";
  let routeChoicePanel = null;
  let selectedRouteIndex = 0;
  let routeCandidates = [];
  let selectedRouteMode = "local";
  let routePolylines = [];
  let routeLabelOverlays = [];
  let longPressTimer = null;
  let navigationOverviewActive = false;
  let landscapeLocationTogglePrimed = false;
  let navigationStartAnimationTimers = [];
  let navigationStartPanFrame = null;
  let navigationStartZoomFrame = null;
  const routeSearchCache = new Map();

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

  function hideStatus() {
    if (!statusEl) return;

    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }

    statusEl.hidden = true;
    statusEl.textContent = "";
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
    routeLabelOverlays.forEach((overlay) => overlay.setMap(null));
    routeLabelOverlays = [];
  }

  function updateRouteEndpointsSummary() {
    if (!routeEndpointsSummary) return;

    const origin = "現在地";
    const destination = destinationInput?.value.trim() || "目的地未設定";
    routeEndpointsSummary.textContent = `${origin} → ${destination}`;
    routeEndpointsSummary.title = routeEndpointsSummary.textContent;
  }

  function routeModeInputs() {
    return [...document.querySelectorAll(
      'input[name="destinationRouteMode"], input[name="summaryRouteMode"]'
    )];
  }

  function syncRouteModeControls(mode, searchAgain = false) {
    const routeModeSelect = $("routeMode");
    if (routeModeSelect) routeModeSelect.value = mode;
    selectedRouteMode = mode;
    routeModeInputs().forEach((input) => {
      input.checked = input.value === mode;
    });

    if (searchAgain && lastRouteResult && !routeSearching) {
      searchRoute();
    }
  }

  function showDestinationPanel(name, address = "地図上の地点") {
    if (!destinationPanel) return;
    resetDestinationPlaceDetails();
    destinationName.textContent = name || "選択した目的地";
    destinationAddress.textContent = address || "地図上の地点";
    destinationPanel.hidden = false;
    if (routeSummaryPanel) routeSummaryPanel.hidden = true;
  }

  function updateFloatingLocationPanelOffset() {
    if (!destinationPanel || !floatingLocationButton) return;
    if (
      destinationPanel.hidden ||
      window.getComputedStyle(destinationPanel).display === "none"
    ) {
      floatingLocationButton.style.removeProperty("--floating-location-bottom");
      return;
    }

    const panelBottom = Number.parseFloat(
      window.getComputedStyle(destinationPanel).bottom
    );
    const bottomOffset =
      destinationPanel.offsetHeight +
      (Number.isFinite(panelBottom) ? panelBottom : 0) +
      12;
    floatingLocationButton.style.setProperty(
      "--floating-location-bottom",
      `${Math.ceil(bottomOffset)}px`
    );
  }

  function observeDestinationPanelLayout() {
    if (!destinationPanel || !floatingLocationButton) return;
    const scheduleUpdate = () => {
      window.requestAnimationFrame(updateFloatingLocationPanelOffset);
    };

    new MutationObserver(scheduleUpdate).observe(destinationPanel, {
      attributes: true,
      attributeFilter: ["hidden"]
    });
    if ("ResizeObserver" in window) {
      new ResizeObserver(scheduleUpdate).observe(destinationPanel);
    }
    destinationPanel.addEventListener("animationend", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    updateFloatingLocationPanelOffset();
  }

  function hideDestinationSuggestions() {
    autocompletePredictions = [];
    autocompleteActiveIndex = -1;
    destinationSuggestions?.replaceChildren();
    if (destinationSuggestions) destinationSuggestions.hidden = true;
    destinationInput?.setAttribute("aria-expanded", "false");
    destinationInput?.removeAttribute("aria-activedescendant");
  }

  function updateSearchClearButtonVisibility() {
    if (!searchClearButton || !destinationInput) return;
    searchClearButton.hidden = !destinationInput.value;
  }

  function cancelDestinationSuggestions(resetSession = true) {
    autocompleteRequestId += 1;
    if (autocompleteTimer) {
      clearTimeout(autocompleteTimer);
      autocompleteTimer = null;
    }
    if (resetSession) autocompleteSessionToken = null;
    hideDestinationSuggestions();
  }

  function formatSuggestionDistance(distanceMeters) {
    if (!Number.isFinite(distanceMeters)) return "";
    if (distanceMeters < 1000) {
      return `${Math.max(1, Math.round(distanceMeters / 10) * 10)} m`;
    }
    const kilometers = distanceMeters / 1000;
    return `${kilometers < 10 ? kilometers.toFixed(1) : Math.round(kilometers)} km`;
  }

  function showSearchResultsItem(query, results = null) {
    return {
      kind: "show-search-results",
      query,
      results,
      mainText: query,
      secondaryText: "場所を表示",
      distanceMeters: null,
      category: ""
    };
  }

  function updateAutocompleteActiveItem(nextIndex) {
    if (!autocompletePredictions.length) return;
    autocompleteActiveIndex =
      (nextIndex + autocompletePredictions.length) % autocompletePredictions.length;
    const buttons = destinationSuggestions?.querySelectorAll(
      ".destination-suggestion"
    ) || [];
    buttons.forEach((button, index) => {
      const isActive = index === autocompleteActiveIndex;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      if (isActive) {
        destinationInput?.setAttribute("aria-activedescendant", button.id);
        button.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function renderDestinationSuggestions(predictions) {
    if (!destinationSuggestions || !destinationInput) return;
    autocompletePredictions = predictions;
    autocompleteActiveIndex = -1;
    destinationSuggestions.replaceChildren();

    predictions.forEach((prediction, index) => {
      const button = document.createElement("button");
      const icon = document.createElement("span");
      const text = document.createElement("span");
      const main = document.createElement("span");
      const secondary = document.createElement("span");
      const address = document.createElement("span");
      const distance = document.createElement("span");
      const category = document.createElement("span");
      const mainText = prediction.mainText || "候補";
      const secondaryText = prediction.secondaryText || "";
      const distanceText = formatSuggestionDistance(prediction.distanceMeters);

      button.type = "button";
      button.id = `destinationSuggestion${index}`;
      button.className = "destination-suggestion";
      button.classList.toggle(
        "is-search-result",
        prediction.kind === "text-search"
      );
      button.classList.toggle(
        "is-show-on-map",
        prediction.kind === "show-search-results"
      );
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.setAttribute(
        "aria-label",
        [mainText, secondaryText, distanceText, prediction.category]
          .filter(Boolean)
          .join("、")
      );
      icon.className = "destination-suggestion-icon";
      icon.textContent = prediction.kind === "show-search-results" ? "●" : "⌖";
      icon.setAttribute("aria-hidden", "true");
      text.className = "destination-suggestion-text";
      main.className = "destination-suggestion-main";
      main.textContent = mainText;
      secondary.className = "destination-suggestion-secondary";
      address.className = "destination-suggestion-address";
      address.textContent = secondaryText;
      distance.className = "destination-suggestion-distance";
      distance.textContent = distanceText;
      category.className = "destination-suggestion-category";
      category.textContent = prediction.category || "";
      category.hidden = !prediction.category;
      secondary.append(address, distance);
      text.append(main, secondary, category);
      button.append(icon, text);
      button.addEventListener("click", () => {
        void selectDestinationSearchItem(prediction);
      });
      destinationSuggestions.appendChild(button);
    });

    destinationSuggestions.hidden = predictions.length === 0;
    destinationInput.setAttribute("aria-expanded", String(predictions.length > 0));
  }

  async function autocompletePlacesLibrary() {
    if (!placesLibraryPromise) {
      placesLibraryPromise = google.maps.importLibrary("places");
    }
    return placesLibraryPromise;
  }

  function autocompleteRequestLocation() {
    const center = map?.getCenter();
    if (center) return { lat: center.lat(), lng: center.lng() };
    return getCurrentLatLng() || DEFAULT_CENTER;
  }

  function destinationSearchLocationBias() {
    const bounds = map?.getBounds?.();
    if (bounds) {
      const northEast = bounds.getNorthEast();
      const southWest = bounds.getSouthWest();
      if (northEast && southWest) {
        return {
          north: northEast.lat(),
          east: northEast.lng(),
          south: southWest.lat(),
          west: southWest.lng()
        };
      }
    }

    return {
      center: autocompleteRequestLocation(),
      radius: AUTOCOMPLETE_LOCATION_BIAS_METERS
    };
  }

  function destinationAutocompleteLocationRestriction() {
    const center = autocompleteRequestLocation();
    const bounds = map?.getBounds?.();
    const northEast = bounds?.getNorthEast?.();
    const viewportRadius = northEast
      ? distanceBetweenMeters(center, {
          lat: northEast.lat(),
          lng: northEast.lng()
        })
      : AUTOCOMPLETE_LOCATION_BIAS_METERS;

    return {
      center,
      radius: Math.min(
        AUTOCOMPLETE_LOCATION_BIAS_METERS,
        Math.max(AUTOCOMPLETE_LOCAL_MIN_RADIUS_METERS, viewportRadius)
      )
    };
  }

  function rankedAutocompleteItems(suggestions, query) {
    const seenPlaceIds = new Set();
    return suggestions
      .map((suggestion) => suggestion.placePrediction)
      .filter(Boolean)
      .filter((prediction) => {
        const key = prediction.placeId || prediction.text?.text;
        if (!key || seenPlaceIds.has(key)) return false;
        seenPlaceIds.add(key);
        return true;
      })
      .map((prediction, index) => {
        const mainText =
          prediction.mainText?.text || prediction.text?.text || "候補";
        return {
          kind: "autocomplete",
          prediction,
          mainText,
          secondaryText: prediction.secondaryText?.text || "",
          distanceMeters: prediction.distanceMeters,
          category: "",
          matchTier: textSearchMatchTier(query, mainText),
          originalIndex: index
        };
      })
      .sort((a, b) =>
        a.matchTier - b.matchTier ||
        (Number.isFinite(a.distanceMeters) ? a.distanceMeters : Infinity) -
          (Number.isFinite(b.distanceMeters) ? b.distanceMeters : Infinity) ||
        a.originalIndex - b.originalIndex
      )
      .slice(0, AUTOCOMPLETE_DISPLAY_RESULTS);
  }

  async function requestDestinationSuggestions(query, requestId) {
    try {
      const { AutocompleteSessionToken, AutocompleteSuggestion } =
        await autocompletePlacesLibrary();
      if (requestId !== autocompleteRequestId) return;
      if (!autocompleteSessionToken) {
        autocompleteSessionToken = new AutocompleteSessionToken();
      }
      const mapCenter = autocompleteRequestLocation();
      const baseRequest = {
        input: query,
        language: "ja",
        region: "jp",
        includedRegionCodes: ["jp"],
        sessionToken: autocompleteSessionToken,
        origin: mapCenter
      };
      const responses = await Promise.allSettled([
        AutocompleteSuggestion.fetchAutocompleteSuggestions({
          ...baseRequest,
          locationRestriction: destinationAutocompleteLocationRestriction()
        }),
        AutocompleteSuggestion.fetchAutocompleteSuggestions({
          ...baseRequest,
          locationBias: destinationSearchLocationBias()
        })
      ]);
      const suggestions = responses.flatMap((response) =>
        response.status === "fulfilled" ? response.value.suggestions || [] : []
      );
      if (
        !suggestions.length &&
        responses.every((response) => response.status === "rejected")
      ) {
        throw responses[0].reason;
      }
      if (
        requestId !== autocompleteRequestId ||
        destinationInput?.value.trim() !== query
      ) {
        return;
      }
      renderDestinationSuggestions([
        showSearchResultsItem(query),
        ...rankedAutocompleteItems(suggestions, query)
      ]);
    } catch (error) {
      if (requestId !== autocompleteRequestId) return;
      console.error("[Ride Navi] 検索候補の取得に失敗しました", error);
      hideDestinationSuggestions();
      showStatus("検索候補を取得できませんでした", true);
    }
  }

  function scheduleDestinationSuggestions() {
    const query = destinationInput?.value.trim() || "";
    const requestId = ++autocompleteRequestId;
    if (autocompleteTimer) clearTimeout(autocompleteTimer);
    autocompleteTimer = null;

    if (!query || navigationActive || !map) {
      if (!query) autocompleteSessionToken = null;
      hideDestinationSuggestions();
      return;
    }

    autocompleteTimer = setTimeout(() => {
      autocompleteTimer = null;
      void requestDestinationSuggestions(query, requestId);
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  }

  async function selectAutocompletePrediction(prediction) {
    if (!prediction || navigationActive) return;
    const selectionRequestId = ++autocompleteRequestId;
    if (autocompleteTimer) clearTimeout(autocompleteTimer);
    autocompleteTimer = null;
    hideDestinationSuggestions();
    destinationInput?.blur();

    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: [
          "displayName",
          "formattedAddress",
          "location",
          "primaryTypeDisplayName"
        ]
      });
      if (selectionRequestId !== autocompleteRequestId || !place.location) return;

      autocompleteSessionToken = null;
      updateDestinationDetails(place.location, prediction.placeId, place);
      map.panTo(place.location);
      map.setZoom(DESTINATION_SELECTION_ZOOM);
      hideStatus();
    } catch (error) {
      if (selectionRequestId !== autocompleteRequestId) return;
      autocompleteSessionToken = null;
      console.error("[Ride Navi] 検索候補の選択に失敗しました", error);
      showStatus("目的地の情報を取得できませんでした", true);
    }
  }

  function normalizedPlaceSearchText(text) {
    return String(text || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ja")
      .replace(/\s+/g, "");
  }

  function textSearchMatchTier(query, placeName) {
    const normalizedQuery = normalizedPlaceSearchText(query);
    const normalizedName = normalizedPlaceSearchText(placeName);
    if (normalizedName === normalizedQuery) return 0;
    if (normalizedName.includes(normalizedQuery)) return 1;

    const queryParts = String(query || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ja")
      .split(/\s+/)
      .filter(Boolean);
    return queryParts.length &&
      queryParts.every((part) => normalizedName.includes(part))
      ? 1
      : 2;
  }

  function placeLocationLiteral(place) {
    const latitude =
      typeof place?.location?.lat === "function"
        ? place.location.lat()
        : place?.location?.lat;
    const longitude =
      typeof place?.location?.lng === "function"
        ? place.location.lng()
        : place?.location?.lng;
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { lat: latitude, lng: longitude }
      : null;
  }

  function textSearchResultItems(places, query, biasLocation) {
    const currentLocation = getCurrentLatLng();
    return places
      .map((place, index) => {
        const location = placeLocationLiteral(place);
        const displayName = place.displayName?.text || place.displayName || "候補";
        const category =
          place.primaryTypeDisplayName?.text ||
          place.primaryTypeDisplayName ||
          "";
        return {
          kind: "text-search",
          place,
          mainText: displayName,
          secondaryText: place.formattedAddress || "",
          category,
          distanceMeters:
            currentLocation && location
              ? distanceBetweenMeters(currentLocation, location)
              : null,
          rankingDistanceMeters:
            biasLocation && location
              ? distanceBetweenMeters(biasLocation, location)
              : Infinity,
          matchTier: textSearchMatchTier(query, displayName),
          originalIndex: index
        };
      })
      .filter((item) => placeLocationLiteral(item.place))
      .sort((a, b) =>
        a.matchTier - b.matchTier ||
        a.rankingDistanceMeters - b.rankingDistanceMeters ||
        a.originalIndex - b.originalIndex
      );
  }

  function clearSearchResultMap() {
    searchResultMarkers.forEach((marker) => marker.setMap(null));
    searchResultMarkers = [];
    searchResultLabelsOverlay?.setMap(null);
    searchResultLabelsOverlay = null;
  }

  function clearDestinationSearchUi() {
    if (!destinationInput) return;
    const hasSelectedDestination = Boolean(
      destinationInput.dataset.selectedCoordinate
    );
    cancelDestinationSuggestions();
    clearSearchResultMap();
    destinationInput.value = "";
    if (hasSelectedDestination) {
      destinationInput.dataset.searchCleared = "true";
    } else {
      delete destinationInput.dataset.searchCleared;
    }
    updateSearchClearButtonVisibility();
    hideStatus();
    destinationInput.focus();
  }

  function createSearchResultLabelsOverlay(items) {
    const overlay = new google.maps.OverlayView();
    const labels = [];

    overlay.onAdd = () => {
      const pane = overlay.getPanes().overlayMouseTarget;
      items.forEach((item) => {
        const label = document.createElement("button");
        label.type = "button";
        label.className = "search-result-map-label";
        label.textContent = item.mainText;
        label.title = item.mainText;
        label.setAttribute("aria-label", `${item.mainText}を目的地に選択`);
        label.addEventListener("pointerdown", (event) => event.stopPropagation());
        label.addEventListener("click", (event) => {
          event.stopPropagation();
          void selectTextSearchPlace(item.place);
        });
        pane.appendChild(label);
        labels.push({ label, item });
      });
    };

    overlay.draw = () => {
      const projection = overlay.getProjection();
      const mapRect = map.getDiv().getBoundingClientRect();
      const visibleBounds = map.getBounds();
      const center = map.getCenter();
      const centerLiteral = center
        ? { lat: center.lat(), lng: center.lng() }
        : DEFAULT_CENTER;
      const occupiedRects = [];
      const obstacleRects = [$("searchBar"), destinationPanel]
        .filter((element) => element && !element.hidden)
        .map((element) => element.getBoundingClientRect())
        .map((rect) => ({
          left: rect.left - mapRect.left,
          right: rect.right - mapRect.left,
          top: rect.top - mapRect.top,
          bottom: rect.bottom - mapRect.top
        }));
      labels
        .slice()
        .sort((first, second) =>
          distanceBetweenMeters(centerLiteral, {
            lat: first.item.location.lat(),
            lng: first.item.location.lng()
          }) -
          distanceBetweenMeters(centerLiteral, {
            lat: second.item.location.lat(),
            lng: second.item.location.lng()
          })
        )
        .forEach(({ label, item }) => {
          if (visibleBounds && !visibleBounds.contains(item.location)) {
            label.hidden = true;
            return;
          }
          const point = projection.fromLatLngToContainerPixel(item.location);
          const divPoint = projection.fromLatLngToDivPixel(item.location);
          if (
            !point ||
            !divPoint ||
            point.x < 0 ||
            point.x > mapRect.width ||
            point.y < 0 ||
            point.y > mapRect.height
          ) {
            label.hidden = true;
            return;
          }
          const width = label.offsetWidth || 132;
          const height = label.offsetHeight || 28;
          const candidates = [
            { left: point.x + 13, top: point.y - height - 12 },
            { left: point.x - width - 13, top: point.y - height - 12 },
            { left: point.x - width / 2, top: point.y - height - 37 }
          ];
          const placement = candidates
            .map((candidate) => {
              const rect = {
                left: candidate.left,
                right: candidate.left + width,
                top: candidate.top,
                bottom: candidate.top + height
              };
              const fitsMap =
                rect.left >= 4 &&
                rect.right <= mapRect.width - 4 &&
                rect.top >= 4 &&
                rect.bottom <= mapRect.height - 4;
              const overlapsLabel = occupiedRects.some(
                (occupied) => routeLabelOverlapArea(rect, occupied, 5) > 0
              );
              const overlapsUi = obstacleRects.some(
                (obstacle) => routeLabelOverlapArea(rect, obstacle, 4) > 0
              );
              return fitsMap && !overlapsLabel && !overlapsUi
                ? { ...candidate, rect }
                : null;
            })
            .find(Boolean);
          if (!placement) {
            label.hidden = true;
            return;
          }
          label.hidden = false;
          label.style.left = `${placement.left + divPoint.x - point.x}px`;
          label.style.top = `${placement.top + divPoint.y - point.y}px`;
          occupiedRects.push(placement.rect);
        });
    };

    overlay.onRemove = () => {
      labels.forEach(({ label }) => label.remove());
      labels.length = 0;
    };

    overlay.setMap(map);
    return overlay;
  }

  function searchResultMapPadding() {
    const mapRect = map.getDiv().getBoundingClientRect();
    const searchRect = $("searchBar")?.getBoundingClientRect();
    const destinationRect = !destinationPanel?.hidden
      ? destinationPanel.getBoundingClientRect()
      : null;
    return {
      top: Math.min(
        Math.max(86, (searchRect?.bottom || mapRect.top + 64) - mapRect.top + 24),
        mapRect.height * 0.34
      ),
      right: 42,
      bottom: Math.min(
        Math.max(
          48,
          destinationRect ? mapRect.bottom - destinationRect.top + 16 : 48
        ),
        mapRect.height * 0.34
      ),
      left: 42
    };
  }

  function showTextSearchResultsOnMap(results) {
    if (!map || navigationActive) return;
    const initialBounds = map.getBounds();
    const items = (results || [])
      .map((item) => {
        const location = placeLocationLiteral(item.place);
        return location
          ? { ...item, location: new google.maps.LatLng(location) }
          : null;
      })
      .filter(
        (item) => item && (!initialBounds || initialBounds.contains(item.location))
      )
      .slice(0, SEARCH_MAP_MAX_RESULTS);
    if (!items.length) {
      showStatus("地図に表示できる場所がありませんでした", true);
      return;
    }

    autocompleteRequestId += 1;
    autocompleteSessionToken = null;
    hideDestinationSuggestions();
    clearSearchResultMap();
    destinationInput?.blur();

    const bounds = new google.maps.LatLngBounds();
    searchResultMarkers = items.map((item, index) => {
      bounds.extend(item.location);
      const marker = new google.maps.Marker({
        map,
        position: item.location,
        title: item.mainText,
        zIndex: 220 - index,
        icon: {
          path: "M0-16C-7.5-16-12-10.4-12-4c0 9 12 20 12 20S12 5 12-4C12-10.4 7.5-16 0-16Z",
          fillColor: "#d93025",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
          scale: 1,
          anchor: new google.maps.Point(0, 16)
        }
      });
      marker.addListener("click", () => {
        void selectTextSearchPlace(item.place);
      });
      return marker;
    });
    searchResultLabelsOverlay = createSearchResultLabelsOverlay(items);

    if (items.length === 1) {
      map.panTo(items[0].location);
      map.setZoom(SEARCH_MAP_MAX_ZOOM);
    } else {
      const renderedMarkers = searchResultMarkers;
      map.fitBounds(bounds, searchResultMapPadding());
      google.maps.event.addListenerOnce(map, "idle", () => {
        if (
          searchResultMarkers === renderedMarkers &&
          map.getZoom() > SEARCH_MAP_MAX_ZOOM
        ) {
          map.setZoom(SEARCH_MAP_MAX_ZOOM);
        }
      });
    }
    hideStatus();
  }

  async function searchDestinationByText(showOnMap = false) {
    const query = destinationInput?.value.trim() || "";
    if (!query || navigationActive || !map) return;

    const searchRequestId = ++autocompleteRequestId;
    if (autocompleteTimer) clearTimeout(autocompleteTimer);
    autocompleteTimer = null;
    autocompleteSessionToken = null;
    hideDestinationSuggestions();
    clearSearchResultMap();
    destinationInput?.blur();
    showStatus("目的地を検索しています…");

    try {
      const { Place } = await autocompletePlacesLibrary();
      const location = autocompleteRequestLocation();
      const { places } = await Place.searchByText({
        textQuery: query,
        fields: [
          "id",
          "displayName",
          "formattedAddress",
          "location",
          "primaryTypeDisplayName"
        ],
        language: "ja",
        region: "jp",
        locationBias: destinationSearchLocationBias(),
        maxResultCount: TEXT_SEARCH_MAX_RESULTS
      });
      if (
        searchRequestId !== autocompleteRequestId ||
        destinationInput?.value.trim() !== query
      ) {
        return;
      }

      const results = textSearchResultItems(places || [], query, location);
      if (!results.length) {
        hideDestinationSuggestions();
        showStatus("目的地が見つかりませんでした", true);
        destinationInput?.focus();
        return;
      }

      if (showOnMap) {
        showTextSearchResultsOnMap(results);
      } else {
        renderDestinationSuggestions([
          showSearchResultsItem(query, results),
          ...results
        ]);
      }
      hideStatus();
    } catch (error) {
      if (searchRequestId !== autocompleteRequestId) return;
      console.error("[Ride Navi] 目的地検索に失敗しました", error);
      hideDestinationSuggestions();
      showStatus("目的地を検索できませんでした", true);
      destinationInput?.focus();
    }
  }

  async function selectTextSearchPlace(place) {
    if (!place || navigationActive) return;
    const location = placeLocationLiteral(place);
    if (!location) {
      showStatus("目的地の位置を取得できませんでした", true);
      return;
    }

    autocompleteRequestId += 1;
    hideDestinationSuggestions();
    destinationInput?.blur();
    autocompleteSessionToken = null;
    const latLng = new google.maps.LatLng(location);
    updateDestinationDetails(latLng, place.id || "", place);
    map.panTo(latLng);
    map.setZoom(DESTINATION_SELECTION_ZOOM);
    hideStatus();
  }

  async function selectDestinationSearchItem(item) {
    if (item?.kind === "show-search-results") {
      if (item.results) {
        showTextSearchResultsOnMap(item.results);
      } else {
        await searchDestinationByText(true);
      }
      return;
    }
    if (item?.kind === "text-search") {
      await selectTextSearchPlace(item.place);
      return;
    }
    await selectAutocompletePrediction(item?.prediction);
  }

  function destinationRouteValue() {
    const displayValue = destinationInput?.value.trim() || "";
    const selectedLabel = destinationInput?.dataset.selectedLabel || "";
    const selectedCoordinate =
      destinationInput?.dataset.selectedCoordinate || "";

    return selectedCoordinate &&
      (displayValue === selectedLabel || !displayValue)
      ? selectedCoordinate
      : displayValue;
  }

  function destinationRouteRequestValue() {
    const displayValue = destinationInput?.value.trim() || "";
    const selectedLabel = destinationInput?.dataset.selectedLabel || "";
    const selectedPlaceId = destinationInput?.dataset.selectedPlaceId || "";
    return selectedPlaceId &&
      (displayValue === selectedLabel || !displayValue)
      ? { placeId: selectedPlaceId }
      : destinationRouteValue();
  }

  function setOptionalDestinationText(element, text) {
    if (!element) return;
    element.textContent = text || "";
    element.hidden = !text;
  }

  function resetDestinationPlaceDetails() {
    setOptionalDestinationText(destinationCategory, "");
    setOptionalDestinationText(destinationBusinessInfo, "");
    destinationBusinessInfo?.classList.remove("is-closed");
    setOptionalDestinationText(destinationAttribution, "");
  }

  function formatDestinationAttribution(attributions = []) {
    const providers = (attributions || [])
      .map((attribution) =>
        typeof attribution === "string"
          ? attribution
          : attribution?.provider || attribution?.providerName || ""
      )
      .filter(Boolean);
    const uniqueProviders = [...new Set(providers)];
    return uniqueProviders.length
      ? `施設情報: Google Maps / ${uniqueProviders.join(" / ")}`
      : "施設情報: Google Maps";
  }

  function formatPlaceApiError(error, placeId) {
    const response = error?.response;
    const responseContent = response
      ? {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          data: response.data ?? response.body ?? response.error ?? null
        }
      : error?.responseBody ?? error?.data ?? error?.details ?? null;
    const ownProperties = {};
    for (const property of Object.getOwnPropertyNames(error || {})) {
      try {
        const value = error[property];
        ownProperties[property] = value === error ? "[Circular: error]" : value;
      } catch (_propertyError) {
        ownProperties[property] = "[Unreadable property]";
      }
    }
    const seen = new WeakSet();
    return JSON.stringify(
      {
        placeId,
        error: String(error),
        message: error?.message ?? "",
        code: error?.code ?? "",
        status: error?.status ?? response?.status ?? "",
        endpoint: error?.endpoint ?? "",
        response: responseContent,
        properties: ownProperties
      },
      (_key, value) => {
        if (typeof value === "bigint") return String(value);
        if (!value || typeof value !== "object") return value;
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
        return value;
      },
      2
    );
  }

  function formatOpeningHoursPoint(point) {
    if (!point) return "";
    const hour = String(point.hour);
    const minute = String(point.minute).padStart(2, "0");
    return `${hour}:${minute}`;
  }

  function formatPlaceOpeningStatus(
    openingHours,
    utcOffsetMinutes,
    now = Date.now()
  ) {
    const periods = openingHours?.periods || [];
    if (!periods.length) return "";
    const alwaysOpen =
      periods.length === 1 &&
      periods[0].open?.day === 0 &&
      periods[0].open?.hour === 0 &&
      periods[0].open?.minute === 0 &&
      !periods[0].close;
    if (alwaysOpen) return "営業中・24時間営業";

    const offset = Number.isFinite(utcOffsetMinutes)
      ? utcOffsetMinutes
      : -new Date().getTimezoneOffset();
    const placeTime = new Date(now + offset * 60000);
    const currentDay = placeTime.getUTCDay();
    const currentMinutes = placeTime.getUTCHours() * 60 + placeTime.getUTCMinutes();
    const currentWeekMinutes = currentDay * 1440 + currentMinutes;
    const weekMinutes = 7 * 1440;
    const normalizedPeriods = periods
      .filter((period) => period.open && period.close)
      .map((period) => {
        const open =
          period.open.day * 1440 + period.open.hour * 60 + period.open.minute;
        let close =
          period.close.day * 1440 + period.close.hour * 60 + period.close.minute;
        if (close <= open) close += weekMinutes;
        return { period, open, close };
      });
    const activePeriod = normalizedPeriods.find(({ open, close }) =>
      [currentWeekMinutes, currentWeekMinutes + weekMinutes].some(
        (current) => current >= open && current < close
      )
    );

    if (activePeriod) {
      if (activePeriod.close - activePeriod.open >= 1440) {
        return "営業中・24時間営業";
      }
      return `営業中・${formatOpeningHoursPoint(activePeriod.period.close)}まで`;
    }

    const todayPeriods = normalizedPeriods.filter(
      ({ period }) => period.open.day === currentDay
    );
    if (!todayPeriods.length) return "営業時間外";

    const todaySchedule = todayPeriods
      .map(({ period }) =>
        `${formatOpeningHoursPoint(period.open)}〜${formatOpeningHoursPoint(period.close)}`
      )
      .join(" / ");
    const allTodayPeriodsEnded = todayPeriods.every(({ period }) => {
      if (period.close.day !== currentDay) return false;
      return currentMinutes >= period.close.hour * 60 + period.close.minute;
    });
    const status = allTodayPeriodsEnded ? "営業終了" : "営業時間外";
    return `${status}・本日${todaySchedule}`;
  }

  async function loadDestinationPlaceDetails(placeId, selectionId, selectedPlace = null) {
    if (!placeId || !google.maps.importLibrary) return;

    try {
      let place = selectedPlace;
      if (!place) {
        const { Place } = await autocompletePlacesLibrary();
        place = new Place({
          id: placeId,
          requestedLanguage: "ja",
          requestedRegion: "JP"
        });
        await place.fetchFields({
          fields: [
            "displayName",
            "formattedAddress",
            "primaryTypeDisplayName"
          ]
        });
      }
      if (selectionId !== destinationSelectionId) return;

      const displayName = place.displayName?.text || place.displayName || "";
      if (displayName) {
        destinationName.textContent = displayName;
        destinationInput.dataset.selectedLabel = displayName;
        if (destinationInput.dataset.searchCleared !== "true") {
          destinationInput.value = displayName;
          updateRouteEndpointsSummary();
        }
        updateSearchClearButtonVisibility();
      }
      if (place.formattedAddress) destinationAddress.textContent = place.formattedAddress;
      destinationMarker?.setTitle(displayName || place.formattedAddress || "目的地");

      const category =
        place.primaryTypeDisplayName?.text || place.primaryTypeDisplayName || "";
      setOptionalDestinationText(
        destinationCategory,
        category
      );
      setOptionalDestinationText(
        destinationAttribution,
        formatDestinationAttribution(place.attributions)
      );
      let openStatus = "";
      try {
        await place.fetchFields({
          fields: ["businessStatus"]
        });
        if (selectionId !== destinationSelectionId) return;

        if (place.businessStatus === "CLOSED_PERMANENTLY") {
          openStatus = "閉業";
        } else if (place.businessStatus === "CLOSED_TEMPORARILY") {
          openStatus = "臨時休業";
        } else if (place.businessStatus === "FUTURE_OPENING") {
          openStatus = "開業前";
        } else {
          await place.fetchFields({
            fields: [
              "currentOpeningHours",
              "regularOpeningHours",
              "utcOffsetMinutes"
            ]
          });
          if (selectionId !== destinationSelectionId) return;
          const openingHours =
            place.currentOpeningHours || place.regularOpeningHours;
          openStatus = formatPlaceOpeningStatus(
            openingHours,
            place.utcOffsetMinutes
          );
        }
      } catch (error) {
        // 営業情報が取得できなくても、先に取得した施設名とカテゴリーは維持する。
        console.error(
          `[Ride Navi] POIの営業情報取得に失敗しました\n${formatPlaceApiError(error, placeId)}`
        );
      }
      setOptionalDestinationText(destinationBusinessInfo, openStatus);
      destinationBusinessInfo?.classList.toggle(
        "is-closed",
        Boolean(openStatus && !openStatus.startsWith("営業中"))
      );
    } catch (error) {
      // Places API が利用できない場合も、逆ジオコードの名称・住所を維持する。
      console.error(
        `[Ride Navi] POIの基本情報取得に失敗しました\n${formatPlaceApiError(error, placeId)}`
      );
    }
  }

  function cancelPendingRouteSearch() {
    latestRouteSearchId += 1;
    routeSearching = false;
    activeRouteSearchKey = "";
    if (routeButton) {
      routeButton.disabled = false;
      routeButton.textContent = routeButtonIdleText;
    }
  }

  function updateDestinationDetails(latLng, selectedPlaceId = "", selectedPlace = null) {
    cancelDestinationSuggestions();
    clearSearchResultMap();
    const selectionId = ++destinationSelectionId;
    const lat = latLng.lat().toFixed(6);
    const lng = latLng.lng().toFixed(6);
    const coordinate = `${lat},${lng}`;
    const displayCoordinate =
      `${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`;
    cancelPendingRouteSearch();
    clearDisplayedRoute(false);
    destinationInput.value = coordinate;
    delete destinationInput.dataset.searchCleared;
    destinationInput.dataset.selectedCoordinate = coordinate;
    destinationInput.dataset.selectedLabel = coordinate;
    if (selectedPlaceId) {
      destinationInput.dataset.selectedPlaceId = selectedPlaceId;
    } else {
      delete destinationInput.dataset.selectedPlaceId;
    }
    updateSearchClearButtonVisibility();
    updateRouteEndpointsSummary();
    updateRouteInfoEmpty();
    showDestinationPanel(displayCoordinate, coordinate);
    setOptionalDestinationText(destinationCategory, "地点を選択");

    if (!destinationMarker) {
      destinationMarker = new google.maps.Marker({
        map,
        position: latLng,
        title: "目的地",
        animation: google.maps.Animation.DROP
      });
    } else {
      destinationMarker.setPosition(latLng);
    }
    destinationMarker.setTitle(displayCoordinate);

    if (selectedPlaceId) {
      void loadDestinationPlaceDetails(selectedPlaceId, selectionId, selectedPlace);
      return;
    }

    geocoder?.geocode({ location: latLng }, (results, status) => {
      if (
        selectionId !== destinationSelectionId ||
        status !== "OK" ||
        !results?.length
      ) {
        return;
      }
      const result = results[0];
      const address = result.formatted_address || coordinate;
      destinationAddress.textContent = address;
    });
  }

  function clearDestination() {
    destinationSelectionId += 1;
    cancelDestinationSuggestions();
    cancelPendingRouteSearch();
    cancelMapSelection();
    clearDisplayedRoute(false);
    clearSearchResultMap();
    destinationMarker?.setMap(null);
    destinationMarker = null;
    destinationInput.value = "";
    delete destinationInput.dataset.selectedCoordinate;
    delete destinationInput.dataset.selectedLabel;
    delete destinationInput.dataset.selectedPlaceId;
    delete destinationInput.dataset.searchCleared;
    updateSearchClearButtonVisibility();
    destinationName.textContent = "選択した目的地";
    destinationAddress.textContent = "地図上の地点";
    resetDestinationPlaceDetails();
    destinationPanel.hidden = true;
    updateRouteEndpointsSummary();
    hideStatus();
  }

  const NAVIGATION_MANEUVER_PATHS = {
    straight: "M32 56V12 M18 26L32 12 46 26",
    left: "M52 54V39C52 29 45 22 35 22H14 M27 9L14 22 27 35",
    right: "M12 54V39C12 29 19 22 29 22H50 M37 9L50 22 37 35",
    "uturn-left": "M48 54V31C48 19 41 12 31 12C21 12 14 19 14 31V43 M3 32L14 43 25 32",
    "uturn-right": "M16 54V31C16 19 23 12 33 12C43 12 50 19 50 31V43 M39 32L50 43 61 32",
    roundabout: "M46 19A20 20 0 1 0 49 42 M47 10L46 25 32 21"
  };

  function navigationManeuverKind(maneuver, instruction) {
    const value = String(maneuver || "").toLowerCase();
    if (value.includes("uturn-left")) return "uturn-left";
    if (value.includes("uturn-right")) return "uturn-right";
    if (value.includes("roundabout")) return "roundabout";
    if (value.includes("left")) return "left";
    if (value.includes("right")) return "right";
    if (value === "straight") return "straight";

    if (/(?:Uターン|Ｕターン).*(?:左|反時計)/.test(instruction)) {
      return "uturn-left";
    }
    if (/(?:Uターン|Ｕターン).*(?:右|時計)/.test(instruction)) {
      return "uturn-right";
    }
    if (/(?:Uターン|Ｕターン)/.test(instruction)) return "uturn-left";
    if (/(?:ロータリー|ラウンドアバウト|環状交差点)/.test(instruction)) {
      return "roundabout";
    }
    if (/(?:左折|左方向|左へ|左に|斜め左)/.test(instruction)) return "left";
    if (/(?:右折|右方向|右へ|右に|斜め右)/.test(instruction)) return "right";
    return "straight";
  }

  function navigationPanelDistanceText(distance) {
    if (!Number.isFinite(distance)) return "―";
    if (distance >= 1000) {
      const kilometers = distance / 1000;
      return `${kilometers < 10 ? kilometers.toFixed(1) : Math.round(kilometers)} km`;
    }
    const rounded = Math.max(10, Math.round(distance / 10) * 10);
    return `${rounded} m`;
  }

  function navigationManeuverLabel(maneuver, maneuverKind, instruction) {
    const value = String(maneuver || "").toLowerCase();
    if (maneuverKind === "uturn-left" || maneuverKind === "uturn-right") {
      return "Uターン";
    }
    if (maneuverKind === "roundabout") return "ラウンドアバウト";
    if (maneuverKind === "straight") return "直進";

    if (maneuverKind === "left") {
      if (value.includes("slight") || /斜め左/.test(instruction)) return "斜め左";
      if (value.includes("turn-left") || /左折/.test(instruction)) return "左折";
      return "左方向";
    }
    if (value.includes("slight") || /斜め右/.test(instruction)) return "斜め右";
    if (value.includes("turn-right") || /右折/.test(instruction)) return "右折";
    return "右方向";
  }

  function updateNavigationGuidance(point = getCurrentLatLng()) {
    if (!navigationGuidance || !navigationSteps.length) return;
    const currentStep = navigationSteps[currentNavigationStepIndex];
    if (!currentStep) return;
    const maneuverStep =
      navigationSteps[currentNavigationStepIndex + 1] || currentStep;
    const distance = point
      ? distanceBetweenMeters(point, currentStep.endLocation)
      : currentStep.distanceMeters;
    const maneuverKind = navigationManeuverKind(
      maneuverStep.maneuver,
      maneuverStep.instruction
    );
    navigationDistanceInstruction.textContent = navigationPanelDistanceText(distance);
    if (navigationManeuverIcon) {
      navigationManeuverIcon.dataset.maneuver = maneuverKind;
    }
    navigationManeuverPath?.setAttribute(
      "d",
      NAVIGATION_MANEUVER_PATHS[maneuverKind] || NAVIGATION_MANEUVER_PATHS.straight
    );
    if (navigationIntersectionName) {
      navigationIntersectionName.textContent = maneuverStep.intersectionName
        ? `交差点：${maneuverStep.intersectionName}`
        : "";
      navigationIntersectionName.hidden = !maneuverStep.intersectionName;
    }
    if (navigationGuidanceSecondary) {
      navigationGuidanceSecondary.hidden = !maneuverStep.intersectionName;
    }
    navigationInstruction.textContent = navigationManeuverLabel(
      maneuverStep.maneuver,
      maneuverKind,
      maneuverStep.instruction
    );
    navigationNextInstruction.textContent = "";
    navigationNextInstruction.hidden = true;
  }

  function showRouteOverview() {
    const bounds = lastRouteResult?.routes?.[0]?.bounds;
    if (!map || !bounds) return;
    navigationOverviewActive = true;
    if (followToggle) followToggle.checked = false;
    document.body.classList.add("is-overview");
    returnToLocationButton.hidden = false;
    $("rideNaviHeadingControl")?.classList.add("is-overview-hidden");
    map.fitBounds(bounds, 28);
  }

  function returnToCurrentLocation() {
    navigationOverviewActive = false;
    document.body.classList.remove("is-overview");
    returnToLocationButton.hidden = true;
    $("rideNaviHeadingControl")?.classList.remove("is-overview-hidden");
    centerOnCurrentLocation();
  }

  function isLandscapeNavigationLayout() {
    return Boolean(
      navigationActive &&
      window.matchMedia?.("(orientation: landscape) and (max-height: 500px)").matches
    );
  }

  function syncFloatingLocationButton() {
    if (!floatingLocationButton) return;

    if (!isLandscapeNavigationLayout()) {
      floatingLocationButton.classList.remove("route-overview-active");
      floatingLocationButton.setAttribute("aria-pressed", "false");
      floatingLocationButton.setAttribute("aria-label", "現在地へ");
      floatingLocationButton.title = "現在地へ";
      return;
    }

    const label = !landscapeLocationTogglePrimed
      ? "現在地を中心に表示"
      : navigationOverviewActive
        ? "現在地中心表示に戻る"
        : "ルート全体を表示";
    floatingLocationButton.classList.toggle(
      "route-overview-active",
      navigationOverviewActive
    );
    floatingLocationButton.setAttribute(
      "aria-pressed",
      navigationOverviewActive ? "true" : "false"
    );
    floatingLocationButton.setAttribute("aria-label", label);
    floatingLocationButton.title = label;
  }

  function handleFloatingLocationButton() {
    if (!isLandscapeNavigationLayout()) {
      centerOnCurrentLocation();
      return;
    }

    if (!landscapeLocationTogglePrimed) {
      centerOnCurrentLocation();
      landscapeLocationTogglePrimed = Boolean(getCurrentLatLng());
      syncFloatingLocationButton();
      return;
    }

    if (navigationOverviewActive) {
      returnToCurrentLocation();
    } else {
      showRouteOverview();
    }
    syncFloatingLocationButton();
  }

  function cancelMapSelection(showMessage = false) {
    mapSelectionTarget = null;
    map?.getDiv().classList.remove("map-selection-active");
    destinationMapButton?.setAttribute("aria-pressed", "false");
    waypointList
      ?.querySelectorAll(".map-select-button")
      .forEach((button) => button.setAttribute("aria-pressed", "false"));

    if (showMessage) hideStatus();
  }

  function startMapSelection(input, label, button = null) {
    if (!map || !input) {
      showStatus("地図を読み込んでいます");
      return;
    }

    if (mapSelectionTarget?.input === input) {
      cancelMapSelection(true);
      return;
    }

    cancelMapSelection();
    mapSelectionTarget = {
      input,
      label,
      isDestination: input === destinationInput
    };
    map.getDiv().classList.add("map-selection-active");
    button?.setAttribute("aria-pressed", "true");
    if (input === destinationInput) {
      destinationMapButton?.setAttribute("aria-pressed", "true");
    }
    showStatus(`地図上で${label}をタップしてください`);
  }

  function matchesGuidancePattern(instruction, patterns) {
    return patterns.some((pattern) => pattern.test(instruction));
  }

  function guidanceRoadNameCandidates(instructionHtml, instruction) {
    const temporary = document.createElement("div");
    temporary.innerHTML = instructionHtml || "";

    const emphasizedNames = [...temporary.querySelectorAll("b")]
      .map((element) => element.textContent.replace(/\s+/g, " ").trim())
      .filter((text) =>
        /(?:道路|高速|国道|県道|府道|都道|道道|市道|町道|村道|街道|バイパス|ロード|大橋|通り|IC|ＩＣ|インターチェンジ|入口|出口|料金所)/.test(
          text
        )
      );
    const inferredNames = [
      ...(instruction.match(
        /(?:国道|県道|府道|都道|道道|市道|町道|村道)\s*\d+\s*号(?:線)?/g
      ) || []),
      ...(instruction.match(
        /[一-龯ァ-ヶーA-Za-z0-9０-９]+(?:高速道路|自動車道|有料道路|バイパス)/g
      ) || []),
      ...(instruction.match(
        /[一-龯ァ-ヶーA-Za-z0-9０-９]+(?:道路|街道|バイパス|ロード|大橋|通り)/g
      ) || []),
      ...(instruction.match(
        /[一-龯ァ-ヶーA-Za-z0-9０-９]+(?:IC|ＩＣ|インターチェンジ)(?:入口|出口)?/g
      ) || [])
    ];
    const names = [...new Set([...emphasizedNames, ...inferredNames])];

    return names;
  }

  function guidanceRoadNames(roadNames) {
    return roadNames.length ? roadNames.join(" / ") : "取得できず";
  }

  function isDestinationRoadName(instruction, roadName) {
    const escapedRoadName = roadName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `${escapedRoadName}\\s*(?:方面|方向|へ向かう|に向かう)`
    ).test(instruction);
  }

  function classifyGuidanceRoadNames(roadNames, instruction) {
    if (
      roadNames.some((roadName) =>
        matchesGuidancePattern(
          roadName,
          ROAD_NAME_TYPE_PATTERNS.highway
        )
      )
    ) {
      return "highway";
    }

    const ordinaryRoadNames = roadNames.filter((roadName) =>
      matchesGuidancePattern(
        roadName,
        ROAD_NAME_TYPE_PATTERNS.ordinary
      )
    );

    if (
      ordinaryRoadNames.some(
        (roadName) => !isDestinationRoadName(instruction, roadName)
      )
    ) {
      return "ordinary";
    }

    return "unknown";
  }

  function matchesTollEvidence(text) {
    return TOLL_EVIDENCE_PATTERNS.some((pattern) => pattern.test(text));
  }

  function matchesExpresswayEvidence(text) {
    return EXPRESSWAY_EVIDENCE_PATTERNS.some((pattern) => pattern.test(text));
  }

  function stepPathDistanceMeters(step) {
    if (Number.isFinite(step?.distance?.value)) {
      return step.distance.value;
    }

    const path = (step?.path || []).map((point) => ({
      lat: typeof point.lat === "function" ? point.lat() : point.lat,
      lng: typeof point.lng === "function" ? point.lng() : point.lng
    }));
    let distance = 0;

    for (let index = 1; index < path.length; index += 1) {
      distance += distanceBetweenMeters(path[index - 1], path[index]);
    }

    return distance;
  }

  function routeTollUsage(route) {
    let tollActive = false;
    let unnamedTollStepCount = 0;
    let tollDistance = 0;
    let measuredDistance = 0;
    let hasTollEvidence = matchesTollEvidence(
      (route?.warnings || []).join(" ")
    );
    let hasExpresswayEvidence = false;

    route?.legs?.forEach((leg) => {
      leg.steps?.forEach((step) => {
        const instructionHtml = step.instructions || "";
        const instruction = stripHtmlInstruction(instructionHtml);
        const roadNames = guidanceRoadNameCandidates(
          instructionHtml,
          instruction
        );
        const roadNameType = classifyGuidanceRoadNames(
          roadNames,
          instruction
        );
        const stepHasTollEvidence =
          matchesTollEvidence(instruction) ||
          roadNames.some(matchesTollEvidence);
        const stepHasExpresswayEvidence =
          matchesExpresswayEvidence(instruction) ||
          roadNames.some(matchesExpresswayEvidence);
        const isExit =
          matchesGuidancePattern(
            instruction,
            HIGHWAY_GUIDANCE_PATTERNS.exit
          ) ||
          (
            tollActive &&
            matchesGuidancePattern(
              instruction,
              HIGHWAY_GUIDANCE_PATTERNS.exitIndicator
            )
          );
        const isEntry =
          (stepHasTollEvidence ||
            (hasTollEvidence && stepHasExpresswayEvidence)) &&
          matchesGuidancePattern(
            instruction,
            HIGHWAY_GUIDANCE_PATTERNS.entry
          );
        const stepDistance = stepPathDistanceMeters(step);
        const leavesTollAfterUnnamedSteps =
          tollActive &&
          roadNameType === "unknown" &&
          !isEntry &&
          unnamedTollStepCount >= MAX_UNNAMED_ACTIVE_ROAD_STEPS;
        const leavesTollOnCurrentStep =
          isExit ||
          (tollActive && roadNameType === "ordinary") ||
          leavesTollAfterUnnamedSteps;
        const entersTollAfterCurrentStep =
          !tollActive && isEntry;
        const stepUsesToll =
          !leavesTollOnCurrentStep &&
          !entersTollAfterCurrentStep &&
          (
            tollActive ||
            stepHasTollEvidence ||
            (hasTollEvidence && stepHasExpresswayEvidence)
          );

        measuredDistance += stepDistance;
        if (stepUsesToll) tollDistance += stepDistance;
        hasTollEvidence ||= stepHasTollEvidence;
        hasExpresswayEvidence ||= stepHasExpresswayEvidence;

        if (isExit) {
          tollActive = false;
          unnamedTollStepCount = 0;
        } else if (isEntry || stepHasTollEvidence) {
          tollActive = true;
          unnamedTollStepCount = 0;
        } else if (
          tollActive &&
          (roadNameType === "ordinary" || leavesTollAfterUnnamedSteps)
        ) {
          tollActive = false;
          unnamedTollStepCount = 0;
        } else if (tollActive && roadNameType === "unknown") {
          unnamedTollStepCount += 1;
        } else if (tollActive) {
          unnamedTollStepCount = 0;
        }
      });
    });

    const totalDistance =
      sumRouteTotals(route).totalDistance || measuredDistance;

    return {
      hasToll: hasTollEvidence,
      hasPaidExpressway: hasTollEvidence && hasExpresswayEvidence,
      tollDistanceRatio:
        tollDistance / Math.max(totalDistance, 1)
    };
  }

  function routeUsesBiwakoBridge(route) {
    return Boolean(
      route?.legs?.some((leg) =>
        leg.steps?.some((step) =>
          /琵琶湖大橋/.test(stripHtmlInstruction(step.instructions || ""))
        )
      )
    );
  }

  function routeModeAssessment(
    route,
    mode,
    freeRouteDuration,
    { allowNotFaster = false } = {}
  ) {
    const tollUsage = routeTollUsage(route);
    const duration = sumRouteTotals(route).totalDuration;
    const usesBiwakoBridge = routeUsesBiwakoBridge(route);
    const rejectionReasons = [];

    if (mode === "local") {
      if (tollUsage.hasToll) rejectionReasons.push("有料区間を検出");
    } else if (mode === "partial") {
      if (!Number.isFinite(freeRouteDuration)) {
        rejectionReasons.push("無料ルートの所要時間を取得できず");
      }
      if (!tollUsage.hasToll || tollUsage.tollDistanceRatio <= 0) {
        rejectionReasons.push("有料区間を特定できず");
      }
      if (tollUsage.tollDistanceRatio > PARTIAL_TOLL_MAX_DISTANCE_RATIO) {
        rejectionReasons.push("有料区間50％超過");
      }
      if (
        Number.isFinite(freeRouteDuration) &&
        duration >= freeRouteDuration &&
        !usesBiwakoBridge &&
        !allowNotFaster
      ) {
        rejectionReasons.push("無料ルートより早くない");
      }
    } else if (!tollUsage.hasPaidExpressway) {
      rejectionReasons.push("有料高速道路を特定できず");
    }

    return {
      accepted: rejectionReasons.length === 0,
      rejectionReasons,
      tollUsage,
      usesBiwakoBridge,
      freeDurationRatio: Number.isFinite(freeRouteDuration)
        ? duration / Math.max(freeRouteDuration, 1)
        : null
    };
  }

  function routeMatchesMode(route, mode, freeRouteDuration) {
    return routeModeAssessment(route, mode, freeRouteDuration).accepted;
  }

  function stepPathSummary(path) {
    const locationText = (point) => {
      const latitude =
        typeof point?.lat === "function" ? point.lat() : point?.lat;
      const longitude =
        typeof point?.lng === "function" ? point.lng() : point?.lng;

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return "取得できず";
      }

      return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    };

    return {
      点数: path.length,
      開始位置: locationText(path[0]),
      終了位置: locationText(path[path.length - 1])
    };
  }

  function logRouteColorTransition({
    route,
    context,
    legIndex,
    stepIndex,
    instruction,
    roadNames,
    path,
    transition,
    reason,
    appliesToCurrentStep,
    targetStep
  }) {
    const targetInstructionHtml = targetStep?.instructions || "";
    const targetInstruction = stripHtmlInstruction(targetInstructionHtml);
    const targetRoadNames = guidanceRoadNameCandidates(
      targetInstructionHtml,
      targetInstruction
    );

    console.info(`[RideNavi 色分け調査] ${transition}`, {
      候補番号: context.candidateNumber || "不明",
      ルート種類: context.mode ? routeModeLabel(context.mode) : "不明",
      ルート概要: route?.summary || "取得できず",
      leg番号: legIndex + 1,
      step番号: stepIndex + 1,
      案内文: instruction || "取得できず",
      道路名: guidanceRoadNames(roadNames),
      判定stepの経路形状: stepPathSummary(path),
      判定理由: reason,
      色変更対象: appliesToCurrentStep
        ? `このstep.pathから（step ${stepIndex + 1}）`
        : `次のstep.pathから（step ${stepIndex + 2}）`,
      色変更対象step: {
        step番号: appliesToCurrentStep ? stepIndex + 1 : stepIndex + 2,
        案内文: targetInstruction || "取得できず",
        道路名: guidanceRoadNames(targetRoadNames),
        経路形状: stepPathSummary(targetStep?.path || [])
      }
    });
  }

  function routeColorSegments(route, context = {}) {
    const segments = [];
    let highwayActive = false;
    let unnamedHighwayStepCount = 0;

    route?.legs?.forEach((leg, legIndex) => {
      leg.steps?.forEach((step, stepIndex) => {
        const path = step.path || [];

        const instructionHtml = step.instructions || "";
        const instruction = stripHtmlInstruction(instructionHtml);
        const roadNames = guidanceRoadNameCandidates(
          instructionHtml,
          instruction
        );
        const roadNameType = classifyGuidanceRoadNames(
          roadNames,
          instruction
        );
        const matchesExit = matchesGuidancePattern(
          instruction,
          HIGHWAY_GUIDANCE_PATTERNS.exit
        );
        const matchesExitIndicator =
          highwayActive &&
          matchesGuidancePattern(
            instruction,
            HIGHWAY_GUIDANCE_PATTERNS.exitIndicator
          );
        const isExit = matchesExit || matchesExitIndicator;
        const isApproachOnly = matchesGuidancePattern(
          instruction,
          HIGHWAY_GUIDANCE_PATTERNS.approachOnly
        );
        const isEntry =
          !isApproachOnly &&
          matchesGuidancePattern(
            instruction,
            HIGHWAY_GUIDANCE_PATTERNS.entry
          );
        const wasHighwayActive = highwayActive;
        const exitsHighwayAfterUnnamedSteps =
          wasHighwayActive &&
          roadNameType === "unknown" &&
          !isEntry &&
          !isApproachOnly &&
          unnamedHighwayStepCount >= MAX_UNNAMED_ACTIVE_ROAD_STEPS;
        const exitsHighwayOnCurrentStep =
          isExit ||
          (wasHighwayActive && roadNameType === "ordinary") ||
          exitsHighwayAfterUnnamedSteps;
        const entersHighwayAfterCurrentStep =
          !wasHighwayActive && isEntry;
        const segmentIsHighway =
          !exitsHighwayOnCurrentStep &&
          !entersHighwayAfterCurrentStep &&
          (
            wasHighwayActive ||
            (
              roadNameType === "highway" &&
              !isApproachOnly
            )
          );

        if (path.length >= 2) {
          segments.push({
            path,
            isHighway: segmentIsHighway
          });
        }

        if (isExit) {
          highwayActive = false;
          unnamedHighwayStepCount = 0;
        } else if (isEntry) {
          highwayActive = true;
          unnamedHighwayStepCount = 0;
        } else if (
          highwayActive &&
          (roadNameType === "ordinary" || exitsHighwayAfterUnnamedSteps)
        ) {
          highwayActive = false;
          unnamedHighwayStepCount = 0;
        } else if (
          !highwayActive &&
          roadNameType === "highway" &&
          !isApproachOnly
        ) {
          highwayActive = true;
          unnamedHighwayStepCount = 0;
        } else if (highwayActive && roadNameType === "unknown") {
          unnamedHighwayStepCount += 1;
        } else if (highwayActive) {
          unnamedHighwayStepCount = 0;
        }

        if (wasHighwayActive !== highwayActive) {
          const appliesToCurrentStep = !highwayActive || !isEntry;

          logRouteColorTransition({
            route,
            context,
            legIndex,
            stepIndex,
            instruction,
            roadNames,
            path,
            transition: highwayActive ? "青→赤" : "赤→青",
            appliesToCurrentStep,
            targetStep: appliesToCurrentStep
              ? step
              : leg.steps?.[stepIndex + 1],
            reason: highwayActive
              ? isEntry
                ? "高速道路・有料道路へ入る／進入する／合流する案内に一致"
                : "現在のstepで高速道路・有料道路の道路名を確認"
              : matchesExit
                ? "高速道路・有料道路から降りる／退出する案内に一致"
                : matchesExitIndicator
                  ? "高速走行中に出口・降りる・退出を示す語句に一致"
                  : exitsHighwayAfterUnnamedSteps
                    ? "道路名を連続して確認できないため一般道へ戻ったと推定"
                    : "現在のstepで一般道の道路名を確認"
          });
        }
      });
    });

    return segments;
  }

function routeLabelCandidatePositions(route, candidateIndex, isSelected) {
  const path = route.overview_path || [];
  if (!path.length) return [];

  const unselectedFractions = [0.34, 0.66, 0.5];
  const preferredFraction = isSelected
    ? 0.5
    : unselectedFractions[candidateIndex % unselectedFractions.length];
  const offsets = [0, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3];
  const usedIndexes = new Set();

  return offsets
    .map((offset) => Math.min(0.86, Math.max(0.14, preferredFraction + offset)))
    .map((fraction) => Math.round((path.length - 1) * fraction))
    .filter((pathIndex) => {
      if (usedIndexes.has(pathIndex)) return false;
      usedIndexes.add(pathIndex);
      return true;
    })
    .map((pathIndex) => path[pathIndex]);
}

function routeLabelObstacleRects(mapRect) {
  return [$("searchBar"), destinationPanel, routeSummaryPanel, controlPanel]
    .filter((element) => {
      if (!element || element.hidden) return false;
      return window.getComputedStyle(element).display !== "none";
    })
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left - mapRect.left,
        top: rect.top - mapRect.top,
        right: rect.right - mapRect.left,
        bottom: rect.bottom - mapRect.top
      };
    });
}

function routeLabelRect(point, width, height) {
  return {
    left: point.x - width / 2,
    top: point.y - height - 10,
    right: point.x + width / 2,
    bottom: point.y - 10
  };
}

function routeLabelOverlapArea(first, second, gap = 8) {
  const width = Math.max(
    0,
    Math.min(first.right, second.right + gap) -
      Math.max(first.left, second.left - gap)
  );
  const height = Math.max(
    0,
    Math.min(first.bottom, second.bottom + gap) -
      Math.max(first.top, second.top - gap)
  );
  return width * height;
}

function routeLabelPlacementScore(
  rect,
  candidateOrder,
  mapWidth,
  mapHeight,
  occupiedRects,
  obstacleRects
) {
  const edgeMargin = 8;
  const overflow =
    Math.max(0, edgeMargin - rect.left) +
    Math.max(0, rect.right - mapWidth + edgeMargin) +
    Math.max(0, edgeMargin - rect.top) +
    Math.max(0, rect.bottom - mapHeight + edgeMargin);
  const labelOverlap = occupiedRects.reduce(
    (total, occupied) => total + routeLabelOverlapArea(rect, occupied),
    0
  );
  const obstacleOverlap = obstacleRects.reduce(
    (total, obstacle) => total + routeLabelOverlapArea(rect, obstacle, 6),
    0
  );

  return (
    candidateOrder +
    overflow * 10000 +
    obstacleOverlap * 1000 +
    labelOverlap * 100000
  );
}

function createRouteLabelsOverlay(items) {
  const overlay = new google.maps.OverlayView();
  const labels = [];

  overlay.onAdd = () => {
    const pane = overlay.getPanes().overlayMouseTarget;
    items.forEach((item) => {
      const label = document.createElement("button");
      label.type = "button";
      label.className =
        `route-map-label${item.isSelected ? " is-selected" : ""}`;
      label.setAttribute(
        "aria-label",
        `${item.duration}、${item.distance}のルートを選択`
      );

      const durationElement = document.createElement("strong");
      durationElement.textContent = item.duration;
      const distanceElement = document.createElement("span");
      distanceElement.textContent = item.distance;
      label.append(durationElement, distanceElement);

      label.addEventListener("pointerdown", (event) => event.stopPropagation());
      label.addEventListener("click", (event) => {
        event.stopPropagation();
        item.onSelect();
      });
      pane.appendChild(label);
      labels.push({ label, item });
    });
  };

  overlay.draw = () => {
    const projection = overlay.getProjection();
    const mapRect = map.getDiv().getBoundingClientRect();
    const obstacleRects = routeLabelObstacleRects(mapRect);
    const occupiedRects = [];
    const orderedLabels = labels
      .slice()
      .sort(
        (first, second) =>
          Number(second.item.isSelected) - Number(first.item.isSelected)
      );

    orderedLabels.forEach(({ label, item }) => {
      const width = label.offsetWidth || 84;
      const height = label.offsetHeight || 48;
      let bestPlacement = null;

      item.positions.forEach((position, candidateOrder) => {
        const point = projection.fromLatLngToDivPixel(position);
        if (!point) return;
        const rect = routeLabelRect(point, width, height);
        const score = routeLabelPlacementScore(
          rect,
          candidateOrder,
          mapRect.width,
          mapRect.height,
          occupiedRects,
          obstacleRects
        );
        if (!bestPlacement || score < bestPlacement.score) {
          bestPlacement = { point, rect, score };
        }
      });

      if (!bestPlacement) {
        label.hidden = true;
        return;
      }

      label.hidden = false;
      label.style.left = `${bestPlacement.point.x}px`;
      label.style.top = `${bestPlacement.point.y}px`;
      occupiedRects.push(bestPlacement.rect);
    });
  };

  overlay.onRemove = () => {
    labels.forEach(({ label }) => label.remove());
    labels.length = 0;
  };

  overlay.setMap(map);
  return overlay;
}

function drawRouteOverlays() {
  clearRouteOverlays();
  const routeLabelItems = [];

  routeCandidates.forEach((candidate, index) => {
    const route = candidate.result.routes[candidate.routeIndex];
    const isSelected = index === selectedRouteIndex;
    const routeColor = isSelected ? "#102a43" : "#0057b8";
    const colorSegments = routeColorSegments(route, {
      candidateNumber: index + 1,
      mode: candidate.mode
    });
    const drawableSegments = colorSegments.length
      ? colorSegments
      : [{ path: route.overview_path, isHighway: false }];

    const selectRoute = () => {
      applyRouteCandidate(index);
    };

    drawableSegments.forEach((segment) => {
      if (isSelected) {
        const outlinePolyline = new google.maps.Polyline({
          map,
          path: segment.path,
          strokeColor: "#ffffff",
          strokeOpacity: 0.98,
          strokeWeight: 14,
          zIndex: 190,
          clickable: true
        });

        outlinePolyline.addListener("click", selectRoute);
        routePolylines.push(outlinePolyline);
      }

      const routePolyline = new google.maps.Polyline({
        map,
        path: segment.path,
        strokeColor: routeColor,
        strokeOpacity: 1,
        strokeWeight: isSelected ? 10 : 5,
        zIndex: isSelected ? 200 : 20 + index,
        clickable: true
      });

      routePolyline.addListener("click", selectRoute);
      routePolylines.push(routePolyline);

      if (segment.isHighway) {
        const tollPolyline = new google.maps.Polyline({
          map,
          path: segment.path,
          strokeColor: "#d93025",
          strokeOpacity: isSelected ? 1 : 0.9,
          strokeWeight: isSelected ? 8 : 4,
          zIndex: isSelected ? 220 : 210 + index,
          clickable: true
        });

        tollPolyline.addListener("click", selectRoute);
        routePolylines.push(tollPolyline);
      }
    });

    const labelPositions = routeLabelCandidatePositions(route, index, isSelected);

    if (labelPositions.length) {
      const totals = sumRouteTotals(route);
      routeLabelItems.push({
        positions: labelPositions,
        duration: formatDuration(totals.totalDuration),
        distance: formatDistance(totals.totalDistance),
        isSelected,
        onSelect: selectRoute
      });
    }

  });

  if (routeLabelItems.length) {
    routeLabelOverlays.push(createRouteLabelsOverlay(routeLabelItems));
  }
}



  function routeModeLabel(mode) {
    const labels = {
      highway: "🚀 高速優先",
      partial: "🛣️ 一部有料",
      local: "🌿 無料ルート"
    };
    return labels[mode] || "ルート";
  }

  function routeModeDescription(mode) {
    const descriptions = {
      highway: "有料高速道路を利用する最短時間の候補",
      partial: "有料道路を一部利用し、無料ルートより早い候補",
      local: "一般道と無料の高速道路・バイパスを使う候補"
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

  function routeModeShortLabel(mode) {
    const labels = {
      highway: "高速優先",
      partial: "一部有料",
      local: "一般道"
    };
    return labels[mode] || "ルート";
  }

  function estimateMotorcycleToll(route, mode, totals) {
    if (mode === "local") return null;

    const tollUsage = routeTollUsage(route);
    const tollDistanceKm =
      totals.totalDistance * tollUsage.tollDistanceRatio / 1000;
    const estimatedToll =
      MOTORCYCLE_TOLL_BASE_YEN +
      Math.max(tollDistanceKm, 1) * MOTORCYCLE_TOLL_PER_KM_YEN;

    return Math.max(
      MOTORCYCLE_TOLL_ROUNDING_YEN,
      Math.round(estimatedToll / MOTORCYCLE_TOLL_ROUNDING_YEN) *
        MOTORCYCLE_TOLL_ROUNDING_YEN
    );
  }

  function routeCandidateNumber(candidateIndex) {
    return ["①", "②", "③"][candidateIndex] || String(candidateIndex + 1);
  }

  function updateRouteSummaryPanel(candidateIndex, mode, route, totals) {
    if (
      !routeSummaryPanel ||
      !routeSummarySelection ||
      !routeSummaryRoadType ||
      !routeSummaryToll ||
      !routeSummaryMetrics
    ) {
      return;
    }

    routeSummarySelection.textContent =
      `選択中 ${routeCandidateNumber(candidateIndex)}`;
    routeSummaryRoadType.textContent = routeModeShortLabel(mode);
    const estimatedToll = estimateMotorcycleToll(route, mode, totals);
    routeSummaryToll.hidden = estimatedToll === null;
    routeSummaryToll.textContent =
      estimatedToll === null
        ? ""
        : `料金目安 約${estimatedToll.toLocaleString("ja-JP")}円`;
    routeSummaryToll.title =
      estimatedToll === null
        ? ""
        : "二輪車の概算料金です。実際の料金と異なる場合があります";
    routeSummaryMetrics.textContent =
      `${formatDuration(totals.totalDuration)}・` +
      formatDistance(totals.totalDistance);
    syncRouteModeControls(mode);
    if (destinationPanel) destinationPanel.hidden = true;
    routeSummaryPanel.hidden = false;
  }

  function routeShapeSortKey(route) {
    const path = routeOverviewPoints(route);
    const sampleCount = Math.min(16, path.length);

    if (!sampleCount) return "";

    return Array.from({ length: sampleCount }, (_, index) => {
      const pathIndex = Math.round(
        index * (path.length - 1) / Math.max(1, sampleCount - 1)
      );
      const point = path[pathIndex];
      return `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    }).join("|");
  }

  function compareRoutesDeterministically(firstRoute, secondRoute) {
    const firstTotals = sumRouteTotals(firstRoute);
    const secondTotals = sumRouteTotals(secondRoute);
    const durationDifference =
      firstTotals.totalDuration - secondTotals.totalDuration;

    if (durationDifference !== 0) return durationDifference;

    const distanceDifference =
      firstTotals.totalDistance - secondTotals.totalDistance;

    if (distanceDifference !== 0) return distanceDifference;

    const signatureDifference = routeSignature(firstRoute).localeCompare(
      routeSignature(secondRoute)
    );

    if (signatureDifference !== 0) return signatureDifference;
    return routeShapeSortKey(firstRoute).localeCompare(
      routeShapeSortKey(secondRoute)
    );
  }

  function sortedRouteEntries(routes) {
    return routes
      .map((route, routeIndex) => ({ route, routeIndex }))
      .sort((first, second) =>
        compareRoutesDeterministically(first.route, second.route)
      );
  }

  function routeOverviewPoints(route) {
    return (route?.overview_path || []).map((point) => ({
      lat: point.lat(),
      lng: point.lng()
    }));
  }

  function routePointAtFraction(route, fraction) {
    const path = routeOverviewPoints(route);
    if (path.length < 2) return null;

    const segmentDistances = [];
    let pathDistance = 0;

    for (let index = 0; index < path.length - 1; index += 1) {
      const segmentDistance = distanceBetweenMeters(path[index], path[index + 1]);
      segmentDistances.push(segmentDistance);
      pathDistance += segmentDistance;
    }

    if (pathDistance <= 0) return null;

    const targetDistance = pathDistance * fraction;
    let traveledDistance = 0;

    for (let index = 0; index < segmentDistances.length; index += 1) {
      const segmentDistance = segmentDistances[index];
      if (
        traveledDistance + segmentDistance < targetDistance &&
        index < segmentDistances.length - 1
      ) {
        traveledDistance += segmentDistance;
        continue;
      }

      const segmentRatio = segmentDistance > 0
        ? Math.max(
            0,
            Math.min(1, (targetDistance - traveledDistance) / segmentDistance)
          )
        : 0;
      const segmentStart = path[index];
      const segmentEnd = path[index + 1];

      return {
        point: {
          lat:
            segmentStart.lat +
            (segmentEnd.lat - segmentStart.lat) * segmentRatio,
          lng:
            segmentStart.lng +
            (segmentEnd.lng - segmentStart.lng) * segmentRatio
        },
        segmentStart,
        segmentEnd
      };
    }

    return null;
  }

  function offsetPointFromRoute(sample, offsetMeters, side) {
    const meanLatitude =
      ((sample.segmentStart.lat + sample.segmentEnd.lat) / 2) *
      Math.PI /
      180;
    const eastMeters =
      (sample.segmentEnd.lng - sample.segmentStart.lng) *
      111320 *
      Math.cos(meanLatitude);
    const northMeters =
      (sample.segmentEnd.lat - sample.segmentStart.lat) * 111320;
    const segmentLength = Math.hypot(eastMeters, northMeters);

    if (segmentLength < 1) return null;

    const sideDirection = side === "left" ? 1 : -1;
    const offsetEast =
      (-northMeters / segmentLength) * offsetMeters * sideDirection;
    const offsetNorth =
      (eastMeters / segmentLength) * offsetMeters * sideDirection;
    const longitudeScale =
      111320 * Math.max(0.1, Math.cos(sample.point.lat * Math.PI / 180));

    return {
      lat: sample.point.lat + offsetNorth / 111320,
      lng: sample.point.lng + offsetEast / longitudeScale
    };
  }

  function createAutomaticViaPoints(route, totalDistance) {
    const offsetMeters = Math.max(
      AUTO_ROUTE_MIN_OFFSET_METERS,
      Math.min(
        AUTO_ROUTE_MAX_OFFSET_METERS,
        totalDistance * AUTO_ROUTE_OFFSET_RATIO
      )
    );
    const viaPoints = [];

    AUTO_ROUTE_FRACTIONS.forEach((fraction) => {
      const sample = routePointAtFraction(route, fraction);
      if (!sample) return;

      ["left", "right"].forEach((side) => {
        const location = offsetPointFromRoute(sample, offsetMeters, side);
        if (!location) return;

        viaPoints.push({
          fraction,
          side,
          offsetMeters,
          location
        });
      });
    });

    return viaPoints;
  }

  function createBiwakoBridgeViaPoint(route) {
    const routePath = routeOverviewPoints(route);

    if (routePath.length < 2) return null;
    if (
      minimumDistanceToPathMeters(
        BIWAKO_BRIDGE_VIA_POINT,
        routePath
      ) > BIWAKO_BRIDGE_SEARCH_DISTANCE_METERS
    ) {
      return null;
    }

    return {
      kind: "biwako-bridge",
      label: "琵琶湖大橋固定点",
      fraction: 0.5,
      side: "fixed",
      offsetMeters: 0,
      location: { ...BIWAKO_BRIDGE_VIA_POINT }
    };
  }

  function createAdditionalViaPoints(route, totalDistance, mode) {
    const automaticViaPoints = createAutomaticViaPoints(route, totalDistance);

    if (mode !== "partial") return automaticViaPoints;

    const bridgeViaPoint = createBiwakoBridgeViaPoint(route);
    return bridgeViaPoint
      ? [bridgeViaPoint, ...automaticViaPoints]
      : automaticViaPoints;
  }

  function routeLegPathPoints(leg) {
    const path = [];

    leg?.steps?.forEach((step) => {
      step.path?.forEach((point) => {
        path.push({
          lat: point.lat(),
          lng: point.lng()
        });
      });
    });

    if (path.length >= 2) return path;

    return [leg?.start_location, leg?.end_location]
      .filter(Boolean)
      .map((point) => ({
        lat: point.lat(),
        lng: point.lng()
      }));
  }

  function nearestRouteLegIndex(route, point) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    route?.legs?.forEach((leg, index) => {
      const path = routeLegPathPoints(leg);
      if (path.length < 2) return;

      const distance = minimumDistanceToPathMeters(point, path);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    return nearestIndex;
  }

  function minimumDistanceToPathMeters(point, path) {
    let minimumDistance = Infinity;

    for (let index = 0; index < path.length - 1; index += 1) {
      minimumDistance = Math.min(
        minimumDistance,
        distancePointToSegmentMeters(point, path[index], path[index + 1])
      );
    }

    return minimumDistance;
  }

  function sampleRouteOverview(route, maximumPoints = 100) {
    const path = routeOverviewPoints(route);
    if (path.length <= maximumPoints) return path;

    return Array.from({ length: maximumPoints }, (_, index) => {
      const pathIndex = Math.round(
        index * (path.length - 1) / Math.max(1, maximumPoints - 1)
      );
      return path[pathIndex];
    });
  }

  function routeDirectionMetrics(route, referenceRoute) {
    const referencePath = routeOverviewPoints(referenceRoute);
    const routePath = sampleRouteOverview(route);

    if (referencePath.length < 2 || routePath.length < 2) {
      return {
        directDistance: 0,
        behindOriginDistance: 0,
        beyondDestinationDistance: 0,
        maximumBacktrackDistance: 0,
        isLargeReverse: false
      };
    }

    const origin = referencePath[0];
    const destination = referencePath[referencePath.length - 1];
    const meanLatitude =
      ((origin.lat + destination.lat) / 2) * Math.PI / 180;
    const longitudeScale =
      111320 * Math.max(0.1, Math.cos(meanLatitude));
    const destinationVector = {
      east: (destination.lng - origin.lng) * longitudeScale,
      north: (destination.lat - origin.lat) * 111320
    };
    const directDistance = Math.hypot(
      destinationVector.east,
      destinationVector.north
    );

    if (directDistance < 1) {
      return {
        directDistance,
        behindOriginDistance: 0,
        beyondDestinationDistance: 0,
        maximumBacktrackDistance: 0,
        isLargeReverse: false
      };
    }

    const progressDistances = routePath.map((point) => {
      const pointVector = {
        east: (point.lng - origin.lng) * longitudeScale,
        north: (point.lat - origin.lat) * 111320
      };

      return (
        pointVector.east * destinationVector.east +
        pointVector.north * destinationVector.north
      ) / directDistance;
    });
    let furthestProgress = progressDistances[0];
    let maximumBacktrackDistance = 0;

    progressDistances.forEach((progressDistance) => {
      maximumBacktrackDistance = Math.max(
        maximumBacktrackDistance,
        furthestProgress - progressDistance
      );
      furthestProgress = Math.max(furthestProgress, progressDistance);
    });

    const minimumProgress = Math.min(...progressDistances);
    const maximumProgress = Math.max(...progressDistances);
    const behindOriginDistance = Math.max(0, -minimumProgress);
    const beyondDestinationDistance = Math.max(
      0,
      maximumProgress - directDistance
    );
    const endpointTolerance = Math.max(1500, directDistance * 0.12);
    const backtrackTolerance = Math.max(3000, directDistance * 0.25);

    return {
      directDistance,
      behindOriginDistance,
      beyondDestinationDistance,
      maximumBacktrackDistance,
      isLargeReverse:
        behindOriginDistance > endpointTolerance ||
        beyondDestinationDistance > endpointTolerance ||
        maximumBacktrackDistance > backtrackTolerance
    };
  }

  function maximumRouteDeviationMeters(route, referenceRoute) {
    const routePath = sampleRouteOverview(route, 80);
    const referencePath = routeOverviewPoints(referenceRoute);

    if (routePath.length < 2 || referencePath.length < 2) {
      return 0;
    }

    return Math.max(
      ...routePath.map((point) =>
        minimumDistanceToPathMeters(point, referencePath)
      )
    );
  }

  function routeHasLoop(route) {
    const path = sampleRouteOverview(route, 120);
    if (path.length < 6) return false;

    const cumulativeDistances = [0];
    for (let index = 1; index < path.length; index += 1) {
      cumulativeDistances.push(
        cumulativeDistances[index - 1] +
        distanceBetweenMeters(path[index - 1], path[index])
      );
    }

    const totalDistance =
      cumulativeDistances[cumulativeDistances.length - 1];
    const minimumTravelDistance = Math.max(
      2000,
      totalDistance * 0.08
    );
    const revisitDistance = Math.min(
      600,
      Math.max(250, totalDistance * 0.005)
    );

    for (let firstIndex = 0; firstIndex < path.length - 3; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 3;
        secondIndex < path.length;
        secondIndex += 1
      ) {
        const traveledDistance =
          cumulativeDistances[secondIndex] -
          cumulativeDistances[firstIndex];

        if (traveledDistance < minimumTravelDistance) continue;
        if (
          distanceBetweenMeters(
            path[firstIndex],
            path[secondIndex]
          ) <= revisitDistance
        ) {
          return true;
        }
      }
    }

    return false;
  }

  function evaluateRoutePracticality(route, referenceRoute) {
    const routeTotals = sumRouteTotals(route);
    const referenceTotals = sumRouteTotals(referenceRoute);
    const durationRatio =
      routeTotals.totalDuration /
      Math.max(referenceTotals.totalDuration, 1);
    const directionMetrics = routeDirectionMetrics(
      route,
      referenceRoute
    );
    const maximumDeviation = maximumRouteDeviationMeters(
      route,
      referenceRoute
    );
    const deviationLimit = Math.max(
      5000,
      Math.min(15000, referenceTotals.totalDistance * 0.25)
    );
    const hasLoop = routeHasLoop(route);
    const rejectionReasons = [];

    if (directionMetrics.isLargeReverse) {
      rejectionReasons.push("逆方向への大きな進行");
    }
    if (maximumDeviation > deviationLimit) {
      rejectionReasons.push("最短ルートから極端に離脱");
    }
    if (hasLoop) {
      rejectionReasons.push("折り返し・ループ");
    }
    if (durationRatio > AUTO_ROUTE_MAX_DURATION_RATIO) {
      rejectionReasons.push("所要時間1.3倍超過");
    }

    return {
      accepted: rejectionReasons.length === 0,
      rejectionReasons,
      durationRatio,
      directionMetrics,
      maximumDeviation,
      deviationLimit,
      hasLoop
    };
  }

  function routePathCoverage(sourcePath, targetPath) {
    const sampleCount = Math.min(60, sourcePath.length);
    let nearbyPointCount = 0;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const sourceIndex = Math.round(
        sampleIndex * (sourcePath.length - 1) / Math.max(1, sampleCount - 1)
      );
      const distance = minimumDistanceToPathMeters(
        sourcePath[sourceIndex],
        targetPath
      );

      if (distance <= 80) {
        nearbyPointCount += 1;
      }
    }

    return nearbyPointCount / sampleCount;
  }

  function compareRouteShapes(firstRoute, secondRoute) {
    const firstPath = routeOverviewPoints(firstRoute);
    const secondPath = routeOverviewPoints(secondRoute);

    if (firstPath.length < 2 || secondPath.length < 2) {
      return {
        firstCoverage: 0,
        secondCoverage: 0,
        overlapRatio: 0,
        distanceDifference: Infinity,
        isNearlySame: false
      };
    }

    const firstDistance = sumRouteTotals(firstRoute).totalDistance;
    const secondDistance = sumRouteTotals(secondRoute).totalDistance;
    const distanceDifference =
      Math.abs(firstDistance - secondDistance) /
      Math.max(firstDistance, secondDistance, 1);
    const firstCoverage = routePathCoverage(firstPath, secondPath);
    const secondCoverage = routePathCoverage(secondPath, firstPath);

    return {
      firstCoverage,
      secondCoverage,
      overlapRatio: Math.min(firstCoverage, secondCoverage),
      distanceDifference,
      isNearlySame:
        distanceDifference <= 0.1 &&
        firstCoverage >= 0.9 &&
        secondCoverage >= 0.9
    };
  }

  function routesHaveNearlySameShape(firstRoute, secondRoute) {
    return compareRouteShapes(firstRoute, secondRoute).isNearlySame;
  }

  function logRouteSearchDiagnostics(diagnostics) {
    const summary = {
      キャッシュ使用: diagnostics.cacheHit,
      条件別キャッシュキー: diagnostics.cacheKey,
      APIリクエスト数: diagnostics.apiRequestCount,
      API取得数: diagnostics.apiRouteCount,
      APIエラー数: diagnostics.apiErrorCount,
      重複除外数:
        diagnostics.signatureDuplicateCount +
        diagnostics.shapeDuplicateCount,
      簡易署名重複数: diagnostics.signatureDuplicateCount,
      形状重複数: diagnostics.shapeDuplicateCount,
      距離倍率除外数: diagnostics.distanceExcludedCount,
      実用性判定逆方向除外数:
        diagnostics.practicalityDirectionExcludedCount,
      実用性判定地域外れ除外数:
        diagnostics.practicalityDeviationExcludedCount,
      実用性判定ループ除外数:
        diagnostics.practicalityLoopExcludedCount,
      実用性判定時間超過除外数:
        diagnostics.practicalityDurationExcludedCount,
      追加検索実行: diagnostics.automaticSearchExecuted,
      追加検索判定理由: diagnostics.automaticSearchReason,
      追加検索前候補数: diagnostics.automaticSearchInitialCandidateCount,
      追加予定数: diagnostics.automaticSearchNeededCount,
      自動通過点検索数: diagnostics.generatedViaRequestCount,
      最終採用数: diagnostics.finalAcceptedCount
    };

    console.groupCollapsed?.(
      `[Ride Navi] ルート検索診断 #${diagnostics.searchId}`
    );
    console.log(summary);
    if (diagnostics.generatedViaPoints.length) {
      console.info("[Ride Navi] 自動通過点候補");
      console.table?.(diagnostics.generatedViaPoints);
    }
    console.table?.(diagnostics.candidates);
    console.groupEnd?.();
  }

  function makeSingleRouteResult(result, routeIndex) {
    return {
      ...result,
      routes: [result.routes[routeIndex]]
    };
  }

  function applyRouteCandidate(candidateIndex, announce = true) {
    if (displayedRouteSearchId !== latestRouteSearchId) return;

    const candidate = routeCandidates[candidateIndex];
    if (!candidate) return;

    selectedRouteIndex = candidateIndex;
    selectedRouteMode = candidate.mode;
    const singleResult = makeSingleRouteResult(
      candidate.result,
      candidate.routeIndex
    );
    const route = singleResult.routes[0];

    directionsRenderer.setOptions({
      preserveViewport: true,
      polylineOptions: {
        strokeOpacity: 0,
        strokeWeight: 0
      }
    });
    if (route?.bounds) {
      map.fitBounds(route.bounds);
    }
    directionsRenderer.setDirections(singleResult);

    lastRouteResult = singleResult;
    buildNavigationSteps(singleResult);
    updateRoutePath(singleResult);

    const totals = sumRouteTotals(route);
    updateNavigationInfoPanel(route);
    updateRouteSummaryPanel(candidateIndex, candidate.mode, route, totals);

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
      hideStatus();
    }
  }

function showRouteChoices(candidates, searchId) {
  if (searchId !== latestRouteSearchId) return false;

  hideRouteChoices();

  displayedRouteSearchId = searchId;
  routeCandidates = candidates;
  selectedRouteIndex = 0;

  applyRouteCandidate(0, false);
  return true;
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

    const mapButton = document.createElement("button");
    mapButton.type = "button";
    mapButton.className = "map-select-button";
    mapButton.textContent = "MAP";
    mapButton.setAttribute("aria-label", "地図から経由地を選択");
    mapButton.setAttribute("aria-pressed", "false");

    mapButton.addEventListener("click", () => {
      startMapSelection(input, `経由地${number.textContent}`, mapButton);
    });

    removeButton.addEventListener("click", () => {
      if (mapSelectionTarget?.input === input) cancelMapSelection();
      row.remove();
      updateWaypointDisplay();
      updateRouteInfoEmpty();
      hideStatus();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        searchRoute();
      }
    });

    row.append(number, input, mapButton, removeButton);
    waypointList.appendChild(row);

    updateWaypointDisplay();
    updateRouteInfoEmpty();
    input.focus();
    hideStatus();
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
    if (navigationActive) {
      stopNavigation(true);
      if (showMessage) hideStatus();
      return;
    }
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
    displayedRouteSearchId = 0;
    routeCandidates = [];
    selectedRouteIndex = 0;
    hideNavigationInfoPanel();
    if (routeSummaryPanel) routeSummaryPanel.hidden = true;
    if (navigationButton) navigationButton.disabled = true;
    if (directionsRenderer) {
      directionsRenderer.setDirections({ routes: [] });
    }

    updateRouteInfoEmpty();

    if (showMessage) {
      hideStatus();
    }
  
 }
  function getCurrentLatLng() {
    if (!currentPosition) return null;

    return {
      lat: currentPosition.coords.latitude,
      lng: currentPosition.coords.longitude
    };
  }

  function bearingBetweenPoints(from, to) {
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const toDegrees = (radians) => radians * 180 / Math.PI;
    const fromLat = toRadians(from.lat);
    const toLat = toRadians(to.lat);
    const deltaLng = toRadians(to.lng - from.lng);
    const y = Math.sin(deltaLng) * Math.cos(toLat);
    const x =
      Math.cos(fromLat) * Math.sin(toLat) -
      Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);
    return (toDegrees(Math.atan2(y, x)) + 360) % 360;
  }

  function normalizeHeading(heading) {
    return ((heading % 360) + 360) % 360;
  }

  function shortestHeadingDelta(fromHeading, toHeading) {
    return (
      (normalizeHeading(toHeading) - normalizeHeading(fromHeading) + 540) %
      360
    ) - 180;
  }

  function filteredNavigationHeading(candidateHeading, speed, movedMeters) {
    if (!Number.isFinite(candidateHeading)) return lastKnownHeading;

    const normalizedHeading = normalizeHeading(candidateHeading);
    if (!Number.isFinite(lastKnownHeading)) return normalizedHeading;

    if (
      Number.isFinite(speed) &&
      speed < NAVIGATION_STOPPED_SPEED_MPS &&
      movedMeters < 2
    ) {
      return lastKnownHeading;
    }

    const headingDelta = Math.abs(
      shortestHeadingDelta(lastKnownHeading, normalizedHeading)
    );
    const jitterThreshold =
      Number.isFinite(speed) && speed < NAVIGATION_LOW_SPEED_MPS
        ? NAVIGATION_LOW_SPEED_HEADING_JITTER_DEGREES
        : NAVIGATION_HEADING_JITTER_DEGREES;

    return headingDelta < jitterThreshold
      ? lastKnownHeading
      : normalizedHeading;
  }

  function createNavigationArrowIcon(heading = 0) {
    const normalizedHeading = ((heading % 360) + 360) % 360;
    const roundedHeading = Math.round(normalizedHeading / 5) * 5 % 360;
    const displaySize = 48;
    const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const cacheKey = `${roundedHeading}-${pixelRatio}`;
    if (navigationArrowIconCache.has(cacheKey)) {
      return navigationArrowIconCache.get(cacheKey);
    }

    const canvas = document.createElement("canvas");
    canvas.width = displaySize * pixelRatio;
    canvas.height = displaySize * pixelRatio;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.scale(pixelRatio, pixelRatio);
    context.translate(displaySize / 2, displaySize / 2);
    context.rotate(roundedHeading * Math.PI / 180);
    context.translate(-displaySize / 2, -displaySize / 2);
    context.beginPath();
    context.moveTo(24, 5);
    context.lineTo(40, 39);
    context.lineTo(24, 33);
    context.lineTo(8, 39);
    context.closePath();
    context.fillStyle = "#1a73e8";
    context.strokeStyle = "#ffffff";
    context.lineWidth = 3.5;
    context.lineJoin = "round";
    context.shadowColor = "rgba(0, 0, 0, 0.32)";
    context.shadowBlur = 4;
    context.shadowOffsetY = 2;
    context.fill();
    context.stroke();

    const icon = {
      url: canvas.toDataURL("image/png"),
      scaledSize: new google.maps.Size(displaySize, displaySize),
      anchor: new google.maps.Point(displaySize / 2, displaySize / 2)
    };
    navigationArrowIconCache.set(cacheKey, icon);
    return icon;
  }

  function updateLocationMarkerHeading(heading = lastKnownHeading) {
    if (!userMarker) return;
    const icon = createNavigationArrowIcon(
      headingUpEnabled ? 0 : (heading || 0)
    );
    if (icon) userMarker.setIcon(icon);
  }

  function navigationCameraOffsetPixels() {
    const mapHeight = map?.getDiv()?.clientHeight || 0;
    return Math.max(
      0,
      Math.round(mapHeight * (NAVIGATION_VEHICLE_SCREEN_Y_RATIO - 0.5))
    );
  }

  function navigationCameraCenter(point) {
    const projection = map?.getProjection?.();
    const zoom = map?.getZoom?.();
    if (!projection || !Number.isFinite(zoom)) return null;

    const worldPoint = projection.fromLatLngToPoint(point);
    if (!worldPoint) return null;

    const headingRadians = ((map.getHeading?.() || 0) * Math.PI) / 180;
    const worldOffset = navigationCameraOffsetPixels() / 2 ** zoom;
    return projection.fromPointToLatLng(
      new google.maps.Point(
        worldPoint.x + Math.sin(headingRadians) * worldOffset,
        worldPoint.y - Math.cos(headingRadians) * worldOffset
      )
    );
  }

  function panToNavigationLocation(point) {
    if (!navigationActive || navigationOverviewActive) {
      map.panTo(point);
      return;
    }

    const cameraCenter = navigationCameraCenter(point);
    if (cameraCenter) {
      map.panTo(cameraCenter);
      return;
    }

    map.panTo(point);
    map.panBy(0, -navigationCameraOffsetPixels());
  }

  function cancelNavigationVisualAnimation() {
    if (navigationVisualFrame === null) return;
    window.cancelAnimationFrame(navigationVisualFrame);
    navigationVisualFrame = null;
  }

  function setNavigationCameraLocation(point) {
    if (
      !navigationActive ||
      navigationOverviewActive ||
      !followToggle?.checked
    ) {
      return;
    }

    const cameraCenter = navigationCameraCenter(point);
    if (cameraCenter) {
      map.setCenter(cameraCenter);
      return;
    }

    map.setCenter(point);
    map.panBy(0, -navigationCameraOffsetPixels());
  }

  function renderNavigationVisual(point, heading) {
    displayedNavigationPoint = point;
    if (Number.isFinite(heading)) {
      displayedNavigationHeading = normalizeHeading(heading);
    }

    userMarker?.setPosition(point);
    accuracyCircle?.setCenter(point);
    updateLocationMarkerHeading(displayedNavigationHeading);

    if (headingUpEnabled && Number.isFinite(displayedNavigationHeading)) {
      map.setHeading(displayedNavigationHeading);
    }
    setNavigationCameraLocation(point);
  }

  function animateNavigationVisual(targetPoint, targetHeading) {
    const startPoint = displayedNavigationPoint || targetPoint;
    const startHeading = Number.isFinite(displayedNavigationHeading)
      ? displayedNavigationHeading
      : targetHeading;
    const movedMeters = distanceBetweenMeters(startPoint, targetPoint);
    const duration = movedMeters > NAVIGATION_LARGE_JUMP_METERS
      ? NAVIGATION_LARGE_JUMP_ANIMATION_MS
      : NAVIGATION_POSITION_ANIMATION_MS;

    cancelNavigationVisualAnimation();

    if (
      typeof window.requestAnimationFrame !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      renderNavigationVisual(targetPoint, targetHeading);
      return;
    }

    const longitudeDelta =
      ((targetPoint.lng - startPoint.lng + 540) % 360) - 180;
    const headingDelta =
      Number.isFinite(startHeading) && Number.isFinite(targetHeading)
        ? shortestHeadingDelta(startHeading, targetHeading)
        : 0;
    let startTime = null;

    const step = (timestamp) => {
      if (!navigationActive) {
        navigationVisualFrame = null;
        return;
      }

      if (startTime === null) startTime = timestamp;
      const progress = Math.min(1, (timestamp - startTime) / duration);
      const easedProgress = 1 - (1 - progress) ** 3;
      const point = {
        lat:
          startPoint.lat +
          (targetPoint.lat - startPoint.lat) * easedProgress,
        lng: startPoint.lng + longitudeDelta * easedProgress
      };
      const heading = Number.isFinite(startHeading)
        ? normalizeHeading(startHeading + headingDelta * easedProgress)
        : targetHeading;

      renderNavigationVisual(point, heading);

      if (progress < 1) {
        navigationVisualFrame = window.requestAnimationFrame(step);
      } else {
        renderNavigationVisual(targetPoint, targetHeading);
        navigationVisualFrame = null;
      }
    };

    navigationVisualFrame = window.requestAnimationFrame(step);
  }

  function cancelNavigationStartMapAnimation() {
    navigationStartAnimationTimers.forEach((timer) => clearTimeout(timer));
    navigationStartAnimationTimers = [];
    if (navigationStartPanFrame !== null) {
      window.cancelAnimationFrame(navigationStartPanFrame);
      navigationStartPanFrame = null;
    }
    if (navigationStartZoomFrame !== null) {
      window.cancelAnimationFrame(navigationStartZoomFrame);
      navigationStartZoomFrame = null;
    }
  }

  function navigationStartMapHeading(point) {
    if (Number.isFinite(lastKnownHeading)) return lastKnownHeading;
    if (!routePathPoints.length) return null;

    let nearestIndex = 0;
    let nearestDistance = Infinity;
    routePathPoints.forEach((routePoint, index) => {
      const distance = distanceBetweenMeters(point, routePoint);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    const forwardPoint = routePathPoints
      .slice(nearestIndex + 1)
      .find((routePoint) => distanceBetweenMeters(point, routePoint) >= 60);
    return forwardPoint ? bearingBetweenPoints(point, forwardPoint) : null;
  }

  function animateNavigationStartPan(point) {
    const startCenter = map.getCenter();
    if (!startCenter || typeof window.requestAnimationFrame !== "function") {
      map.panTo(point);
      return;
    }

    const startLat = startCenter.lat();
    const startLng = startCenter.lng();
    const longitudeDelta = ((point.lng - startLng + 540) % 360) - 180;
    let startTime = null;
    const step = (timestamp) => {
      if (!navigationActive) {
        navigationStartPanFrame = null;
        return;
      }
      if (startTime === null) startTime = timestamp;
      const progress = Math.min(
        1,
        (timestamp - startTime) / NAVIGATION_START_PAN_DURATION_MS
      );
      const easedProgress = 1 - (1 - progress) ** 3;
      map.setCenter({
        lat: startLat + (point.lat - startLat) * easedProgress,
        lng: startLng + longitudeDelta * easedProgress
      });

      if (progress < 1) {
        navigationStartPanFrame = window.requestAnimationFrame(step);
      } else {
        map.setCenter(point);
        navigationStartPanFrame = null;
      }
    };
    navigationStartPanFrame = window.requestAnimationFrame(step);
  }

  function animateNavigationStartZoom(targetZoom) {
    const startZoom = map.getZoom();
    if (
      !Number.isFinite(startZoom) ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      map.setZoom(targetZoom);
      return;
    }

    let startTime = null;
    const step = (timestamp) => {
      if (!navigationActive) {
        navigationStartZoomFrame = null;
        return;
      }
      if (startTime === null) startTime = timestamp;
      const progress = Math.min(
        1,
        (timestamp - startTime) / NAVIGATION_START_ZOOM_DURATION_MS
      );
      const easedProgress = progress < 0.5
        ? 4 * progress ** 3
        : 1 - (-2 * progress + 2) ** 3 / 2;
      map.setZoom(startZoom + (targetZoom - startZoom) * easedProgress);

      if (progress < 1) {
        navigationStartZoomFrame = window.requestAnimationFrame(step);
      } else {
        map.setZoom(targetZoom);
        navigationStartZoomFrame = null;
      }
    };
    navigationStartZoomFrame = window.requestAnimationFrame(step);
  }

  function animateNavigationStartMap(point) {
    cancelNavigationStartMapAnimation();
    const targetZoom = window.matchMedia("(max-width: 699px)").matches
      ? NAVIGATION_START_ZOOM_MOBILE
      : NAVIGATION_START_ZOOM_DESKTOP;
    const startHeading = navigationStartMapHeading(point);

    followToggle.checked = false;

    const applyHeadingAndOffset = () => {
      if (!navigationActive) return;
      const currentHeading = Number.isFinite(lastKnownHeading)
        ? lastKnownHeading
        : startHeading;
      if (headingUpEnabled && Number.isFinite(currentHeading)) {
        map.setHeading(currentHeading);
      } else if (!headingUpEnabled) {
        map.setHeading(0);
      }
      updateLocationMarkerHeading();
      panToNavigationLocation(point);
    };
    const enableFollow = () => {
      if (!navigationActive) return;
      followToggle.checked = true;
      navigationStartAnimationTimers = [];
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      map.panTo(point);
      map.setZoom(targetZoom);
      applyHeadingAndOffset();
      enableFollow();
      return;
    }

    animateNavigationStartPan(point);
    navigationStartAnimationTimers.push(
      setTimeout(() => {
        if (navigationActive) animateNavigationStartZoom(targetZoom);
      }, NAVIGATION_START_ZOOM_DELAY_MS),
      setTimeout(applyHeadingAndOffset, NAVIGATION_START_HEADING_DELAY_MS),
      setTimeout(enableFollow, NAVIGATION_START_FOLLOW_DELAY_MS)
    );
  }

  function updateGps(position) {
    currentPosition = position;

    const point = getCurrentLatLng();
    const accuracy = Math.round(position.coords.accuracy || 0);
    const movedMeters = previousGpsPoint
      ? distanceBetweenMeters(previousGpsPoint, point)
      : 0;
    const elapsedSeconds =
      Number.isFinite(previousGpsTimestamp) &&
      Number.isFinite(position.timestamp) &&
      position.timestamp > previousGpsTimestamp
        ? (position.timestamp - previousGpsTimestamp) / 1000
        : null;
    const speed =
      Number.isFinite(position.coords.speed) && position.coords.speed >= 0
        ? position.coords.speed
        : Number.isFinite(elapsedSeconds) && elapsedSeconds > 0
          ? movedMeters / elapsedSeconds
          : null;
    let candidateHeading = null;

    if (
      Number.isFinite(position.coords.heading) &&
      position.coords.heading >= 0
    ) {
      candidateHeading = position.coords.heading;
    } else if (previousGpsPoint && movedMeters >= 3) {
      candidateHeading = bearingBetweenPoints(previousGpsPoint, point);
    }
    if (Number.isFinite(candidateHeading)) {
      lastKnownHeading = navigationActive
        ? filteredNavigationHeading(candidateHeading, speed, movedMeters)
        : normalizeHeading(candidateHeading);
    }
    previousGpsPoint = point;
    previousGpsTimestamp = Number.isFinite(position.timestamp)
      ? position.timestamp
      : Date.now();

    if (!userMarker) {
      userMarker = new google.maps.Marker({
        map,
        position: point,
        title: "現在地",
        zIndex: 1000,
        optimized: false
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
      displayedNavigationPoint = point;
      displayedNavigationHeading = lastKnownHeading;
    }

    accuracyCircle.setRadius(accuracy);

    if (navigationActive) {
      animateNavigationVisual(point, lastKnownHeading);
    } else {
      cancelNavigationVisualAnimation();
      displayedNavigationPoint = point;
      displayedNavigationHeading = lastKnownHeading;
      userMarker.setPosition(point);
      accuracyCircle.setCenter(point);
      updateLocationMarkerHeading();
      if (headingUpEnabled && Number.isFinite(lastKnownHeading)) {
        map.setHeading(lastKnownHeading);
      }
      if (followToggle.checked) map.panTo(point);
    }

    if (navigationActive) {
      updateNavigationGuidance(point);
      updateNavigationProgress(point);
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
    updateRouteEndpointsSummary();
    hideStatus();
  }

  function centerOnCurrentLocation() {
    const point = getCurrentLatLng();

    if (!map || !point) {
      showStatus("現在地を取得しています");
      return;
    }
followToggle.checked = true;
    navigationOverviewActive = false;
    document.body.classList.remove("is-overview");
    if (returnToLocationButton) returnToLocationButton.hidden = true;
    $("rideNaviHeadingControl")?.classList.remove("is-overview-hidden");
    if (navigationActive) {
      map.setZoom(16);
      panToNavigationLocation(point);
    } else {
      map.panTo(point);
      map.setZoom(16);
    }
  }

  function toggleTrafficLayer() {
    if (!trafficLayer || !map) return;

    trafficLayer.setMap(trafficToggle.checked ? map : null);

    hideStatus();
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
    hideStatus();
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

  function extractIntersectionName(instruction) {
    const match = instruction.match(
      /(?:^|[、。\s])([^、。]{1,24}?(?:交差点|ジャンクション|JCT|ＪＣＴ))(?=[をでへに、。\s]|$)/i
    );
    if (!match) return "";
    return match[1]
      .replace(/^(?:次の|この|その|信号のある)\s*/, "")
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
          maneuver: step.maneuver || "",
          intersectionName: extractIntersectionName(instruction),
          endLocation: {
            lat: step.end_location.lat(),
            lng: step.end_location.lng()
          },
          distanceMeters: step.distance?.value || 0,
          durationSeconds:
            step.duration_in_traffic?.value || step.duration?.value || 0,
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

      updateNavigationGuidance(point);
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

  function updateNavigationProgress(point) {
    if (!navigationActive || !point || !navigationSteps.length) return;
    const currentStep = navigationSteps[currentNavigationStepIndex];
    if (!currentStep) return;

    const distanceToTurn = distanceBetweenMeters(point, currentStep.endLocation);
    const currentRatio = Math.min(
      1,
      distanceToTurn / Math.max(currentStep.distanceMeters, 1)
    );
    let remainingDistance = Math.min(
      distanceToTurn,
      Math.max(currentStep.distanceMeters, distanceToTurn)
    );
    let remainingDuration = currentStep.durationSeconds * currentRatio;

    navigationSteps.slice(currentNavigationStepIndex + 1).forEach((step) => {
      remainingDistance += step.distanceMeters;
      remainingDuration += step.durationSeconds;
    });

    navigationDistanceValue.textContent = formatDistance(remainingDistance);
    navigationDurationValue.textContent = formatDuration(remainingDuration);
    navigationEtaValue.textContent = formatEta(remainingDuration);
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

    const destination = destinationRouteValue();

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
      avoidHighways: false,
      avoidTolls: selectedRouteMode === "local",
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
      updateRouteSummaryPanel(
        selectedRouteIndex,
        selectedRouteMode,
        route,
        totals
      );

      routeInfo.innerHTML =
        `距離：${formatDistance(totals.totalDistance)}<br>` +
        `時間：${formatDuration(totals.totalDuration)}<br>` +
        `残り経由地：${remainingWaypoints.length}か所`;

      hideStatus();
      speakNavigation("新しいルートに切り替えました。");
    });
  }

  function createNavigationButton() {
    if (!navigationButton) return;

    hideNavigationInfoPanel();
    navigationButton.disabled = true;
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
    displayedNavigationPoint = point;
    displayedNavigationHeading = lastKnownHeading;
    landscapeLocationTogglePrimed = false;
    headingUpEnabled = true;
    navigationButton.textContent = "■ ナビ終了";
    document.body.classList.add("is-navigating");
    document.body.classList.remove("is-overview");
    $("rideNaviHeadingControl")?.classList.remove("is-overview-hidden");
    syncFloatingLocationButton();
    if (navigationGuidance) navigationGuidance.hidden = false;
    if (navigationDestination) {
      navigationDestination.textContent =
        destinationName?.textContent || destinationInput.value.trim() || "目的地";
    }
    if (lastRouteResult?.routes?.[0]) {
      updateNavigationInfoPanel(lastRouteResult.routes[0]);
    }
    showNavigationInfoPanel();
    userMarker?.setVisible(true);
    animateNavigationStartMap(point);
    if (headingButton) {
      headingButton.classList.add("active");
      headingButton.setAttribute("aria-pressed", "true");
      headingButton.title = "北を上に固定";
      headingButton.setAttribute("aria-label", "北を上に固定");
    }
    updateLocationMarkerHeading();
    closePanel();
    updateNavigationGuidance(point);

    const firstInstruction = navigationSteps[0]?.instruction;
    if (firstInstruction) {
      showStatus(`ナビ開始：${firstInstruction}`, true);
    } else {
      hideStatus();
    }
    speakNavigation(
      firstInstruction
        ? `ナビを開始します。最初の案内は、${firstInstruction}`
        : "ナビを開始します。安全運転で走行してください。"
    );
  }

  function stopNavigation(speak = true) {
    cancelNavigationStartMapAnimation();
    cancelNavigationVisualAnimation();
    navigationActive = false;
    landscapeLocationTogglePrimed = false;
    offRouteCount = 0;
    rerouteInProgress = false;
    navigationButton.textContent = "▶ ナビ開始";
    document.body.classList.remove("is-navigating", "is-overview");
    if (navigationGuidance) navigationGuidance.hidden = true;
    hideNavigationInfoPanel();
    if (returnToLocationButton) returnToLocationButton.hidden = true;
    $("rideNaviHeadingControl")?.classList.remove("is-overview-hidden");
    syncFloatingLocationButton();

    const point = getCurrentLatLng();
    if (point) {
      displayedNavigationPoint = point;
      displayedNavigationHeading = lastKnownHeading;
      userMarker?.setPosition(point);
      accuracyCircle?.setCenter(point);
      updateLocationMarkerHeading();
    }

    clearDisplayedRoute(false);

    hideStatus();
    if (speak) speakNavigation("ナビを終了しました。");
  }

  function toggleNavigation() {
    navigationActive ? stopNavigation() : startNavigation();
  }

  function createShareButton() {
    if (shareRouteButton) {
      shareRouteButton.addEventListener("click", shareRouteUrl);
      return;
    }
    if (!routeButton) return;

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
    const destinationText = destinationRouteValue();
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
        hideStatus();
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        hideStatus();
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
    const destination = params.get("d");
    const mode = params.get("mode");

    if (!destination) return false;

    originInput.value = "現在地";
    destinationInput.value = destination;
    delete destinationInput.dataset.searchCleared;
    updateSearchClearButtonVisibility();
    updateRouteEndpointsSummary();
    if (mode && ["highway", "partial", "local"].includes(mode)) {
      selectedRouteMode = mode;
      const routeModeSelect = $("routeMode");
      if (routeModeSelect) routeModeSelect.value = mode;
    }
    waypointList.innerHTML = "";

    updateWaypointDisplay();
    updateRouteInfoEmpty();
    openPanel();
    hideStatus();
    return true;
  }

  function routeSearchLocationKey(location, coordinatePrecision = 6) {
    if (typeof location === "string") return location.trim();

    const latitude =
      typeof location?.lat === "function" ? location.lat() : location?.lat;
    const longitude =
      typeof location?.lng === "function" ? location.lng() : location?.lng;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return String(location || "");
    }

    return (
      `${latitude.toFixed(coordinatePrecision)},` +
      longitude.toFixed(coordinatePrecision)
    );
  }

  function routeSearchCacheKey({
    origin,
    originText,
    destination,
    waypointValues,
    mode
  }) {
    return JSON.stringify({
      origin: originText === "現在地"
        ? `現在地:${routeSearchLocationKey(
            origin,
            CURRENT_LOCATION_CACHE_PRECISION
          )}`
        : routeSearchLocationKey(origin),
      destination: destination.trim(),
      waypoints: waypointValues.map((value) => value.trim()),
      mode
    });
  }

  function cachedRouteCandidates(cacheKey) {
    const candidates = routeSearchCache.get(cacheKey);
    if (!candidates) return null;

    routeSearchCache.delete(cacheKey);
    routeSearchCache.set(cacheKey, candidates);
    return candidates.slice();
  }

  function cacheRouteCandidates(cacheKey, candidates) {
    routeSearchCache.delete(cacheKey);
    routeSearchCache.set(cacheKey, candidates.slice());

    while (routeSearchCache.size > ROUTE_SEARCH_CACHE_LIMIT) {
      const oldestKey = routeSearchCache.keys().next().value;
      routeSearchCache.delete(oldestKey);
    }
  }

  function resetRouteSearchState(mode) {
    clearDisplayedRoute(false);
    selectedRouteMode = mode;
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
      avoidHighways: false,
      avoidTolls: mode === "local",
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

    const originText = originInput.value.trim();
    const destinationDisplayText =
      destinationInput.value.trim() ||
      destinationInput.dataset.selectedLabel ||
      "";
    const destinationText = destinationRouteValue();
    const destinationRequestValue = destinationRouteRequestValue();
    const waypointValues = getWaypointValues();
    const selectedPreference =
      document.getElementById("routeMode")?.value || "local";

    if (!originText || !destinationText) {
      showStatus("出発地と目的地を入力してください");
      return;
    }

    if (
      destinationName &&
      (!destinationName.textContent ||
        destinationName.textContent === "選択した目的地")
    ) {
      destinationName.textContent = destinationDisplayText;
      if (destinationAddress) destinationAddress.textContent = destinationDisplayText;
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
    const cacheKey = routeSearchCacheKey({
      origin,
      originText,
      destination: destinationText,
      waypointValues,
      mode: selectedPreference
    });

    if (routeSearching && activeRouteSearchKey === cacheKey) {
      showStatus("同じ条件のルートを検索中です");
      return;
    }

    const searchId = ++latestRouteSearchId;
    const diagnostics = {
      searchId,
      cacheKey,
      cacheHit: false,
      apiRequestCount: 0,
      apiRouteCount: 0,
      apiErrorCount: 0,
      signatureDuplicateCount: 0,
      shapeDuplicateCount: 0,
      distanceExcludedCount: 0,
      practicalityDirectionExcludedCount: 0,
      practicalityDeviationExcludedCount: 0,
      practicalityLoopExcludedCount: 0,
      practicalityDurationExcludedCount: 0,
      automaticSearchExecuted: false,
      automaticSearchReason: "未判定",
      automaticSearchInitialCandidateCount: 0,
      automaticSearchNeededCount: 0,
      generatedViaRequestCount: 0,
      generatedViaPoints: [],
      finalAcceptedCount: 0,
      candidates: []
    };
    routeSearching = true;
    activeRouteSearchKey = cacheKey;
    routeButton.disabled = true;
    routeButton.textContent = "ルートを検索中…";
    resetRouteSearchState(selectedPreference);
    showStatus(`${routeModeShortLabel(selectedPreference)}を検索しています…`);

    try {
      const cachedCandidates = cachedRouteCandidates(cacheKey);

      if (cachedCandidates) {
        if (searchId !== latestRouteSearchId) return;

        diagnostics.cacheHit = true;
        diagnostics.automaticSearchReason = "条件別キャッシュを使用";
        diagnostics.automaticSearchInitialCandidateCount =
          cachedCandidates.length;
        diagnostics.automaticSearchNeededCount = 0;
        diagnostics.finalAcceptedCount = cachedCandidates.length;
        showRouteChoices(cachedCandidates, searchId);
        closePanel();
        hideStatus();
        return;
      }

      const modes =
        selectedPreference === "local"
          ? ["local"]
          : selectedPreference === "partial"
            ? ["partial", "local"]
            : ["highway", "local"];
      diagnostics.apiRequestCount += modes.length;

      const responses = await Promise.all(
        modes.map(async (mode) => ({
          mode,
          response: await directionsPromise(
            routeRequest(origin, destinationRequestValue, waypoints, mode)
          )
        }))
      );

      if (searchId !== latestRouteSearchId) return;

      const uniqueCandidates = [];
      const seenSignatures = new Map();
      const candidateRecords = new Map();

      const evaluateCandidate = (
        candidate,
        source,
        viaPointDescription = "",
        practicality = null
      ) => {
        const route = candidate.result.routes[candidate.routeIndex];
        const totals = sumRouteTotals(route);
        const modeAssessment = routeModeAssessment(
          route,
          candidate.mode,
          freeRouteDuration
        );
        const record = {
          取得元: source,
          モード: routeModeLabel(candidate.mode),
          候補番号: candidate.routeIndex + 1,
          自動通過点: viaPointDescription,
          距離km: Number((totals.totalDistance / 1000).toFixed(1)),
          距離倍率: "",
          "有料区間率％": modeAssessment.tollUsage.hasToll
            ? Number(
                (modeAssessment.tollUsage.tollDistanceRatio * 100).toFixed(1)
              )
            : 0,
          無料ルート比時間: modeAssessment.freeDurationRatio === null
            ? ""
            : Number(modeAssessment.freeDurationRatio.toFixed(3)),
          時間倍率: practicality
            ? Number(practicality.durationRatio.toFixed(3))
            : "",
          最大逆行km: practicality
            ? Number(
                (
                  practicality.directionMetrics
                    .maximumBacktrackDistance / 1000
                ).toFixed(1)
              )
            : "",
          基準経路最大乖離km: practicality
            ? Number(
                (practicality.maximumDeviation / 1000).toFixed(1)
              )
            : "",
          ループ検出: practicality
            ? practicality.hasLoop
            : "",
          最大形状重複率: "",
          形状差: "",
          判定: "評価中"
        };

        diagnostics.candidates.push(record);
        candidateRecords.set(candidate, record);

        if (practicality && !practicality.accepted) {
          if (
            practicality.rejectionReasons.includes(
              "逆方向への大きな進行"
            )
          ) {
            diagnostics.practicalityDirectionExcludedCount += 1;
          }
          if (
            practicality.rejectionReasons.includes(
              "最短ルートから極端に離脱"
            )
          ) {
            diagnostics.practicalityDeviationExcludedCount += 1;
          }
          if (
            practicality.rejectionReasons.includes(
              "折り返し・ループ"
            )
          ) {
            diagnostics.practicalityLoopExcludedCount += 1;
          }
          if (
            practicality.rejectionReasons.includes(
              "所要時間1.3倍超過"
            )
          ) {
            diagnostics.practicalityDurationExcludedCount += 1;
          }

          record.判定 =
            `${source}除外：` + practicality.rejectionReasons.join("・");
          return false;
        }

        const signature = routeSignature(route);
        if (seenSignatures.has(signature)) {
          diagnostics.signatureDuplicateCount += 1;
          record.判定 = "簡易署名重複";
          return false;
        }

        let maximumOverlap = 0;
        let shapeDuplicate = false;

        for (const existingCandidate of uniqueCandidates) {
          const existingRoute =
            existingCandidate.result.routes[existingCandidate.routeIndex];
          const comparison = compareRouteShapes(route, existingRoute);

          maximumOverlap = Math.max(
            maximumOverlap,
            comparison.overlapRatio
          );

          if (comparison.isNearlySame) {
            shapeDuplicate = true;
            break;
          }
        }

        record.最大形状重複率 = Number((maximumOverlap * 100).toFixed(1));

        if (shapeDuplicate) {
          diagnostics.shapeDuplicateCount += 1;
          record.判定 = "形状重複";
          return false;
        }

        seenSignatures.set(signature, candidate);
        uniqueCandidates.push(candidate);
        return true;
      };

      const freeResponse = responses.find(({ mode }) => mode === "local");
      const freeRoutes =
        freeResponse?.response.status === "OK"
          ? (freeResponse.response.result?.routes || []).filter((route) =>
              routeMatchesMode(route, "local", Infinity)
            )
          : [];
      const freeRouteDuration = freeRoutes.length
        ? Math.min(
            ...freeRoutes.map(
              (route) => sumRouteTotals(route).totalDuration
            )
          )
        : Infinity;
      const freeReferenceRoute = freeRoutes
        .slice()
        .sort((first, second) => {
          const firstTotals = sumRouteTotals(first);
          const secondTotals = sumRouteTotals(second);
          const distanceDifference =
            firstTotals.totalDistance - secondTotals.totalDistance;

          if (distanceDifference !== 0) return distanceDifference;
          return compareRoutesDeterministically(first, second);
        })[0] || null;
      const recordModeRejection = (
        route,
        routeIndex,
        mode,
        source,
        assessment
      ) => {
        const totals = sumRouteTotals(route);

        diagnostics.candidates.push({
          取得元: source,
          モード: routeModeLabel(mode),
          候補番号: routeIndex + 1,
          自動通過点: "",
          距離km: Number((totals.totalDistance / 1000).toFixed(1)),
          "有料区間率％": assessment.tollUsage.hasToll
            ? Number((assessment.tollUsage.tollDistanceRatio * 100).toFixed(1))
            : 0,
          無料ルート比時間: assessment.freeDurationRatio === null
            ? ""
            : Number(assessment.freeDurationRatio.toFixed(3)),
          判定: `モード条件外：${assessment.rejectionReasons.join("・")}`
        });
      };

      responses.forEach(({ mode, response }) => {
        const { result, status } = response;
        if (status !== "OK" || !result?.routes?.length) {
          diagnostics.apiErrorCount += 1;
          return;
        }

        diagnostics.apiRouteCount += result.routes.length;
        const fastestHighwayRoute =
          mode === "highway"
            ? result.routes
                .filter((route) =>
                  routeMatchesMode(route, "highway", freeRouteDuration)
                )
                .sort(compareRoutesDeterministically)[0]
            : null;

        sortedRouteEntries(result.routes).forEach(({ route, routeIndex }) => {
          let candidateMode = mode;

          if (mode === "local") {
            const assessment = routeModeAssessment(
              route,
              "local",
              freeRouteDuration
            );
            if (!assessment.accepted) {
              recordModeRejection(
                route,
                routeIndex,
                "local",
                "通常検索",
                assessment
              );
              return;
            }
          } else if (mode === "partial") {
            const assessment = routeModeAssessment(
              route,
              "partial",
              freeRouteDuration
            );
            if (!assessment.accepted) {
              recordModeRejection(
                route,
                routeIndex,
                "partial",
                "通常検索",
                assessment
              );
              return;
            }
          } else if (route === fastestHighwayRoute) {
            candidateMode = "highway";
          } else {
            const partialAssessment = routeModeAssessment(
              route,
              "partial",
              freeRouteDuration
            );
            if (partialAssessment.accepted) {
              candidateMode = "partial";
            } else {
              const highwayAssessment = routeModeAssessment(
                route,
                "highway",
                freeRouteDuration
              );
              if (highwayAssessment.accepted) {
                partialAssessment.rejectionReasons.unshift(
                  "高速優先の最短時間候補ではない"
                );
              }
              recordModeRejection(
                route,
                routeIndex,
                "highway",
                "通常検索",
                partialAssessment
              );
              return;
            }
          }

          evaluateCandidate(
            { mode: candidateMode, result, routeIndex },
            "通常検索",
            "",
            ["local", "partial"].includes(candidateMode) &&
              freeReferenceRoute
              ? evaluateRoutePracticality(route, freeReferenceRoute)
              : null
          );
        });
      });

      const hasFailedResponse = responses.some(({ response }) =>
        response.status !== "OK" || !response.result?.routes?.length
      );

      if (hasFailedResponse && routeCandidates.length) {
        showStatus(
          "一部のルート候補を取得できなかったため、現在の表示を維持しました"
        );
        return;
      }

      if (!uniqueCandidates.length) {
        const firstError = responses.find(
          ({ response }) => response.status !== "OK"
        )?.response.status;
        showStatus(routeErrorMessage(firstError || "ZERO_RESULTS"));
        return;
      }

      const filterCandidatesByDistance = (candidates, shortestDistance) =>
        candidates.filter((candidate) => {
          const route =
            candidate.result.routes[candidate.routeIndex];
          const distance = sumRouteTotals(route).totalDistance;
          const distanceRatio = distance / Math.max(shortestDistance, 1);
          const record = candidateRecords.get(candidate);

          if (record) {
            record.距離倍率 = Number(distanceRatio.toFixed(3));
          }

          if (distanceRatio > 1.5) {
            if (record?.判定 !== "距離超過") {
              diagnostics.distanceExcludedCount += 1;
            }
            if (record) record.判定 = "距離超過";
            return false;
          }

          if (record) record.判定 = "採用候補";
          return true;
        });

      const initialShortestDistance = Math.min(
        ...uniqueCandidates.map((candidate) =>
          sumRouteTotals(candidate.result.routes[candidate.routeIndex])
            .totalDistance
        )
      );
      let reasonableCandidates = filterCandidatesByDistance(
        uniqueCandidates,
        initialShortestDistance
      );
      diagnostics.automaticSearchInitialCandidateCount =
        reasonableCandidates.length;
      diagnostics.automaticSearchNeededCount = 0;
      diagnostics.automaticSearchReason =
        "自動通過点による追加検索は停止中";

      const preferredMode = selectedPreference;
      const baseOrder = ["highway", "partial", "local"];
      const orderedModes = [
        preferredMode,
        ...baseOrder.filter((mode) => mode !== preferredMode)
      ];
      const modeOrder = Object.fromEntries(
        orderedModes.map((mode, index) => [mode, index])
      );
      reasonableCandidates.sort((a, b) => {
        const automaticDifference =
          Number(Boolean(a.isAutomatic)) -
          Number(Boolean(b.isAutomatic));
        if (automaticDifference !== 0) return automaticDifference;

        const modeDifference = modeOrder[a.mode] - modeOrder[b.mode];
        if (modeDifference !== 0) return modeDifference;

        return compareRoutesDeterministically(
          a.result.routes[a.routeIndex],
          b.result.routes[b.routeIndex]
        );
      });

      if (searchId !== latestRouteSearchId) return;

      diagnostics.finalAcceptedCount = reasonableCandidates.length;
      cacheRouteCandidates(cacheKey, reasonableCandidates);
      showRouteChoices(reasonableCandidates, searchId);
      closePanel();
      hideStatus();
    } catch (error) {
      if (searchId !== latestRouteSearchId) return;

      console.error("Directions route error:", error);
      showStatus("ルート候補の検索に失敗しました");
    } finally {
      if (searchId === latestRouteSearchId) {
        logRouteSearchDiagnostics(diagnostics);
        routeSearching = false;
        activeRouteSearchKey = "";
        routeButton.disabled = false;
        routeButton.textContent = routeButtonIdleText;
      }
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

  function createHeadingButton() {
    if (document.getElementById("rideNaviHeadingControl")) return;

    const style = document.createElement("style");
    style.textContent = `
      #rideNaviHeadingControl {
        position: fixed;
        right: 16px;
        bottom: calc(172px + env(safe-area-inset-bottom));
        z-index: 1000;
        display: flex;
        align-items: center;
      }

      #rideNaviHeadingControl button {
        width: 52px;
        height: 52px;
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

      #rideNaviHeadingControl button:active {
        transform: scale(0.94);
      }

      #rideNaviHeadingControl button.active {
        background: #1a73e8;
        color: #ffffff;
      }

      @media (max-width: 480px) {
        #rideNaviHeadingControl {
          bottom: calc(220px + env(safe-area-inset-bottom));
        }
      }
    `;
    document.head.appendChild(style);

    const controls = document.createElement("div");
    controls.id = "rideNaviHeadingControl";
    controls.setAttribute("aria-label", "地図の方位");

    headingButton = document.createElement("button");
    headingButton.type = "button";
    headingButton.textContent = "🧭";
    headingButton.title = "進行方向を上に表示";
    headingButton.setAttribute("aria-label", "進行方向を上に表示");
    headingButton.setAttribute("aria-pressed", "false");

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
          hideStatus();
        } else {
          hideStatus();
        }
      } else {
        headingButton.classList.remove("active");
        headingButton.title = "進行方向を上に表示";
        headingButton.setAttribute("aria-label", "進行方向を上に表示");
        map.setHeading(0);
        hideStatus();
      }
      updateLocationMarkerHeading();
    });

    controls.append(headingButton);
    document.body.appendChild(controls);
  }

  function initMap() {
    try {
      map = new google.maps.Map($("map"), {
        center: DEFAULT_CENTER,
        zoom: 12,
        minZoom: MAP_MIN_ZOOM,
        zoomControl: false,
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

    const mapDiv = map.getDiv();
    const supportsPointerEvents = "PointerEvent" in window;
    const activeMapPointers = new Map();
    let longPressStartPoint = null;
    let longPressPointerId = null;
    let longPressPointerType = null;
    let longPressCompleted = false;

    const cancelLongPress = () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressStartPoint = null;
      longPressPointerId = null;
      longPressPointerType = null;
    };

    const longPressMoveTolerance = (pointerType) => {
      if (pointerType === "touch") return TOUCH_LONG_PRESS_MOVE_TOLERANCE_PX;
      if (pointerType === "pen") return PEN_LONG_PRESS_MOVE_TOLERANCE_PX;
      return MOUSE_LONG_PRESS_MOVE_TOLERANCE_PX;
    };

    const eventScreenPoint = (event) => {
      const source = event?.domEvent || event;
      const touch = source?.touches?.[0] || source?.changedTouches?.[0];
      const clientX = touch?.clientX ?? source?.clientX;
      const clientY = touch?.clientY ?? source?.clientY;

      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      return { x: clientX, y: clientY };
    };

    if (supportsPointerEvents) {
      mapDiv.addEventListener("pointerdown", (event) => {
        longPressCompleted = false;
        activeMapPointers.set(event.pointerId, {
          pointerType: event.pointerType || "mouse",
          button: event.button,
          ctrlKey: event.ctrlKey,
          point: { x: event.clientX, y: event.clientY }
        });
        if (activeMapPointers.size > 1) cancelLongPress();
      }, { capture: true, passive: true });

      window.addEventListener("pointermove", (event) => {
        if (
          !longPressTimer ||
          !longPressStartPoint ||
          (longPressPointerId !== null && event.pointerId !== longPressPointerId)
        ) {
          return;
        }

        const distance = Math.hypot(
          event.clientX - longPressStartPoint.x,
          event.clientY - longPressStartPoint.y
        );
        if (distance > longPressMoveTolerance(longPressPointerType)) {
          cancelLongPress();
        }
      }, { capture: true, passive: true });

      const finishPointer = (event) => {
        activeMapPointers.delete(event.pointerId);
        if (event.pointerId === longPressPointerId) cancelLongPress();
      };
      window.addEventListener("pointerup", finishPointer, {
        capture: true,
        passive: true
      });
      window.addEventListener("pointercancel", finishPointer, {
        capture: true,
        passive: true
      });
    }

    map.addListener("dragstart", () => {
      if (!supportsPointerEvents || !longPressStartPoint) cancelLongPress();
      if (!followToggle) return;

      followToggle.checked = false;
      hideStatus();
    });
    map.addListener("dragend", () => {
      if (!navigationActive || navigationOverviewActive || !returnToLocationButton) {
        return;
      }
      const point = getCurrentLatLng();
      const bounds = map.getBounds();
      returnToLocationButton.hidden = Boolean(
        point && bounds?.contains(new google.maps.LatLng(point))
      );
    });

  

      directionsService = new google.maps.DirectionsService();
      geocoder = new google.maps.Geocoder();

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
        cancelLongPress();
        const wasLongPress = longPressCompleted;
        longPressCompleted = false;
        const selectedPlaceId = String(event.placeId || "").trim();
        if (selectedPlaceId && typeof event.stop === "function") {
          event.stop();
        }
        if (wasLongPress) return;

        if (selectedPlaceId) {
          if (!event.latLng || navigationActive) return;
          cancelMapSelection();
          updateDestinationDetails(event.latLng, selectedPlaceId);
          hideStatus();
          return;
        }

        if (
          !event.latLng ||
          !mapSelectionTarget ||
          mapSelectionTarget.isDestination ||
          navigationActive
        ) {
          return;
        }

        const { input, label } = mapSelectionTarget;
        input.value = `${event.latLng.lat().toFixed(6)},${event.latLng.lng().toFixed(6)}`;
        updateRouteEndpointsSummary();
        updateRouteInfoEmpty();
        cancelMapSelection();
        hideStatus();
      });

      map.addListener("mousedown", (event) => {
        cancelLongPress();
        longPressCompleted = false;
        const sourceEvent = event?.domEvent;
        const activePointer = activeMapPointers.size === 1
          ? activeMapPointers.entries().next().value
          : null;
        const hasTouch = Boolean(
          sourceEvent?.touches?.length || sourceEvent?.changedTouches?.length
        );
        const pointerType =
          sourceEvent?.pointerType ||
          activePointer?.[1]?.pointerType ||
          (hasTouch ? "touch" : "mouse");
        const pointerButton = Number.isFinite(sourceEvent?.button)
          ? sourceEvent.button
          : activePointer?.[1]?.button;
        const isContextMenuGesture =
          pointerType === "mouse" &&
          ((Number.isFinite(pointerButton) && pointerButton !== 0) ||
            sourceEvent?.ctrlKey ||
            activePointer?.[1]?.ctrlKey);
        if (
          !event.latLng ||
          navigationActive ||
          activeMapPointers.size > 1 ||
          isContextMenuGesture
        ) {
          return;
        }

        longPressStartPoint = eventScreenPoint(event) || activePointer?.[1]?.point || null;
        if (!longPressStartPoint) return;
        longPressPointerId = event?.domEvent?.pointerId ??
          activePointer?.[0] ?? null;
        longPressPointerType = pointerType;
        const destinationLatLng = event.latLng;
        longPressTimer = setTimeout(() => {
          if (activeMapPointers.size > 1 || navigationActive) {
            cancelLongPress();
            return;
          }

          longPressTimer = null;
          longPressStartPoint = null;
          longPressPointerId = null;
          longPressPointerType = null;
          longPressCompleted = true;
          updateDestinationDetails(destinationLatLng);
          hideStatus();
        }, LONG_PRESS_DELAY_MS);
      });
      map.addListener("mouseup", () => {
        if (!supportsPointerEvents) cancelLongPress();
      });
      map.addListener("drag", () => {
        if (!supportsPointerEvents || !longPressStartPoint) cancelLongPress();
      });
      map.addListener("zoom_changed", () => {
        cancelLongPress();
        if (displayedNavigationPoint) {
          setNavigationCameraLocation(displayedNavigationPoint);
        }
      });
      map.addListener("contextmenu", cancelLongPress);

      trafficLayer = new google.maps.TrafficLayer();
      createNavigationInfoPanel();
      createHeadingButton();

      showStatus("目的地を検索するか、地図を長押ししてください", true);
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
  addWaypointButton?.addEventListener("click", () => addWaypoint());
  topCurrentLocationButton?.addEventListener("click", useCurrentLocationAsOrigin);
  topDestinationButton?.addEventListener("click", () => {
    openPanel();
    destinationInput?.focus();
  });
  destinationMapButton?.addEventListener("click", () => {
    startMapSelection(destinationInput, "目的地", destinationMapButton);
  });
  searchClearButton?.addEventListener("click", clearDestinationSearchUi);
  clearDestinationButton?.addEventListener("click", clearDestination);
  clearRouteDestinationButton?.addEventListener("click", clearDestination);
  routeButton?.addEventListener("click", searchRoute);
  destinationNavigationButton?.addEventListener("click", toggleNavigation);
  destinationShareButton?.addEventListener("click", shareRouteUrl);
  clearRouteButton?.addEventListener("click", () => clearDisplayedRoute(true));
  locationButton?.addEventListener("click", centerOnCurrentLocation);
  floatingLocationButton?.addEventListener("click", handleFloatingLocationButton);
  trafficToggle?.addEventListener("change", toggleTrafficLayer);
  voiceTestButton?.addEventListener("click", voiceTest);

  originInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchRoute();
  });

  originInput?.addEventListener("input", updateRouteEndpointsSummary);

  destinationInput?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && autocompletePredictions.length) {
      event.preventDefault();
      updateAutocompleteActiveItem(autocompleteActiveIndex + 1);
      return;
    }
    if (event.key === "ArrowUp" && autocompletePredictions.length) {
      event.preventDefault();
      updateAutocompleteActiveItem(autocompleteActiveIndex - 1);
      return;
    }
    if (event.key === "Escape") {
      hideDestinationSuggestions();
      return;
    }
    if (
      event.key === "Enter" &&
      autocompletePredictions.length &&
      autocompleteActiveIndex >= 0
    ) {
      event.preventDefault();
      const prediction = autocompletePredictions[autocompleteActiveIndex];
      void selectDestinationSearchItem(prediction);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void searchDestinationByText();
    }
  });

  destinationInput?.addEventListener("input", () => {
    destinationSelectionId += 1;
    clearSearchResultMap();
    delete destinationInput.dataset.searchCleared;
    delete destinationInput.dataset.selectedCoordinate;
    delete destinationInput.dataset.selectedLabel;
    delete destinationInput.dataset.selectedPlaceId;
    updateSearchClearButtonVisibility();
    updateRouteEndpointsSummary();
    scheduleDestinationSuggestions();
  });

  destinationInput?.addEventListener("focus", () => {
    if (
      destinationInput.value.trim() &&
      !destinationInput.dataset.selectedCoordinate
    ) {
      scheduleDestinationSuggestions();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!$("searchBar")?.contains(event.target)) hideDestinationSuggestions();
  });

  routeModeInputs().forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      const shouldSearchAgain =
        input.name === "summaryRouteMode" && Boolean(lastRouteResult);
      syncRouteModeControls(input.value, shouldSearchAgain);
    });
  });
  overviewButton?.addEventListener("click", showRouteOverview);
  returnToLocationButton?.addEventListener("click", returnToCurrentLocation);
  endNavigationButton?.addEventListener("click", () => stopNavigation());

  createNavigationButton();
  createShareButton();
  observeDestinationPanelLayout();
  updateWaypointDisplay();
  updateRouteInfoEmpty();
  loadRouteFromUrl();
  updateSearchClearButtonVisibility();
  updateRouteEndpointsSummary();

  loadGoogleMaps();
})();
