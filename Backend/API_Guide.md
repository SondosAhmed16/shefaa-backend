🏥 Shefaa API Documentation (English)
Base URL: https://shefaa-backend.vercel.app/api

🔐 1. Authentication Endpoints
Path: /auth

**Register**

Method: POST

Full URL: https://shefaa-backend.vercel.app/api/auth/register

Body (JSON): name, username, email, password, role, phoneNumber, address, age, gender

**Login**

Method: POST

Full URL: https://shefaa-backend.vercel.app/api/auth/login

Body (JSON): email, password

**Refresh Token**

Method: POST

Full URL: https://shefaa-backend.vercel.app/api/auth/refresh-token

Body (JSON): refreshToken

**Forgot Password**

Method: POST

Full URL: https://shefaa-backend.vercel.app/api/auth/forgot-password

Body (JSON): email

**Reset Password**

Method: POST

Full URL: https://shefaa-backend.vercel.app/api/auth/reset-password

Body (JSON): token, newPassword

**Logout**

Method: POST

Full URL: https://shefaa-backend.vercel.app/api/auth/logout

Body (JSON): refreshToken

👤 2. Patient Endpoints
Path: /patient Required Header: Authorization: Bearer <accessToken>

**Get Profile**

Method: GET

Full URL: https://shefaa-backend.vercel.app/api/patient/profile

Requirements: No Body (Fetched via Token)

**Update Profile**

Method: PUT

Full URL: https://shefaa-backend.vercel.app/api/patient/profile

Requirements: address, phoneNumber, age, gender, bloodType, allergies

**Upload Scan/Lab**

Method: POST

Full URL: https://shefaa-backend.vercel.app/api/patient/upload-scan

Requirements: form-data: scan (File), doctorId, diagnosis

**Medical History**

Method: GET

Full URL: https://shefaa-backend.vercel.app/api/patient/medical-history

Requirements: No Body