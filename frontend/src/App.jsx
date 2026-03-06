import React, { useState, useRef } from 'react';
import { UploadCloud, User, LogOut, Search, X, CheckCircle, Loader2 } from 'lucide-react';

function App() {
  const [images, setImages] = useState([
    { id: 1, url: 'https://images.unsplash.com/photo-1542385151-efd9000785a0?w=500&q=80', isMain: true },
    { id: 2, url: 'https://images.unsplash.com/photo-1599839956426-edbc9118b52f?w=500&q=80', isMain: false },
    { id: 3, url: 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=500&q=80', isMain: false },
    { id: 4, url: 'https://images.unsplash.com/photo-1628178652011-dc6aa8b486ba?w=500&q=80', isMain: false },
    { id: 5, url: 'https://images.unsplash.com/photo-1502425026210-67c26df1f7bd?w=500&q=80', isMain: false },
  ]);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    // Logic for drop would go here
  };

  const removeImage = (idToRemove) => {
    setImages(images.filter(img => img.id !== idToRemove));
  };

  const handleStartClassification = () => {
    setIsClassifying(true);
    // Simulate classification delay
    setTimeout(() => {
      setIsClassifying(false);
    }, 2000);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ backgroundImage: 'url("/Fondo de página 2.jpg")', backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(2px)' }}>
      {/* Header */}
      <header className="bg-unergy-green text-white py-3 px-6 flex justify-between items-center shadow-md">
        <div className="flex items-center space-x-2">
          <img src="/Logo Unergy.png" alt="Unergy" className="h-8" />
        </div>
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2 text-sm">
            <User className="h-4 w-4" />
            <span>Hola, Admin Unergy</span>
          </div>
          <button className="flex items-center space-x-1 border border-white/50 hover:bg-white/10 px-3 py-1.5 rounded-md text-sm transition-colors">
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col min-h-0">
        <div className="bg-white/90 rounded-lg px-5 py-3 shadow-sm mb-6 border border-unergy-green text-center">
          <h1 className="text-3xl font-bold text-gray-800">Happy Tree Friends - Clasificación Automatizada</h1>
        </div>
        
        <div className="flex flex-col lg:flex-row gap-6 flex-1">
          
          {/* Left Column - Upload Section */}
          <div className="flex-1 flex flex-col gap-4">
            <div className="bg-white/90 rounded-lg px-4 py-2 shadow-sm inline-block border border-unergy-green">
              <h2 className="text-lg font-medium text-gray-700">1. Cargar Imágenes del Inventario</h2>
            </div>
            
            <div className="bg-white rounded-lg p-4 shadow-sm border border-unergy-green flex flex-col h-full gap-4">
              
              {/* Dropzone */}
              <div 
                className={`flex-1 border-2 border-dashed rounded-lg flex flex-col items-center justify-center p-8 transition-colors cursor-pointer min-h-[160px]
                  ${isDragActive ? 'border-unergy-green bg-green-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="relative mb-4 text-gray-600">
                  <UploadCloud className="h-16 w-16" />
                </div>
                <p className="text-md text-gray-700 text-center font-medium">Arrastra tus fotos aquí o haz clic para seleccionar</p>
                <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" />
              </div>

              {/* Image Gallery */}
              <div className="border border-unergy-green rounded-lg p-3 bg-green-50/30">
                <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-thin">
                  {images.map((img) => (
                    <div key={img.id} className="relative flex-none w-28 h-28 group rounded-md overflow-hidden border border-gray-200">
                      {img.isMain && (
                        <div className="absolute top-1 left-1 z-10 bg-green-500 rounded-full p-0.5 shadow-sm">
                          <CheckCircle className="h-4 w-4 text-white" />
                        </div>
                      )}
                      
                      <button 
                         onClick={() => removeImage(img.id)}
                         className="absolute top-1 right-1 z-10 bg-white/80 hover:bg-white text-gray-700 rounded-sm p-0.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      
                      <img src={img.url} alt="Specimen" className="w-full h-full object-cover" />
                    </div>
                  ))}
                  
                  {images.length === 0 && (
                     <div className="w-full h-28 flex items-center justify-center text-sm text-gray-400 italic">
                        No hay imágenes seleccionadas
                     </div>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <button 
                onClick={handleStartClassification}
                disabled={images.length === 0 || isClassifying}
                className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 font-medium text-white shadow-sm transition-all
                  ${images.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-unergy-green hover:bg-unergy-dark'}`}
              >
                {!isClassifying ? (
                   <>
                     <span>[</span>
                     <Search className="h-4 w-4" />
                     <span>Iniciar Clasificación Automática ]</span>
                   </>
                ) : (
                  <>
                     <Loader2 className="h-5 w-5 animate-spin" />
                     <span>Procesando lote...</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column - Results Section */}
          <div className="w-full lg:w-[400px] xl:w-[450px] flex flex-col gap-4">
            <div className="bg-white/90 rounded-lg px-4 py-2 shadow-sm inline-block border border-unergy-green">
              <h2 className="text-lg font-medium text-gray-700">2. Resultados de la Identificación</h2>
            </div>
            
            <div className="bg-gray-200 rounded-lg shadow-inner border border-unergy-green flex-1 flex flex-col">
              {/* Empty state representing "esperando datos" */}
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <div className="w-20 h-20 bg-gray-300 rounded-xl mb-6 relative overflow-hidden flex items-center justify-center">
                   <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
                </div>
                <p className="text-gray-600 font-medium mb-2">
                  Sube imágenes y haz clic en Iniciar para<br/>ver los resultados...
                </p>
                <div className="flex items-center gap-2 text-gray-400 text-sm mt-4">
                  <div className="h-1.5 w-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                  <span>esperando datos</span>
                </div>
              </div>
            </div>
            
          </div>

        </div>
      </main>
    </div>
    </div>
  );
}

export default App;
