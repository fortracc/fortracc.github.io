const CONFIG_DISPLAY_KEYS = ['uid', 'status', 'size', 'max', 'ang_'];
const REPO_RAW_URL = "https://raw.githubusercontent.com/fortracc/fortracc.github.io/main/";
const LOCAL_BOUNDARY_DIR = "track/boundary/", LOCAL_TRAJECTORY_DIR = "track/trajectory/";
const GITHUB_BOUNDARY_API = "https://api.github.com/repos/fortracc/fortracc.github.io/contents/track/boundary?ref=main";
const GITHUB_TRAJECTORY_API = "https://api.github.com/repos/fortracc/fortracc.github.io/contents/track/trajectory?ref=main";

let geojsonLayers = [], trajectoryFiles = {}, currentIndex = 0, playing = false, playInterval = null;
let currentThresholdFilter = "235.0", currentBoundaryLayer = null, currentTrajectoryLayer = null;
const displayOptions = CONFIG_DISPLAY_KEYS.reduce((acc, key) => (acc[key] = false, acc), {});

const scanLocalDirectory = dir => fetch(dir)
  .then(r => r.ok ? r.text() : "")
  .then(html => {
    if (!html) return [];
    return [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("a")]
      .map(a => a.getAttribute("href"))
      .filter(href => href && href.toLowerCase().endsWith(".geojson"));
  })
  .catch(() => []);

const sortFiles = (files, key = "name") =>
  files.sort((a, b) => (a[key] || a).toLowerCase().localeCompare((b[key] || b).toLowerCase()));
const getLocalUrl = (fileName, dir) => fileName.includes(dir) ? fileName : dir + fileName;
const getBaseName = fileName => fileName.split('/').pop();

