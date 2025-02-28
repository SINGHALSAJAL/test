import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Camera, AlertTriangle, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import DashboardSidebar from "@/components/DashboardSidebar";
import { useCamera } from "@/hooks/useCamera";
import CameraPermissionGuide from "@/components/CameraPermissionGuide";

// Define the result type
interface ScanResult {
  food: string;
  calories: number;
  protein: number;
  carbs: number;
}

const ScanFoodPage = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanResult, setScanResult] = useState<null | ScanResult>(null);
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);
  const [browserName, setBrowserName] = useState('default');
  
  // Use our custom camera hook
  const { 
    isAvailable, 
    isPermissionDenied,
    startCamera, 
    stopCamera, 
    stream, 
    videoRef, 
    retryCamera 
  } = useCamera({
    preferredFacing: 'environment',
    onError: (error) => {
      console.error("Camera hook error:", error);
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || 
          error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setShowPermissionGuide(true);
      }
      setIsScanning(false);
    }
  });

  // Detect browser for specific permission instructions
  useEffect(() => {
    const detectBrowser = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      if (userAgent.indexOf('firefox') > -1) {
        setBrowserName('firefox');
      } else if (userAgent.indexOf('chrome') > -1 || userAgent.indexOf('chromium') > -1) {
        setBrowserName('chrome');
      } else if (userAgent.indexOf('safari') > -1) {
        setBrowserName('safari');
      } else {
        setBrowserName('default');
      }
    };
    
    detectBrowser();
  }, []);
  
  // Start the webcam for food scanning
  const startScanning = async () => {
    setIsScanning(true);
    setScanResult(null);
    setShowPermissionGuide(false);
    
    const mediaStream = await startCamera();
    
    if (!mediaStream) {
      setIsScanning(false);
      return;
    }
    
    toast.success("Camera started successfully. Point at your food and capture.");
  };

  // Stop the webcam
  const stopScanning = () => {
    stopCamera();
    setIsScanning(false);
  };

  // Convert canvas to base64
  const canvasToBase64 = (canvas: HTMLCanvasElement): string => {
    return canvas.toDataURL('image/jpeg').split(',')[1];
  };

  // Call Claude Vision API to analyze the food image
  const analyzeFoodWithClaude = async (base64Image: string): Promise<ScanResult> => {
    try {
      const apiKey = import.meta.env.VITE_CLAUDE_API_KEY;
      
      if (!apiKey) {
        throw new Error("Claude API key not found");
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: base64Image
                  }
                },
                {
                  type: "text",
                  text: "Identify what food item is in this image. Then provide nutritional information in this format: {\"food\": \"Food Name\", \"calories\": calories_number, \"protein\": protein_grams, \"carbs\": carbs_grams}. Return only the JSON object."
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error("API request failed");
      }

      const data = await response.json();
      const content = data.content[0].text;
      
      const jsonMatch = content.match(/({[\s\S]*?})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error("Error analyzing food:", error);
      throw error;
    }
  };

  // Capture and analyze image
  const captureImage = async () => {
    if (!videoRef.current || !stream) {
      toast.error("Camera not available");
      return;
    }

    try {
      setIsAnalyzing(true);
      toast.info("Analyzing your food...");
      
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");
      
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const base64Image = canvasToBase64(canvas);
      
      stopScanning();
      
      const result = await analyzeFoodWithClaude(base64Image);
      setScanResult(result);
      toast.success("Food analyzed successfully!");
      
    } catch (error) {
      console.error("Analysis failed:", error);
      toast.error("Failed to analyze food. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-yoga-light flex">
      <DashboardSidebar />
      
      <div className="flex-1 p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-yoga-dark mb-6">Scan Your Food</h1>
          
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold text-yoga-dark">Nutrition Analyzer</h3>
              <p className="text-yoga-secondary text-sm mt-1">
                Use your camera to scan food items and get nutritional information
              </p>
            </div>
            
            {showPermissionGuide && (
              <div className="mb-6">
                <CameraPermissionGuide browser={browserName} />
              </div>
            )}
            
            <div className="flex flex-col items-center">
              {isScanning ? (
                <div className="relative w-full max-w-md rounded-lg overflow-hidden bg-black mb-4">
                  <video 
                    ref={videoRef}
                    autoPlay 
                    playsInline 
                    className="w-full h-64 object-cover"
                  />
                  <div className="absolute inset-0 border-2 border-yoga-primary/50 rounded-lg pointer-events-none"></div>
                  
                  <div className="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded-full flex items-center">
                    <span className="w-2 h-2 bg-white rounded-full mr-1 animate-pulse"></span>
                    Camera Active
                  </div>
                </div>
              ) : scanResult ? (
                <div className="w-full max-w-md bg-yoga-light/50 rounded-lg p-5 mb-4">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="font-semibold text-yoga-dark text-lg">{scanResult.food}</h4>
                    <span className="bg-yoga-primary/10 text-yoga-primary text-xs px-2 py-1 rounded">
                      Analyzed
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white p-3 rounded-lg">
                      <span className="text-yoga-secondary text-xs">Calories</span>
                      <p className="font-medium text-yoga-dark">{scanResult.calories} kcal</p>
                    </div>
                    <div className="bg-white p-3 rounded-lg">
                      <span className="text-yoga-secondary text-xs">Protein</span>
                      <p className="font-medium text-yoga-dark">{scanResult.protein}g</p>
                    </div>
                    <div className="bg-white p-3 rounded-lg">
                      <span className="text-yoga-secondary text-xs">Carbs</span>
                      <p className="font-medium text-yoga-dark">{scanResult.carbs}g</p>
                    </div>
                  </div>
                  
                  <div className="mt-4 text-center">
                    <Link to="/dashboard" className="text-yoga-primary text-sm font-medium hover:underline mr-4">
                      Back to Dashboard
                    </Link>
                    <button 
                      onClick={startScanning}
                      className="text-yoga-primary text-sm font-medium hover:underline"
                    >
                      Scan Another Food
                    </button>
                  </div>
                </div>
              ) : !isAvailable ? (
                <div className="w-full max-w-md bg-red-50 border border-red-200 rounded-lg p-5 mb-4 text-center">
                  <AlertTriangle size={32} className="mx-auto text-red-500 mb-2" />
                  <h4 className="font-semibold text-red-700 mb-1">No Camera Detected</h4>
                  <p className="text-red-600 text-sm mb-3">
                    We couldn't detect a camera on your device. Please ensure your device has a camera connected and working.
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    className="text-sm bg-red-100 hover:bg-red-200 text-red-700 py-1 px-3 rounded flex items-center gap-1 mx-auto"
                  >
                    <RefreshCw size={14} /> Retry Detection
                  </button>
                </div>
              ) : (
                <div className="w-full max-w-md bg-yoga-light/50 rounded-lg p-10 flex flex-col items-center justify-center mb-4">
                  <Camera size={48} className="text-yoga-secondary mb-3" />
                  <p className="text-yoga-secondary text-center">
                    Press the button below to activate your camera and scan food
                  </p>
                  {isPermissionDenied && (
                    <div className="mt-3 text-red-500 text-sm text-center">
                      <p>Camera permission was denied. Please enable camera access to use this feature.</p>
                      <button 
                        onClick={() => setShowPermissionGuide(true)}
                        className="underline mt-1"
                      >
                        Show me how
                      </button>
                    </div>
                  )}
                </div>
              )}
              
              <div className="flex gap-3">
                {isScanning ? (
                  <>
                    <button
                      onClick={captureImage}
                      disabled={isAnalyzing}
                      className={`btn-primary flex items-center gap-1 ${isAnalyzing ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      <Camera size={16} /> {isAnalyzing ? "Analyzing..." : "Capture"}
                    </button>
                    <button
                      onClick={stopScanning}
                      disabled={isAnalyzing}
                      className={`btn-secondary flex items-center gap-1 ${isAnalyzing ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={startScanning}
                      disabled={!isAvailable || isAnalyzing}
                      className={`btn-primary flex items-center gap-1 ${(!isAvailable || isAnalyzing) ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      <Camera size={16} /> {scanResult ? "Scan Another Food" : "Start Scanning"}
                    </button>
                    {isPermissionDenied && (
                      <button
                        onClick={retryCamera}
                        className="btn-secondary flex items-center gap-1"
                      >
                        <RefreshCw size={16} /> Retry Permission
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScanFoodPage;