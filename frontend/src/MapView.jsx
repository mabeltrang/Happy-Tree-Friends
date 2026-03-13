import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Filter, List, BarChart2, Globe, Shield, Loader2, AlertCircle } from 'lucide-react';

const SPECIES_COLORS = [
  '#006B33', '#e67e22', '#2980b9', '#8e44ad', '#c0392b',
  '#16a085', '#d35400', '#f39c12', '#2c3e50', '#27ae60',
  '#e74c3c', '#1abc9c', '#9b59b6', '#34495e', '#f1c40f',
];

function ThreatBadge({ status }) {
  const s = (status || '').toUpperCase();
  const map = {
    'CR':             'bg-red-700 text-white',
    'EN':             'bg-orange-500 text-white',
    'VU':             'bg-yellow-500 text-white',
    'NT':             'bg-amber-300 text-gray-800',
    'LC':             'bg-green-500 text-white',
    'DD':             'bg-gray-400 text-white',
    'NE':             'bg-gray-300 text-gray-700',
    'NO LISTADO':     'bg-gray-200 text-gray-500',
    'NO ENCONTRADO':  'bg-gray-200 text-gray-500',
    'SIN CONFIGURAR': 'bg-slate-200 text-slate-500',
    'ERROR':          'bg-red-100 text-red-600',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${map[s] || 'bg-gray-200 text-gray-600'}`}>
      {status || '—'}
    </span>
  );
}

function MapView() {
  const [records, setRecords] = useState([]);
  const [selectedSpecies, setSelectedSpecies] = useState('all');
  const [isLoading, setIsLoading] = useState(true);

  // GBIF
  const [gbifOccurrences, setGbifOccurrences] = useState([]);
  const [isLoadingGbif, setIsLoadingGbif] = useState(false);
  const [showGbif, setShowGbif] = useState(false);
  const [gbifError, setGbifError] = useState(null);

  // Threat status
  const [threatInfo, setThreatInfo] = useState(null);
  const [isLoadingThreat, setIsLoadingThreat] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/records').then(r => r.ok ? r.json() : []),
      fetch('/api/classes').then(r => r.ok ? r.json() : []),
    ]).then(([recs]) => {
      setRecords(Array.isArray(recs) ? recs : []);
    }).catch(() => {}).finally(() => setIsLoading(false));
  }, []);

  // Al cambiar especie: cargar amenaza automáticamente, limpiar GBIF
  useEffect(() => {
    setGbifOccurrences([]);
    setShowGbif(false);
    setGbifError(null);

    if (selectedSpecies === 'all') {
      setThreatInfo(null);
      return;
    }

    setIsLoadingThreat(true);
    setThreatInfo(null);
    fetch('/api/threat-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ species: [selectedSpecies] }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.[0]) setThreatInfo(data[0]); })
      .catch(() => {})
      .finally(() => setIsLoadingThreat(false));
  }, [selectedSpecies]);

  const loadGbifOccurrences = async () => {
    if (selectedSpecies === 'all') return;
    setIsLoadingGbif(true);
    setGbifError(null);
    try {
      const res = await fetch(`/api/gbif-occurrences?species=${encodeURIComponent(selectedSpecies)}&limit=300`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setGbifOccurrences(data.occurrences || []);
      setShowGbif(true);
    } catch {
      setGbifError('No se pudo cargar ocurrencias de GBIF');
    } finally {
      setIsLoadingGbif(false);
    }
  };

  const speciesColorMap = useMemo(() => {
    const allSpecies = [...new Set(records.map(r => r.species).filter(Boolean))];
    const map = {};
    allSpecies.forEach((s, i) => { map[s] = SPECIES_COLORS[i % SPECIES_COLORS.length]; });
    return map;
  }, [records]);

  const filtered = useMemo(() => (
    selectedSpecies === 'all' ? records : records.filter(r => r.species === selectedSpecies)
  ), [records, selectedSpecies]);

  const allWithCoords = useMemo(() => records.filter(r => r.latitud != null && r.longitud != null), [records]);
  const withoutCoords = useMemo(() => records.filter(r => r.latitud == null || r.longitud == null), [records]);

  const filteredWithCoords = useMemo(() => (
    selectedSpecies === 'all' ? allWithCoords : allWithCoords.filter(r => r.species === selectedSpecies)
  ), [allWithCoords, selectedSpecies]);

  const uniqueSpecies = [...new Set(records.map(r => r.species).filter(Boolean))];
  const uniqueDepts   = [...new Set(filtered.map(r => r.departamento).filter(Boolean))];
  const uniqueMunis   = [...new Set(filtered.map(r => r.municipio).filter(Boolean))];

  const speciesCounts = useMemo(() => {
    const counts = {};
    filtered.forEach(r => { if (r.species) counts[r.species] = (counts[r.species] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const groupedWithout = useMemo(() => {
    const groups = {};
    withoutCoords.forEach(r => {
      const key = `${r.departamento || ''}|${r.municipio || ''}`;
      if (!groups[key]) groups[key] = { dept: r.departamento, muni: r.municipio, count: 0 };
      groups[key].count++;
    });
    return Object.values(groups).sort((a, b) => b.count - a.count);
  }, [withoutCoords]);

  const hasLocalPoints = filteredWithCoords.length > 0;
  const hasGbifPoints  = showGbif && gbifOccurrences.length > 0;
  const shouldShowMap  = hasLocalPoints || hasGbifPoints;

  return (
    <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">

      {/* Panel izquierdo */}
      <div className="w-full lg:w-72 flex flex-col gap-4 overflow-y-auto">

        {/* Filtro por especie */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-unergy-green">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-unergy-green" />
            <span className="text-sm font-semibold text-gray-700">Filtrar por especie</span>
          </div>
          <select
            value={selectedSpecies}
            onChange={e => setSelectedSpecies(e.target.value)}
            className="w-full text-sm rounded-md px-3 py-2 border border-gray-300 focus:outline-none focus:border-unergy-green text-gray-700 bg-white"
          >
            <option value="all">Todas las especies ({uniqueSpecies.length})</option>
            {uniqueSpecies.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Panel amenaza + GBIF — solo cuando hay especie seleccionada */}
        {selectedSpecies !== 'all' && (
          <div className="bg-white rounded-lg p-4 shadow-sm border border-unergy-green">

            {/* Estado de amenaza */}
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-unergy-green" />
              <span className="text-sm font-semibold text-gray-700">Estado de Amenaza</span>
            </div>
            {isLoadingThreat ? (
              <div className="flex items-center gap-2 text-gray-400 text-xs mb-3">
                <Loader2 className="h-3 w-3 animate-spin" /><span>Consultando APIs...</span>
              </div>
            ) : threatInfo ? (
              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">IUCN Red List</span>
                  <ThreatBadge status={threatInfo.iucn} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">CITES</span>
                  <ThreatBadge status={threatInfo.cites} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">MADS (Res. 1912)</span>
                  <ThreatBadge status={threatInfo.mads} />
                </div>
              </div>
            ) : null}

            {/* Distribución GBIF */}
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="h-4 w-4 text-blue-500" />
                <span className="text-xs font-semibold text-gray-700">Distribución Global (GBIF)</span>
              </div>
              {gbifError && (
                <div className="flex items-center gap-1 text-xs text-red-500 mb-2">
                  <AlertCircle className="h-3 w-3 flex-none" />{gbifError}
                </div>
              )}
              {showGbif && gbifOccurrences.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-blue-600 font-medium">{gbifOccurrences.length} registros globales</span>
                    <button
                      onClick={() => { setShowGbif(false); setGbifOccurrences([]); }}
                      className="text-red-400 hover:text-red-600"
                    >
                      Ocultar
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <span className="w-3 h-3 rounded-full border-2 border-blue-600 bg-blue-300 flex-none" />
                    Ocurrencias GBIF (azul)
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <span className="w-3 h-3 rounded-full flex-none" style={{ backgroundColor: speciesColorMap[selectedSpecies] || '#006B33' }} />
                    Registros propios
                  </div>
                </div>
              ) : (
                <button
                  onClick={loadGbifOccurrences}
                  disabled={isLoadingGbif}
                  className="w-full py-2 rounded-md text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-colors"
                >
                  {isLoadingGbif
                    ? <><Loader2 className="h-3 w-3 animate-spin" />Cargando GBIF...</>
                    : <><Globe className="h-3 w-3" />Ver distribución en GBIF</>
                  }
                </button>
              )}
            </div>
          </div>
        )}

        {/* Estadísticas */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-unergy-green">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 className="h-4 w-4 text-unergy-green" />
            <span className="text-sm font-semibold text-gray-700">Resumen</span>
          </div>
          <div className="space-y-2">
            {[
              ['Árboles registrados', filtered.length],
              ['Departamentos', uniqueDepts.length],
              ['Municipios', uniqueMunis.length],
              ['Con coordenadas GPS', filteredWithCoords.length],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-semibold text-gray-800">{val}</span>
              </div>
            ))}
            {hasGbifPoints && (
              <div className="flex justify-between text-sm">
                <span className="text-blue-500">Ocurrencias GBIF</span>
                <span className="font-semibold text-blue-600">{gbifOccurrences.length}</span>
              </div>
            )}
          </div>
        </div>

        {/* Conteo por especie */}
        {speciesCounts.length > 0 && (
          <div className="bg-white rounded-lg p-4 shadow-sm border border-unergy-green">
            <p className="text-sm font-semibold text-gray-700 mb-3">
              {selectedSpecies === 'all' ? 'Por especie' : 'Distribución geográfica'}
            </p>
            {selectedSpecies === 'all' ? (
              <div className="space-y-2">
                {speciesCounts.map(([sp, cnt]) => (
                  <div key={sp}>
                    <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                      <span className="truncate flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ backgroundColor: speciesColorMap[sp] || '#999' }} />
                        {sp}
                      </span>
                      <span className="font-semibold ml-2 flex-none">{cnt}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(cnt / filtered.length) * 100}%`,
                          backgroundColor: speciesColorMap[sp] || '#006B33',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                {uniqueDepts.map(dept => {
                  const depRecs = filtered.filter(r => r.departamento === dept);
                  const munis = [...new Set(depRecs.map(r => r.municipio).filter(Boolean))];
                  return (
                    <div key={dept} className="bg-green-50 rounded-md px-3 py-2">
                      <p className="text-xs font-semibold text-gray-700">{dept}</p>
                      <p className="text-xs text-gray-500">{munis.join(', ') || '—'}</p>
                      <p className="text-xs text-unergy-green mt-0.5">{depRecs.length} árbol{depRecs.length > 1 ? 'es' : ''}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Sin coordenadas */}
        {groupedWithout.length > 0 && (
          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
            <div className="flex items-center gap-2 mb-3">
              <List className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">Sin coordenadas GPS</span>
            </div>
            <div className="space-y-1.5">
              {groupedWithout.map((g, i) => (
                <div key={i} className="bg-gray-50 rounded-md px-3 py-2">
                  <p className="text-xs font-semibold text-gray-700">{g.muni || '—'}</p>
                  <p className="text-xs text-gray-400">{g.dept || '—'}</p>
                  <p className="text-xs text-unergy-green mt-0.5">{g.count} árbol{g.count > 1 ? 'es' : ''}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Mapa */}
      <div className="flex-1 rounded-lg overflow-hidden border border-unergy-green shadow-sm" style={{ minHeight: '500px' }}>
        {isLoading ? (
          <div className="w-full h-full flex items-center justify-center bg-gray-50">
            <p className="text-gray-400 text-sm">Cargando registros...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 p-8 text-center">
            <MapPin className="h-14 w-14 text-gray-200 mb-4" />
            <p className="text-gray-500 font-medium">Aún no hay registros con ubicación</p>
            <p className="text-gray-400 text-sm mt-1 max-w-xs">
              Clasifica árboles en la pestaña de Clasificación para ver su distribución aquí.
            </p>
          </div>
        ) : !shouldShowMap ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 p-8 text-center">
            <MapPin className="h-14 w-14 text-gray-200 mb-4" />
            <p className="text-gray-500 font-medium">No hay coordenadas GPS en los registros</p>
            <p className="text-gray-400 text-sm mt-1 max-w-xs">
              Hay {filtered.length} registro{filtered.length > 1 ? 's' : ''} guardado{filtered.length > 1 ? 's' : ''} por municipio/departamento pero sin latitud/longitud.
              {selectedSpecies !== 'all' && ' Puedes cargar la distribución global con el botón de GBIF.'}
            </p>
            {selectedSpecies !== 'all' && (
              <button
                onClick={loadGbifOccurrences}
                disabled={isLoadingGbif}
                className="mt-4 px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 flex items-center gap-2"
              >
                {isLoadingGbif
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Cargando...</>
                  : <><Globe className="h-4 w-4" />Ver distribución en GBIF</>
                }
              </button>
            )}
          </div>
        ) : (
          <MapContainer
            center={[4.5709, -74.2973]}
            zoom={hasLocalPoints ? 5 : 3}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Ocurrencias GBIF — marcadores azules pequeños */}
            {hasGbifPoints && gbifOccurrences.map((occ, i) => (
              <CircleMarker
                key={`gbif-${i}`}
                center={[occ.lat, occ.lng]}
                radius={5}
                pathOptions={{
                  color: '#1d4ed8',
                  weight: 1,
                  fillColor: '#93c5fd',
                  fillOpacity: 0.65,
                }}
              >
                <Popup>
                  <div style={{ minWidth: '140px' }}>
                    <p style={{ fontWeight: 'bold', color: '#1d4ed8', marginBottom: '2px' }}>GBIF</p>
                    <p style={{ fontSize: '12px', fontStyle: 'italic' }}>{selectedSpecies}</p>
                    <hr style={{ margin: '4px 0' }} />
                    <p style={{ fontSize: '11px', color: '#555' }}>
                      {[occ.stateProvince, occ.country].filter(Boolean).join(', ') || 'Sin localidad'}
                    </p>
                    {occ.year && <p style={{ fontSize: '11px', color: '#999' }}>Año: {occ.year}</p>}
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {/* Registros propios — marcadores de color por especie */}
            {filteredWithCoords.map(r => (
              <CircleMarker
                key={r.id}
                center={[r.latitud, r.longitud]}
                radius={9}
                pathOptions={{
                  color: '#fff',
                  weight: 1.5,
                  fillColor: speciesColorMap[r.species] || '#006B33',
                  fillOpacity: 0.9,
                }}
              >
                <Popup>
                  <div style={{ minWidth: '160px' }}>
                    <p style={{ fontWeight: 'bold', marginBottom: '2px' }}>{r.species}</p>
                    <p style={{ color: '#666', fontSize: '11px' }}>Árbol #{r.tree_id} · {r.confidence}% confianza</p>
                    <hr style={{ margin: '6px 0' }} />
                    <p style={{ fontSize: '12px' }}>
                      {[r.vereda, r.municipio, r.departamento].filter(Boolean).join(', ')}
                    </p>
                    <p style={{ color: '#999', fontSize: '11px', marginTop: '2px' }}>
                      {r.created_at?.slice(0, 10)}
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        )}
      </div>
    </div>
  );
}

export default MapView;
