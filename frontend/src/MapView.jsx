import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Filter, List, BarChart2, Globe, Shield, Loader2 } from 'lucide-react';

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
  // Registros propios (clasificaciones guardadas)
  const [records, setRecords] = useState([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(true);

  // GBIF — cargado automáticamente para todas las especies del modelo
  const [gbifBySpecies, setGbifBySpecies] = useState({}); // { species: [{lat,lng,...}] }
  const [isLoadingGbif, setIsLoadingGbif] = useState(true);
  const [gbifError, setGbifError] = useState(null);

  // Filtro
  const [selectedSpecies, setSelectedSpecies] = useState('all');

  // Estado de amenaza (carga al seleccionar especie)
  const [threatInfo, setThreatInfo] = useState(null);
  const [isLoadingThreat, setIsLoadingThreat] = useState(false);

  // Carga inicial: registros propios + GBIF de todas las especies del modelo
  useEffect(() => {
    fetch('/api/records')
      .then(r => r.ok ? r.json() : [])
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setIsLoadingRecords(false));

    fetch('/api/gbif-occurrences/all')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const bySpecies = {};
        (Array.isArray(data) ? data : []).forEach(({ species, occurrences }) => {
          bySpecies[species] = occurrences || [];
        });
        setGbifBySpecies(bySpecies);
      })
      .catch(() => setGbifError('No se pudo cargar GBIF'))
      .finally(() => setIsLoadingGbif(false));
  }, []);

  // Carga estado de amenaza al seleccionar especie
  useEffect(() => {
    if (selectedSpecies === 'all') { setThreatInfo(null); return; }
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

  // Lista de todas las especies (modelo + registros propios)
  const allSpecies = useMemo(() => {
    const fromGbif    = Object.keys(gbifBySpecies);
    const fromRecords = [...new Set(records.map(r => r.species).filter(Boolean))];
    return [...new Set([...fromGbif, ...fromRecords])].sort();
  }, [gbifBySpecies, records]);

  const speciesColorMap = useMemo(() => {
    const map = {};
    allSpecies.forEach((s, i) => { map[s] = SPECIES_COLORS[i % SPECIES_COLORS.length]; });
    return map;
  }, [allSpecies]);

  // Puntos GBIF a mostrar según filtro
  const gbifPoints = useMemo(() => {
    if (selectedSpecies === 'all') {
      return Object.entries(gbifBySpecies).flatMap(([species, occs]) =>
        occs.map(o => ({ ...o, species }))
      );
    }
    return (gbifBySpecies[selectedSpecies] || []).map(o => ({ ...o, species: selectedSpecies }));
  }, [gbifBySpecies, selectedSpecies]);

  // Registros propios a mostrar
  const ownWithCoords = useMemo(() => {
    const base = records.filter(r => r.latitud != null && r.longitud != null);
    return selectedSpecies === 'all' ? base : base.filter(r => r.species === selectedSpecies);
  }, [records, selectedSpecies]);

  const ownWithout = useMemo(() =>
    records.filter(r => r.latitud == null || r.longitud == null),
    [records]
  );

  // Estadísticas sidebar
  const filtered = selectedSpecies === 'all'
    ? records
    : records.filter(r => r.species === selectedSpecies);
  const uniqueDepts = [...new Set(filtered.map(r => r.departamento).filter(Boolean))];
  const uniqueMunis = [...new Set(filtered.map(r => r.municipio).filter(Boolean))];

  const speciesCounts = useMemo(() => {
    const counts = {};
    allSpecies.forEach(s => {
      const gbif = (gbifBySpecies[s] || []).length;
      const own  = records.filter(r => r.species === s).length;
      counts[s]  = { gbif, own };
    });
    return counts;
  }, [allSpecies, gbifBySpecies, records]);

  const groupedWithout = useMemo(() => {
    const groups = {};
    ownWithout.forEach(r => {
      const key = `${r.departamento || ''}|${r.municipio || ''}`;
      if (!groups[key]) groups[key] = { dept: r.departamento, muni: r.municipio, count: 0 };
      groups[key].count++;
    });
    return Object.values(groups).sort((a, b) => b.count - a.count);
  }, [ownWithout]);

  const isLoading = isLoadingRecords || isLoadingGbif;
  const totalGbif = gbifPoints.length;
  const totalOwn  = ownWithCoords.length;

  return (
    <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">

      {/* Panel izquierdo */}
      <div className="w-full lg:w-72 flex flex-col gap-4 overflow-y-auto">

        {/* Filtro */}
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
            <option value="all">Todas las especies ({allSpecies.length})</option>
            {allSpecies.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Estado de amenaza — solo cuando hay especie seleccionada */}
        {selectedSpecies !== 'all' && (
          <div className="bg-white rounded-lg p-4 shadow-sm border border-unergy-green">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-unergy-green" />
              <span className="text-sm font-semibold text-gray-700">Estado de Amenaza</span>
            </div>
            {isLoadingThreat ? (
              <div className="flex items-center gap-2 text-gray-400 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /><span>Consultando APIs...</span>
              </div>
            ) : threatInfo ? (
              <div className="space-y-2">
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
          </div>
        )}

        {/* Resumen */}
        <div className="bg-white rounded-lg p-4 shadow-sm border border-unergy-green">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 className="h-4 w-4 text-unergy-green" />
            <span className="text-sm font-semibold text-gray-700">Resumen</span>
          </div>
          <div className="space-y-2">
            {isLoadingGbif ? (
              <div className="flex items-center gap-2 text-gray-400 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /><span>Cargando GBIF...</span>
              </div>
            ) : (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-blue-500 flex items-center gap-1"><Globe className="h-3 w-3" /> Ocurrencias GBIF</span>
                  <span className="font-semibold text-blue-600">{totalGbif}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-unergy-green flex items-center gap-1"><MapPin className="h-3 w-3" /> Registros propios</span>
                  <span className="font-semibold text-gray-800">{totalOwn}</span>
                </div>
                {selectedSpecies === 'all' && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Departamentos</span>
                      <span className="font-semibold text-gray-800">{uniqueDepts.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Municipios</span>
                      <span className="font-semibold text-gray-800">{uniqueMunis.length}</span>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Leyenda de especies */}
        {!isLoadingGbif && allSpecies.length > 0 && (
          <div className="bg-white rounded-lg p-4 shadow-sm border border-unergy-green">
            <p className="text-sm font-semibold text-gray-700 mb-3">Especies del modelo</p>
            <div className="space-y-2">
              {allSpecies.map(sp => {
                const counts = speciesCounts[sp] || { gbif: 0, own: 0 };
                const isActive = selectedSpecies === 'all' || selectedSpecies === sp;
                return (
                  <div
                    key={sp}
                    onClick={() => setSelectedSpecies(selectedSpecies === sp ? 'all' : sp)}
                    className={`flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 transition-colors
                      ${selectedSpecies === sp ? 'bg-green-50 border border-unergy-green' : 'hover:bg-gray-50'}`}
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-none"
                      style={{ backgroundColor: speciesColorMap[sp] || '#999', opacity: isActive ? 1 : 0.4 }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs truncate font-medium ${isActive ? 'text-gray-800' : 'text-gray-400'}`}>{sp}</p>
                      <p className="text-[10px] text-gray-400">
                        {counts.gbif} GBIF{counts.own > 0 ? ` · ${counts.own} propio${counts.own > 1 ? 's' : ''}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">Clic para filtrar por especie</p>
          </div>
        )}

        {/* Sin coordenadas */}
        {groupedWithout.length > 0 && (
          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
            <div className="flex items-center gap-2 mb-3">
              <List className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">Registros sin GPS</span>
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
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 gap-3">
            <Loader2 className="h-8 w-8 text-unergy-green animate-spin" />
            <p className="text-gray-500 text-sm">Cargando distribución global de especies...</p>
            {isLoadingGbif && (
              <p className="text-gray-400 text-xs">Consultando GBIF para {Object.keys(gbifBySpecies).length || '...'} especies</p>
            )}
          </div>
        ) : gbifError && totalGbif === 0 && totalOwn === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 p-8 text-center">
            <Globe className="h-14 w-14 text-gray-200 mb-4" />
            <p className="text-gray-500 font-medium">No se pudo conectar con GBIF</p>
            <p className="text-gray-400 text-sm mt-1">{gbifError}</p>
          </div>
        ) : (
          <MapContainer
            center={[4.5709, -74.2973]}
            zoom={5}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Ocurrencias GBIF — marcadores pequeños semitransparentes */}
            {gbifPoints.map((occ, i) => (
              <CircleMarker
                key={`gbif-${i}`}
                center={[occ.lat, occ.lng]}
                radius={4}
                pathOptions={{
                  color: speciesColorMap[occ.species] || '#999',
                  weight: 0.5,
                  fillColor: speciesColorMap[occ.species] || '#999',
                  fillOpacity: 0.55,
                }}
              >
                <Popup>
                  <div style={{ minWidth: '150px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{
                        width: '10px', height: '10px', borderRadius: '50%',
                        backgroundColor: speciesColorMap[occ.species] || '#999',
                        flexShrink: 0,
                      }} />
                      <p style={{ fontWeight: 'bold', fontSize: '12px', fontStyle: 'italic' }}>{occ.species}</p>
                    </div>
                    <p style={{ fontSize: '10px', color: '#888', marginBottom: '2px' }}>Fuente: GBIF</p>
                    <hr style={{ margin: '4px 0' }} />
                    <p style={{ fontSize: '11px', color: '#555' }}>
                      {[occ.stateProvince, occ.country].filter(Boolean).join(', ') || 'Sin localidad'}
                    </p>
                    {occ.year && <p style={{ fontSize: '11px', color: '#999' }}>Año: {occ.year}</p>}
                  </div>
                </Popup>
              </CircleMarker>
            ))}

            {/* Registros propios — marcadores más grandes con borde blanco */}
            {ownWithCoords.map(r => (
              <CircleMarker
                key={`own-${r.id}`}
                center={[r.latitud, r.longitud]}
                radius={10}
                pathOptions={{
                  color: '#fff',
                  weight: 2,
                  fillColor: speciesColorMap[r.species] || '#006B33',
                  fillOpacity: 1,
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
