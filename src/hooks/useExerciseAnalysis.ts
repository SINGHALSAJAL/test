import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

// Define types
interface AnalysisResult {
  success: boolean;
  message: string;
  feedback: string[];
  angle: number;
  reps: number;
  accuracy: number;
  exercise?: string;
}

interface ExerciseAnalysisProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  selectedExercise: string;
  isTracking: boolean;
}

const API_URL = 'http://localhost:5000';

export const useExerciseAnalysis = ({ 
  videoRef, 
  selectedExercise, 
  isTracking 
}: ExerciseAnalysisProps) => {
  const [availableExercises, setAvailableExercises] = useState<string[]>([]);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Get available exercises from API
  useEffect(() => {
    const fetchExercises = async () => {
      try {
        const response = await fetch(`${API_URL}/api/exercises`);
        const data = await response.json();
        setAvailableExercises(data.exercises.map((ex: string) => 
          ex.charAt(0).toUpperCase() + ex.slice(1)
        ));
      } catch (error) {
        console.error('Error fetching exercises:', error);
        setError('Failed to fetch available exercises');
      }
    };

    fetchExercises();
  }, []);

  // Start or stop analysis based on tracking state
  useEffect(() => {
    if (isTracking && videoRef.current) {
      // Create canvas if it doesn't exist
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      
      // Start analysis loop
      startAnalysisLoop();
      
      // Reset result when starting new tracking
      setAnalysisResult(null);
    } else {
      // Stop analysis loop when tracking stops
      stopAnalysisLoop();
    }

    return () => {
      stopAnalysisLoop();
    };
  }, [isTracking, selectedExercise, videoRef]);

  // Reset exercise when starting new tracking
  useEffect(() => {
    if (isTracking && selectedExercise) {
      resetExercise();
    }
  }, [isTracking, selectedExercise]);

  const startAnalysisLoop = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
    }
    
    // Analyze frame every 250ms
    intervalRef.current = window.setInterval(() => {
      analyzeCurrentFrame();
    }, 250);
  };

  const stopAnalysisLoop = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const resetExercise = async () => {
    try {
      if (!selectedExercise) return;
      
      const response = await fetch(`${API_URL}/api/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          exercise: selectedExercise.toLowerCase(),
        }),
      });
      
      const data = await response.json();
      if (!data.success) {
        console.error('Error resetting exercise:', data.message);
      }
    } catch (error) {
      console.error('Error resetting exercise:', error);
    }
  };

  const analyzeCurrentFrame = async () => {
    if (!videoRef.current || !selectedExercise || !isTracking || !canvasRef.current || isAnalyzing) {
      return;
    }

    try {
      setIsAnalyzing(true);
      
      // Draw video frame to canvas
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }
      
      // Draw the video frame to the canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Convert canvas to base64 image
      const imageData = canvas.toDataURL('image/jpeg', 0.8);
      
      // Send to API
      const response = await fetch(`${API_URL}/api/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: imageData,
          exercise: selectedExercise.toLowerCase(),
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setAnalysisResult(result);
        setError(null);
      } else {
        console.warn('Analysis failed:', result.message);
      }
    } catch (error) {
      console.error('Error analyzing frame:', error);
      setError('Failed to analyze exercise form');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return {
    availableExercises,
    analysisResult,
    error,
    isAnalyzing,
  };
};