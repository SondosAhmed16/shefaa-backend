# 🏥 Chefaa Healthcare Platform - Backend

A scalable and secure backend API for the **Chefaa Healthcare Platform**, an AI-powered healthcare ecosystem that connects **Patients, Doctors, Pharmacies, Laboratories, and Administrators** through one integrated platform.

Developed using **Node.js**, **Express.js**, and **MongoDB**, the backend provides RESTful APIs, authentication, appointment management, pharmacy services, laboratory workflows, AI integration, and real-time communication.

---

## 🚀 Features

### 🔐 Authentication & Authorization
- JWT Authentication
- Role-Based Access Control (RBAC)
- Google OAuth Login
- Password Reset via Email
- Refresh Token Authentication
- Secure Session Management

### 👤 User Management
- Patient Registration
- Doctor Registration with Verification
- Pharmacy Registration with License Verification
- Laboratory Registration with Verification
- Profile Management
- Upload Profile Images & Documents

### 👨‍⚕️ Doctor Module
- Manage Multiple Clinics
- Clinic Scheduling
- Appointment Management
- Digital Prescriptions
- Patient Medical Records
- Revenue Analytics
- AI Daily Briefing

### 👨‍👩‍👧 Patient Module
- Search Doctors
- Book / Cancel / Reschedule Appointments
- View Prescriptions
- Upload Medical Reports
- AI Medical Report Analysis
- Medical Chatbot
- Medicine Reminder
- Order Medicines
- Online Payments

### 💊 Pharmacy Module
- Medicine Inventory Management
- Stock Management
- Order Processing
- Delivery Tracking
- Revenue Dashboard
- AI Stock Insights

### 🧪 Laboratory Module
- Laboratory Services Management
- Receive Test Requests
- Upload Test Results
- Patient Notifications

### 🤖 AI Features
- Medical Report Analysis
- AI Medical Chatbot
- Doctor Daily Briefings
- Pharmacy Daily Briefings
- Revenue Analytics
- Business Insights

### 🔔 Notifications
- Real-Time Notifications
- Appointment Updates
- Prescription Alerts
- Laboratory Results
- Order Status Updates

### 💳 Payment System
- Secure Online Payments
- Transaction History
- Billing Records
- Financial Reports

### 🛡️ Admin Dashboard
- Verify Healthcare Providers
- Manage Users
- Monitor Platform Activity
- Financial Monitoring
- Platform Analytics
- System Configuration

---

# 🛠 Tech Stack

### Backend
- Node.js
- Express.js

### Database
- MongoDB
- Mongoose

### Authentication
- JWT
- Passport.js
- Google OAuth 2.0

### File Storage
- Cloudinary
- Multer

### Real-Time
- Socket.io

### AI Integration
- OpenAI API

### Email
- Nodemailer

### Security
- Helmet
- Validator
- Google Auth Library

### Logging
- Morgan
- Winston

### Scheduling
- Node-Cron

---

# 📂 Project Structure

```
src/
│
├── config/
├── controllers/
├── middleware/
├── models/
├── routes/
├── utils/
└── index.js
```

---

# ⚙️ Installation

```bash
git clone https://github.com/SondosAhmed16/shefaa-backend.git

cd chefaa-backend

npm install
```

Create a `.env` file.

```env
PORT=

MONGO_URI=

JWT_SECRET=

JWT_REFRESH_SECRET=

GOOGLE_CLIENT_ID=

GOOGLE_CLIENT_SECRET=

EMAIL_USER=

EMAIL_PASS=

CLOUDINARY_CLOUD_NAME=

CLOUDINARY_API_KEY=

CLOUDINARY_API_SECRET=

OPENAI_API_KEY=
```

Run the server

```bash
npm run dev
```

Production

```bash
npm start
```

---

# 📡 Main API Modules

- Authentication
- Users
- Doctors
- Patients
- Clinics
- Appointments
- Prescriptions
- Pharmacies
- Medicines
- Orders
- Laboratories
- Lab Requests
- Medical Records
- Notifications
- Payments
- Reviews
- AI Services
- Admin

---

# 🔒 Security

- JWT Authentication
- Password Hashing (bcrypt)
- Role-Based Authorization
- Helmet Security Middleware
- Request Validation
- Protected Routes
- Secure File Uploads

---

# 🌐 Real-Time Features

- Appointment Notifications
- Order Status Updates
- Prescription Notifications
- Laboratory Result Notifications
- Live Alerts using Socket.io

---

# 🤝 My Contribution

As the **Backend Developer**, I was responsible for:

- Designing and developing RESTful APIs
- Implementing authentication and authorization (JWT & RBAC)
- Designing MongoDB schemas and relationships
- Building appointment management APIs
- Developing pharmacy and laboratory workflows
- Implementing digital prescription functionality
- Integrating AI services using the OpenAI API
- Managing secure file uploads with Cloudinary
- Implementing real-time communication using Socket.io
- Developing payment and billing APIs
- Building admin management features
- Applying backend security best practices
- Testing and debugging backend services
- Writing clean, scalable, and maintainable code

---



# 📜 License

This project was developed as a **Graduation Project** at the Faculty of Computers and Information, Menoufia University.

---

# 👩‍💻 Backend Developer

**Sondos Ahmed**
**Haneen Shaban**


Backend Developer | Node.js Developer

GitHub: https://github.com/SondosAhmed16

LinkedIn: https://www.linkedin.com/in/sondos-sherif-5872592a3/
