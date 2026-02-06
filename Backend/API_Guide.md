🏥 Shefaa API Documentation (Updated 2026)
Base URL: https://shefaa-backend.vercel.app/api

🔐 1. Authentication Endpoints
Path: /auth

Register (All Roles)

Method: POST

URL: /auth/register

Body (JSON): name, username, email, password, role (patient/doctor/pharmacy), phoneNumber, address, age, gender, specialization (for doctor), licence (for pharmacy).

Login

Method: POST

URL: /auth/login

Body: identity (email/phone), password

🩺 2. Doctor Endpoints
Path: /doctor | Header: Authorization: Bearer <accessToken>

Get Doctor Profile

Method: GET | URL: /doctor/profile

Update Doctor Profile

Method: PUT | URL: /doctor/profile

Body: specialization, yearsOfExperience, about, paymentOption (in_clinic/online/both).

Add New Clinic

Method: POST | URL: /doctor/add-clinic

Body: name, city, address, location (Point), availableDays, dailyCapacity, slotDuration, capacityPerSlot, price.

Add Medical Record (Prescription)

Method: POST | URL: /doctor/add-medical-record

Body: patientId, diagnosis, prescription (Array), notes, nextVisitDate.

Get Doctor Appointments

Method: GET | URL: /doctor/appointments

💊 3. Pharmacy Endpoints
Path: /pharmacy | Header: Authorization: Bearer <accessToken>

Get All Stock

Method: GET | URL: /pharmacy/stock

Add Medicine to Stock

Method: POST | URL: /pharmacy/add-medicine

Body: medicineName, quantity, price, expirationDate, category, description.

Update Medicine

Method: PUT | URL: /pharmacy/update-medicine/:id

Body: quantity, price.

Delete Medicine

Method: DELETE | URL: /pharmacy/delete-medicine/:id

Dispense Medicine (Sell)

Method: POST | URL: /pharmacy/dispense

Body: stockId, quantityToDispense.

Search Medicines (Public)

Method: GET | URL: /pharmacy/search?name=Panadol

👤 4. Patient Endpoints
Path: /patient | Header: Authorization: Bearer <accessToken>

Get Profile

Method: GET | URL: /patient/profile

Update Profile

Method: PUT | URL: /patient/profile

Body: phoneNumber, address, age, weight, height, allergies.

🧪 5. Lab Endpoints (New)
  Path: `/lab` | Header:   Authorization: Bearer <accessToken>
- Add Test POST /lab/add-test
  - Body: testName, price, estimatedTime.
- Upload Result: POST /lab/upload-result
  - Body (form-data):   patientId, testName, resultFile (PDF).
- Get My Tests:   `GET /lab/my-tests` (عرض قائمة تحاليل المعمل).
- Get Patient Results:   `GET /lab/patient-results/:patientId`.

💡 Notes for Frontend:
Enums: paymentOption must be one of (in_clinic, online, both).

Location: Send location as GeoJSON: {"type": "Point", "coordinates": [longitude, latitude]}.

IDs: Always use the _id returned from the database for patientId or stockId.