from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import numpy as np
import base64
import mediapipe as mp
import time
from typing import Dict, List, Tuple, Optional
import json
import ssl
ssl._create_default_https_context = ssl._create_unverified_context

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

class ExerciseFormDetector:
    def __init__(self):
        # Initialize MediaPipe Pose
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            static_image_mode=False,
            model_complexity=2,  # Using the most accurate model
            enable_segmentation=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        self.mp_drawing = mp.solutions.drawing_utils
        
        # Exercise specifications
        self.exercises = {
            'squat': {
                'description': 'Stand with feet shoulder-width apart, lower your body until thighs are parallel to floor',
                'key_points': ['hip', 'knee', 'ankle'],
                'angle_thresholds': {
                    'knee': {'min': 70, 'max': 130, 'ideal': 90}
                },
                'rep_detection': 'knee_angle'
            },
            'pushup': {
                'description': 'Start in plank position, lower chest to floor, push back up',
                'key_points': ['shoulder', 'elbow', 'wrist'],
                'angle_thresholds': {
                    'elbow': {'min': 70, 'max': 170, 'ideal': 90}
                },
                'rep_detection': 'elbow_angle'
            },
            'lunge': {
                'description': 'Step forward with one leg, lowering hips until both knees are bent at 90 degrees',
                'key_points': ['hip', 'knee', 'ankle'],
                'angle_thresholds': {
                    'front_knee': {'min': 70, 'max': 110, 'ideal': 90},
                    'back_knee': {'min': 70, 'max': 110, 'ideal': 90}
                },
                'rep_detection': 'front_knee_angle'
            },
            'plank': {
                'description': 'Hold body in straight line from head to heels, supported by forearms and toes',
                'key_points': ['shoulder', 'hip', 'ankle'],
                'angle_thresholds': {
                    'hip': {'min': 160, 'max': 180, 'ideal': 180}
                },
                'rep_detection': 'time_held'
            },
            'bicep_curl': {
                'description': 'Start with arms by sides, bend elbows to lift weights towards shoulders',
                'key_points': ['shoulder', 'elbow', 'wrist'],
                'angle_thresholds': {
                    'elbow': {'min': 30, 'max': 160, 'ideal': 45}
                },
                'rep_detection': 'elbow_angle'
            },
            'shoulder_press': {
                'description': 'Start with weights at shoulder height, press upward until arms are extended',
                'key_points': ['shoulder', 'elbow', 'wrist'],
                'angle_thresholds': {
                    'elbow': {'min': 30, 'max': 170, 'ideal': 170}
                },
                'rep_detection': 'elbow_angle'
            }
        }
        
        # Rep counting variables
        self.rep_count = 0
        self.rep_stage = 'up'  # or 'down'
        self.last_angle = 0
        self.plank_start_time = 0
        self.plank_duration = 0
        self.is_plank_active = False
        
        # Feedback history
        self.feedback_history = []
        
        # Current exercise
        self.current_exercise = None
    
    def calculate_angle(self, a, b, c):
        """
        Calculate angle between three points (in degrees)
        """
        a = np.array(a)
        b = np.array(b)
        c = np.array(c)
        
        # Calculate vectors
        ba = a - b
        bc = c - b
        
        # Calculate dot product
        cosine_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc))
        cosine_angle = np.clip(cosine_angle, -1.0, 1.0)  # Ensure within domain of arccos
        
        # Calculate angle in degrees
        angle = np.arccos(cosine_angle)
        angle = np.degrees(angle)
        
        return angle
    
    def get_landmark_coordinates(self, landmarks, idx):
        """
        Extract coordinates from MediaPipe landmarks
        """
        return [landmarks[idx].x, landmarks[idx].y, landmarks[idx].z]
    
    def analyze_squat_form(self, landmarks):
        """
        Analyze form for squats
        """
        # Get relevant landmarks
        hip_l = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.LEFT_HIP.value)
        knee_l = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.LEFT_KNEE.value)
        ankle_l = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.LEFT_ANKLE.value)
        
        hip_r = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.RIGHT_HIP.value)
        knee_r = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.RIGHT_KNEE.value)
        ankle_r = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.RIGHT_ANKLE.value)
        
        # Calculate knee angles
        left_knee_angle = self.calculate_angle(hip_l, knee_l, ankle_l)
        right_knee_angle = self.calculate_angle(hip_r, knee_r, ankle_r)
        avg_knee_angle = (left_knee_angle + right_knee_angle) / 2
        
        # Feedback based on angles
        feedback = []
        thresholds = self.exercises['squat']['angle_thresholds']['knee']
        
        if avg_knee_angle < thresholds['min']:
            feedback.append("Knees bent too much. Try not to go too deep.")
        elif avg_knee_angle > thresholds['max']:
            feedback.append("Not deep enough. Lower your body more.")
        
        # Check knee alignment with ankles
        shoulder_width = abs(hip_l[0] - hip_r[0])
        knee_width = abs(knee_l[0] - knee_r[0])
        ankle_width = abs(ankle_l[0] - ankle_r[0])
        
        if knee_width > shoulder_width * 1.5:
            feedback.append("Knees too wide. Keep them aligned with shoulders.")
        elif knee_width < ankle_width * 0.8:
            feedback.append("Knees caving in. Push them outward.")
        
        # Rep counting using knee angle
        if avg_knee_angle < 100 and self.rep_stage == 'up':
            self.rep_stage = 'down'
        if avg_knee_angle > 160 and self.rep_stage == 'down':
            self.rep_stage = 'up'
            self.rep_count += 1
        
        return feedback, avg_knee_angle
    
    def analyze_pushup_form(self, landmarks):
        """
        Analyze form for pushups
        """
        # Get relevant landmarks
        shoulder_l = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.LEFT_SHOULDER.value)
        elbow_l = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.LEFT_ELBOW.value)
        wrist_l = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.LEFT_WRIST.value)
        
        shoulder_r = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.RIGHT_SHOULDER.value)
        elbow_r = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.RIGHT_ELBOW.value)
        wrist_r = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.RIGHT_WRIST.value)
        
        # Get body alignment landmarks
        hip_l = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.LEFT_HIP.value)
        hip_r = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.RIGHT_HIP.value)
        ankle_l = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.LEFT_ANKLE.value)
        ankle_r = self.get_landmark_coordinates(landmarks, self.mp_pose.PoseLandmark.RIGHT_ANKLE.value)
        
        # Calculate elbow angles
        left_elbow_angle = self.calculate_angle(shoulder_l, elbow_l, wrist_l)
        right_elbow_angle = self.calculate_angle(shoulder_r, elbow_r, wrist_r)
        avg_elbow_angle = (left_elbow_angle + right_elbow_angle) / 2
        
        # Calculate hip alignment angle
        hip_mid = [(hip_l[0] + hip_r[0])/2, (hip_l[1] + hip_r[1])/2, (hip_l[2] + hip_r[2])/2]
        shoulder_mid = [(shoulder_l[0] + shoulder_r[0])/2, (shoulder_l[1] + shoulder_r[1])/2, (shoulder_l[2] + shoulder_r[2])/2]
        ankle_mid = [(ankle_l[0] + ankle_r[0])/2, (ankle_l[1] + ankle_r[1])/2, (ankle_l[2] + ankle_r[2])/2]
        
        # Feedback based on angles
        feedback = []
        thresholds = self.exercises['pushup']['angle_thresholds']['elbow']
        
        if avg_elbow_angle < thresholds['min']:
            feedback.append("Arms bent too much. Push up higher.")
        elif avg_elbow_angle > thresholds['max']:
            feedback.append("Not going deep enough. Lower your chest more.")
        
        # Check body alignment
        hip_angle = self.calculate_angle(shoulder_mid, hip_mid, ankle_mid)
        if hip_angle < 160:
            feedback.append("Keep your body straight. Hips are sagging.")
        elif hip_angle > 200:
            feedback.append("Keep your body straight. Hips are too high.")
        
        # Rep counting using elbow angle
        if avg_elbow_angle < 110 and self.rep_stage == 'up':
            self.rep_stage = 'down'
        if avg_elbow_angle > 160 and self.rep_stage == 'down':
            self.rep_stage = 'up'
            self.rep_count += 1
        
        return feedback, avg_elbow_angle
    
    def analyze_exercise(self, landmarks):
        """
        Analyze the current exercise form
        """
        if not self.current_exercise:
            return ["Please select an exercise first"], 0, 0
        
        if self.current_exercise == 'squat':
            feedback, angle = self.analyze_squat_form(landmarks)
            return feedback, angle, self.rep_count
        elif self.current_exercise == 'pushup':
            feedback, angle = self.analyze_pushup_form(landmarks)
            return feedback, angle, self.rep_count
        else:
            return ["Exercise not fully implemented yet"], 0, 0
    
    def set_exercise(self, exercise_name):
        """
        Set the current exercise to analyze
        """
        exercise_name = exercise_name.lower()
        if exercise_name in self.exercises:
            self.current_exercise = exercise_name
            self.rep_count = 0
            self.rep_stage = 'up'
            self.plank_start_time = 0
            self.plank_duration = 0
            return True
        else:
            return False
    
    def process_frame(self, frame, exercise=None):
        """
        Process a video frame and return the analysis results
        """
        # Set exercise if specified
        if exercise and exercise.lower() in self.exercises:
            self.set_exercise(exercise.lower())
            
        # Convert the BGR image to RGB
        image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Process the image and find pose landmarks
        results = self.pose.process(image)
        
        # Default response
        response = {
            "success": False,
            "message": "No pose detected",
            "feedback": [],
            "angle": 0,
            "reps": 0,
            "accuracy": 0
        }
        
        # If landmarks are found, analyze exercise
        if results.pose_landmarks:
            feedback, angle, reps = self.analyze_exercise(results.pose_landmarks.landmark)
            
            # Calculate accuracy based on angle and exercise thresholds
            accuracy = 0
            if self.current_exercise:
                # Example: Calculate accuracy based on how close the angle is to the ideal
                thresholds = None
                if self.current_exercise == 'squat':
                    thresholds = self.exercises['squat']['angle_thresholds']['knee']
                elif self.current_exercise == 'pushup':
                    thresholds = self.exercises['pushup']['angle_thresholds']['elbow']
                
                if thresholds:
                    ideal = thresholds['ideal']
                    max_deviation = max(abs(thresholds['min'] - ideal), abs(thresholds['max'] - ideal))
                    current_deviation = abs(angle - ideal)
                    accuracy = 100 - (current_deviation / max_deviation * 100)
                    accuracy = max(0, min(100, accuracy))  # Clamp between 0-100
            
            response = {
                "success": True,
                "message": "Pose detected",
                "feedback": feedback,
                "angle": round(angle, 2),
                "reps": reps,
                "accuracy": round(accuracy, 2),
                "exercise": self.current_exercise
            }
            
        return response


