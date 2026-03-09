import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Filter, List, BarChart2 } from 'lucide-react';

const SPECIES_COLORS = [
  '#006B33', '#e67e22', '#2980b9', '#8e44ad', '#c0392b',
  '#16a085', '#d35400', '#f39c12', '#2c3e50', '#27ae60',
  '#e74c3c', '#1abc9c', '#9b59b6', '#34495e', '#f1c40f',
];

function MapView() {
  const [records, setRecords] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedSpecies, setSelectedSpecies] = useState('all');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/records').then(r => r.ok ? r.json() : []),
      fetch('/api/classes').then(r => r.ok ? r.json() : []),
    ]).then(([recs, cls]) => {
      setRecords(Array.isArray(recs) ? recs : []);
      setClasses(Array.isArray(cls) ? cls : []);
    }).catch(() => {}).finally(() => setIsLoading(false));
  }, []);

  const speciesColorMap = useMemo(() => {
    const allSpecies = [...new Set(records.map(r => r.predicted_species).filter(Boolean))];
    const map = {};
    allSpecies.forEach((s, i) => { map[s] = SPECIES_COLORS[i % SPECIES_COLORS.length]; });
    return map;
  }, [records]);

  const filtered = useMemo(() => (
    selectedSpecies === 'all' ? records : records.filter(r => r.predicted_species === selectedSpecies)
  ), [records, selectedSpecies]);

  const withCoords    = filtered.filter(r => r.latitud != null && r.longitud != null);
  const withoutCoords = filtered.filter(r => r.latitud == null || r.longitud == null);

  const uniqueSpecies = [...new Set(records.map(r => r.predicted_species).filter(Boolean))];
  const uniqueDepts   = [...new Set(filtered.map(r => r.departamento).filter(Boolean))];
  const uniqueMunis   = [...new Set(filtered.map(r => r.municipio).filter(Boolean))];

  // Conteo por especie para la especie seleccionada o todas
  const speciesCounts = useMemo(() => {
    const counts = {};
    filtered.forEach(r => {
      if (r.predicted_species) counts[r.predicted_species] = (counts[r.predicted_species] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  // Registros sin coordenadas agrupados por ubicación
  const groupedWithout = useMemo(() => {
    const groups = {};
    withoutCoords.forEach(r => {
      const key = `${r.departamento || ''}|${r.municipio || ''}`;
      if (!groups[key]) groups[key] = { dept: r.departamento, muni: r.municipio, count: 0 };
      groups[key].count++;
    });
    return Object.values(groups).sort((a, b) => b.count - a.count);
  }, [withoutCoords]);

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
              ['Con coordenadas GPS', withCoords.length],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-semibold text-gray-800">{val}</span>
              </div>
            ))}
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
        ) : withCoords.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 p-8 text-center">
            <MapPin className="h-14 w-14 text-gray-200 mb-4" />
            <p className="text-gray-500 font-medium">No hay coordenadas GPS en los registros</p>
            <p className="text-gray-400 text-sm mt-1 max-w-xs">
              Hay {filtered.length} registro{filtered.length > 1 ? 's' : ''} guardado{filtered.length > 1 ? 's' : ''} por municipio/departamento pero sin latitud/longitud.<br />
              Agrega coordenadas al clasificar para verlos en el mapa.
            </p>
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
            {withCoords.map(r => (
              <CircleMarker
                key={r.id}
                center={[r.latitud, r.longitud]}
                radius={9}
                pathOptions={{
                  color: '#fff',
                  weight: 1.5,
                  fillColor: speciesColorMap[r.predicted_species] || '#006B33',
                  fillOpacity: 0.9,
                }}
              >
                <Popup>
                  <div style={{ minWidth: '160px' }}>
                    <p style={{ fontWeight: 'bold', marginBottom: '2px' }}>{r.predicted_species}</p>
                    <p style={{ color: '#666', fontSize: '11px' }}>Árbol #{r.tree_id} · {r.confidence}% confianza</p>
                    <hr style={{ margin: '6px 0' }} />
                    <p style={{ fontSize: '12px' }}>
                      {[r.vereda, r.municipio, r.departamento].filter(Boolean).join(', ')}
                    </p>
                    <p style={{ color: '#999', fontSize: '11px', marginTop: '2px' }}>
                      {r.timestamp?.slice(0, 10)}
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
