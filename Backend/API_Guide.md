# 🏥 Shefaa API Documentation (English)
**Base URL:** `http://localhost:8080/api`

---

## 🔐 1. Authentication Endpoints
**Path:** `/auth`

| Action | Method | Full URL | Body (JSON) |
| :--- | :--- | :--- | :--- |
| **Register** | POST | http://localhost:8080/api/auth/register | name, username, email, password, role, phoneNumber, address, age, gender |
| **Login** | POST | http://localhost:8080/api/auth/login | email, password |
| **Refresh Token** | POST | http://localhost:8080/api/auth/refresh-token | refreshToken |
| **Forgot Password** | POST | http://localhost:8080/api/auth/forgot-password | email |
| **Reset Password** | POST | http://localhost:8080/api/auth/reset-password | token, newPassword |
| **Logout** | POST | http://localhost:8080/api/auth/logout | refreshToken |

---

## 👤 2. Patient Endpoints
**Path:** `/patient`  
**Required Header:** `Authorization: Bearer <accessToken>`

| Action | Method | Full URL | Requirements |
| :--- | :--- | :--- | :--- |
| **Get Profile** | GET | http://localhost:8080/api/patient/profile | No Body (Fetched via Token) |
| **Update Profile** | PUT | http://localhost:8080/api/patient/profile | address, phoneNumber, age, gender, bloodType, allergies |
| **Upload Scan/Lab** | POST | http://localhost:8080/api/patient/upload-scan | form-data: scan (File), doctorId, diagnosis |
| **Medical History** | GET | http://localhost:8080/api/patient/medical-history | No Body |

---