document.addEventListener("DOMContentLoaded", () => {
  const map = L.map("map").fitBounds([[-35.01807360131674, -79.99568018181952], [4.986926398683252, -30.000680181819533]]);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map);
  
  const timelineSlider = document.getElementById("timeline"),
    prevBtn = document.getElementById("prevLayer"),
    playPauseBtn = document.getElementById("playPause"),
    nextBtn = document.getElementById("nextLayer"),
    speedInput = document.getElementById("speed"),
    speedValueSpan = document.getElementById("speedValue"),
    trackInfo = document.getElementById("track-info") || document.getElementById("timestamp-info"),
    dynamicOptionsContainer = document.getElementById("dynamic-options"),
    showTrajectoryCheckbox = document.getElementById("showTrajectory"),
    thresholdRadios = document.getElementsByName("thresholdFilter");
  const markerGroup = L.layerGroup().addTo(map);
  
  // Funções utilitárias
  const passesThreshold = feature =>
    feature.properties && feature.properties.threshold !== undefined ?
      parseFloat(feature.properties.threshold) === parseFloat(currentThresholdFilter) : false;
  
  const createTrajectoryLayer = geojson => L.geoJSON(geojson, {
    filter: passesThreshold,
    style: { color: "#FF0000", weight: 2, opacity: 0.7 }
  });
  
  const generateFieldOptions = () => {
    dynamicOptionsContainer.innerHTML = "";
    CONFIG_DISPLAY_KEYS.forEach(field => {
      const container = document.createElement("div"),
        label = document.createElement("label"),
        checkbox = document.createElement("input");
      container.className = "field-option";
      checkbox.type = "checkbox"; 
      checkbox.name = field; 
      checkbox.checked = false;
      checkbox.addEventListener("change", updateDisplayOptions);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" - " + field));
      container.appendChild(label);
      dynamicOptionsContainer.appendChild(container);
    });
    updateMarkers();
  };
  
  const updateDisplayOptions = () => {
    CONFIG_DISPLAY_KEYS.forEach(field => {
      const chk = document.querySelector(`input[name="${field}"]`);
      if (chk) displayOptions[field] = chk.checked;
    });
    updateMarkers();
  };
  
  const computeCentroid = feature => {
    if (!feature.geometry || feature.geometry.type !== "Polygon") return null;
    const coords = feature.geometry.coordinates[0];
    let [sumX, sumY] = [0, 0];
    coords.forEach(c => { sumX += c[0]; sumY += c[1]; });
    return [sumY / coords.length, sumX / coords.length];
  };
  
  const updateTimestampInfo = obj => {
    let ts = "";
    if (obj.geojson.features && obj.geojson.features.length > 0)
      ts = obj.geojson.features[0].timestamp ||
           (obj.geojson.features[0].properties && obj.geojson.features[0].properties.timestamp) || "";
    if (trackInfo) trackInfo.textContent = "Track: " + ts + " (UTC)";
  };
  
  const removeCurrentLayer = () => {
    if (currentBoundaryLayer) { map.removeLayer(currentBoundaryLayer); currentBoundaryLayer = null; }
    markerGroup.clearLayers();
    removeTrajectoryLayer();
  };
  
  const removeTrajectoryLayer = () => {
    if (currentTrajectoryLayer) {
      map.removeLayer(currentTrajectoryLayer);
      currentTrajectoryLayer = null;
      if (geojsonLayers[currentIndex])
        geojsonLayers[currentIndex].trajectoryLayer = null;
    }
  };
  
  const updateBoundaryLayer = () => {
    if (currentBoundaryLayer) map.removeLayer(currentBoundaryLayer);
    let obj = geojsonLayers[currentIndex];
    currentBoundaryLayer = L.geoJSON(obj.geojson, {
      filter: passesThreshold,
      style: { color: "#3388ff", weight: 1, opacity: 1, fillOpacity: 0.2 }
    });
    currentBoundaryLayer.addTo(map);
  };
  
  const updateMarkers = () => {
    markerGroup.clearLayers();
    if (!geojsonLayers[currentIndex]) return;
    geojsonLayers[currentIndex].geojson.features.filter(passesThreshold).forEach(feature => {
      const centroid = computeCentroid(feature);
      if (!centroid) return;
      let infoText = "";
      CONFIG_DISPLAY_KEYS.forEach(field => {
        if (displayOptions[field] && feature.properties && feature.properties[field] !== undefined)
          infoText += field + ": " + feature.properties[field] + "<br>";
      });
      if (infoText) {
        const marker = L.marker(centroid, { opacity: 0 });
        marker.bindTooltip(infoText, { permanent: true, direction: "top", offset: [0, -10], className: "centroid-tooltip" });
        markerGroup.addLayer(marker);
      }
    });
  };
  
  const fetchBoundaryFileList = () => 
    scanLocalDirectory(LOCAL_BOUNDARY_DIR).then(files => {
      if (files.length > 0)
        return sortFiles(files.map(f => ({ name: f, download_url: getLocalUrl(f, LOCAL_BOUNDARY_DIR) })), "name");
      return fetch(GITHUB_BOUNDARY_API)
        .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(files => sortFiles(files.filter(file => /\.geojson$/i.test(file.name)), "name"));
    });
  
  const fetchTrajectoryFileList = () =>
    scanLocalDirectory(LOCAL_TRAJECTORY_DIR).then(files => {
      if (files.length > 0) {
        let fileMap = {};
        files.forEach(f => fileMap[getBaseName(f)] = getLocalUrl(f, LOCAL_TRAJECTORY_DIR));
        return fileMap;
      }
      return fetch(GITHUB_TRAJECTORY_API)
        .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(files => {
          let m = {};
          files.forEach(f => { if (/\.geojson$/i.test(f.name)) m[f.name] = f.download_url; });
          return m;
        });
    });
  
  const loadBoundaryLayers = () => {
    fetchBoundaryFileList().then(files => {
      if (!files.length) throw new Error("Nenhum arquivo .geojson encontrado para boundary");
      let loadedCount = 0;
      files.forEach(file => {
        fetch(file.download_url)
          .then(r => { if (!r.ok) throw new Error(file.download_url); return r.json(); })
          .then(geojson => geojsonLayers.push({
            fileName: file.name,
            geojson,
            trajectoryLayer: null,
            trajectoryGeojson: null
          }))
          .catch(err => console.error(err))
          .finally(() => {
            loadedCount++;
            if (loadedCount === files.length && geojsonLayers.length > 0) {
              // Ordena os layers pelo nome
              geojsonLayers.sort((a, b) => a.fileName.toLowerCase().localeCompare(b.fileName.toLowerCase()));
              timelineSlider.disabled = false;
              timelineSlider.min = 0;
              timelineSlider.max = geojsonLayers.length - 1;
              timelineSlider.value = 0;
              showLayerAtIndex(0);
              playing = true;
              playPauseBtn.textContent = "Pause";
              updatePlayInterval();
            }
          });
      });
    }).catch(console.error);
  };
  
  const loadTrajectoryFiles = () => {
    fetchTrajectoryFileList()
      .then(filesMap => trajectoryFiles = filesMap)
      .catch(console.error);
  };
  
  const loadTrajectoryForCurrentLayer = () => {
    const currentLayer = geojsonLayers[currentIndex];
    if (!currentLayer) return;
    const baseName = getBaseName(currentLayer.fileName);
    let trajectoryUrl = trajectoryFiles[baseName] ||
      Object.keys(trajectoryFiles).find(k => k.toLowerCase() === baseName.toLowerCase());
    if (!trajectoryUrl) {
      // Fallback para a URL raw do GitHub
      trajectoryUrl = REPO_RAW_URL + LOCAL_TRAJECTORY_DIR + baseName;
      console.info("Fallback para GitHub raw URL para trajectory: " + trajectoryUrl);
    }
    if (currentLayer.trajectoryGeojson) {
      if (currentTrajectoryLayer) map.removeLayer(currentTrajectoryLayer);
      currentTrajectoryLayer = createTrajectoryLayer(currentLayer.trajectoryGeojson);
      currentTrajectoryLayer.addTo(map);
      currentLayer.trajectoryLayer = currentTrajectoryLayer;
      return;
    }
    fetch(trajectoryUrl)
      .then(r => { if (!r.ok) throw new Error(trajectoryUrl); return r.json(); })
      .then(geojson => {
        currentLayer.trajectoryGeojson = geojson;
        currentTrajectoryLayer = createTrajectoryLayer(geojson);
        currentTrajectoryLayer.addTo(map);
        currentLayer.trajectoryLayer = currentTrajectoryLayer;
      })
      .catch(err => { console.error(err); showTrajectoryCheckbox.checked = false; });
  };
  
  const updateTrajectoryDisplay = () =>
    showTrajectoryCheckbox.checked ? loadTrajectoryForCurrentLayer() : removeTrajectoryLayer();
  
  const updateThresholdFilter = () => {
    for (const radio of thresholdRadios) {
      if (radio.checked) { currentThresholdFilter = radio.value; break; }
    }
    updateBoundaryLayer();
    updateMarkers();
    if (showTrajectoryCheckbox.checked) loadTrajectoryForCurrentLayer();
  };
  
  const showLayerAtIndex = index => {
    if (index < 0 || index >= geojsonLayers.length) return;
    removeCurrentLayer();
    currentIndex = index;
    updateBoundaryLayer();
    updateMarkers();
    updateTimestampInfo(geojsonLayers[currentIndex]);
    updateTrajectoryDisplay();
    timelineSlider.value = currentIndex;
  };
  
  const updatePlayInterval = () => {
    if (playInterval) clearInterval(playInterval);
    playInterval = setInterval(() => {
      let next = currentIndex + 1;
      if (next >= geojsonLayers.length) next = 0;
      showLayerAtIndex(next);
    }, parseFloat(speedInput.value) * 1000);
  };
  
  // Eventos da UI
  timelineSlider.addEventListener("input", e => {
    const idx = parseInt(e.target.value);
    if (!isNaN(idx)) showLayerAtIndex(idx);
  });
  prevBtn.addEventListener("click", () => showLayerAtIndex((currentIndex - 1 + geojsonLayers.length) % geojsonLayers.length));
  nextBtn.addEventListener("click", () => showLayerAtIndex((currentIndex + 1) % geojsonLayers.length));
  playPauseBtn.addEventListener("click", () => {
    if (!geojsonLayers.length) return;
    playing = !playing;
    playPauseBtn.textContent = playing ? "Pause" : "Play";
    playing ? updatePlayInterval() : clearInterval(playInterval);
  });
  speedInput.addEventListener("input", () => {
    speedValueSpan.textContent = speedInput.value;
    if (playing) updatePlayInterval();
  });
  showTrajectoryCheckbox.addEventListener("change", updateTrajectoryDisplay);
  Array.from(thresholdRadios).forEach(radio => radio.addEventListener("change", updateThresholdFilter));
  
  // Inicialização
  generateFieldOptions();
  loadTrajectoryFiles();
  loadBoundaryLayers();
});
