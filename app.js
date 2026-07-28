(() => {
"use strict";
const DEFAULT_CENTER={lat:35.0116,lng:135.7681};
const config=window.RIDE_NAVI_CONFIG||{};
const apiKey=String(config.GOOGLE_MAPS_API_KEY||"").trim();

let map,trafficLayer,userMarker,accuracyCircle,lastPosition,watchId=null,directionsService,directionsRenderer;

const $=id=>document.getElementById(id);
const statusEl=$("status"),panelEl=$("controlPanel"),menuButton=$("menuButton");
const originInput=$("originInput"),destinationInput=$("destinationInput");
const gpsInfoEl=$("gpsInfo"),routeInfoEl=$("routeInfo");
const followToggle=$("followToggle"),trafficToggle=$("trafficToggle");

function setStatus(message,autoHide=false){
  statusEl.textContent=message;
  statusEl.hidden=false;
  if(autoHide)setTimeout(()=>statusEl.hidden=true,2600);
}
function openPanel(){panelEl.classList.remove("is-hidden");menuButton.setAttribute("aria-expanded","true")}
function closePanel(){panelEl.classList.add("is-hidden");menuButton.setAttribute("aria-expanded","false")}

function loadGoogleMaps(){
  if(!apiKey||apiKey.includes("ここに")){setStatus("config.jsのAPIキーを確認してください");return}
  window.initRideNaviMap=initMap;
  const script=document.createElement("script");
  script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=initRideNaviMap&v=weekly&loading=async`;
  script.async=true;script.defer=true;
  script.onerror=()=>setStatus("Googleマップを読み込めませんでした");
  document.head.appendChild(script);
}

function initMap(){
  map=new google.maps.Map($("map"),{
    center:DEFAULT_CENTER,zoom:12,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,gestureHandling:"greedy"
  });
  trafficLayer=new google.maps.TrafficLayer();
  directionsService=new google.maps.DirectionsService();
  directionsRenderer=new google.maps.DirectionsRenderer({
    map,suppressMarkers:false,preserveViewport:false,
    polylineOptions:{strokeColor:"#1a73e8",strokeOpacity:.95,strokeWeight:7}
  });
  setStatus("地図とルート機能を読み込みました",true);
  startLocationWatch();
}

function updateLocation(position){
  lastPosition=position;
  const point={lat:position.coords.latitude,lng:position.coords.longitude};
  const accuracy=Math.round(position.coords.accuracy||0);

  if(!userMarker){
    userMarker=new google.maps.Marker({position:point,map,title:"現在地",zIndex:1000});
    accuracyCircle=new google.maps.Circle({
      map,center:point,radius:accuracy,fillColor:"#1a73e8",fillOpacity:.12,
      strokeColor:"#1a73e8",strokeOpacity:.35,strokeWeight:1
    });
    map.setZoom(16);
  }else{
    userMarker.setPosition(point);
    accuracyCircle.setCenter(point);
    accuracyCircle.setRadius(accuracy);
  }

  if(followToggle.checked)map.panTo(point);
  gpsInfoEl.innerHTML=`GPS：取得中<br>精度：約 ${accuracy} m<br>緯度：${point.lat.toFixed(6)}<br>経度：${point.lng.toFixed(6)}`;
}

function handleLocationError(error){
  const messages={1:"位置情報の利用が許可されていません",2:"現在地を取得できません",3:"現在地の取得がタイムアウトしました"};
  const message=messages[error.code]||"GPSでエラーが発生しました";
  gpsInfoEl.innerHTML=`GPS：エラー<br>${message}`;
  setStatus(message);
}

function startLocationWatch(){
  if(!navigator.geolocation){setStatus("このブラウザはGPSに対応していません");return}
  if(watchId!==null)navigator.geolocation.clearWatch(watchId);
  watchId=navigator.geolocation.watchPosition(updateLocation,handleLocationError,{
    enableHighAccuracy:true,maximumAge:3000,timeout:15000
  });
}

function currentLatLng(){
  if(!lastPosition)return null;
  return {lat:lastPosition.coords.latitude,lng:lastPosition.coords.longitude};
}

function useCurrentLocationAsOrigin(){
  if(!currentLatLng()){setStatus("まだ現在地を取得できていません");startLocationWatch();return}
  originInput.value="現在地";
  setStatus("現在地を出発地にしました",true);
}

function clearRoute(){
  if(directionsRenderer)directionsRenderer.set("directions",null);
  routeInfoEl.innerHTML="距離：未設定<br>時間：未設定";
  setStatus("ルートを消去しました",true);
}

function computeRoute(){
  if(!directionsService||!directionsRenderer){setStatus("ルート機能の読み込みを待ってください");return}

  const originText=originInput.value.trim();
  const destinationText=destinationInput.value.trim();

  if(!originText||!destinationText){setStatus("出発地と目的地を入力してください");return}

  let origin=originText;
  if(originText==="現在地"){
    origin=currentLatLng();
    if(!origin){setStatus("現在地をまだ取得できていません");return}
  }

  setStatus("ルートを検索しています…");

  directionsService.route({
    origin,
    destination:destinationText,
    travelMode:google.maps.TravelMode.DRIVING,
    drivingOptions:{departureTime:new Date(),trafficModel:google.maps.TrafficModel.BEST_GUESS}
  },(result,status)=>{
    if(status!==google.maps.DirectionsStatus.OK||!result){
      console.error("Directions error:",status);
      setStatus(`ルート検索に失敗しました（${status}）`);
      return;
    }

    directionsRenderer.setDirections(result);
    const leg=result.routes[0].legs[0];
    const duration=leg.duration_in_traffic||leg.duration;
    routeInfoEl.innerHTML=`距離：${leg.distance?.text||"未取得"}<br>時間：${duration?.text||"未取得"}`;
    setStatus("ルートを表示しました",true);
    closePanel();
  });
}

function centerOnCurrentLocation(){
  if(!map){setStatus("地図の読み込みを待ってください");return}
  const point=currentLatLng();
  if(!point){setStatus("現在地を取得しています…");startLocationWatch();return}
  map.panTo(point);map.setZoom(16);
}

function toggleTraffic(){
  if(!map||!trafficLayer)return;
  trafficLayer.setMap(trafficToggle.checked?map:null);
  setStatus(trafficToggle.checked?"渋滞情報を表示しました":"渋滞情報を隠しました",true);
}

function testVoice(){
  if(!("speechSynthesis" in window)){setStatus("音声読み上げ非対応です");return}
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance("ライドナビ、音声案内テストです。安全運転で走行してください。");
  u.lang="ja-JP";
  speechSynthesis.speak(u);
  setStatus("音声テストを再生しました",true);
}

menuButton.addEventListener("click",()=>panelEl.classList.contains("is-hidden")?openPanel():closePanel());
$("closePanelButton").addEventListener("click",closePanel);
$("useCurrentLocationButton").addEventListener("click",useCurrentLocationAsOrigin);
$("routeButton").addEventListener("click",computeRoute);
$("clearRouteButton").addEventListener("click",clearRoute);
$("locationButton").addEventListener("click",centerOnCurrentLocation);
$("floatingLocationButton").addEventListener("click",centerOnCurrentLocation);
trafficToggle.addEventListener("change",toggleTraffic);
$("voiceTestButton").addEventListener("click",testVoice);
destinationInput.addEventListener("keydown",e=>{if(e.key==="Enter")computeRoute()});

loadGoogleMaps();
})();
