(() => {
  "use strict";

  const DEFAULT_CENTER = { lat: 35.0116, lng: 135.7681 };
  const MAX_WAYPOINTS = 5;
  const AUTO_ROUTE_FRACTIONS = [0.35, 0.5, 0.65];
  const AUTO_ROUTE_MIN_OFFSET_METERS = 1500;
  const AUTO_ROUTE_MAX_OFFSET_METERS = 12000;
  const AUTO_ROUTE_OFFSET_RATIO = 0.08;
  const AUTO_ROUTE_MAX_DURATION_RATIO = 1.3;
  const ROUTE_SEARCH_CACHE_LIMIT = 12;
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
  const routeEndpointsSummary = $("routeEndpointsSummary");
  const useCurrentLocationButton = $("useCurrentLocationButton");
  const addWaypointButton = $("addWaypointButton");
  const topDestinationButton = $("topDestinationButton");
  const topMapButton = $("topMapButton");
  const destinationMapButton = $("destinationMapButton");
  const waypointList = $("waypointList");
  const waypointCount = $("waypointCount");
  const routeButton = $("routeButton");
  const routeButtonIdleText =
    routeButton?.textContent || "🧭 ルート候補を検索";
  let shareRouteButton = null;
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
  let routeNumberMarkers = [];
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

  function hideRouteChoices() {
    if (routeChoicePanel) {
      routeChoicePanel.remove();
      routeChoicePanel = null;
    }
  }


  function clearRouteOverlays() {
    routePolylines.forEach((polyline) => polyline.setMap(null));
    routePolylines = [];
    routeNumberMarkers.forEach((marker) => marker.setMap(null));
    routeNumberMarkers = [];
  }

  function updateRouteEndpointsSummary() {
    if (!routeEndpointsSummary) return;

    const origin = originInput?.value.trim() || "出発地未設定";
    const destination = destinationInput?.value.trim() || "到着地未設定";
    routeEndpointsSummary.textContent = `${origin} → ${destination}`;
    routeEndpointsSummary.title = routeEndpointsSummary.textContent;
  }

  function cancelMapSelection(showMessage = false) {
    mapSelectionTarget = null;
    map?.getDiv().classList.remove("map-selection-active");
    topMapButton?.setAttribute("aria-pressed", "false");
    destinationMapButton?.setAttribute("aria-pressed", "false");
    waypointList
      ?.querySelectorAll(".map-select-button")
      .forEach((button) => button.setAttribute("aria-pressed", "false"));

    if (showMessage) showStatus("MAP選択を解除しました", true);
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
      topMapButton?.setAttribute("aria-pressed", "true");
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

function drawRouteOverlays() {
  clearRouteOverlays();

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

    const routePath = route.overview_path || [];
    const labelFractions = [0.42, 0.5, 0.36];
    const labelPosition = routePath[
      Math.round((routePath.length - 1) * (labelFractions[index] || 0.5))
    ];

    if (labelPosition) {
      const routeNumberMarker = new google.maps.Marker({
        map,
        position: labelPosition,
        label: {
          text: String(index + 1),
          color: "#ffffff",
          fontSize: "15px",
          fontWeight: "700"
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 15,
          fillColor: routeColor,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeOpacity: 1,
          strokeWeight: 2
        },
        title: `ルート${routeCandidateNumber(index)}`,
        zIndex: isSelected ? 270 : 260 + index,
        optimized: false,
        clickable: true
      });

      routeNumberMarker.addListener("click", selectRoute);
      routeNumberMarkers.push(routeNumberMarker);
    }

  });
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
      showStatus(`${routeModeLabel(candidate.mode)}を選びました`, true);
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

    if (waypointCount) {
      waypointCount.textContent = `${rows.length} / ${MAX_WAYPOINTS}`;
    }
    if (addWaypointButton) {
      addWaypointButton.disabled = rows.length >= MAX_WAYPOINTS;
    }
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
      showStatus("経由地を削除しました", true);
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
    updateRouteEndpointsSummary();
    showStatus("現在地を出発地にしました", true);
  }

  function centerOnCurrentLocation() {
    const point = getCurrentLatLng();

    if (!map || !point) {
      showStatus("現在地を取得しています");
      return;
    }
followToggle.checked = true;
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

      showStatus("新しいルートに切り替えました", true);
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
    const destination = params.get("d");
    const mode = params.get("mode");

    if (!destination) return false;

    originInput.value = "現在地";
    destinationInput.value = destination;
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
    showStatus("共有されたルートを読み込みました", true);
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
    const destinationText = destinationInput.value.trim();
    const waypointValues = getWaypointValues();
    const selectedPreference =
      document.getElementById("routeMode")?.value || "local";

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
    showStatus("無料ルート・一部有料・高速優先を比較しています…");

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
        showStatus(
          `${cachedCandidates.length}件のルート候補が見つかりました`,
          true
        );
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
            routeRequest(origin, destinationText, waypoints, mode)
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
      const automaticCandidatesNeeded = 0;

      diagnostics.automaticSearchInitialCandidateCount =
        reasonableCandidates.length;
      diagnostics.automaticSearchNeededCount = automaticCandidatesNeeded;

      if (automaticCandidatesNeeded > 0) {
        diagnostics.automaticSearchExecuted = true;
        diagnostics.automaticSearchReason =
          `実用的な候補が${reasonableCandidates.length}本のため、` +
          `${automaticCandidatesNeeded}本を追加検索`;
        const baseCandidate = reasonableCandidates.reduce(
          (shortestCandidate, candidate) => {
            const shortestDistance = sumRouteTotals(
              shortestCandidate.result.routes[shortestCandidate.routeIndex]
            ).totalDistance;
            const candidateDistance = sumRouteTotals(
              candidate.result.routes[candidate.routeIndex]
            ).totalDistance;

            return candidateDistance < shortestDistance
              ? candidate
              : shortestCandidate;
          }
        );
        const baseRoute =
          baseCandidate.result.routes[baseCandidate.routeIndex];
        const baseDistance = sumRouteTotals(baseRoute).totalDistance;
        const viaPoints = createAdditionalViaPoints(
          baseRoute,
          baseDistance,
          selectedPreference
        );

        diagnostics.generatedViaRequestCount = viaPoints.length;
        diagnostics.apiRequestCount += viaPoints.length;

        const generatedResponses = await Promise.all(
          viaPoints.map(async (viaPoint) => {
            const insertionIndex = Math.min(
              waypoints.length,
              nearestRouteLegIndex(baseRoute, viaPoint.location)
            );
            const generatedWaypoints = [...waypoints];

            generatedWaypoints.splice(insertionIndex, 0, {
              location: viaPoint.location,
              stopover: false
            });
            diagnostics.generatedViaPoints.push({
              種別: viaPoint.label || "自動生成点",
              "基準位置％": viaPoint.kind === "biwako-bridge"
                ? "固定"
                : Math.round(viaPoint.fraction * 100),
              左右: viaPoint.side === "fixed"
                ? "固定"
                : viaPoint.side === "left" ? "左" : "右",
              オフセットkm: Number(
                (viaPoint.offsetMeters / 1000).toFixed(1)
              ),
              緯度: Number(viaPoint.location.lat.toFixed(6)),
              経度: Number(viaPoint.location.lng.toFixed(6)),
              挿入位置: insertionIndex + 1,
              stopover: false
            });

            return {
              viaPoint,
              response: await directionsPromise(
                routeRequest(
                  origin,
                  destinationText,
                  generatedWaypoints,
                  selectedPreference
                )
              )
            };
          })
        );

        if (searchId !== latestRouteSearchId) return;

        const generatedCandidates = [];

        generatedResponses.forEach(({ viaPoint, response }) => {
          const { result, status } = response;
          if (status !== "OK" || !result?.routes?.length) {
            diagnostics.apiErrorCount += 1;
            return;
          }

          diagnostics.apiRouteCount += result.routes.length;
          result.routes.forEach((route, routeIndex) => {
            const candidate = {
              mode: selectedPreference,
              result,
              routeIndex,
              isAutomatic: true,
              isBiwakoBridge: viaPoint.kind === "biwako-bridge"
            };
            const viaPointDescription = viaPoint.kind === "biwako-bridge"
              ? viaPoint.label
              : `${Math.round(viaPoint.fraction * 100)}%・` +
                `${viaPoint.side === "left" ? "左" : "右"}・` +
                `${Math.round(viaPoint.offsetMeters / 1000)}km`;
            const automaticPracticality =
              evaluateRoutePracticality(route, baseRoute);
            const modeAssessment = routeModeAssessment(
              route,
              selectedPreference,
              freeRouteDuration,
              { allowNotFaster: viaPoint.kind === "biwako-bridge" }
            );

            if (!modeAssessment.accepted) {
              automaticPracticality.accepted = false;
              automaticPracticality.rejectionReasons.push(
                ...modeAssessment.rejectionReasons.map(
                  (reason) => `${routeModeLabel(selectedPreference)}：${reason}`
                )
              );
            }

            if (
              evaluateCandidate(
                candidate,
                "自動通過点",
                viaPointDescription,
                automaticPracticality
              )
            ) {
              generatedCandidates.push(candidate);
            }
          });
        });

        if (generatedCandidates.length) {
          const combinedCandidates = [
            ...reasonableCandidates,
            ...generatedCandidates
          ];
          const combinedShortestDistance = Math.min(
            ...combinedCandidates.map((candidate) =>
              sumRouteTotals(
                candidate.result.routes[candidate.routeIndex]
              ).totalDistance
            )
          );
          const practicalCandidates = filterCandidatesByDistance(
            combinedCandidates,
            combinedShortestDistance
          );
          const existingCandidateSet = new Set(reasonableCandidates);
          const practicalExistingCandidates = practicalCandidates.filter(
            (candidate) => existingCandidateSet.has(candidate)
          );
          const practicalGeneratedCandidates = practicalCandidates.filter(
            (candidate) => !existingCandidateSet.has(candidate)
          );

          practicalGeneratedCandidates.forEach((candidate) => {
            const route =
              candidate.result.routes[candidate.routeIndex];
            const maximumOverlap = practicalExistingCandidates.length
              ? Math.max(
                  ...practicalExistingCandidates.map((existingCandidate) => {
                    const existingRoute =
                      existingCandidate.result.routes[
                        existingCandidate.routeIndex
                      ];
                    return compareRouteShapes(
                      route,
                      existingRoute
                    ).overlapRatio;
                  })
                )
              : 1;
            const record = candidateRecords.get(candidate);

            candidate.shapeDifference = 1 - maximumOverlap;
            if (record) {
              record.形状差 = Number(
                (candidate.shapeDifference * 100).toFixed(1)
              );
              record.最大形状重複率 = Number(
                (maximumOverlap * 100).toFixed(1)
              );
              record.判定 = "自動候補合格";
            }
          });

          practicalGeneratedCandidates.sort((first, second) => {
            const fixedBridgeDifference =
              Number(!first.isBiwakoBridge) -
              Number(!second.isBiwakoBridge);

            if (fixedBridgeDifference !== 0) return fixedBridgeDifference;

            const shapeDifference =
              (second.shapeDifference || 0) -
              (first.shapeDifference || 0);
            if (Math.abs(shapeDifference) > 0.001) {
              return shapeDifference;
            }

            const firstTotals = sumRouteTotals(
              first.result.routes[first.routeIndex]
            );
            const secondTotals = sumRouteTotals(
              second.result.routes[second.routeIndex]
            );
            const distanceDifference =
              firstTotals.totalDistance - secondTotals.totalDistance;

            if (distanceDifference !== 0) return distanceDifference;
            const durationDifference =
              firstTotals.totalDuration - secondTotals.totalDuration;

            if (durationDifference !== 0) return durationDifference;
            return compareRoutesDeterministically(
              first.result.routes[first.routeIndex],
              second.result.routes[second.routeIndex]
            );
          });

          const additionalCandidateCount = Math.max(
            0,
            3 - practicalExistingCandidates.length
          );
          const selectedGeneratedCandidates =
            practicalGeneratedCandidates.slice(0, additionalCandidateCount);

          if (selectedGeneratedCandidates.length) {
            practicalGeneratedCandidates
              .slice(selectedGeneratedCandidates.length)
              .forEach((candidate) => {
                const record = candidateRecords.get(candidate);
                if (record) record.判定 = "自動候補不採用";
              });

            reasonableCandidates = [
              ...practicalExistingCandidates,
              ...selectedGeneratedCandidates
            ];
            selectedGeneratedCandidates.forEach((candidate, index) => {
              const selectedRecord = candidateRecords.get(candidate);
              if (selectedRecord) {
                selectedRecord.判定 =
                  `${practicalExistingCandidates.length + index + 1}本目に採用`;
              }
            });
            diagnostics.automaticSearchReason +=
              `（${selectedGeneratedCandidates.length}本採用）`;
          } else {
            practicalGeneratedCandidates.forEach((candidate) => {
              const record = candidateRecords.get(candidate);
              if (record) record.判定 = "自動候補不採用";
            });
            diagnostics.automaticSearchReason += "（合格候補なし）";
          }
        } else {
          diagnostics.automaticSearchReason += "（取得候補なし）";
        }
      } else {
        diagnostics.automaticSearchReason = "自動追加検索は無効";
      }

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
      showStatus(`${reasonableCandidates.length}件のルート候補が見つかりました`, true);
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

    controls.append(headingButton);
    document.body.appendChild(controls);
  }

  function initMap() {
    try {
      map = new google.maps.Map($("map"), {
        center: DEFAULT_CENTER,
        zoom: 12,
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
        if (!event.latLng || !mapSelectionTarget) return;

        const lat = event.latLng.lat().toFixed(6);
        const lng = event.latLng.lng().toFixed(6);
        const { input, label, isDestination } = mapSelectionTarget;

        if (isDestination && !destinationMarker) {
          destinationMarker = new google.maps.Marker({
            map,
            position: event.latLng,
            title: "目的地",
            animation: google.maps.Animation.DROP
          });
        } else if (isDestination) {
          destinationMarker.setPosition(event.latLng);
        }

        input.value = `${lat},${lng}`;
        updateRouteEndpointsSummary();
        updateRouteInfoEmpty();
        cancelMapSelection();
        showStatus(`📍 ${label}を設定しました`, true);
      });

      trafficLayer = new google.maps.TrafficLayer();
      createNavigationInfoPanel();
      createHeadingButton();

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
  addWaypointButton?.addEventListener("click", () => addWaypoint());
  topDestinationButton?.addEventListener("click", () => {
    openPanel();
    destinationInput?.focus();
  });
  topMapButton?.addEventListener("click", () => {
    startMapSelection(destinationInput, "目的地", topMapButton);
  });
  destinationMapButton?.addEventListener("click", () => {
    startMapSelection(destinationInput, "目的地", destinationMapButton);
  });
  routeButton?.addEventListener("click", searchRoute);
  clearRouteButton?.addEventListener("click", () => clearDisplayedRoute(true));
  locationButton?.addEventListener("click", centerOnCurrentLocation);
  floatingLocationButton?.addEventListener("click", centerOnCurrentLocation);
  trafficToggle?.addEventListener("change", toggleTrafficLayer);
  voiceTestButton?.addEventListener("click", voiceTest);

  originInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchRoute();
  });

  originInput?.addEventListener("input", updateRouteEndpointsSummary);

  destinationInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchRoute();
  });

  destinationInput?.addEventListener("input", updateRouteEndpointsSummary);

  createNavigationButton();
  createShareButton();
  updateWaypointDisplay();
  updateRouteInfoEmpty();
  loadRouteFromUrl();
  updateRouteEndpointsSummary();
  loadGoogleMaps();
})();
