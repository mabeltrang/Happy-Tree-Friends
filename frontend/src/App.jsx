import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, User, X, CheckCircle, XCircle, Search, Loader2, Download, AlertCircle, BookOpen, RefreshCw, MapPin, Map } from 'lucide-react';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import MapView from './MapView';

function App() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState(null);
  const [feedbackStats, setFeedbackStats] = useState({ total: 0, by_species: {} });
  const [retrainMsg, setRetrainMsg] = useState('');
  const [isRetraining, setIsRetraining] = useState(false);
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);
  const [knownClasses, setKnownClasses] = useState([]);
  const [speciesInfo, setSpeciesInfo]   = useState({});

  // ── Campos de ubicación ──
  const [departamento, setDepartamento] = useState('');
  const [municipio, setMunicipio]       = useState('');
  const [vereda, setVereda]             = useState('');
  const [latitud, setLatitud]           = useState('');
  const [longitud, setLongitud]         = useState('');

  const [activeTab, setActiveTab] = useState('clasificar');

  const fileInputRef = useRef(null);
  const nextId       = useRef(1);
  const pollRef      = useRef(null);

  // --- File handling ---
  const addFiles = (fileList) => {
    const newEntries = Array.from(fileList)
      .filter((f) => f.type.startsWith('image/'))
      .map((f) => ({ id: nextId.current++, file: f, previewUrl: URL.createObjectURL(f) }));
    setFiles((prev) => [...prev, ...newEntries]);
    setError(null);
  };

  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragActive(false); };
  const handleDragOver  = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragActive(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };
  const handleFileInput = (e) => {
    if (e.target.files.length > 0) addFiles(e.target.files);
    e.target.value = '';
  };
  const removeFile = (id) => {
    setFiles((prev) => {
      const entry = prev.find((f) => f.id === id);
      if (entry) URL.revokeObjectURL(entry.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  // --- Classification ---
  const locationReady = departamento.trim() && municipio.trim();

  const handleStartClassification = async () => {
    if (files.length === 0 || !locationReady) return;
    setIsClassifying(true);
    setError(null);
    setResults([]);

    const formData = new FormData();
    files.forEach((entry) => formData.append('files', entry.file, entry.file.name));
    formData.append('departamento', departamento.trim());
    formData.append('municipio',    municipio.trim());
    formData.append('vereda',       vereda.trim());
    if (latitud)  formData.append('latitud',  latitud);
    if (longitud) formData.append('longitud', longitud);

    try {
      const response = await fetch('/api/classify', { method: 'POST', body: formData });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Error desconocido del servidor.' }));
        throw new Error(err.detail || `Error ${response.status}`);
      }
      const data = await response.json();
      setResults(data.map((r) => ({ ...r, verification: null })));
    } catch (e) {
      setError(e.message);
    } finally {
      setIsClassifying(false);
    }
  };

  // --- Verification ---
  const handleVerify = (treeId, status) => {
    setResults((prev) =>
      prev.map((r) =>
        r.tree_id === treeId
          ? { ...r, verification: r.verification === status ? null : status, correction: r.verification === status ? '' : r.correction }
          : r
      )
    );
  };
  const handleCorrection = (treeId, value) => {
    setResults((prev) => prev.map((r) => r.tree_id === treeId ? { ...r, correction: value } : r));
  };

  // --- Feedback & Retrain ---
  const parseTreeId = (filename) => {
    const name = filename.replace(/\.[^.]+$/, '');
    const match = name.match(/^(\w+)-\d+$/);
    return match ? match[1] : null;
  };
  const fetchFeedbackStats = async () => {
    try {
      const res = await fetch('/api/feedback/stats');
      if (res.ok) setFeedbackStats(await res.json());
    } catch (_) {}
  };
  useEffect(() => {
    fetchFeedbackStats();
    fetch('/api/classes').then(r => r.ok ? r.json() : []).then(d => setKnownClasses(Array.isArray(d) ? d : [])).catch(() => {});
    fetch('/api/species-info').then(r => r.ok ? r.json() : {}).then(d => setSpeciesInfo(d ?? {})).catch(() => {});
  }, []);

  const isKnownSpecies = (name) => {
    if (!Array.isArray(knownClasses) || !name?.trim()) return false;
    return knownClasses.some((c) => c.trim().toLowerCase() === name.trim().toLowerCase());
  };

  const pendingCorrections  = results.filter((r) => r.verification === 'rejected' && r.correction?.trim());
  const knownCorrections    = pendingCorrections.filter((r) => isKnownSpecies(r.correction));
  const unknownCorrections  = pendingCorrections.filter((r) => !isKnownSpecies(r.correction));

  const handleSaveFeedback = async () => {
    if (knownCorrections.length === 0) return;
    setIsSavingFeedback(true);
    try {
      for (const result of knownCorrections) {
        const matchedFiles = files.filter((f) => parseTreeId(f.file.name) === result.tree_id);
        if (!matchedFiles.length) continue;
        const formData = new FormData();
        formData.append('species', result.correction.trim());
        matchedFiles.forEach((f) => formData.append('files', f.file, f.file.name));
        await fetch('/api/feedback', { method: 'POST', body: formData });
      }
      await fetchFeedbackStats();
    } finally {
      setIsSavingFeedback(false);
    }
  };

  const handleDownloadUnknown = async () => {
    const zip = new JSZip();
    for (const result of unknownCorrections) {
      const speciesName = result.correction.trim();
      const matchedFiles = files.filter((f) => parseTreeId(f.file.name) === result.tree_id);
      for (const f of matchedFiles) {
        const buf = await f.file.arrayBuffer();
        zip.file(`${speciesName}/${f.file.name}`, buf);
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'especies_nuevas.zip'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleRetrain = async () => {
    setIsRetraining(true); setRetrainMsg('Iniciando...');
    await fetch('/api/retrain', { method: 'POST' });
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch('/api/retrain/status');
        const data = await res.json();
        setRetrainMsg(data.message);
        if (!data.running) { clearInterval(pollRef.current); setIsRetraining(false); fetchFeedbackStats(); }
      } catch (_) {}
    }, 1500);
  };

  // --- Excel export (incluye ubicación, nombre común y familia) ---
  const handleDownloadExcel = () => {
    const rows = results.map((r) => {
      const validatedSpecies =
        r.verification === 'confirmed' ? r.predicted_species
        : r.verification === 'rejected' && r.correction?.trim() ? r.correction.trim()
        : 'No determinado';
      const info = speciesInfo[validatedSpecies] ?? {};
      return {
        'ID Árbol':               r.tree_id,
        'Especie Predicha':       r.predicted_species,
        'Confianza (%)':          r.confidence,
        'Especie Validada':       validatedSpecies,
        'Nombre Común':           info.common_name ?? '',
        'Familia':                info.family      ?? '',
        'Estado de Verificación':
          r.verification === 'confirmed' ? 'Confirmado'
          : r.verification === 'rejected' ? 'Negado'
          : 'Sin verificar',
        'Departamento': r.departamento || departamento,
        'Municipio':    r.municipio    || municipio,
        'Vereda':       r.vereda       || vereda,
        'Latitud':      r.latitud      ?? latitud,
        'Longitud':     r.longitud     ?? longitud,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Identificación');
    XLSX.writeFile(wb, 'identificacion_arboles.xlsx');
  };

  // --- Render ---
  return (
    <div
      className="min-h-screen flex flex-col font-sans"
      style={{ backgroundImage: 'url("/Fondo de página 2.jpg")', backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}
    >
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(2px)' }}>
        {/* Header */}
        <header className="bg-unergy-green text-white py-3 px-6 flex justify-between items-center shadow-md">
          <div className="flex items-center space-x-2">
            <img src="/Logo Unergy.png" alt="Unergy" className="h-8" />
          </div>
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2 text-sm">
              <User className="h-4 w-4" /><span>Hola, Admin Unergy</span>
            </div>
            <button className="flex items-center space-x-1 border border-white/50 hover:bg-white/10 px-3 py-1.5 rounded-md text-sm transition-colors">
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col min-h-0">
          <div className="bg-white/90 rounded-lg px-5 py-3 shadow-sm mb-4 border border-unergy-green text-center">
            <h1 className="text-3xl font-bold text-gray-800">Happy Tree Friends - Clasificación Automatizada</h1>
          </div>

          {/* Pestañas */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('clasificar')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all shadow-sm
                ${activeTab === 'clasificar' ? 'bg-unergy-green text-white' : 'bg-white/90 text-gray-600 hover:bg-white border border-gray-200'}`}
            >
              <Search className="h-4 w-4" />
              Clasificación
            </button>
            <button
              onClick={() => setActiveTab('mapa')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all shadow-sm
                ${activeTab === 'mapa' ? 'bg-unergy-green text-white' : 'bg-white/90 text-gray-600 hover:bg-white border border-gray-200'}`}
            >
              <Map className="h-4 w-4" />
              Mapa de Distribución
            </button>
          </div>

          {activeTab === 'mapa' ? <MapView /> : (
          <div className="flex flex-col lg:flex-row gap-6 flex-1">
            {/* Left Column */}
            <div className="flex-1 min-w-0 flex flex-col gap-4">

              {/* ── Sección Ubicación ── */}
              <div className="bg-white/90 rounded-lg px-4 py-2 shadow-sm inline-block border border-unergy-green">
                <h2 className="text-lg font-medium text-gray-700">0. Ubicación del Lote</h2>
              </div>
              <div className="bg-white rounded-lg p-4 shadow-sm border border-unergy-green">
                <div className="flex items-center gap-2 mb-3 text-sm text-gray-500">
                  <MapPin className="h-4 w-4 text-unergy-green" />
                  <span>Departamento y Municipio son requeridos para clasificar</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Departamento <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={departamento}
                      onChange={(e) => setDepartamento(e.target.value)}
                      placeholder="Ej: Antioquia"
                      className="w-full text-sm rounded-md border border-gray-300 px-3 py-1.5 focus:outline-none focus:border-unergy-green"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Municipio <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={municipio}
                      onChange={(e) => setMunicipio(e.target.value)}
                      placeholder="Ej: Medellín"
                      className="w-full text-sm rounded-md border border-gray-300 px-3 py-1.5 focus:outline-none focus:border-unergy-green"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Vereda <span className="text-gray-400">(opcional)</span></label>
                    <input
                      type="text"
                      value={vereda}
                      onChange={(e) => setVereda(e.target.value)}
                      placeholder="Ej: La Esperanza"
                      className="w-full text-sm rounded-md border border-gray-300 px-3 py-1.5 focus:outline-none focus:border-unergy-green"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Latitud <span className="text-gray-400">(opcional)</span></label>
                      <input
                        type="number"
                        value={latitud}
                        onChange={(e) => setLatitud(e.target.value)}
                        placeholder="6.2442"
                        step="any"
                        className="w-full text-sm rounded-md border border-gray-300 px-3 py-1.5 focus:outline-none focus:border-unergy-green"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Longitud <span className="text-gray-400">(opcional)</span></label>
                      <input
                        type="number"
                        value={longitud}
                        onChange={(e) => setLongitud(e.target.value)}
                        placeholder="-75.5812"
                        step="any"
                        className="w-full text-sm rounded-md border border-gray-300 px-3 py-1.5 focus:outline-none focus:border-unergy-green"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Sección Upload ── */}
              <div className="bg-white/90 rounded-lg px-4 py-2 shadow-sm inline-block border border-unergy-green">
                <h2 className="text-lg font-medium text-gray-700">1. Cargar Imágenes del Inventario</h2>
              </div>

              <div className="bg-white rounded-lg p-4 shadow-sm border border-unergy-green flex flex-col h-full gap-4">
                <div
                  className={`flex-1 border-2 border-dashed rounded-lg flex flex-col items-center justify-center p-8 transition-colors cursor-pointer min-h-[160px]
                    ${isDragActive ? 'border-unergy-green bg-green-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}
                  onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadCloud className="h-16 w-16 mb-4 text-gray-600" />
                  <p className="text-md text-gray-700 text-center font-medium">Arrastra tus fotos aquí o haz clic para seleccionar</p>
                  <p className="text-xs text-gray-400 mt-1 text-center">
                    Nombres de archivo: <code>1-1.jpg</code>, <code>1-2.jpg</code>, <code>2-1.jpg</code>…
                  </p>
                  <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleFileInput} />
                </div>

                <div className="border border-unergy-green rounded-lg p-3 bg-green-50/30 overflow-hidden">
                  <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-thin">
                    {files.length === 0 ? (
                      <div className="w-full h-28 flex items-center justify-center text-sm text-gray-400 italic">No hay imágenes seleccionadas</div>
                    ) : (
                      files.map((entry) => (
                        <div key={entry.id} className="relative flex-none w-28 h-28 group rounded-md overflow-hidden border border-gray-200">
                          <button
                            onClick={() => removeFile(entry.id)}
                            className="absolute top-1 right-1 z-10 bg-white/80 hover:bg-white text-gray-700 rounded-sm p-0.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-3 w-3" />
                          </button>
                          <img src={entry.previewUrl} alt={entry.file.name} className="w-full h-full object-cover" />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-1 py-0.5">
                            <p className="text-white text-[10px] truncate">{entry.file.name}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-none" /><span>{error}</span>
                  </div>
                )}

                {!locationReady && files.length > 0 && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-none" />
                    <span>Completa Departamento y Municipio antes de clasificar.</span>
                  </div>
                )}

                <button
                  onClick={handleStartClassification}
                  disabled={files.length === 0 || isClassifying || !locationReady}
                  className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 font-medium text-white shadow-sm transition-all
                    ${files.length === 0 || isClassifying || !locationReady ? 'bg-gray-400 cursor-not-allowed' : 'bg-unergy-green hover:bg-unergy-dark'}`}
                >
                  {isClassifying ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /><span>Procesando lote...</span></>
                  ) : (
                    <><Search className="h-4 w-4" /><span>Iniciar Clasificación Automática</span></>
                  )}
                </button>
              </div>
            </div>

            {/* Right Column - Results */}
            <div className="w-full lg:w-[450px] xl:w-[500px] flex flex-col gap-4">
              <div className="bg-white/90 rounded-lg px-4 py-2 shadow-sm inline-block border border-unergy-green">
                <h2 className="text-lg font-medium text-gray-700">2. Resultados de la Identificación</h2>
              </div>

              <div className="bg-gray-200 rounded-lg shadow-inner border border-unergy-green flex-1 flex flex-col overflow-hidden">
                {results.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-20 h-20 bg-gray-300 rounded-xl mb-6 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
                    </div>
                    <p className="text-gray-600 font-medium mb-2">Sube imágenes y haz clic en Iniciar para<br />ver los resultados...</p>
                    <div className="flex items-center gap-2 text-gray-400 text-sm mt-4">
                      <div className="h-1.5 w-1.5 bg-gray-400 rounded-full animate-bounce" />
                      <span>esperando datos</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    {/* Badge de ubicación */}
                    {results[0]?.departamento && (
                      <div className="px-3 pt-3">
                        <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-800 text-xs font-medium px-2.5 py-1 rounded-full border border-green-300">
                          <MapPin className="h-3 w-3" />
                          {results[0].departamento} — {results[0].municipio}
                          {results[0].vereda ? ` · ${results[0].vereda}` : ''}
                        </span>
                      </div>
                    )}

                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                      {results.map((r) => (
                        <div
                          key={r.tree_id}
                          className={`flex items-center gap-3 bg-white rounded-lg p-3 shadow-sm border transition-colors
                            ${r.verification === 'confirmed' ? 'border-green-400 bg-green-50/50'
                              : r.verification === 'rejected' ? 'border-red-300 bg-red-50/50'
                              : 'border-gray-200'}`}
                        >
                          <div className="flex-none w-14 h-14 rounded-md overflow-hidden border border-gray-200 bg-gray-100">
                            {r.thumbnail
                              ? <img src={r.thumbnail} alt={`Árbol ${r.tree_id}`} className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">Sin foto</div>
                            }
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-500 font-medium">Árbol #{r.tree_id}</p>
                            <p className="text-sm font-semibold text-gray-800 truncate">{r.predicted_species}</p>
                            <p className="text-xs text-gray-400">{r.confidence}% confianza</p>
                            {r.verification === 'rejected' && (
                              <div className="mt-1.5">
                                <input
                                  type="text"
                                  value={r.correction || ''}
                                  onChange={(e) => handleCorrection(r.tree_id, e.target.value)}
                                  placeholder="Especie correcta..."
                                  className={`w-full text-xs rounded px-2 py-1 bg-white focus:outline-none text-gray-700 placeholder-gray-400 border
                                    ${!r.correction?.trim() ? 'border-red-300 focus:border-red-400'
                                      : isKnownSpecies(r.correction) ? 'border-green-400 focus:border-green-500'
                                      : 'border-amber-400 focus:border-amber-500'}`}
                                />
                                {r.correction?.trim() && !isKnownSpecies(r.correction) && (
                                  <p className="text-[10px] text-amber-600 mt-0.5 leading-tight">⚠ Especie no está en la base de datos. Se descargará para agregar manualmente.</p>
                                )}
                                {r.correction?.trim() && isKnownSpecies(r.correction) && (
                                  <p className="text-[10px] text-green-600 mt-0.5">✓ Especie reconocida</p>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col gap-1 flex-none">
                            <button onClick={() => handleVerify(r.tree_id, 'confirmed')} title="Confirmar"
                              className={`rounded-full p-1 transition-colors ${r.verification === 'confirmed' ? 'text-green-600 bg-green-100' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}>
                              <CheckCircle className="h-6 w-6" />
                            </button>
                            <button onClick={() => handleVerify(r.tree_id, 'rejected')} title="Negar"
                              className={`rounded-full p-1 transition-colors ${r.verification === 'rejected' ? 'text-red-600 bg-red-100' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}>
                              <XCircle className="h-6 w-6" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="p-3 border-t border-gray-300 flex flex-col gap-2">
                      <button onClick={handleDownloadExcel}
                        className="w-full py-2.5 rounded-lg flex items-center justify-center gap-2 font-medium text-white bg-unergy-green hover:bg-unergy-dark shadow-sm transition-all">
                        <Download className="h-4 w-4" /><span>Descargar Informe Excel</span>
                      </button>

                      {knownCorrections.length > 0 && (
                        <button onClick={handleSaveFeedback} disabled={isSavingFeedback}
                          className="w-full py-2.5 rounded-lg flex items-center justify-center gap-2 font-medium text-white bg-amber-500 hover:bg-amber-600 shadow-sm transition-all disabled:bg-gray-400 disabled:cursor-not-allowed">
                          {isSavingFeedback ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
                          <span>{isSavingFeedback ? 'Guardando...' : `Guardar ${knownCorrections.length} corrección${knownCorrections.length > 1 ? 'es' : ''} al modelo`}</span>
                        </button>
                      )}

                      {unknownCorrections.length > 0 && (
                        <button onClick={handleDownloadUnknown}
                          className="w-full py-2.5 rounded-lg flex items-center justify-center gap-2 font-medium text-white bg-slate-600 hover:bg-slate-700 shadow-sm transition-all">
                          <Download className="h-4 w-4" />
                          <span>Descargar {unknownCorrections.length} especie{unknownCorrections.length > 1 ? 's' : ''} nueva{unknownCorrections.length > 1 ? 's' : ''} (ZIP)</span>
                        </button>
                      )}

                      <div className="border border-gray-300 rounded-lg p-2.5 bg-gray-50">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-500 font-medium">
                            Banco de correcciones: <span className="text-gray-700 font-semibold">{feedbackStats.total} imágenes</span>
                          </span>
                        </div>
                        {retrainMsg && <p className="text-xs text-gray-500 mb-1.5 italic">{retrainMsg}</p>}
                        <button onClick={handleRetrain} disabled={isRetraining || feedbackStats.total === 0}
                          className="w-full py-2 rounded-lg flex items-center justify-center gap-2 font-medium text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all disabled:bg-gray-400 disabled:cursor-not-allowed text-sm">
                          {isRetraining ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          <span>{isRetraining ? 'Reentrenando...' : 'Reentrenar Modelo'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          )} {/* fin pestañas */}
        </main>
      </div>
    </div>
  );
}

export default App;