# Create detector instance
detector = ExerciseFormDetector()

@app.route('/api/exercises', methods=['GET'])
def get_exercises():
    return jsonify({
        "exercises": list(detector.exercises.keys())
    })

@app.route('/api/analyze', methods=['POST'])
def analyze_image():
    # Check if image is in the request
    if 'image' not in request.json:
        return jsonify({"success": False, "message": "No image provided"}), 400
    
    # Get exercise name from request
    exercise = request.json.get('exercise')
    if not exercise:
        return jsonify({"success": False, "message": "No exercise specified"}), 400
    
    try:
        # Decode base64 image
        img_data = request.json['image'].split(',')[1]
        img_bytes = base64.b64decode(img_data)
        img_array = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        
        # Process the frame
        result = detector.process_frame(frame, exercise)
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({"success": False, "message": f"Error processing image: {str(e)}"}), 500

@app.route('/api/reset', methods=['POST'])
def reset_exercise():
    exercise = request.json.get('exercise')
    if not exercise:
        return jsonify({"success": False, "message": "No exercise specified"}), 400
    
    result = detector.set_exercise(exercise)
    if result:
        return jsonify({"success": True, "message": f"Exercise reset to {exercise}"})
    else:
        return jsonify({"success": False, "message": f"Invalid exercise: {exercise}"}), 400

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)