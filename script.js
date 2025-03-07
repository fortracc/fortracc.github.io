// CONFIG_DISPLAY_KEYS: Altere este array para definir quais chaves devem ser disponibilizadas para exibição.
const CONFIG_DISPLAY_KEYS = ['uid', 'status', 'threshold', 'size', 'max', 'ang_'];

document.addEventListener("DOMContentLoaded", () => {
  // Define os limites da região de centralização.
  const bounds = [
    [-35.01807360131674, -79.99568018181952], // [lat_min, lon_min]
    [4.986926398683252, -30.000680181819533]   // [lat_max, lon_max]
  ];

  // Inicializa o mapa com os bounds definidos.
  const map = L.map("map");
  map.fitBounds(bounds);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  // Variáveis para gerenciamento das layers e player.
  // Cada item em geojsonLayers terá: { fileName, geojson (original), trajectoryLayer (opcional), trajectoryGeojson (opcional) }
  let geojsonLayers = [];
  let currentIndex = 0;
  let playing = false;
  let playInterval = null;
  // Variáveis para as layers renderizadas (após filtro).
  let currentBoundaryLayer = null; // camada boundary filtrada
  let currentTrajectoryLayer = null; // camada trajectory filtrada

  // Filtro de threshold: valor default é "235.0".
  let currentThresholdFilter = "235.0";

  // Objeto para armazenar as opções de exibição dos campos (para os markers dos centroides).
  let displayOptions = {};
  CONFIG_DISPLAY_KEYS.forEach(field => {
    displayOptions[field] = false;
  });

  // Referências da interface.
  const timelineSlider = document.getElementById("timeline");
  const prevBtn = document.getElementById("prevLayer");
  const playPauseBtn = document.getElementById("playPause");
  const nextBtn = document.getElementById("nextLayer");
  const speedInput = document.getElementById("speed");
  const speedValueSpan = document.getElementById("speedValue");
  const timestampInfo = document.getElementById("timestamp-info");
  const dynamicOptionsContainer = document.getElementById("dynamic-options");
  const showTrajectoryCheckbox = document.getElementById("showTrajectory");
  const thresholdRadios = document.getElementsByName("thresholdFilter");

  // LayerGroup para os markers dos centroides.
  let markerGroup = L.layerGroup().addTo(map);

  // Retorna true se a feature tiver a propriedade threshold igual ao filtro atual.
  function passesThreshold(feature) {
    if (feature.properties && feature.properties.threshold !== undefined) {
      return parseFloat(feature.properties.threshold) === parseFloat(currentThresholdFilter);
    }
    return false;
  }

  // Cria uma layer de trajectory a partir de um geojson filtrado.
  function createTrajectoryLayer(geojson) {
    return L.geoJSON(geojson, {
      filter: passesThreshold,
      style: {
        color: "#FF0000",
        weight: 2,
        opacity: 0.7
      }
    });
  }

  // Gera os controles (checkboxes) para os campos definidos em CONFIG_DISPLAY_KEYS.
  function generateFieldOptions() {
    dynamicOptionsContainer.innerHTML = "";
    CONFIG_DISPLAY_KEYS.forEach(field => {
      const container = document.createElement("div");
      container.className = "field-option";
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = field;
      checkbox.checked = false;
      checkbox.addEventListener("change", updateDisplayOptions);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" " + field));
      container.appendChild(label);
      dynamicOptionsContainer.appendChild(container);
    });
    updateMarkers();
  }

  // Atualiza displayOptions conforme os checkboxes e recria os markers.
  function updateDisplayOptions() {
    CONFIG_DISPLAY_KEYS.forEach(field => {
      const checkbox = document.querySelector(`input[name="${field}"]`);
      if (checkbox) {
        displayOptions[field] = checkbox.checked;
      }
    });
    updateMarkers();
  }

  // Calcula o centroid (média dos vértices do primeiro anel do polígono).
  function computeCentroid(feature) {
    if (!feature.geometry || !feature.geometry.coordinates || feature.geometry.type !== "Polygon") return null;
    const coords = feature.geometry.coordinates[0];
    let sumX = 0, sumY = 0;
    coords.forEach(coord => {
      sumX += coord[0];
      sumY += coord[1];
    });
    return [sumY / coords.length, sumX / coords.length]; // [lat, lon]
  }

  // Atualiza a caixa de timestamp com base na primeira feature filtrada.
  // Agora adiciona o acréscimo "(UTC)" após o timestamp.
  function updateTimestampInfo(obj) {
    let ts = "";
    if (obj.geojson.features && obj.geojson.features.length > 0) {
      ts = obj.geojson.features[0].timestamp ||
           (obj.geojson.features[0].properties && obj.geojson.features[0].properties.timestamp) ||
           "";
    }
    timestampInfo.textContent = "Track: " + ts + " (UTC)";
  }

  // Remove as layers atuais (boundary, markers e trajectory).
  function removeCurrentLayer() {
    if (currentBoundaryLayer) {
      map.removeLayer(currentBoundaryLayer);
      currentBoundaryLayer = null;
    }
    markerGroup.clearLayers();
    removeTrajectoryLayer();
  }

  // Remove a layer de trajectory, se exibida.
  function removeTrajectoryLayer() {
    if (currentTrajectoryLayer) {
      map.removeLayer(currentTrajectoryLayer);
      currentTrajectoryLayer = null;
      if (geojsonLayers[currentIndex]) {
        geojsonLayers[currentIndex].trajectoryLayer = null;
      }
    }
  }

  // Atualiza a camada boundary filtrando as features por threshold.
  function updateBoundaryLayer() {
    if (currentBoundaryLayer) {
      map.removeLayer(currentBoundaryLayer);
    }
    const obj = geojsonLayers[currentIndex];
    currentBoundaryLayer = L.geoJSON(obj.geojson, {
      filter: passesThreshold,
      style: {
        color: "#3388ff",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.2
      }
    });
    currentBoundaryLayer.addTo(map);
  }

  // Atualiza os markers dos centroides para as features filtradas.
  function updateMarkers() {
    markerGroup.clearLayers();
    if (!geojsonLayers[currentIndex]) return;
    // Filtra as features com threshold igual ao filtro atual.
    const features = geojsonLayers[currentIndex].geojson.features.filter(passesThreshold);
    features.forEach(feature => {
      const centroid = computeCentroid(feature);
      if (!centroid) return;
      let infoText = "";
      CONFIG_DISPLAY_KEYS.forEach(field => {
        const props = feature.properties || {};
        if (displayOptions[field] && props[field] !== undefined) {
          infoText += field + ": " + props[field] + "<br>";
        }
      });
      if (infoText !== "") {
        const marker = L.marker(centroid, { opacity: 0 });
        marker.bindTooltip(infoText, {
          permanent: true,
          direction: "top",
          offset: [0, -10],
          className: "centroid-tooltip"
        });
        markerGroup.addLayer(marker);
      }
    });
  }

  // Carrega (ou recria) a layer de trajectory para a camada atual aplicando o filtro.
  function loadTrajectoryForCurrentLayer() {
    const currentLayer = geojsonLayers[currentIndex];
    if (!currentLayer) return;

    // Se o geojson da trajectory já foi carregado, recria a layer filtrada.
    if (currentLayer.trajectoryGeojson) {
      if (currentTrajectoryLayer) {
        map.removeLayer(currentTrajectoryLayer);
      }
      currentTrajectoryLayer = createTrajectoryLayer(currentLayer.trajectoryGeojson);
      currentTrajectoryLayer.addTo(map);
      currentLayer.trajectoryLayer = currentTrajectoryLayer;
      return;
    }
    // Obtém o arquivo de trajectory (supondo mesmo nome, em pasta "track/trajectory/").
    let filePath = currentLayer.fileName;
    if (!filePath.includes("track/trajectory/")) {
      filePath = "track/trajectory/" + filePath;
    }
    fetch(filePath)
      .then(response => {
        if (!response.ok) {
          throw new Error("Erro ao carregar trajectory: " + filePath);
        }
        return response.json();
      })
      .then(geojson => {
        // Armazena o geojson para recriação futura conforme o filtro.
        currentLayer.trajectoryGeojson = geojson;
        currentTrajectoryLayer = createTrajectoryLayer(geojson);
        currentTrajectoryLayer.addTo(map);
        currentLayer.trajectoryLayer = currentTrajectoryLayer;
      })
      .catch(err => {
        console.error(err);
        showTrajectoryCheckbox.checked = false;
      });
  }

  // Atualiza a exibição da trajectory, conforme o checkbox.
  function updateTrajectoryDisplay() {
    if (showTrajectoryCheckbox.checked) {
      loadTrajectoryForCurrentLayer();
    } else {
      removeTrajectoryLayer();
    }
  }

  // Atualiza o filtro de threshold conforme seleção do usuário.
  function updateThresholdFilter() {
    for (const radio of thresholdRadios) {
      if (radio.checked) {
        currentThresholdFilter = radio.value;
        break;
      }
    }
    updateBoundaryLayer();
    updateMarkers();
    if (showTrajectoryCheckbox.checked) {
      loadTrajectoryForCurrentLayer();
    }
  }

  // Exibe a camada do índice especificado.
  function showLayerAtIndex(index) {
    if (index < 0 || index >= geojsonLayers.length) return;
    removeCurrentLayer();
    currentIndex = index;
    updateBoundaryLayer();
    updateMarkers();
    updateTimestampInfo(geojsonLayers[currentIndex]);
    updateTrajectoryDisplay();
    timelineSlider.value = currentIndex;
  }

  // Atualiza o intervalo do play conforme a velocidade selecionada.
  function updatePlayInterval() {
    if (playInterval) clearInterval(playInterval);
    const intervalTime = parseFloat(speedInput.value) * 1000;
    playInterval = setInterval(() => {
      let nextIndex = currentIndex + 1;
      if (nextIndex >= geojsonLayers.length) nextIndex = 0;
      showLayerAtIndex(nextIndex);
    }, intervalTime);
  }

  // Busca a listagem de arquivos .geojson na pasta "track/boundary/".
  function fetchGeojsonFileList() {
    // OBS.: o servidor deve permitir listagem do diretório.
    return fetch("track/boundary/")
      .then(response => {
        if (!response.ok) {
          throw new Error("Não foi possível acessar o diretório track/boundary/");
        }
        return response.text();
      })
      .then(html => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const links = Array.from(doc.querySelectorAll("a"))
          .map(a => a.getAttribute("href"))
          .filter(href => href && href.match(/\.geojson$/i));
        return links;
      });
  }

  // Carrega os arquivos GeoJSON encontrados em "track/boundary/".
  function loadGeojsonLayers() {
    fetchGeojsonFileList()
      .then(fileNames => {
        if (!fileNames.length) {
          throw new Error("Nenhum arquivo .geojson encontrado em track/boundary/");
        }
        let loadedCount = 0;
        fileNames.forEach(fileName => {
          let filePath = fileName;
          if (!fileName.includes("track/boundary/")) {
            filePath = "track/boundary/" + fileName;
          }
          fetch(filePath)
            .then(response => {
              if (!response.ok) {
                throw new Error("Erro ao carregar " + filePath);
              }
              return response.json();
            })
            .then(geojson => {
              const parts = fileName.split("/");
              const name = parts[parts.length - 1];
              geojsonLayers.push({
                fileName: name,
                geojson: geojson,
                trajectoryLayer: null,
                trajectoryGeojson: null
              });
            })
            .catch(err => {
              console.error(err);
              alert("Erro ao carregar o arquivo: " + filePath);
            })
            .finally(() => {
              loadedCount++;
              if (loadedCount === fileNames.length && geojsonLayers.length > 0) {
                timelineSlider.disabled = false;
                timelineSlider.min = 0;
                timelineSlider.max = geojsonLayers.length - 1;
                timelineSlider.value = 0;
                showLayerAtIndex(0);
                // Inicia o player automaticamente.
                playing = true;
                playPauseBtn.textContent = "Pause";
                updatePlayInterval();
              }
            });
        });
      })
      .catch(err => {
        console.error(err);
      });
  }

  // Eventos de interface:
  timelineSlider.addEventListener("input", e => {
    const index = parseInt(e.target.value);
    if (!isNaN(index)) {
      showLayerAtIndex(index);
    }
  });

  prevBtn.addEventListener("click", () => {
    let newIndex = currentIndex - 1;
    if (newIndex < 0) newIndex = geojsonLayers.length - 1;
    showLayerAtIndex(newIndex);
  });

  nextBtn.addEventListener("click", () => {
    let newIndex = currentIndex + 1;
    if (newIndex >= geojsonLayers.length) newIndex = 0;
    showLayerAtIndex(newIndex);
  });

  function togglePlay() {
    playing = !playing;
    if (playing) {
      playPauseBtn.textContent = "Pause";
      updatePlayInterval();
    } else {
      playPauseBtn.textContent = "Play";
      if (playInterval) clearInterval(playInterval);
    }
  }

  playPauseBtn.addEventListener("click", () => {
    if (geojsonLayers.length === 0) return;
    togglePlay();
  });

  speedInput.addEventListener("input", () => {
    speedValueSpan.textContent = speedInput.value;
    if (playing) updatePlayInterval();
  });

  showTrajectoryCheckbox.addEventListener("change", updateTrajectoryDisplay);

  thresholdRadios.forEach(radio => {
    radio.addEventListener("change", updateThresholdFilter);
  });

  // Gera os controles para os campos e inicia a carga dos dados.
  generateFieldOptions();
  loadGeojsonLayers();
});
